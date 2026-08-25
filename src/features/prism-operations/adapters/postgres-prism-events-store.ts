// Postgres prism_events adapter — LEDGER_INDEX per CONTRACT_SPEC §5.
// Authority: EVENT_CATALOGUE.md + events.yaml reconstruction guarantee.
// Table is keyed by (registry_address, network, registry_version, tx_hash,
// event_index) UNIQUE, deterministic ordering by
// (block_number, tx_hash, event_index), idempotent upsert. No view enrichment.
// Never mutates canonical chain truth; rebuildable from chain.
//
// Architecture note: this adapter is optional if existing stack supports it —
// it uses standard pg Pool, parameterized SQL, versioned migration idempotent.
// Transport-neutral: no RPC imports; events are supplied by the indexer adapter.

import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { Hex } from "../domain/operation";
import {
  eventScope,
  normalizeRegistryEventScope,
  scopeKey,
  scopeMatches,
  withEventScope,
  type RegistryCanonicalEvent,
  type RegistryEventKind,
  type RegistryEventScope,
  type RegistryEventScopeInput,
} from "../domain/event-indexer";

export const PRISM_EVENTS_SCHEMA_VERSION = 2;

export const PRISM_EVENTS_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS prism_events_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prism_events (
  registry_address TEXT NOT NULL,
  network TEXT NOT NULL,
  registry_version TEXT NOT NULL CHECK (registry_version IN ('v1','v2')),
  tx_hash TEXT NOT NULL,
  event_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('PrismIdentityCreated','ExecutionIdentityBound','BindingRevoked')),
  payload TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (registry_address, network, registry_version, tx_hash, event_index)
);
-- Existing v1 rows have no trustworthy registry/network/ABI identity. Keep
-- them unscoped instead of inventing metadata; all new reads are scoped.
ALTER TABLE prism_events ADD COLUMN IF NOT EXISTS registry_address TEXT;
ALTER TABLE prism_events ADD COLUMN IF NOT EXISTS network TEXT;
ALTER TABLE prism_events ADD COLUMN IF NOT EXISTS registry_version TEXT;
ALTER TABLE prism_events DROP CONSTRAINT IF EXISTS prism_events_pkey;
ALTER TABLE prism_events DROP CONSTRAINT IF EXISTS prism_events_scope_complete;
ALTER TABLE prism_events ADD CONSTRAINT prism_events_scope_complete CHECK (
  (registry_address IS NULL AND network IS NULL AND registry_version IS NULL)
  OR (registry_address IS NOT NULL AND network IS NOT NULL AND registry_version IN ('v1','v2'))
) NOT VALID;
CREATE UNIQUE INDEX IF NOT EXISTS uq_prism_events_scope_correlation
  ON prism_events (registry_address, network, registry_version, tx_hash, event_index)
  WHERE registry_address IS NOT NULL AND network IS NOT NULL AND registry_version IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prism_events_block ON prism_events(block_number);
CREATE INDEX IF NOT EXISTS idx_prism_events_kind ON prism_events(kind);
CREATE INDEX IF NOT EXISTS idx_prism_events_scope_block ON prism_events(registry_address, network, registry_version, block_number);
`;

export type PrismEventsStoreErrorCode =
  | "store_connect_failed"
  | "store_migrate_failed"
  | "store_write_failed"
  | "store_read_failed"
  | "invalid_record"
  | "scope_required";

export class PrismEventsStoreError extends Error {
  readonly code: PrismEventsStoreErrorCode;
  constructor(code: PrismEventsStoreErrorCode, message: string, cause?: unknown) {
    super(`[${code}] ${message}${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "PrismEventsStoreError";
    this.code = code;
  }
}

export interface PrismEventsStore {
  insert(event: RegistryCanonicalEvent, scope?: RegistryEventScopeInput): Promise<{ inserted: boolean; duplicate: boolean }>;
  insertMany(events: readonly RegistryCanonicalEvent[], scope?: RegistryEventScopeInput): Promise<{ inserted: number; duplicates: number }>;
  /** Missing scope is accepted at the type boundary only to fail closed at runtime. */
  get(txHash: Hex, eventIndex: number, scope?: RegistryEventScopeInput): Promise<RegistryCanonicalEvent | null>;
  listOrdered(scopeOrLimit?: RegistryEventScopeInput | number, limit?: number): Promise<readonly RegistryCanonicalEvent[]>;
  listByBlockRange(fromBlock: number, toBlock: number, scopeOrLimit?: RegistryEventScopeInput | number, limit?: number): Promise<readonly RegistryCanonicalEvent[]>;
  count(scope?: RegistryEventScopeInput): Promise<number>;
  close(): Promise<void>;
}

export interface PostgresPrismEventsStoreOptions extends Pick<PoolConfig, keyof PoolConfig> {
  pool?: PoolConfig;
}

function mergePoolConfig(options: PostgresPrismEventsStoreOptions): PoolConfig {
  const { pool, ...flat } = options as Record<string, unknown>;
  return { ...(flat as PoolConfig), ...(pool as PoolConfig | undefined) };
}

function normalizeScope(input: RegistryEventScopeInput | undefined): RegistryEventScope {
  if (!input) throw new PrismEventsStoreError("scope_required", "registry scope is required");
  try {
    return normalizeRegistryEventScope(input);
  } catch (cause) {
    throw new PrismEventsStoreError("invalid_record", cause instanceof Error ? cause.message : "invalid_registry_scope");
  }
}

function resolveEventScope(event: RegistryCanonicalEvent, explicit?: RegistryEventScopeInput): { event: RegistryCanonicalEvent; scope: RegistryEventScope } {
  let existing: RegistryEventScope | null;
  try {
    existing = eventScope(event);
  } catch (cause) {
    throw new PrismEventsStoreError("invalid_record", cause instanceof Error ? cause.message : "invalid_event_scope");
  }
  const scope = explicit ? normalizeScope(explicit) : existing;
  if (!scope) throw new PrismEventsStoreError("scope_required", "registry scope is required for event persistence");
  if (existing && !scopeMatches(existing, scope)) {
    throw new PrismEventsStoreError("invalid_record", "event_scope_mismatch");
  }
  try {
    return { event: withEventScope(event, scope), scope };
  } catch (cause) {
    throw new PrismEventsStoreError("invalid_record", cause instanceof Error ? cause.message : "invalid_event_scope");
  }
}

function toRow(event: RegistryCanonicalEvent, scope: RegistryEventScope) {
  return {
    registry_address: scope.registryAddress,
    network: scope.network,
    registry_version: scope.registryVersion,
    tx_hash: event.txHash.toLowerCase(),
    event_index: event.eventIndex,
    block_number: event.blockNumber,
    kind: event.kind,
    payload: JSON.stringify(event.payload),
    created_at: Date.now(),
  };
}

type PrismEventRow = {
  registry_address: string | null;
  network: string | null;
  registry_version: string | null;
  tx_hash: string;
  event_index: number | string;
  block_number: number | string;
  kind: string;
  payload: string;
};

function rowToEvent(row: PrismEventRow): RegistryCanonicalEvent {
  let payload: RegistryCanonicalEvent["payload"];
  let scope: RegistryEventScope;
  try {
    payload = JSON.parse(row.payload) as RegistryCanonicalEvent["payload"];
    scope = normalizeRegistryEventScope({
      registryAddress: row.registry_address ?? "",
      network: row.network ?? "",
      registryVersion: row.registry_version as "v1" | "v2",
    });
  } catch (cause) {
    throw new PrismEventsStoreError("store_read_failed", `corrupt scoped event for ${row.tx_hash}:${row.event_index}${cause instanceof Error ? `:${cause.message}` : ""}`);
  }
  return {
    txHash: row.tx_hash as Hex,
    eventIndex: typeof row.event_index === "number" ? row.event_index : Number.parseInt(String(row.event_index), 10),
    blockNumber: typeof row.block_number === "number" ? row.block_number : Number.parseInt(String(row.block_number), 10),
    kind: row.kind as RegistryEventKind,
    payload,
    registryAddress: scope.registryAddress,
    network: scope.network,
    registryVersion: scope.registryVersion,
    abiVersion: scope.abiVersion,
  };
}

function queryScope(scope: RegistryEventScopeInput | number | undefined): RegistryEventScope {
  return normalizeScope(typeof scope === "number" ? undefined : scope);
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
        } else if (Number.parseInt(meta.rows[0].value, 10) < PRISM_EVENTS_SCHEMA_VERSION) {
          await client.query("UPDATE prism_events_meta SET value = $1 WHERE key = 'schema_version'", [String(PRISM_EVENTS_SCHEMA_VERSION)]);
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

  async insert(event: RegistryCanonicalEvent, explicitScope?: RegistryEventScopeInput): Promise<{ inserted: boolean; duplicate: boolean }> {
    this.assertOpen();
    const resolved = resolveEventScope(event, explicitScope);
    validateEvent(resolved.event);
    const row = toRow(resolved.event, resolved.scope);
    try {
      const res = await this.pool.query(
        `INSERT INTO prism_events (registry_address, network, registry_version, tx_hash, event_index, block_number, kind, payload, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
        [row.registry_address, row.network, row.registry_version, row.tx_hash, row.event_index, row.block_number, row.kind, row.payload, row.created_at],
      );
      if (res.rowCount === 1) return { inserted: true, duplicate: false };
      return { inserted: false, duplicate: true };
    } catch (cause) {
      if (isCheckViolation(cause)) throw new PrismEventsStoreError("invalid_record", "insert rejected by schema", cause);
      throw new PrismEventsStoreError("store_write_failed", "insert failed", cause);
    }
  }

  async insertMany(events: readonly RegistryCanonicalEvent[], explicitScope?: RegistryEventScopeInput): Promise<{ inserted: number; duplicates: number }> {
    if (events.length === 0) return { inserted: 0, duplicates: 0 };
    let inserted = 0;
    let duplicates = 0;
    for (const ev of events) {
      const r = await this.insert(ev, explicitScope);
      if (r.inserted) inserted++;
      else duplicates++;
    }
    return { inserted, duplicates };
  }

  async get(txHash: Hex, eventIndex: number, inputScope?: RegistryEventScopeInput): Promise<RegistryCanonicalEvent | null> {
    this.assertOpen();
    const scope = queryScope(inputScope);
    try {
      const res = await this.pool.query(
        `SELECT registry_address, network, registry_version, tx_hash, event_index, block_number, kind, payload FROM prism_events WHERE registry_address = $1 AND network = $2 AND registry_version = $3 AND tx_hash = $4 AND event_index = $5`,
        [scope.registryAddress, scope.network, scope.registryVersion, txHash.toLowerCase(), eventIndex],
      );
      if (!res.rowCount || res.rowCount === 0) return null;
      return rowToEvent(res.rows[0] as PrismEventRow);
    } catch (cause) {
      if (cause instanceof PrismEventsStoreError) throw cause;
      throw new PrismEventsStoreError("store_read_failed", "get failed", cause);
    }
  }

  async listOrdered(scopeOrLimit?: RegistryEventScopeInput | number, limit = 100): Promise<readonly RegistryCanonicalEvent[]> {
    this.assertOpen();
    const scope = queryScope(scopeOrLimit);
    const requested = typeof scopeOrLimit === "number" ? scopeOrLimit : limit;
    const bounded = Math.max(1, Math.min(1000, Math.floor(requested)));
    try {
      const res = await this.pool.query(
        `SELECT registry_address, network, registry_version, tx_hash, event_index, block_number, kind, payload FROM prism_events WHERE registry_address = $1 AND network = $2 AND registry_version = $3 ORDER BY block_number ASC, tx_hash ASC, event_index ASC LIMIT $4`,
        [scope.registryAddress, scope.network, scope.registryVersion, bounded],
      );
      return res.rows.map((r) => rowToEvent(r as PrismEventRow));
    } catch (cause) {
      if (cause instanceof PrismEventsStoreError) throw cause;
      throw new PrismEventsStoreError("store_read_failed", "listOrdered failed", cause);
    }
  }

  async listByBlockRange(fromBlock: number, toBlock: number, scopeOrLimit?: RegistryEventScopeInput | number, limit = 100): Promise<readonly RegistryCanonicalEvent[]> {
    this.assertOpen();
    const scope = queryScope(scopeOrLimit);
    const requested = typeof scopeOrLimit === "number" ? scopeOrLimit : limit;
    const bounded = Math.max(1, Math.min(1000, Math.floor(requested)));
    try {
      const res = await this.pool.query(
        `SELECT registry_address, network, registry_version, tx_hash, event_index, block_number, kind, payload FROM prism_events WHERE registry_address = $1 AND network = $2 AND registry_version = $3 AND block_number >= $4 AND block_number <= $5 ORDER BY block_number ASC, tx_hash ASC, event_index ASC LIMIT $6`,
        [scope.registryAddress, scope.network, scope.registryVersion, fromBlock, toBlock, bounded],
      );
      return res.rows.map((r) => rowToEvent(r as PrismEventRow));
    } catch (cause) {
      if (cause instanceof PrismEventsStoreError) throw cause;
      throw new PrismEventsStoreError("store_read_failed", "listByBlockRange failed", cause);
    }
  }

  async count(inputScope?: RegistryEventScopeInput): Promise<number> {
    this.assertOpen();
    const scope = queryScope(inputScope);
    try {
      const res = await this.pool.query(
        `SELECT COUNT(*) as cnt FROM prism_events WHERE registry_address = $1 AND network = $2 AND registry_version = $3`,
        [scope.registryAddress, scope.network, scope.registryVersion],
      );
      return Number.parseInt(String(res.rows[0].cnt), 10);
    } catch (cause) {
      if (cause instanceof PrismEventsStoreError) throw cause;
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

  async insert(event: RegistryCanonicalEvent, explicitScope?: RegistryEventScopeInput): Promise<{ inserted: boolean; duplicate: boolean }> {
    this.assertOpen();
    const resolved = resolveEventScope(event, explicitScope);
    validateEvent(resolved.event);
    const key = `${scopeKey(resolved.scope)}:${resolved.event.txHash.toLowerCase()}:${resolved.event.eventIndex}`;
    if (this.map.has(key)) return { inserted: false, duplicate: true };
    this.map.set(key, { ...resolved.event, txHash: resolved.event.txHash.toLowerCase() as Hex });
    return { inserted: true, duplicate: false };
  }

  async insertMany(events: readonly RegistryCanonicalEvent[], explicitScope?: RegistryEventScopeInput): Promise<{ inserted: number; duplicates: number }> {
    let inserted = 0;
    let duplicates = 0;
    for (const ev of events) {
      const r = await this.insert(ev, explicitScope);
      if (r.inserted) inserted++;
      else duplicates++;
    }
    return { inserted, duplicates };
  }

  async get(txHash: Hex, eventIndex: number, inputScope?: RegistryEventScopeInput): Promise<RegistryCanonicalEvent | null> {
    this.assertOpen();
    const scope = queryScope(inputScope);
    return this.map.get(`${scopeKey(scope)}:${txHash.toLowerCase()}:${eventIndex}`) ?? null;
  }

  async listOrdered(scopeOrLimit?: RegistryEventScopeInput | number, limit = 100): Promise<readonly RegistryCanonicalEvent[]> {
    this.assertOpen();
    const scope = queryScope(scopeOrLimit);
    const requested = typeof scopeOrLimit === "number" ? scopeOrLimit : limit;
    const bounded = Math.max(1, Math.min(1000, Math.floor(requested)));
    const filtered = [...this.map.values()].filter((event) => {
      const eventScopeValue = eventScope(event);
      return eventScopeValue !== null && scopeMatches(eventScopeValue, scope);
    });
    filtered.sort(compareEvents);
    return filtered.slice(0, bounded);
  }

  async listByBlockRange(fromBlock: number, toBlock: number, scopeOrLimit?: RegistryEventScopeInput | number, limit = 100): Promise<readonly RegistryCanonicalEvent[]> {
    this.assertOpen();
    const scope = queryScope(scopeOrLimit);
    const requested = typeof scopeOrLimit === "number" ? scopeOrLimit : limit;
    const bounded = Math.max(1, Math.min(1000, Math.floor(requested)));
    const filtered = [...this.map.values()].filter((event) => {
      const eventScopeValue = eventScope(event);
      return event.blockNumber >= fromBlock && event.blockNumber <= toBlock && eventScopeValue !== null && scopeMatches(eventScopeValue, scope);
    });
    filtered.sort(compareEvents);
    return filtered.slice(0, bounded);
  }

  async count(inputScope?: RegistryEventScopeInput): Promise<number> {
    this.assertOpen();
    const scope = queryScope(inputScope);
    return [...this.map.values()].filter((event) => {
      const eventScopeValue = eventScope(event);
      return eventScopeValue !== null && scopeMatches(eventScopeValue, scope);
    }).length;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) throw new PrismEventsStoreError("store_connect_failed", "store is closed");
  }
}

function compareEvents(a: RegistryCanonicalEvent, b: RegistryCanonicalEvent): number {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
  if (a.txHash.toLowerCase() !== b.txHash.toLowerCase()) return a.txHash.toLowerCase() < b.txHash.toLowerCase() ? -1 : 1;
  return a.eventIndex - b.eventIndex;
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
