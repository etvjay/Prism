// LIVE PostgreSQL integration tier for durable event projection.
// Runs only with PRISM_POSTGRES_TEST_URL; absent means skipped, never passed.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresPrismEventsStore } from "../adapters/postgres-prism-events-store";
import { EventProjectionCoordinator } from "../domain/event-projection-coordinator";
import { PostgresEventProjectionCheckpointStore } from "../domain/event-projection-checkpoint";
import type { RegistryCanonicalEvent } from "../domain/event-indexer";

const TEST_URL = process.env.PRISM_POSTGRES_TEST_URL;
const suite = TEST_URL ? describe : describe.skip;
const TEST_SCHEMA = `prism_projection_${process.pid}`;
const REGISTRY = "0x67b2f847d7805501c3db79474bdb33e7538825fa0f83aa3cd0083f02ee655c4";
const TX = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const EVENT: RegistryCanonicalEvent = {
  txHash: TX,
  eventIndex: 0,
  blockNumber: 10,
  kind: "PrismIdentityCreated",
  payload: { prismId: "0x1", controller: "0x2" },
};

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
      initialFromBlock: 0,
      checkpointStore: checkpoints!,
      eventsStore: events!,
      indexer: { fetchAllRegistryEvents: async () => ({ events: calls++ === 0 ? [EVENT] : [], watermark: calls === 1 ? 10 : 12, pagesFetched: 1 }) },
      now: () => 100,
    });
    const first = await coordinator.runOnce();
    expect(first.advanced).toBe(true);
    expect(first.inserted).toBe(1);
    expect(await events!.count()).toBe(1);
    expect((await checkpoints!.get(REGISTRY))?.nextFromBlock).toBe(11);

    await events!.close();
    await checkpoints!.close();
    events = await PostgresPrismEventsStore.create(options());
    checkpoints = await PostgresEventProjectionCheckpointStore.create(options());
    const reopened = await checkpoints.get(REGISTRY);
    expect(reopened).toMatchObject({ nextFromBlock: 11, scanWatermark: 10, eventWatermark: 10, version: 0 });
    expect(await events.count()).toBe(1);
  });

  it("CAS allows exactly one initial checkpoint writer", async () => {
    const input = { registryAddress: `${REGISTRY.slice(0, -1)}5`, network: "SN_SEPOLIA", nextFromBlock: 0, scanWatermark: 0, eventWatermark: null, continuationToken: null };
    const results = await Promise.all([checkpoints!.compareAndSet(null, input, 100), checkpoints!.compareAndSet(null, input, 100)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
