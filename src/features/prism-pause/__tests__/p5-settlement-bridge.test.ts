import { describe, it, expect } from "vitest";
import { InMemoryPauseStore } from "../adapters/memory-pause-store";
import { InMemoryOperationStore } from "../../prism-operations/adapters/memory-operation-store";
import { PauseService } from "../application/pause-service";
import { InMemoryPauseMetrics } from "../ports/metrics";
import { createFakeAdapterRegistry } from "../adapters/fake-execution-adapters";
import type { Policy, VerificationSources } from "../domain/policy-engine";
import { computeApprovalScopeHash } from "../domain/pause";
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

describe("P5 settlement adapter boundary", () => {
  it("RELEASED creates durable Operation in submitted state via injectable adapter, never completed", async () => {
    const pauseStore = new InMemoryPauseStore();
    const opStore = new InMemoryOperationStore();
    const metrics = new InMemoryPauseMetrics();
    const adapters = createFakeAdapterRegistry(opStore);
    const svc = new PauseService(pauseStore, { store: pauseStore, operationStore: opStore, executionAdapters: adapters, metrics, defaultPauseTtlMs: 10000, authorityResolver: testPauseAuthorityResolver, now: () => 1200 });
    const intent = await svc.createIntent({ intentId: "intent_p5a", principal: "prism:alice", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "100", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20000, clientIdempotencyKey: "idem_p5a", policyVersion: "v1" });
    const plan = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "100" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    const pause = await svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1200 });
    const verified = await svc.verify({ pauseId: pause.pauseId, policy, sources: passingSources, now: 1300 });
    expect(verified.state).toBe("RELEASE_READY");
    const released = await svc.release({ pauseId: pause.pauseId, planHash: plan.planHash, settlementOperationId: "op_p5_1", now: 1400, correlationId: "corr-123" });
    expect(released.state).toBe("RELEASED");
    expect(released.settlementOperationId).toBe("op_p5_1");
    const op = await opStore.getById("op_p5_1");
    expect(op).toBeDefined();
    expect(op!.state).toBe("submitted");
    expect(op!.state).not.toBe("completed");
    expect(op!.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(op!.correlationId).toBe("corr-123");
    // distinct states remain distinct: submitted != completed, and completing requires reconciled
    expect(["submitted","processing","confirming","confirmed","indexed","reconciled","completed"]).toContain(op!.state);
    expect(op!.state).not.toBe("completed");
    // adapter ports injectable: verify all three chains exist
    expect(adapters.has("starknet")).toBe(true);
    expect(adapters.has("base")).toBe(true);
    expect(adapters.has("strk20")).toBe(true);
    // metrics hooks
    expect(metrics.count("settlement_operation_created")).toBe(1);
    expect(metrics.count("settlement_operation_submitted")).toBe(1);
    expect(metrics.count("pause_released")).toBe(1);
  });

  it("starknet and strk20 chains use correct adapters and remain distinct", async () => {
    for (const chainId of ["starknet", "strk20"] as const) {
      const pauseStore = new InMemoryPauseStore();
      const opStore = new InMemoryOperationStore();
      const adapters = createFakeAdapterRegistry(opStore);
      const svc = new PauseService(pauseStore, { store: pauseStore, operationStore: opStore, executionAdapters: adapters, defaultPauseTtlMs: 10000, authorityResolver: testPauseAuthorityResolver, now: () => 2000 });
      const asset = chainId === "starknet" ? "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" : "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      const intent = await svc.createIntent({ intentId: `intent_${chainId}`, principal: "prism:bob", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: asset, requestedAmount: "10", requestedRoute: `${chainId}:${asset}:transfer`, createdAt: 1000, expiresAt: 20000, clientIdempotencyKey: `idem_${chainId}`, policyVersion: "v1" });
      const policyForChain: Policy = { ...policy, allowedChains: [chainId], allowedAssets: [asset] };
      const plan = await svc.createPlan({ chainId, asset, recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "10" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
      const pause = await svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1200 });
      await svc.verify({ pauseId: pause.pauseId, policy: policyForChain, sources: passingSources, now: 1300 });
      const released = await svc.release({ pauseId: pause.pauseId, planHash: plan.planHash, settlementOperationId: `op_${chainId}`, now: 1400 });
      expect(released.settlementOperationId).toBe(`op_${chainId}`);
      const op = await opStore.getById(`op_${chainId}`);
      expect(op!.state).toBe("submitted");
      expect(op!.kind).toContain(chainId);
    }
  });

  it("submitted/processing/confirming/confirmed/indexed/reconciled/completed remain distinct (no skip to completed)", async () => {
    const pauseStore = new InMemoryPauseStore();
    const opStore = new InMemoryOperationStore();
    const adapters = createFakeAdapterRegistry(opStore);
    const svc = new PauseService(pauseStore, { store: pauseStore, operationStore: opStore, executionAdapters: adapters, defaultPauseTtlMs: 10000, authorityResolver: testPauseAuthorityResolver, now: () => 3000 });
    const intent = await svc.createIntent({ intentId: "intent_chain", principal: "prism:carol", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "50", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20000, clientIdempotencyKey: "idem_chain", policyVersion: "v1" });
    const plan = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "50" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    const pause = await svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1200 });
    await svc.verify({ pauseId: pause.pauseId, policy, sources: passingSources, now: 1300 });
    await svc.release({ pauseId: pause.pauseId, planHash: plan.planHash, settlementOperationId: "op_chain_1", now: 1400 });
    let op = await opStore.getById("op_chain_1");
    expect(op!.state).toBe("submitted");
    // manual stepwise reconcilation — ensure distinct
    op = await opStore.transition(op!.id, { to: "processing", now: 1500, expectedVersion: op!.version, txHash: op!.txHash });
    expect(op.state).toBe("processing");
    op = await opStore.transition(op.id, { to: "confirming", now: 1600, expectedVersion: op.version, txHash: op.txHash });
    expect(op.state).toBe("confirming");
    op = await opStore.transition(op.id, { to: "confirmed", now: 1700, expectedVersion: op.version, txHash: op.txHash });
    expect(op.state).toBe("confirmed");
    op = await opStore.transition(op.id, { to: "indexed", now: 1800, expectedVersion: op.version, txHash: op.txHash });
    expect(op.state).toBe("indexed");
    op = await opStore.transition(op.id, { to: "reconciled", now: 1900, expectedVersion: op.version, txHash: op.txHash });
    expect(op.state).toBe("reconciled");
    op = await opStore.transition(op.id, { to: "completed", now: 2000, expectedVersion: op.version, txHash: op.txHash });
    expect(op.state).toBe("completed");
    // illegal skip blocked
    const op2Store = new InMemoryOperationStore();
    const op2 = await op2Store.create({ id: "op_illegal", kind: "test", idempotencyKey: "idem_illegal", requestFingerprint: "fp", now: 1000 });
    await expect(op2Store.transition(op2.id, { to: "completed", now: 2000, expectedVersion: op2.version })).rejects.toThrow();
  });

  it("no live chain call — adapter is fake and injectable (custom adapter overrides)", async () => {
    const pauseStore = new InMemoryPauseStore();
    const opStore = new InMemoryOperationStore();
    let customCalled = false;
    const customAdapter = {
      chain: "base" as const,
      submit: async (input: any) => {
        customCalled = true;
        // still fake submit via store — handle both created and ready states
        let cur = await opStore.getById(input.operation.id);
        if (cur!.state === "created") {
          cur = await opStore.transition(cur!.id, { to: "awaiting_authorization", now: 1500, expectedVersion: cur!.version });
          cur = await opStore.transition(cur!.id, { to: "ready", now: 1500, expectedVersion: cur!.version });
          cur = await opStore.transition(cur!.id, { to: "submitted", now: 1500, expectedVersion: cur!.version, txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as any });
        } else if (cur!.state === "requires_attention") {
          cur = await opStore.transition(cur!.id, { to: "submitted", now: 1500, expectedVersion: cur!.version, txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as any });
        }
        return cur!;
      },
    };
    const adapters = new Map([[ "base" as import("../ports/execution-adapter").SettlementChain, customAdapter as unknown as import("../ports/execution-adapter").PauseExecutionAdapter]]);
    const svc = new PauseService(pauseStore, { store: pauseStore, operationStore: opStore, executionAdapters: adapters, defaultPauseTtlMs: 10000, authorityResolver: testPauseAuthorityResolver, now: () => 4000 });
    const intent = await svc.createIntent({ intentId: "intent_custom", principal: "prism:dave", initiator: "user", purpose: "payment", requestedRecipient: "0xabc", requestedAsset: "0xdead", requestedAmount: "1", requestedRoute: "base:0xdead:transfer", createdAt: 1000, expiresAt: 20000, clientIdempotencyKey: "idem_custom", policyVersion: "v1" });
    const plan = await svc.createPlan({ chainId: "base", asset: "0xdead", recipient: "0xabc", calls: ["transfer"], valueLimits: { maxValue: "1" }, policyVersion: "v1", intentId: intent.intentId, createdAt: 1100 });
    const pause = await svc.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1200 });
    await svc.verify({ pauseId: pause.pauseId, policy, sources: passingSources, now: 1300 });
    await svc.release({ pauseId: pause.pauseId, planHash: plan.planHash, settlementOperationId: "op_custom", now: 1400 });
    expect(customCalled).toBe(true);
    const op = await opStore.getById("op_custom");
    expect(op!.state).toBe("submitted");
  });
});
