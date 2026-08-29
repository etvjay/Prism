// M1 indexer / watermark runtime — deterministic coverage for the M1 gate.
// Covers: pagination, duplicate events, gaps, watermark advancement, stale READ refusal,
// malformed addresses, fail-closed unknowns. All via injected fakes, no RPC, no secrets.
// Authority: EVENT_CATALOGUE, INV-SYS-007, QRY-8-01, CONTRACT_SPEC OP-7-02.

import { describe, it, expect } from "vitest";
import type { Hex } from "../domain/operation";
import { StarknetEventIndexerAdapter, type StarknetEventReader, PRISM_EVENT_SELECTORS } from "../adapters/starknet-event-indexer";
import { WatermarkedResolveService, StaleCacheError } from "../domain/resolve-service";
import { emptyProjection, applyEvent, reconstruct, isStaleProjection } from "../domain/event-indexer";
import { isWatermarkStale } from "../domain/recovery";
import { buildM1Envelope, buildM1GetIdentityFixture, buildM1WatermarkFixture, runM1CrossChecks } from "../../evidence/m1-live-read";
import type { RegistryReadPort } from "../../../application/ports";

const REGISTRY = "0x1111";
const TX_A: Hex = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TX_B: Hex = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TX_C: Hex = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const SEL = PRISM_EVENT_SELECTORS.PrismIdentityCreated;

function fakeRegistry(overrides: Partial<RegistryReadPort> = {}): RegistryReadPort {
  return {
    async getIdentity() { return { controller: "0x1111", createdAtBlock: 1, version: 0 }; },
    async resolve() { return { executionAccount: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", watermark: 100 }; },
    async getBinding() { return { status: "ACTIVE" }; },
    async listByController() { return []; },
    async isDigestConsumed() { return false; },
    ...overrides,
  };
}

describe("M1 indexer/watermark runtime — deterministic gate", () => {
  it("pagination: fetchAll aggregates via continuation_token deterministically", async () => {
    let call = 0;
    const pages = [
      { events: [{ block_number: 10, transaction_hash: TX_B, event_index: 1, keys: [SEL, "0x10"], data: ["0xaaaa"] }, { block_number: 5, transaction_hash: TX_C, event_index: 0, keys: [SEL, "0x11"], data: ["0xbbbb"] }], continuation_token: "p2" },
      { events: [{ block_number: 10, transaction_hash: TX_A, event_index: 0, keys: [SEL, "0x12"], data: ["0xcccc"] }], continuation_token: null },
    ];
    const reader: StarknetEventReader = { getEvents: async () => { const p = pages[call++] ?? { events: [], continuation_token: null }; return { events: p.events as never[], continuation_token: p.continuation_token } as never; } };
    const adapter = new StarknetEventIndexerAdapter({ reader, registryAddress: REGISTRY, registryVersion: "v1", network: "SN_SEPOLIA", requireEventOrigin: false, chunkSize: 2 });
    const res = await adapter.fetchAllRegistryEvents({ fromBlock: 0 });
    expect(res.pagesFetched).toBe(2);
    expect(res.events.map(e => [e.blockNumber, e.txHash, e.eventIndex])).toEqual([[5, TX_C, 0], [10, TX_A, 0], [10, TX_B, 1]]);
    expect(res.watermark).toBe(10);
  });

  it("duplicate events deduplicated by tx_hash+event_index across pages", async () => {
    const pages = [
      { events: [{ block_number: 10, transaction_hash: TX_A, event_index: 0, keys: [SEL, "0x1"], data: ["0x1111"] }], continuation_token: "p2" },
      { events: [{ block_number: 10, transaction_hash: TX_A, event_index: 0, keys: [SEL, "0x1"], data: ["0x1111"] }, { block_number: 10, transaction_hash: TX_A, event_index: 1, keys: [SEL, "0x2"], data: ["0x2222"] }], continuation_token: null },
    ];
    let call = 0;
    const reader: StarknetEventReader = { getEvents: async () => { const p = pages[call++] ?? { events: [], continuation_token: null }; return { events: p.events as never[], continuation_token: p.continuation_token } as never; } };
    const adapter = new StarknetEventIndexerAdapter({ reader, registryAddress: REGISTRY, registryVersion: "v1", network: "SN_SEPOLIA", requireEventOrigin: false, chunkSize: 1 });
    const res = await adapter.fetchAllRegistryEvents({ fromBlock: 0 });
    expect(res.events).toHaveLength(2);
    expect(res.events.map(e => e.eventIndex)).toEqual([0, 1]);
  });

  it("gaps: missing intermediate block does not corrupt reconstruction", () => {
    const ev1 = { txHash: TX_A, eventIndex: 0, blockNumber: 10, kind: "PrismIdentityCreated" as const, payload: { prismId: "prism:G", controller: "0x1" } as never };
    const ev3 = { txHash: TX_B, eventIndex: 0, blockNumber: 12, kind: "BindingRevoked" as const, payload: { prismId: "prism:G", venue: "BASE", executionAccount: "0xabc" } as never };
    const s = reconstruct([ev1, ev3]);
    expect(s.identities.has("prism:G")).toBe(true);
    expect(s.bindings.has("prism:G|BASE|0xabc")).toBe(true);
  });

  it("watermark advancement is max(blockNumber) and monotonic across reconstruct", () => {
    const evs = [
      { txHash: TX_A, eventIndex: 0, blockNumber: 7, kind: "PrismIdentityCreated" as const, payload: { prismId: "prism:W1", controller: "0x1" } as never },
      { txHash: TX_B, eventIndex: 0, blockNumber: 12, kind: "PrismIdentityCreated" as const, payload: { prismId: "prism:W2", controller: "0x2" } as never },
      { txHash: TX_C, eventIndex: 0, blockNumber: 9, kind: "PrismIdentityCreated" as const, payload: { prismId: "prism:W3", controller: "0x3" } as never },
    ];
    const s = reconstruct(evs);
    expect(s.watermark).toBe(12);
    // Adding later block advances watermark
    const later = { txHash: TX_A, eventIndex: 1, blockNumber: 20, kind: "PrismIdentityCreated" as const, payload: { prismId: "prism:W4", controller: "0x4" } as never };
    const s2 = applyEvent(s, later).state;
    expect(s2.watermark).toBe(20);
  });

  it("stale-read refusal: WatermarkedResolveService refuses stale ACTIVE, allows fresh", async () => {
    const staleRegistry = fakeRegistry({ async resolve() { return { executionAccount: "0xbbbb", watermark: 90 }; } });
    const svcStale = new WatermarkedResolveService(staleRegistry, { staleBoundK: 5, getConfirmedBlock: async () => 100 });
    const staleRes = await svcStale.resolve("prism:P", "BASE");
    expect(staleRes.staleRefused).toBe(true);
    expect(staleRes.executionAccount).toBeNull();

    const freshRegistry = fakeRegistry({ async resolve() { return { executionAccount: "0xbbbb", watermark: 96 }; } });
    const svcFresh = new WatermarkedResolveService(freshRegistry, { staleBoundK: 5, getConfirmedBlock: async () => 100 });
    const freshRes = await svcFresh.resolve("prism:P", "BASE");
    expect(freshRes.staleRefused).toBe(false);
    expect(freshRes.executionAccount).not.toBeNull();
  });

  it("stale-read refusal: unknown confirmed block with ACTIVE is fail-closed", async () => {
    const registry = fakeRegistry({ async resolve() { return { executionAccount: "0xbbbb", watermark: 100 }; } });
    const svc = new WatermarkedResolveService(registry, { staleBoundK: 5, getConfirmedBlock: async () => null });
    const res = await svc.resolve("prism:P", "BASE");
    expect(res.staleRefused).toBe(true);
    expect(res.executionAccount).toBeNull();
  });

  it("stale watermark with indexer projection throws StaleCacheError when canonical unavailable", async () => {
    let s = emptyProjection();
    s = applyEvent(s, { txHash: TX_A, eventIndex: 0, blockNumber: 90, kind: "ExecutionIdentityBound" as const, payload: { prismId: "prism:S", venue: "BASE", executionAccount: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", proofDigest: TX_A } as never }).state;
    const registry = fakeRegistry({ async resolve() { throw new Error("registry_unavailable"); } });
    const svc = new WatermarkedResolveService(registry, { staleBoundK: 5, getConfirmedBlock: async () => 100, getProjection: () => s });
    await expect(svc.resolve("prism:S", "BASE")).rejects.toBeInstanceOf(StaleCacheError);
  });

  it("malformed addresses throw with ERR-002 and never fabricate identity", async () => {
    const { StarknetRegistryReadAdapter } = await import("../adapters/starknet-registry-read");
    expect(() => new StarknetRegistryReadAdapter({ reader: { callContract: async () => ["0x0"] }, registryAddress: "not-hex" })).toThrow(/malformed_address/);
    const bad = new StarknetRegistryReadAdapter({ reader: { callContract: async () => ["0x0"] }, registryAddress: REGISTRY });
    await expect(bad.getIdentity("not-prism")).rejects.toMatchObject({ code: "ERR-002" });
    await expect(bad.getIdentity("prism:001")).rejects.toMatchObject({ code: "ERR-002" });
    await expect(bad.isDigestConsumed("not-hex" as Hex)).rejects.toMatchObject({ code: "ERR-023" });
  });

  it("fail-closed unknowns: unknown tx returns null, unknown prism returns None, no invented events", async () => {
    const reader: StarknetEventReader = { getEvents: async () => ({ events: [], continuation_token: null }) };
    const idx = new StarknetEventIndexerAdapter({ reader, registryAddress: REGISTRY, registryVersion: "v1", network: "SN_SEPOLIA", requireEventOrigin: false });
    const obs = await idx.observeIndexer(TX_A);
    expect(obs?.eventObserved).toBe(false);

    const { StarknetRegistryReadAdapter } = await import("../adapters/starknet-registry-read");
    const reg = new StarknetRegistryReadAdapter({ reader: { callContract: async () => ["0x1"] }, registryAddress: REGISTRY });
    expect(await reg.getIdentity("prism:999")).toBeNull();
    const resolveRes = await reg.resolve("prism:999", "BASE");
    expect(resolveRes.executionAccount).toBeNull();
  });

  it("isWatermarkStale / isStaleProjection agree on K=5 bound", () => {
    expect(isWatermarkStale(90, 100, 5)).toBe(true); // 90 < 95
    expect(isWatermarkStale(96, 100, 5)).toBe(false);
    expect(isStaleProjection(90, 100, 5)).toBe(true);
    expect(isStaleProjection(96, 100, 5)).toBe(false);
    expect(isStaleProjection(null, 100, 5)).toBe(true);
  });

  it("independent-read envelope requires explorer_url or rpc_second_read — missing downgrades to X2", () => {
    const dep = { network: "SN_SEPOLIA" as const, address: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const, class_hash: "0x0abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" as const, deploy_tx: "0x0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0dead" as const, block_number: 12345, status: "SUCCEEDED" as const };
    const envNoIV = buildM1Envelope({ deployment: dep, getIdentityFixture: buildM1GetIdentityFixture(), independentVerification: { explorer_url: null, rpc_second_read: null, verified_at: null } });
    const crossNoIV = runM1CrossChecks({ envelope: envNoIV });
    expect(crossNoIV.promotable).toBe(false);
    expect(crossNoIV.suggestedMaturity).toBe("X2");

    const envIV = buildM1Envelope({
      deployment: dep,
      getIdentityFixture: buildM1GetIdentityFixture(),
      independentVerification: { explorer_url: "https://sepolia.voyager.online/tx/0xabc", rpc_second_read: { block: 12345, status: "SUCCEEDED", address_match: true }, verified_at: "2026-08-23T00:00:00Z" },
      maturity: "X3" as const,
    });
    const freshWm = buildM1WatermarkFixture({ projectionWatermark: 12345, confirmedBlock: 12348, boundK: 5 });
    const crossIV = runM1CrossChecks({ envelope: envIV, watermarkFixture: freshWm });
    expect(crossIV.promotable).toBe(true);
  });

  it("submitted!=completed: tickReconciliation never fabricates completed from submitted", async () => {
    const { tickReconciliation } = await import("../domain/recovery");
    const { createOperation } = await import("../domain/operation");
    const { StarknetRegistryReadAdapter } = await import("../adapters/starknet-registry-read");
    void StarknetRegistryReadAdapter;
    // Minimal fake store with one submitted op
    const TX: Hex = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const NOW = 1_789_000_000;
    const base = createOperation({ id: "op-m1", now: NOW });
    // Build store that has submitted state
    let cur: typeof base = base;
    const { transition } = await import("../domain/operation");
    cur = transition(cur, { to: "awaiting_authorization", now: NOW + 1, expectedVersion: 0 }).operation;
    cur = transition(cur, { to: "ready", now: NOW + 2, expectedVersion: 1 }).operation;
    cur = transition(cur, { to: "submitted", now: NOW + 3, expectedVersion: 2, txHash: TX }).operation;

    const store = {
      getById: async () => cur as unknown as never,
      transition: async () => { throw new Error("should not be called for fail-closed noop"); },
      listNonTerminal: async () => [] as never,
    } as unknown as import("../domain/operation-store").OperationStore;

    const port = {
      observeChain: async () => null,
      observeIndexer: async () => null,
      observeReconciliation: async () => null,
    };
    const result = await tickReconciliation(store, port as never, cur.id, NOW + 10);
    expect(result.advanced).toBe(false);
    expect(result.toState).not.toBe("completed");
  });
});
