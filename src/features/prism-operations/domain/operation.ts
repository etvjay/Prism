// Pure, framework-free Operation lifecycle domain contract for SM-PRISM-003.
// No SDK, DB, or framework imports. All decisions are pure functions over
// immutable Operation values.
//
// Lifecycle (happy path):
//   created → awaiting_authorization → ready → submitted → processing
//   → confirming → confirmed → indexed → reconciled → completed
//
// Failure branches (explicit, distinct):
//   failed_retryable, failed_terminal, reverted, expired, cancelled, requires_attention
//
// Invariants enforced here:
// - submitted ≠ completed (INV-SYS-005 / INV-PRISM-015): a timeout after
//   submission proves nothing. submitted/processing/confirming/confirmed
//   may not become completed before indexed+reconciled.
// - Only specified transitions are allowed.
// - Authoritative-source metadata is preserved per state (STATE_MACHINES.md
//   table) and transitions do not fabricate chain truth.
// - Idempotent same-state facts are benign where the System spec permits
//   duplicate observations (RPC polling, indexer replays, terminal re-reads).
// - Stable error semantics via OperationError with catalogue codes.
// - retryable vs terminal branches are distinguished by helpers.
// - No RPC submission or live-chain reconciliation is performed here.

import { OperationError, OPERATION_ERROR_CODE } from "./errors";

export type Hex = `0x${string}`;

// ---------------------------------------------------------------------------
// State definitions
// ---------------------------------------------------------------------------

export const HAPPY_PATH = [
  "created",
  "awaiting_authorization",
  "ready",
  "submitted",
  "processing",
  "confirming",
  "confirmed",
  "indexed",
  "reconciled",
  "completed",
] as const;

export const FAILURE_BRANCHES = [
  "failed_retryable",
  "failed_terminal",
  "reverted",
  "expired",
  "cancelled",
  "requires_attention",
] as const;

export const ALL_OPERATION_STATES = [...HAPPY_PATH, ...FAILURE_BRANCHES] as const;

export type OperationState = (typeof ALL_OPERATION_STATES)[number];

export const TERMINAL_STATES: readonly OperationState[] = [
  "completed",
  "failed_terminal",
  "cancelled",
  "expired",
] as const;

export const RETRYABLE_FAILURE_STATES: readonly OperationState[] = [
  "failed_retryable",
  "requires_attention",
] as const;

export const TERMINAL_FAILURE_STATES: readonly OperationState[] = [
  "failed_terminal",
  "expired",
  "cancelled",
  "reverted",
] as const;

export const AUTHORITATIVE_SOURCE: Record<OperationState, string> = {
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

// States where the System spec permits idempotent same-state re-application:
// - RPC polling duplicates (submitted..confirmed)
// - indexer replays keyed by (tx_hash, event_index) (indexed, reconciled)
// - terminal re-reads (completed, failed_*, reverted, expired, cancelled)
// - escalation state re-polls (requires_attention)
// Early workflow states are also allowed as benign re-issues, but the set
// below is the authoritative list for the operation domain per
// AUTHORITY_MATRIX reconciliation rules.
export const IDEMPOTENT_SAME_STATE: ReadonlySet<OperationState> = new Set<OperationState>([
  "submitted",
  "processing",
  "confirming",
  "confirmed",
  "indexed",
  "reconciled",
  "completed",
  "failed_retryable",
  "failed_terminal",
  "reverted",
  "expired",
  "cancelled",
  "requires_attention",
  // early states are intentionally NOT idempotent except via explicit
  // creation idempotency_key (client_request_id) handled outside this
  // transition pure function; same-state on created/awaiting/ready is
  // rejected as stale unless explicitly allowed by the caller.
]);

// ---------------------------------------------------------------------------
// Operation record
// ---------------------------------------------------------------------------

export interface Operation {
  readonly id: string;
  readonly kind: string;
  readonly state: OperationState;
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly authoritativeSource: string;
  readonly txHash: Hex | null;
  readonly errorCode: string | null;
  readonly errorDetail: string | null;
  readonly attempts: number;
  /** Monotonic durable fence: once an adapter may have been invoked, no automatic resubmit is safe. */
  readonly submissionAttempted: boolean;
  // Correlation metadata preserved across transitions without mutation
  readonly correlationId: string | null;
}

export interface CreateOperationInput {
  id: string;
  kind?: string;
  now: number;
  correlationId?: string | null;
}

export function createOperation(input: CreateOperationInput): Operation {
  if (!input.id || input.id.trim().length === 0) {
    throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "missing_operation_id");
  }
  if (!Number.isFinite(input.now)) {
    throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "invalid_now_timestamp");
  }
  const state: OperationState = "created";
  return {
    id: input.id,
    kind: input.kind ?? "generic_chain_touching_action",
    state,
    version: 0,
    createdAt: input.now,
    updatedAt: input.now,
    authoritativeSource: AUTHORITATIVE_SOURCE[state],
    txHash: null,
    errorCode: null,
    errorDetail: null,
    attempts: 0,
    submissionAttempted: false,
    correlationId: input.correlationId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Allowed transitions table
// ---------------------------------------------------------------------------

type TransitionSet = ReadonlySet<OperationState>;

function s(...states: OperationState[]): TransitionSet {
  return new Set(states);
}

// Forward happy path plus failure branches.
// This table is exhaustive: any pair not listed is illegal and will be
// rejected. It encodes TR-O1 (created→completed via happy path), TR-O2
// (any_active→reverted), TR-O3 (submitted→requires_attention), and
// the explicit branches from the spec.
const ALLOWED: Record<OperationState, TransitionSet> = {
  created: s("awaiting_authorization", "failed_retryable", "failed_terminal", "expired", "cancelled"),
  awaiting_authorization: s("ready", "failed_retryable", "failed_terminal", "expired", "cancelled"),
  ready: s("submitted", "failed_retryable", "failed_terminal", "requires_attention", "expired", "cancelled"),
  submitted: s("processing", "reverted", "failed_retryable", "failed_terminal", "requires_attention"),
  processing: s("confirming", "reverted", "failed_retryable", "failed_terminal", "requires_attention"),
  confirming: s("confirmed", "reverted", "failed_retryable", "failed_terminal", "requires_attention"),
  confirmed: s("indexed", "failed_retryable", "failed_terminal"),
  indexed: s("reconciled", "failed_retryable", "failed_terminal", "requires_attention"),
  reconciled: s("completed"),
  completed: s(),
  failed_retryable: s("ready", "awaiting_authorization", "failed_terminal", "cancelled", "expired"),
  failed_terminal: s(),
  reverted: s(),
  expired: s(),
  cancelled: s(),
  // The application marks ready -> requires_attention before invoking an
  // adapter. A valid returned hash may then advance this fenced row to
  // submitted; this edge is never a retry permission by itself.
  requires_attention: s("submitted", "processing", "failed_retryable", "failed_terminal", "cancelled", "reconciled"),
};

// ---------------------------------------------------------------------------
// Guards & transition function
// ---------------------------------------------------------------------------

export interface TransitionInput {
  to: OperationState;
  now: number;
  expectedVersion?: number;
  txHash?: Hex | null;
  errorCode?: string | null;
  errorDetail?: string | null;
  /** Monotonic submission fence. It may be set true, never cleared. */
  submissionAttempted?: boolean;
  // reason is audit-only and never influences state routing
  reason?: string | null;
}

export interface TransitionResult {
  operation: Operation;
  /** true when the input was an idempotent same-state re-application */
  idempotent: boolean;
}

function isKnownState(v: string): v is OperationState {
  return (ALL_OPERATION_STATES as readonly string[]).includes(v);
}

export function isTerminal(state: OperationState): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

export function isRetryableFailure(state: OperationState): boolean {
  return (RETRYABLE_FAILURE_STATES as readonly string[]).includes(state);
}

export function isFailureBranch(state: OperationState): boolean {
  return (FAILURE_BRANCHES as readonly string[]).includes(state);
}

export function canTransition(from: OperationState, to: OperationState): boolean {
  if (!isKnownState(from) || !isKnownState(to)) return false;
  if (from === to) return IDEMPOTENT_SAME_STATE.has(from);
  const allowed = ALLOWED[from];
  return allowed ? allowed.has(to) : false;
}

function validateHexTxHash(v: unknown): Hex | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "invalid_tx_hash_type");
  if (!/^0x[0-9a-fA-F]{64}$/.test(v)) {
    // Starknet tx hashes are 32 bytes; require 64 hex chars after 0x.
    // Keep the check strict but allow shorter for test fixtures via 0x + 64?
    // Provide a stable detail.
    throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "malformed_tx_hash");
  }
  return v as Hex;
}

/**
 * Pure transition function.
 * - Returns a new Operation value with incremented version and updated source
 *   metadata when the move is allowed.
 * - Returns the same Operation (idempotent:true) when from===to and that
 *   state's same-state re-application is permitted.
 * - Throws OperationError with ERR-023 for stale version, unknown states,
 *   or illegal transitions (including INV-SYS-005 completion guard).
 * - Preserves authoritative-source metadata: updatedAt and source are set
 *   from the target state's authoritative source, never fabricated.
 * - Distinguishes retryable vs terminal branches via helpers; error codes
 *   are preserved, not invented.
 * - Does not perform any RPC or chain I/O.
 */
export function transition(operation: Operation, input: TransitionInput): TransitionResult {
  if (!operation || typeof operation.id !== "string") {
    throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "unknown_operation");
  }
  if (!isKnownState(operation.state)) {
    throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, `unknown_from_state:${String(operation.state)}`);
  }
  if (!isKnownState(input.to)) {
    throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, `unknown_to_state:${String(input.to)}`);
  }
  if (!Number.isFinite(input.now)) {
    throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "invalid_now_timestamp");
  }
  if (input.expectedVersion !== undefined && input.expectedVersion !== operation.version) {
    throw new OperationError(
      OPERATION_ERROR_CODE.STALE_STATE_CONFLICT,
      `stale_version:expected_${input.expectedVersion}_got_${operation.version}`,
    );
  }

  if (operation.submissionAttempted && input.submissionAttempted === false) {
    throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "submission_attempted_fence_cannot_clear");
  }

  // INV-SYS-005 guard: submitted/processing/confirming/confirmed may not
  // become completed before indexed+reconciled. Enforced even if a future
  // table edit accidentally adds the edge.
  const completionGuardSources: OperationState[] = ["submitted", "processing", "confirming", "confirmed"];
  if (input.to === "completed" && completionGuardSources.includes(operation.state as OperationState)) {
    throw new OperationError(
      OPERATION_ERROR_CODE.STALE_STATE_CONFLICT,
      `submitted_is_not_completed:from_${operation.state}_to_completed_requires_reconciled`,
    );
  }

  // Idempotent same-state: check before illegal-transition and skip guards.
  if (operation.state === input.to) {
    if (!IDEMPOTENT_SAME_STATE.has(operation.state)) {
      throw new OperationError(
        OPERATION_ERROR_CODE.STALE_STATE_CONFLICT,
        `same_state_not_idempotent:${operation.state}`,
      );
    }
    // If txHash is supplied, it must match the stored one (if any) to avoid
    // silently masking a diverging fact. Null matches null.
    if (input.txHash !== undefined && input.txHash !== null) {
      const incoming = validateHexTxHash(input.txHash);
      if (operation.txHash !== null && incoming !== operation.txHash) {
        throw new OperationError(
          OPERATION_ERROR_CODE.STALE_STATE_CONFLICT,
          `idempotent_tx_hash_mismatch:${operation.state}`,
        );
      }
    }
    // If error detail diverges, treat as stale.
    if (input.errorCode !== undefined && input.errorCode !== null) {
      if (operation.errorCode !== null && input.errorCode !== operation.errorCode) {
        throw new OperationError(
          OPERATION_ERROR_CODE.STALE_STATE_CONFLICT,
          `idempotent_error_code_mismatch:${operation.state}`,
        );
      }
    }
    return { operation, idempotent: true };
  }

  // Extra skip guards that give distinct diagnostics beyond the allowed table.
  // These run after idempotent so same-state re-applies are not flagged as skips.
  if (input.to === "completed" && (operation.state as string) === "indexed") {
    throw new OperationError(
      OPERATION_ERROR_CODE.STALE_STATE_CONFLICT,
      `illegal_skip_to_completed:from_${operation.state}`,
    );
  }
  if (input.to === "reconciled" && (operation.state as string) !== "indexed" && (operation.state as string) !== "requires_attention") {
    throw new OperationError(
      OPERATION_ERROR_CODE.STALE_STATE_CONFLICT,
      `illegal_skip_to_reconciled:from_${operation.state}`,
    );
  }
  if (input.to === "indexed" && (operation.state as string) !== "confirmed" && (operation.state as string) !== "requires_attention") {
    throw new OperationError(
      OPERATION_ERROR_CODE.STALE_STATE_CONFLICT,
      `illegal_skip_to_indexed:from_${operation.state}`,
    );
  }

  // Standard allowed check.
  const allowed = ALLOWED[operation.state];
  if (!allowed || !allowed.has(input.to)) {
    throw new OperationError(
      OPERATION_ERROR_CODE.STALE_STATE_CONFLICT,
      `illegal_transition:${operation.state}->${input.to}`,
    );
  }

  // Additional guards for chain-bound transitions:
  // - Any move into submitted..reconciled should carry a txHash once submitted.
  //   For submitted itself, txHash is required. For later chain states, txHash
  //   must already be present on the operation or supplied now.
  const chainStates: OperationState[] = ["submitted", "processing", "confirming", "confirmed", "indexed", "reconciled", "completed", "reverted"];
  if (input.to === "submitted") {
    if (!input.txHash) {
      throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "tx_hash_required_for_submitted");
    }
    validateHexTxHash(input.txHash);
  }
  if (chainStates.includes(input.to) && input.to !== "submitted") {
    const effectiveHash = input.txHash ?? operation.txHash;
    if (!effectiveHash) {
      throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, `tx_hash_required_for_${input.to}`);
    }
    if (input.txHash) validateHexTxHash(input.txHash);
  }

  // Failure states that originate from tx execution must carry a stable error
  // code (reverted maps to contract revert code, failed_* preserve policy).
  // We require errorCode for these branches to enforce stable semantics, but
  // allow requires_attention to be driven by timeout alone with ERR-022 default.
  if (input.to === "reverted" && !input.errorCode) {
    throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "revert_code_required_for_reverted");
  }
  if ((input.to === "failed_retryable" || input.to === "failed_terminal") && !input.errorCode) {
    throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, `error_code_required_for_${input.to}`);
  }

  const effectiveTxHash = (input.txHash !== undefined ? validateHexTxHash(input.txHash) : operation.txHash) ?? operation.txHash;

  // Preserve authoritative source for target state.
  const next: Operation = {
    ...operation,
    state: input.to,
    version: operation.version + 1,
    updatedAt: input.now,
    authoritativeSource: AUTHORITATIVE_SOURCE[input.to],
    txHash: chainStates.includes(input.to) ? effectiveTxHash : operation.txHash,
    errorCode: input.errorCode !== undefined ? input.errorCode : operation.errorCode,
    errorDetail: input.errorDetail !== undefined ? input.errorDetail : operation.errorDetail,
    attempts: operation.attempts + (isFailureBranch(input.to) || input.to === "requires_attention" ? 1 : 0),
    submissionAttempted: operation.submissionAttempted || input.submissionAttempted === true,
  };

  return { operation: next, idempotent: false };
}

// ---------------------------------------------------------------------------
// Helpers for retry/recovery decisions (pure policy)
// ---------------------------------------------------------------------------

/** Returns the set of states to which a retry is permitted. */
export function retryTargets(from: OperationState): OperationState[] {
  const targets = ALLOWED[from];
  if (!targets) return [];
  // For retryable failures, the caller should inspect this set.
  return Array.from(targets);
}

/** Whether the operation can be automatically resubmitted. */
export function canRetry(operation: Operation): boolean {
  return operation.state === "failed_retryable" && operation.txHash === null && operation.submissionAttempted !== true;
}

/** Duration-agnostic staleness check for versioned compare-and-set callers. */
export function isStale(expectedVersion: number, currentVersion: number): boolean {
  return expectedVersion !== currentVersion;
}
