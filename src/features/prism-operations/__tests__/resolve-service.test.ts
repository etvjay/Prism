import { describe, it, expect } from "vitest";
import type { RegistryReadPort } from "../../../application/ports";
import { emptyProjection, applyEvent } from "../domain/event-indexer";
import type { Hex } from "../domain/operation";
import { WatermarkedResolveService, StaleCacheError } from "../domain/resolve-service";

const PRISM_ID = "prism:P7F21";
const VENUE = "BASE";
const ACCOUNT = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TX_A: Hex = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function fakeRegistry(overrides: Partial<RegistryReadPort> = {}): RegistryReadPort {
  return {
    async getIdentity() {
      return { controller: "0x1111", createdAtBlock: 1, version: 0 };
    },
    async resolve() {
      return { executionAccount: ACCOUNT, watermark: 100 };
    },
    async getBinding() {
      return { status: "ACTIVE" };
    },
    async isDigestConsumed() {
      return false;
    },
    ...overrides,
  };
}

describe("WatermarkedResolveService — canonical preference & stale-cache refusal", () => {
  it("serves canonical registry when fresh (watermark within K)", async () => {
    const registry = fakeRegistry({
      async resolve() {
        return { executionAccount: ACCOUNT, watermark: 98 };
      },
    });
    const svc = new WatermarkedResolveService(registry, { staleBoundK: 5, getConfirmedBlock: async () => 100 });
    const res = await svc.resolve(PRISM_ID, VENUE);
    expect(res.executionAccount?.toLowerCase()).toBe(ACCOUNT);
    expect(res.authoritativeSource).toBe("registry_canonical");
    expect(res.staleRefused).toBe(false);
  });

  it("refuses stale ACTIVE (watermark far behind confirmed) — INV-SYS-007", async () => {
    const registry = fakeRegistry({
      async resolve() {
        return { executionAccount: ACCOUNT, watermark: 90 };
      },
    });
    const svc = new WatermarkedResolveService(registry, { staleBoundK: 5, getConfirmedBlock: async () => 100 });
    const res = await svc.resolve(PRISM_ID, VENUE);
    expect(res.executionAccount).toBeNull();
    expect(res.authoritativeSource).toBe("stale_refused");
    expect(res.staleRefused).toBe(true);
  });

  it("allows stale when explicitly opted in", async () => {
    const registry = fakeRegistry({
      async resolve() {
        return { executionAccount: ACCOUNT, watermark: 90 };
      },
    });
    const svc = new WatermarkedResolveService(registry, { staleBoundK: 5, getConfirmedBlock: async () => 100 });
    const res = await svc.resolve(PRISM_ID, VENUE, { allowStale: true });
    expect(res.executionAccount?.toLowerCase()).toBe(ACCOUNT);
    expect(res.staleRefused).toBe(false);
  });

  it("prefers canonical over indexer projection when both present", async () => {
    const projection = (() => {
      let s = emptyProjection();
      const ev = {
        txHash: TX_A,
        eventIndex: 0,
        blockNumber: 99,
        kind: "ExecutionIdentityBound" as const,
        payload: { prismId: PRISM_ID, venue: VENUE, executionAccount: "0xdead", proofDigest: TX_A } as unknown as typeof s extends { bindings: infer _ } ? never : never,
      } as unknown as Parameters<typeof applyEvent>[1];
      const r = applyEvent(s, ev);
      return r.state;
    })();
    const registry = fakeRegistry({
      async resolve() {
        return { executionAccount: ACCOUNT, watermark: 100 };
      },
    });
    const svc = new WatermarkedResolveService(registry, {
      staleBoundK: 5,
      getConfirmedBlock: async () => 100,
      getProjection: () => projection,
    });
    const res = await svc.resolve(PRISM_ID, VENUE);
    expect(res.executionAccount?.toLowerCase()).toBe(ACCOUNT); // canonical wins, not 0xdead
    expect(res.authoritativeSource).toBe("registry_canonical");
  });

  it("falls back to indexer projection when canonical unavailable and projection is fresh", async () => {
    const projection = (() => {
      let s = emptyProjection();
      const ev = {
        txHash: TX_A,
        eventIndex: 0,
        blockNumber: 100,
        kind: "ExecutionIdentityBound" as const,
        payload: { prismId: PRISM_ID, venue: VENUE, executionAccount: ACCOUNT, proofDigest: TX_A },
      } as unknown as Parameters<typeof applyEvent>[1];
      s = applyEvent(s, ev).state;
      return s;
    })();
    const registry = fakeRegistry({
      async resolve() {
        throw new Error("registry_unavailable");
      },
    });
    const svc = new WatermarkedResolveService(registry, {
      staleBoundK: 5,
      getConfirmedBlock: async () => 100,
      getProjection: () => projection,
    });
    const res = await svc.resolve(PRISM_ID, VENUE);
    expect(res.executionAccount?.toLowerCase()).toBe(ACCOUNT);
    expect(res.authoritativeSource).toBe("indexer_projection");
  });

  it("falls back through an asynchronous provider-backed projection port using the canonical Prism ID", async () => {
    const projection = (() => {
      let s = emptyProjection();
      const ev = {
        txHash: TX_A,
        eventIndex: 0,
        blockNumber: 100,
        kind: "ExecutionIdentityBound" as const,
        payload: { prismId: "prism:42", venue: VENUE, executionAccount: ACCOUNT, proofDigest: TX_A },
      } as unknown as Parameters<typeof applyEvent>[1];
      s = applyEvent(s, ev).state;
      return s;
    })();
    const registry = fakeRegistry({
      async resolve() {
        throw new Error("registry_unavailable");
      },
    });
    const svc = new WatermarkedResolveService(registry, {
      staleBoundK: 5,
      getConfirmedBlock: async () => 100,
      projectionReadPort: { async getProjection() { return projection; } },
    });

    const res = await svc.resolve("prism:42", VENUE);
    expect(res.executionAccount).toBe(ACCOUNT);
    expect(res.authoritativeSource).toBe("indexer_projection");
  });

  it("throws StaleCacheError when projection is stale and canonical unavailable", async () => {
    const projection = (() => {
      let s = emptyProjection();
      const ev = {
        txHash: TX_A,
        eventIndex: 0,
        blockNumber: 90,
        kind: "ExecutionIdentityBound" as const,
        payload: { prismId: PRISM_ID, venue: VENUE, executionAccount: ACCOUNT, proofDigest: TX_A },
      } as unknown as Parameters<typeof applyEvent>[1];
      s = applyEvent(s, ev).state;
      return s;
    })();
    const registry = fakeRegistry({
      async resolve() {
        throw new Error("registry_unavailable");
      },
    });
    const svc = new WatermarkedResolveService(registry, {
      staleBoundK: 5,
      getConfirmedBlock: async () => 100,
      getProjection: () => projection,
    });
    await expect(svc.resolve(PRISM_ID, VENUE)).rejects.toBeInstanceOf(StaleCacheError);
  });

  it("stale NO_ACTIVE_DESTINATION is served (no refusal for null)", async () => {
    const registry = fakeRegistry({
      async resolve() {
        return { executionAccount: null, watermark: 90 }; // revoked / none
      },
    });
    const svc = new WatermarkedResolveService(registry, { staleBoundK: 5, getConfirmedBlock: async () => 100 });
    const res = await svc.resolve(PRISM_ID, VENUE);
    expect(res.executionAccount).toBeNull();
    expect(res.staleRefused).toBe(false); // null is not active, so not refused
  });

  it("isStale helper respects confirmedBlock - K bound", () => {
    const svc = new WatermarkedResolveService(fakeRegistry(), { staleBoundK: 5 });
    expect(svc.isStale(90, 100)).toBe(true); // 90 < 95
    expect(svc.isStale(96, 100)).toBe(false);
    expect(svc.isStale(null, 100)).toBe(true);
  });
});
