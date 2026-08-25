import { describe, it, expect } from "vitest";
import { evaluatePolicy } from "../domain/policy-engine";
import type { Policy, VerificationSources } from "../domain/policy-engine";
import { createIntent } from "../domain/intent";
import { createExecutionPlan } from "../domain/execution-plan";
import { createPause } from "../domain/pause";
import { canAutoRelease, deriveRiskLevel } from "../domain/checks";
import { PAUSE_REASON_CODE } from "../domain/errors";

function basePolicy(): Policy {
  return {
    policyVersion: "v1",
    allowedChains: ["base", "starknet"],
    allowedAssets: ["0xdead", "*"],
    allowedContracts: ["*"],
    amountCeiling: "1000",
    requireFirstUseEscalation: true,
    allowedAgentScopes: [{ agentId: "agent_1", allowedChains: ["base"], allowedAssets: ["0xdead"], allowedContracts: ["*"], allowedRecipients: ["0xabc"], amountCeiling: "500" }],
  };
}

function baseIntent(overrides: Partial<Parameters<typeof createIntent>[0]> = {}) {
  return createIntent({
    intentId: "intent_1",
    principal: "prism:alice",
    initiator: "user",
    purpose: "payment",
    requestedRecipient: "0xabc",
    requestedAsset: "0xdead",
    requestedAmount: "100",
    requestedRoute: "base:0xdead:transfer",
    createdAt: 1000,
    expiresAt: 10_000,
    clientIdempotencyKey: "idem_1",
    policyVersion: "v1",
    ...overrides,
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
    intentId: "intent_1",
    createdAt: 1000,
  });
}

function basePause() {
  const plan = basePlan();
  return createPause({ pauseId: "pause_1", intentId: "intent_1", planHash: plan.planHash, policyVersion: "v1", createdAt: 1000, expiresAt: 10_000 });
}

const passingSources: VerificationSources = {
  recipientBinding: { status: "BOUND", observedValue: "0xabc" },
  firstUse: { isFirstUse: false },
  agentAuthorized: { authorized: true, observedAgentId: "agent_1" },
  routeAllowed: { chainAllowed: true, assetAllowed: true, contractAllowed: true, notRevoked: true },
  intentPlanMatch: { matches: true },
  simulation: { success: true, effectMatches: true, freshnessOk: true },
  additionalApproval: { requiresApproval: false },
  resolutionContinuity: { risks: [] },
};

describe("P3 typed checks and policy engine (fail-closed UNKNOWN)", () => {
  it("intended recipient passes", () => {
    const checks = evaluatePolicy({ intent: baseIntent(), plan: basePlan(), pause: basePause(), policy: basePolicy(), sources: passingSources, now: 1500 });
    expect(checks.some(c => c.checkId==="PAUSE-RECIPIENT-001" && c.status==="PASS")).toBe(true);
  });

  it("unbound/revoked recipient blocks", () => {
    const sources: VerificationSources = { ...passingSources, recipientBinding: { status: "REVOKED", observedValue: "0xabc" } };
    const checks = evaluatePolicy({ intent: baseIntent(), plan: basePlan(), pause: basePause(), policy: basePolicy(), sources, now: 1500 });
    expect(checks.some(c => c.severity==="BLOCKING" && c.status==="FAIL")).toBe(true);
    expect(canAutoRelease(checks)).toBe(false);
  });

  it("BOUND recipient blocks when the observed value does not match the requested recipient", () => {
    const sources: VerificationSources = { ...passingSources, recipientBinding: { status: "BOUND", observedValue: "0xdef" } };
    const checks = evaluatePolicy({ intent: baseIntent(), plan: basePlan(), pause: basePause(), policy: basePolicy(), sources, now: 1500 });
    const binding = checks.find(c => c.checkId === "PAUSE-RECIPIENT-001");
    const bound = checks.find(c => c.checkId === "PAUSE-RECIPIENT-002");

    expect(binding).toMatchObject({ status: "FAIL", severity: "BLOCKING", reasonCode: PAUSE_REASON_CODE.RECIPIENT_RESOLVE_FAIL });
    expect(bound).toMatchObject({ status: "FAIL", severity: "BLOCKING", reasonCode: PAUSE_REASON_CODE.RECIPIENT_NOT_BOUND_OR_REVOKED });
    expect(canAutoRelease(checks)).toBe(false);
  });

  it("recipient comparison uses canonical case and outer-whitespace normalization", () => {
    const intent = baseIntent({ requestedRecipient: " 0xAbC " });
    const sources: VerificationSources = { ...passingSources, recipientBinding: { status: "BOUND", observedValue: " 0XABC " } };
    const checks = evaluatePolicy({ intent, plan: basePlan(), pause: basePause(), policy: basePolicy(), sources, now: 1500 });

    expect(checks.find(c => c.checkId === "PAUSE-RECIPIENT-001")?.status).toBe("PASS");
    expect(checks.find(c => c.checkId === "PAUSE-RECIPIENT-002")?.status).toBe("PASS");
  });

  it("first recipient escalates when configured", () => {
    const sources: VerificationSources = { ...passingSources, firstUse: { isFirstUse: true } };
    const checks = evaluatePolicy({ intent: baseIntent(), plan: basePlan(), pause: basePause(), policy: basePolicy(), sources, now: 1500 });
    expect(checks.find(c=>c.checkId==="PAUSE-RECIPIENT-003")?.status).toBe("FAIL");
    expect(canAutoRelease(checks)).toBe(false);
  });

  it("amount above threshold escalates/blocks", () => {
    const intent = createIntent({ intentId: "intent_1", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "2000", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 10_000, clientIdempotencyKey: "idem_1", policyVersion: "v1" });
    const checks = evaluatePolicy({ intent, plan: basePlan(), pause: basePause(), policy: basePolicy(), sources: passingSources, now: 1500 });
    expect(checks.find(c=>c.checkId==="PAUSE-RISK-001")?.status).toBe("FAIL");
  });

  it.each(["-1", "1e2", "100abc", "1.", ".5"])("amount string %s never passes the ceiling check", (requestedAmount) => {
    const intent = baseIntent({ requestedAmount });
    const checks = evaluatePolicy({ intent, plan: basePlan(), pause: basePause(), policy: basePolicy(), sources: passingSources, now: 1500 });
    const amountCheck = checks.find(c => c.checkId === "PAUSE-RISK-001");

    expect(amountCheck).toMatchObject({ severity: "BLOCKING", reasonCode: PAUSE_REASON_CODE.AMOUNT_CEILING });
    expect(amountCheck?.status).not.toBe("PASS");
    expect(canAutoRelease(checks)).toBe(false);
  });

  it("rejects a precision-sensitive amount instead of allowing Number rounding to bypass the ceiling", () => {
    const intent = baseIntent({ requestedAmount: "9007199254740993" });
    const policy = { ...basePolicy(), amountCeiling: "9007199254740992" };
    const checks = evaluatePolicy({ intent, plan: basePlan(), pause: basePause(), policy, sources: passingSources, now: 1500 });

    expect(checks.find(c => c.checkId === "PAUSE-RISK-001")).toMatchObject({ status: "FAIL", severity: "BLOCKING", reasonCode: PAUSE_REASON_CODE.AMOUNT_CEILING });
    expect(canAutoRelease(checks)).toBe(false);
  });

  it("validates the requested amount even when no ceiling is configured", () => {
    const intent = baseIntent({ requestedAmount: "-1" });
    const policy = { ...basePolicy(), amountCeiling: null };
    const checks = evaluatePolicy({ intent, plan: basePlan(), pause: basePause(), policy, sources: passingSources, now: 1500 });

    expect(checks.find(c => c.checkId === "PAUSE-RISK-001")).toMatchObject({ status: "UNKNOWN", severity: "BLOCKING", reasonCode: PAUSE_REASON_CODE.AMOUNT_CEILING });
    expect(canAutoRelease(checks)).toBe(false);
  });

  it("agent scope uses the same exact amount validation", () => {
    const intent = baseIntent({ initiator: "agent", agentId: "agent_1", requestedAmount: "1e2" });
    const checks = evaluatePolicy({ intent, plan: basePlan(), pause: basePause(), policy: basePolicy(), sources: passingSources, now: 1500 });

    expect(checks.find(c=>c.checkId==="PAUSE-AUTH-002")).toMatchObject({ status: "UNKNOWN", severity: "BLOCKING", reasonCode: PAUSE_REASON_CODE.AGENT_SCOPE });
    expect(canAutoRelease(checks)).toBe(false);
  });

  it("agent outside scope blocks", () => {
    const intent = createIntent({ intentId: "intent_1", principal: "prism:alice", initiator: "agent", agentId: "agent_99", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 10_000, clientIdempotencyKey: "idem_1", policyVersion: "v1" });
    const checks = evaluatePolicy({ intent, plan: basePlan(), pause: basePause(), policy: basePolicy(), sources: passingSources, now: 1500 });
    expect(checks.find(c=>c.checkId==="PAUSE-AUTH-002")?.status).toBe("FAIL");
  });

  it("wrong chain/asset/contract blocks", () => {
    const plan = createExecutionPlan({ chainId: "evil", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: "intent_1", createdAt: 1000 });
    const pause = createPause({ pauseId: "pause_1", intentId: "intent_1", planHash: plan.planHash, policyVersion: "v1", createdAt: 1000, expiresAt: 10_000 });
    const sources: VerificationSources = { ...passingSources, routeAllowed: { chainAllowed: false, assetAllowed: false, contractAllowed: false, notRevoked: true } };
    const checks = evaluatePolicy({ intent: baseIntent(), plan, pause, policy: basePolicy(), sources, now: 1500 });
    expect(checks.filter(c=>c.severity==="BLOCKING" && c.status==="FAIL").length).toBeGreaterThanOrEqual(2);
  });

  it("UNKNOWN simulator result blocks auto-release (fail-closed)", () => {
    const sources: VerificationSources = { ...passingSources, simulation: { success: null, effectMatches: null, freshnessOk: null, unknown: true } as unknown as VerificationSources["simulation"] };
    const checks = evaluatePolicy({ intent: baseIntent(), plan: basePlan(), pause: basePause(), policy: basePolicy(), sources, now: 1500 });
    expect(checks.some(c=>c.status==="UNKNOWN" && c.severity==="BLOCKING")).toBe(true);
    expect(canAutoRelease(checks)).toBe(false);
  });

  it("plan mutation invalidates release readiness (intent-plan mismatch)", () => {
    const sources: VerificationSources = { ...passingSources, intentPlanMatch: { matches: false } };
    const checks = evaluatePolicy({ intent: baseIntent(), plan: basePlan(), pause: basePause(), policy: basePolicy(), sources, now: 1500 });
    expect(checks.find(c=>c.checkId==="PAUSE-INTENT-001")?.status).toBe("FAIL");
  });

  it("deriveRiskLevel UNKNOWN when any check unknown", () => {
    const sources: VerificationSources = { ...passingSources, simulation: { success: null, effectMatches: null, freshnessOk: null } as unknown as VerificationSources["simulation"] };
    const checks = evaluatePolicy({ intent: baseIntent(), plan: basePlan(), pause: basePause(), policy: basePolicy(), sources, now: 1500 });
    expect(deriveRiskLevel(checks)).toBe("UNKNOWN");
  });

  it("typed results always have stable fields", () => {
    const checks = evaluatePolicy({ intent: baseIntent(), plan: basePlan(), pause: basePause(), policy: basePolicy(), sources: passingSources, now: 1500 });
    for (const c of checks) {
      expect(c.checkId).toBeTruthy();
      expect(c.reasonCode).toBeTruthy();
      expect(c.source).toBeTruthy();
      expect(["PASS","FAIL","UNKNOWN","NOT_APPLICABLE"]).toContain(c.status);
      expect(["INFO","WARNING","BLOCKING"]).toContain(c.severity);
    }
  });
});
