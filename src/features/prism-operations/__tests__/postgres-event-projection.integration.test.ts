// LIVE PostgreSQL integration tier for durable event projection.
// Runs only with PRISM_POSTGRES_TEST_URL; absent means skipped, never passed.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresPrismEventsStore } from "../adapters/postgres-prism-events-store";
import { EventProjectionCoordinator } from "../domain/event-projection-coordinator";
import { PostgresEventProjectionCheckpointStore } from "../domain/event-projection-checkpoint";
import { resolveBinding, type RegistryCanonicalEvent } from "../domain/event-indexer";

const TEST_URL = process.env.PRISM_POSTGRES_TEST_URL;
const suite = TEST_URL ? describe : describe.skip;
const TEST_SCHEMA = `prism_projection_${process.pid}`;
const REGISTRY = "0x67b2f847d7805501c3db79474bdb33e7538825fa0f83aa3cd0083f02ee655c4";
const SCOPE = { registryAddress: REGISTRY, network: "SN_SEPOLIA", registryVersion: "v1" as const };
const SCOPE_V2 = { registryAddress: REGISTRY, network: "SN_SEPOLIA", registryVersion: "v2" as const };
const SCOPE_OTHER_REGISTRY = { registryAddress: "0x77b2f847d7805501c3db79474bdb33e7538825fa0f83aa3cd0083f02ee655c4", network: "SN_SEPOLIA", registryVersion: "v1" as const };
const TX = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const TX_SHARED = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const EVENT: RegistryCanonicalEvent = {
  txHash: TX,
  eventIndex: 0,
  blockNumber: 10,
  kind: "PrismIdentityCreated",
  payload: { prismId: "0x1", controller: "0x2" },
};

function numericTxHash(value: number): RegistryCanonicalEvent["txHash"] {
  return `0x${value.toString(16).padStart(64, "0")}` as RegistryCanonicalEvent["txHash"];
}

function options() {
  return { connectionString: TEST_URL, options: `-c search_path=${TEST_SCHEMA}` };
}

let admin: Pool | undefined;
let events: PostgresPrismEventsStore | undefined;
let checkpoints: PostgresEventProjectionCheckpointStore | undefined;

beforeAll(async () => {
  if (!TEST_URL) return;
  admin = new Pool({ connectionString: TEST_URL, max: 1 });
  await admin.query(`CREATE SCHEMA IF NOT EXISTS ${TEST_SCHEMA}`);
  events = await PostgresPrismEventsStore.create(options());
  checkpoints = await PostgresEventProjectionCheckpointStore.create(options());
});

afterAll(async () => {
  await events?.close().catch(() => undefined);
  await checkpoints?.close().catch(() => undefined);
  await admin?.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`).catch(() => undefined);
  await admin?.end().catch(() => undefined);
});

suite("durable event projection (LIVE PostgreSQL)", () => {
  it("persists events/checkpoint and reopens with exact scan state", async () => {
    let calls = 0;
    const coordinator = new EventProjectionCoordinator({
      registryAddress: REGISTRY,
      network: "SN_SEPOLIA",
      registryVersion: "v1",
      initialFromBlock: 0,
      checkpointStore: checkpoints!,
      eventsStore: events!,
      indexer: { fetchAllRegistryEvents: async () => ({ events: calls++ === 0 ? [EVENT] : [], watermark: calls === 1 ? 10 : 12, pagesFetched: 1 }) },
      now: () => 100,
    });
    const first = await coordinator.runOnce();
    expect(first.advanced).toBe(true);
    expect(first.inserted).toBe(1);
    expect(await events!.count(SCOPE)).toBe(1);
    expect((await checkpoints!.get(SCOPE))?.nextFromBlock).toBe(11);

    await events!.close();
    await checkpoints!.close();
    events = await PostgresPrismEventsStore.create(options());
    checkpoints = await PostgresEventProjectionCheckpointStore.create(options());
    const reopened = await checkpoints.get(SCOPE);
    expect(reopened).toMatchObject({ nextFromBlock: 11, scanWatermark: 10, eventWatermark: 10, version: 0 });
    expect(await events.count(SCOPE)).toBe(1);

    const resumed = new EventProjectionCoordinator({
      registryAddress: REGISTRY,
      network: "SN_SEPOLIA",
      registryVersion: "v1",
      initialFromBlock: 0,
      checkpointStore: checkpoints,
      eventsStore: events,
      indexer: { fetchAllRegistryEvents: async () => ({ events: [EVENT], watermark: 12, pagesFetched: 1 }) },
      now: () => 101,
    });
    const replay = await resumed.runOnce();
    expect(replay.fromBlock).toBe(11);
    expect(replay.inserted).toBe(0);
    expect(replay.duplicates).toBe(1);
    expect(replay.nextFromBlock).toBe(13);
    expect(await events.count(SCOPE)).toBe(1);
  });

  it("reconstructs past the first 1,000 Postgres events so a terminal revoke is not stale", async () => {
    const registryAddress = `0x${"8".repeat(64)}`;
    const scope = { registryAddress, network: "SN_SEPOLIA", registryVersion: "v1" as const };
    const created: RegistryCanonicalEvent = {
      txHash: numericTxHash(1),
      eventIndex: 0,
      blockNumber: 1,
      kind: "PrismIdentityCreated",
      payload: { prismId: "prism:42", controller: "0x2" },
    };
    const bound: RegistryCanonicalEvent = {
      txHash: numericTxHash(2),
      eventIndex: 0,
      blockNumber: 2,
      kind: "ExecutionIdentityBound",
      payload: { prismId: "prism:42", venue: "BASE", executionAccount: "0x3", proofDigest: TX },
    };
    const filler = Array.from({ length: 999 }, (_, index): RegistryCanonicalEvent => ({
      txHash: numericTxHash(index + 3),
      eventIndex: 0,
      blockNumber: index + 3,
      kind: "PrismIdentityCreated",
      payload: { prismId: `prism:${index + 43}`, controller: "0x2" },
    }));
    const revoked: RegistryCanonicalEvent = {
      txHash: numericTxHash(1002),
      eventIndex: 0,
      blockNumber: 1002,
      kind: "BindingRevoked",
      payload: { prismId: "prism:42", venue: "BASE", executionAccount: "0x3" },
    };
    const allEvents = [created, bound, ...filler, revoked];
    const coordinator = new EventProjectionCoordinator({
      registryAddress,
      network: "SN_SEPOLIA",
      registryVersion: "v1",
      initialFromBlock: 0,
      checkpointStore: checkpoints!,
      eventsStore: events!,
      indexer: { fetchAllRegistryEvents: async () => ({ events: allEvents, watermark: 1002, pagesFetched: 1 }) },
    });

    const run = await coordinator.runOnce();
    expect(run.inserted).toBe(allEvents.length);
    expect((await checkpoints!.get(scope))?.scanWatermark).toBe(1002);
    expect(await events!.count(scope)).toBe(allEvents.length);

    const projection = await coordinator.getProjection();
    expect(projection.watermark).toBe(1002);
    expect(projection.identities.has("prism:42")).toBe(true);
    expect([...projection.bindings.values()]).toContainEqual(expect.objectContaining({
      prismId: "prism:42",
      venue: "BASE",
      executionAccount: "0x3",
      status: "REVOKED",
      revokedAtBlock: 1002,
    }));

    await events!.insert({
      txHash: numericTxHash(1003),
      eventIndex: 0,
      blockNumber: 1003,
      kind: "ExecutionIdentityBound",
      payload: { prismId: "prism:42", venue: "BASE", executionAccount: "0x4", proofDigest: TX },
    }, scope);
    const checkpointBoundProjection = await coordinator.getProjection();
    expect(checkpointBoundProjection.watermark).toBe(1002);
    expect(resolveBinding(checkpointBoundProjection, "prism:42", "BASE")).toBeNull();
  });

  it("CAS allows exactly one initial checkpoint writer", async () => {
    const input = { registryAddress: `${REGISTRY.slice(0, -1)}5`, network: "SN_SEPOLIA", registryVersion: "v1" as const, nextFromBlock: 0, scanWatermark: 0, eventWatermark: null, continuationToken: null };
    const results = await Promise.all([checkpoints!.compareAndSet(null, input, 100), checkpoints!.compareAndSet(null, input, 100)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("persists same tx_hash+event_index independently for registry and ABI scopes", async () => {
    const shared = { ...EVENT, txHash: TX_SHARED };
    expect(await events!.insert(shared, SCOPE)).toEqual({ inserted: true, duplicate: false });
    expect(await events!.insert(shared, SCOPE_V2)).toEqual({ inserted: true, duplicate: false });
    expect(await events!.insert(shared, SCOPE_OTHER_REGISTRY)).toEqual({ inserted: true, duplicate: false });
    expect(await events!.count(SCOPE)).toBe(2);
    expect(await events!.count(SCOPE_V2)).toBe(1);
    expect(await events!.count(SCOPE_OTHER_REGISTRY)).toBe(1);
    expect((await events!.get(TX_SHARED, 0, SCOPE_V2))?.registryVersion).toBe("v2");
  });

  it("CAS update contention has one winner and preserves the winning version", async () => {
    const contender = await PostgresEventProjectionCheckpointStore.create(options());
    const registry = `${REGISTRY.slice(0, -1)}7`;
    const base = { registryAddress: registry, network: "SN_SEPOLIA", registryVersion: "v1" as const, nextFromBlock: 10, scanWatermark: 9, eventWatermark: null, continuationToken: null };
    const next = { ...base, nextFromBlock: 11, scanWatermark: 10, eventWatermark: 10 };
    try {
      expect(await checkpoints!.compareAndSet(null, base, 100)).toBe(true);
      const results = await Promise.all([
        checkpoints!.compareAndSet(0, next, 101),
        contender.compareAndSet(0, next, 101),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await checkpoints!.get(registry, "SN_SEPOLIA", "v1"))?.version).toBe(1);
      expect((await checkpoints!.get(registry, "SN_SEPOLIA", "v1"))?.nextFromBlock).toBe(11);
    } finally {
      await contender.close();
    }
  });
});
