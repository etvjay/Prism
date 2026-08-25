import { describe, expect, it } from "vitest";
import { createIsolatedFactory } from "../../../application/factory";
import { canAutoRelease, makeCheck, CHECK_ID } from "../domain/checks";
import { evaluatePolicy } from "../domain/policy-engine";
import type { Policy, VerificationSources, VerificationSourceProvider } from "../domain/policy-engine";
import { createIntent } from "../domain/intent";
import { createExecutionPlan } from "../domain/execution-plan";
import { createPause, approveEscalation } from "../domain/pause";
import { PAUSE_ERROR_CODE, PAUSE_REASON_CODE } from "../domain/errors";

const policy: Policy = {
  policyVersion: "v1",
  allowedChains: ["base"],
  allowedAssets: ["0xdead"],
  allowedContracts: ["*"],
  amountCeiling: "1000",
  requireFirstUseEscalation: false,
};

function baseIntent() {
  return createIntent({
    intentId: "intent_m7_hardening",
    principal: "prism:alice",
    initiator: "user",
    purpose: "payment",
    requestedRecipient: "0xabc",
    requestedAsset: "0xdead",
    requestedAmount: "100",
    requestedRoute: "base:0xdead:transfer",
    createdAt: 1_000,
    expiresAt: 20_000,
    clientIdempotencyKey: "idem_m7_hardening",
    policyVersion: "v1",
  });
}

function basePlan() {
  return createExecutionPlan({
    chainId: "base",
    asset: "0xdead",
    recipient: "0xabc",
    calls: ["transfer"],
    valueLimits: { maxValue: "100" },
    policyVersion: "v1",
    intentId: "intent_m7_hardening",
    createdAt: 1_100,
  });
}

function basePause(planHash: `0x${string}`) {
  return createPause({
    pauseId: "pause_m7_hardening",
    intentId: "intent_m7_hardening",
    planHash,
    policyVersion: "v1",
    createdAt: 1_200,
    expiresAt: 20_000,
  });
}

const passingSources: VerificationSources = {
  recipientBinding: { status: "BOUND", observedValue: "0xabc" },
  firstUse: { isFirstUse: false },
  agentAuthorized: { authorized: true },
  routeAllowed: { chainAllowed: true, assetAllowed: true, contractAllowed: true, notRevoked: true },
  intentPlanMatch: { matches: true },
  simulation: { success: true, effectMatches: true, freshnessOk: true },
  additionalApproval: { requiresApproval: false },
};

describe("M7 verification trust and omission hardening", () => {
  it("does not let an unknown recipient-binding status fall through as no check", () => {
    const intent = baseIntent();
    const plan = basePlan();

    expect(() => evaluatePolicy({
      intent,
      plan,
      pause: basePause(plan.planHash),
      policy,
      sources: {
        ...passingSources,
        recipientBinding: { status: "FORGED" as never, observedValue: "0xabc" },
      },
      now: 1_300,
    })).toThrowError(expect.objectContaining({
      code: PAUSE_ERROR_CODE.INVALID_STATE,
    }));
  });

  it("rejects malformed check statuses at construction instead of treating them as passing", () => {
    expect(() => makeCheck(
      CHECK_ID.SIM_SUCCESS,
      "FORGED" as never,
      "BLOCKING",
      PAUSE_REASON_CODE.SIMULATION_UNKNOWN,
      "simulator",
      1_300,
    )).toThrowError(expect.objectContaining({ code: PAUSE_ERROR_CODE.INVALID_STATE }));
  });

  it("treats partial route facts as UNKNOWN and blocking", () => {
    const intent = baseIntent();
    const plan = basePlan();
    const checks = evaluatePolicy({
      intent,
      plan,
      pause: basePause(plan.planHash),
      policy,
      sources: {
        ...passingSources,
        routeAllowed: { chainAllowed: true, assetAllowed: true, contractAllowed: true },
      },
      now: 1_300,
    });

    expect(checks.find((check) => check.checkId === CHECK_ID.ROUTE_NOT_REVOKED)).toMatchObject({
      status: "UNKNOWN",
      severity: "BLOCKING",
    });
    expect(canAutoRelease(checks)).toBe(false);
  });

  it("defaults the REST adapter to UNKNOWN facts, while an explicitly injected test provider can pass", async () => {
    const defaultFactory = createIsolatedFactory();
    const defaultIntent = await defaultFactory.pauseService.createIntent({
      prismId: "prism:m7-default",
      purpose: "payment",
      amount: "10",
      asset: "0xdead",
      recipientAddress: "0xabc",
      idempotencyKey: "idem-m7-default-unknown",
    });
    const defaultPause = await defaultFactory.pauseService.pauseIntent(defaultIntent.intentId);
    const defaultVerified = await defaultFactory.pauseService.verifyPause(defaultPause.pauseId);
    expect(defaultVerified.state).toBe("ESCALATED");
    expect(defaultVerified.riskLevel).toBe("UNKNOWN");
    expect(defaultVerified.reasonCodes).toContain(PAUSE_REASON_CODE.SIMULATION_UNKNOWN);

    const provider: VerificationSourceProvider = () => passingSources;
    const testFactory = createIsolatedFactory(1_789_000_001, { verificationSourceProvider: provider });
    const testIntent = await testFactory.pauseService.createIntent({
      prismId: "prism:m7-injected",
      purpose: "payment",
      amount: "10",
      asset: "0xdead",
      recipientAddress: "0xabc",
      idempotencyKey: "idem-m7-injected-pass",
    });
    const testPause = await testFactory.pauseService.pauseIntent(testIntent.intentId);
    const testVerified = await testFactory.pauseService.verifyPause(testPause.pauseId);
    expect(testVerified.state).toBe("RELEASE_READY");
  });

  it("does not allow malformed persisted check status to clear an escalated pause", () => {
    const plan = basePlan();
    const pause = {
      ...basePause(plan.planHash),
      state: "ESCALATED" as const,
      version: 1,
      checks: [{
        checkId: CHECK_ID.SIM_SUCCESS,
        status: "FORGED",
        severity: "BLOCKING",
        reasonCode: PAUSE_REASON_CODE.SIMULATION_UNKNOWN,
        source: "simulator",
        checkedAt: 1_300,
      }] as never,
      reasonCodes: [PAUSE_REASON_CODE.SIMULATION_UNKNOWN],
      requiredApprovalCount: 1,
    };

    expect(() => approveEscalation(pause, {
      planHash: plan.planHash,
      approvalScopeHash: null,
      now: 1_400,
      expectedVersion: 1,
    })).toThrowError(expect.objectContaining({ code: PAUSE_ERROR_CODE.INVALID_STATE }));
  });
});