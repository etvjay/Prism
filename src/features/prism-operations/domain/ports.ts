// Typed reconciliation boundary for SM-PRISM-003.
// This is a pure policy boundary: the domain never pretends to submit an RPC
// transaction or to reconcile a live chain inside the operation state machine.
// The port below describes the minimal typed facts a reconciliation caller
// must supply; the pure policy (`decideReconciliationStep`) maps those facts
// to the next OperationState without any I/O.
//
// Worker / polling / adapter lives outside this slice. This file contains
// only types and a pure decision function that tests exercise directly.

import type { Hex, Operation, OperationState } from "./operation";
import { AUTHORITATIVE_SOURCE } from "./operation";

// ---------------------------------------------------------------------------
// Chain / indexer observation types (typed boundary only)
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
    // If chain reports ACCEPTED_ON_L1 and execution SUCCEEDED, treat as confirmed.
    if (facts.chain.execution === "SUCCEEDED" && facts.chain.finality === "ACCEPTED_ON_L1") {
      if (operation.state === "confirming" || operation.state === "processing" || operation.state === "submitted") {
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
    if (facts.reconciliation?.eventMatchedToOperation && facts.reconciliation.chainReceiptMatched) {
      return { nextState: "reconciled", reason: "reconciliation_match", authoritativeSource: AUTHORITATIVE_SOURCE.reconciled };
    }
    return { nextState: null, reason: "awaiting_reconciliation_match", authoritativeSource: null };
  }

  if (operation.state === "reconciled") {
    // Completion requires the receipt to have been issued; the facts signal
    // that reconciliation has succeeded, so the caller may issue receipt.
    if (facts.reconciliation?.chainReceiptMatched && facts.reconciliation.eventMatchedToOperation) {
      return { nextState: "completed", reason: "receipt_issued", authoritativeSource: AUTHORITATIVE_SOURCE.completed };
    }
    return { nextState: null, reason: "awaiting_receipt_issue", authoritativeSource: null };
  }

  // Workflow states that are not chain-driven return null here.
  return { nextState: null, reason: `no_reconciliation_path_for:${operation.state}`, authoritativeSource: null };
}

// ---------------------------------------------------------------------------
// Reconciliation port (typed boundary — no implementation in this slice)
// ---------------------------------------------------------------------------

/**
 * Typed boundary for reconciliation callers. Implementations live outside the
 * pure domain (adapter/worker). The domain never creates a fake worker or
 * mocks production completion; tests supply `ReconciliationFacts` directly to
 * `decideReconciliationStep` and separately exercise `transition`.
 */
export interface OperationReconciliationPort {
  /** Observe the chain for the operation's txHash. Pure read; no side effect. */
  observeChain(txHash: Hex): Promise<ChainTxObservation | null>;
  /** Observe the indexer for the operation's event. */
  observeIndexer(txHash: Hex): Promise<IndexerObservation | null>;
  /** Observe reconciliation ledger for the operation. */
  observeReconciliation(txHash: Hex): Promise<ReconciliationObservation | null>;
}
