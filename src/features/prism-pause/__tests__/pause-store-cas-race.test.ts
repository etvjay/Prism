import { describe, it, expect } from "vitest";
import { InMemoryPauseStore } from "../adapters/memory-pause-store";
import { PauseService } from "../application/pause-service";
import { createIntent } from "../domain/intent";
import { createExecutionPlan } from "../domain/execution-plan";
import { createPause, computeApprovalScopeHash, toVerifying, completeVerification, release } from "../domain/pause";
import { makeCheck } from "../domain/checks";
import { PAUSE_ERROR_CODE, PAUSE_REASON_CODE } from "../domain/errors";
import type { Policy, VerificationSources } from "../domain/policy-engine";
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
};

describe("P2 durable store CAS / race / restart", () => {
  it("restart preserves PAUSED/ESCALATED state (snapshot survives)", async () => {
    const store = new InMemoryPauseStore();
    const svc = new PauseService(store, { store, defaultPauseTtlMs: 10_000, authorityResolver: testPauseAuthorityResolver });
    const intent = await svc.createIntent({ intentId: "intent_r1", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20_000, clientIdempotencyKey: "idem_r1", policyVersion: "v1" });
    const plan = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    const pause = await svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1200 });
    // simulate restart: create new service over same store instance (durability = store object survives)
    const svc2 = new PauseService(store, { store, defaultPauseTtlMs: 10_000, authorityResolver: testPauseAuthorityResolver });
    const reloaded = await svc2.getPause(pause.pauseId);
    expect(reloaded?.state).toBe("PAUSED");
    // now escalate and verify snapshot persists
    const blocking: VerificationSources = { ...passingSources, additionalApproval: { requiresApproval: true } };
    const escalated = await svc2.verify({ pauseId: pause.pauseId, policy, sources: blocking, now: 1300 });
    expect(escalated.state).toBe("ESCALATED");
    const reloaded2 = await svc2.getPause(pause.pauseId);
    expect(reloaded2?.state).toBe("ESCALATED");
  });

  it("concurrent release → exactly one winner (CAS)", async () => {
    const store = new InMemoryPauseStore();
    const svc = new PauseService(store, { store, defaultPauseTtlMs: 10_000, authorityResolver: testPauseAuthorityResolver });
    const intent = await svc.createIntent({ intentId: "intent_r2", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20_000, clientIdempotencyKey: "idem_r2", policyVersion: "v1" });
    const plan = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    const pause = await svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1200 });
    const verified = await svc.verify({ pauseId: pause.pauseId, policy, sources: passingSources, now: 1300 });
    expect(verified.state).toBe("RELEASE_READY");
    const scope = computeApprovalScopeHash(verified.pauseId, verified.planHash, verified.policyVersion);
    // two concurrent releases with same expectedVersion
    const p1 = svc.release({ pauseId: pause.pauseId, planHash: plan.planHash, approvalScopeHash: scope, settlementOperationId: "op_A", now: 1400, expectedVersion: verified.version });
    const p2 = svc.release({ pauseId: pause.pauseId, planHash: plan.planHash, approvalScopeHash: scope, settlementOperationId: "op_B", now: 1400, expectedVersion: verified.version });
    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter(r => r.status==="fulfilled");
    const rejected = results.filter(r => r.status==="rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    const final = await svc.getPause(pause.pauseId);
    expect(final?.state).toBe("RELEASED");
    expect(["op_A","op_B"]).toContain(final?.settlementOperationId);
  });

  it("cancel vs release race → canonical CAS result (one winner)", async () => {
    const store = new InMemoryPauseStore();
    const svc = new PauseService(store, { store, defaultPauseTtlMs: 10_000, authorityResolver: testPauseAuthorityResolver });
    const intent = await svc.createIntent({ intentId: "intent_r3", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20_000, clientIdempotencyKey: "idem_r3", policyVersion: "v1" });
    const plan = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    const pause = await svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1200 });
    const verified = await svc.verify({ pauseId: pause.pauseId, policy, sources: passingSources, now: 1300 });
    const r1 = svc.release({ pauseId: pause.pauseId, planHash: plan.planHash, settlementOperationId: "op_X", now: 1400, expectedVersion: verified.version });
    const r2 = svc.cancel({ pauseId: pause.pauseId, now: 1400, expectedVersion: verified.version });
    const results = await Promise.allSettled([r1, r2]);
    const fulfilled = results.filter(r=>r.status==="fulfilled");
    expect(fulfilled.length).toBe(1);
    const final = await svc.getPause(pause.pauseId);
    expect(["RELEASED","CANCELLED"]).toContain(final?.state);
  });

  it("duplicate idempotency key → same intent, no duplicate pause", async () => {
    const store = new InMemoryPauseStore();
    const svc = new PauseService(store, { store, defaultPauseTtlMs: 10_000, authorityResolver: testPauseAuthorityResolver });
    const intent1 = await svc.createIntent({ intentId: "intent_dup", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20_000, clientIdempotencyKey: "idem_dup", policyVersion: "v1" });
    // same idempotency key with different intentId but same payload -> returns same intent (idempotent)
    const intent2 = await svc.createIntent({ intentId: "intent_dup", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20_000, clientIdempotencyKey: "idem_dup", policyVersion: "v1" });
    expect(intent2.intentId).toBe(intent1.intentId);
    const plan = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent1.intentId, createdAt: 1100 });
    const pause1 = await svc.pause({ intentId: intent1.intentId, planHash: plan.planHash, now: 1200 });
    // second pause attempt for same intent should be idempotent or duplicate error but not create second row
    const pause2 = await svc.pause({ intentId: intent1.intentId, planHash: plan.planHash, now: 1200 });
    expect(pause2.pauseId).toBe(pause1.pauseId);
    expect(store.snapshotPauses().length).toBe(1);
  });

  it("concurrent same-key intents reject authority fingerprint drift after the race recheck", async () => {
    const store = new InMemoryPauseStore();
    const shared = {
      principal: "prism:alice",
      purpose: "payment" as const,
      requestedRecipient: "0xabc",
      requestedAsset: "0xdead",
      requestedAmount: "100",
      requestedRoute: "base:0xdead:transfer",
      createdAt: 1000,
      expiresAt: 20_000,
      clientIdempotencyKey: "idem_race_authority",
      policyVersion: "v1",
    };
    const userIntent = createIntent({
      ...shared,
      intentId: "intent_race_user",
      initiator: "user",
      agentId: null,
    });
    const agentIntent = createIntent({
      ...shared,
      intentId: "intent_race_agent",
      initiator: "agent",
      agentId: "agent_1",
    });

    const results = await Promise.allSettled([
      store.putIntent(userIntent),
      store.putIntent(agentIntent),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: PAUSE_ERROR_CODE.IDEMPOTENCY_CONFLICT });
    const persisted = await store.getIntentByIdempotencyKey(shared.clientIdempotencyKey);
    expect(persisted?.initiator).toBeDefined();
    expect([userIntent.initiator, agentIntent.initiator]).toContain(persisted?.initiator);
  });

  it("expired intent → not pausable", async () => {
    const store = new InMemoryPauseStore();
    const svc = new PauseService(store, { store, defaultPauseTtlMs: 10_000, authorityResolver: testPauseAuthorityResolver });
    const past = Date.now() - 20_000;
    const intent = await svc.createIntent({ intentId: "intent_exp", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: past, expiresAt: past + 1000, clientIdempotencyKey: "idem_exp", policyVersion: "v1" });
    // intent already expired
    const plan = await store.putPlan(createExecutionPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent.intentId, createdAt: past }));
    // pause should fail with expired
    await expect(svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: Date.now() })).rejects.toThrow();
  });

  it("changed plan invalidates previous approval (replay guard)", async () => {
    const store = new InMemoryPauseStore();
    const svc = new PauseService(store, { store, defaultPauseTtlMs: 10_000, authorityResolver: testPauseAuthorityResolver });
    const intent = await svc.createIntent({ intentId: "intent_chg", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20_000, clientIdempotencyKey: "idem_chg", policyVersion: "v1" });
    const plan1 = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    const pause = await svc.pause({ intentId: intent.intentId, planHash: plan1.planHash, now: 1200 });
    // escalate path and approve
    const blocking: VerificationSources = { ...passingSources, additionalApproval: { requiresApproval: true } };
    const escalated = await svc.verify({ pauseId: pause.pauseId, policy, sources: blocking, now: 1300 });
    const scope1 = computeApprovalScopeHash(escalated.pauseId, escalated.planHash, escalated.policyVersion);
    const approved = await svc.approve({ pauseId: pause.pauseId, planHash: plan1.planHash, approvalScopeHash: scope1, now: 1400 });
    expect(approved.state).toBe("RELEASE_READY");
    // attempt release with different planHash should fail
    await expect(svc.release({ pauseId: pause.pauseId, planHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" as `0x${string}`, settlementOperationId: "op", now: 1500 })).rejects.toThrow();
  });

  it("stale version throws ERR-111", async () => {
    const store = new InMemoryPauseStore();
    const intent = createIntent({ intentId: "intent_sv", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20_000, clientIdempotencyKey: "idem_sv", policyVersion: "v1" });
    await store.putIntent(intent);
    const plan = createExecutionPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    await store.putPlan(plan);
    const pause = createPause({ pauseId: `pause_${intent.intentId}_v1`, intentId: intent.intentId, planHash: plan.planHash, policyVersion: "v1", createdAt: 1200, expiresAt: 10_000 });
    await store.createPause({ intent, plan, pause });
    // direct CAS with wrong version
    const bad = { ...pause, state: "VERIFYING" as const, version: 999, lastVerifiedAt: 1300 };
    await expect(store.updatePause(bad, 999)).rejects.toThrow();
  });
});
