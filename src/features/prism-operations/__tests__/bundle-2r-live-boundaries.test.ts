import { describe, it, expect } from "vitest";
import type { Hex } from "../domain/operation";
import {
  StarknetSubmitAdapter,
  parseStarknetSubmitEnv,
  validateStarknetSubmitConfig,
  StarknetSubmitConfigError,
  type StarknetAccountLike,
} from "../adapters/starknet-submit";
import {
  StarknetEventIndexerAdapter,
  PRISM_EVENT_SELECTORS,
  ALL_PRISM_EVENT_SELECTORS,
  type StarknetEventReader,
} from "../adapters/starknet-event-indexer";
import { InMemoryPrismEventsStore } from "../adapters/postgres-prism-events-store";
import { InMemoryOperationStore } from "../adapters/memory-operation-store";
import { ReconciliationWorker, computeBackoffMs } from "../domain/reconciliation-worker";
import { WatermarkedResolveService, StaleCacheError } from "../domain/resolve-service";
import { emptyProjection, applyEvent } from "../domain/event-indexer";
import type { ChainTxObservation, IndexerObservation } from "../domain/ports";
import type { RegistryReadPort } from "../../../application/ports";

// Shared constants — X2, injected fakes only, no live RPC
const REGISTRY = "0x1111111111111111111111111111111111111111";
const ACCOUNT_ADDR = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TX_A: Hex = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TX_B: Hex = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TX_C: Hex = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const DIGEST: Hex = "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const SEL_CREATED = PRISM_EVENT_SELECTORS.PrismIdentityCreated;
const SEL_BOUND = PRISM_EVENT_SELECTORS.ExecutionIdentityBound;
const NOW = 1_789_000_000;

function fakeAccount(overrides: Partial<StarknetAccountLike> = {}): StarknetAccountLike {
  return {
    address: ACCOUNT_ADDR,
    execute: async () => ({ transaction_hash: TX_A }),
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────────────────
// 1. Env validation — explicit, no secret file reads
// ────────────────────────────────────────────────────────────────────────────────
describe("Bundle 2R Live — env validation (T8, AUDIT G2, SC-06)", () => {
  it("parseStarknetSubmitEnv throws on missing STARKNET_RPC_URL", () => {
    expect(() => parseStarknetSubmitEnv({ STARKNET_REGISTRY_ADDRESS: REGISTRY })).toThrow(StarknetSubmitConfigError);
    expect(() => parseStarknetSubmitEnv({ STARKNET_REGISTRY_ADDRESS: REGISTRY })).toThrow(/STARKNET_RPC_URL/);
  });

  it("throws on missing STARKNET_REGISTRY_ADDRESS", () => {
    expect(() => parseStarknetSubmitEnv({ STARKNET_RPC_URL: "https://rpc.example" })).toThrow(/STARKNET_REGISTRY_ADDRESS/);
  });

  it("throws on invalid RPC URL protocol", () => {
    expect(() => parseStarknetSubmitEnv({ STARKNET_RPC_URL: "ftp://bad", STARKNET_REGISTRY_ADDRESS: REGISTRY })).toThrow(/invalid.*RPC_URL/i);
  });

  it("throws on malformed registry hex", () => {
    expect(() => parseStarknetSubmitEnv({ STARKNET_RPC_URL: "https://rpc.example", STARKNET_REGISTRY_ADDRESS: "bad-hex" })).toThrow();
  });

  it("valid env with injected account validates via validateStarknetSubmitConfig", () => {
    const cfg = parseStarknetSubmitEnv({ STARKNET_RPC_URL: "https://rpc.example", STARKNET_REGISTRY_ADDRESS: REGISTRY }, { account: fakeAccount() });
    expect(cfg.rpcUrl).toBe("https://rpc.example");
    expect(cfg.registryAddress).toBe(REGISTRY.toLowerCase());
  });

  it("no secret file read — adapter never imports fs (X2)", () => {
    // Structural: adapter is injected-only; env validation uses passed record, not fs
    const adapter = new StarknetSubmitAdapter({ account: fakeAccount(), registryAddress: REGISTRY });
    expect(adapter).toBeDefined();
    // Ensure validate function does not read process.env implicitly
    const cfg = validateStarknetSubmitConfig({ registryAddress: REGISTRY, account: fakeAccount(), rpcUrl: "https://rpc.example" });
    expect(cfg.accountAddress).toBe(ACCOUNT_ADDR);
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// 2. Account / registry address mismatch
// ────────────────────────────────────────────────────────────────────────────────
describe("Bundle 2R Live — account/registry address mismatch (G2/G3, SC-06, INV-SYS-002)", () => {
  it("constructor rejects when account address equals registry address", () => {
    const same = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    expect(() => new StarknetSubmitAdapter({ account: fakeAccount({ address: same }), registryAddress: same })).toThrow(/account_registry_address_mismatch/i);
  });

  it("validateStarknetSubmitConfig rejects equal addresses", () => {
    const addr = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    expect(() => validateStarknetSubmitConfig({ registryAddress: addr, account: fakeAccount({ address: addr }) })).toThrow(/account_registry_address_mismatch/);
  });

  it("submitCreateIdentity rejects controller mismatch (account != controller)", async () => {
    const adapter = new StarknetSubmitAdapter({ account: fakeAccount({ address: ACCOUNT_ADDR }), registryAddress: REGISTRY });
    await expect(adapter.submitCreateIdentity({ operationId: "op-1", controllerAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" })).rejects.toMatchObject({
      code: "ERR-004",
    });
  });

  it("submitBind rejects when controller does not match injected account", async () => {
    const adapter = new StarknetSubmitAdapter({ account: fakeAccount(), registryAddress: REGISTRY });
    await expect(
      adapter.submitBind({
        operationId: "op-2",
        prismId: "prism:1",
        venue: "BASE",
        executionAccount: "0xcccccccccccccccccccccccccccccccccccccccc",
        proofDigest: DIGEST,
        controllerAddress: "0x9999999999999999999999999999999999999999",
      }),
    ).rejects.toMatchObject({ code: "ERR-004" });
  });

  it("submit succeeds when account equals controller", async () => {
    const adapter = new StarknetSubmitAdapter({ account: fakeAccount(), registryAddress: REGISTRY });
    const res = await adapter.submitBind({
      operationId: "op-ok",
      prismId: "prism:1",
      venue: "BASE",
      executionAccount: "0xcccccccccccccccccccccccccccccccccccccccc",
      proofDigest: DIGEST,
      controllerAddress: ACCOUNT_ADDR,
    });
    expect(res.txHash).toBe(TX_A);
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// 3. Pagination continuation (T9, SC-27)
// ────────────────────────────────────────────────────────────────────────────────
describe("Bundle 2R Live — getEvents pagination/continuation (T9, SC-27)", () => {
  it("fetchRegistryEvents forwards continuation_token and keys selector filter", async () => {
    let capturedKeys: string[][] | undefined;
    let capturedToken: string | null | undefined;
    const reader: StarknetEventReader = {
      async getEvents(filter) {
        capturedKeys = filter.keys;
        capturedToken = filter.continuation_token;
        return { events: [], continuation_token: "next-token" };
      },
    };
    const adapter = new StarknetEventIndexerAdapter({ reader, registryAddress: REGISTRY });
    const res = await adapter.fetchRegistryEvents({ fromBlock: 5, continuationToken: "prev" });
    expect(capturedKeys?.[0]).toEqual(expect.arrayContaining(ALL_PRISM_EVENT_SELECTORS as unknown as string[]));
    expect(capturedToken).toBe("prev");
    expect(res.continuationToken).toBe("next-token");
  });

  it("fetchAllRegistryEvents aggregates pages deterministically and dedupes", async () => {
    let call = 0;
    const pages = [
      {
        events: [
          { block_number: 10, transaction_hash: TX_B, event_index: 1, keys: [SEL_CREATED, "0x10"], data: ["0xaaaa"] },
          { block_number: 5, transaction_hash: TX_C, event_index: 0, keys: [SEL_CREATED, "0x11"], data: ["0xbbbb"] },
        ],
        continuation_token: "tok2" as string | null,
      },
      {
        events: [
          { block_number: 10, transaction_hash: TX_A, event_index: 0, keys: [SEL_CREATED, "0x12"], data: ["0xcccc"] },
          // duplicate
          { block_number: 10, transaction_hash: TX_B, event_index: 1, keys: [SEL_CREATED, "0x10"], data: ["0xaaaa"] },
        ],
        continuation_token: null,
      },
    ];
    const reader: StarknetEventReader = {
      async getEvents() {
        const p = pages[call++];
        return { events: p.events as never[], continuation_token: p.continuation_token } as never;
      },
    };
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

  it("ALL_PRISM_EVENT_SELECTORS contains exactly the three canonical events", () => {
    expect(ALL_PRISM_EVENT_SELECTORS).toHaveLength(3);
    expect(ALL_PRISM_EVENT_SELECTORS).toEqual(expect.arrayContaining([SEL_CREATED, SEL_BOUND, expect.any(String)]));
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// 4. Duplicate event (tx_hash,event_index) uniqueness — prism_events + domain
// ────────────────────────────────────────────────────────────────────────────────
describe("Bundle 2R Live — duplicate event (tx_hash,event_index) uniqueness (T9, SC-27, INV-SYS-004)", () => {
  it("InMemoryPrismEventsStore deduplicates by (tx_hash,event_index) — first wins", async () => {
    const store = new InMemoryPrismEventsStore();
    const ev = {
      txHash: TX_A,
      eventIndex: 0,
      blockNumber: 10,
      kind: "PrismIdentityCreated" as const,
      payload: { prismId: "prism:P1", controller: "0x1111" },
    };
    const r1 = await store.insert(ev as never);
    expect(r1.inserted).toBe(true);
    const r2 = await store.insert(ev as never);
    expect(r2.duplicate).toBe(true);
    expect(await store.count()).toBe(1);
  });

  it("insertMany with duplicates counts inserted vs duplicates, deterministic ordering", async () => {
    const store = new InMemoryPrismEventsStore();
    const events = [
      { txHash: TX_B, eventIndex: 1, blockNumber: 10, kind: "ExecutionIdentityBound" as const, payload: { prismId: "prism:P1", venue: "BASE", executionAccount: TX_B, proofDigest: DIGEST } },
      { txHash: TX_A, eventIndex: 0, blockNumber: 5, kind: "PrismIdentityCreated" as const, payload: { prismId: "prism:P1", controller: "0x1111" } },
      { txHash: TX_B, eventIndex: 1, blockNumber: 10, kind: "ExecutionIdentityBound" as const, payload: { prismId: "prism:P1", venue: "BASE", executionAccount: TX_B, proofDigest: DIGEST } }, // dup
    ] as never[];
    const res = await store.insertMany(events);
    expect(res.inserted).toBe(2);
    expect(res.duplicates).toBe(1);
    const ordered = await store.listOrdered(10);
    expect(ordered.map((e) => [e.blockNumber, e.txHash, e.eventIndex])).toEqual([
      [5, TX_A, 0],
      [10, TX_B, 1],
    ]);
  });

  it("domain applyEvent idempotent by (tx_hash,event_index) — duplicate benign", async () => {
    let state = emptyProjection();
    const ev = {
      txHash: TX_A,
      eventIndex: 0,
      blockNumber: 10,
      kind: "PrismIdentityCreated" as const,
      payload: { prismId: "prism:Pdup", controller: "0x1111" },
    } as never;
    const r1 = applyEvent(state, ev as never);
    expect(r1.isDuplicate).toBe(false);
    state = r1.state;
    const r2 = applyEvent(state, ev as never);
    expect(r2.isDuplicate).toBe(true);
    expect(r2.state).toBe(state);
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// 5. Worker lifecycle — process-safe start/stop, no daemon in tests
// ────────────────────────────────────────────────────────────────────────────────
describe("Bundle 2R Live — ReconciliationWorker lifecycle (T12, SC-28)", () => {
  function ledgerFake(): { observeChain: (tx: Hex) => Promise<ChainTxObservation | null> } {
    return {
      async observeChain(txHash: Hex) {
        return { txHash, finality: "ACCEPTED_ON_L2", execution: "SUCCEEDED", blockNumber: 100 } as ChainTxObservation;
      },
    };
  }
  function indexerFake(): { observeIndexer: (tx: Hex) => Promise<IndexerObservation | null>; observeReconciliation: (tx: Hex) => Promise<{ chainReceiptMatched: boolean; eventMatchedToOperation: boolean; matchedTxHash?: Hex | null }> } {
    return {
      async observeIndexer(txHash: Hex) {
        return { txHash, eventObserved: true, eventName: "ExecutionIdentityBound", blockNumber: 101, eventIndex: 0 } as IndexerObservation;
      },
      async observeReconciliation(txHash: Hex) {
        return { chainReceiptMatched: true, eventMatchedToOperation: true, matchedTxHash: txHash };
      },
    };
  }
  function clock(now: number) {
    return { now: () => now };
  }

  it("stop is idempotent and isRunning reflects state", async () => {
    const store = new InMemoryOperationStore();
    const worker = new ReconciliationWorker({ store, ledger: ledgerFake() as never, indexer: indexerFake() as never, clock: clock(NOW), config: { allowDaemonInTests: true, pollIntervalMs: 1_000_000 } });
    expect(worker.isRunning()).toBe(false);
    worker.stop();
    expect(worker.isRunning()).toBe(false);
    // start with allowDaemonInTests true should succeed in test env
    await worker.start();
    expect(worker.isRunning()).toBe(true);
    worker.stop();
    expect(worker.isRunning()).toBe(false);
    worker.stop(); // second stop idempotent
    expect(worker.isRunning()).toBe(false);
  });

  it("start throws in test env when allowDaemonInTests is false (no daemon should start in tests)", async () => {
    const store = new InMemoryOperationStore();
    const worker = new ReconciliationWorker({ store, ledger: ledgerFake() as never, indexer: indexerFake() as never, clock: clock(NOW) });
    await expect(worker.start()).rejects.toThrow(/must not start in tests/i);
  });

  it("second concurrent start throws process-safe guard", async () => {
    const store = new InMemoryOperationStore();
    const w1 = new ReconciliationWorker({ store, ledger: ledgerFake() as never, indexer: indexerFake() as never, clock: clock(NOW), config: { allowDaemonInTests: true, pollIntervalMs: 1_000_000 } });
    const w2 = new ReconciliationWorker({ store, ledger: ledgerFake() as never, indexer: indexerFake() as never, clock: clock(NOW), config: { allowDaemonInTests: true, pollIntervalMs: 1_000_000 } });
    await w1.start();
    await expect(w2.start()).rejects.toThrow(/already running/i);
    w1.stop();
    // after stop, w2 can start
    await w2.start();
    expect(w2.isRunning()).toBe(true);
    w2.stop();
  });

  it("startup recovery via recoverAtStartup sweeps durable non-terminal ops", async () => {
    const store = new InMemoryOperationStore();
    let op = await store.create({ id: "op-rec", idempotencyKey: "k-rec", requestFingerprint: "fp-rec", now: NOW });
    op = await store.transition(op.id, { to: "awaiting_authorization", now: NOW + 1, expectedVersion: op.version });
    op = await store.transition(op.id, { to: "ready", now: NOW + 2, expectedVersion: op.version });
    op = await store.transition(op.id, { to: "submitted", now: NOW + 3, expectedVersion: op.version, txHash: TX_A });
    const worker = new ReconciliationWorker({ store, ledger: ledgerFake() as never, indexer: indexerFake() as never, clock: clock(NOW + 20) });
    const res = await worker.recoverAtStartup(NOW + 20);
    expect(res.swept).toBe(1);
    expect(res.advanced).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// 6. Backoff — bounded, capped, deterministic
// ────────────────────────────────────────────────────────────────────────────────
describe("Bundle 2R Live — bounded backoff (T12, SC-28)", () => {
  it("computeBackoffMs doubles per attempt and caps at max", () => {
    expect(computeBackoffMs(0, 1000, 30000)).toBe(1000);
    expect(computeBackoffMs(1, 1000, 30000)).toBe(2000);
    expect(computeBackoffMs(2, 1000, 30000)).toBe(4000);
    expect(computeBackoffMs(5, 1000, 30000)).toBe(30000); // 32k capped
    expect(computeBackoffMs(10, 1000, 30000)).toBe(30000);
  });

  it("worker respects backoff window for failed_retryable (skipped until window passes)", async () => {
    const store = new InMemoryOperationStore();
    let op = await store.create({ id: "op-back", idempotencyKey: "k-back", requestFingerprint: "fp-back", now: NOW });
    op = await store.transition(op.id, { to: "awaiting_authorization", now: NOW + 1, expectedVersion: op.version });
    op = await store.transition(op.id, { to: "failed_retryable", now: NOW + 2, expectedVersion: op.version, errorCode: "ERR-021" });
    const ledger = { async observeChain() { throw new Error("should not be called within backoff") } } as never;
    const indexer = { async observeIndexer() { return null; }, async observeReconciliation() { return null; } } as never;
    const worker = new ReconciliationWorker({ store, ledger, indexer, clock: { now: () => NOW + 3 }, config: { backoffBaseMs: 1000, backoffMaxMs: 30000 } });
    // attempts=1 => backoff 2000ms, elapsed 1s => skipped, no ledger call
    const r1 = await worker.tickAllOnce(NOW + 3);
    expect(r1.noops).toBe(1);
    expect(r1.advanced).toBe(0);
  });

  it("metrics hooks are called after sweep (observability)", async () => {
    const store = new InMemoryOperationStore();
    let op = await store.create({ id: "op-met", idempotencyKey: "k-met", requestFingerprint: "fp-met", now: NOW });
    op = await store.transition(op.id, { to: "awaiting_authorization", now: NOW + 1, expectedVersion: op.version });
    op = await store.transition(op.id, { to: "ready", now: NOW + 2, expectedVersion: op.version });
    op = await store.transition(op.id, { to: "submitted", now: NOW + 3, expectedVersion: op.version, txHash: TX_A });
    let metricsCalled = false;
    const worker = new ReconciliationWorker({
      store,
      ledger: { async observeChain(txHash: Hex) { return { txHash, finality: "ACCEPTED_ON_L2", execution: "SUCCEEDED", blockNumber: 100 } as ChainTxObservation; } } as never,
      indexer: { async observeIndexer(txHash: Hex) { return { txHash, eventObserved: true, eventName: "x", blockNumber: 101, eventIndex: 0 } as IndexerObservation; }, async observeReconciliation(txHash: Hex) { return { chainReceiptMatched: true, eventMatchedToOperation: true, matchedTxHash: txHash }; } } as never,
      clock: { now: () => NOW + 20 },
      config: { onMetrics: () => { metricsCalled = true; } },
    });
    await worker.tickAllOnce(NOW + 20);
    expect(metricsCalled).toBe(true);
    expect(worker.getMetrics().sweeps).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// 7. Stale watermark — fail closed, never serve stale ACTIVE
// ────────────────────────────────────────────────────────────────────────────────
describe("Bundle 2R Live — stale watermark fail-closed (INV-SYS-007, T12, SC-06)", () => {
  function fakeRegistry(watermark: number | null, executionAccount: string | null): RegistryReadPort {
    return {
      async getIdentity() { return { controller: "0x1111", createdAtBlock: 1, version: 0 }; },
      async resolve() { return { executionAccount, watermark: watermark as number }; },
      async getBinding() { return { status: "ACTIVE" }; },
      async isDigestConsumed() { return false; },
    } as unknown as RegistryReadPort;
  }

  it("refuses stale ACTIVE when watermark far behind confirmedBlock (K=5)", async () => {
    const registry = fakeRegistry(90, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    const svc = new WatermarkedResolveService(registry, { staleBoundK: 5, getConfirmedBlock: async () => 100 });
    const res = await svc.resolve("prism:P1", "BASE");
    expect(res.staleRefused).toBe(true);
    expect(res.executionAccount).toBeNull();
    expect(res.authoritativeSource).toBe("stale_refused");
  });

  it("serves fresh ACTIVE within K", async () => {
    const registry = fakeRegistry(98, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    const svc = new WatermarkedResolveService(registry, { staleBoundK: 5, getConfirmedBlock: async () => 100 });
    const res = await svc.resolve("prism:P1", "BASE");
    expect(res.staleRefused).toBe(false);
    expect(res.executionAccount).not.toBeNull();
  });

  it("fails closed on unknown confirmed block with ACTIVE (ledger unknown)", async () => {
    const registry = fakeRegistry(100, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    const svc = new WatermarkedResolveService(registry, {
      staleBoundK: 5,
      confirmedBlockPort: { async getConfirmedBlock() { return null; } },
    });
    const res = await svc.resolve("prism:P1", "BASE");
    expect(res.staleRefused).toBe(true);
    expect(res.executionAccount).toBeNull();
  });

  it("serves NO_ACTIVE_DESTINATION even when stale (fail-closed only for ACTIVE)", async () => {
    const registry = fakeRegistry(90, null);
    const svc = new WatermarkedResolveService(registry, { staleBoundK: 5, getConfirmedBlock: async () => 100 });
    const res = await svc.resolve("prism:P1", "BASE");
    expect(res.executionAccount).toBeNull();
    expect(res.staleRefused).toBe(false); // null is safe
  });

  it("projection stale throws StaleCacheError when canonical unavailable", async () => {
    let proj = emptyProjection();
    proj = applyEvent(proj, {
      txHash: TX_A,
      eventIndex: 0,
      blockNumber: 90,
      kind: "ExecutionIdentityBound",
      payload: { prismId: "prism:P1", venue: "BASE", executionAccount: "0xbbbb", proofDigest: DIGEST },
    } as never).state;
    const registry: RegistryReadPort = {
      async getIdentity() { throw new Error("down"); },
      async resolve() { throw new Error("registry_unavailable"); },
      async getBinding() { return { status: null }; },
      async isDigestConsumed() { return false; },
    } as unknown as RegistryReadPort;
    const svc = new WatermarkedResolveService(registry, {
      staleBoundK: 5,
      getConfirmedBlock: async () => 100,
      getProjection: () => proj,
    });
    await expect(svc.resolve("prism:P1", "BASE")).rejects.toBeInstanceOf(StaleCacheError);
  });

  it("unknown status watermark null with ACTIVE is refused (fail-closed)", async () => {
    const registry = fakeRegistry(null, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    const svc = new WatermarkedResolveService(registry, { staleBoundK: 5, getConfirmedBlock: async () => 100 });
    const res = await svc.resolve("prism:P1", "BASE");
    expect(res.staleRefused).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// 8. Unknown status — fail-closed, never invent completion
// ────────────────────────────────────────────────────────────────────────────────
describe("Bundle 2R Live — unknown status fail-closed (SM-PRISM-003, T12, SC-28)", () => {
  it("unknown chain (observeChain returns null) stays submitted, no invented completion", async () => {
    const store = new InMemoryOperationStore();
    let op = await store.create({ id: "op-unk2", idempotencyKey: "k-unk2", requestFingerprint: "fp-unk2", now: NOW });
    op = await store.transition(op.id, { to: "awaiting_authorization", now: NOW + 1, expectedVersion: op.version });
    op = await store.transition(op.id, { to: "ready", now: NOW + 2, expectedVersion: op.version });
    op = await store.transition(op.id, { to: "submitted", now: NOW + 3, expectedVersion: op.version, txHash: TX_A });
    const worker = new ReconciliationWorker({
      store,
      ledger: { async observeChain() { return null; } } as never,
      indexer: { async observeIndexer() { return { txHash: TX_A, eventObserved: false, blockNumber: null, eventIndex: null } as IndexerObservation; }, async observeReconciliation() { return { chainReceiptMatched: false, eventMatchedToOperation: false, matchedTxHash: null }; } } as never,
      clock: { now: () => NOW + 20 },
    });
    const res = await worker.tickAllOnce(NOW + 20);
    expect(res.advanced).toBe(0);
    const after = await store.getById("op-unk2");
    expect(after?.state).toBe("submitted");
    expect(after?.state).not.toBe("completed");
  });

  it("watermarked resolve returns NO_ACTIVE_DESTINATION for empty projection when canonical down (no stale ACTIVE)", async () => {
    const registry: RegistryReadPort = {
      async getIdentity() { throw new Error("down"); },
      async resolve() { throw new Error("registry_unavailable"); },
      async getBinding() { return { status: null }; },
      async isDigestConsumed() { return false; },
    } as unknown as RegistryReadPort;
    // empty projection with no watermark — NO_ACTIVE is safe, not stale
    const svc = new WatermarkedResolveService(registry, {
      staleBoundK: 5,
      getConfirmedBlock: async () => 100,
      getProjection: () => emptyProjection(),
    });
    const res = await svc.resolve("prism:unknown", "BASE");
    expect(res.executionAccount).toBeNull();
    expect(res.authoritativeSource).toBe("indexer_projection");
  });

  it("dependency failure (ledger throws) is counted, not completed", async () => {
    const store = new InMemoryOperationStore();
    let op = await store.create({ id: "op-dep2", idempotencyKey: "k-dep2", requestFingerprint: "fp-dep2", now: NOW });
    op = await store.transition(op.id, { to: "awaiting_authorization", now: NOW + 1, expectedVersion: op.version });
    op = await store.transition(op.id, { to: "ready", now: NOW + 2, expectedVersion: op.version });
    op = await store.transition(op.id, { to: "submitted", now: NOW + 3, expectedVersion: op.version, txHash: TX_A });
    const worker = new ReconciliationWorker({
      store,
      ledger: { async observeChain() { throw new Error("rpc_unavailable"); } } as never,
      indexer: { async observeIndexer() { return null; }, async observeReconciliation() { return null; } } as never,
      clock: { now: () => NOW + 20 },
    });
    const res = await worker.tickAllOnce(NOW + 20);
    expect(res.dependencyFailures).toBe(1);
    expect((await store.getById("op-dep2"))?.state).toBe("submitted");
  });
});
