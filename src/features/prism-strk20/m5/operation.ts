// Local M5 attempt/recovery contract. This is deliberately smaller than the
// durable Prism OperationStore: it fences one submitted wallet transaction and
// gives receipt polling a restart-safe, no-rebroadcast policy. It never issues
// a completion receipt or invents a transaction hash.

import { M5_ERROR_CODE, M5Error } from "./errors";
import type { M5ReceiptObservation } from "./validation";
import { addressesEqual, PRIVACY_POOL_SEPOLIA } from "./constants";
export type { M5ReceiptObservation } from "./validation";

export type M5OperationState = "ready" | "submitting" | "submitted" | "received" | "succeeded" | "reverted" | "requires_attention";
export type M5Hex = `0x${string}`;

export interface M5Operation {
  readonly id: string;
  readonly state: M5OperationState;
  readonly version: number;
  readonly txHash: M5Hex | null;
  readonly submissionAttempted: boolean;
  readonly updatedAt: number;
  readonly blockNumber: number | null;
  readonly errorCode: string | null;
}

export interface M5RecoveryResult {
  readonly operation: M5Operation;
  readonly advanced: boolean;
  readonly reason: string;
}

function hasPoolEventEvidence(receipt: M5ReceiptObservation, requiredPoolAddress?: string): boolean {
  if (receipt.poolEventFound !== true || !Array.isArray(receipt.events) || receipt.events.length === 0) return false;
  const poolAddress = requiredPoolAddress ?? PRIVACY_POOL_SEPOLIA;
  return receipt.events.some((event) =>
    typeof event?.address === "string" && addressesEqual(event.address, poolAddress));
}

function hash(value: unknown): M5Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(value.trim())) {
    throw new M5Error(M5_ERROR_CODE.OPERATION_STALE, "malformed_transaction_hash");
  }
  return `0x${value.trim().slice(2).toLowerCase().padStart(64, "0")}` as M5Hex;
}

function next(
  operation: M5Operation,
  patch: Partial<Pick<M5Operation, "state" | "txHash" | "submissionAttempted" | "updatedAt" | "blockNumber" | "errorCode">>,
): M5Operation {
  return { ...operation, ...patch, version: operation.version + 1 };
}

export function createM5Operation(id: string, now: number): M5Operation {
  if (typeof id !== "string" || id.trim().length === 0) throw new M5Error(M5_ERROR_CODE.OPERATION_STALE, "operation_id_required");
  if (!Number.isFinite(now)) throw new M5Error(M5_ERROR_CODE.OPERATION_STALE, "operation_time_invalid");
  return {
    id,
    state: "ready",
    version: 0,
    txHash: null,
    submissionAttempted: false,
    updatedAt: now,
    blockNumber: null,
    errorCode: null,
  };
}

/**
 * Fence the external submission boundary before calling the wallet. If the
 * provider times out after broadcasting, the operation remains fenced even
 * though no transaction hash is available to recover.
 */
export function markM5SubmissionStarted(operation: M5Operation, now: number): M5Operation {
  if (!Number.isFinite(now)) throw new M5Error(M5_ERROR_CODE.OPERATION_STALE, "submission_time_invalid");
  if (operation.submissionAttempted || operation.txHash !== null) {
    throw new M5Error(M5_ERROR_CODE.OPERATION_STALE, "submission_attempted_fence");
  }
  if (operation.state !== "ready") throw new M5Error(M5_ERROR_CODE.OPERATION_STALE, `cannot_start_submission_from_${operation.state}`);
  return next(operation, { state: "submitting", submissionAttempted: true, updatedAt: now });
}

/** Record the one wallet submission. A recovery path can never rebroadcast it. */
export function markM5Submitted(operation: M5Operation, txHash: string, now: number): M5Operation {
  if (operation.txHash !== null) {
    throw new M5Error(M5_ERROR_CODE.OPERATION_STALE, "submission_attempted_fence");
  }
  if (operation.state !== "ready" && operation.state !== "submitting") {
    throw new M5Error(M5_ERROR_CODE.OPERATION_STALE, `cannot_submit_from_${operation.state}`);
  }
  if (operation.state === "submitting" && !operation.submissionAttempted) {
    throw new M5Error(M5_ERROR_CODE.OPERATION_STALE, "submission_attempt_flag_missing");
  }
  return next(operation, { state: "submitted", txHash: hash(txHash), submissionAttempted: true, updatedAt: now });
}

function sameHash(a: string | null, b: string): boolean {
  if (!a) return false;
  return hash(a) === hash(b);
}

/**
 * Apply one receipt observation. RECEIVED/PENDING/UNKNOWN stay in polling;
 * timeout moves to attention without clearing the submission fence.
 */
export function recoverM5Operation(
  operation: M5Operation,
  receipt: M5ReceiptObservation | null,
  options: { now: number; timeoutAt: number; requiredPoolAddress?: string },
): M5RecoveryResult {
  if (!Number.isFinite(options.now) || !Number.isFinite(options.timeoutAt)) {
    throw new M5Error(M5_ERROR_CODE.OPERATION_STALE, "recovery_time_invalid");
  }
  if (operation.state === "succeeded" || operation.state === "reverted") {
    return { operation, advanced: false, reason: `terminal:${operation.state}` };
  }
  if (!operation.txHash || !operation.submissionAttempted) {
    return { operation, advanced: false, reason: "submission_not_recorded" };
  }
  if (receipt === null) {
    if (options.now >= options.timeoutAt && operation.state !== "requires_attention") {
      return {
        operation: next(operation, { state: "requires_attention", updatedAt: options.now, errorCode: M5_ERROR_CODE.UNKNOWN_RECEIPT }),
        advanced: true,
        reason: "receipt_timeout_requires_attention",
      };
    }
    return { operation, advanced: false, reason: "awaiting_receipt" };
  }
  if (!sameHash(operation.txHash, receipt.transactionHash)) {
    return { operation, advanced: false, reason: "receipt_hash_mismatch" };
  }

  if (receipt.executionStatus === "REVERTED") {
    // A provider may expose a pre-confirmation/retryable label as REVERTED
    // before the receipt has a block. Without a block there is no terminal
    // chain fact to reconcile, so keep polling instead of treating it as an
    // irreversible pool rollback.
    if (receipt.blockNumber === null || !Number.isSafeInteger(receipt.blockNumber) || receipt.blockNumber < 0) {
      return { operation, advanced: false, reason: "reverted_receipt_missing_block" };
    }
    return {
      operation: next(operation, { state: "reverted", updatedAt: options.now, blockNumber: receipt.blockNumber, errorCode: M5_ERROR_CODE.POOL_ROLLBACK }),
      advanced: true,
      reason: "receipt_reverted",
    };
  }

  if (receipt.executionStatus === "RECEIVED" || receipt.executionStatus === "PENDING" || receipt.executionStatus === "UNKNOWN") {
    if (operation.state === "submitted") {
      return { operation: next(operation, { state: "received", updatedAt: options.now }), advanced: true, reason: "receipt_pending" };
    }
    return { operation, advanced: false, reason: "receipt_pending" };
  }

  const final =
    receipt.executionStatus === "SUCCEEDED" &&
    (receipt.finalityStatus === "ACCEPTED_ON_L2" || receipt.finalityStatus === "ACCEPTED_ON_L1") &&
    receipt.blockNumber !== null &&
    Number.isSafeInteger(receipt.blockNumber) &&
    hasPoolEventEvidence(receipt, options.requiredPoolAddress);
  if (!final) {
    return { operation, advanced: false, reason: "success_receipt_missing_final_pool_facts" };
  }
  return {
    operation: next(operation, { state: "succeeded", updatedAt: options.now, blockNumber: receipt.blockNumber, errorCode: null }),
    advanced: true,
    reason: "receipt_succeeded_with_pool_event",
  };
}
