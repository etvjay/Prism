import { describe, it, expect } from "vitest";
import { InMemoryPauseStore } from "../adapters/memory-pause-store";
import { InMemoryOperationStore } from "../../prism-operations/adapters/memory-operation-store";
import { PauseService } from "../application/pause-service";
import { InMemoryPauseMetrics } from "../ports/metrics";
import { createFakeAdapterRegistry } from "../adapters/fake-execution-adapters";
import type { Policy, VerificationSources } from "../domain/policy-engine";
import { computeApprovalScopeHash } from "../domain/pause";
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
};
const unknownSources: VerificationSources = {
  recipientBinding: { status: "UNKNOWN", observedValue: null },
  firstUse: { isFirstUse: null, unknown: true },
  agentAuthorized: { authorized: null, unknown: true },
  routeAllowed: { chainAllowed: null, assetAllowed: null, contractAllowed: null, notRevoked: null, unknown: true },
  intentPlanMatch: { matches: null, unknown: true },
  simulation: { success: null, effectMatches: null, freshnessOk: null, unknown: true },
  additionalApproval: { requiresApproval: null, unknown: true },
};

async function bootstrap() {
  const pauseStore = new InMemoryPauseStore();
  const opStore = new InMemoryOperationStore();
  const metrics = new InMemoryPauseMetrics();
  const adapters = createFakeAdapterRegistry(opStore);
  const svc = new PauseService(pauseStore, { store: pauseStore, operationStore: opStore, executionAdapters: adapters, metrics, defaultPauseTtlMs: 10000, authorityResolver: testPauseAuthorityResolver, now: () => 5000 });
  return { pauseStore, opStore, metrics, svc };
}

describe("P7 observability/security — append-only decisions, correlation, metrics, red-team", () => {
  it("append-only pause decisions: decision history immutable and correlation/operation IDs linked", async () => {
    const { pauseStore, opStore, svc } = await bootstrap();
    const intent = await svc.createIntent({ intentId: "intent_obs1", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20000, clientIdempotencyKey: "idem_obs1", policyVersion: "v1" });
    const plan = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    const pause = await svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1200 });
    const verified = await svc.verify({ pauseId: pause.pauseId, policy, sources: passingSources, now: 1300 });
    expect(verified.state).toBe("RELEASE_READY");
    const released = await svc.release({ pauseId: pause.pauseId, planHash: plan.planHash, settlementOperationId: "op_obs1", now: 1400, correlationId: "corr-obs-1" });
    expect(released.state).toBe("RELEASED");
    const decisions = await pauseStore.getDecisions(pause.pauseId);
    expect(decisions.length).toBeGreaterThanOrEqual(1);
    expect(decisions.some(d=> d.kind==="RELEASE")).toBe(true);
    const releaseDec = decisions.find(d=> d.kind==="RELEASE")!;
    expect(releaseDec.planHash).toBe(plan.planHash);
    expect(releaseDec.approvalScopeHash).toBe(computeApprovalScopeHash(pause.pauseId, plan.planHash, "v1"));
    expect(releaseDec.pauseId).toBe(pause.pauseId);
    // correlation and operation IDs observable via Operation
    const op = await opStore.getById("op_obs1");
    expect(op!.correlationId).toBe("corr-obs-1");
    expect(op!.state).toBe("submitted");
    expect(pauseStore.snapshotPauses()[0].decisionIds).toContain(releaseDec.decisionId);
    // decisions append-only: re-fetch should contain same ordering, no mutation of prior
    const decisions2 = await pauseStore.getDecisions(pause.pauseId);
    expect(decisions2.map(d=> d.decisionId)).toEqual(decisions.map(d=> d.decisionId));
  });

  it("metrics hooks increment on each transition", async () => {
    const { metrics, svc } = await bootstrap();
    const intent = await svc.createIntent({ intentId: "intent_met", principal: "prism:bob", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "10", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20000, clientIdempotencyKey: "idem_met", policyVersion: "v1" });
    const plan = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "10" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    const pause = await svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1200 });
    await svc.verify({ pauseId: pause.pauseId, policy, sources: passingSources, now: 1300 });
    await svc.release({ pauseId: pause.pauseId, planHash: plan.planHash, settlementOperationId: "op_met", now: 1400 });
    expect(metrics.count("pause_verified")).toBeGreaterThanOrEqual(1);
    expect(metrics.count("pause_released")).toBe(1);
    expect(metrics.count("settlement_operation_created")).toBe(1);
    expect(metrics.count("settlement_operation_submitted")).toBe(1);
  });

  it("red-team: bypass via direct RELEASED without verify is blocked", async () => {
    const { svc } = await bootstrap();
    const intent = await svc.createIntent({ intentId: "intent_bypass", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20000, clientIdempotencyKey: "idem_bypass", policyVersion: "v1" });
    const plan = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    const pause = await svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1200 });
    expect(pause.state).toBe("PAUSED");
    await expect(svc.release({ pauseId: pause.pauseId, planHash: plan.planHash, settlementOperationId: "op_bypass", now: 1300 })).rejects.toThrow();
  });

  it("red-team: plan mutation after approval is blocked (planHash binding)", async () => {
    const { pauseStore, svc } = await bootstrap();
    const intent = await svc.createIntent({ intentId: "intent_mut", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20000, clientIdempotencyKey: "idem_mut", policyVersion: "v1" });
    const plan = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    const pause = await svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1200 });
    await svc.verify({ pauseId: pause.pauseId, policy, sources: passingSources, now: 1300 });
    const wrongHash = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" as `0x${string}`;
    await expect(svc.release({ pauseId: pause.pauseId, planHash: wrongHash, settlementOperationId: "op_mut", now: 1400 })).rejects.toThrow();
    // Correct hash succeeds
    const rel = await svc.release({ pauseId: pause.pauseId, planHash: plan.planHash, settlementOperationId: "op_mut_ok", now: 1400 });
    expect(rel.state).toBe("RELEASED");
    // mutate plan after release via direct store update would violate planHash immutability
    const cur = await pauseStore.getPause(pause.pauseId);
    expect(cur!.planHash).toBe(plan.planHash);
  });

  it("red-team: release replay is blocked (approval replay guard)", async () => {
    const { svc } = await bootstrap();
    const intent = await svc.createIntent({ intentId: "intent_replay", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20000, clientIdempotencyKey: "idem_replay", policyVersion: "v1" });
    const plan = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    const pause = await svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1200 });
    await svc.verify({ pauseId: pause.pauseId, policy, sources: passingSources, now: 1300 });
    await svc.release({ pauseId: pause.pauseId, planHash: plan.planHash, settlementOperationId: "op_replay", now: 1400 });
    // second release with same planHash should fail (terminal RELEASED or approval replay)
    await expect(svc.release({ pauseId: pause.pauseId, planHash: plan.planHash, settlementOperationId: "op_replay2", now: 1500 })).rejects.toThrow();
  });

  it("red-team: unknown checks block auto-release (fail-closed)", async () => {
    const { pauseStore, svc } = await bootstrap();
    const intent = await svc.createIntent({ intentId: "intent_unknown", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20000, clientIdempotencyKey: "idem_unknown", policyVersion: "v1" });
    const plan = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    const pause = await svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1200 });
    const escalated = await svc.verify({ pauseId: pause.pauseId, policy, sources: unknownSources, now: 1300 });
    expect(escalated.state).toBe("ESCALATED");
    expect(escalated.riskLevel).toBe("UNKNOWN");
    await expect(svc.release({ pauseId: pause.pauseId, planHash: plan.planHash, settlementOperationId: "op_unknown", now: 1400 })).rejects.toThrow();
    const checks = await pauseStore.getChecks(pause.pauseId);
    expect(checks.some(c=> c.status==="UNKNOWN" && c.severity==="BLOCKING")).toBe(true);
  });

  it("red-team: unknown approvalScopeHash mismatch blocked", async () => {
    const { svc } = await bootstrap();
    const intent = await svc.createIntent({ intentId: "intent_scope", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20000, clientIdempotencyKey: "idem_scope", policyVersion: "v1" });
    const plan = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    const pause = await svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1200 });
    await svc.verify({ pauseId: pause.pauseId, policy, sources: passingSources, now: 1300 });
    const badScope = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as `0x${string}`;
    await expect(svc.release({ pauseId: pause.pauseId, planHash: plan.planHash, approvalScopeHash: badScope, settlementOperationId: "op_scope", now: 1400 })).rejects.toThrow();
    await expect(svc.approve({ pauseId: pause.pauseId, planHash: plan.planHash, approvalScopeHash: badScope, now: 1300 })).rejects.toThrow();
  });

  it("red-team: approval replay after approve blocked", async () => {
    const { svc } = await bootstrap();
    const intent = await svc.createIntent({ intentId: "intent_appr", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20000, clientIdempotencyKey: "idem_appr", policyVersion: "v1" });
    const plan = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    const pause = await svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1200 });
    // force escalate via policy additionalApproval
    const escalatePolicy: Policy = { ...policy };
    const escalateSources: VerificationSources = { ...passingSources, additionalApproval: { requiresApproval: true } };
    const esc = await svc.verify({ pauseId: pause.pauseId, policy: escalatePolicy, sources: escalateSources, now: 1300 });
    expect(esc.state).toBe("ESCALATED");
    const scope = computeApprovalScopeHash(esc.pauseId, esc.planHash as `0x${string}`, esc.policyVersion);
    const approved = await svc.approve({ pauseId: pause.pauseId, planHash: plan.planHash, approvalScopeHash: scope, now: 1350 });
    expect(approved.state).toBe("RELEASE_READY");
    // second approve with same scope should replay-block
    await expect(svc.approve({ pauseId: pause.pauseId, planHash: plan.planHash, approvalScopeHash: scope, now: 1360 })).rejects.toThrow();
  });
});
