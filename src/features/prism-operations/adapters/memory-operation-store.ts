// In-memory OperationStore adapter — reference implementation for tests and local dev.
// Pure port semantics: parameterized-store semantics emulated with CAS checks,
// idempotency-key deduplication, and versioned transitions. Atomicity is
// single-process critical sections; production Postgres adapter provides ACID
// conditional writes (T7 tier). No web/DB/RPC imports beyond port types.

import { createOperation, transition as domainTransition, type Hex, type OperationState } from "../domain/operation";
import { OperationError, OPERATION_ERROR_CODE } from "../domain/errors";
import type { CreateOperationRecordInput, OperationStore, PersistedOperation, TransitionOperationInput } from "../domain/operation-store";
import { NON_TERMINAL_STATES } from "../domain/operation-store";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class InMemoryOperationStore implements OperationStore {
  private readonly byId = new Map<string, PersistedOperation>();
  private readonly byKey = new Map<string, string>(); // idempotencyKey -> id
  private closed = false;

  async create(input: CreateOperationRecordInput): Promise<PersistedOperation> {
    this.assertOpen();
    validateCreateInput(input);
    // Dedupe on idempotency_key first
    const existingId = this.byKey.get(input.idempotencyKey);
    if (existingId !== undefined) {
      const existing = this.byId.get(existingId);
      if (!existing) throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "duplicate_operation_id");
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, `idempotency_key_conflict:key_${input.idempotencyKey}_fingerprint_mismatch`);
      }
      return clone(existing);
    }
    // Also guard duplicate operation id with different key (distinct resource)
    if (this.byId.has(input.id)) {
      throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "duplicate_operation_id");
    }
    const base = createOperation({ id: input.id, kind: input.kind, now: input.now, correlationId: input.correlationId ?? null });
    const record: PersistedOperation = {
      ...base,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.requestFingerprint,
      reconciliationWatermark: null,
      reconciliationMetadata: null,
    };
    this.byId.set(record.id, clone(record));
    this.byKey.set(record.idempotencyKey, record.id);
    return clone(record);
  }

  async getById(id: string): Promise<PersistedOperation | undefined> {
    this.assertOpen();
    const rec = this.byId.get(id);
    return rec ? clone(rec) : undefined;
  }

  async getByIdempotencyKey(key: string): Promise<PersistedOperation | undefined> {
    this.assertOpen();
    const id = this.byKey.get(key);
    if (!id) return undefined;
    const rec = this.byId.get(id);
    return rec ? clone(rec) : undefined;
  }

  async transition(id: string, input: TransitionOperationInput): Promise<PersistedOperation> {
    this.assertOpen();
    if (!Number.isFinite(input.now)) throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "invalid_now_timestamp");
    const current = this.byId.get(id);
    if (!current) throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "unknown_operation");
    // Delegate domain checks (CAS, submitted!=completed, illegal skip, etc.)
    let nextOp: PersistedOperation;
    let idempotent = false;
    try {
      const result = domainTransition(current, {
        to: input.to,
        now: input.now,
        expectedVersion: input.expectedVersion,
        txHash: input.txHash !== undefined ? (input.txHash as Hex | null) : undefined,
        errorCode: input.errorCode !== undefined ? input.errorCode : undefined,
        errorDetail: input.errorDetail !== undefined ? input.errorDetail : undefined,
      });
      idempotent = result.idempotent;
      if (idempotent) {
        // Handle watermark/metadata idempotent update via version CAS if supplied
        const watermarkChanged = input.reconciliationWatermark !== undefined && input.reconciliationWatermark !== current.reconciliationWatermark;
        const metadataChanged =
          input.reconciliationMetadata !== undefined &&
          JSON.stringify(input.reconciliationMetadata) !== JSON.stringify(current.reconciliationMetadata);
        if (watermarkChanged || metadataChanged) {
          if (current.version !== input.expectedVersion) {
            throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, `stale_version:expected_${input.expectedVersion}_got_${current.version}`);
          }
          const updated: PersistedOperation = {
            ...current,
            reconciliationWatermark: input.reconciliationWatermark !== undefined ? input.reconciliationWatermark : current.reconciliationWatermark,
            reconciliationMetadata: input.reconciliationMetadata !== undefined ? input.reconciliationMetadata : current.reconciliationMetadata,
            updatedAt: input.now,
          };
          // Version stays same for idempotent watermark bump? Mirror postgres: watermark update does not bump version beyond idempotent path with version check.
          // Keep version unchanged to preserve idempotent semantics.
          this.byId.set(id, clone(updated));
          return clone(updated);
        }
        return clone(current);
      }
      nextOp = {
        ...result.operation,
        idempotencyKey: current.idempotencyKey,
        requestFingerprint: current.requestFingerprint,
        reconciliationWatermark: input.reconciliationWatermark !== undefined ? input.reconciliationWatermark : current.reconciliationWatermark,
        reconciliationMetadata: input.reconciliationMetadata !== undefined ? input.reconciliationMetadata : current.reconciliationMetadata,
        correlationId: input.correlationId !== undefined ? input.correlationId : result.operation.correlationId,
      };
    } catch (cause) {
      if (cause instanceof OperationError) throw cause;
      throw cause;
    }
    // CAS check already done inside domainTransition expectedVersion, but double-check before write
    if (current.version !== input.expectedVersion) {
      throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, `stale_version:expected_${input.expectedVersion}_got_${current.version}`);
    }
    this.byId.set(id, clone(nextOp));
    return clone(nextOp);
  }

  async listNonTerminal(limit = 100): Promise<readonly PersistedOperation[]> {
    this.assertOpen();
    const bounded = Math.max(1, Math.min(1000, Math.floor(limit)));
    const result: PersistedOperation[] = [];
    for (const rec of this.byId.values()) {
      if ((NON_TERMINAL_STATES as readonly string[]).includes(rec.state)) result.push(clone(rec));
    }
    result.sort((a, b) => {
      if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return result.slice(0, bounded);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "store_is_closed");
  }
}

function validateCreateInput(input: CreateOperationRecordInput): void {
  if (!input.id || input.id.trim().length === 0) throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "missing_operation_id");
  if (!input.idempotencyKey || input.idempotencyKey.trim().length === 0) throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "missing_idempotency_key");
  if (!input.requestFingerprint || input.requestFingerprint.trim().length === 0) throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "missing_request_fingerprint");
  if (!Number.isFinite(input.now)) throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "invalid_now_timestamp");
}
