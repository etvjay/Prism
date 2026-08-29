// Typed reconciliation boundary for SM-PRISM-003.
// This is a pure policy boundary: the domain never pretends to submit an RPC
// transaction or to reconcile a live chain inside the operation state machine.
// The port below describes the minimal typed facts a reconciliation caller
// must supply; the pure policy (`decideReconciliationStep`) maps those facts
// to the next OperationState without any I/O.
//
// Worker / polling / adapter lives outside this slice. This file contains
// only types and a pure decision function that tests exercise directly.
//
// Transport-neutral contract: no starknet.js, viem, or RPC SDK is imported.
// Ledger and indexer ports are pure interfaces over typed observations; adapters
// translate any transport (RPC, gateway, fake) into these observations.

import type { Hex, Operation, OperationState } from "./operation";
import { AUTHORITATIVE_SOURCE } from "./operation";

// ---------------------------------------------------------------------------
// Transport-neutral Ledger (RPC status) and Event/Indexer observation types
// ---------------------------------------------------------------------------

export type TxExecutionStatus = "RECEIVED" | "ACCEPTED_ON_L2" | "SUCCEEDED" | "REVERTED";
export type TxFinalityStatus = "RECEIVED" | "ACCEPTED_ON_L2" | "ACCEPTED_ON_L1";

export interface ChainTxObservation {
  /** Starknet transaction hash that was submitted. Must match operation.txHash. */
  txHash: Hex;
  /** Sequencer status. */
  finality: TxFinalityStatus;
  /** Execution outcome once available. */
  execution: TxExecutionStatus | null;
  /** Contract revert code when execution is REVERTED (stable ERR code). */
  revertCode?: string | null;
  /** Block number when observed (for watermark checks). */
  blockNumber?: number | null;
}

export interface IndexerObservation {
  txHash: Hex;
  eventObserved: boolean;
  eventName?: string | null;
  blockNumber?: number | null;
  eventIndex?: number | null;
}

export interface ReconciliationObservation {
  chainReceiptMatched: boolean;
  eventMatchedToOperation: boolean;
  matchedTxHash?: Hex | null;
}

// Aggregated facts the pure policy consumes.
export interface ReconciliationFacts {
  chain: ChainTxObservation | null;
  indexer: IndexerObservation | null;
  reconciliation: ReconciliationObservation | null;
}

// ---------------------------------------------------------------------------
// Pure reconciliation policy
// ---------------------------------------------------------------------------

export interface ReconciliationDecision {
  nextState: OperationState | null;
  reason: string;
  authoritativeSource: string | null;
}

function reconciliationMatchesOperation(operation: Operation, reconciliation: ReconciliationObservation | null): boolean {
  if (!reconciliation || operation.txHash === null || reconciliation.matchedTxHash === null || reconciliation.matchedTxHash === undefined) {
    return false;
  }
  return (
    reconciliation.chainReceiptMatched === true &&
    reconciliation.eventMatchedToOperation === true &&
    reconciliation.matchedTxHash.toLowerCase() === operation.txHash.toLowerCase()
  );
}

/**
 * Pure map from durable operation + observed chain/indexer/reconciliation facts
 * to the next OperationState. Returns null when no state change is warranted
 * (poll again). Never performs I/O.
 *
 * Authority rule: each returned state's authoritative source matches
 * STATE_MACHINES.md / AUTHORITY_MATRIX.md — processing/confirming/confirmed
 * from RPC, indexed from indexer, reconciled/completed from reconciliation.
 */
export function decideReconciliationStep(
  operation: Operation,
  facts: ReconciliationFacts,
): ReconciliationDecision {
  // Terminal states never advance via reconciliation.
  if (["completed", "failed_terminal", "cancelled", "expired", "reverted"].includes(operation.state)) {
    return { nextState: null, reason: `terminal:${operation.state}`, authoritativeSource: null };
  }

  // No chain facts yet => remain in current workflow state, caller should retry.
  if (operation.state === "requires_attention") {
    if (!facts.chain || facts.chain.txHash !== operation.txHash) {
      return { nextState: null, reason: "awaiting_chain_observation", authoritativeSource: null };
    }
    if (facts.chain.execution === "REVERTED") {
      return { nextState: "reverted" as OperationState, reason: `tx_reverted:${facts.chain.revertCode ?? "unknown"}`, authoritativeSource: AUTHORITATIVE_SOURCE.reverted };
    }
    if (facts.chain.execution === "SUCCEEDED" && (facts.chain.finality === "ACCEPTED_ON_L2" || facts.chain.finality === "ACCEPTED_ON_L1")) {
      if (reconciliationMatchesOperation(operation, facts.reconciliation)) {
        return { nextState: "reconciled", reason: "requires_attention_recovered_reconciliation_match", authoritativeSource: AUTHORITATIVE_SOURCE.reconciled };
      }
      return { nextState: "processing", reason: "requires_attention_recovered_chain", authoritativeSource: AUTHORITATIVE_SOURCE.processing };
    }
    if (facts.chain.execution === "RECEIVED" && facts.chain.finality === "RECEIVED") {
      return { nextState: null, reason: "tx_in_mempool", authoritativeSource: null };
    }
    return { nextState: null, reason: "awaiting_next_chain_status", authoritativeSource: null };
  }

  if (operation.state === "submitted" || operation.state === "processing" || operation.state === "confirming") {
    if (!facts.chain || facts.chain.txHash !== operation.txHash) {
      return { nextState: null, reason: "awaiting_chain_observation", authoritativeSource: null };
    }
    if (facts.chain.execution === "REVERTED") {
      return { nextState: "reverted" as OperationState, reason: `tx_reverted:${facts.chain.revertCode ?? "unknown"}`, authoritativeSource: AUTHORITATIVE_SOURCE.reverted };
    }
    if (facts.chain.execution === "SUCCEEDED" && facts.chain.finality === "ACCEPTED_ON_L2") {
      // Advance one step at a time; caller will invoke transition().
      if (operation.state === "submitted") {
        return { nextState: "processing", reason: "accepted_on_l2", authoritativeSource: AUTHORITATIVE_SOURCE.processing };
      }
      if (operation.state === "processing") {
        return { nextState: "confirming", reason: "processing_to_confirming", authoritativeSource: AUTHORITATIVE_SOURCE.confirming };
      }
      if (operation.state === "confirming") {
        return { nextState: "confirmed", reason: "execution_succeeded", authoritativeSource: AUTHORITATIVE_SOURCE.confirmed };
      }
    }
    // ACCEPTED_ON_L1 is a finalized observation, but the operation lifecycle
    // still advances one legal hop per tick. Returning `confirmed` directly
    // from submitted/processing would deadlock at the domain transition table
    // (those states do not permit a skip); preserve the same stepwise path as
    // ACCEPTED_ON_L2 while retaining the stronger finality fact.
    if (facts.chain.execution === "SUCCEEDED" && facts.chain.finality === "ACCEPTED_ON_L1") {
      if (operation.state === "submitted") {
        return { nextState: "processing", reason: "accepted_on_l1_processing", authoritativeSource: AUTHORITATIVE_SOURCE.processing };
      }
      if (operation.state === "processing") {
        return { nextState: "confirming", reason: "accepted_on_l1_confirming", authoritativeSource: AUTHORITATIVE_SOURCE.confirming };
      }
      if (operation.state === "confirming") {
        return { nextState: "confirmed", reason: "accepted_on_l1", authoritativeSource: AUTHORITATIVE_SOURCE.confirmed };
      }
    }
    if (facts.chain.execution === "RECEIVED" && facts.chain.finality === "RECEIVED") {
      return { nextState: null, reason: "tx_in_mempool", authoritativeSource: null };
    }
    return { nextState: null, reason: "awaiting_next_chain_status", authoritativeSource: null };
  }

  if (operation.state === "confirmed") {
    if (facts.indexer?.eventObserved && facts.indexer.txHash === operation.txHash) {
      return { nextState: "indexed", reason: "indexer_event_observed", authoritativeSource: AUTHORITATIVE_SOURCE.indexed };
    }
    return { nextState: null, reason: "awaiting_indexer_event", authoritativeSource: null };
  }

  if (operation.state === "indexed") {
    if (reconciliationMatchesOperation(operation, facts.reconciliation)) {
      return { nextState: "reconciled", reason: "reconciliation_match", authoritativeSource: AUTHORITATIVE_SOURCE.reconciled };
    }
    return { nextState: null, reason: "awaiting_reconciliation_match", authoritativeSource: null };
  }

  if (operation.state === "reconciled") {
    // Completion requires the receipt to have been issued; the facts signal
    // that reconciliation has succeeded, so the caller may issue receipt.
    if (reconciliationMatchesOperation(operation, facts.reconciliation)) {
      return { nextState: "completed", reason: "receipt_issued", authoritativeSource: AUTHORITATIVE_SOURCE.completed };
    }
    return { nextState: null, reason: "awaiting_receipt_issue", authoritativeSource: null };
  }

  // Workflow states that are not chain-driven return null here.
  return { nextState: null, reason: `no_reconciliation_path_for:${operation.state}`, authoritativeSource: null };
}

// ---------------------------------------------------------------------------
// Transport-neutral ports (ledger RPC status + event/indexer)
// ---------------------------------------------------------------------------

/**
 * Transport-neutral Ledger / RPC status port.
 * Authority for states submitted/processing/confirming/confirmed/reverted is
 * Starknet RPC tx status (AUTHORITY_MATRIX row: submitted_unknown etc.).
 * No transport SDK is imported; adapters translate.
 */
export interface LedgerStatusPort {
  /** Observe chain tx status for txHash. Pure read; never mutates. */
  observeChain(txHash: Hex): Promise<ChainTxObservation | null>;
}

/**
 * Transport-neutral Event / Indexer port.
 * Authority for states indexed/reconciled is the indexer event observed
 * plus reconciliation match (AUTHORITY_MATRIX: confirmed-but-unindexed etc.).
 */
export interface EventIndexerPort {
  /** Observe indexer for the operation's canonical event. */
  observeIndexer(txHash: Hex): Promise<IndexerObservation | null>;
  /** Observe reconciliation ledger correlation for the operation. */
  observeReconciliation(txHash: Hex): Promise<ReconciliationObservation | null>;
}

// ---------------------------------------------------------------------------
// Composite reconciliation port (typed boundary — no implementation in this slice)
// ---------------------------------------------------------------------------

/**
 * Typed boundary for reconciliation callers. Implementations live outside the
 * pure domain (adapter/worker). The domain never creates a fake worker or
 * mocks production completion; tests supply `ReconciliationFacts` directly to
 * `decideReconciliationStep` and separately exercise `transition`.
 *
 * Composition of the two transport-neutral ports above; workers may depend
 * on the composite or on the two narrow ports individually.
 */
export interface OperationReconciliationPort extends LedgerStatusPort, EventIndexerPort {}

/** Explicit aliases required by the closeout contract wording. */
export type LedgerPort = LedgerStatusPort;
export type IndexerPort = EventIndexerPort;
