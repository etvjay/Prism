// Durable PostgreSQL binding/disclosure store.
//
// The database is the production persistence target for this boundary. The
// schema makes PUBLIC and PRIVATE representations mutually exclusive:
// PUBLIC -> endpoint_json + no protected envelope
// PRIVATE -> protected_endpoint_json + no endpoint_json
//
// This adapter does not encrypt, decrypt, generate keys, recover keys, or
// publish chain state. Private writes are admitted only by the service after a
// typed key-management port has supplied proof; the store persists only the
// resulting opaque envelope.

import { Pool, type PoolClient, type PoolConfig } from "pg";
import {
  BINDING_DISCLOSURE_SCHEMA_VERSION,
  BindingDisclosureError,
  assertProtectedEndpoint,
  assertStoredBinding,
  type BindingCompareAndSetInput,
  type BindingDisclosureStore,
  type BindingId,
  type PrismId,
  type PublicStoredBinding,
  type StoredBinding,
} from "../domain/binding-disclosure";

export const BINDING_DISCLOSURE_STORE_SCHEMA_VERSION = BINDING_DISCLOSURE_SCHEMA_VERSION;

export const BINDING_DISCLOSURE_STORE_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS prism_binding_disclosure_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prism_binding_disclosures (
  schema_version INTEGER NOT NULL,
  binding_id TEXT PRIMARY KEY,
  prism_id TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('PUBLIC','PRIVATE')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  version INTEGER NOT NULL CHECK (version >= 0),
  endpoint_json TEXT,
  protected_endpoint_json TEXT,
  historical_public BOOLEAN NOT NULL,
  publicly_exposed_at BIGINT,
  hidden_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  CONSTRAINT prism_binding_disclosures_endpoint_boundary CHECK (
    (visibility = 'PUBLIC'
      AND endpoint_json IS NOT NULL
      AND protected_endpoint_json IS NULL
      AND historical_public = TRUE
      AND publicly_exposed_at IS NOT NULL)
    OR
    (visibility = 'PRIVATE'
      AND endpoint_json IS NULL
      AND protected_endpoint_json IS NOT NULL)
  ),
  CONSTRAINT prism_binding_disclosures_history_timestamp CHECK (
    (historical_public = TRUE AND publicly_exposed_at IS NOT NULL)
    OR
    (historical_public = FALSE AND publicly_exposed_at IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_prism_binding_disclosures_identity
  ON prism_binding_disclosures (prism_id, created_at, binding_id);
CREATE INDEX IF NOT EXISTS idx_prism_binding_disclosures_public_active
  ON prism_binding_disclosures (prism_id, created_at, binding_id)
  WHERE visibility = 'PUBLIC' AND status = 'ACTIVE';
`;

export type PostgresBindingDisclosureStoreErrorCode =
  | "store_connect_failed"
  | "store_migrate_failed"
  | "duplicate_binding_id"
  | "store_write_failed"
  | "store_read_failed"
  | "invalid_record";

export class PostgresBindingDisclosureStoreError extends Error {
  readonly code: PostgresBindingDisclosureStoreErrorCode;

  constructor(code: PostgresBindingDisclosureStoreErrorCode, message: string, cause?: unknown) {
    super(`[${code}] ${message}${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "PostgresBindingDisclosureStoreError";
    this.code = code;
  }
}

export interface PostgresBindingDisclosureStoreOptions extends Pick<PoolConfig, keyof PoolConfig> {
  pool?: PoolConfig;
  /** Unit/integration harnesses may skip the eager migration after a prior migration. */
  skipMigration?: boolean;
}

function mergePoolConfig(options: PostgresBindingDisclosureStoreOptions): PoolConfig {
  const { pool, skipMigration: _skipMigration, ...flat } = options;
  return { ...flat, ...pool };
}

const COLUMNS = [
  "schema_version",
  "binding_id",
  "prism_id",
  "visibility",
  "status",
  "version",
  "endpoint_json",
  "protected_endpoint_json",
  "historical_public",
  "publicly_exposed_at",
  "hidden_at",
  "created_at",
  "updated_at",
] as const;

interface BindingRow {
  schema_version: number | string;
  binding_id: string;
  prism_id: string;
  visibility: string;
  status: string;
  version: number | string;
  endpoint_json: string | null;
  protected_endpoint_json: string | null;
  historical_public: boolean | string;
  publicly_exposed_at: number | string | null;
  hidden_at: number | string | null;
  created_at: number | string;
  updated_at: number | string;
}

function toInt(value: number | string, field: string): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) throw new Error(`invalid_${field}`);
  return parsed;
}

function nullableInt(value: number | string | null, field: string): number | null {
  return value === null ? null : toInt(value, field);
}

function toBoolean(value: boolean | string): boolean {
  return value === true || value === "true";
}

function parseJson(value: string | null, field: string): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`corrupt_${field}`);
  }
}

function parseProtectedEndpoint(value: string | null): NonNullable<Extract<StoredBinding, { visibility: "PRIVATE" }>["protectedEndpoint"]> {
  const parsed = parseJson(value, "protected_endpoint_json");
  if (!parsed || typeof parsed !== "object") throw new Error("corrupt_protected_endpoint_json");
  const candidate = parsed as Record<string, unknown>;
  const forbiddenKeys = ["endpoint", "address", "plaintext", "plainText", "privateKey", "secret"];
  if (forbiddenKeys.some((key) => key in candidate)) throw new Error("private_endpoint_plaintext_field_present");
  const protectedEndpoint = candidate as unknown as NonNullable<Extract<StoredBinding, { visibility: "PRIVATE" }>["protectedEndpoint"]>;
  assertProtectedEndpoint(protectedEndpoint);
  return protectedEndpoint;
}

function rowToRecord(row: BindingRow): StoredBinding {
  const base = {
    schemaVersion: toInt(row.schema_version, "schema_version"),
    bindingId: row.binding_id,
    prismId: row.prism_id as PrismId,
    status: row.status as "ACTIVE" | "REVOKED",
    version: toInt(row.version, "version"),
    historicalPublic: toBoolean(row.historical_public),
    publiclyExposedAt: nullableInt(row.publicly_exposed_at, "publicly_exposed_at"),
    hiddenAt: nullableInt(row.hidden_at, "hidden_at"),
    createdAt: toInt(row.created_at, "created_at"),
    updatedAt: toInt(row.updated_at, "updated_at"),
  };

  let record: StoredBinding;
  if (row.visibility === "PUBLIC") {
    const endpoint = parseJson(row.endpoint_json, "endpoint_json");
    if (!endpoint || typeof endpoint !== "object") throw new Error("corrupt_endpoint_json");
    if (row.protected_endpoint_json !== null) throw new Error("public_protected_endpoint_present");
    record = { ...base, visibility: "PUBLIC", endpoint: endpoint as Extract<StoredBinding, { visibility: "PUBLIC" }>["endpoint"], protectedEndpoint: null };
  } else if (row.visibility === "PRIVATE") {
    if (row.endpoint_json !== null) throw new Error("private_endpoint_json_present");
    record = { ...base, visibility: "PRIVATE", endpoint: null, protectedEndpoint: parseProtectedEndpoint(row.protected_endpoint_json) };
  } else {
    throw new Error("invalid_visibility");
  }

  try {
    assertStoredBinding(record);
  } catch (cause) {
    throw new Error(cause instanceof Error ? cause.message : "invalid_binding_row");
  }
  return record;
}

function toEndpointJson(record: StoredBinding): string | null {
  return record.visibility === "PUBLIC" ? JSON.stringify(record.endpoint) : null;
}

function toProtectedEndpointJson(record: StoredBinding): string | null {
  return record.visibility === "PRIVATE" ? JSON.stringify(record.protectedEndpoint) : null;
}

function validateRecord(record: StoredBinding): void {
  try {
    assertStoredBinding(record);
  } catch (cause) {
    if (cause instanceof BindingDisclosureError) {
      throw new PostgresBindingDisclosureStoreError("invalid_record", cause.detail ?? "invalid_binding");
    }
    throw new PostgresBindingDisclosureStoreError("invalid_record", "invalid_binding");
  }
}

export class PostgresBindingDisclosureStore implements BindingDisclosureStore {
  private readonly pool: Pool;
  private closed = false;

  constructor(options: PostgresBindingDisclosureStoreOptions) {
    this.pool = new Pool(mergePoolConfig(options));
  }

  async migrate(): Promise<void> {
    this.assertOpen();
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch (cause) {
      throw new PostgresBindingDisclosureStoreError("store_connect_failed", "cannot acquire connection", cause);
    }

    try {
      await client.query("BEGIN");
      try {
        await client.query(BINDING_DISCLOSURE_STORE_MIGRATION_SQL);
        const meta = await client.query<{ value: string }>(
          "SELECT value FROM prism_binding_disclosure_meta WHERE key = 'schema_version' FOR UPDATE",
        );
        if (meta.rowCount === 0) {
          await client.query(
            "INSERT INTO prism_binding_disclosure_meta (key, value) VALUES ('schema_version', $1)",
            [String(BINDING_DISCLOSURE_STORE_SCHEMA_VERSION)],
          );
        } else {
          const current = Number.parseInt(meta.rows[0].value, 10);
          if (!Number.isSafeInteger(current)) throw new PostgresBindingDisclosureStoreError("store_migrate_failed", "invalid_schema_version");
          if (current > BINDING_DISCLOSURE_STORE_SCHEMA_VERSION) {
            throw new PostgresBindingDisclosureStoreError(
              "store_migrate_failed",
              `database schema_version ${current} newer than supported ${BINDING_DISCLOSURE_STORE_SCHEMA_VERSION}`,
            );
          }
          if (current < BINDING_DISCLOSURE_STORE_SCHEMA_VERSION) {
            await client.query(
              "UPDATE prism_binding_disclosure_meta SET value = $1 WHERE key = 'schema_version'",
              [String(BINDING_DISCLOSURE_STORE_SCHEMA_VERSION)],
            );
          }
        }
        await client.query("COMMIT");
      } catch (cause) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw cause;
      }
    } catch (cause) {
      if (cause instanceof PostgresBindingDisclosureStoreError) throw cause;
      throw new PostgresBindingDisclosureStoreError("store_migrate_failed", "migration failed", cause);
    } finally {
      client.release();
    }
  }

  static async create(options: PostgresBindingDisclosureStoreOptions): Promise<PostgresBindingDisclosureStore> {
    const store = new PostgresBindingDisclosureStore(options);
    if (!options.skipMigration) await store.migrate();
    return store;
  }

  async put(record: StoredBinding): Promise<void> {
    this.assertOpen();
    validateRecord(record);
    try {
      await this.pool.query(
        `INSERT INTO prism_binding_disclosures (${COLUMNS.join(", ")}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          record.schemaVersion,
          record.bindingId,
          record.prismId,
          record.visibility,
          record.status,
          record.version,
          toEndpointJson(record),
          toProtectedEndpointJson(record),
          record.historicalPublic,
          record.publiclyExposedAt,
          record.hiddenAt,
          record.createdAt,
          record.updatedAt,
        ],
      );
    } catch (cause) {
      if (isUniqueViolation(cause, "prism_binding_disclosures_pkey")) {
        throw new PostgresBindingDisclosureStoreError("duplicate_binding_id", `duplicate:${record.bindingId}`, cause);
      }
      if (isCheckViolation(cause)) throw new PostgresBindingDisclosureStoreError("invalid_record", "put rejected by schema constraints", cause);
      throw new PostgresBindingDisclosureStoreError("store_write_failed", "put failed", cause);
    }
  }

  async getById(bindingId: BindingId): Promise<StoredBinding | undefined> {
    this.assertOpen();
    try {
      const result = await this.pool.query<BindingRow>(
        `SELECT ${COLUMNS.join(", ")} FROM prism_binding_disclosures WHERE binding_id = $1`,
        [bindingId],
      );
      if (!result.rowCount || result.rowCount === 0) return undefined;
      try {
        return rowToRecord(result.rows[0]);
      } catch (cause) {
        throw new PostgresBindingDisclosureStoreError("store_read_failed", `corrupt binding row ${bindingId}`, cause);
      }
    } catch (cause) {
      if (cause instanceof PostgresBindingDisclosureStoreError) throw cause;
      throw new PostgresBindingDisclosureStoreError("store_read_failed", "getById failed", cause);
    }
  }

  async listForIdentity(prismId: PrismId): Promise<readonly StoredBinding[]> {
    this.assertOpen();
    try {
      const result = await this.pool.query<BindingRow>(
        `SELECT ${COLUMNS.join(", ")} FROM prism_binding_disclosures WHERE prism_id = $1 ORDER BY created_at ASC, binding_id ASC`,
        [prismId],
      );
      try {
        return result.rows.map(rowToRecord);
      } catch (cause) {
        throw new PostgresBindingDisclosureStoreError("store_read_failed", "corrupt binding row in identity list", cause);
      }
    } catch (cause) {
      if (cause instanceof PostgresBindingDisclosureStoreError) throw cause;
      throw new PostgresBindingDisclosureStoreError("store_read_failed", "listForIdentity failed", cause);
    }
  }

  async listPublicForIdentity(prismId: PrismId): Promise<readonly PublicStoredBinding[]> {
    this.assertOpen();
    try {
      const result = await this.pool.query<BindingRow>(
        `SELECT ${COLUMNS.join(", ")} FROM prism_binding_disclosures WHERE prism_id = $1 AND visibility = 'PUBLIC' AND status = 'ACTIVE' ORDER BY created_at ASC, binding_id ASC`,
        [prismId],
      );
      try {
        return result.rows.map((row) => {
          const record = rowToRecord(row);
          if (record.visibility !== "PUBLIC" || record.status !== "ACTIVE") throw new Error("public_query_returned_non_public_row");
          return record;
        });
      } catch (cause) {
        throw new PostgresBindingDisclosureStoreError("store_read_failed", "corrupt public binding row", cause);
      }
    } catch (cause) {
      if (cause instanceof PostgresBindingDisclosureStoreError) throw cause;
      throw new PostgresBindingDisclosureStoreError("store_read_failed", "listPublicForIdentity failed", cause);
    }
  }

  async compareAndSet(input: BindingCompareAndSetInput): Promise<boolean> {
    this.assertOpen();
    validateRecord(input.next);
    if (input.next.bindingId !== input.bindingId || input.next.prismId !== input.prismId || input.next.version !== input.expectedVersion + 1) return false;

    try {
      const result = await this.pool.query(
        `UPDATE prism_binding_disclosures
         SET visibility = $2,
             status = $3,
             version = $4,
             endpoint_json = $5,
             protected_endpoint_json = $6,
             historical_public = $7,
             publicly_exposed_at = $8,
             hidden_at = $9,
             updated_at = $10
         WHERE binding_id = $1
           AND prism_id = $11
           AND version = $12
           AND visibility = $13
           AND status = $14
           AND (historical_public = FALSE OR $7 = TRUE)`,
        [
          input.bindingId,
          input.next.visibility,
          input.next.status,
          input.next.version,
          toEndpointJson(input.next),
          toProtectedEndpointJson(input.next),
          input.next.historicalPublic,
          input.next.publiclyExposedAt,
          input.next.hiddenAt,
          input.next.updatedAt,
          input.prismId,
          input.expectedVersion,
          input.expectedVisibility,
          input.expectedStatus,
        ],
      );
      return result.rowCount === 1;
    } catch (cause) {
      if (isCheckViolation(cause)) throw new PostgresBindingDisclosureStoreError("invalid_record", "compareAndSet rejected by schema constraints", cause);
      throw new PostgresBindingDisclosureStoreError("store_write_failed", "compareAndSet failed", cause);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.pool.end();
    } catch (cause) {
      throw new PostgresBindingDisclosureStoreError("store_connect_failed", "close failed", cause);
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new PostgresBindingDisclosureStoreError("store_connect_failed", "store is closed");
  }
}

function isUniqueViolation(cause: unknown, constraint?: string): boolean {
  const error = cause as { code?: string; constraint?: string } | null;
  return error?.code === "23505" && (constraint === undefined || error.constraint === constraint);
}

function isCheckViolation(cause: unknown): boolean {
  return (cause as { code?: string } | null)?.code === "23514";
}
