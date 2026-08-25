import { describe, it, expect } from "vitest";
import { InMemoryPauseStore } from "../adapters/memory-pause-store";
import { PauseService } from "../application/pause-service";
import { createIntent } from "../domain/intent";
import { createExecutionPlan } from "../domain/execution-plan";
import { computeApprovalScopeHash } from "../domain/pause";
import type { Policy, VerificationSources } from "../domain/policy-engine";
import { PAUSE_ERROR_CODE } from "../domain/errors";
import { testPauseAuthorityResolver } from "./test-authority";

const policy: Policy = {
  policyVersion: "v1",
  allowedChains: ["base"],
  allowedAssets: ["0xdead"],
  allowedContracts: ["*"],
  amountCeiling: "1000",
  requireFirstUseEscalation: false,
};

const passingSources: VerificationSources = {
  recipientBinding: { status: "BOUND", observedValue: "0xabc" },
  firstUse: { isFirstUse: false },
  agentAuthorized: { authorized: true },
  routeAllowed: { chainAllowed: true, assetAllowed: true, contractAllowed: true, notRevoked: true },
  intentPlanMatch: { matches: true },
  simulation: { success: true, effectMatches: true, freshnessOk: true },
  additionalApproval: { requiresApproval: false },
  resolutionContinuity: { risks: [] },
};

function makeIntent(now=1000) {
  return createIntent({ intentId: `intent_${now}`, principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: now, expiresAt: now+10_000, clientIdempotencyKey: `idem_${now}`, policyVersion: "v1" });
}

describe("P4 explicit commands with binding", () => {
  it("pause -> verify -> release creates future Operation link", async () => {
    const store = new InMemoryPauseStore();
    const svc = new PauseService(store, { store, defaultPauseTtlMs: 10_000, authorityResolver: testPauseAuthorityResolver });
    const intent = await svc.createIntent({ intentId: "intent_1", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20_000, clientIdempotencyKey: "idem_1", policyVersion: "v1" });
    const plan = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    const pause = await svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1200 });
    expect(pause.state).toBe("PAUSED");
    const verified = await svc.verify({ pauseId: pause.pauseId, policy, sources: passingSources, now: 1300 });
    expect(verified.state).toBe("RELEASE_READY");
    const scope = computeApprovalScopeHash(verified.pauseId, verified.planHash, verified.policyVersion);
    expect(verified.approvalScopeHash).toBe(scope);
    const released = await svc.release({ pauseId: pause.pauseId, planHash: plan.planHash, approvalScopeHash: scope, settlementOperationId: "op_future_1", now: 1400 });
    expect(released.state).toBe("RELEASED");
    expect(released.settlementOperationId).toBe("op_future_1");
    // RELEASED never means completed — it's just a future operation link
  });

  it("cancel fails closed with ERR-123 when no authority resolver is configured", async () => {
    const store = new InMemoryPauseStore();
    const svc = new PauseService(store, { store, defaultPauseTtlMs: 10_000 });
    const intent = await svc.createIntent({ intentId: "intent_cancel_authority_missing", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20_000, clientIdempotencyKey: "idem_cancel_authority_missing", policyVersion: "v1" });
    const plan = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    const pause = await svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1200 });

    await expect(svc.cancel({ pauseId: pause.pauseId, now: 1250, reason: "user_requested" })).rejects.toMatchObject({
      code: PAUSE_ERROR_CODE.AUTHORITY_UNCONFIGURED,
    });
    expect((await svc.getPause(pause.pauseId))?.state).toBe("PAUSED");
  });

  it("cancel uses the resolver actor, binds an authenticated user subject, and records the reason", async () => {
    const store = new InMemoryPauseStore();
    const requests: Array<{ action: string; subject: string | null; claimedActor?: string | null }> = [];
    const svc = new PauseService(store, {
      store,
      defaultPauseTtlMs: 10_000,
      authorityResolver: {
        resolve: async (request) => {
          requests.push({ action: request.action, subject: request.subject, claimedActor: request.claimedActor });
          return { authorized: true, actor: "controller" };
        },
      },
    });
    const intent = await svc.createIntent({ intentId: "intent_cancel_authority", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20_000, clientIdempotencyKey: "idem_cancel_authority", policyVersion: "v1" });
    const plan = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    const pause = await svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1200 });

    const cancelled = await svc.cancel({
      pauseId: pause.pauseId,
      now: 1250,
      authoritySubject: "prism:alice",
      authorityClaim: "claimed-controller",
      reason: "controller_rejected_route",
    });
    expect(cancelled.state).toBe("CANCELLED");
    expect(requests).toEqual([{ action: "cancel", subject: "prism:alice", claimedActor: "claimed-controller" }]);
    await expect(store.getDecisions(pause.pauseId)).resolves.toEqual([
      expect.objectContaining({
        kind: "CANCEL",
        actor: "controller",
        reasonCodes: ["controller_rejected_route"],
        planHash: plan.planHash,
      }),
    ]);
  });

  it("cancel rejects a user subject that does not match the intent principal", async () => {
    const store = new InMemoryPauseStore();
    const svc = new PauseService(store, {
      store,
      authorityResolver: testPauseAuthorityResolver,
    });
    const intent = await svc.createIntent({ intentId: "intent_cancel_subject", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20_000, clientIdempotencyKey: "idem_cancel_subject", policyVersion: "v1" });
    const plan = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    const pause = await svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1200 });

    await expect(svc.cancel({ pauseId: pause.pauseId, authoritySubject: "prism:eve", reason: "spoofed" })).rejects.toMatchObject({
      code: PAUSE_ERROR_CODE.AUTHORITY_DENIED,
    });
    expect((await svc.getPause(pause.pauseId))?.state).toBe("PAUSED");
  });

  it("cancel from PAUSED succeeds, cancel from RELEASED fails", async () => {
    const store = new InMemoryPauseStore();
    const svc = new PauseService(store, { store, defaultPauseTtlMs: 10_000, authorityResolver: testPauseAuthorityResolver });
    const intent = await svc.createIntent({ intentId: "intent_2", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20_000, clientIdempotencyKey: "idem_2", policyVersion: "v1" });
    const plan = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    const pause = await svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1200 });
    const cancelled = await svc.cancel({ pauseId: pause.pauseId, now: 1250 });
    expect(cancelled.state).toBe("CANCELLED");
    // Create another intent/pause for release path
    const intent3 = await svc.createIntent({ intentId: "intent_3", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 2000, expiresAt: 20_000, clientIdempotencyKey: "idem_3", policyVersion: "v1" });
    const plan3 = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent3.intentId, createdAt: 2100 });
    const pause3 = await svc.pause({ intentId: intent3.intentId, planHash: plan3.planHash, now: 2200 });
    const verified = await svc.verify({ pauseId: pause3.pauseId, policy, sources: passingSources, now: 2300 });
    const released = await svc.release({ pauseId: pause3.pauseId, planHash: plan3.planHash, settlementOperationId: "op_future_3", now: 2400 });
    await expect(svc.cancel({ pauseId: released.pauseId, now: 2500 })).rejects.toThrow();
  });

  it("escalate and approve with plan-hash binding", async () => {
    const store = new InMemoryPauseStore();
    const svc = new PauseService(store, { store, defaultPauseTtlMs: 10_000, authorityResolver: testPauseAuthorityResolver });
    const intent = await svc.createIntent({ intentId: "intent_4", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20_000, clientIdempotencyKey: "idem_4", policyVersion: "v1" });
    const plan = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    const pause = await svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1200 });
    // verify with blocking failure -> escalated
    const blockingSources: VerificationSources = { ...passingSources, additionalApproval: { requiresApproval: true } };
    const verified = await svc.verify({ pauseId: pause.pauseId, policy, sources: blockingSources, now: 1300 });
    expect(verified.state).toBe("ESCALATED");
    const scope = computeApprovalScopeHash(verified.pauseId, verified.planHash, verified.policyVersion);
    // approve with wrong planHash fails
    await expect(svc.approve({ pauseId: pause.pauseId, planHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as `0x${string}`, now: 1400 })).rejects.toThrow();
    // approve with correct hash succeeds
    const approved = await svc.approve({ pauseId: pause.pauseId, planHash: plan.planHash, approvalScopeHash: scope, now: 1400 });
    expect(approved.state).toBe("RELEASE_READY");
  });

  it("blocks approval for a specific UNKNOWN check reason while D-P0-003 is open", async () => {
    const store = new InMemoryPauseStore();
    const svc = new PauseService(store, { store, defaultPauseTtlMs: 10_000, authorityResolver: testPauseAuthorityResolver });
    const intent = await svc.createIntent({ intentId: "intent_unknown_approval", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20_000, clientIdempotencyKey: "idem_unknown_approval", policyVersion: "v1" });
    const plan = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    const pause = await svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1200 });
    const escalated = await svc.verify({
      pauseId: pause.pauseId,
      policy,
      sources: { ...passingSources, simulation: { success: null, effectMatches: null, freshnessOk: null, unknown: true } },
      now: 1300,
    });

    expect(escalated.state).toBe("ESCALATED");
    expect(escalated.checks.some((check) => check.status === "UNKNOWN" && check.reasonCode !== "PAUSE-UNKNOWN-001")).toBe(true);
    await expect(
      svc.approve({ pauseId: escalated.pauseId, planHash: plan.planHash, now: 1400 }),
    ).rejects.toMatchObject({ code: PAUSE_ERROR_CODE.CHECK_UNKNOWN_BLOCKING });
    expect((await svc.getPause(escalated.pauseId))?.state).toBe("ESCALATED");
  });

  it("expire command and expired pause cannot release", async () => {
    const store = new InMemoryPauseStore();
    const svc = new PauseService(store, { store, defaultPauseTtlMs: 2000 });
    const intent = await svc.createIntent({ intentId: "intent_5", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20_000, clientIdempotencyKey: "idem_5", policyVersion: "v1" });
    const plan = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    const pause = await svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1200 });
    // expire after ttl
    const expired = await svc.expire({ pauseId: pause.pauseId, now: 5000 });
    expect(expired.state).toBe("EXPIRED");
    await expect(svc.release({ pauseId: pause.pauseId, planHash: plan.planHash, settlementOperationId: "op", now: 5100 })).rejects.toThrow();
  });

  it("reverify invalidates stale approval and requires fresh verify", async () => {
    const store = new InMemoryPauseStore();
    const svc = new PauseService(store, { store, defaultPauseTtlMs: 10_000, authorityResolver: testPauseAuthorityResolver });
    const intent = await svc.createIntent({ intentId: "intent_6", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20_000, clientIdempotencyKey: "idem_6", policyVersion: "v1" });
    const plan = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    const pause = await svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1200 });
    const verified = await svc.verify({ pauseId: pause.pauseId, policy, sources: passingSources, now: 1300 });
    expect(verified.state).toBe("RELEASE_READY");
    const reverified = await svc.reverify({ pauseId: pause.pauseId, now: 1350 });
    expect(reverified.state).toBe("VERIFYING");
    // after reverify, must verify again before release
    await expect(svc.release({ pauseId: pause.pauseId, planHash: plan.planHash, settlementOperationId: "op", now: 1400 })).rejects.toThrow();
  });

  it("release requires exact plan_hash binding", async () => {
    const store = new InMemoryPauseStore();
    const svc = new PauseService(store, { store, defaultPauseTtlMs: 10_000, authorityResolver: testPauseAuthorityResolver });
    const intent = await svc.createIntent({ intentId: "intent_7", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20_000, clientIdempotencyKey: "idem_7", policyVersion: "v1" });
    const plan = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    const pause = await svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1200 });
    await svc.verify({ pauseId: pause.pauseId, policy, sources: passingSources, now: 1300 });
    await expect(svc.release({ pauseId: pause.pauseId, planHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as `0x${string}`, settlementOperationId: "op", now: 1400 })).rejects.toThrow();
  });
});
