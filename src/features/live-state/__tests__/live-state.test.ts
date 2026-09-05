import { describe, expect, it } from "vitest";
import { assertNoViewingKey } from "../../prism-strk20/domain/privacy-guard";
import { createSessionReducerState, sessionReducer } from "../../wallet/session/reducer";
import { selectSessionState } from "../../wallet/session/selectors";
import { createStarknetWalletSession } from "../../wallet/session/session-state";
import { StarknetWalletSessionAdapter } from "../../wallet/session/starknet-wallet-adapter";
import { buildConsentScope, decideConsent } from "../../privacy-flow/consent";
import { createMockStarknetProvider } from "../../privacy-flow/mockPrivacyWallet";
import { isLiveStateDemoEnabled, selectedPrismIdFromSearch } from "../demoFlag";

import {
  createBlockedLiveStateReader,
  createMockLiveStateReader,
  LIVE_STATE_CONSTANTS,
} from "../liveStateAdapter";
import { LIVE_STATE_FALLBACK_COPY } from "../liveStateTypes";

const NOW = 1_750_000_000_000;

async function connectScenario(scenario: Parameters<typeof createMockStarknetProvider>[0]) {
  const adapter = new StarknetWalletSessionAdapter(createMockStarknetProvider(scenario), {
    expectedEnvironment: "SN_SEPOLIA",
  });
  const observed = await adapter.connect(NOW);
  let state = createSessionReducerState(
    createStarknetWalletSession({ now: NOW, expectedEnvironment: "SN_SEPOLIA" }),
  );
  state = sessionReducer(state, { type: "connection-started", walletId: `mock-${scenario}` });
  state = sessionReducer(state, { type: "session-observed", session: observed, walletId: `mock-${scenario}` });
  return state;
}

describe("livestate demo flag", () => {
  it("reads the explicit Prism ID from the URL and rejects implicit selection", () => {
    expect(selectedPrismIdFromSearch("?demo=livestate&prismId=8")).toBe("8");
    expect(selectedPrismIdFromSearch("?prismId=prism%3A8")).toBe("8");
    expect(selectedPrismIdFromSearch("?demo=livestate")).toBe(null);
    expect(selectedPrismIdFromSearch("?prismId=0")).toBe(null);
  });

  it("enables only on livestate values and leaves default renders unchanged", () => {
    expect(isLiveStateDemoEnabled("?demo=livestate")).toBe(true);
    expect(isLiveStateDemoEnabled("?demo=live-state")).toBe(true);
    expect(isLiveStateDemoEnabled("?demo=live")).toBe(true);
    expect(isLiveStateDemoEnabled("?demo=privacy")).toBe(false);
    expect(isLiveStateDemoEnabled("")).toBe(false);
    expect(isLiveStateDemoEnabled(null)).toBe(false);
    expect(isLiveStateDemoEnabled("?demo=other")).toBe(false);
  });
});

describe("session machine reuse (connect -> capability -> session)", () => {
  it("reaches ready on the capable mock and blocks terminals otherwise", async () => {
    expect(selectSessionState(await connectScenario("supported-sepolia"))).toBe("ready");
    expect(selectSessionState(await connectScenario("unsupported"))).toBe("unsupported");
    expect(selectSessionState(await connectScenario("unknown"))).toBe("capability-unknown");
    expect(selectSessionState(await connectScenario("wrong-network"))).toBe("wrong-network");
  });
});

describe("mock live-state reader (typed adapter boundary)", () => {
  it("returns declared prism:8 owner + binding fixtures for a connected account", async () => {
    const state = await connectScenario("supported-sepolia");
    const reader = createMockLiveStateReader();
    const snap = await reader.readLiveState({
      accountAddress: state.session.accountAddress,
      consentGranted: true,
    });
    expect(snap.prismOwner.status).toBe("live");
    expect(snap.prismOwner.value).toContain(LIVE_STATE_CONSTANTS.owner);
    expect(snap.baseBinding.status).toBe("live");
    expect(snap.baseBinding.value).toContain(LIVE_STATE_CONSTANTS.boundBaseEoa);
    expect(snap.strkBalance.status).toBe("live");
    expect(snap.baseEth.status).toBe("live");
    expect(snap.privateBalance.status).toBe("live");
  });

  it("keeps the private-balance slot consent-gated (blocked until grant)", async () => {
    const state = await connectScenario("supported-sepolia");
    const reader = createMockLiveStateReader();
    const blocked = await reader.readLiveState({
      accountAddress: state.session.accountAddress,
      consentGranted: false,
    });
    expect(blocked.privateBalance.status).toBe("blocked");
    expect(blocked.privateBalance.value).toBe(null);
    expect(blocked.privateBalance.fallback).toBe(LIVE_STATE_FALLBACK_COPY["consent-required"]);
    // Public fields still resolve while the private slot stays blocked.
    expect(blocked.prismOwner.status).toBe("live");
  });

  it("renders idle fallback copy before connect and never retains secrets", async () => {
    const reader = createMockLiveStateReader();
    const idle = await reader.readLiveState({ accountAddress: null, consentGranted: false });
    for (const field of [idle.prismOwner, idle.baseBinding, idle.strkBalance, idle.baseEth, idle.privateBalance]) {
      expect(field.value).toBe(null);
      expect(field.fallback.length).toBeGreaterThan(0);
    }
    expect(idle).not.toHaveProperty("viewingKey");
    expect(() => assertNoViewingKey({ viewingKey: "0xabc" }, "livestate_probe")).toThrow();
  });
});

describe("blocked reader (every live-dependent state falls back)", () => {
  it("returns blocked/fallback copy for all fields once connected", async () => {
    const state = await connectScenario("supported-sepolia");
    const reader = createBlockedLiveStateReader();
    const snap = await reader.readLiveState({
      accountAddress: state.session.accountAddress,
      consentGranted: true,
    });
    for (const field of [snap.prismOwner, snap.baseBinding, snap.strkBalance, snap.baseEth]) {
      expect(field.status).toBe("blocked");
      expect(field.value).toBe(null);
      expect(field.fallback.length).toBeGreaterThan(0);
    }
    // Private slot always stays consent-gated copy.
    expect(snap.privateBalance.status).toBe("blocked");
  });
});

describe("consent grant/deny gates the private slot", () => {
  it("grant reveals, deny keeps consent-required", async () => {
    const state = await connectScenario("supported-sepolia");
    const scope = buildConsentScope({
      tokens: ["STRK"],
      sessionAddress: state.session.accountAddress,
      now: NOW,
    });
    const granted = decideConsent(state.session, scope, "granted", NOW + 1);
    expect(granted.session.consent.status).toBe("granted");
    const reader = createMockLiveStateReader();
    const revealed = await reader.readLiveState({
      accountAddress: granted.session.accountAddress,
      consentGranted: granted.session.consent.status === "granted",
    });
    expect(revealed.privateBalance.status).toBe("live");

    const denied = decideConsent(state.session, scope, "denied", NOW + 1);
    expect(denied.session.consent.status).toBe("denied");
    const kept = await reader.readLiveState({
      accountAddress: denied.session.accountAddress,
      consentGranted: false,
    });
    expect(kept.privateBalance.status).toBe("blocked");
  });
});
