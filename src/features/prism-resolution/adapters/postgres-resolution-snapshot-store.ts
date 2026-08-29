// PostgreSQL durable ResolutionSnapshot adapter.
//
// This store is a comparison-baseline store, not a source of canonical Prism
// identity truth. All values are parameterized and writes use create-only or
// optimistic-versioned updates so a concurrent continuity decision cannot
// silently overwrite a newer observation.

import { Pool, type PoolClient, type PoolConfig } from "pg";
import {
  cloneResolutionSnapshot,
  parseResolutionSnapshotKey,
  ResolutionSnapshotStoreError,
  validateKey,
  validateResolutionSnapshot,
  type ResolutionSnapshot,
  type ResolutionSnapshotLookupKey,
  type ResolutionSnapshotStore,
} from "../domain/snapshot";

export const RESOLUTION_SNAPSHOT_SCHEMA_VERSION = 1;

export const RESOLUTION_SNAPSHOT_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS prism_resolution_snapshots_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prism_resolution_snapshots (
  snapshot_key TEXT PRIMARY KEY,
  prism_id TEXT NOT NULL,
  venue TEXT NOT NULL,
  purpose TEXT NOT NULL,
  alias_provider TEXT,
  alias_value TEXT,
  external_subject TEXT,
  destination_chain TEXT,
  destination_address TEXT,
  binding_status TEXT NOT NULL CHECK (binding_status IN ('ACTIVE','REVOKED','NO_ACTIVE_DESTINATION','UNKNOWN')),
  visibility TEXT NOT NULL CHECK (visibility IN ('PUBLIC','PRIVATE','SELECTIVE','UNKNOWN')),
  watermark BIGINT,
  observed_at BIGINT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  UNIQUE (prism_id, venue, purpose),
  CHECK ((alias_provider IS NULL AND alias_value IS NULL) OR (alias_provider IS NOT NULL AND alias_value IS NOT NULL)),
  CHECK ((destination_chain IS NULL AND destination_address IS NULL) OR (destination_chain IS NOT NULL AND destination_address IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_prism_resolution_snapshots_observed_at
  ON prism_resolution_snapshots(observed_at);
`;

export interface PostgresResolutionSnapshotStoreOptions extends Pick<PoolConfig, keyof PoolConfig> {
  pool?: PoolConfig;
}

type SnapshotRow = {
  snapshot_key: string;
  prism_id: string;
  venue: string;
  purpose: string;
  alias_provider: string | null;
  alias_value: string | null;
  external_subject: string | null;
  destination_chain: string | null;
  destination_address: string | null;
  binding_status: string;
  visibility: string;
  watermark: number | string | null;
  observed_at: number | string;
  version: number | string;
};

function mergePoolConfig(options: PostgresResolutionSnapshotStoreOptions): PoolConfig {
  const { pool, ...flat } = options;
  return { ...flat, ...(pool ?? {}) };
}

function integer(value: number | string, field: string): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) throw new Error(`invalid_${field}`);
  return parsed;
}

function nullableInteger(value: number | string | null, field: string): number | null {
  return value === null ? null : integer(value, field);
}

function rowToSnapshot(row: SnapshotRow): ResolutionSnapshot {
  if ((row.alias_provider === null) !== (row.alias_value === null)) {
    throw new ResolutionSnapshotStoreError("snapshot_store_invalid", "corrupt_snapshot_alias_pair");
  }
  if ((row.destination_chain === null) !== (row.destination_address === null)) {
    throw new ResolutionSnapshotStoreError("snapshot_store_invalid", "corrupt_snapshot_destination_pair");
  }
  const alias = row.alias_provider === null ? null : { provider: row.alias_provider, value: row.alias_value as string };
  const destination = row.destination_chain === null ? null : { chain: row.destination_chain, address: row.destination_address as string };
  const snapshot: ResolutionSnapshot = {
    key: row.snapshot_key,
    prismId: row.prism_id,
    venue: row.venue,
    purpose: row.purpose,
    alias,
    externalSubject: row.external_subject,
    destination,
    bindingStatus: row.binding_status as ResolutionSnapshot["bindingStatus"],
    visibility: row.visibility as ResolutionSnapshot["visibility"],
    watermark: nullableInteger(row.watermark, "watermark"),
    observedAt: integer(row.observed_at, "observed_at"),
    version: integer(row.version, "version"),
  };
  try {
    validateResolutionSnapshot(snapshot);
  } catch (cause) {
    throw new ResolutionSnapshotStoreError("snapshot_store_invalid", cause instanceof Error ? cause.message : "corrupt_snapshot");
  }
  return snapshot;
}

function valuesFor(snapshot: ResolutionSnapshot): unknown[] {
  return [
    snapshot.key,
    snapshot.prismId,
    snapshot.venue,
    snapshot.purpose,
    snapshot.alias?.provider ?? null,
    snapshot.alias?.value ?? null,
    snapshot.externalSubject,
    snapshot.destination?.chain ?? null,
    snapshot.destination?.address ?? null,
    snapshot.bindingStatus,
    snapshot.visibility,
    snapshot.watermark,
    snapshot.observedAt,
    snapshot.version,
  ];
}

export class PostgresResolutionSnapshotStore implements ResolutionSnapshotStore {
  private readonly pool: Pool;
  private closed = false;

  constructor(options: PostgresResolutionSnapshotStoreOptions) {
    this.pool = new Pool(mergePoolConfig(options));
  }

  async migrate(): Promise<void> {
    this.assertOpen();
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch (cause) {
      throw new ResolutionSnapshotStoreError("snapshot_store_unavailable", "cannot acquire snapshot store connection", cause);
    }
    try {
      await client.query("BEGIN");
      try {
        await client.query(RESOLUTION_SNAPSHOT_MIGRATION_SQL);
        const meta = await client.query<{ value: string }>(
          "SELECT value FROM prism_resolution_snapshots_meta WHERE key = 'schema_version' FOR UPDATE",
        );
        if (!meta.rowCount || meta.rowCount === 0) {
          await client.query(
            "INSERT INTO prism_resolution_snapshots_meta (key, value) VALUES ('schema_version', $1)",
            [String(RESOLUTION_SNAPSHOT_SCHEMA_VERSION)],
          );
        } else if (Number.parseInt(meta.rows[0].value, 10) > RESOLUTION_SNAPSHOT_SCHEMA_VERSION) {
          throw new ResolutionSnapshotStoreError("snapshot_store_unavailable", "snapshot schema is newer than this adapter");
        } else if (Number.parseInt(meta.rows[0].value, 10) < RESOLUTION_SNAPSHOT_SCHEMA_VERSION) {
          await client.query(
            "UPDATE prism_resolution_snapshots_meta SET value = $1 WHERE key = 'schema_version'",
            [String(RESOLUTION_SNAPSHOT_SCHEMA_VERSION)],
          );
        }
        await client.query("COMMIT");
      } catch (cause) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw cause;
      }
    } catch (cause) {
      if (cause instanceof ResolutionSnapshotStoreError) throw cause;
      throw new ResolutionSnapshotStoreError("snapshot_store_unavailable", "snapshot migration failed", cause);
    } finally {
      client.release();
    }
  }

  static async create(options: PostgresResolutionSnapshotStoreOptions): Promise<PostgresResolutionSnapshotStore> {
    const store = new PostgresResolutionSnapshotStore(options);
    await store.migrate();
    return store;
  }

  async get(input: ResolutionSnapshotLookupKey): Promise<ResolutionSnapshot | null> {
    this.assertOpen();
    try {
      const key = parseResolutionSnapshotKey(input);
      validateKey(key);
      const result = await this.pool.query<SnapshotRow>(
        "SELECT snapshot_key, prism_id, venue, purpose, alias_provider, alias_value, external_subject, destination_chain, destination_address, binding_status, visibility, watermark, observed_at, version FROM prism_resolution_snapshots WHERE prism_id = $1 AND venue = $2 AND purpose = $3",
        [key.prismId, key.venue, key.purpose],
      );
      if (!result.rowCount || result.rowCount === 0) return null;
      return cloneResolutionSnapshot(rowToSnapshot(result.rows[0]));
    } catch (cause) {
      if (cause instanceof ResolutionSnapshotStoreError) throw cause;
      throw new ResolutionSnapshotStoreError("snapshot_store_unavailable", "snapshot read failed", cause);
    }
  }

  async save(snapshot: ResolutionSnapshot, expectedVersion: number | null): Promise<ResolutionSnapshot> {
    this.assertOpen();
    try {
      validateResolutionSnapshot(snapshot);
    } catch (cause) {
      throw new ResolutionSnapshotStoreError("snapshot_store_invalid", cause instanceof Error ? cause.message : "invalid_snapshot");
    }
    if (expectedVersion !== null && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)) {
      throw new ResolutionSnapshotStoreError("snapshot_store_invalid", "expected_version_invalid");
    }
    if (expectedVersion === null && snapshot.version !== 1) {
      throw new ResolutionSnapshotStoreError("snapshot_version_conflict", "initial_snapshot_version_must_be_1");
    }
    if (expectedVersion !== null && snapshot.version !== expectedVersion + 1) {
      throw new ResolutionSnapshotStoreError("snapshot_version_conflict", "snapshot_version_mismatch");
    }
    try {
      if (expectedVersion === null) {
        const result = await this.pool.query(
          "INSERT INTO prism_resolution_snapshots (snapshot_key, prism_id, venue, purpose, alias_provider, alias_value, external_subject, destination_chain, destination_address, binding_status, visibility, watermark, observed_at, version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
          valuesFor(snapshot),
        );
        if (result.rowCount !== 1) throw new ResolutionSnapshotStoreError("snapshot_store_unavailable", "snapshot insert did not write exactly one row");
      } else {
        const values = valuesFor(snapshot);
        const result = await this.pool.query(
          "UPDATE prism_resolution_snapshots SET snapshot_key = $1, prism_id = $2, venue = $3, purpose = $4, alias_provider = $5, alias_value = $6, external_subject = $7, destination_chain = $8, destination_address = $9, binding_status = $10, visibility = $11, watermark = $12, observed_at = $13, version = $14 WHERE prism_id = $2 AND venue = $3 AND purpose = $4 AND version = $15",
          [...values, expectedVersion],
        );
        if (result.rowCount !== 1) throw new ResolutionSnapshotStoreError("snapshot_version_conflict", "snapshot_version_mismatch");
      }
      return cloneResolutionSnapshot(snapshot);
    } catch (cause) {
      if (cause instanceof ResolutionSnapshotStoreError) throw cause;
      if ((cause as { code?: string } | null)?.code === "23505") {
        throw new ResolutionSnapshotStoreError("snapshot_version_conflict", "snapshot_already_exists", cause);
      }
      throw new ResolutionSnapshotStoreError("snapshot_store_unavailable", "snapshot write failed", cause);
    }
  }

  async put(snapshot: ResolutionSnapshot, expectedVersion: number | null): Promise<ResolutionSnapshot> {
    return this.save(snapshot, expectedVersion);
  }

  async getLatest(key: ResolutionSnapshotLookupKey): Promise<ResolutionSnapshot | null> {
    return this.get(key);
  }

  async upsert(snapshot: ResolutionSnapshot, expectedVersion: number | null): Promise<ResolutionSnapshot> {
    return this.save(snapshot, expectedVersion);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.pool.end();
    } catch (cause) {
      throw new ResolutionSnapshotStoreError("snapshot_store_unavailable", "snapshot store close failed", cause);
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new ResolutionSnapshotStoreError("snapshot_store_unavailable", "snapshot store is closed");
  }
}
