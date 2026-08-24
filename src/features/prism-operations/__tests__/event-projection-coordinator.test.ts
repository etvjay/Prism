import { describe, expect, it } from "vitest";
import { InMemoryPrismEventsStore } from "../adapters/postgres-prism-events-store";
import { EventProjectionCoordinator } from "../domain/event-projection-coordinator";
import { InMemoryEventProjectionCheckpointStore } from "../domain/event-projection-checkpoint";
import type { RegistryCanonicalEvent } from "../domain/event-indexer";
import type { PrismEventsStore } from "../adapters/postgres-prism-events-store";

const REGISTRY = "0x67b2f847d7805501c3db79474bdb33e7538825fa0f83aa3cd0083f02ee655c4";
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
    expect(await events.count()).toBe(1);
    expect((await coordinator.getCheckpoint())?.scanWatermark).toBe(10);

    const second = await coordinator.runOnce();
    expect(second.reason).toBe("empty_scan_checkpoint_advanced");
    expect((await coordinator.getCheckpoint())?.nextFromBlock).toBe(13);
    expect(source.calls()).toBe(2);
  });

  it("replays duplicate events safely after restart", async () => {
    const events = new InMemoryPrismEventsStore();
    const checkpoints = new InMemoryEventProjectionCheckpointStore();
    const source = indexer([{ events: [EVENT], watermark: 10 }, { events: [EVENT], watermark: 10 }]);
    const make = () => new EventProjectionCoordinator({ registryAddress: REGISTRY, network: "SN_SEPOLIA", initialFromBlock: 0, checkpointStore: checkpoints, eventsStore: events, indexer: source });
    await make().runOnce();
    // Simulate a replay from an older range by using a fresh checkpoint store.
    const replay = new EventProjectionCoordinator({ registryAddress: REGISTRY, network: "SN_SEPOLIA", initialFromBlock: 0, checkpointStore: new InMemoryEventProjectionCheckpointStore(), eventsStore: events, indexer: source });
    const result = await replay.runOnce();
    expect(result.inserted).toBe(0);
    expect(result.duplicates).toBe(1);
    expect(await events.count()).toBe(1);
  });

  it("does not advance checkpoint when event persistence fails", async () => {
    const checkpoints = new InMemoryEventProjectionCheckpointStore();
    const failing = new InMemoryPrismEventsStore();
    const original = failing.insertMany.bind(failing);
    failing.insertMany = async () => { throw new Error("db_write_failed"); };
    const source = indexer([{ events: [EVENT], watermark: 10 }]);
    const coordinator = new EventProjectionCoordinator({ registryAddress: REGISTRY, network: "SN_SEPOLIA", initialFromBlock: 0, checkpointStore: checkpoints, eventsStore: failing, indexer: source });
    await expect(coordinator.runOnce()).rejects.toThrow("db_write_failed");
    expect(await checkpoints.get(REGISTRY)).toBeNull();
    failing.insertMany = original;
  });

  it("allows exactly one concurrent initial checkpoint winner", async () => {
    const events = new InMemoryPrismEventsStore();
    const checkpoints = new InMemoryEventProjectionCheckpointStore();
    const source = indexer([{ events: [EVENT], watermark: 10 }, { events: [EVENT], watermark: 10 }]);
    const make = () => new EventProjectionCoordinator({ registryAddress: REGISTRY, network: "SN_SEPOLIA", initialFromBlock: 0, checkpointStore: checkpoints, eventsStore: events, indexer: source });
    const results = await Promise.all([make().runOnce(), make().runOnce()]);
    expect(results.filter((result) => result.advanced)).toHaveLength(1);
    expect(results.filter((result) => result.reason === "checkpoint_cas_conflict")).toHaveLength(1);
    expect(await events.count()).toBe(1);
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
    expect(await events.count()).toBe(1);
  });

  it("keeps checkpoint CAS state independent for multiple registries", async () => {
    const checkpoints = new InMemoryEventProjectionCheckpointStore();
    const registryB = "0x77b2f847d7805501c3db79474bdb33e7538825fa0f83aa3cd0083f02ee655c4";
    const inputA = {
      registryAddress: REGISTRY,
      network: "SN_SEPOLIA",
      nextFromBlock: 11,
      scanWatermark: 10,
      eventWatermark: 10,
      continuationToken: null,
    };
    const inputB = { ...inputA, registryAddress: registryB, nextFromBlock: 21, scanWatermark: 20, eventWatermark: null };

    expect(await checkpoints.compareAndSet(null, inputA, 100)).toBe(true);
    expect(await checkpoints.compareAndSet(null, inputB, 100)).toBe(true);
    expect((await checkpoints.get(REGISTRY))?.nextFromBlock).toBe(11);
    expect((await checkpoints.get(registryB))?.nextFromBlock).toBe(21);
    expect(await checkpoints.compareAndSet(0, { ...inputA, nextFromBlock: 12, scanWatermark: 11, eventWatermark: 11 }, 101)).toBe(true);
    expect((await checkpoints.get(registryB))?.nextFromBlock).toBe(21);
  });

  it("fails closed when scan watermark is unavailable", async () => {
    const events = new InMemoryPrismEventsStore();
    const checkpoints = new InMemoryEventProjectionCheckpointStore();
    const source = indexer([{ events: [], watermark: null }]);
    const coordinator = new EventProjectionCoordinator({ registryAddress: REGISTRY, network: "SN_SEPOLIA", initialFromBlock: 0, checkpointStore: checkpoints, eventsStore: events, indexer: source });
    const result = await coordinator.runOnce();
    expect(result.advanced).toBe(false);
    expect(result.reason).toBe("missing_scan_watermark");
    expect(await checkpoints.get(REGISTRY)).toBeNull();
  });
});
