// Postgres prism_events adapter — LEDGER_INDEX per CONTRACT_SPEC §5.
// Authority: EVENT_CATALOGUE.md + events.yaml reconstruction guarantee.
// Table is keyed by (tx_hash, event_index) UNIQUE, deterministic ordering by
// (block_number, tx_hash, event_index), idempotent upsert. No view enrichment.
// Never mutates canonical chain truth; rebuildable from chain.
//
// Architecture note: this adapter is optional if existing stack supports it —
// it uses standard pg Pool, parameterized SQL, versioned migration idempotent.
// Transport-neutral: no RPC imports; events are supplied by the indexer adapter.

import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { Hex } from "../domain/operation";
import type { RegistryCanonicalEvent, RegistryEventKind } from "../domain/event-indexer";

export const PRISM_EVENTS_SCHEMA_VERSION = 1;

export const PRISM_EVENTS_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS prism_events_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prism_events (
  tx_hash TEXT NOT NULL,
  event_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('PrismIdentityCreated','ExecutionIdentityBound','BindingRevoked')),
  payload TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (tx_hash, event_index)
);
CREATE INDEX IF NOT EXISTS idx_prism_events_block ON prism_events(block_number);
CREATE INDEX IF NOT EXISTS idx_prism_events_kind ON prism_events(kind);
`;

export type PrismEventsStoreErrorCode =
  | "store_connect_failed"
  | "store_migrate_failed"
  | "store_write_failed"
  | "store_read_failed"
  | "invalid_record";

export class PrismEventsStoreError extends Error {
  readonly code: PrismEventsStoreErrorCode;
  constructor(code: PrismEventsStoreErrorCode, message: string, cause?: unknown) {
    super(`[${code}] ${message}${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "PrismEventsStoreError";
    this.code = code;
  }
}

export interface PrismEventsStore {
  insert(event: RegistryCanonicalEvent): Promise<{ inserted: boolean; duplicate: boolean }>;
  insertMany(events: readonly RegistryCanonicalEvent[]): Promise<{ inserted: number; duplicates: number }>;
  get(txHash: Hex, eventIndex: number): Promise<RegistryCanonicalEvent | null>;
  listOrdered(limit?: number): Promise<readonly RegistryCanonicalEvent[]>;
  listByBlockRange(fromBlock: number, toBlock: number, limit?: number): Promise<readonly RegistryCanonicalEvent[]>;
  count(): Promise<number>;
  close(): Promise<void>;
}

export interface PostgresPrismEventsStoreOptions extends Pick<PoolConfig, keyof PoolConfig> {
  pool?: PoolConfig;
}

function mergePoolConfig(options: PostgresPrismEventsStoreOptions): PoolConfig {
  const { pool, ...flat } = options as Record<string, unknown>;
  return { ...(flat as PoolConfig), ...(pool as PoolConfig | undefined) };
}

function toRow(event: RegistryCanonicalEvent) {
  return {
    tx_hash: event.txHash.toLowerCase(),
    event_index: event.eventIndex,
    block_number: event.blockNumber,
    kind: event.kind,
    payload: JSON.stringify(event.payload),
    created_at: Date.now(),
  };
}

function rowToEvent(row: { tx_hash: string; event_index: number | string; block_number: number | string; kind: string; payload: string }): RegistryCanonicalEvent {
  let payload: RegistryCanonicalEvent["payload"];
  try {
    payload = JSON.parse(row.payload) as RegistryCanonicalEvent["payload"];
  } catch {
    throw new PrismEventsStoreError("store_read_failed", `corrupt payload for ${row.tx_hash}:${row.event_index}`);
  }
  return {
    txHash: row.tx_hash as Hex,
    eventIndex: typeof row.event_index === "number" ? row.event_index : Number.parseInt(String(row.event_index), 10),
    blockNumber: typeof row.block_number === "number" ? row.block_number : Number.parseInt(String(row.block_number), 10),
    kind: row.kind as RegistryEventKind,
    payload,
  };
}

export class PostgresPrismEventsStore implements PrismEventsStore {
  private readonly pool: Pool;
  private closed = false;

  constructor(options: PostgresPrismEventsStoreOptions) {
    this.pool = new Pool(mergePoolConfig(options));
  }

  async migrate(): Promise<void> {
    this.assertOpen();
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
    } catch (cause) {
      throw new PrismEventsStoreError("store_connect_failed", "cannot acquire connection", cause);
    }
    try {
      await client.query("BEGIN");
      try {
        await client.query(PRISM_EVENTS_MIGRATION_SQL);
        const meta = await client.query<{ value: string }>("SELECT value FROM prism_events_meta WHERE key = 'schema_version' FOR UPDATE");
        if (meta.rowCount === 0) {
          await client.query("INSERT INTO prism_events_meta (key, value) VALUES ('schema_version', $1)", [String(PRISM_EVENTS_SCHEMA_VERSION)]);
        } else if (Number.parseInt(meta.rows[0].value, 10) > PRISM_EVENTS_SCHEMA_VERSION) {
          throw new PrismEventsStoreError("store_migrate_failed", `database schema_version ${meta.rows[0].value} newer than ${PRISM_EVENTS_SCHEMA_VERSION}`);
        }
        await client.query("COMMIT");
      } catch (inner) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw inner;
      }
    } catch (cause) {
      if (cause instanceof PrismEventsStoreError) throw cause;
      throw new PrismEventsStoreError("store_migrate_failed", "migration failed", cause);
    } finally {
      client.release();
    }
  }

  static async create(options: PostgresPrismEventsStoreOptions): Promise<PostgresPrismEventsStore> {
    const store = new PostgresPrismEventsStore(options);
    await store.migrate();
    return store;
  }

  private assertOpen(): void {
    if (this.closed) throw new PrismEventsStoreError("store_connect_failed", "store is closed");
  }

  async insert(event: RegistryCanonicalEvent): Promise<{ inserted: boolean; duplicate: boolean }> {
    this.assertOpen();
    validateEvent(event);
    const row = toRow(event);
    try {
      const res = await this.pool.query(
        `INSERT INTO prism_events (tx_hash, event_index, block_number, kind, payload, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tx_hash, event_index) DO NOTHING`,
        [row.tx_hash, row.event_index, row.block_number, row.kind, row.payload, row.created_at],
      );
      if (res.rowCount === 1) return { inserted: true, duplicate: false };
      return { inserted: false, duplicate: true };
    } catch (cause) {
      if (isCheckViolation(cause)) throw new PrismEventsStoreError("invalid_record", "insert rejected by schema", cause);
      throw new PrismEventsStoreError("store_write_failed", "insert failed", cause);
    }
  }

  async insertMany(events: readonly RegistryCanonicalEvent[]): Promise<{ inserted: number; duplicates: number }> {
    if (events.length === 0) return { inserted: 0, duplicates: 0 };
    let inserted = 0;
    let duplicates = 0;
    for (const ev of events) {
      const r = await this.insert(ev);
      if (r.inserted) inserted++;
      else duplicates++;
    }
    return { inserted, duplicates };
  }

  async get(txHash: Hex, eventIndex: number): Promise<RegistryCanonicalEvent | null> {
    this.assertOpen();
    try {
      const res = await this.pool.query(`SELECT tx_hash, event_index, block_number, kind, payload FROM prism_events WHERE tx_hash = $1 AND event_index = $2`, [
        txHash.toLowerCase(),
        eventIndex,
      ]);
      if (!res.rowCount || res.rowCount === 0) return null;
      return rowToEvent(res.rows[0] as never);
    } catch (cause) {
      throw new PrismEventsStoreError("store_read_failed", "get failed", cause);
    }
  }

  async listOrdered(limit = 100): Promise<readonly RegistryCanonicalEvent[]> {
    this.assertOpen();
    const bounded = Math.max(1, Math.min(1000, Math.floor(limit)));
    try {
      const res = await this.pool.query(
        `SELECT tx_hash, event_index, block_number, kind, payload FROM prism_events ORDER BY block_number ASC, tx_hash ASC, event_index ASC LIMIT $1`,
        [bounded],
      );
      return res.rows.map((r) => rowToEvent(r as never));
    } catch (cause) {
      throw new PrismEventsStoreError("store_read_failed", "listOrdered failed", cause);
    }
  }

  async listByBlockRange(fromBlock: number, toBlock: number, limit = 100): Promise<readonly RegistryCanonicalEvent[]> {
    this.assertOpen();
    const bounded = Math.max(1, Math.min(1000, Math.floor(limit)));
    try {
      const res = await this.pool.query(
        `SELECT tx_hash, event_index, block_number, kind, payload FROM prism_events WHERE block_number >= $1 AND block_number <= $2 ORDER BY block_number ASC, tx_hash ASC, event_index ASC LIMIT $3`,
        [fromBlock, toBlock, bounded],
      );
      return res.rows.map((r) => rowToEvent(r as never));
    } catch (cause) {
      throw new PrismEventsStoreError("store_read_failed", "listByBlockRange failed", cause);
    }
  }

  async count(): Promise<number> {
    this.assertOpen();
    try {
      const res = await this.pool.query(`SELECT COUNT(*) as cnt FROM prism_events`);
      return Number.parseInt(String(res.rows[0].cnt), 10);
    } catch (cause) {
      throw new PrismEventsStoreError("store_read_failed", "count failed", cause);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.pool.end();
    } catch (cause) {
      throw new PrismEventsStoreError("store_connect_failed", "close failed", cause);
    }
  }
}

// In-memory variant for tests (X2 — no Postgres required)
export class InMemoryPrismEventsStore implements PrismEventsStore {
  private readonly map = new Map<string, RegistryCanonicalEvent>();
  private closed = false;

  async insert(event: RegistryCanonicalEvent): Promise<{ inserted: boolean; duplicate: boolean }> {
    this.assertOpen();
    validateEvent(event);
    const key = `${event.txHash.toLowerCase()}:${event.eventIndex}`;
    if (this.map.has(key)) return { inserted: false, duplicate: true };
    this.map.set(key, { ...event, txHash: event.txHash.toLowerCase() as Hex });
    return { inserted: true, duplicate: false };
  }

  async insertMany(events: readonly RegistryCanonicalEvent[]): Promise<{ inserted: number; duplicates: number }> {
    let inserted = 0;
    let duplicates = 0;
    for (const ev of events) {
      const r = await this.insert(ev);
      if (r.inserted) inserted++;
      else duplicates++;
    }
    return { inserted, duplicates };
  }

  async get(txHash: Hex, eventIndex: number): Promise<RegistryCanonicalEvent | null> {
    this.assertOpen();
    return this.map.get(`${txHash.toLowerCase()}:${eventIndex}`) ?? null;
  }

  async listOrdered(limit = 100): Promise<readonly RegistryCanonicalEvent[]> {
    this.assertOpen();
    const bounded = Math.max(1, Math.min(1000, Math.floor(limit)));
    const sorted = [...this.map.values()].sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
      if (a.txHash.toLowerCase() !== b.txHash.toLowerCase()) return a.txHash.toLowerCase() < b.txHash.toLowerCase() ? -1 : 1;
      return a.eventIndex - b.eventIndex;
    });
    return sorted.slice(0, bounded);
  }

  async listByBlockRange(fromBlock: number, toBlock: number, limit = 100): Promise<readonly RegistryCanonicalEvent[]> {
    this.assertOpen();
    const filtered = [...this.map.values()].filter((e) => e.blockNumber >= fromBlock && e.blockNumber <= toBlock);
    filtered.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
      if (a.txHash.toLowerCase() !== b.txHash.toLowerCase()) return a.txHash.toLowerCase() < b.txHash.toLowerCase() ? -1 : 1;
      return a.eventIndex - b.eventIndex;
    });
    return filtered.slice(0, Math.max(1, Math.min(1000, Math.floor(limit))));
  }

  async count(): Promise<number> {
    return this.map.size;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) throw new PrismEventsStoreError("store_connect_failed", "store is closed");
  }
}

function validateEvent(event: RegistryCanonicalEvent): void {
  if (!event.txHash || !/^0x[0-9a-fA-F]{64}$/.test(event.txHash)) throw new PrismEventsStoreError("invalid_record", `invalid tx_hash:${event.txHash}`);
  if (!Number.isInteger(event.eventIndex) || event.eventIndex < 0) throw new PrismEventsStoreError("invalid_record", `invalid event_index:${event.eventIndex}`);
  if (!Number.isFinite(event.blockNumber) || event.blockNumber < 0) throw new PrismEventsStoreError("invalid_record", `invalid block_number:${event.blockNumber}`);
  if (!["PrismIdentityCreated", "ExecutionIdentityBound", "BindingRevoked"].includes(event.kind)) {
    throw new PrismEventsStoreError("invalid_record", `invalid kind:${event.kind}`);
  }
}

function isCheckViolation(cause: unknown): boolean {
  return (cause as { code?: string } | null)?.code === "23514";
}
