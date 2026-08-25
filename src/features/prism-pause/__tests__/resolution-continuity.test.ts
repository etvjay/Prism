import { describe, expect, it } from "vitest";
import { canAutoRelease, makeCheck, CHECK_ID } from "../domain/checks";
import { createExecutionPlan } from "../domain/execution-plan";
import { createIntent } from "../domain/intent";
import { createPause, approveEscalation } from "../domain/pause";
import { InMemoryPauseStore } from "../adapters/memory-pause-store";
import { PauseService } from "../application/pause-service";
import {
  assessResolutionContinuity,
  DEFAULT_RESOLUTION_CONTINUITY_OUTCOMES,
  ResolutionContinuityCheck,
  type ResolutionContinuityRisk,
  type ResolutionContinuitySource,
} from "../domain/resolution-continuity";
import { evaluatePolicy } from "../domain/policy-engine";
import type { Policy, VerificationSources } from "../domain/policy-engine";
import { PAUSE_ERROR_CODE, PAUSE_REASON_CODE } from "../domain/errors";

const policy: Policy = {
  policyVersion: "v1",
  allowedChains: ["base", "starknet"],
  allowedAssets: ["0xdead"],
  allowedContracts: ["*"],
  amountCeiling: "1000",
  requireFirstUseEscalation: false,
};

function fixture() {
  const intent = createIntent({
    intentId: "intent_resolution_continuity",
    principal: "prism:alice",
    initiator: "user",
    purpose: "payment",
    requestedRecipient: "0xabc",
    requestedAsset: "0xdead",
    requestedAmount: "100",
    requestedRoute: "base:0xdead:transfer",
    createdAt: 1_000,
    expiresAt: 20_000,
    clientIdempotencyKey: "idem_resolution_continuity",
    policyVersion: "v1",
  });
  const plan = createExecutionPlan({
    chainId: "base",
    asset: "0xdead",
    recipient: "0xabc",
    calls: ["transfer"],
    valueLimits: { maxValue: "100" },
    policyVersion: "v1",
    intentId: intent.intentId,
    createdAt: 1_100,
  });
  const pause = createPause({
    pauseId: "pause_resolution_continuity",
    intentId: intent.intentId,
    planHash: plan.planHash,
    policyVersion: "v1",
    createdAt: 1_200,
    expiresAt: 20_000,
  });
  const sources: VerificationSources = {
    recipientBinding: { status: "BOUND", observedValue: "0xabc" },
    firstUse: { isFirstUse: false },
    agentAuthorized: { authorized: true },
    routeAllowed: { chainAllowed: true, assetAllowed: true, contractAllowed: true, notRevoked: true },
    intentPlanMatch: { matches: true },
    simulation: { success: true, effectMatches: true, freshnessOk: true },
    additionalApproval: { requiresApproval: false },
    resolutionContinuity: { risks: [] },
  };
  return { intent, plan, pause, sources };
}

describe("typed resolution continuity policy", () => {
  it.each(Object.entries(DEFAULT_RESOLUTION_CONTINUITY_OUTCOMES) as [ResolutionContinuityRisk, string][]) (
    "%s maps to an explicit policy outcome",
    (risk, expectedOutcome) => {
      const result = ResolutionContinuityCheck({ source: { risks: [risk] }, now: 1_500 });
      const assessment = assessResolutionContinuity({ risks: [risk] });

      expect(assessment).toMatchObject({ risks: [risk], policyOutcome: expectedOutcome });
      expect(result).toMatchObject({
        checkId: CHECK_ID.RESOLUTION_CONTINUITY,
        policyOutcome: expectedOutcome,
        riskCodes: [risk],
        source: "resolution_continuity",
      });
      expect(canAutoRelease([result])).toBe(false);
    },
  );

  it("uses ALLOW only for an explicit empty-risk assessment", () => {
    const result = ResolutionContinuityCheck({ source: { risks: [] }, now: 1_500 });
    expect(result).toMatchObject({
      status: "PASS",
      severity: "INFO",
      policyOutcome: "ALLOW",
      riskCodes: [],
    });
    expect(canAutoRelease([result])).toBe(true);
  });

  it("maps ALIAS_CHANGED to REQUIRE_CONFIRMATION", () => {
    const result = ResolutionContinuityCheck({
      source: { risks: ["ALIAS_CHANGED" as ResolutionContinuityRisk] },
      now: 1_500,
    });

    expect(result).toMatchObject({
      policyOutcome: "REQUIRE_CONFIRMATION",
      status: "FAIL",
      severity: "BLOCKING",
      riskCodes: ["ALIAS_CHANGED"],
    });
    expect(canAutoRelease([result])).toBe(false);
  });

  it("aggregates multiple risks conservatively instead of allowing a lower-risk result to win", () => {
    const result = ResolutionContinuityCheck({
      source: { risks: ["ADDRESS_CHANGED", "BINDING_REVOKED"] },
      now: 1_500,
    });

    expect(result.policyOutcome).toBe("BLOCK");
    expect(result.riskCodes).toEqual(["ADDRESS_CHANGED", "BINDING_REVOKED"]);
    expect(canAutoRelease([result])).toBe(false);
  });

  it("treats an unknown or missing assessment as a blocking UNKNOWN, never as ALLOW", () => {
    const unknown = ResolutionContinuityCheck({ source: { unknown: true }, now: 1_500 });
    const missing = ResolutionContinuityCheck({ now: 1_500 });

    for (const result of [unknown, missing]) {
      expect(result).toMatchObject({
        checkId: CHECK_ID.RESOLUTION_CONTINUITY,
        status: "UNKNOWN",
        severity: "BLOCKING",
        policyOutcome: "BLOCK",
        reasonCode: PAUSE_REASON_CODE.RESOLUTION_CONTINUITY_UNKNOWN,
      });
      expect(canAutoRelease([result])).toBe(false);
    }
  });

  it("rejects an unrecognized risk rather than silently downgrading it", () => {
    expect(() => ResolutionContinuityCheck({ source: { risks: ["ADDRESS_CHANGED", "FORGED_RISK"] as unknown as ResolutionContinuityRisk[] }, now: 1_500 })).toThrow();
  });

  it("accepts the upstream resolution-service assessment shape without trusting unmapped risks", () => {
    const changed = ResolutionContinuityCheck({
      source: {
        status: "RESOLVED",
        blocked: false,
        risks: [{ code: "ADDRESS_CHANGED", level: "HIGH", blocking: false, detail: "destination_address_changed" }],
      },
      now: 1_500,
    });
    expect(changed).toMatchObject({ policyOutcome: "REQUIRE_CONFIRMATION", riskCodes: ["ADDRESS_CHANGED"] });

    const noActive = ResolutionContinuityCheck({
      source: { status: "NO_ACTIVE_DESTINATION", blocked: true, risks: [] },
      now: 1_500,
    });
    expect(noActive).toMatchObject({ policyOutcome: "BLOCK", riskCodes: ["NO_ACTIVE_DESTINATION"] });

    const providerFailure = ResolutionContinuityCheck({
      source: { status: "BLOCKED", blocked: true, risks: [{ code: "SNAPSHOT_UNAVAILABLE", level: "UNKNOWN", blocking: true }] },
      now: 1_500,
    });
    expect(providerFailure).toMatchObject({ status: "UNKNOWN", policyOutcome: "BLOCK", riskCodes: ["SNAPSHOT_UNAVAILABLE"] });
    expect(canAutoRelease([providerFailure])).toBe(false);
  });

  it("does not let a hard BLOCK outcome be cleared by the existing approval command", () => {
    const { pause } = fixture();
    const blockedCheck = ResolutionContinuityCheck({ source: { risks: ["BINDING_REVOKED"] }, now: 1_500 });
    const escalated = {
      ...pause,
      state: "ESCALATED" as const,
      version: 1,
      checks: [blockedCheck],
      reasonCodes: [blockedCheck.reasonCode],
      riskLevel: "HIGH" as const,
      requiredApprovalCount: 1,
    };

    expect(() => approveEscalation(escalated, {
      planHash: pause.planHash,
      approvalScopeHash: null,
      now: 1_600,
      expectedVersion: 1,
    })).toThrowError(expect.objectContaining({ code: PAUSE_ERROR_CODE.AUTHORITY_DENIED }));
  });

  it("records REQUIRE_CONFIRMATION without promoting unchanged blocking checks to RELEASE_READY", () => {
    const { pause } = fixture();
    const confirmationCheck = ResolutionContinuityCheck({ source: { risks: ["ALIAS_CHANGED" as ResolutionContinuityRisk] }, now: 1_500 });
    const escalated = {
      ...pause,
      state: "ESCALATED" as const,
      version: 1,
      checks: [confirmationCheck],
      reasonCodes: [confirmationCheck.reasonCode],
      riskLevel: "HIGH" as const,
      requiredApprovalCount: 1,
    };

    const confirmed = approveEscalation(escalated, {
      planHash: pause.planHash,
      approvalScopeHash: null,
      now: 1_600,
      expectedVersion: 1,
    });

    expect(confirmed.state).toBe("ESCALATED");
    expect(confirmed.version).toBe(2);
    expect(confirmed.checks[0]).toMatchObject({ policyOutcome: "REQUIRE_CONFIRMATION", status: "FAIL" });
  });

  it("records ESCALATE approval without clearing the unchanged escalation check", () => {
    const { pause } = fixture();
    const escalationCheck = ResolutionContinuityCheck({ source: { risks: ["VISIBILITY_CHANGED"] }, now: 1_500 });
    const escalated = {
      ...pause,
      state: "ESCALATED" as const,
      version: 1,
      checks: [escalationCheck],
      reasonCodes: [escalationCheck.reasonCode],
      riskLevel: "HIGH" as const,
      requiredApprovalCount: 1,
    };

    const approved = approveEscalation(escalated, {
      planHash: pause.planHash,
      approvalScopeHash: null,
      now: 1_600,
      expectedVersion: 1,
    });

    expect(approved.state).toBe("ESCALATED");
    expect(approved.version).toBe(2);
    expect(approved.checks[0]).toMatchObject({ policyOutcome: "ESCALATE", status: "FAIL" });
  });

  it("does not trust an omitted policyOutcome to bypass a hard blocking risk code", () => {
    const { pause } = fixture();
    const blockedCheck = makeCheck(
      CHECK_ID.RESOLUTION_CONTINUITY,
      "FAIL",
      "BLOCKING",
      PAUSE_REASON_CODE.RESOLUTION_CONTINUITY,
      "resolution_continuity",
      1_500,
      "BINDING_REVOKED",
      "fresh_active_resolution",
      "persisted outcome omitted",
      undefined,
      ["BINDING_REVOKED"],
    );
    const escalated = {
      ...pause,
      state: "ESCALATED" as const,
      version: 1,
      checks: [blockedCheck],
      reasonCodes: [blockedCheck.reasonCode],
      riskLevel: "HIGH" as const,
      requiredApprovalCount: 1,
    };

    expect(() => approveEscalation(escalated, {
      planHash: pause.planHash,
      approvalScopeHash: null,
      now: 1_600,
      expectedVersion: 1,
    })).toThrowError(expect.objectContaining({ code: PAUSE_ERROR_CODE.AUTHORITY_DENIED }));
  });

  it("persists a confirmation decision while leaving the blocking resolution check unchanged", async () => {
    const { intent, plan, pause } = fixture();
    const check = ResolutionContinuityCheck({ source: { risks: ["ALIAS_CHANGED" as ResolutionContinuityRisk] }, now: 1_500 });
    const store = new InMemoryPauseStore();
    await store.putIntent(intent);
    await store.putPlan(plan);
    await store.createPause({
      intent,
      plan,
      pause: {
        ...pause,
        state: "ESCALATED",
        version: 1,
        checks: [check],
        reasonCodes: [check.reasonCode],
        riskLevel: "HIGH",
        requiredApprovalCount: 1,
      },
    });
    const service = new PauseService(store, {
      store,
      authorityResolver: () => ({ authorized: true, actor: "user" }),
      now: () => 1_600,
    });

    const result = await service.approve({
      pauseId: pause.pauseId,
      planHash: pause.planHash,
      approvalScopeHash: null,
      expectedVersion: 1,
      now: 1_600,
      authoritySubject: intent.principal,
    });
    const decisions = await store.getDecisions(pause.pauseId);

    expect(result.state).toBe("ESCALATED");
    expect(result.checks[0]).toMatchObject({ policyOutcome: "REQUIRE_CONFIRMATION", status: "FAIL" });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ kind: "CONFIRM", planHash: pause.planHash });
  });

  it("integrates with Pause verification and leaves settlement untouched for a non-ALLOW outcome", () => {
    const { intent, plan, pause, sources } = fixture();
    const checks = evaluatePolicy({
      intent,
      plan,
      pause,
      policy,
      sources: {
        ...sources,
        resolutionContinuity: { risks: ["VISIBILITY_CHANGED"] },
      },
      now: 1_500,
    });
    const resolution = checks.find((check) => check.checkId === CHECK_ID.RESOLUTION_CONTINUITY);

    expect(resolution).toMatchObject({ policyOutcome: "ESCALATE", status: "FAIL", severity: "BLOCKING" });
    expect(canAutoRelease(checks)).toBe(false);
  });

  it("does not trust a caller-provided outcome that contradicts the risk mapping", () => {
    const source = {
      risks: ["BINDING_REVOKED"],
      outcome: "ALLOW",
    } as unknown as ResolutionContinuitySource;

    expect(() => ResolutionContinuityCheck({ source, now: 1_500 })).toThrow();
  });
});
