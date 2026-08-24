import { describe, it, expect } from "vitest";
import { evaluatePolicy } from "../domain/policy-engine";
import type { Policy, VerificationSources } from "../domain/policy-engine";
import { createIntent } from "../domain/intent";
import { createExecutionPlan } from "../domain/execution-plan";
import { createPause } from "../domain/pause";
import { canAutoRelease, deriveRiskLevel } from "../domain/checks";

function basePolicy(): Policy {
  return {
    policyVersion: "v1",
    allowedChains: ["base", "starknet"],
    allowedAssets: ["0xdead", "*"],
    allowedContracts: ["*"],
    amountCeiling: "1000",
    requireFirstUseEscalation: true,
    allowedAgentScopes: [{ agentId: "agent_1", allowedChains: ["base"], allowedAssets: ["0xdead"], allowedContracts: ["*"], amountCeiling: "500" }],
  };
}

function baseIntent() {
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
  agentAuthorized: { authorized: true },
  routeAllowed: { chainAllowed: true, assetAllowed: true, contractAllowed: true, notRevoked: true },
  intentPlanMatch: { matches: true },
  simulation: { success: true, effectMatches: true, freshnessOk: true },
  additionalApproval: { requiresApproval: false },
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
