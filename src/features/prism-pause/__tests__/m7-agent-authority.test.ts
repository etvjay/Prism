import { describe, expect, it } from "vitest";
import { canAutoRelease, CHECK_ID } from "../domain/checks";
import { evaluatePolicy } from "../domain/policy-engine";
import type { Policy, VerificationSources } from "../domain/policy-engine";
import { createIntent } from "../domain/intent";
import { createExecutionPlan } from "../domain/execution-plan";
import { createPause } from "../domain/pause";
import { PAUSE_REASON_CODE } from "../domain/errors";

const agentPolicy: Policy = {
  policyVersion: "v1",
  allowedChains: ["base"],
  allowedAssets: ["0xdead"],
  // The global route allowlist is deliberately broad so these tests isolate
  // the delegated-agent scope constraints.
  allowedContracts: ["*"],
  amountCeiling: "1000",
  requireFirstUseEscalation: false,
  allowedAgentScopes: [{
    agentId: "agent_1",
    allowedChains: ["base"],
    allowedAssets: ["0xdead"],
    allowedContracts: ["transfer"],
    allowedRecipients: ["0xabc"],
    amountCeiling: "500",
  }],
};

function fixture(overrides: {
  recipient?: string;
  calls?: readonly string[];
  policy?: Partial<Policy>;
  sources?: Partial<VerificationSources>;
} = {}) {
  const recipient = overrides.recipient ?? "0xabc";
  const intent = createIntent({
    intentId: "intent_agent_authority",
    principal: "prism:alice",
    initiator: "agent",
    agentId: "agent_1",
    purpose: "payment",
    requestedRecipient: recipient,
    requestedAsset: "0xdead",
    requestedAmount: "100",
    requestedRoute: "base:0xdead:transfer",
    createdAt: 1_000,
    expiresAt: 20_000,
    clientIdempotencyKey: "idem_agent_authority",
    policyVersion: "v1",
  });
  const plan = createExecutionPlan({
    chainId: "base",
    asset: "0xdead",
    recipient,
    calls: overrides.calls ?? ["transfer"],
    valueLimits: { maxValue: "100" },
    policyVersion: "v1",
    intentId: intent.intentId,
    createdAt: 1_100,
  });
  const pause = createPause({
    pauseId: "pause_agent_authority",
    intentId: intent.intentId,
    planHash: plan.planHash,
    policyVersion: "v1",
    createdAt: 1_200,
    expiresAt: 20_000,
  });
  const sources: VerificationSources = {
    recipientBinding: { status: "BOUND", observedValue: recipient },
    firstUse: { isFirstUse: false },
    agentAuthorized: { authorized: true, observedAgentId: "agent_1" },
    routeAllowed: { chainAllowed: true, assetAllowed: true, contractAllowed: true, notRevoked: true },
    intentPlanMatch: { matches: true },
    simulation: { success: true, effectMatches: true, freshnessOk: true },
    additionalApproval: { requiresApproval: false },
    ...overrides.sources,
  };
  return {
    intent,
    plan,
    pause,
    policy: { ...agentPolicy, ...overrides.policy },
    sources,
  };
}

describe("M7 delegated-agent authority scope", () => {
  it("requires observedAgentId to equal the intent agentId", () => {
    const { intent, plan, pause, policy, sources } = fixture({
      sources: { agentAuthorized: { authorized: true, observedAgentId: "agent_2" } },
    });

    const checks = evaluatePolicy({ intent, plan, pause, policy, sources, now: 1_300 });
    expect(checks.find((check) => check.checkId === CHECK_ID.AGENT_SCOPE)).toMatchObject({
      status: "FAIL",
      severity: "BLOCKING",
      reasonCode: PAUSE_REASON_CODE.AGENT_SCOPE,
    });
    expect(canAutoRelease(checks)).toBe(false);
  });

  it("fails closed when the authoritative agent identity is missing", () => {
    const { intent, plan, pause, policy, sources } = fixture({
      sources: { agentAuthorized: { authorized: true } },
    });

    const checks = evaluatePolicy({ intent, plan, pause, policy, sources, now: 1_300 });
    expect(checks.find((check) => check.checkId === CHECK_ID.AGENT_SCOPE)).toMatchObject({
      status: "UNKNOWN",
      severity: "BLOCKING",
      reasonCode: PAUSE_REASON_CODE.AGENT_SCOPE,
    });
    expect(canAutoRelease(checks)).toBe(false);
  });

  it("enforces the delegated scope contract allowlist even when route facts claim pass", () => {
    const { intent, plan, pause, policy, sources } = fixture({
      policy: {
        allowedAgentScopes: [{
          ...agentPolicy.allowedAgentScopes![0],
          allowedContracts: ["mint"],
        }],
      },
    });

    const checks = evaluatePolicy({ intent, plan, pause, policy, sources, now: 1_300 });
    expect(checks.find((check) => check.checkId === CHECK_ID.AGENT_SCOPE)).toMatchObject({
      status: "FAIL",
      severity: "BLOCKING",
      reasonCode: PAUSE_REASON_CODE.AGENT_SCOPE,
    });
    expect(canAutoRelease(checks)).toBe(false);
  });

  it("enforces the delegated scope recipient allowlist", () => {
    const { intent, plan, pause, policy, sources } = fixture({
      recipient: "0xdef",
    });

    const checks = evaluatePolicy({ intent, plan, pause, policy, sources, now: 1_300 });
    expect(checks.find((check) => check.checkId === CHECK_ID.AGENT_SCOPE)).toMatchObject({
      status: "FAIL",
      severity: "BLOCKING",
      reasonCode: PAUSE_REASON_CODE.AGENT_SCOPE,
    });
    expect(canAutoRelease(checks)).toBe(false);
  });

  it("treats a delegated scope without recipient bounds as UNKNOWN and blocking", () => {
    const { intent, plan, pause, policy, sources } = fixture({
      policy: {
        allowedAgentScopes: [{
          agentId: "agent_1",
          allowedChains: ["base"],
          allowedAssets: ["0xdead"],
          allowedContracts: ["transfer"],
          amountCeiling: "500",
        }],
      },
    });

    const checks = evaluatePolicy({ intent, plan, pause, policy, sources, now: 1_300 });
    expect(checks.find((check) => check.checkId === CHECK_ID.AGENT_SCOPE)).toMatchObject({
      status: "UNKNOWN",
      severity: "BLOCKING",
      reasonCode: PAUSE_REASON_CODE.AGENT_SCOPE,
    });
    expect(canAutoRelease(checks)).toBe(false);
  });

  it("treats an agent with no configured scope as UNKNOWN and blocking", async () => {
    const { intent, plan, pause, policy, sources } = fixture({
      policy: { allowedAgentScopes: null },
    });

    const checks = evaluatePolicy({ intent, plan, pause, policy, sources, now: 1_300 });
    expect(checks.find((check) => check.checkId === CHECK_ID.AGENT_SCOPE)).toMatchObject({
      status: "UNKNOWN",
      severity: "BLOCKING",
      reasonCode: PAUSE_REASON_CODE.AGENT_SCOPE,
    });
    expect(canAutoRelease(checks)).toBe(false);
  });

  it("does not let a passing route fact bypass the global contract allowlist", () => {
    const { intent, plan, pause, sources } = fixture({
      policy: { allowedContracts: ["mint"] },
    });

    const checks = evaluatePolicy({
      intent,
      plan,
      pause,
      policy: { ...agentPolicy, allowedContracts: ["mint"] },
      sources,
      now: 1_300,
    });
    expect(checks.find((check) => check.checkId === CHECK_ID.CONTRACT_ALLOWED)).toMatchObject({
      status: "FAIL",
      severity: "BLOCKING",
    });
    expect(canAutoRelease(checks)).toBe(false);
  });
});
