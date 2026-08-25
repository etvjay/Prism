// Unit / SQL-contract tests for the PostgreSQL OperationStore adapter.
// Run WITHOUT a live server. They pin parameterized SQL, row mapping,
// idempotency-key semantics, version CAS, watermark persistence,
// and fail-closed error codes.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { QueryResult } from "pg";
import type { Hex } from "../domain/operation";
import type { PersistedOperation } from "../domain/operation-store";

type CapturedQuery = { text: string; values?: unknown[] };

class FakePool {
  static queries: CapturedQuery[] = [];
  static endCount = 0;
  static queue: Array<{ error?: unknown; result?: Partial<QueryResult> }> = [];
  static defaultResult: Partial<QueryResult> | undefined = undefined;
  static reset() {
    FakePool.queries = [];
    FakePool.endCount = 0;
    FakePool.queue = [];
    FakePool.defaultResult = undefined;
  }
  constructor(_config?: unknown) {}
  async query(text: string, values?: unknown[]) {
    FakePool.queries.push({ text, values });
    if (FakePool.queue.length > 0) {
      const next = FakePool.queue.shift()!;
      if (next.error) throw next.error;
      return (next.result ?? { rowCount: 0, rows: [] }) as QueryResult;
    }
    if (FakePool.defaultResult) return FakePool.defaultResult as QueryResult;
    return { rowCount: 0, rows: [] } as unknown as QueryResult;
  }
  async connect() {
    throw new Error("connect not expected in unit tier");
  }
  async end() {
    FakePool.endCount += 1;
  }
}

function installFakePool() {
  FakePool.reset();
  vi.doMock("pg", () => ({ Pool: FakePool }));
  return FakePool;
}

beforeEach(() => {
  vi.resetModules();
});

async function loadStoreModule() {
  return await import("../adapters/postgres-operation-store");
}

const TX_HASH: Hex = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const NOW = 1_789_000_000;

describe("PostgresOperationStore (unit/SQL contract)", () => {
  it("create issues fully parameterized INSERT with all 17 typed fields", async () => {
    const fake = installFakePool();
    const { PostgresOperationStore: Store } = await loadStoreModule();
    const store = new Store({ connectionString: "postgres://u:p@db:5432/prism" });
    await store.create({
      id: "op-001",
      kind: "generic_chain_touching_action",
      idempotencyKey: "idem-001",
      requestFingerprint: "fp-001",
      now: NOW,
      correlationId: "corr-1",
    });
    expect(fake.queries).toHaveLength(1);
    const q = fake.queries[0];
    expect(q.text).toContain("INSERT INTO prism_operations");
    expect(q.text).not.toContain("op-001");
    expect(q.text).not.toContain("idem-001");
    // values order matches COLUMNS
    expect(q.values).toEqual([
      "op-001",
      "generic_chain_touching_action",
      "created",
      0,
      "idem-001",
      "fp-001",
      null,
      null,
      null,
      0,
      false,
      "corr-1",
      NOW,
      NOW,
      "backend_op_row",
      null,
      null,
    ]);
  });

  it("getById parameterizes lookup and maps snake_case row tolerating bigint strings", async () => {
    const fake = installFakePool();
    const mod = await loadStoreModule();
    FakePool.queue.push({
      result: {
        rowCount: 1,
        rows: [
          {
            id: "op-001",
            kind: "generic_chain_touching_action",
            state: "submitted",
            version: "3",
            idempotency_key: "idem-001",
            request_fingerprint: "fp-001",
            tx_hash: TX_HASH,
            error_code: null,
            error_detail: null,
            attempts: "0",
            correlation_id: "corr-1",
            created_at: "1789000000",
            updated_at: "1789000010",
            authoritative_source: "starknet_rpc_tx_status",
            reconciliation_watermark: "42",
            reconciliation_metadata: JSON.stringify({ phase: "processing" }),
          },
        ],
      } as unknown as Partial<QueryResult>,
    });
    const store = new mod.PostgresOperationStore({});
    const rec = await store.getById("op-001");
    expect(rec).toEqual({
      id: "op-001",
      kind: "generic_chain_touching_action",
      state: "submitted",
      version: 3,
      idempotencyKey: "idem-001",
      requestFingerprint: "fp-001",
      txHash: TX_HASH,
      errorCode: null,
      errorDetail: null,
      attempts: 0,
      submissionAttempted: false,
      correlationId: "corr-1",
      createdAt: 1_789_000_000,
      updatedAt: 1_789_000_010,
      authoritativeSource: "starknet_rpc_tx_status",
      reconciliationWatermark: 42,
      reconciliationMetadata: { phase: "processing" },
    } as PersistedOperation);
    expect(fake.queries[0].values).toEqual(["op-001"]);
  });

  it("getById returns undefined when no row", async () => {
    installFakePool();
    const mod = await loadStoreModule();
    const store = new mod.PostgresOperationStore({});
    expect(await store.getById("missing")).toBeUndefined();
  });

  it("getByIdempotencyKey parameterizes lookup", async () => {
    const fake = installFakePool();
    const mod = await loadStoreModule();
    FakePool.queue.push({ result: { rowCount: 0, rows: [] } as unknown as Partial<QueryResult> });
    const store = new mod.PostgresOperationStore({});
    expect(await store.getByIdempotencyKey("idem-不存在")).toBeUndefined();
    expect(fake.queries[0].text).toContain("idempotency_key = $1");
    expect(fake.queries[0].values).toEqual(["idem-不存在"]);
  });

  it("corrupt reconciliation_metadata fails closed with store_read_failed", async () => {
    installFakePool();
    const mod = await loadStoreModule();
    FakePool.queue.push({
      result: {
        rowCount: 1,
        rows: [
          {
            id: "op-001",
            kind: "k",
            state: "created",
            version: 0,
            idempotency_key: "idem-1",
            request_fingerprint: "fp-1",
            tx_hash: null,
            error_code: null,
            error_detail: null,
            attempts: 0,
            correlation_id: null,
            created_at: 1,
            updated_at: 1,
            authoritative_source: "backend_op_row",
            reconciliation_watermark: null,
            reconciliation_metadata: "{not-json",
          },
        ],
      } as unknown as Partial<QueryResult>,
    });
    const store = new mod.PostgresOperationStore({});
    await expect(store.getById("op-001")).rejects.toMatchObject({ code: "store_read_failed" });
  });

  it("create idempotency: same key + same fingerprint returns existing (benign)", async () => {
    installFakePool();
    const mod = await loadStoreModule();
    const dup = Object.assign(new Error("duplicate key"), { code: "23505", constraint: "prism_operations_idempotency_key_key" });
    FakePool.queue.push({ error: dup });
    // after duplicate, adapter does SELECT by id (empty) then SELECT by key (existing)
    FakePool.queue.push({ result: { rowCount: 0, rows: [] } as unknown as Partial<QueryResult> });
    FakePool.queue.push({
      result: {
        rowCount: 1,
        rows: [
          {
            id: "op-001",
            kind: "generic_chain_touching_action",
            state: "created",
            version: 0,
            idempotency_key: "idem-001",
            request_fingerprint: "fp-001",
            tx_hash: null,
            error_code: null,
            error_detail: null,
            attempts: 0,
            correlation_id: null,
            created_at: NOW,
            updated_at: NOW,
            authoritative_source: "backend_op_row",
            reconciliation_watermark: null,
            reconciliation_metadata: null,
          },
        ],
      } as unknown as Partial<QueryResult>,
    });
    const store = new mod.PostgresOperationStore({});
    const result = await store.create({
      id: "op-001",
      idempotencyKey: "idem-001",
      requestFingerprint: "fp-001",
      now: NOW,
    });
    expect(result.id).toBe("op-001");
    expect(result.requestFingerprint).toBe("fp-001");
  });

  it("create idempotency: same key + different fingerprint throws ERR-023", async () => {
    installFakePool();
    const mod = await loadStoreModule();
    const dup = Object.assign(new Error("duplicate"), { code: "23505" });
    FakePool.queue.push({ error: dup });
    FakePool.queue.push({ result: { rowCount: 0, rows: [] } as unknown as Partial<QueryResult> });
    FakePool.queue.push({
      result: {
        rowCount: 1,
        rows: [
          {
            id: "op-001",
            kind: "generic_chain_touching_action",
            state: "created",
            version: 0,
            idempotency_key: "idem-001",
            request_fingerprint: "fp-ORIGINAL",
            tx_hash: null,
            error_code: null,
            error_detail: null,
            attempts: 0,
            correlation_id: null,
            created_at: NOW,
            updated_at: NOW,
            authoritative_source: "backend_op_row",
            reconciliation_watermark: null,
            reconciliation_metadata: null,
          },
        ],
      } as unknown as Partial<QueryResult>,
    });
    const store = new mod.PostgresOperationStore({});
    await expect(
      store.create({ id: "op- different", idempotencyKey: "idem-001", requestFingerprint: "fp-DIFFERENT", now: NOW }),
    ).rejects.toMatchObject({ code: "ERR-023" });
  });

  it("transition uses versioned CAS UPDATE with all canonical fields", async () => {
    const fake = installFakePool();
    const mod = await loadStoreModule();
    // SELECT current
    FakePool.queue.push({
      result: {
        rowCount: 1,
        rows: [
          {
            id: "op-001",
            kind: "generic_chain_touching_action",
            state: "ready",
            version: 2,
            idempotency_key: "idem-001",
            request_fingerprint: "fp-001",
            tx_hash: null,
            error_code: null,
            error_detail: null,
            attempts: 0,
            correlation_id: null,
            created_at: NOW,
            updated_at: NOW,
            authoritative_source: "backend_op_row",
            reconciliation_watermark: null,
            reconciliation_metadata: null,
          },
        ],
      } as unknown as Partial<QueryResult>,
    });
    // UPDATE CAS
    FakePool.queue.push({ result: { rowCount: 1, rows: [] } as unknown as Partial<QueryResult> });
    // SELECT refreshed
    FakePool.queue.push({
      result: {
        rowCount: 1,
        rows: [
          {
            id: "op-001",
            kind: "generic_chain_touching_action",
            state: "submitted",
            version: 3,
            idempotency_key: "idem-001",
            request_fingerprint: "fp-001",
            tx_hash: TX_HASH,
            error_code: null,
            error_detail: null,
            attempts: 0,
            correlation_id: null,
            created_at: NOW,
            updated_at: NOW + 10,
            authoritative_source: "starknet_rpc_tx_status",
            reconciliation_watermark: null,
            reconciliation_metadata: null,
          },
        ],
      } as unknown as Partial<QueryResult>,
    });
    const store = new mod.PostgresOperationStore({});
    const next = await store.transition("op-001", {
      to: "submitted",
      now: NOW + 10,
      expectedVersion: 2,
      txHash: TX_HASH,
    });
    expect(next.state).toBe("submitted");
    expect(next.version).toBe(3);
    expect(next.txHash).toBe(TX_HASH);
    // The UPDATE must be parameterized and check version
    const upd = fake.queries.find((q) => q.text.includes("UPDATE prism_operations SET"));
    expect(upd).toBeDefined();
    expect(upd!.text).toContain("WHERE id = $1 AND version = $15");
    expect(upd!.text).not.toContain(TX_HASH);
    expect(upd!.values).toContain(TX_HASH);
    expect(upd!.values).toContain(2);
  });

  it("transition stale version throws OperationError ERR-023 and is fail-closed", async () => {
    installFakePool();
    const mod = await loadStoreModule();
    FakePool.queue.push({
      result: {
        rowCount: 1,
        rows: [
          {
            id: "op-001",
            kind: "generic_chain_touching_action",
            state: "ready",
            version: 5,
            idempotency_key: "idem-001",
            request_fingerprint: "fp-001",
            tx_hash: null,
            error_code: null,
            error_detail: null,
            attempts: 0,
            correlation_id: null,
            created_at: NOW,
            updated_at: NOW,
            authoritative_source: "backend_op_row",
            reconciliation_watermark: null,
            reconciliation_metadata: null,
          },
        ],
      } as unknown as Partial<QueryResult>,
    });
    const store = new mod.PostgresOperationStore({});
    await expect(
      store.transition("op-001", { to: "submitted", now: NOW + 1, expectedVersion: 2, txHash: TX_HASH }),
    ).rejects.toMatchObject({ code: "ERR-023" });
  });

  it("transition illegal skip is rejected before CAS (domain invariant)", async () => {
    installFakePool();
    const mod = await loadStoreModule();
    // current is created (0), try direct to completed
    FakePool.queue.push({
      result: {
        rowCount: 1,
        rows: [
          {
            id: "op-001",
            kind: "generic_chain_touching_action",
            state: "created",
            version: 0,
            idempotency_key: "idem-001",
            request_fingerprint: "fp-001",
            tx_hash: null,
            error_code: null,
            error_detail: null,
            attempts: 0,
            correlation_id: null,
            created_at: NOW,
            updated_at: NOW,
            authoritative_source: "backend_op_row",
            reconciliation_watermark: null,
            reconciliation_metadata: null,
          },
        ],
      } as unknown as Partial<QueryResult>,
    });
    const store = new mod.PostgresOperationStore({});
    await expect(store.transition("op-001", { to: "completed", now: NOW + 1, expectedVersion: 0 })).rejects.toMatchObject({
      code: "ERR-023",
    });
    // No UPDATE should have been attempted beyond the SELECT
    expect(FakePool.queries.length).toBe(1);
  });

  it("transition submitted→completed is blocked by INV-SYS-005 guard", async () => {
    installFakePool();
    const mod = await loadStoreModule();
    FakePool.queue.push({
      result: {
        rowCount: 1,
        rows: [
          {
            id: "op-001",
            kind: "generic_chain_touching_action",
            state: "submitted",
            version: 3,
            idempotency_key: "idem-001",
            request_fingerprint: "fp-001",
            tx_hash: TX_HASH,
            error_code: null,
            error_detail: null,
            attempts: 0,
            correlation_id: null,
            created_at: NOW,
            updated_at: NOW,
            authoritative_source: "starknet_rpc_tx_status",
            reconciliation_watermark: null,
            reconciliation_metadata: null,
          },
        ],
      } as unknown as Partial<QueryResult>,
    });
    const store = new mod.PostgresOperationStore({});
    await expect(store.transition("op-001", { to: "completed", now: NOW + 1, expectedVersion: 3 })).rejects.toMatchObject({
      code: "ERR-023",
    });
  });

  it("listNonTerminal uses parameterized IN clause ordering by updated_at", async () => {
    const fake = installFakePool();
    const mod = await loadStoreModule();
    FakePool.queue.push({ result: { rowCount: 0, rows: [] } as unknown as Partial<QueryResult> });
    const store = new mod.PostgresOperationStore({});
    await store.listNonTerminal(5);
    expect(fake.queries[0].text).toContain("WHERE state IN");
    expect(fake.queries[0].text).toContain("ORDER BY updated_at ASC");
    expect(fake.queries[0].values).toContain(5);
    expect(fake.queries[0].text).not.toContain("submitted");
  });

  it("reconciliation watermark and metadata are persisted via transition", async () => {
    const fake = installFakePool();
    const mod = await loadStoreModule();
    FakePool.queue.push({
      result: {
        rowCount: 1,
        rows: [
          {
            id: "op-001",
            kind: "generic_chain_touching_action",
            state: "confirmed",
            version: 6,
            idempotency_key: "idem-001",
            request_fingerprint: "fp-001",
            tx_hash: TX_HASH,
            error_code: null,
            error_detail: null,
            attempts: 0,
            correlation_id: null,
            created_at: NOW,
            updated_at: NOW,
            authoritative_source: "execution_status_succeeded",
            reconciliation_watermark: null,
            reconciliation_metadata: null,
          },
        ],
      } as unknown as Partial<QueryResult>,
    });
    FakePool.queue.push({ result: { rowCount: 1, rows: [] } as unknown as Partial<QueryResult> });
    FakePool.queue.push({
      result: {
        rowCount: 1,
        rows: [
          {
            id: "op-001",
            kind: "generic_chain_touching_action",
            state: "indexed",
            version: 7,
            idempotency_key: "idem-001",
            request_fingerprint: "fp-001",
            tx_hash: TX_HASH,
            error_code: null,
            error_detail: null,
            attempts: 0,
            correlation_id: null,
            created_at: NOW,
            updated_at: NOW + 10,
            authoritative_source: "indexer_event_observed",
            reconciliation_watermark: 101,
            reconciliation_metadata: JSON.stringify({ eventIndex: 0 }),
          },
        ],
      } as unknown as Partial<QueryResult>,
    });
    const store = new mod.PostgresOperationStore({});
    const next = await store.transition("op-001", {
      to: "indexed",
      now: NOW + 10,
      expectedVersion: 6,
      reconciliationWatermark: 101,
      reconciliationMetadata: { eventIndex: 0 },
    });
    expect(next.reconciliationWatermark).toBe(101);
    expect(next.reconciliationMetadata).toEqual({ eventIndex: 0 });
    const upd = fake.queries.find((q) => q.text.includes("UPDATE prism_operations SET"));
    expect(upd!.values).toContain(101);
  });

  it("close ends the pool; operations after close are refused", async () => {
    installFakePool();
    const mod = await loadStoreModule();
    const store = new mod.PostgresOperationStore({});
    await store.close();
    expect(FakePool.endCount).toBe(1);
    await store.close();
    expect(FakePool.endCount).toBe(1);
    await expect(store.getById("op-001")).rejects.toMatchObject({ code: "store_connect_failed" });
  });

  it("exposes versioned migration SQL with typed state check and watermark columns", () => {
    installFakePool();
    return import("../adapters/postgres-operation-store").then((mod) => {
      expect(mod.OPERATION_STORE_MIGRATION_SQL).toContain("prism_operations");
      expect(mod.OPERATION_STORE_MIGRATION_SQL).toContain("idempotency_key TEXT NOT NULL UNIQUE");
      expect(mod.OPERATION_STORE_MIGRATION_SQL).toContain("request_fingerprint TEXT NOT NULL");
      expect(mod.OPERATION_STORE_MIGRATION_SQL).toContain("reconciliation_watermark BIGINT");
      expect(mod.OPERATION_STORE_MIGRATION_SQL).toContain("state TEXT NOT NULL CHECK (state IN (");
      expect(mod.OPERATION_STORE_MIGRATION_SQL).toContain("tx_hash TEXT");
      expect(mod.OPERATION_STORE_MIGRATION_SQL).toContain("submission_attempted BOOLEAN NOT NULL DEFAULT FALSE");
      expect(mod.OPERATION_STORE_SCHEMA_VERSION).toBe(2);
    });
  });

  it("validate missing fields throw before DB touch", async () => {
    const fake = installFakePool();
    const mod = await loadStoreModule();
    const store = new mod.PostgresOperationStore({});
    await expect(store.create({ id: "", idempotencyKey: "k", requestFingerprint: "f", now: NOW })).rejects.toMatchObject({
      code: "ERR-023",
    });
    await expect(store.create({ id: "op-1", idempotencyKey: "", requestFingerprint: "f", now: NOW })).rejects.toMatchObject({
      code: "ERR-023",
    });
    expect(fake.queries).toHaveLength(0);
  });
});
