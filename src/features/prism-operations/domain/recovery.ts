// Deterministic recovery / reconciliation boundary for SM-PRISM-003.
// Pure policy + typed worker boundary. No DB/RPC SDK imports; the worker
// receives an OperationStore and Ledger/Index ports and never invents chain truth.
//
// Transport-neutral worker: narrow ports (LedgerStatusPort + EventIndexerPort)
// are composed into OperationReconciliationPort; the worker never imports
// starknet.js / viem / pg. Tests supply labelled fakes.
//
// Invariants enforced:
// - submitted/processing/confirming/confirmed NEVER become completed without
//   passing through indexed → reconciled (INV-SYS-005). The pure
//   `decideReconciliationStep` guarantees this; the worker never short-circuits
//   it. A timeout after submission proves nothing (ERR-022) — the worker leaves
//   the operation in its last honest state and surfaces poll-only.
// - Fail closed on unknown chain state: if any observation is missing, mismatched
//   txHash, or throws, the worker returns { advanced:false } and leaves the
//   durable row untouched. It never marks submitted as completed, failed, or
//   reconciled on the basis of "unknown".
// - Version CAS is the only writer; stale_version errors are counted as
//   benign concurrent-writer races.
//
// Divergence handling (AUTHORITY_MATRIX §4, SYSTEM_FOUNDRY §20):
// | case                          | authoritative source          | detection                              | repair / handling                          |
// | submitted-but-unknown         | chain RPC re-query            | tick finds chain=null                 | noop, poll again; after N misses caller may mark failed_retryable externally |
// | confirmed-but-unindexed       | chain receipt                 | indexer.eventObserved=false            | noop awaiting_indexer_event             |
// | reverted                      | tx_receipt_revert_code        | chain.execution=REVERTED               | advance to reverted with stable ERR     |
// | duplicate event               | indexer (tx_hash,event_index) | idempotent same-state re-apply (store) | benign duplicate (isDuplicate)          |
// | missed event                  | chain receipts ground truth   | indexer gap scan -> null              | noop awaiting_indexer_event             |
// | stale cache (ACTIVE for REVOKED) | registry state (watermark) | watermark < confirmedBlock-K          | invalidate; serve NO_ACTIVE_DESTINATION |
// | dependency outage (RPC/indexer/store) | op_policy / dependency | observe* throws                        | fail-closed, dependencyFailure=true     |
// | restart                       | durable op row                | startup sweep listNonTerminal           | resume polling from last txHash         |
// | retryable vs terminal         | op_policy                     | isRetryableFailure / isTerminal         | distinct states, attempts incremented   |
//
// Authoritative source per state (STATE_MACHINES.md SM-PRISM-003):
// created/awaiting_authorization/ready -> backend_op_row
// submitted/processing/confirming -> starknet_rpc_tx_status
// confirmed -> execution_status_succeeded
// indexed -> indexer_event_observed
// reconciled -> reconciliation_match
// completed -> receipt_issued
// reverted -> tx_receipt_revert_code
// failed_* / expired / cancelled / requires_attention -> op_policy / ttl_policy / user_or_operator

import type { ChainTxObservation, IndexerObservation, ReconciliationObservation, ReconciliationFacts } from "./ports";
import { decideReconciliationStep, type OperationReconciliationPort } from "./ports";
import type { Hex, OperationState } from "./operation";
import type { OperationStore, PersistedOperation } from "./operation-store";
import { OperationError, OPERATION_ERROR_CODE } from "./errors";

export interface ReconcileTickResult {
  readonly operationId: string;
  readonly fromState: OperationState;
  /** null when no state change was warranted (poll again). */
  readonly toState: OperationState | null;
  readonly advanced: boolean;
  readonly reason: string;
  /** True when an unexpected dependency/transport failure was observed (fail-closed). */
  readonly dependencyFailure: boolean;
}

export interface RecoverySweepResult {
  readonly swept: number;
  readonly advanced: number;
  readonly noops: number;
  readonly dependencyFailures: number;
  readonly staleConflicts: number;
  readonly errors: ReadonlyArray<{ operationId: string; reason: string }>;
}

/**
 * Single-operation deterministic reconciliation tick.
 * Reads the durable operation, gathers typed observations via the port,
 * runs the pure policy, and—only if a nextState is decided—attempts a
 * versioned CAS transition. Never performs I/O beyond the supplied ports.
 *
 * Fail-closed: if observe* throws or returns mismatched/unknown chain state,
 * the function returns dependencyFailure or noop without mutating the store.
 */
export async function tickReconciliation(
  store: OperationStore,
  reconciliationPort: OperationReconciliationPort,
  operationId: string,
  now: number,
): Promise<ReconcileTickResult> {
  const op = await store.getById(operationId);
  if (!op) throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "unknown_operation");
  const fromState = op.state;

  // Terminal states never advance via reconciliation — pure policy also returns null.
  if (["completed", "failed_terminal", "cancelled", "expired", "reverted"].includes(fromState)) {
    return { operationId, fromState, toState: null, advanced: false, reason: `terminal:${fromState}`, dependencyFailure: false };
  }

  // Gather observations. Each is best-effort; throw is fail-closed.
  let chain: ChainTxObservation | null = null;
  let indexer: IndexerObservation | null = null;
  let reconciliation: ReconciliationObservation | null = null;

  const txHash = op.txHash;
  // States before submission have no txHash; tick is a noop.
  if (["created", "awaiting_authorization", "ready", "failed_retryable", "failed_terminal", "expired", "cancelled", "requires_attention"].includes(fromState) && txHash === null) {
    // For failed_retryable/requires_attention the port could still observe a prior txHash if present; otherwise noop.
    if (txHash === null) {
      return { operationId, fromState, toState: null, advanced: false, reason: `no_tx_hash_for:${fromState}`, dependencyFailure: false };
    }
  }

  if (txHash !== null) {
    try {
      chain = await reconciliationPort.observeChain(txHash as Hex);
    } catch {
      return { operationId, fromState, toState: null, advanced: false, reason: "dependency_chain_observe_failed", dependencyFailure: true };
    }
    // Indexer/reconciliation observations are only meaningful for confirmed+ states,
    // but querying them unconditionally is harmless; port may return null.
    try {
      indexer = await reconciliationPort.observeIndexer(txHash as Hex);
    } catch {
      return { operationId, fromState, toState: null, advanced: false, reason: "dependency_indexer_observe_failed", dependencyFailure: true };
    }
    try {
      reconciliation = await reconciliationPort.observeReconciliation(txHash as Hex);
    } catch {
      return { operationId, fromState, toState: null, advanced: false, reason: "dependency_reconciliation_observe_failed", dependencyFailure: true };
    }
  }

  // The indexer port can prove event correlation, but it cannot promote an
  // event into receipt evidence by itself. Combine it with the ledger fact
  // already observed in this tick and fail closed on an unknown/mismatched
  // chain result. The pure policy still accepts an explicitly supplied
  // reconciliation fact for transport-neutral callers and unit tests.
  if (reconciliation !== null) {
    const receiptMatches =
      chain !== null &&
      chain.txHash.toLowerCase() === (txHash as string).toLowerCase() &&
      chain.execution === "SUCCEEDED" &&
      (chain.finality === "ACCEPTED_ON_L2" || chain.finality === "ACCEPTED_ON_L1");
    reconciliation = {
      ...reconciliation,
      chainReceiptMatched: receiptMatches,
    };
  }

  const facts: ReconciliationFacts = { chain, indexer, reconciliation };
  const decision = decideReconciliationStep(op, facts);

  if (decision.nextState === null) {
    return { operationId, fromState, toState: null, advanced: false, reason: decision.reason, dependencyFailure: false };
  }

  // Guard: never mark submitted/processing/confirming/confirmed as completed.
  // The pure policy already enforces this, but double-guard here defensively.
  if (decision.nextState === "completed" && ["submitted", "processing", "confirming", "confirmed"].includes(fromState)) {
    return {
      operationId,
      fromState,
      toState: null,
      advanced: false,
      reason: `submitted_is_not_completed_blocked:from_${fromState}_to_completed`,
      dependencyFailure: false,
    };
  }

  // Attempt versioned transition. Map txHash/revertCode preservation from facts.
  // Persist: tx hash, block/watermark, event correlation (txHash+eventIndex), retry count (attempts via store), reconciliation metadata.
  const patch: {
    txHash: Hex | null;
    errorCode: string | null;
    errorDetail: string | null;
    reconciliationWatermark: number | null;
    reconciliationMetadata: Record<string, unknown> | null;
  } = {
    txHash: (op.txHash as Hex | null) ?? null,
    errorCode: op.errorCode,
    errorDetail: op.errorDetail,
    reconciliationWatermark: op.reconciliationWatermark,
    reconciliationMetadata: op.reconciliationMetadata,
  };
  if (decision.nextState === "reverted" && chain?.revertCode) {
    patch.errorCode = chain.revertCode;
  }
  if (chain?.blockNumber !== undefined && chain.blockNumber !== null) {
    patch.reconciliationWatermark = chain.blockNumber;
  } else if (indexer?.blockNumber !== undefined && indexer.blockNumber !== null) {
    patch.reconciliationWatermark = indexer.blockNumber;
  }
  // Event correlation + watermark + retry metadata: persisted via reconciliationMetadata
  // Keyed by tx_hash + event_index per EVENT_CATALOGUE (idempotent reconstruction).
  if (indexer?.eventObserved) {
    patch.reconciliationMetadata = {
      ...(patch.reconciliationMetadata ?? {}),
      txHash: indexer.txHash,
      eventIndex: indexer.eventIndex,
      eventName: indexer.eventName,
      blockNumber: indexer.blockNumber,
      authoritativeSource: decision.authoritativeSource,
      observedAt: now,
    };
  } else if (chain?.blockNumber !== null && chain?.blockNumber !== undefined) {
    patch.reconciliationMetadata = {
      ...(patch.reconciliationMetadata ?? {}),
      txHash: chain.txHash,
      blockNumber: chain.blockNumber,
      authoritativeSource: decision.authoritativeSource,
      observedAt: now,
    };
  }

  try {
    await store.transition(op.id, {
      to: decision.nextState,
      now,
      expectedVersion: op.version,
      txHash: patch.txHash ?? undefined,
      errorCode: patch.errorCode ?? undefined,
      errorDetail: patch.errorDetail ?? undefined,
      reconciliationWatermark: patch.reconciliationWatermark ?? undefined,
      reconciliationMetadata: patch.reconciliationMetadata ?? undefined,
    });
    return { operationId, fromState, toState: decision.nextState, advanced: true, reason: decision.reason, dependencyFailure: false };
  } catch (cause) {
    if (cause instanceof OperationError && String(cause.detail ?? "").startsWith("stale_version")) {
      return { operationId, fromState, toState: decision.nextState, advanced: false, reason: String(cause.detail), dependencyFailure: false };
    }
    // Any other transition rejection is deterministic (illegal skip guard, etc.) — treat as noop with reason.
    if (cause instanceof OperationError) {
      return { operationId, fromState, toState: decision.nextState, advanced: false, reason: String(cause.detail ?? cause.message), dependencyFailure: false };
    }
    // Store dependency failure — fail closed.
    return { operationId, fromState, toState: decision.nextState, advanced: false, reason: "store_write_failed", dependencyFailure: true };
  }
}

/**
 * Startup recovery sweep: list non-terminal operations and tick each once.
 * Resume point is the durable row itself (last txHash + state); no in-memory
 * cursor is required so a crash-then-restart resumes from the same truck.
 * Never marks submitted as completed; unknown chain state is a noop.
 */
export async function recoverNonTerminalOperations(
  store: OperationStore,
  reconciliationPort: OperationReconciliationPort,
  now: number,
  limit = 100,
): Promise<RecoverySweepResult> {
  const ops: readonly PersistedOperation[] = await store.listNonTerminal(limit);
  let advanced = 0;
  let noops = 0;
  let dependencyFailures = 0;
  let staleConflicts = 0;
  const errors: Array<{ operationId: string; reason: string }> = [];

  for (const op of ops) {
    const result = await tickReconciliation(store, reconciliationPort, op.id, now);
    if (result.advanced) advanced++;
    else noops++;
    if (result.dependencyFailure) dependencyFailures++;
    if (result.reason.startsWith("stale_version")) staleConflicts++;
    if (result.reason === "store_write_failed") errors.push({ operationId: op.id, reason: result.reason });
  }

  return { swept: ops.length, advanced, noops, dependencyFailures, staleConflicts, errors };
}

/** Deterministic helper: whether the recovery watermark is stale. */
export function isWatermarkStale(watermark: number | null, confirmedBlock: number, boundK: number): boolean {
  if (watermark === null) return true;
  return watermark < confirmedBlock - boundK;
}

/**
 * Narrow-port variant: deterministic tick using separate transport-neutral ports.
 * Exists to prove the Ledger vs Indexer boundary is separable and transport-neutral.
 * Behavior is identical to tickReconciliation; the composite is built inline.
 */
export async function tickReconciliationWithNarrowPorts(
  store: OperationStore,
  ledger: import("./ports").LedgerStatusPort,
  indexer: import("./ports").EventIndexerPort,
  operationId: string,
  now: number,
): Promise<ReconcileTickResult> {
  const composite: import("./ports").OperationReconciliationPort = {
    observeChain: (txHash) => ledger.observeChain(txHash),
    observeIndexer: (txHash) => indexer.observeIndexer(txHash),
    observeReconciliation: (txHash) => indexer.observeReconciliation(txHash),
  };
  return tickReconciliation(store, composite, operationId, now);
}

/** Authoritative source lookup for observability chain (AUTHORITY_MATRIX §5). */
export function authoritativeSourceForState(state: OperationState): string | null {
  const map: Record<string, string> = {
    created: "backend_op_row",
    awaiting_authorization: "backend_op_row",
    ready: "backend_op_row",
    submitted: "starknet_rpc_tx_status",
    processing: "starknet_rpc_tx_status",
    confirming: "starknet_rpc_tx_status",
    confirmed: "execution_status_succeeded",
    indexed: "indexer_event_observed",
    reconciled: "reconciliation_match",
    completed: "receipt_issued",
    failed_retryable: "op_policy",
    failed_terminal: "op_policy",
    reverted: "tx_receipt_revert_code",
    expired: "ttl_policy",
    cancelled: "user_or_operator",
    requires_attention: "timeout_escalation",
  };
  return map[state] ?? null;
}
