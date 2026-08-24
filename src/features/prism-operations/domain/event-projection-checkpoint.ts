// Durable event-projection checkpoint boundary.
// A checkpoint is scan progress, not chain truth: the chain/indexer supplies
// facts, while this store makes restart and concurrent-worker behavior explicit.

import type { Pool, PoolClient, PoolConfig } from "pg";
import { Pool as PgPool } from "pg";

export const EVENT_PROJECTION_CHECKPOINT_SCHEMA_VERSION = 1;

export type EventProjectionCheckpoint = {
  registryAddress: string;
  network: string;
  nextFromBlock: number;
  scanWatermark: number | null;
  eventWatermark: number | null;
  continuationToken: string | null;
  version: number;
  updatedAt: number;
};

export type EventProjectionCheckpointInput = Omit<EventProjectionCheckpoint, "version" | "updatedAt">;

export interface EventProjectionCheckpointStore {
  migrate?(): Promise<void>;
  get(registryAddress: string): Promise<EventProjectionCheckpoint | null>;
  /** expectedVersion=null means create-if-absent; otherwise update exact version. */
  compareAndSet(expectedVersion: number | null, next: EventProjectionCheckpointInput, now: number): Promise<boolean>;
  close(): Promise<void>;
}

export const EVENT_PROJECTION_CHECKPOINT_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS prism_event_projection_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prism_event_projection_checkpoints (
  registry_address TEXT PRIMARY KEY,
  network TEXT NOT NULL,
  next_from_block BIGINT NOT NULL CHECK (next_from_block >= 0),
  scan_watermark BIGINT,
  event_watermark BIGINT,
  continuation_token TEXT,
  version INTEGER NOT NULL CHECK (version >= 0),
  updated_at BIGINT NOT NULL,
  CHECK (scan_watermark IS NULL OR scan_watermark >= 0),
  CHECK (event_watermark IS NULL OR event_watermark >= 0)
);
`;

export class EventProjectionCheckpointError extends Error {
  readonly code = "event_projection_checkpoint_error" as const;
  constructor(message: string, cause?: unknown) {
    super(`${message}${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "EventProjectionCheckpointError";
  }
}

function validateInput(input: EventProjectionCheckpointInput): void {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(input.registryAddress)) throw new EventProjectionCheckpointError("malformed_registry_address");
  if (!input.network) throw new EventProjectionCheckpointError("missing_network");
  if (!Number.isInteger(input.nextFromBlock) || input.nextFromBlock < 0) throw new EventProjectionCheckpointError("invalid_next_from_block");
  for (const [name, value] of [["scan_watermark", input.scanWatermark], ["event_watermark", input.eventWatermark]] as const) {
    if (value !== null && (!Number.isInteger(value) || value < 0)) throw new EventProjectionCheckpointError(`invalid_${name}`);
  }
  if (input.continuationToken !== null && typeof input.continuationToken !== "string") throw new EventProjectionCheckpointError("invalid_continuation_token");
}

function rowToCheckpoint(row: Record<string, unknown>): EventProjectionCheckpoint {
  const number = (value: unknown, name: string): number => {
    const n = typeof value === "number" ? value : Number.parseInt(String(value), 10);
    if (!Number.isFinite(n)) throw new EventProjectionCheckpointError(`corrupt_${name}`);
    return n;
  };
  return {
    registryAddress: String(row.registry_address),
    network: String(row.network),
    nextFromBlock: number(row.next_from_block, "next_from_block"),
    scanWatermark: row.scan_watermark === null ? null : number(row.scan_watermark, "scan_watermark"),
    eventWatermark: row.event_watermark === null ? null : number(row.event_watermark, "event_watermark"),
    continuationToken: row.continuation_token === null ? null : String(row.continuation_token),
    version: number(row.version, "version"),
    updatedAt: number(row.updated_at, "updated_at"),
  };
}

export type PostgresEventProjectionCheckpointStoreOptions = Pick<PoolConfig, keyof PoolConfig> & { pool?: PoolConfig };

function poolConfig(options: PostgresEventProjectionCheckpointStoreOptions): PoolConfig {
  const { pool, ...flat } = options;
  return { ...flat, ...pool };
}

export class PostgresEventProjectionCheckpointStore implements EventProjectionCheckpointStore {
  private readonly pool: Pool;
  private closed = false;

  constructor(options: PostgresEventProjectionCheckpointStoreOptions) {
    this.pool = new PgPool(poolConfig(options));
  }

  async migrate(): Promise<void> {
    this.assertOpen();
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      await client.query("BEGIN");
      try {
        await client.query(EVENT_PROJECTION_CHECKPOINT_MIGRATION_SQL);
        const meta = await client.query<{ value: string }>("SELECT value FROM prism_event_projection_meta WHERE key = 'schema_version' FOR UPDATE");
        if (meta.rowCount === 0) {
          await client.query("INSERT INTO prism_event_projection_meta (key, value) VALUES ('schema_version', $1)", [String(EVENT_PROJECTION_CHECKPOINT_SCHEMA_VERSION)]);
        } else if (Number.parseInt(meta.rows[0].value, 10) > EVENT_PROJECTION_CHECKPOINT_SCHEMA_VERSION) {
          throw new EventProjectionCheckpointError("checkpoint_schema_newer_than_supported");
        }
        await client.query("COMMIT");
      } catch (cause) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw cause;
      }
    } catch (cause) {
      if (cause instanceof EventProjectionCheckpointError) throw cause;
      throw new EventProjectionCheckpointError("checkpoint_migrate_failed", cause);
    } finally {
      client?.release();
    }
  }

  static async create(options: PostgresEventProjectionCheckpointStoreOptions): Promise<PostgresEventProjectionCheckpointStore> {
    const store = new PostgresEventProjectionCheckpointStore(options);
    await store.migrate();
    return store;
  }

  private assertOpen(): void {
    if (this.closed) throw new EventProjectionCheckpointError("checkpoint_store_closed");
  }

  async get(registryAddress: string): Promise<EventProjectionCheckpoint | null> {
    this.assertOpen();
    try {
      const result = await this.pool.query("SELECT registry_address, network, next_from_block, scan_watermark, event_watermark, continuation_token, version, updated_at FROM prism_event_projection_checkpoints WHERE registry_address = $1", [registryAddress.toLowerCase()]);
      return result.rowCount ? rowToCheckpoint(result.rows[0]) : null;
    } catch (cause) {
      throw new EventProjectionCheckpointError("checkpoint_read_failed", cause);
    }
  }

  async compareAndSet(expectedVersion: number | null, next: EventProjectionCheckpointInput, now: number): Promise<boolean> {
    this.assertOpen();
    validateInput(next);
    if (!Number.isFinite(now)) throw new EventProjectionCheckpointError("invalid_checkpoint_timestamp");
    const address = next.registryAddress.toLowerCase();
    try {
      if (expectedVersion === null) {
        const result = await this.pool.query(
          `INSERT INTO prism_event_projection_checkpoints (registry_address, network, next_from_block, scan_watermark, event_watermark, continuation_token, version, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,0,$7) ON CONFLICT (registry_address) DO NOTHING`,
          [address, next.network, next.nextFromBlock, next.scanWatermark, next.eventWatermark, next.continuationToken, Math.floor(now)],
        );
        return result.rowCount === 1;
      }
      const result = await this.pool.query(
        `UPDATE prism_event_projection_checkpoints
         SET network=$2, next_from_block=$3, scan_watermark=$4, event_watermark=$5, continuation_token=$6, version=version+1, updated_at=$7
         WHERE registry_address=$1 AND version=$8`,
        [address, next.network, next.nextFromBlock, next.scanWatermark, next.eventWatermark, next.continuationToken, Math.floor(now), expectedVersion],
      );
      return result.rowCount === 1;
    } catch (cause) {
      throw new EventProjectionCheckpointError("checkpoint_write_failed", cause);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }
}

export class InMemoryEventProjectionCheckpointStore implements EventProjectionCheckpointStore {
  private checkpoint: EventProjectionCheckpoint | null = null;
  private closed = false;

  async get(registryAddress: string): Promise<EventProjectionCheckpoint | null> {
    this.assertOpen();
    if (!this.checkpoint || this.checkpoint.registryAddress !== registryAddress.toLowerCase()) return null;
    return { ...this.checkpoint };
  }

  async compareAndSet(expectedVersion: number | null, next: EventProjectionCheckpointInput, now: number): Promise<boolean> {
    this.assertOpen();
    validateInput(next);
    const address = next.registryAddress.toLowerCase();
    if (expectedVersion === null) {
      if (this.checkpoint !== null) return false;
      this.checkpoint = { ...next, registryAddress: address, version: 0, updatedAt: Math.floor(now) };
      return true;
    }
    if (!this.checkpoint || this.checkpoint.registryAddress !== address || this.checkpoint.version !== expectedVersion) return false;
    this.checkpoint = { ...next, registryAddress: address, version: expectedVersion + 1, updatedAt: Math.floor(now) };
    return true;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) throw new EventProjectionCheckpointError("checkpoint_store_closed");
  }
}
