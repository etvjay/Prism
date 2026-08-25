import { describe, expect, it } from "vitest";
import { InMemoryPrismEventsStore } from "../adapters/postgres-prism-events-store";
import { EventProjectionCoordinator } from "../domain/event-projection-coordinator";
import { InMemoryEventProjectionCheckpointStore } from "../domain/event-projection-checkpoint";
import { resolveBinding, type RegistryCanonicalEvent } from "../domain/event-indexer";
import type { PrismEventsStore } from "../adapters/postgres-prism-events-store";

const REGISTRY = "0x67b2f847d7805501c3db79474bdb33e7538825fa0f83aa3cd0083f02ee655c4";
const SCOPE = { registryAddress: REGISTRY, network: "SN_SEPOLIA", registryVersion: "v1" as const };
const TX = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const EVENT: RegistryCanonicalEvent = {
  txHash: TX,
  eventIndex: 0,
  blockNumber: 10,
  kind: "PrismIdentityCreated",
  payload: { prismId: "0x1", controller: "0x2" },
};

function indexer(pages: Array<{ events: RegistryCanonicalEvent[]; watermark: number | null }>) {
  let calls = 0;
  return {
    calls: () => calls,
    fetchAllRegistryEvents: async () => ({ ...(pages[calls++] ?? { events: [], watermark: null }), pagesFetched: 1 }),
  };
}

describe("EventProjectionCoordinator", () => {
  it("persists events before advancing checkpoint and survives empty follow-up scans", async () => {
    const events = new InMemoryPrismEventsStore();
    const checkpoints = new InMemoryEventProjectionCheckpointStore();
    const source = indexer([{ events: [EVENT], watermark: 10 }, { events: [], watermark: 12 }]);
    const coordinator = new EventProjectionCoordinator({
      registryAddress: REGISTRY,
      network: "SN_SEPOLIA",
      registryVersion: "v1" as const,
      initialFromBlock: 0,
      checkpointStore: checkpoints,
      eventsStore: events,
      indexer: source,
      now: () => 100,
    });

    const first = await coordinator.runOnce();
    expect(first.advanced).toBe(true);
    expect(first.inserted).toBe(1);
    expect(first.nextFromBlock).toBe(11);
    expect(await events.count(SCOPE)).toBe(1);
    expect((await events.get(TX, 0, SCOPE))?.payload).toMatchObject({ prismId: "prism:1" });
    expect((await coordinator.getCheckpoint())?.scanWatermark).toBe(10);

    const second = await coordinator.runOnce();
    expect(second.reason).toBe("empty_scan_checkpoint_advanced");
    expect((await coordinator.getCheckpoint())?.nextFromBlock).toBe(13);
    expect(source.calls()).toBe(2);
  });

  it("exposes a scope-bound projection provider for application resolve", async () => {
    const events = new InMemoryPrismEventsStore();
    const checkpoints = new InMemoryEventProjectionCheckpointStore();
    const source = indexer([{
      events: [{ ...EVENT, payload: { prismId: "prism:42", controller: "0x2" } }],
      watermark: 100,
    }]);
    const coordinator = new EventProjectionCoordinator({
      registryAddress: REGISTRY,
      network: "SN_SEPOLIA",
      registryVersion: "v1" as const,
      initialFromBlock: 0,
      checkpointStore: checkpoints,
      eventsStore: events,
      indexer: source,
    });

    await coordinator.runOnce();
    const projection = await coordinator.getProjection();
    expect(projection.scope?.registryVersion).toBe("v1");
    expect(projection.identities.has("prism:42")).toBe(true);
  });

  it("keeps provider-backed V1 and V2 projections isolated for the same event correlation", async () => {
    const events = new InMemoryPrismEventsStore();
    const checkpoints = new InMemoryEventProjectionCheckpointStore();
    const bound = (executionAccount: string): RegistryCanonicalEvent => ({
      txHash: TX,
      eventIndex: 1,
      blockNumber: 10,
      kind: "ExecutionIdentityBound",
      payload: { prismId: "prism:42", venue: "BASE", executionAccount, proofDigest: TX },
    });
    const v1 = new EventProjectionCoordinator({
      registryAddress: REGISTRY,
      network: "SN_SEPOLIA",
      registryVersion: "v1",
      initialFromBlock: 0,
      checkpointStore: checkpoints,
      eventsStore: events,
      indexer: indexer([{ events: [bound("0x111")], watermark: 10 }]),
    });
    const v2 = new EventProjectionCoordinator({
      registryAddress: REGISTRY,
      network: "SN_SEPOLIA",
      registryVersion: "v2",
      initialFromBlock: 0,
      checkpointStore: checkpoints,
      eventsStore: events,
      indexer: indexer([{ events: [bound("0x222")], watermark: 10 }]),
    });

    await Promise.all([v1.runOnce(), v2.runOnce()]);
    const p1 = await v1.getProjection();
    const p2 = await v2.getProjection();
    expect(p1.scope?.registryVersion).toBe("v1");
    expect(p2.scope?.registryVersion).toBe("v2");
    expect(resolveBinding(p1, "prism:42", "BASE")).toBe("0x111");
    expect(resolveBinding(p2, "prism:42", "BASE")).toBe("0x222");
    expect((await events.count(SCOPE))).toBe(1);
    expect((await events.count({ ...SCOPE, registryVersion: "v2" }))).toBe(1);
  });

  it("fails closed instead of persisting an unsupported alphanumeric Prism ID", async () => {
    const events = new InMemoryPrismEventsStore();
    const checkpoints = new InMemoryEventProjectionCheckpointStore();
    const coordinator = new EventProjectionCoordinator({
      registryAddress: REGISTRY,
      network: "SN_SEPOLIA",
      registryVersion: "v1",
      initialFromBlock: 0,
      checkpointStore: checkpoints,
      eventsStore: events,
      indexer: indexer([{
        events: [{ ...EVENT, payload: { prismId: "prism:P1", controller: "0x2" } }],
        watermark: 10,
      }]),
    });

    await expect(coordinator.runOnce()).rejects.toThrow("event_projection_prism_id_invalid");
    expect(await events.count(SCOPE)).toBe(0);
    expect(await checkpoints.get(SCOPE)).toBeNull();
  });

  it("replays duplicate events safely after restart", async () => {
    const events = new InMemoryPrismEventsStore();
    const checkpoints = new InMemoryEventProjectionCheckpointStore();
    const source = indexer([{ events: [EVENT], watermark: 10 }, { events: [EVENT], watermark: 10 }]);
    const make = () => new EventProjectionCoordinator({ registryAddress: REGISTRY, network: "SN_SEPOLIA",
      registryVersion: "v1" as const, initialFromBlock: 0, checkpointStore: checkpoints, eventsStore: events, indexer: source });
    await make().runOnce();
    // Simulate a replay from an older range by using a fresh checkpoint store.
    const replay = new EventProjectionCoordinator({ registryAddress: REGISTRY, network: "SN_SEPOLIA",
      registryVersion: "v1" as const, initialFromBlock: 0, checkpointStore: new InMemoryEventProjectionCheckpointStore(), eventsStore: events, indexer: source });
    const result = await replay.runOnce();
    expect(result.inserted).toBe(0);
    expect(result.duplicates).toBe(1);
    expect(await events.count(SCOPE)).toBe(1);
  });

  it("does not advance checkpoint when event persistence fails", async () => {
    const checkpoints = new InMemoryEventProjectionCheckpointStore();
    const failing = new InMemoryPrismEventsStore();
    const original = failing.insertMany.bind(failing);
    failing.insertMany = async () => { throw new Error("db_write_failed"); };
    const source = indexer([{ events: [EVENT], watermark: 10 }]);
    const coordinator = new EventProjectionCoordinator({ registryAddress: REGISTRY, network: "SN_SEPOLIA",
      registryVersion: "v1" as const, initialFromBlock: 0, checkpointStore: checkpoints, eventsStore: failing, indexer: source });
    await expect(coordinator.runOnce()).rejects.toThrow("db_write_failed");
    expect(await checkpoints.get(SCOPE)).toBeNull();
    failing.insertMany = original;
  });

  it("allows exactly one concurrent initial checkpoint winner", async () => {
    const events = new InMemoryPrismEventsStore();
    const checkpoints = new InMemoryEventProjectionCheckpointStore();
    const source = indexer([{ events: [EVENT], watermark: 10 }, { events: [EVENT], watermark: 10 }]);
    const make = () => new EventProjectionCoordinator({ registryAddress: REGISTRY, network: "SN_SEPOLIA",
      registryVersion: "v1" as const, initialFromBlock: 0, checkpointStore: checkpoints, eventsStore: events, indexer: source });
    const results = await Promise.all([make().runOnce(), make().runOnce()]);
    expect(results.filter((result) => result.advanced)).toHaveLength(1);
    expect(results.filter((result) => result.reason === "checkpoint_cas_conflict")).toHaveLength(1);
    expect(await events.count(SCOPE)).toBe(1);
  });

  it("coalesces overlapping projection ticks for one coordinator", async () => {
    const events = new InMemoryPrismEventsStore();
    const checkpoints = new InMemoryEventProjectionCheckpointStore();
    let calls = 0;
    let unblock!: () => void;
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const coordinator = new EventProjectionCoordinator({
      registryAddress: REGISTRY,
      network: "SN_SEPOLIA",
      registryVersion: "v1" as const,
      initialFromBlock: 0,
      checkpointStore: checkpoints,
      eventsStore: events,
      indexer: {
        async fetchAllRegistryEvents() {
          calls++;
          await gate;
          return { events: [EVENT], watermark: 10, pagesFetched: 1 };
        },
      },
      now: () => 100,
    });

    const first = coordinator.runOnce();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = coordinator.runOnce();
    unblock();
    const results = await Promise.all([first, second]);

    expect(calls).toBe(1);
    expect(results[0]).toEqual(results[1]);
    expect(await events.count(SCOPE)).toBe(1);
  });

  it("keeps checkpoint CAS state independent for multiple registries", async () => {
    const checkpoints = new InMemoryEventProjectionCheckpointStore();
    const registryB = "0x77b2f847d7805501c3db79474bdb33e7538825fa0f83aa3cd0083f02ee655c4";
    const inputA = {
      registryAddress: REGISTRY,
      network: "SN_SEPOLIA",
      registryVersion: "v1" as const,
      nextFromBlock: 11,
      scanWatermark: 10,
      eventWatermark: 10,
      continuationToken: null,
    };
    const inputB = { ...inputA, registryAddress: registryB, nextFromBlock: 21, scanWatermark: 20, eventWatermark: null };

    expect(await checkpoints.compareAndSet(null, inputA, 100)).toBe(true);
    expect(await checkpoints.compareAndSet(null, inputB, 100)).toBe(true);
    expect((await checkpoints.get(SCOPE))?.nextFromBlock).toBe(11);
    expect((await checkpoints.get(registryB, "SN_SEPOLIA", "v1"))?.nextFromBlock).toBe(21);
    expect(await checkpoints.compareAndSet(0, { ...inputA, nextFromBlock: 12, scanWatermark: 11, eventWatermark: 11 }, 101)).toBe(true);
    expect((await checkpoints.get(registryB, "SN_SEPOLIA", "v1"))?.nextFromBlock).toBe(21);
  });

  it("keeps checkpoint CAS state independent across ABI versions at one address", async () => {
    const checkpoints = new InMemoryEventProjectionCheckpointStore();
    const v1 = { ...SCOPE, nextFromBlock: 11, scanWatermark: 10, eventWatermark: 10, continuationToken: null };
    const v2 = { ...v1, registryVersion: "v2" as const, nextFromBlock: 21, scanWatermark: 20 };
    expect(await checkpoints.compareAndSet(null, v1, 100)).toBe(true);
    expect(await checkpoints.compareAndSet(null, v2, 100)).toBe(true);
    expect((await checkpoints.get(SCOPE))?.nextFromBlock).toBe(11);
    expect((await checkpoints.get(REGISTRY, "SN_SEPOLIA", "v2"))?.nextFromBlock).toBe(21);
    expect(await checkpoints.compareAndSet(0, { ...v1, nextFromBlock: 12, scanWatermark: 11, eventWatermark: 11 }, 101)).toBe(true);
    expect((await checkpoints.get(REGISTRY, "SN_SEPOLIA", "v2"))?.nextFromBlock).toBe(21);
  });

  it("fails closed when scan watermark is unavailable", async () => {
    const events = new InMemoryPrismEventsStore();
    const checkpoints = new InMemoryEventProjectionCheckpointStore();
    const source = indexer([{ events: [], watermark: null }]);
    const coordinator = new EventProjectionCoordinator({ registryAddress: REGISTRY, network: "SN_SEPOLIA",
      registryVersion: "v1" as const, initialFromBlock: 0, checkpointStore: checkpoints, eventsStore: events, indexer: source });
    const result = await coordinator.runOnce();
    expect(result.advanced).toBe(false);
    expect(result.reason).toBe("missing_scan_watermark");
    expect(await checkpoints.get(SCOPE)).toBeNull();
  });
});
