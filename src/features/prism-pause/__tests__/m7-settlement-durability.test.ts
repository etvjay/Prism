import { describe, expect, it } from "vitest";
import { InMemoryPauseStore } from "../adapters/memory-pause-store";
import { InMemoryOperationStore } from "../../prism-operations/adapters/memory-operation-store";
import type { OperationStore, PersistedOperation } from "../../prism-operations/domain/operation-store";
import type { PauseExecutionAdapter, SettlementSubmissionInput } from "../ports/execution-adapter";
import { PauseSettlementBridge } from "../application/pause-settlement-bridge";
import { PauseService } from "../application/pause-service";
import type { ExecutionPause } from "../domain/pause";
import type { ExecutionPlan } from "../domain/execution-plan";
import type { Policy, VerificationSources } from "../domain/policy-engine";
import type { PauseAuthorityResolver } from "../ports/authority";
import { testPauseAuthorityResolver } from "./test-authority";
import { createIsolatedFactory } from "../../../application/factory";

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

const TX_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`;
const allowAuthority: PauseAuthorityResolver = { resolve: async () => ({ authorized: true, actor: "user" }) };

type ReadyFixture = {
  pauseStore: InMemoryPauseStore;
  operationStore: InMemoryOperationStore;
  service: PauseService;
  pause: ExecutionPause;
  plan: ExecutionPlan;
};

async function readyFixture(opts?: {
  operationStore?: InMemoryOperationStore;
  adapters?: Map<"base", PauseExecutionAdapter>;
  pauseStore?: InMemoryPauseStore;
  authorityResolver?: PauseAuthorityResolver;
}): Promise<ReadyFixture> {
  const pauseStore = opts?.pauseStore ?? new InMemoryPauseStore();
  const operationStore = opts?.operationStore ?? new InMemoryOperationStore();
  const service = new PauseService(pauseStore, {
    store: pauseStore,
    operationStore,
    executionAdapters: opts?.adapters,
    authorityResolver: opts?.authorityResolver ?? allowAuthority,
    defaultPauseTtlMs: 10_000,
    now: () => 1_000,
  });
  const intent = await service.createIntent({
    intentId: "intent_m7_durability",
    principal: "prism:alice",
    initiator: "user",
    purpose: "payment",
    requestedRecipient: "0xabc",
    requestedAsset: "0xdead",
    requestedAmount: "10",
    requestedRoute: "base:0xdead:transfer",
    createdAt: 1_000,
    expiresAt: 20_000,
    clientIdempotencyKey: "idem_m7_durability",
    policyVersion: "v1",
  });
  const plan = await service.createPlan({
    chainId: "base",
    asset: "0xdead",
    recipient: "0xabc",
    calls: ["transfer"],
    valueLimits: { maxValue: "10" },
    policyVersion: "v1",
    intentId: intent.intentId,
    createdAt: 1_100,
  });
  const paused = await service.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1_200 });
  const verified = await service.verify({ pauseId: paused.pauseId, policy, sources: passingSources, now: 1_300 });
  expect(verified.state).toBe("RELEASE_READY");
  return { pauseStore, operationStore, service, pause: verified, plan };
}

function transitioningAdapter(operationStore: OperationStore, onCall?: (input: SettlementSubmissionInput) => void | Promise<void>): PauseExecutionAdapter {
  return {
    chain: "base",
    async submit(input) {
      await onCall?.(input);
      const current = await operationStore.getById(input.operationId);
      if (!current) throw new Error("operation_missing_in_adapter");
      return operationStore.transition(current.id, {
        to: "submitted",
        now: 1_500,
        expectedVersion: current.version,
        txHash: TX_HASH,
      });
    },
  };
}

describe("M7 settlement durability and authenticity", () => {
  it("persists the submission fence before an adapter failure and never calls that adapter again", async () => {
    let adapterCalls = 0;
    const failingAdapter: PauseExecutionAdapter = {
      chain: "base",
      async submit() {
        adapterCalls += 1;
        throw new Error("transport_lost_after_possible_broadcast");
      },
    };
    const adapters = new Map<"base", PauseExecutionAdapter>([["base", failingAdapter]]);
    const fixture = await readyFixture({ adapters });

    const released = await fixture.service.release({
      pauseId: fixture.pause.pauseId,
      planHash: fixture.plan.planHash,
      settlementOperationId: "op_fenced_failure",
      now: 1_400,
    });
    expect(released.state).toBe("RELEASED");
    expect(adapterCalls).toBe(1);

    const quarantined = await fixture.operationStore.getById("op_fenced_failure");
    expect(quarantined?.state).toBe("requires_attention");
    expect(quarantined?.submissionAttempted).toBe(true);
    expect(quarantined?.errorCode).toBe("ERR-022");

    const durablePause = await fixture.pauseStore.getPause(fixture.pause.pauseId);
    const bridge = new PauseSettlementBridge({ pauseStore: fixture.pauseStore, operationStore: fixture.operationStore, adapters, now: () => 1_600 });
    await bridge.createAndSubmitSettlement({
      pause: durablePause!,
      plan: fixture.plan,
      operationId: "op_fenced_failure",
    });
    expect(adapterCalls).toBe(1);
  });

  it("serializes concurrent bridge retries with one adapter call and a durable fence", async () => {
    let adapterCalls = 0;
    const fixture = await readyFixture();
    const released = await fixture.service.release({
      pauseId: fixture.pause.pauseId,
      planHash: fixture.plan.planHash,
      settlementOperationId: "op_bridge_race",
      now: 1_400,
    });
    const adapter = transitioningAdapter(fixture.operationStore, async (input) => {
      adapterCalls += 1;
      expect(input.operation.submissionAttempted).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const adapters = new Map<"base", PauseExecutionAdapter>([["base", adapter]]);
    const bridge = new PauseSettlementBridge({ pauseStore: fixture.pauseStore, operationStore: fixture.operationStore, adapters, now: () => 1_500 });

    const results = await Promise.allSettled([
      bridge.createAndSubmitSettlement({ pause: { ...released, state: "PAUSED" }, plan: { ...fixture.plan, recipient: "0xattacker" }, operationId: "op_bridge_race" }),
      bridge.createAndSubmitSettlement({ pause: { ...released, state: "PAUSED" }, plan: { ...fixture.plan, recipient: "0xattacker" }, operationId: "op_bridge_race" }),
    ]);

    expect(results).toHaveLength(2);
    expect(adapterCalls).toBe(1);
    const persisted = await fixture.operationStore.getById("op_bridge_race");
    expect(persisted?.state).toBe("submitted");
    expect(persisted?.submissionAttempted).toBe(true);
  });

  it("uses durable pause, plan, release decision, and operation link instead of caller objects", async () => {
    let seenPause: ExecutionPause | undefined;
    let seenPlan: ExecutionPlan | undefined;
    const fixture = await readyFixture();
    const released = await fixture.service.release({
      pauseId: fixture.pause.pauseId,
      planHash: fixture.plan.planHash,
      settlementOperationId: "op_authoritative_bridge",
      now: 1_400,
    });
    const durablePause = await fixture.pauseStore.getPause(released.pauseId);
    const durableDecisions = await fixture.pauseStore.getDecisions(released.pauseId);
    expect(durablePause?.state).toBe("RELEASED");
    expect(durableDecisions.some((decision) => decision.kind === "RELEASE")).toBe(true);

    const adapter = transitioningAdapter(fixture.operationStore, (input) => {
      seenPause = input.pause;
      seenPlan = input.plan;
    });
    const bridge = new PauseSettlementBridge({
      pauseStore: fixture.pauseStore,
      operationStore: fixture.operationStore,
      adapters: new Map([["base", adapter]]),
      now: () => 1_500,
    });

    const forgedPause = { ...released, state: "PAUSED" as const, planHash: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" as `0x${string}`, settlementOperationId: "op_attacker" };
    const forgedPlan = { ...fixture.plan, planHash: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" as `0x${string}`, recipient: "0xattacker" };
    const submitted = await bridge.createAndSubmitSettlement({ pause: forgedPause, plan: forgedPlan, operationId: "op_authoritative_bridge" });

    expect(submitted.state).toBe("submitted");
    expect(seenPause).toEqual(durablePause);
    expect(seenPlan).toEqual(fixture.plan);
  });

  it("refuses a RELEASED pause with no durable release decision before adapter invocation", async () => {
    class DecisionHidingPauseStore extends InMemoryPauseStore {
      override async getDecisions(_pauseId: string) {
        return [];
      }
    }
    const pauseStore = new DecisionHidingPauseStore();
    const fixture = await readyFixture({ pauseStore });
    const released = await fixture.service.release({
      pauseId: fixture.pause.pauseId,
      planHash: fixture.plan.planHash,
      settlementOperationId: "op_missing_decision",
      now: 1_400,
    });
    let adapterCalls = 0;
    const adapter = transitioningAdapter(fixture.operationStore, () => { adapterCalls += 1; });
    const bridge = new PauseSettlementBridge({
      pauseStore,
      operationStore: fixture.operationStore,
      adapters: new Map([["base", adapter]]),
      now: () => 1_500,
    });

    await expect(bridge.createAndSubmitSettlement({ pause: released, plan: fixture.plan, operationId: "op_missing_decision" })).rejects.toMatchObject({ code: "ERR-121" });
    expect(adapterCalls).toBe(0);
  });

  it("keeps a durable quarantine when post-submit persistence fails", async () => {
    class FailSubmittedStore extends InMemoryOperationStore {
      override async transition(id: string, input: Parameters<InMemoryOperationStore["transition"]>[1]): Promise<PersistedOperation> {
        if (input.to === "submitted") throw new Error("submitted_write_lost");
        return super.transition(id, input);
      }
    }
    const operationStore = new FailSubmittedStore();
    const fixture = await readyFixture({ operationStore });
    const released = await fixture.service.release({
      pauseId: fixture.pause.pauseId,
      planHash: fixture.plan.planHash,
      settlementOperationId: "op_persistence_loss",
      now: 1_400,
    });
    let adapterCalls = 0;
    const adapter: PauseExecutionAdapter = {
      chain: "base",
      async submit(input) {
        adapterCalls += 1;
        const current = await operationStore.getById(input.operationId);
        if (!current) throw new Error("missing_operation");
        return operationStore.transition(current.id, { to: "submitted", now: 1_500, expectedVersion: current.version, txHash: TX_HASH });
      },
    };
    const bridge = new PauseSettlementBridge({ pauseStore: fixture.pauseStore, operationStore, adapters: new Map([["base", adapter]]), now: () => 1_500 });

    await expect(bridge.createAndSubmitSettlement({ pause: released, plan: fixture.plan, operationId: "op_persistence_loss" })).rejects.toThrow();
    expect(adapterCalls).toBe(1);
    const quarantined = await operationStore.getById("op_persistence_loss");
    expect(quarantined?.state).toBe("requires_attention");
    expect(quarantined?.submissionAttempted).toBe(true);

    await bridge.createAndSubmitSettlement({ pause: released, plan: fixture.plan, operationId: "op_persistence_loss" }).catch(() => undefined);
    expect(adapterCalls).toBe(1);
  });

  it("does not wire fake settlement adapters by default; test doubles require explicit factory injection", async () => {
    const factory = createIsolatedFactory(1_800_000_500, {
      pauseAuthorityResolver: testPauseAuthorityResolver,
      verificationSourceProvider: () => passingSources,
      submitPortRegistryVersion: "v1",
    });
    const intent = await factory.pauseService.createIntent({
      prismId: "prism:factory-default",
      purpose: "payment",
      venue: "base",
      asset: "0xdead",
      recipientAddress: "0xabc",
      amount: "10",
      idempotencyKey: "idem_factory_default",
    });
    const pause = await factory.pauseService.pauseIntent(intent.intentId);
    const verified = await factory.pauseService.verifyPause(pause.pauseId);
    const released = await factory.pauseService.releasePause(verified.pauseId, verified.version, {
      settlementOperationId: "op_factory_default",
    });
    expect(released.state).toBe("RELEASED");
    const operation = await factory.operationStore.getById("op_factory_default");
    expect(operation?.state).toBe("created");
    expect(operation?.submissionAttempted).toBe(false);
    await factory.shutdown();
  });
});
