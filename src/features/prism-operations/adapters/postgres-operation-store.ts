// Durable PostgreSQL OperationStore adapter (port: OperationStore).
//
// Production persistence for SM-PRISM-003 WORKFLOW rows. Implements WP-4B
// semantics:
// - Parameterized SQL only (no string interpolation of values).
// - Versioned migration/table `prism_operations` with checked state enum.
// - Idempotency-key deduplication: same key + same requestFingerprint is benign
//   (returns existing row), same key + different fingerprint throws
//   OperationError ERR-023 `idempotency_key_conflict` (INV-SYS-005 style).
// - Expected-version CAS: transition succeeds only when current version ===
//   expectedVersion; otherwise throws OperationError ERR-023 `stale_version`.
// - Canonical restart fields persisted: id, kind, state, version,
//   idempotency_key, request_fingerprint, tx_hash, error_code, error_detail,
//   attempts, submission_attempted, correlation_id, created_at, updated_at, authoritative_source,
//   reconciliation_watermark, reconciliation_metadata.
// - No RPC/indexer coupling: pure store.
// - Fail-closed: connect/migrate/write failures throw
//   PostgresOperationStoreError with stable `code`; they never return optimistic
//   stale values.

import { Pool, type PoolClient } from "pg";
import type { PoolConfig } from "pg";
import { createOperation, transition as domainTransition, AUTHORITATIVE_SOURCE, type Hex, type OperationState } from "../domain/operation";
import { OperationError, OPERATION_ERROR_CODE } from "../domain/errors";
import type {
  CreateOperationRecordInput,
  OperationStore,
  PersistedOperation,
  TransitionOperationInput,
} from "../domain/operation-store";
import { NON_TERMINAL_STATES } from "../domain/operation-store";

/** Current schema version for the operation table. Independent from ownership store. */
export const OPERATION_STORE_SCHEMA_VERSION = 2;

/** Versioned migration for `prism_operations` (idempotent). */
export const OPERATION_STORE_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS prism_store_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prism_operations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('created','awaiting_authorization','ready','submitted','processing','confirming','confirmed','indexed','reconciled','completed','failed_retryable','failed_terminal','reverted','expired','cancelled','requires_attention')),
  version INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  tx_hash TEXT,
  error_code TEXT,
  error_detail TEXT,
  attempts INTEGER NOT NULL,
  submission_attempted BOOLEAN NOT NULL DEFAULT FALSE,
  correlation_id TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  authoritative_source TEXT NOT NULL,
  reconciliation_watermark BIGINT,
  reconciliation_metadata TEXT
);
ALTER TABLE prism_operations ADD COLUMN IF NOT EXISTS submission_attempted BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_prism_operations_state ON prism_operations(state);
CREATE INDEX IF NOT EXISTS idx_prism_operations_idempotency_key ON prism_operations(idempotency_key);
`;

export type PostgresOperationStoreErrorCode =
  | "store_connect_failed"
  | "store_migrate_failed"
  | "duplicate_operation_id"
  | "idempotency_key_conflict"
  | "store_write_failed"
  | "store_read_failed"
  | "invalid_record";

export class PostgresOperationStoreError extends Error {
  readonly code: PostgresOperationStoreErrorCode;
  constructor(code: PostgresOperationStoreErrorCode, message: string, cause?: unknown) {
    super(`[${code}] ${message}${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "PostgresOperationStoreError";
    this.code = code;
  }
}

const COLUMNS = [
  "id",
  "kind",
  "state",
  "version",
  "idempotency_key",
  "request_fingerprint",
  "tx_hash",
  "error_code",
  "error_detail",
  "attempts",
  "submission_attempted",
  "correlation_id",
  "created_at",
  "updated_at",
  "authoritative_source",
  "reconciliation_watermark",
  "reconciliation_metadata",
] as const;

interface Row {
  id: string;
  kind: string;
  state: string;
  version: number | string;
  idempotency_key: string;
  request_fingerprint: string;
  tx_hash: string | null;
  error_code: string | null;
  error_detail: string | null;
  attempts: number | string;
  submission_attempted: boolean | string | null;
  correlation_id: string | null;
  created_at: number | string;
  updated_at: number | string;
  authoritative_source: string;
  reconciliation_watermark: number | string | null;
  reconciliation_metadata: string | null;
}

function toInt(value: string | number): number {
  const n = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(n)) throw new Error(`non-integer column value ${String(value)}`);
  return n;
}

function nullableInt(value: string | number | null): number | null {
  if (value === null) return null;
  return toInt(value as string | number);
}

function toBoolean(value: boolean | string | null | undefined): boolean {
  return value === true || value === "true";
}

function rowToRecord(row: Row): PersistedOperation {
  let reconciliationMetadata: Record<string, unknown> | null = null;
  if (row.reconciliation_metadata !== null) {
    try {
      reconciliationMetadata = JSON.parse(row.reconciliation_metadata) as Record<string, unknown>;
    } catch {
      throw new PostgresOperationStoreError("store_read_failed", `corrupt reconciliation_metadata for operation ${row.id}`);
    }
  }
  return {
    id: row.id,
    kind: row.kind,
    state: row.state as OperationState,
    version: toInt(row.version as unknown as string | number),
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint,
    txHash: (row.tx_hash as Hex | null) ?? null,
    errorCode: row.error_code,
    errorDetail: row.error_detail,
    attempts: toInt(row.attempts as string | number),
    submissionAttempted: toBoolean(row.submission_attempted),
    correlationId: row.correlation_id,
    createdAt: toInt(row.created_at as string | number),
    updatedAt: toInt(row.updated_at as string | number),
    authoritativeSource: row.authoritative_source,
    reconciliationWatermark: nullableInt(row.reconciliation_watermark),
    reconciliationMetadata,
  };
}

export interface PostgresOperationStoreOptions extends Pick<PoolConfig, keyof PoolConfig> {
  pool?: PoolConfig;
  skipMigration?: boolean;
}

function mergePoolConfig(options: PostgresOperationStoreOptions): PoolConfig {
  const { pool, skipMigration: _skip, ...flat } = options;
  return { ...flat, ...pool };
}

export class PostgresOperationStore implements OperationStore {
  private readonly pool: Pool;
  private closed = false;

  constructor(options: PostgresOperationStoreOptions) {
    this.pool = new Pool(mergePoolConfig(options));
  }

  async migrate(): Promise<void> {
    this.assertOpen();
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
    } catch (cause) {
      throw new PostgresOperationStoreError("store_connect_failed", "cannot acquire connection", cause);
    }
    try {
      await client.query("BEGIN");
      try {
        await client.query(OPERATION_STORE_MIGRATION_SQL);
        const meta = await client.query<{ value: string }>(
          "SELECT value FROM prism_store_meta WHERE key = 'operation_schema_version' FOR UPDATE",
        );
        if (meta.rowCount === 0) {
          await client.query("INSERT INTO prism_store_meta (key, value) VALUES ('operation_schema_version', $1)", [
            String(OPERATION_STORE_SCHEMA_VERSION),
          ]);
        } else if (Number.parseInt(meta.rows[0].value, 10) > OPERATION_STORE_SCHEMA_VERSION) {
          throw new PostgresOperationStoreError(
            "store_migrate_failed",
            `database operation_schema_version ${meta.rows[0].value} is newer than supported ${OPERATION_STORE_SCHEMA_VERSION}`,
          );
        } else if (Number.parseInt(meta.rows[0].value, 10) < OPERATION_STORE_SCHEMA_VERSION) {
          await client.query("UPDATE prism_store_meta SET value = $1 WHERE key = 'operation_schema_version'", [
            String(OPERATION_STORE_SCHEMA_VERSION),
          ]);
        }
        await client.query("COMMIT");
      } catch (inner) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw inner;
      }
    } catch (cause) {
      if (cause instanceof PostgresOperationStoreError) throw cause;
      throw new PostgresOperationStoreError("store_migrate_failed", "migration failed", cause);
    } finally {
      client.release();
    }
  }

  static async create(options: PostgresOperationStoreOptions): Promise<PostgresOperationStore> {
    const store = new PostgresOperationStore(options);
    await store.migrate();
    return store;
  }

  private assertOpen(): void {
    if (this.closed) throw new PostgresOperationStoreError("store_connect_failed", "store is closed");
  }

  async create(input: CreateOperationRecordInput): Promise<PersistedOperation> {
    this.assertOpen();
    validateCreateInput(input);
    const base = createOperation({ id: input.id, kind: input.kind, now: input.now, correlationId: input.correlationId ?? null });
    const record: PersistedOperation = {
      ...base,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.requestFingerprint,
      reconciliationWatermark: null,
      reconciliationMetadata: null,
    };
    try {
      await this.pool.query(
        `INSERT INTO prism_operations (${COLUMNS.join(", ")}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          record.id,
          record.kind,
          record.state,
          record.version,
          record.idempotencyKey,
          record.requestFingerprint,
          record.txHash,
          record.errorCode,
          record.errorDetail,
          record.attempts,
          record.submissionAttempted,
          record.correlationId,
          record.createdAt,
          record.updatedAt,
          record.authoritativeSource,
          record.reconciliationWatermark,
          record.reconciliationMetadata === null ? null : JSON.stringify(record.reconciliationMetadata),
        ],
      );
      return record;
    } catch (cause) {
      if (!isUniqueViolation(cause)) {
        if (isCheckViolation(cause)) throw new PostgresOperationStoreError("invalid_record", "create rejected by schema constraints", cause);
        throw new PostgresOperationStoreError("store_write_failed", "create failed", cause);
      }
      // Unique violation on either id or idempotency_key — resolve via read + fingerprint comparison.
      // Parameterized lookups only.
      let existingById: PersistedOperation | undefined;
      let existingByKey: PersistedOperation | undefined;
      try {
        const byId = await this.pool.query<Row>(`SELECT ${COLUMNS.join(", ")} FROM prism_operations WHERE id = $1`, [input.id]);
        if (byId.rowCount && byId.rowCount > 0) existingById = rowToRecord(byId.rows[0]);
      } catch {}
      try {
        const byKey = await this.pool.query<Row>(
          `SELECT ${COLUMNS.join(", ")} FROM prism_operations WHERE idempotency_key = $1`,
          [input.idempotencyKey],
        );
        if (byKey.rowCount && byKey.rowCount > 0) existingByKey = rowToRecord(byKey.rows[0]);
      } catch {}
      // Match the memory adapter's explicit precedence: an existing
      // idempotency key defines the request identity, even when the caller
      // generated a different operation id. If no key row exists, a primary
      // operation-id collision is a distinct resource conflict and must not be
      // mistaken for a benign retry.
      if (existingByKey) {
        if (existingByKey.requestFingerprint !== input.requestFingerprint) {
          throw new OperationError(
            OPERATION_ERROR_CODE.STALE_STATE_CONFLICT,
            `idempotency_key_conflict:key_${input.idempotencyKey}_fingerprint_mismatch`,
          );
        }
        return existingByKey;
      }
      if (existingById) {
        if (existingById.idempotencyKey !== input.idempotencyKey) {
          throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "duplicate_operation_id");
        }
        if (existingById.requestFingerprint !== input.requestFingerprint) {
          throw new OperationError(
            OPERATION_ERROR_CODE.STALE_STATE_CONFLICT,
            `idempotency_key_conflict:key_${input.idempotencyKey}_fingerprint_mismatch`,
          );
        }
        return existingById;
      }
      // If we cannot resolve the duplicate, surface as stale conflict with domain code.
      throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "duplicate_operation_id");
    }
  }

  async getById(id: string): Promise<PersistedOperation | undefined> {
    this.assertOpen();
    let result;
    try {
      result = await this.pool.query<Row>(`SELECT ${COLUMNS.join(", ")} FROM prism_operations WHERE id = $1`, [id]);
    } catch (cause) {
      throw new PostgresOperationStoreError("store_read_failed", "getById failed", cause);
    }
    return result.rowCount && result.rowCount > 0 ? rowToRecord(result.rows[0]) : undefined;
  }

  async getByIdempotencyKey(key: string): Promise<PersistedOperation | undefined> {
    this.assertOpen();
    let result;
    try {
      result = await this.pool.query<Row>(`SELECT ${COLUMNS.join(", ")} FROM prism_operations WHERE idempotency_key = $1`, [key]);
    } catch (cause) {
      throw new PostgresOperationStoreError("store_read_failed", "getByIdempotencyKey failed", cause);
    }
    return result.rowCount && result.rowCount > 0 ? rowToRecord(result.rows[0]) : undefined;
  }

  async transition(id: string, input: TransitionOperationInput): Promise<PersistedOperation> {
    this.assertOpen();
    if (!Number.isFinite(input.now)) throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "invalid_now_timestamp");
    // Fetch current for domain validation and to compute next values deterministically.
    let current: PersistedOperation | undefined;
    try {
      const res = await this.pool.query<Row>(`SELECT ${COLUMNS.join(", ")} FROM prism_operations WHERE id = $1`, [id]);
      if (!res.rowCount || res.rowCount === 0) throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "unknown_operation");
      current = rowToRecord(res.rows[0]);
    } catch (cause) {
      if (cause instanceof OperationError) throw cause;
      throw new PostgresOperationStoreError("store_read_failed", "transition lookup failed", cause);
    }
    // Delegate invariant checks to pure domain function. This covers:
    // - expectedVersion CAS mismatch (throws stale_version)
    // - submitted != completed guard
    // - illegal skips, txHash guards, errorCode guards, idempotent same-state validation.
    let nextOp: PersistedOperation;
    let idempotent = false;
    try {
      const result = domainTransition(current, {
        to: input.to,
        now: input.now,
        expectedVersion: input.expectedVersion,
        txHash: input.txHash !== undefined ? input.txHash : undefined,
        errorCode: input.errorCode !== undefined ? input.errorCode : undefined,
        errorDetail: input.errorDetail !== undefined ? input.errorDetail : undefined,
        submissionAttempted: input.submissionAttempted !== undefined ? input.submissionAttempted : undefined,
      });
      idempotent = result.idempotent;
      if (idempotent) {
        // Idempotent same-state: handle reconciliation watermark/metadata update via CAS if supplied.
        if (input.reconciliationWatermark !== undefined || input.reconciliationMetadata !== undefined) {
          const watermark = input.reconciliationWatermark !== undefined ? input.reconciliationWatermark : current.reconciliationWatermark;
          const metadata = input.reconciliationMetadata !== undefined ? input.reconciliationMetadata : current.reconciliationMetadata;
          // Only perform a CAS write if the watermark/metadata actually changes; otherwise return as-is.
          const watermarkChanged = watermark !== current.reconciliationWatermark;
          const metadataChanged = JSON.stringify(metadata) !== JSON.stringify(current.reconciliationMetadata);
          if (watermarkChanged || metadataChanged) {
            try {
              const upd = await this.pool.query(
                `UPDATE prism_operations SET reconciliation_watermark = $2, reconciliation_metadata = $3, updated_at = $4, version = version + 1 WHERE id = $1 AND version = $5`,
                [
                  id,
                  watermark,
                  metadata === null ? null : JSON.stringify(metadata),
                  input.now,
                  input.expectedVersion,
                ],
              );
              if (upd.rowCount !== 1) throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, `stale_version:expected_${input.expectedVersion}_got_${current.version}`);
              const refreshed = await this.pool.query<Row>(`SELECT ${COLUMNS.join(", ")} FROM prism_operations WHERE id = $1`, [id]);
              return rowToRecord(refreshed.rows[0]);
            } catch (cause) {
              if (cause instanceof OperationError) throw cause;
              throw new PostgresOperationStoreError("store_write_failed", "idempotent watermark update failed", cause);
            }
          }
        }
        return current;
      }
      // Non-idempotent: build persisted next record preserving idempotency fields and applying reconciliation fields.
      nextOp = {
        ...result.operation,
        idempotencyKey: current.idempotencyKey,
        requestFingerprint: current.requestFingerprint,
        reconciliationWatermark:
          input.reconciliationWatermark !== undefined ? input.reconciliationWatermark : current.reconciliationWatermark,
        reconciliationMetadata:
          input.reconciliationMetadata !== undefined ? input.reconciliationMetadata : current.reconciliationMetadata,
        correlationId: input.correlationId !== undefined ? input.correlationId : result.operation.correlationId,
      };
    } catch (cause) {
      if (cause instanceof OperationError) throw cause;
      throw cause;
    }

    // Atomic CAS update: succeeds only when current version still equals expectedVersion.
    try {
      const result = await this.pool.query(
        `UPDATE prism_operations SET kind = $2, state = $3, version = $4, tx_hash = $5, error_code = $6, error_detail = $7, attempts = $8, submission_attempted = $9, correlation_id = $10, updated_at = $11, authoritative_source = $12, reconciliation_watermark = $13, reconciliation_metadata = $14 WHERE id = $1 AND version = $15`,
        [
          nextOp.id,
          nextOp.kind,
          nextOp.state,
          nextOp.version,
          nextOp.txHash,
          nextOp.errorCode,
          nextOp.errorDetail,
          nextOp.attempts,
          nextOp.submissionAttempted,
          nextOp.correlationId,
          nextOp.updatedAt,
          nextOp.authoritativeSource,
          nextOp.reconciliationWatermark,
          nextOp.reconciliationMetadata === null ? null : JSON.stringify(nextOp.reconciliationMetadata),
          input.expectedVersion,
        ],
      );
      if (result.rowCount !== 1) {
        throw new OperationError(
          OPERATION_ERROR_CODE.STALE_STATE_CONFLICT,
          `stale_version:expected_${input.expectedVersion}_got_${current.version}`,
        );
      }
    } catch (cause) {
      if (cause instanceof OperationError) throw cause;
      if (isCheckViolation(cause)) throw new PostgresOperationStoreError("invalid_record", "transition rejected by schema constraints", cause);
      throw new PostgresOperationStoreError("store_write_failed", "transition failed", cause);
    }
    // Return fresh read
    const refreshed = await this.pool.query<Row>(`SELECT ${COLUMNS.join(", ")} FROM prism_operations WHERE id = $1`, [id]);
    if (!refreshed.rowCount || refreshed.rowCount === 0) throw new PostgresOperationStoreError("store_read_failed", "transition post-read missing");
    return rowToRecord(refreshed.rows[0]);
  }

  async listNonTerminal(limit = 100): Promise<readonly PersistedOperation[]> {
    this.assertOpen();
    const bounded = Math.max(1, Math.min(1000, Math.floor(limit)));
    let result;
    try {
      const placeholders = NON_TERMINAL_STATES.map((_, i) => `$${i + 1}`).join(", ");
      result = await this.pool.query<Row>(
        `SELECT ${COLUMNS.join(", ")} FROM prism_operations WHERE state IN (${placeholders}) ORDER BY updated_at ASC, id ASC LIMIT $${NON_TERMINAL_STATES.length + 1}`,
        [...NON_TERMINAL_STATES, bounded],
      );
    } catch (cause) {
      throw new PostgresOperationStoreError("store_read_failed", "listNonTerminal failed", cause);
    }
    return result.rows.map(rowToRecord);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.pool.end();
    } catch (cause) {
      throw new PostgresOperationStoreError("store_connect_failed", "close failed", cause);
    }
  }
}

function validateCreateInput(input: CreateOperationRecordInput): void {
  if (!input.id || input.id.trim().length === 0) throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "missing_operation_id");
  if (!input.idempotencyKey || input.idempotencyKey.trim().length === 0)
    throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "missing_idempotency_key");
  if (!input.requestFingerprint || input.requestFingerprint.trim().length === 0)
    throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "missing_request_fingerprint");
  if (!Number.isFinite(input.now)) throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "invalid_now_timestamp");
}

function isUniqueViolation(cause: unknown): boolean {
  return (cause as { code?: string } | null)?.code === "23505";
}
function isCheckViolation(cause: unknown): boolean {
  return (cause as { code?: string } | null)?.code === "23514";
}
