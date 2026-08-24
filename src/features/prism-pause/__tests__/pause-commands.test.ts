import { describe, it, expect } from "vitest";
import { InMemoryPauseStore } from "../adapters/memory-pause-store";
import { PauseService } from "../application/pause-service";
import { createIntent } from "../domain/intent";
import { createExecutionPlan } from "../domain/execution-plan";
import { computeApprovalScopeHash } from "../domain/pause";
import type { Policy, VerificationSources } from "../domain/policy-engine";

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
};

function makeIntent(now=1000) {
  return createIntent({ intentId: `intent_${now}`, principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: now, expiresAt: now+10_000, clientIdempotencyKey: `idem_${now}`, policyVersion: "v1" });
}

describe("P4 explicit commands with binding", () => {
  it("pause -> verify -> release creates future Operation link", async () => {
    const store = new InMemoryPauseStore();
    const svc = new PauseService(store, { store, defaultPauseTtlMs: 10_000 });
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

  it("cancel from PAUSED succeeds, cancel from RELEASED fails", async () => {
    const store = new InMemoryPauseStore();
    const svc = new PauseService(store, { store, defaultPauseTtlMs: 10_000 });
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
    const svc = new PauseService(store, { store, defaultPauseTtlMs: 10_000 });
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
    const svc = new PauseService(store, { store, defaultPauseTtlMs: 10_000 });
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
    const svc = new PauseService(store, { store, defaultPauseTtlMs: 10_000 });
    const intent = await svc.createIntent({ intentId: "intent_7", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20_000, clientIdempotencyKey: "idem_7", policyVersion: "v1" });
    const plan = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    const pause = await svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1200 });
    await svc.verify({ pauseId: pause.pauseId, policy, sources: passingSources, now: 1300 });
    await expect(svc.release({ pauseId: pause.pauseId, planHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as `0x${string}`, settlementOperationId: "op", now: 1400 })).rejects.toThrow();
  });
});
