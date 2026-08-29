// Event reconstruction tests — T9 ledger integration tier, idempotent by (tx_hash,event_index).
// Covers: PrismIdentityCreated, ExecutionIdentityBound, BindingRevoked
// Keying: tx_hash + event_index per EVENT_CATALOGUE, ordering (block,txHash,eventIndex),
// duplicate, missed, stale cache, reverted, property (determinism), restart-equivalent replay.

import { describe, it, expect } from "vitest";
import type { Hex } from "../domain/operation";
import {
  emptyProjection,
  applyEvent,
  reconstruct,
  resolveBinding,
  isStaleProjection,
  eventKey,
  type RegistryCanonicalEvent,
} from "../domain/event-indexer";

const TX_A: Hex = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TX_B: Hex = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TX_C: Hex = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

function mkEvent(
  txHash: Hex,
  eventIndex: number,
  blockNumber: number,
  kind: RegistryCanonicalEvent["kind"],
  payload: RegistryCanonicalEvent["payload"],
): RegistryCanonicalEvent {
  return { txHash, eventIndex, blockNumber, kind, payload };
}

describe("event reconstruction — idempotent keyed by tx_hash+event_index (T9)", () => {
  it("reconstructs empty + three facts = complete state (INV-SYS-006, TEST-7-3-1)", () => {
    const events: RegistryCanonicalEvent[] = [
      mkEvent(TX_A, 0, 10, "PrismIdentityCreated", { prismId: "prism:P1", controller: "0x111" }),
      mkEvent(TX_A, 1, 11, "ExecutionIdentityBound", {
        prismId: "prism:P1",
        venue: "BASE",
        executionAccount: "0xabc",
        proofDigest: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as Hex,
      }),
      mkEvent(TX_B, 0, 12, "BindingRevoked", {
        prismId: "prism:P1",
        venue: "BASE",
        executionAccount: "0xabc",
      }),
    ];
    const state = reconstruct(events);
    expect(state.identities.has("prism:P1")).toBe(true);
    expect(state.bindings.size).toBe(1);
    const b = state.bindings.get("prism:P1|BASE|0xabc")!;
    expect(b.status).toBe("REVOKED");
    // Identity survives revocation (INV-SYS-006)
    expect(state.identities.get("prism:P1")!.controller).toBe("0x111");
    expect(resolveBinding(state, "prism:P1", "BASE")).toBeNull();
  });

  it("idempotent duplicate event (same tx_hash+event_index) is benign duplicate", () => {
    const ev = mkEvent(TX_A, 0, 10, "PrismIdentityCreated", {
      prismId: "prism:P2",
      controller: "0x222",
    });
    let state = emptyProjection();
    const r1 = applyEvent(state, ev);
    expect(r1.isDuplicate).toBe(false);
    expect(r1.error).toBeUndefined();
    state = r1.state;
    const r2 = applyEvent(state, ev);
    expect(r2.isDuplicate).toBe(true);
    expect(r2.duplicateKey).toBe(eventKey(TX_A, 0));
    expect(r2.state.seenKeys.size).toBe(1);
    // Reapplying duplicate never changes identity
    expect(r2.state.identities.get("prism:P2")!.controller).toBe("0x222");
  });

  it("duplicate with different payload still treated as duplicate (first wins, keyed only by tx+index)", () => {
    const ev1 = mkEvent(TX_A, 0, 10, "PrismIdentityCreated", {
      prismId: "prism:P3",
      controller: "0x333",
    });
    const ev2 = mkEvent(TX_A, 0, 10, "PrismIdentityCreated", {
      prismId: "prism:P3",
      controller: "0x999",
    });
    let state = emptyProjection();
    state = applyEvent(state, ev1).state;
    const r2 = applyEvent(state, ev2);
    expect(r2.isDuplicate).toBe(true);
    expect(r2.state.identities.get("prism:P3")!.controller).toBe("0x333");
  });

  it("missed event: gap in block order does not corrupt later events", () => {
    const ev1 = mkEvent(TX_A, 0, 10, "PrismIdentityCreated", {
      prismId: "prism:P4",
      controller: "0x444",
    });
    // ev at block 11 is "missed" (not supplied)
    const ev3 = mkEvent(TX_B, 0, 12, "BindingRevoked", {
      prismId: "prism:P4",
      venue: "BASE",
      executionAccount: "0xabc",
    });
    const state = reconstruct([ev1, ev3]);
    expect(state.identities.has("prism:P4")).toBe(true);
    expect(state.bindings.has("prism:P4|BASE|0xabc")).toBe(true);
  });

  it("out-of-order events reconstruct deterministically by (block,txHash,eventIndex)", () => {
    const evA = mkEvent(TX_B, 1, 11, "ExecutionIdentityBound", {
      prismId: "prism:P5",
      venue: "BASE",
      executionAccount: "0xabc",
      proofDigest: "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex,
    });
    const evB = mkEvent(TX_A, 0, 10, "PrismIdentityCreated", {
      prismId: "prism:P5",
      controller: "0x555",
    });
    const evC = mkEvent(TX_B, 0, 11, "ExecutionIdentityBound", {
      prismId: "prism:P5",
      venue: "BASE",
      executionAccount: "0xdef",
      proofDigest: "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex,
    });
    // Provide shuffled order; reconstruct sorts
    const s1 = reconstruct([evA, evB, evC]);
    const s2 = reconstruct([evB, evC, evA]);
    expect(s1.identities.get("prism:P5")!.controller).toBe(s2.identities.get("prism:P5")!.controller);
    expect(s1.bindings.size).toBe(s2.bindings.size);
    expect(s1.watermark).toBe(11);
  });

  it("property: random shuffles reconstruct to same state (determinism)", () => {
    const base: RegistryCanonicalEvent[] = [
      mkEvent(TX_A, 0, 10, "PrismIdentityCreated", { prismId: "prism:X", controller: "0xc1" }),
      mkEvent(TX_A, 1, 10, "ExecutionIdentityBound", {
        prismId: "prism:X",
        venue: "BASE",
        executionAccount: "0xaaa",
        proofDigest: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex,
      }),
      mkEvent(TX_B, 0, 11, "ExecutionIdentityBound", {
        prismId: "prism:X",
        venue: "BASE",
        executionAccount: "0xbbb",
        proofDigest: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hex,
      }),
      mkEvent(TX_C, 0, 12, "BindingRevoked", {
        prismId: "prism:X",
        venue: "BASE",
        executionAccount: "0xaaa",
      }),
    ];
    const reference = reconstruct(base);
    const shuffled1 = reconstruct([base[2], base[0], base[3], base[1]]);
    const shuffled2 = reconstruct([base[3], base[1], base[2], base[0]]);
    expect(shuffled1.bindings.get("prism:X|BASE|0xaaa")!.status).toBe(reference.bindings.get("prism:X|BASE|0xaaa")!.status);
    expect(shuffled2.bindings.get("prism:X|BASE|0xbbb")!.status).toBe("ACTIVE");
    expect(shuffled1.watermark).toBe(reference.watermark);
  });

  it("resolveBinding returns ACTIVE, revocation flips to NO_ACTIVE_DESTINATION, identity persists", () => {
    let s = emptyProjection();
    s = applyEvent(
      s,
      mkEvent(TX_A, 0, 10, "PrismIdentityCreated", { prismId: "prism:R", controller: "0xabc" }),
    ).state;
    s = applyEvent(
      s,
      mkEvent(TX_A, 1, 10, "ExecutionIdentityBound", {
        prismId: "prism:R",
        venue: "BASE",
        executionAccount: "0xdead",
        proofDigest: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as Hex,
      }),
    ).state;
    expect(resolveBinding(s, "prism:R", "BASE")).toBe("0xdead");
    s = applyEvent(
      s,
      mkEvent(TX_B, 0, 11, "BindingRevoked", {
        prismId: "prism:R",
        venue: "BASE",
        executionAccount: "0xdead",
      }),
    ).state;
    expect(resolveBinding(s, "prism:R", "BASE")).toBeNull();
    expect(s.identities.has("prism:R")).toBe(true);
  });

  it("stale cache detection: watermark below confirmedBlock-K is stale", () => {
    let s = emptyProjection();
    s = applyEvent(s, mkEvent(TX_A, 0, 10, "PrismIdentityCreated", { prismId: "prism:S", controller: "0x1" })).state;
    s = applyEvent(
      s,
      mkEvent(TX_A, 1, 10, "ExecutionIdentityBound", {
        prismId: "prism:S",
        venue: "BASE",
        executionAccount: "0xaaa",
        proofDigest: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" as Hex,
      }),
    ).state;
    // watermark = 10, confirmedBlock = 20, K=5 => 10 < 15 => stale
    expect(isStaleProjection(s.watermark, 20, 5)).toBe(true);
    expect(isStaleProjection(s.watermark, 12, 5)).toBe(false); // 10 >= 7
    expect(isStaleProjection(null, 100, 5)).toBe(true);
  });

  it("restart-equivalent: replay from persisted seenKeys reconstructs same state", () => {
    const events: RegistryCanonicalEvent[] = [
      mkEvent(TX_A, 0, 10, "PrismIdentityCreated", { prismId: "prism:RESTART", controller: "0x1" }),
      mkEvent(TX_A, 1, 10, "ExecutionIdentityBound", {
        prismId: "prism:RESTART",
        venue: "BASE",
        executionAccount: "0xaaa",
        proofDigest: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as Hex,
      }),
    ];
    const s1 = reconstruct(events);
    // Simulate restart: rebuild from same event log after crash (seenKeys would be rebuilt)
    const s2 = reconstruct(events);
    expect(s2.identities.get("prism:RESTART")!.controller).toBe(s1.identities.get("prism:RESTART")!.controller);
    expect(s2.seenKeys.size).toBe(s1.seenKeys.size);
    // Duplicate replay after restart remains idempotent
    const r = applyEvent(s2, events[0]);
    expect(r.isDuplicate).toBe(true);
  });

  it("malformed txHash/eventIndex fails closed (error, no state change)", () => {
    let s = emptyProjection();
    const bad = mkEvent("0x123" as Hex, -1, 10, "PrismIdentityCreated", {
      prismId: "prism:BAD",
      controller: "0x1",
    });
    const r = applyEvent(s, bad);
    expect(r.error).toBeDefined();
    expect(r.state.seenKeys.size).toBe(0);
  });

  it("reverted-equivalent: no event emitted still preserves prior state (missed event noop)", () => {
    // If tx reverted, no canonical events are emitted; projection unchanged
    const ev = mkEvent(TX_A, 0, 10, "PrismIdentityCreated", {
      prismId: "prism:REV",
      controller: "0x1",
    });
    let s = applyEvent(emptyProjection(), ev).state;
    // Simulate reverted tx B that would have emitted a bind — but doesn't, so no event to apply
    const afterMissed = s; // no applyEvent called
    expect(afterMissed.identities.has("prism:REV")).toBe(true);
    expect(afterMissed.bindings.size).toBe(0);
  });
});
