// LIVE PostgreSQL integration tier for the PostgresOperationStore adapter.
// GATED: runs ONLY when PRISM_POSTGRES_TEST_URL is set to a reachable
// PostgreSQL connection string. When absent, the suite reports SKIPPED —
// never passed. There is no pg-mem fallback: skipped is honest NOT RUN.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { PostgresOperationStore } from "../adapters/postgres-operation-store";
import { OperationError } from "../domain/errors";
import type { Hex } from "../domain/operation";

const TEST_URL = process.env.PRISM_POSTGRES_TEST_URL;
const suite = TEST_URL ? describe : describe.skip;
const TEST_SCHEMA = `prism_wp4b_${process.pid}`;

function storeOptions(extra: Record<string, unknown> = {}) {
  return {
    connectionString: TEST_URL,
    options: `-c search_path=${TEST_SCHEMA}`,
    ...extra,
  };
}

function createStore(extra: Record<string, unknown> = {}) {
  return PostgresOperationStore.create(storeOptions(extra));
}

const TX_HASH: Hex = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TX_HASH_2: Hex = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const NOW = 1_789_000_000;

function uniqueSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

let store: PostgresOperationStore;
let cleanupPool: Pool;
let adminPool: Pool;

beforeAll(async () => {
  if (!TEST_URL) return;
  adminPool = new Pool({ connectionString: TEST_URL, max: 1 });
  await adminPool.query(`CREATE SCHEMA IF NOT EXISTS ${TEST_SCHEMA}`);
  store = await createStore({ max: 10 });
  cleanupPool = new Pool({ ...storeOptions(), max: 1 });
});

afterAll(async () => {
  if (cleanupPool) await cleanupPool.end().catch(() => undefined);
  if (store) await store.close().catch(() => undefined);
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`).catch(() => undefined);
    await adminPool.end().catch(() => undefined);
  }
});

suite("PostgresOperationStore (LIVE integration, WP-4B)", () => {
  it("migrates idempotently and round-trips canonical restart fields", async () => {
    const suffix = uniqueSuffix();
    const rec = await store.create({
      id: `op-rr-${suffix}`,
      kind: "generic_chain_touching_action",
      idempotencyKey: `idem-rr-${suffix}`,
      requestFingerprint: `fp-rr-${suffix}`,
      now: NOW,
      correlationId: `corr-${suffix}`,
    });
    expect(rec.state).toBe("created");
    expect(rec.version).toBe(0);
    expect(rec.txHash).toBeNull();
    expect(rec.reconciliationWatermark).toBeNull();
    const back = await store.getById(rec.id);
    expect(back).toEqual(rec);
    const byKey = await store.getByIdempotencyKey(rec.idempotencyKey);
    expect(byKey?.id).toBe(rec.id);
  });

  it("idempotency: same key + same fingerprint is benign, different fingerprint is rejected", async () => {
    const suffix = uniqueSuffix();
    const first = await store.create({
      id: `op-idem-${suffix}`,
      idempotencyKey: `idem-idem-${suffix}`,
      requestFingerprint: "fp-same",
      now: NOW,
    });
    const second = await store.create({
      id: `op-idem-other-id-${suffix}`,
      idempotencyKey: `idem-idem-${suffix}`,
      requestFingerprint: "fp-same",
      now: NOW,
    });
    expect(second.id).toBe(first.id);
    expect(second.requestFingerprint).toBe("fp-same");
    await expect(
      store.create({
        id: `op-idem-conflict-${suffix}`,
        idempotencyKey: `idem-idem-${suffix}`,
        requestFingerprint: "fp-DIFFERENT",
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(OperationError);
  });

  it("expected-version CAS: concurrent transitions, exactly one winner", async () => {
    const suffix = uniqueSuffix();
    const op = await store.create({
      id: `op-cas-${suffix}`,
      idempotencyKey: `idem-cas-${suffix}`,
      requestFingerprint: `fp-cas-${suffix}`,
      now: NOW,
    });
    // Drive to ready so submitted is reachable
    let cur = await store.transition(op.id, { to: "awaiting_authorization", now: NOW + 1, expectedVersion: 0 });
    cur = await store.transition(cur.id, { to: "ready", now: NOW + 2, expectedVersion: 1 });

    const contenders = await Promise.all(
      Array.from({ length: 6 }, async () => {
        return createStore({ max: 2 });
      }),
    );
    try {
      const results = await Promise.allSettled(
        contenders.map((c) => c.transition(cur.id, { to: "submitted", now: NOW + 3, expectedVersion: cur.version, txHash: TX_HASH })),
      );
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected.length).toBe(5);
      for (const r of rejected) {
        const err = (r as PromiseRejectedResult).reason as Error;
        expect(err.message).toMatch(/stale_version/);
      }
      const final = await store.getById(cur.id);
      expect(final!.state).toBe("submitted");
      expect(final!.version).toBe(cur.version + 1);
      expect(final!.txHash).toBe(TX_HASH);
    } finally {
      await Promise.all(contenders.map((c) => c.close()));
    }
  });

  it("never marks submitted as completed (INV-SYS-005)", async () => {
    const suffix = uniqueSuffix();
    let op = await store.create({
      id: `op-inv-${suffix}`,
      idempotencyKey: `idem-inv-${suffix}`,
      requestFingerprint: `fp-inv-${suffix}`,
      now: NOW,
    });
    op = await store.transition(op.id, { to: "awaiting_authorization", now: NOW + 1, expectedVersion: 0 });
    op = await store.transition(op.id, { to: "ready", now: NOW + 2, expectedVersion: 1 });
    op = await store.transition(op.id, { to: "submitted", now: NOW + 3, expectedVersion: 2, txHash: TX_HASH });
    await expect(store.transition(op.id, { to: "completed", now: NOW + 4, expectedVersion: 3 })).rejects.toBeInstanceOf(OperationError);
    const still = await store.getById(op.id);
    expect(still!.state).toBe("submitted");
  });

  it("persists txHash, errorCode, watermark/metadata across lifecycle", async () => {
    const suffix = uniqueSuffix();
    let op = await store.create({
      id: `op-fields-${suffix}`,
      idempotencyKey: `idem-fields-${suffix}`,
      requestFingerprint: `fp-fields-${suffix}`,
      now: NOW,
    });
    op = await store.transition(op.id, { to: "awaiting_authorization", now: NOW + 1, expectedVersion: 0 });
    op = await store.transition(op.id, { to: "ready", now: NOW + 2, expectedVersion: 1 });
    op = await store.transition(op.id, { to: "submitted", now: NOW + 3, expectedVersion: 2, txHash: TX_HASH });
    op = await store.transition(op.id, { to: "processing", now: NOW + 4, expectedVersion: 3 });
    op = await store.transition(op.id, { to: "confirming", now: NOW + 5, expectedVersion: 4 });
    op = await store.transition(op.id, { to: "confirmed", now: NOW + 6, expectedVersion: 5 });
    op = await store.transition(op.id, {
      to: "indexed",
      now: NOW + 7,
      expectedVersion: 6,
      reconciliationWatermark: 100,
      reconciliationMetadata: { eventIndex: 0 },
    });
    expect(op.reconciliationWatermark).toBe(100);
    expect(op.reconciliationMetadata).toEqual({ eventIndex: 0 });
    op = await store.transition(op.id, {
      to: "reconciled",
      now: NOW + 8,
      expectedVersion: 7,
      reconciliationWatermark: 101,
    });
    expect(op.reconciliationWatermark).toBe(101);
  });

  it("restart/reopen durability: submitted operation survives close/reopen", async () => {
    const suffix = uniqueSuffix();
    let op = await store.create({
      id: `op-restart-${suffix}`,
      idempotencyKey: `idem-restart-${suffix}`,
      requestFingerprint: `fp-restart-${suffix}`,
      now: NOW,
    });
    op = await store.transition(op.id, { to: "awaiting_authorization", now: NOW + 1, expectedVersion: 0 });
    op = await store.transition(op.id, { to: "ready", now: NOW + 2, expectedVersion: 1 });
    op = await store.transition(op.id, { to: "submitted", now: NOW + 3, expectedVersion: 2, txHash: TX_HASH_2 });
    expect(op.txHash).toBe(TX_HASH_2);

    await store.close();
    const reopened = await createStore();
    try {
      const back = await reopened.getById(op.id);
      expect(back).toMatchObject({ state: "submitted", txHash: TX_HASH_2, version: 3 });
      // Replay submitted→processing from new instance continues deterministically
      const next = await reopened.transition(back!.id, { to: "processing", now: NOW + 4, expectedVersion: back!.version });
      expect(next.state).toBe("processing");
      // Stale writer from old version is rejected
      await expect(reopened.transition(back!.id, { to: "confirming", now: NOW + 5, expectedVersion: 3 })).rejects.toBeInstanceOf(
        OperationError,
      );
    } finally {
      await reopened.close();
      store = await createStore();
    }
  });

  it("listNonTerminal returns only non-terminal rows and survives restart watermark", async () => {
    const suffix = uniqueSuffix();
    const op1 = await store.create({
      id: `op-list1-${suffix}`,
      idempotencyKey: `idem-list1-${suffix}`,
      requestFingerprint: `fp-list1-${suffix}`,
      now: NOW,
    });
    let op2 = await store.create({
      id: `op-list2-${suffix}`,
      idempotencyKey: `idem-list2-${suffix}`,
      requestFingerprint: `fp-list2-${suffix}`,
      now: NOW,
    });
    op2 = await store.transition(op2.id, { to: "awaiting_authorization", now: NOW + 1, expectedVersion: 0 });
    op2 = await store.transition(op2.id, { to: "ready", now: NOW + 2, expectedVersion: 1 });
    op2 = await store.transition(op2.id, { to: "submitted", now: NOW + 3, expectedVersion: 2, txHash: TX_HASH });
    const listed = await store.listNonTerminal(100);
    const ids = listed.map((r) => r.id);
    expect(ids).toContain(op1.id);
    expect(ids).toContain(op2.id);
  });

  it("fails closed against unreachable endpoint", async () => {
    await expect(
      PostgresOperationStore.create({ connectionString: "postgresql://nobody:nothing@127.0.0.1:1/prism_none", connectionTimeoutMillis: 1200 }),
    ).rejects.toMatchObject({ code: "store_connect_failed" });
  });
});
