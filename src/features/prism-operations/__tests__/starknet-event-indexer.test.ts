import { describe, it, expect } from "vitest";
import type { Hex } from "../domain/operation";
import { StarknetEventIndexerAdapter, type StarknetEventReader } from "../adapters/starknet-event-indexer";

const REGISTRY = "0x1111111111111111111111111111111111111111";
const TX_A: Hex = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TX_B: Hex = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TX_C: Hex = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

function readerWithEvents(events: Array<{ block_number?: number; transaction_hash: string; event_index?: number; keys?: string[]; data?: string[] }>): StarknetEventReader {
  return {
    async getEvents() {
      return { events: events as unknown as StarknetEventReader extends { getEvents: (f: infer F) => Promise<infer R> } ? R extends { events: Array<infer E> } ? E[] : never : never, continuation_token: null } as Awaited<ReturnType<StarknetEventReader["getEvents"]>>;
    },
  };
}

describe("StarknetEventIndexerAdapter — deterministic ordering & idempotency", () => {
  it("fetch sorts by (block_number, transaction_hash, event_index) deterministically", async () => {
    const reader = readerWithEvents([
      { block_number: 10, transaction_hash: TX_B, event_index: 1, keys: ["0x1"], data: ["0x1"] },
      { block_number: 5, transaction_hash: TX_C, event_index: 0, keys: ["0x1"], data: ["0x1"] },
      { block_number: 10, transaction_hash: TX_A, event_index: 2, keys: ["0x1"], data: ["0x1"] },
      { block_number: 10, transaction_hash: TX_A, event_index: 0, keys: ["0x1"], data: ["0x1"] },
    ]);
    const adapter = new StarknetEventIndexerAdapter({ reader, registryAddress: REGISTRY });
    const res = await adapter.fetchRegistryEvents({ fromBlock: 0 });
    expect(res.events.map((e) => [e.blockNumber, e.txHash, e.eventIndex])).toEqual([
      [5, TX_C, 0],
      [10, TX_A, 0],
      [10, TX_A, 2],
      [10, TX_B, 1],
    ]);
  });

  it("deduplicates by (tx_hash,event_index) — idempotent key", async () => {
    const reader = readerWithEvents([
      { block_number: 10, transaction_hash: TX_A, event_index: 0, keys: ["0x1"], data: ["0x1"] },
      { block_number: 10, transaction_hash: TX_A, event_index: 0, keys: ["0x1"], data: ["0x1"] },
      { block_number: 10, transaction_hash: TX_A, event_index: 1, keys: ["0x1"], data: ["0x1"] },
    ]);
    const adapter = new StarknetEventIndexerAdapter({ reader, registryAddress: REGISTRY });
    const res = await adapter.fetchRegistryEvents({ fromBlock: 0 });
    expect(res.events).toHaveLength(2);
    expect(res.events.map((e) => e.eventIndex)).toEqual([0, 1]);
  });

  it("skips malformed tx_hash (not fabricated) — fail-closed", async () => {
    const reader = readerWithEvents([
      { block_number: 10, transaction_hash: "bad-hash", event_index: 0, keys: ["0x1"], data: ["0x1"] },
      { block_number: 10, transaction_hash: TX_B, event_index: 0, keys: ["0x1"], data: ["0x1"] },
    ]);
    const adapter = new StarknetEventIndexerAdapter({ reader, registryAddress: REGISTRY });
    const res = await adapter.fetchRegistryEvents({ fromBlock: 0 });
    expect(res.events).toHaveLength(1);
    expect(res.events[0].txHash).toBe(TX_B);
  });

  it("computes watermark as max blockNumber", async () => {
    const reader = readerWithEvents([
      { block_number: 7, transaction_hash: TX_A, event_index: 0, keys: ["0x1"], data: ["0x1"] },
      { block_number: 12, transaction_hash: TX_B, event_index: 0, keys: ["0x1"], data: ["0x1"] },
      { block_number: 3, transaction_hash: TX_C, event_index: 0, keys: ["0x1"], data: ["0x1"] },
    ]);
    const adapter = new StarknetEventIndexerAdapter({ reader, registryAddress: REGISTRY });
    const res = await adapter.fetchRegistryEvents({ fromBlock: 0 });
    expect(res.watermark).toBe(12);
  });

  it("observeIndexer returns eventObserved=false when tx not found (missed event)", async () => {
    const reader = readerWithEvents([{ block_number: 10, transaction_hash: TX_A, event_index: 0, keys: ["0x1"], data: ["0x1"] }]);
    const adapter = new StarknetEventIndexerAdapter({ reader, registryAddress: REGISTRY });
    const obs = await adapter.observeIndexer(TX_B);
    expect(obs?.eventObserved).toBe(false);
  });

  it("observeIndexer returns eventObserved=true with block/eventIndex when found", async () => {
    const reader = readerWithEvents([{ block_number: 42, transaction_hash: TX_A, event_index: 3, keys: ["0x1"], data: ["0x1"] }]);
    const adapter = new StarknetEventIndexerAdapter({ reader, registryAddress: REGISTRY });
    const obs = await adapter.observeIndexer(TX_A);
    expect(obs).toMatchObject({ eventObserved: true, blockNumber: 42, eventIndex: 3 });
  });

  it("observeReconciliation matches when event observed", async () => {
    const reader = readerWithEvents([{ block_number: 42, transaction_hash: TX_A, event_index: 0, keys: ["0x1"], data: ["0x1"] }]);
    const adapter = new StarknetEventIndexerAdapter({ reader, registryAddress: REGISTRY });
    const r = await adapter.observeReconciliation(TX_A);
    expect(r.chainReceiptMatched).toBe(true);
    expect(r.eventMatchedToOperation).toBe(true);
  });

  it("fail-closed on reader dependency error (throws StarknetEventIndexerError)", async () => {
    const reader: StarknetEventReader = {
      async getEvents() {
        throw new Error("rpc_unavailable");
      },
    };
    const adapter = new StarknetEventIndexerAdapter({ reader, registryAddress: REGISTRY });
    await expect(adapter.fetchRegistryEvents({ fromBlock: 0 })).rejects.toThrow(/getEvents failed/);
    await expect(adapter.observeIndexer(TX_A)).rejects.toThrow(/observeIndexer failed/);
  });

  it("injected reader only — constructor rejects missing reader", () => {
    expect(() => new StarknetEventIndexerAdapter({ reader: null as unknown as StarknetEventReader, registryAddress: REGISTRY })).toThrow(
      /injected reader/,
    );
  });

  it("reconstructs events via domain applyEvent with idempotent key (tx_hash,event_index)", async () => {
    // Prove the adapter's output is consumable by the domain's idempotent event-indexer
    const { emptyProjection, applyEvent, eventKey } = await import("../domain/event-indexer");
    let state = emptyProjection();
    const reader = readerWithEvents([
      { block_number: 10, transaction_hash: TX_A, event_index: 0, keys: ["0x1"], data: ["0x1"] },
      { block_number: 10, transaction_hash: TX_A, event_index: 0, keys: ["0x1"], data: ["0x1"] },
    ]);
    const adapter = new StarknetEventIndexerAdapter({ reader, registryAddress: REGISTRY });
    const res = await adapter.fetchRegistryEvents({ fromBlock: 0 });
    expect(res.events).toHaveLength(1); // deduped
    for (const ev of res.events) {
      const r = applyEvent(state, ev);
      expect(r.error).toBeUndefined();
      state = r.state;
    }
    expect(state.seenKeys.has(eventKey(TX_A, 0))).toBe(true);
    // Duplicate via domain also benign
    const dup = applyEvent(state, res.events[0]);
    expect(dup.isDuplicate).toBe(true);
  });
});
