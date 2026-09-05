import { describe, expect, it } from "vitest";
import { createApiLiveStateReader } from "../apiLiveStateReader";
import { LIVE_STATE_FALLBACK_COPY, LIVE_STATE_IDS } from "../liveStateTypes";

const ACCOUNT = "0xabc";

function stubFetch(payload: unknown, ok = true): typeof fetch {
  return (async () =>
    ({
      ok,
      json: () => Promise.resolve(payload),
    }) as Response) as typeof fetch;
}

const LIVE_PAYLOAD = {
  ok: true,
  data: {
    prismId: "prism:8",
    registry: LIVE_STATE_IDS.registryV2,
    owner: LIVE_STATE_IDS.owner,
    baseBinding: LIVE_STATE_IDS.boundBaseEoa,
    strkBalance: { account: LIVE_STATE_IDS.owner, status: "live", raw: "123", display: "1,119.00 STRK" },
    baseEth: { account: LIVE_STATE_IDS.boundBaseEoa, status: "live", rawWei: "0x1ed8dedfa70b0c", display: "0.002182 Base Sepolia ETH" },
  },
};

describe("api live-state reader (server-route backed)", () => {
  it("maps route facts onto the snapshot port with real owner + binding", async () => {
    const reader = createApiLiveStateReader({ fetchImpl: stubFetch(LIVE_PAYLOAD) });
    expect(reader.kind).toBe("api");
    const snap = await reader.readLiveState({ accountAddress: ACCOUNT, consentGranted: false });
    expect(snap.prismOwner.status).toBe("live");
    expect(snap.prismOwner.value).toContain(LIVE_STATE_IDS.owner);
    expect(snap.baseBinding.status).toBe("live");
    expect(snap.baseBinding.value).toContain(LIVE_STATE_IDS.boundBaseEoa);
    expect(snap.strkBalance.status).toBe("live");
    expect(snap.strkBalance.value).toBe("1,119.00 STRK");
    expect(snap.baseEth.status).toBe("live");
    // Private slot stays consent-gated even on the live path.
    expect(snap.privateBalance.status).toBe("blocked");
    expect(snap.privateBalance.fallback).toBe(LIVE_STATE_FALLBACK_COPY["consent-required"]);
  });

  it("fails closed to blocked fallback copy on HTTP error", async () => {
    const reader = createApiLiveStateReader({ fetchImpl: stubFetch({ ok: false }, false) });
    const snap = await reader.readLiveState({ accountAddress: ACCOUNT, consentGranted: false });
    expect(snap.prismOwner.status).toBe("blocked");
    expect(snap.prismOwner.value).toBe(null);
    expect(snap.prismOwner.fallback.length).toBeGreaterThan(0);
  });

  it("fails closed to blocked fallback copy on fetch rejection", async () => {
    const failing = (() => Promise.reject(new Error("down"))) as unknown as typeof fetch;
    const reader = createApiLiveStateReader({ fetchImpl: failing });
    const snap = await reader.readLiveState({ accountAddress: ACCOUNT, consentGranted: true });
    expect(snap.baseEth.status).toBe("blocked");
    expect(snap.baseEth.value).toBe(null);
  });

  it("renders idle fallback copy before connect without fetching", async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return { ok: false, json: () => Promise.resolve(null) } as Response;
    }) as typeof fetch;
    const reader = createApiLiveStateReader({ fetchImpl: spy });
    const snap = await reader.readLiveState({ accountAddress: null, consentGranted: false });
    expect(called).toBe(false);
    expect(snap.prismOwner.value).toBe(null);
    expect(snap).not.toHaveProperty("viewingKey");
  });

  it("marks balance fields unavailable (claiming no value) when the route reports them so", async () => {
    const payload = {
      ok: true,
      data: {
        prismId: "prism:8",
        registry: LIVE_STATE_IDS.registryV2,
        owner: LIVE_STATE_IDS.owner,
        baseBinding: LIVE_STATE_IDS.boundBaseEoa,
        strkBalance: { status: "unavailable", raw: null, display: null },
        baseEth: { status: "unavailable", rawWei: null, display: null },
      },
    };
    const reader = createApiLiveStateReader({ fetchImpl: stubFetch(payload) });
    const snap = await reader.readLiveState({ accountAddress: ACCOUNT, consentGranted: false });
    expect(snap.prismOwner.status).toBe("live");
    expect(snap.strkBalance.status).toBe("unavailable");
    expect(snap.strkBalance.value).toBe(null);
    expect(snap.baseEth.status).toBe("unavailable");
    expect(snap.baseEth.value).toBe(null);
  });
});
