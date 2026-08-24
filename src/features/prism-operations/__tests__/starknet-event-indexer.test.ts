import { describe, it, expect } from "vitest";
import type { Hex } from "../domain/operation";
import { StarknetEventIndexerAdapter, type StarknetEventReader, PRISM_EVENT_SELECTORS } from "../adapters/starknet-event-indexer";

const REGISTRY = "0x1111111111111111111111111111111111111111";
const TX_A: Hex = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TX_B: Hex = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TX_C: Hex = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

const SEL_CREATED = PRISM_EVENT_SELECTORS.PrismIdentityCreated;
const SEL_BOUND = PRISM_EVENT_SELECTORS.ExecutionIdentityBound;
const SEL_REVOKED = PRISM_EVENT_SELECTORS.BindingRevoked;

function prismCreatedKeys(prismId = "0x1"): string[] {
  return [SEL_CREATED, prismId];
}
function prismBoundKeys(prismId = "0x1", venue = "0x42415345", acct = "0x2"): string[] {
  // venue 'BASE' felt 0x42415345, execution_account
  return [SEL_BOUND, prismId, venue, acct];
}
function prismRevokedKeys(prismId = "0x1", venue = "0x42415345", acct = "0x2"): string[] {
  return [SEL_REVOKED, prismId, venue, acct];
}

function readerWithEvents(events: Array<{ block_number?: number; transaction_hash: string; event_index?: number; keys?: string[]; data?: string[] }>): StarknetEventReader {
  return {
    async getEvents() {
      return { events: events as unknown as StarknetEventReader extends { getEvents: (f: infer F) => Promise<infer R> } ? R extends { events: Array<infer E> } ? E[] : never : never, continuation_token: null } as Awaited<ReturnType<StarknetEventReader["getEvents"]>>;
    },
  };
}

function paginatedReader(pages: Array<{ events: Array<{ block_number?: number; transaction_hash: string; event_index?: number; keys?: string[]; data?: string[] }>; continuation_token: string | null }>): StarknetEventReader {
  let call = 0;
  return {
    async getEvents(filter: { continuation_token?: string | null }) {
      // ignore filter except continuation token sequencing
      void filter;
      const page = pages[call] ?? { events: [], continuation_token: null };
      call++;
      return { events: page.events as never[], continuation_token: page.continuation_token } as never;
    },
  };
}

describe("StarknetEventIndexerAdapter — deterministic ordering & idempotency", () => {
  it("fetch sorts by (block_number, transaction_hash, event_index) deterministically", async () => {
    const reader = readerWithEvents([
      { block_number: 10, transaction_hash: TX_B, event_index: 1, keys: prismBoundKeys("0x2", "0x42415345", TX_B), data: [TX_B] },
      { block_number: 5, transaction_hash: TX_C, event_index: 0, keys: prismCreatedKeys("0x3"), data: ["0x1111"] },
      { block_number: 10, transaction_hash: TX_A, event_index: 2, keys: prismCreatedKeys("0x4"), data: ["0x2222"] },
      { block_number: 10, transaction_hash: TX_A, event_index: 0, keys: prismCreatedKeys("0x5"), data: ["0x3333"] },
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
      { block_number: 10, transaction_hash: TX_A, event_index: 0, keys: prismCreatedKeys("0x1"), data: ["0x1111"] },
      { block_number: 10, transaction_hash: TX_A, event_index: 0, keys: prismCreatedKeys("0x1"), data: ["0x1111"] },
      { block_number: 10, transaction_hash: TX_A, event_index: 1, keys: prismCreatedKeys("0x2"), data: ["0x2222"] },
    ]);
    const adapter = new StarknetEventIndexerAdapter({ reader, registryAddress: REGISTRY });
    const res = await adapter.fetchRegistryEvents({ fromBlock: 0 });
    expect(res.events).toHaveLength(2);
    expect(res.events.map((e) => e.eventIndex)).toEqual([0, 1]);
  });

  it("skips malformed tx_hash (not fabricated) — fail-closed", async () => {
    const reader = readerWithEvents([
      { block_number: 10, transaction_hash: "bad-hash", event_index: 0, keys: prismCreatedKeys("0x1"), data: ["0x1"] },
      { block_number: 10, transaction_hash: TX_B, event_index: 0, keys: prismCreatedKeys("0x9"), data: ["0x9999"] },
    ]);
    const adapter = new StarknetEventIndexerAdapter({ reader, registryAddress: REGISTRY });
    const res = await adapter.fetchRegistryEvents({ fromBlock: 0 });
    expect(res.events).toHaveLength(1);
    expect(res.events[0].txHash).toBe(TX_B);
  });

  it("normalizes Starknet.js short-form transaction hashes without dropping events", async () => {
    const reader = readerWithEvents([
      { block_number: 10, transaction_hash: "0x457a43d908da21e8acd723ba94639d6009c123ec4c4d944175f2bbfa05e3a6f", event_index: 0, keys: prismCreatedKeys("0x1"), data: ["0x1"] },
    ]);
    const adapter = new StarknetEventIndexerAdapter({ reader, registryAddress: REGISTRY });
    const result = await adapter.fetchRegistryEvents({ fromBlock: 0 });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].txHash).toBe("0x0457a43d908da21e8acd723ba94639d6009c123ec4c4d944175f2bbfa05e3a6f");
  });

  it("reconstructs exact V2 u256 digest from low/high event limbs", async () => {
    const reader = readerWithEvents([
      { block_number: 10, transaction_hash: TX_A, event_index: 0, keys: [SEL_BOUND, "0x1", "0x42415345", "0xabc"], data: ["0x42", "0x1234"] },
    ]);
    const adapter = new StarknetEventIndexerAdapter({ reader, registryAddress: REGISTRY, registryVersion: "v2" });
    const result = await adapter.fetchRegistryEvents({ fromBlock: 0 });
    expect(result.events).toHaveLength(1);
    expect((result.events[0].payload as { proofDigest: string }).proofDigest).toBe(`0x${(0x1234n << 128n | 0x42n).toString(16).padStart(64, "0")}`);
  });

  it("rejects V2 bound events with unsupported venue or missing execution key", async () => {
    const unsupported = readerWithEvents([
      { block_number: 10, transaction_hash: TX_A, event_index: 0, keys: [SEL_BOUND, "0x1", "0xdead", "0xabc"], data: ["0x42", "0x1234"] },
    ]);
    const missingAccount = readerWithEvents([
      { block_number: 10, transaction_hash: TX_B, event_index: 0, keys: [SEL_BOUND, "0x1", "0x42415345"], data: ["0x42", "0x1234"] },
    ]);
    expect((await new StarknetEventIndexerAdapter({ reader: unsupported, registryAddress: REGISTRY, registryVersion: "v2" }).fetchRegistryEvents({ fromBlock: 0 })).events).toHaveLength(0);
    expect((await new StarknetEventIndexerAdapter({ reader: missingAccount, registryAddress: REGISTRY, registryVersion: "v2" }).fetchRegistryEvents({ fromBlock: 0 })).events).toHaveLength(0);
  });

  it("computes watermark as max blockNumber", async () => {
    const reader = readerWithEvents([
      { block_number: 7, transaction_hash: TX_A, event_index: 0, keys: prismCreatedKeys("0x1"), data: ["0x1111"] },
      { block_number: 12, transaction_hash: TX_B, event_index: 0, keys: prismCreatedKeys("0x2"), data: ["0x2222"] },
      { block_number: 3, transaction_hash: TX_C, event_index: 0, keys: prismCreatedKeys("0x3"), data: ["0x3333"] },
    ]);
    const adapter = new StarknetEventIndexerAdapter({ reader, registryAddress: REGISTRY });
    const res = await adapter.fetchRegistryEvents({ fromBlock: 0 });
    expect(res.watermark).toBe(12);
  });

  it("observeIndexer returns eventObserved=false when tx not found (missed event)", async () => {
    const reader = readerWithEvents([{ block_number: 10, transaction_hash: TX_A, event_index: 0, keys: prismCreatedKeys("0x1"), data: ["0x1111"] }]);
    const adapter = new StarknetEventIndexerAdapter({ reader, registryAddress: REGISTRY });
    const obs = await adapter.observeIndexer(TX_B);
    expect(obs?.eventObserved).toBe(false);
  });

  it("observeIndexer returns eventObserved=true with block/eventIndex when found", async () => {
    const reader = readerWithEvents([{ block_number: 42, transaction_hash: TX_A, event_index: 3, keys: prismCreatedKeys("0x1"), data: ["0x1111"] }]);
    const adapter = new StarknetEventIndexerAdapter({ reader, registryAddress: REGISTRY });
    const obs = await adapter.observeIndexer(TX_A);
    expect(obs).toMatchObject({ eventObserved: true, blockNumber: 42, eventIndex: 3 });
  });

  it("observeReconciliation matches when event observed", async () => {
    const reader = readerWithEvents([{ block_number: 42, transaction_hash: TX_A, event_index: 0, keys: prismCreatedKeys("0x1"), data: ["0x1111"] }]);
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
      { block_number: 10, transaction_hash: TX_A, event_index: 0, keys: prismCreatedKeys("0x1"), data: ["0x1111"] },
      { block_number: 10, transaction_hash: TX_A, event_index: 0, keys: prismCreatedKeys("0x1"), data: ["0x1111"] },
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

  it("pagination continuation: fetchAll aggregates pages via continuation_token with deterministic ordering", async () => {
    const reader = paginatedReader([
      {
        events: [
          { block_number: 10, transaction_hash: TX_B, event_index: 1, keys: prismCreatedKeys("0x10"), data: ["0xaaaa"] },
          { block_number: 5, transaction_hash: TX_C, event_index: 0, keys: prismCreatedKeys("0x11"), data: ["0xbbbb"] },
        ],
        continuation_token: "page2",
      },
      {
        events: [
          { block_number: 10, transaction_hash: TX_A, event_index: 0, keys: prismCreatedKeys("0x12"), data: ["0xcccc"] },
          { block_number: 10, transaction_hash: TX_B, event_index: 1, keys: prismCreatedKeys("0x10"), data: ["0xaaaa"] }, // duplicate across pages
        ],
        continuation_token: null,
      },
    ]);
    const adapter = new StarknetEventIndexerAdapter({ reader, registryAddress: REGISTRY, chunkSize: 2 });
    const res = await adapter.fetchAllRegistryEvents({ fromBlock: 0 });
    expect(res.pagesFetched).toBe(2);
    expect(res.events.map((e) => [e.blockNumber, e.txHash, e.eventIndex])).toEqual([
      [5, TX_C, 0],
      [10, TX_A, 0],
      [10, TX_B, 1],
    ]);
    expect(res.watermark).toBe(10);
  });

  it("event selector mapping: only known selectors are accepted, unknown dropped", async () => {
    const reader = readerWithEvents([
      { block_number: 10, transaction_hash: TX_A, event_index: 0, keys: [SEL_CREATED, "0x1"], data: ["0x1111"] },
      { block_number: 10, transaction_hash: TX_A, event_index: 1, keys: [SEL_BOUND, "0x1", "0x42415345", "0x2"], data: ["0xdeadbeef"] },
      { block_number: 10, transaction_hash: TX_A, event_index: 2, keys: [SEL_REVOKED, "0x1", "0x42415345", "0x2"], data: [] },
      { block_number: 10, transaction_hash: TX_B, event_index: 0, keys: ["0xdead"], data: ["0x1"] }, // unknown
      { block_number: 10, transaction_hash: TX_B, event_index: 1, keys: [], data: ["0x1"] }, // empty keys
    ]);
    const adapter = new StarknetEventIndexerAdapter({ reader, registryAddress: REGISTRY });
    const res = await adapter.fetchRegistryEvents({ fromBlock: 0 });
    expect(res.events).toHaveLength(3);
    expect(res.events.map((e) => e.kind).sort()).toEqual(["BindingRevoked", "ExecutionIdentityBound", "PrismIdentityCreated"].sort());
  });
});
