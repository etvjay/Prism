// Shared settlement submission guard for PauseService and PauseSettlementBridge.
// The operation row is the only durable authority for whether a chain adapter may
// be invoked. The fence is persisted before the adapter call; any later failure
// is poll-only and must never create a fresh broadcast opportunity.

import type { ExecutionPause } from "../domain/pause";
import type { ExecutionPlan } from "../domain/execution-plan";
import type { PauseExecutionAdapter, SettlementChain } from "../ports/execution-adapter";
import type { OperationStore, PersistedOperation } from "../../prism-operations/domain/operation-store";
import type { OperationState } from "../../prism-operations/domain/operation";

export const SETTLEMENT_AMBIGUOUS_ERROR_CODE = "ERR-022";
export const SETTLEMENT_SUBMISSION_FENCE_DETAIL = "pause_settlement_submission_attempted_poll_only";

export const POST_SUBMISSION_STATES: readonly OperationState[] = [
  "submitted",
  "processing",
  "confirming",
  "confirmed",
  "indexed",
  "reconciled",
];

const POST_SUBMISSION_SET = new Set<OperationState>(POST_SUBMISSION_STATES);

export interface PreparedSettlementSubmission {
  readonly operation: PersistedOperation;
  /** True only for the caller that durably won the pre-submit fence. */
  readonly invokeAdapter: boolean;
}

export interface SettlementSubmissionOutcome {
  readonly operation: PersistedOperation;
  readonly adapterInvoked: boolean;
  /** The adapter was invoked, but the durable result is not a trusted submitted fact. */
  readonly quarantined: boolean;
  readonly error?: unknown;
}

function isPostSubmissionState(state: OperationState): boolean {
  return POST_SUBMISSION_SET.has(state);
}

/**
 * Move an operation through its local authorization states and persist the
 * monotonic submission fence immediately before crossing into an adapter.
 * Existing fenced/settled rows are returned without granting another call.
 */
export async function prepareSettlementSubmission(
  operationStore: OperationStore,
  operation: PersistedOperation,
  now: number,
): Promise<PreparedSettlementSubmission> {
  let current = operation;
  // A small retry loop handles concurrent callers that race through the local
  // created/awaiting/ready states. The versioned fence still has exactly one
  // winner; losers re-read the winner's quarantine instead of invoking an
  // adapter or surfacing an avoidable intermediate CAS error.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (isPostSubmissionState(current.state) || current.state === "completed") {
      return { operation: current, invokeAdapter: false };
    }
    if (current.submissionAttempted || current.state === "requires_attention") {
      return { operation: current, invokeAdapter: false };
    }

    try {
      if (current.state === "created") {
        current = await operationStore.transition(current.id, {
          to: "awaiting_authorization",
          now,
          expectedVersion: current.version,
        });
        continue;
      }
      if (current.state === "awaiting_authorization" || current.state === "failed_retryable") {
        current = await operationStore.transition(current.id, {
          to: "ready",
          now,
          expectedVersion: current.version,
        });
        continue;
      }
      if (current.state !== "ready") {
        return { operation: current, invokeAdapter: false };
      }
      const fenced = await operationStore.transition(current.id, {
        to: "requires_attention",
        now,
        expectedVersion: current.version,
        errorCode: SETTLEMENT_AMBIGUOUS_ERROR_CODE,
        errorDetail: SETTLEMENT_SUBMISSION_FENCE_DETAIL,
        submissionAttempted: true,
      });
      return { operation: fenced, invokeAdapter: true };
    } catch (cause) {
      const latest = await readDurableOperation(operationStore, current.id);
      if (!latest) throw cause;
      if (
        latest.submissionAttempted ||
        latest.state === "requires_attention" ||
        isPostSubmissionState(latest.state) ||
        latest.state === "completed"
      ) {
        return { operation: latest, invokeAdapter: false };
      }
      // A concurrent local transition may have advanced the row one step;
      // retry from the durable value. Other store failures are retried a
      // bounded number of times and then fail before any adapter call.
      current = latest;
    }
  }
  throw new Error("settlement_submission_prepare_race");
}

function returnedOperationIsValid(
  returned: PersistedOperation,
  durable: PersistedOperation,
  operationId: string,
): boolean {
  if (returned.id !== operationId || durable.id !== operationId) return false;
  if (returned.idempotencyKey !== durable.idempotencyKey || returned.requestFingerprint !== durable.requestFingerprint) return false;
  if (returned.kind !== durable.kind || returned.authoritativeSource !== durable.authoritativeSource) return false;
  if (!returned.submissionAttempted || !durable.submissionAttempted) return false;
  if (!isPostSubmissionState(returned.state) || !isPostSubmissionState(durable.state)) return false;
  if (returned.state !== durable.state || returned.version !== durable.version) return false;
  if (returned.txHash !== durable.txHash) return false;
  return true;
}

async function readDurableOperation(
  operationStore: OperationStore,
  operationId: string,
): Promise<PersistedOperation | undefined> {
  try {
    return await operationStore.getById(operationId);
  } catch {
    return undefined;
  }
}

/**
 * Invoke one adapter only after `prepareSettlementSubmission` wins the
 * durable fence. Adapter return objects are treated as claims and accepted
 * only when a matching post-submit row can be read back from OperationStore.
 * An exception or mismatched readback remains quarantined; it never re-arms
 * the operation for a retry.
 */
export async function invokeSettlementAdapter(input: {
  operationStore: OperationStore;
  operation: PersistedOperation;
  pause: ExecutionPause;
  plan: ExecutionPlan;
  adapter: PauseExecutionAdapter;
  chain: SettlementChain;
  operationId: string;
  correlationId: string | null;
  now: number;
}): Promise<SettlementSubmissionOutcome> {
  const prepared = await prepareSettlementSubmission(input.operationStore, input.operation, input.now);
  if (!prepared.invokeAdapter) {
    return { operation: prepared.operation, adapterInvoked: false, quarantined: prepared.operation.submissionAttempted || prepared.operation.state === "requires_attention" };
  }

  let returned: PersistedOperation | undefined;
  let error: unknown;
  try {
    returned = await input.adapter.submit({
      operation: prepared.operation,
      pause: input.pause,
      plan: input.plan,
      correlationId: input.correlationId,
      operationId: input.operationId,
    });
  } catch (cause) {
    error = cause;
  }

  const durable = await readDurableOperation(input.operationStore, input.operationId);
  // A successful adapter may have persisted `submitted` and then lost its
  // response. Durable readback wins over the thrown transport error.
  if (durable && isPostSubmissionState(durable.state) && durable.submissionAttempted) {
    if (!returned || returnedOperationIsValid(returned, durable, input.operationId)) {
      return { operation: durable, adapterInvoked: true, quarantined: false, error };
    }
  }

  // Keep the fenced row as the only retry boundary. If the adapter persisted a
  // non-terminal failure branch, preserve that fact but still report quarantine.
  return {
    operation: durable ?? prepared.operation,
    adapterInvoked: true,
    quarantined: true,
    error: error ?? new Error("adapter_return_not_durable"),
  };
}
