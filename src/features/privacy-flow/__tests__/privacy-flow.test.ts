import { describe, expect, it } from "vitest";
import { assertNoViewingKey } from "../../prism-strk20/domain/privacy-guard";
import { classifyStrk20Capability } from "../../prism-strk20/domain/wallet-capability";
import { STRK20_ERROR_CODE } from "../../prism-strk20/domain/errors";
import { createSessionReducerState, sessionReducer } from "../../wallet/session/reducer";
import { selectCapabilities, selectSessionState } from "../../wallet/session/selectors";
import { createStarknetWalletSession } from "../../wallet/session/session-state";
import { StarknetWalletSessionAdapter } from "../../wallet/session/starknet-wallet-adapter";
import { buildConsentScope, decideConsent } from "../consent";
import { isPrivacyDemoEnabled } from "../demoFlag";
import {
  createMockStarknetProvider,
  mockReceiptFixture,
  mockTwoHashActivity,
  MOCK_APPROVAL_HASH,
  MOCK_SHIELD_HASH,
} from "../mockPrivacyWallet";
import { assertFeeFresh, twoHashSlots, validateShieldAmount } from "../shieldIntent";

const NOW = 1_750_000_000_000;

async function reducedScenario(scenario: Parameters<typeof createMockStarknetProvider>[0]) {
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

describe("privacy demo flag", () => {
  it("enables only on the demo values and leaves default renders unchanged", () => {
    expect(isPrivacyDemoEnabled("?demo=privacy")).toBe(true);
    expect(isPrivacyDemoEnabled("?demo=privacy-style")).toBe(true);
    expect(isPrivacyDemoEnabled("?demo=session")).toBe(true);
    expect(isPrivacyDemoEnabled("")).toBe(false);
    expect(isPrivacyDemoEnabled(null)).toBe(false);
    expect(isPrivacyDemoEnabled("?demo=other")).toBe(false);
    expect(isPrivacyDemoEnabled("?n=session")).toBe(false);
  });
});

describe("mock wallet scenarios through the real adapter + reducer", () => {
  it("maps supported >=0.10.3 to ready with three capability slots", async () => {
    const state = await reducedScenario("supported-sepolia");
    expect(selectSessionState(state)).toBe("ready");
    const slots = selectCapabilities(state.session);
    expect(slots.map((slot) => slot.id)).toEqual(["supportedWalletApi", "supportedSpecs", "strk20"]);
    expect(slots.every((slot) => slot.status === "supported")).toBe(true);
    expect(classifyStrk20Capability(["0.10.3"], ["0.10.3"])).toBe("supported");
  });

  it("maps legacy versions to the unsupported blocked terminal", async () => {
    const state = await reducedScenario("unsupported");
    expect(selectSessionState(state)).toBe("unsupported");
    expect(classifyStrk20Capability(["0.9.1"], ["0.9.0"])).toBe("unsupported");
  });

  it("maps empty version arrays to the capability-unknown blocked terminal", async () => {
    const state = await reducedScenario("unknown");
    expect(selectSessionState(state)).toBe("capability-unknown");
    expect(classifyStrk20Capability([], [])).toBe("unknown");
  });

  it("maps a mismatched chain to the wrong-network blocked terminal", async () => {
    const state = await reducedScenario("wrong-network");
    expect(selectSessionState(state)).toBe("wrong-network");
  });
});

describe("shield intent guards", () => {
  it("rejects non-positive and over-precision amounts", () => {
    expect(validateShieldAmount("1.5")).toEqual({ ok: true });
    expect(validateShieldAmount("0").ok).toBe(false);
    expect(validateShieldAmount("-2").ok).toBe(false);
    expect(validateShieldAmount("1.0000000000000000001").ok).toBe(false);
    expect(validateShieldAmount("abc").ok).toBe(false);
  });

  it("blocks stale fees with FEE_CHANGED and keeps slots empty until submit", () => {
    expect(() => assertFeeFresh("0x1", "0x2")).toThrowError(/STRK20-008/);
    assertFeeFresh("0x10", "0x10");
    const empty = twoHashSlots({ token: "STRK", amount: "", feeLabel: "q", feeWei: "0x10" }, false);
    expect(empty.every((slot) => slot.transactionHash === null)).toBe(true);
    const filled = twoHashSlots({ token: "STRK", amount: "1", feeLabel: "q", feeWei: "0x10" }, true);
    expect(filled.map((slot) => slot.transactionHash)).toEqual([MOCK_APPROVAL_HASH, MOCK_SHIELD_HASH]);
  });
});

describe("consent grant/deny with secret-material guards", () => {
  it("binds consent to tokens + session + timestamp and grants", async () => {
    const state = await reducedScenario("supported-sepolia");
    const scope = buildConsentScope({
      tokens: ["STRK"],
      sessionAddress: state.session.accountAddress,
      now: NOW,
    });
    const { session: next, record } = decideConsent(state.session, scope, "granted", NOW + 1);
    expect(record.decision).toBe("granted");
    expect(record.tokens).toEqual(["STRK"]);
    expect(record.sessionAddress).toBe(state.session.accountAddress);
    expect(record.requestedAt).toBe(NOW);
    expect(record.consentReference.startsWith("audit-ref-")).toBe(true);
    expect(next.consent.status).toBe("granted");
    expect(record).not.toHaveProperty("viewingKey");
  });

  it("denies with CONSENT_DENIED and keeps the session in consent-required", async () => {
    const state = await reducedScenario("supported-sepolia");
    const scope = buildConsentScope({
      tokens: ["STRK", "USDC"],
      sessionAddress: state.session.accountAddress,
      now: NOW,
    });
    const { session: next } = decideConsent(state.session, scope, "denied", NOW + 1);
    expect(next.consent.status).toBe("denied");
    expect(next.error?.code).toBe("CONSENT_DENIED");
    expect(next.status).toBe("consent-required");
  });

  it("fails closed on viewing-key material and never retains it", () => {
    expect(() => assertNoViewingKey({ viewingKey: "0xabc" }, "consent_probe")).toThrowError(
      new RegExp(STRK20_ERROR_CODE.VIEWING_KEY_FORBIDDEN),
    );
    expect(() =>
      buildConsentScope({ tokens: ["viewingKey"], sessionAddress: null, now: NOW }),
    ).toThrow();
  });
});

describe("receipt and activity tail", () => {
  it("shows SUCCEEDED + ACCEPTED + block + pool for the shield slot", () => {
    const confirmed = mockReceiptFixture("confirmed");
    expect(confirmed.executionStatus).toBe("SUCCEEDED");
    expect(confirmed.finalityStatus).toBe("ACCEPTED_ON_L2");
    expect(typeof confirmed.blockNumber).toBe("number");
    expect(confirmed.poolEventFound).toBe(true);
    const tail = mockTwoHashActivity("confirmed");
    expect(tail.map((entry) => entry.slot)).toEqual(["approval", "shield"]);
    expect(tail[1].poolEventFound).toBe(true);
  });

  it("keeps pending receipts blockless and pool-absent", () => {
    const pending = mockReceiptFixture("pending");
    expect(pending.blockNumber).toBe(null);
    expect(pending.poolEventFound).toBe(false);
    expect(pending.executionStatus).not.toBe("SUCCEEDED");
  });
});
