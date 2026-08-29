import { describe, expect, it } from "vitest";
import {
  activateSessionGrant,
  authorizeSessionAction,
  assertSecureSessionGrant,
  createSessionGrant,
  revokeSessionGrant,
} from "../domain/sessions";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const SESSION_ACCOUNT = "0x5555555555555555555555555555555555555555";
const TARGET = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const SELECTOR = "0xa9059cbb";

const secureInput = {
  id: "grant-base-sepolia",
  prismId: "prism:owner",
  endpointId: "base-sepolia-smart-account",
  delegatePublicKey: "delegate-public-key",
  chainId: 84532,
  account: ACCOUNT,
  delegateAccount: SESSION_ACCOUNT,
  replay: { mode: "unique-key" as const, namespace: "prism:owner:base" },
  scope: {
    contracts: [TARGET],
    selectors: [SELECTOR],
    spendLimits: [{ asset: TOKEN, maxPerCall: 10n, maxTotal: 100n }],
    maxCalls: 20,
  },
  validFrom: 1_700_000_000,
  validUntil: 1_700_003_600,
};

describe("provider-neutral SessionGrant", () => {
  it("requires a complete chain and account binding before adapter use", () => {
    const secure = createSessionGrant(secureInput);
    expect(() => assertSecureSessionGrant(secure)).not.toThrow();
    expect(() => createSessionGrant({ ...secureInput, delegateAccount: undefined })).toThrow("session_delegate_account_required");
    expect(() => assertSecureSessionGrant(createSessionGrant({
      id: "legacy-grant",
      prismId: "prism:owner",
      endpointId: "legacy",
      delegatePublicKey: "delegate-public-key",
      scope: { contracts: ["target"] },
      validFrom: secureInput.validFrom,
      validUntil: secureInput.validUntil,
    }))).toThrow("session_chain_id_required");
  });

  it("enforces target, selector, asset, per-call, aggregate, chain, and account bounds", () => {
    const active = activateSessionGrant(createSessionGrant(secureInput), secureInput.validFrom);
    const baseAction = {
      contract: TARGET,
      selector: SELECTOR,
      asset: TOKEN,
      amount: 10n,
      chainId: 84532,
      account: ACCOUNT,
      delegateAccount: SESSION_ACCOUNT,
      replayKey: "nonce-1",
      now: secureInput.validFrom + 1,
    };

    expect(() => authorizeSessionAction(active, { ...baseAction, contract: ACCOUNT })).toThrow("session_contract_not_allowed");
    expect(() => authorizeSessionAction(active, { ...baseAction, selector: "0x095ea7b3" })).toThrow("session_selector_not_allowed");
    expect(() => authorizeSessionAction(active, { ...baseAction, asset: "0x4444444444444444444444444444444444444444" })).toThrow("session_asset_not_allowed");
    expect(() => authorizeSessionAction(active, { ...baseAction, amount: 11n })).toThrow("session_per_call_spend_limit_exceeded");
    expect(() => authorizeSessionAction(active, { ...baseAction, chainId: 1 })).toThrow("session_chain_not_allowed");
    expect(() => authorizeSessionAction(active, { ...baseAction, account: ACCOUNT.replace("11", "55") })).toThrow("session_account_not_allowed");

    let next = authorizeSessionAction(active, baseAction);
    expect(next.usage).toEqual({ calls: 1, spentByToken: { [TOKEN]: 10n }, consumedReplayKeys: ["prism:owner:base:nonce-1"] });
    expect(() => authorizeSessionAction(next, baseAction)).toThrow("session_replay_detected");

    const aggregateGrant = activateSessionGrant(createSessionGrant({
      ...secureInput,
      id: "grant-aggregate",
      scope: { ...secureInput.scope, spendLimits: [{ asset: TOKEN, maxPerCall: 10n, maxTotal: 25n }] },
    }), secureInput.validFrom);
    next = authorizeSessionAction(aggregateGrant, { ...baseAction, replayKey: "aggregate-1" });
    next = authorizeSessionAction(next, { ...baseAction, replayKey: "aggregate-2" });
    expect(() => authorizeSessionAction(next, { ...baseAction, amount: 6n, replayKey: "aggregate-3" })).toThrow("session_aggregate_spend_limit_exceeded");
  });

  it("rejects actions after expiry or revocation and exhausts the call count", () => {
    const grant = createSessionGrant({ ...secureInput, id: "grant-lifecycle" });
    const active = activateSessionGrant(grant, secureInput.validFrom);
    const action = {
      contract: TARGET,
      selector: SELECTOR,
      asset: TOKEN,
      amount: 1n,
      chainId: 84532,
      account: ACCOUNT,
      delegateAccount: SESSION_ACCOUNT,
      replayKey: "lifecycle-1",
      now: secureInput.validFrom + 1,
    };

    expect(() => authorizeSessionAction(active, { ...action, now: secureInput.validUntil })).toThrow("session_grant_expired");
    expect(() => authorizeSessionAction(revokeSessionGrant(active), action)).toThrow("session_grant_not_active");

    const oneCall = activateSessionGrant(createSessionGrant({
      ...secureInput,
      id: "grant-one-call",
      scope: { ...secureInput.scope, maxCalls: 1 },
    }), secureInput.validFrom);
    const exhausted = authorizeSessionAction(oneCall, action);
    expect(exhausted.status).toBe("EXHAUSTED");
    expect(() => authorizeSessionAction(exhausted, { ...action, replayKey: "lifecycle-2" })).toThrow("session_grant_not_active");
  });

});
