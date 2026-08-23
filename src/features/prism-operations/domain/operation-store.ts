// Durable OperationStore port — SM-PRISM-003 WORKFLOW persistence boundary.
// Pure domain contract, no DB/RPC/web imports. All implementations satisfy
// the same idempotency, version-CAS and canonical-field semantics so that
// restart/recovery remains deterministic and fail-closed.
//
// Persisted fields required for restart/resume per WP-4B:
//   id, kind, state, version, idempotencyKey, requestFingerprint,
//   txHash nullable, errorCode nullable, errorDetail nullable,
//   attempts, correlationId, createdAt, updatedAt,
//   reconciliationWatermark nullable, reconciliationMetadata nullable.
// Fields are stored exactly as typed; no fabrication of chain truth.

import type { Hex, Operation, OperationState } from "./operation";

export interface PersistedOperation extends Operation {
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly reconciliationWatermark: number | null;
  readonly reconciliationMetadata: Record<string, unknown> | null;
}

export interface CreateOperationRecordInput {
  readonly id: string;
  readonly kind?: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly now: number;
  readonly correlationId?: string | null;
}

export interface TransitionOperationInput {
  readonly to: OperationState;
  readonly now: number;
  readonly expectedVersion: number;
  readonly txHash?: Hex | null;
  readonly errorCode?: string | null;
  readonly errorDetail?: string | null;
  readonly reconciliationWatermark?: number | null;
  readonly reconciliationMetadata?: Record<string, unknown> | null;
  readonly correlationId?: string | null;
}

/**
 * Durable operation port. All writes are atomic compare-and-set; reads return
 * owned copies so callers cannot mutate durable state in place.
 *
 * Idempotency rule (same key / same fingerprint is benign, different fingerprint
 * is a conflict):
 *   create(key=K, fingerprint=F) when a row with idempotency_key=K already
 *   exists:
 *     F === stored.requestFingerprint  → returns stored record, no duplicate.
 *     F !== stored.requestFingerprint  → throws OperationError ERR-023
 *                                        (stale_state_conflict, detail
 *                                        "idempotency_key_conflict").
 *
 * Version rule (optimistic CAS):
 *   transition(id, expectedVersion=V) succeeds only when current version === V.
 *   On mismatch it throws OperationError ERR-023 with "stale_version" detail,
 *   never silently overwrites (SYSTEM_FOUNDRY §18). The store increments
 *   version by exactly 1 on success and never on idempotent same-state.
 */
export interface OperationStore {
  /** Idempotent create. See idempotency rule above. */
  create(input: CreateOperationRecordInput): Promise<PersistedOperation>;

  /** Fetch by primary operation id. */
  getById(id: string): Promise<PersistedOperation | undefined>;

  /** Fetch by idempotency key (client request id). */
  getByIdempotencyKey(key: string): Promise<PersistedOperation | undefined>;

  /**
   * Guarded compare-and-set transition. Delegates legality checks to the pure
   * domain `transition` (INV-SYS-005, chain hash guards, failure-code guards)
   * and enforces expectedVersion CAS atomically in the store.
   * Returns the post-transition record. Idempotent same-state re-applications
   * (where the domain permits them) return the unchanged record with the same
   * version.
   * Throws OperationError on illegal transition, stale version, malformed
   * txHash, missing errorCode, or unknown state.
   */
  transition(id: string, input: TransitionOperationInput): Promise<PersistedOperation>;

  /** Sweep helper: list operations whose state is not terminal. */
  listNonTerminal(limit?: number): Promise<readonly PersistedOperation[]>;

  /** Close underlying connections; durable state survives. */
  close(): Promise<void>;
}

export const NON_TERMINAL_STATES: readonly OperationState[] = [
  "created",
  "awaiting_authorization",
  "ready",
  "submitted",
  "processing",
  "confirming",
  "confirmed",
  "indexed",
  "reconciled",
  "failed_retryable",
  "requires_attention",
] as const;
