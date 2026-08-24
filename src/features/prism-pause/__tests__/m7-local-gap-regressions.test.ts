import { describe, expect, it } from "vitest";
import { InMemoryPauseStore } from "../adapters/memory-pause-store";
import { PauseService } from "../application/pause-service";
import { evaluatePolicy } from "../domain/policy-engine";
import { createIntent } from "../domain/intent";
import { createExecutionPlan } from "../domain/execution-plan";
import { createPause } from "../domain/pause";
import type { ExecutionPause } from "../domain/pause";
import type { Policy, VerificationSources } from "../domain/policy-engine";
import type { CreateOperationRecordInput, PersistedOperation } from "../../prism-operations/domain/operation-store";
import { InMemoryOperationStore } from "../../prism-operations/adapters/memory-operation-store";
import { PauseSettlementBridge } from "../application/pause-settlement-bridge";
import { createFakeAdapterRegistry } from "../adapters/fake-execution-adapters";
import { PAUSE_ERROR_CODE } from "../domain/errors";
import type { PauseAuthorityResolver } from "../ports/authority";

const allowTestAuthority: PauseAuthorityResolver = {
  resolve: async () => ({ authorized: true, actor: "user" }),
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

const policy: Policy = {
  policyVersion: "v1",
  allowedChains: ["base"],
  allowedAssets: ["0xdead"],
  allowedContracts: ["*"],
  amountCeiling: "1000",
  requireFirstUseEscalation: false,
};

function intentInput(overrides: Partial<Parameters<typeof createIntent>[0]> = {}) {
  return {
    intentId: "intent_m7_gap",
    principal: "prism:alice",
    initiator: "user" as const,
    purpose: "payment" as const,
    requestedRecipient: "0xabc",
    requestedAsset: "0xdead",
    requestedAmount: "100",
    requestedRoute: "base:0xdead:transfer",
    createdAt: 1_000,
    expiresAt: 20_000,
    clientIdempotencyKey: "idem_m7_gap",
    policyVersion: "v1",
    ...overrides,
  };
}

async function readyPause(opts?: { operationStore?: InMemoryOperationStore; authorityResolver?: PauseAuthorityResolver }) {
  const pauseStore = new InMemoryPauseStore();
  const operationStore = opts?.operationStore;
  const service = new PauseService(pauseStore, {
    store: pauseStore,
    defaultPauseTtlMs: 10_000,
    operationStore,
    authorityResolver: opts?.authorityResolver,
    now: () => 1_000,
  });
  const intent = await service.createIntent(intentInput());
  const plan = await service.createPlan({
    chainId: "base",
    asset: "0xdead",
    recipient: "0xabc",
    calls: ["transfer"],
    valueLimits: { maxValue: "100" },
    policyVersion: "v1",
    intentId: intent.intentId,
    createdAt: 1_100,
  });
  const pause = await service.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1_200 });
  const verified = await service.verify({ pauseId: pause.pauseId, policy, sources: passingSources, now: 1_300 });
  expect(verified.state).toBe("RELEASE_READY");
  return { pauseStore, operationStore, service, intent, plan, verified };
}

class FailingCreateOperationStore extends InMemoryOperationStore {
  override async create(_input: CreateOperationRecordInput): Promise<PersistedOperation> {
    throw new Error("operation_store_unavailable");
  }
}

class FailingPauseUpdateStore extends InMemoryPauseStore {
  override async updatePause(_pause: ExecutionPause, _expectedVersion: number): Promise<ExecutionPause> {
    throw new Error("pause_update_unavailable");
  }
}

class FailOnceReleasePauseUpdateStore extends InMemoryPauseStore {
  private failedRelease = false;

  override async updatePause(pause: ExecutionPause, expectedVersion: number): Promise<ExecutionPause> {
    if (!this.failedRelease && pause.state === "RELEASED") {
      this.failedRelease = true;
      throw new Error("pause_release_cas_failed");
    }
    return super.updatePause(pause, expectedVersion);
  }
}

describe("M7 local runtime gap regressions", () => {
  it("fails closed when release authority is not explicitly configured", async () => {
    const { pauseStore, service, plan, verified } = await readyPause();

    await expect(
      service.release({
        pauseId: verified.pauseId,
        planHash: plan.planHash,
        settlementOperationId: "op_authority_missing",
        now: 1_400,
      }),
    ).rejects.toMatchObject({ code: "ERR-123" });

    expect((await pauseStore.getPause(verified.pauseId))?.state).toBe("RELEASE_READY");
  });

  it("fails closed when approval authority is not explicitly configured", async () => {
    const { pauseStore, service, plan, verified } = await readyPause();
    const escalated = await service.escalate({
      pauseId: verified.pauseId,
      reasonCodes: ["PAUSE-TEST-APPROVAL"],
      requiredApprovalCount: 1,
      now: 1_400,
    });

    await expect(
      service.approve({
        pauseId: escalated.pauseId,
        planHash: plan.planHash,
        now: 1_500,
      }),
    ).rejects.toMatchObject({ code: "ERR-123" });

    expect((await pauseStore.getPause(escalated.pauseId))?.state).toBe("ESCALATED");
  });

  it("treats initiator and agent authority as part of an intent idempotency fingerprint", async () => {
    const store = new InMemoryPauseStore();
    const service = new PauseService(store, { store });
    await service.createIntent(intentInput());

    await expect(
      service.createIntent(
        intentInput({ initiator: "agent", agentId: "agent-2" }),
      ),
    ).rejects.toMatchObject({ code: "ERR-107" });
  });

  it("emits a blocking policy-version check when any bound snapshot drifts", () => {
    const intent = createIntent(intentInput());
    const plan = {
      ...createExecutionPlan({
        chainId: "base",
        asset: "0xdead",
        recipient: "0xabc",
        calls: ["transfer"],
        valueLimits: { maxValue: "100" },
        policyVersion: "v1",
        intentId: intent.intentId,
        createdAt: 1_100,
      }),
    };
    const pause = createPause({
      pauseId: "pause_policy_drift",
      intentId: intent.intentId,
      planHash: plan.planHash,
      policyVersion: "v1",
      createdAt: 1_200,
      expiresAt: 20_000,
    });

    const checks = evaluatePolicy({
      intent,
      plan,
      pause,
      policy: { ...policy, policyVersion: "v2" },
      sources: passingSources,
      now: 1_300,
    });

    expect(
      checks.some(
        (check) =>
          check.checkId === "PAUSE-POLICY-001" &&
          check.status === "FAIL" &&
          check.severity === "BLOCKING",
      ),
    ).toBe(true);
  });

  it("does not release a pause when settlement-operation persistence fails", async () => {
    const operationStore = new FailingCreateOperationStore();
    const { pauseStore, service, plan, verified } = await readyPause({ operationStore, authorityResolver: allowTestAuthority });

    await expect(
      service.release({
        pauseId: verified.pauseId,
        planHash: plan.planHash,
        settlementOperationId: "op_persist_failure",
        now: 1_400,
      }),
    ).rejects.toThrow("operation_store_unavailable");

    expect((await pauseStore.getPause(verified.pauseId))?.state).toBe("RELEASE_READY");
  });

  it("does not hide non-CAS sweep failures", async () => {
    const store = new FailingPauseUpdateStore();
    const service = new PauseService(store, { store, defaultPauseTtlMs: 100 });
    const intent = await service.createIntent(intentInput({ intentId: "intent_sweep_failure", clientIdempotencyKey: "idem_sweep_failure" }));
    const plan = await service.createPlan({
      chainId: "base",
      asset: "0xdead",
      recipient: "0xabc",
      calls: ["transfer"],
      valueLimits: { maxValue: "100" },
      policyVersion: "v1",
      intentId: intent.intentId,
      createdAt: 0,
    });
    await service.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 0 });

    await expect(service.sweepExpired(200)).rejects.toThrow("pause_update_unavailable");
  });

  it("cancels a prepared operation after a losing release CAS and never reuses it on retry", async () => {
    const pauseStore = new FailOnceReleasePauseUpdateStore();
    const operationStore = new InMemoryOperationStore();
    const service = new PauseService(pauseStore, {
      store: pauseStore,
      defaultPauseTtlMs: 10_000,
      operationStore,
      authorityResolver: allowTestAuthority,
      now: () => 1_000,
    });
    const intent = await service.createIntent(intentInput({ intentId: "intent_release_retry", clientIdempotencyKey: "idem_release_retry" }));
    const plan = await service.createPlan({
      chainId: "base",
      asset: "0xdead",
      recipient: "0xabc",
      calls: ["transfer"],
      valueLimits: { maxValue: "100" },
      policyVersion: "v1",
      intentId: intent.intentId,
      createdAt: 1_100,
    });
    const pause = await service.pause({ intentId: intent.intentId, planHash: plan.planHash, now: 1_200 });
    const verified = await service.verify({ pauseId: pause.pauseId, policy, sources: passingSources, now: 1_300 });

    await expect(
      service.release({
        pauseId: verified.pauseId,
        planHash: plan.planHash,
        settlementOperationId: "op_release_retry",
        now: 1_400,
        expectedVersion: verified.version,
      }),
    ).rejects.toThrow("pause_release_cas_failed");

    const abandoned = await operationStore.getById("op_release_retry");
    expect(abandoned?.state).toBe("cancelled");
    expect((await pauseStore.getPause(verified.pauseId))?.state).toBe("RELEASE_READY");

    await expect(
      service.release({
        pauseId: verified.pauseId,
        planHash: plan.planHash,
        settlementOperationId: "op_release_retry",
        now: 1_500,
        expectedVersion: verified.version,
      }),
    ).rejects.toMatchObject({ code: "ERR-124" });

    expect((await pauseStore.getPause(verified.pauseId))?.state).toBe("RELEASE_READY");
  });

  it("rejects a terminal operation before it can be linked to a released pause", async () => {
    const operationStore = new InMemoryOperationStore();
    const { pauseStore, service, plan, verified } = await readyPause({ operationStore, authorityResolver: allowTestAuthority });
    const terminal = await operationStore.create({
      id: "op_terminal_retry",
      kind: "pause_settlement:base",
      idempotencyKey: `pause_settlement:${verified.pauseId}:${plan.planHash}`,
      requestFingerprint: `${plan.planHash}:v1:${verified.pauseId}`,
      now: 1_000,
    });
    await operationStore.transition(terminal.id, {
      to: "failed_terminal",
      now: 1_100,
      expectedVersion: terminal.version,
      errorCode: "ERR-021",
    });

    await expect(
      service.release({
        pauseId: verified.pauseId,
        planHash: plan.planHash,
        settlementOperationId: terminal.id,
        now: 1_400,
        expectedVersion: verified.version,
      }),
    ).rejects.toMatchObject({ code: "ERR-124" });

    expect((await pauseStore.getPause(verified.pauseId))?.state).toBe("RELEASE_READY");
  });

  it("rejects an unrelated pre-existing operation id before releasing the pause", async () => {
    const operationStore = new InMemoryOperationStore();
    await operationStore.create({
      id: "op_collision",
      kind: "unrelated",
      idempotencyKey: "unrelated-key",
      requestFingerprint: "unrelated-fingerprint",
      now: 1_000,
    });
    const { pauseStore, service, plan, verified } = await readyPause({ operationStore, authorityResolver: allowTestAuthority });

    await expect(
      service.release({
        pauseId: verified.pauseId,
        planHash: plan.planHash,
        settlementOperationId: "op_collision",
        now: 1_400,
      }),
    ).rejects.toMatchObject({ code: "ERR-107" });

    expect((await pauseStore.getPause(verified.pauseId))?.state).toBe("RELEASE_READY");
  });

  it("restores lifecycle, checks, and decisions into a new local store instance", async () => {
    const { pauseStore, service, verified } = await readyPause();
    const escalated = await service.escalate({
      pauseId: verified.pauseId,
      reasonCodes: ["PAUSE-TEST-001"],
      requiredApprovalCount: 1,
      now: 1_400,
    });
    await pauseStore.putChecks(escalated.pauseId, [
      {
        checkId: "PAUSE-TEST-001",
        status: "UNKNOWN",
        severity: "BLOCKING",
        reasonCode: "PAUSE-UNKNOWN-001",
        source: "test",
        checkedAt: 1_400,
      },
    ]);
    const snapshot = pauseStore.snapshot();
    const restartedStore = new InMemoryPauseStore(snapshot);
    const restarted = new PauseService(restartedStore, { store: restartedStore });

    const reloaded = await restarted.getPause(escalated.pauseId);
    expect(reloaded?.state).toBe("ESCALATED");
    expect(await restartedStore.getChecks(escalated.pauseId)).toHaveLength(1);
    expect((await restartedStore.getDecisions(escalated.pauseId)).map((d) => d.kind)).toContain("ESCALATE");
  });

  it("rejects cancelled linked operations before a settlement bridge retry", async () => {
    const operationStore = new InMemoryOperationStore();
    const { service, plan, verified } = await readyPause({ operationStore, authorityResolver: allowTestAuthority });
    const released = await service.release({
      pauseId: verified.pauseId,
      planHash: plan.planHash,
      settlementOperationId: "op_bridge_cancelled",
      now: 1_400,
    });
    const operation = await operationStore.getById("op_bridge_cancelled");
    expect(operation?.state).toBe("created");
    await operationStore.transition(operation!.id, { to: "cancelled", now: 1_450, expectedVersion: operation!.version });
    const bridge = new PauseSettlementBridge({
      pauseStore: new InMemoryPauseStore(),
      operationStore,
      adapters: createFakeAdapterRegistry(operationStore),
      now: () => 1_500,
    });

    await expect(
      bridge.createAndSubmitSettlement({
        pause: released,
        plan,
        operationId: operation!.id,
      }),
    ).rejects.toMatchObject({ code: PAUSE_ERROR_CODE.OPERATION_NOT_REUSABLE });
  });

  it("rejects an unrelated pre-existing operation id in the settlement bridge", async () => {
    const operationStore = new InMemoryOperationStore();
    await operationStore.create({
      id: "op_bridge_collision",
      kind: "unrelated",
      idempotencyKey: "unrelated-key",
      requestFingerprint: "unrelated-fingerprint",
      now: 1_000,
    });
    const { service, plan, verified } = await readyPause({ authorityResolver: allowTestAuthority });
    const released = await service.release({
      pauseId: verified.pauseId,
      planHash: plan.planHash,
      settlementOperationId: "op_bridge_collision",
      now: 1_400,
    });
    const bridge = new PauseSettlementBridge({
      pauseStore: new InMemoryPauseStore(),
      operationStore,
      adapters: createFakeAdapterRegistry(operationStore),
      now: () => 1_500,
    });

    await expect(
      bridge.createAndSubmitSettlement({
        pause: released,
        plan,
        operationId: "op_bridge_collision",
      }),
    ).rejects.toMatchObject({ code: "ERR-107" });
  });
});
