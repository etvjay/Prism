import { describe, expect, it } from "vitest";
import { InMemoryPauseStore } from "../adapters/memory-pause-store";
import { PauseService } from "../application/pause-service";
import type { ExecutionPause } from "../domain/pause";
import type { PauseDecision } from "../ports/pause-store";

class AlwaysFailAppendStore extends InMemoryPauseStore {
  override async appendDecision(_decision: PauseDecision): Promise<PauseDecision> {
    throw new Error("audit_decision_unavailable");
  }
}

class FailOnceAppendStore extends InMemoryPauseStore {
  private shouldFail = true;

  override async appendDecision(decision: PauseDecision): Promise<PauseDecision> {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new Error("audit_decision_unavailable_once");
    }
    return super.appendDecision(decision);
  }
}

async function createPaused(store: InMemoryPauseStore) {
  const service = new PauseService(store, { store, defaultPauseTtlMs: 10_000 });
  const intent = await service.createIntent({
    intentId: "intent_atomicity",
    principal: "prism:alice",
    initiator: "user",
    purpose: "payment",
    requestedRecipient: "0xabc",
    requestedAsset: "0xdead",
    requestedAmount: "100",
    requestedRoute: "base:0xdead:transfer",
    createdAt: 1_000,
    expiresAt: 20_000,
    clientIdempotencyKey: "idem_atomicity",
    policyVersion: "v1",
  });
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
  return { service, pause, plan };
}

describe("Pause state/decision atomicity", () => {
  it("rolls back the pause mutation when appending its audit decision fails", async () => {
    const store = new AlwaysFailAppendStore();
    const { service, pause } = await createPaused(store);

    await expect(service.cancel({ pauseId: pause.pauseId, now: 1_300, expectedVersion: pause.version })).rejects.toThrow("audit_decision_unavailable");

    expect(await store.getPause(pause.pauseId)).toMatchObject({
      state: "PAUSED",
      version: 0,
      decisionIds: [],
    });
    expect(await store.getDecisions(pause.pauseId)).toEqual([]);
  });

  it("fails closed before state mutation when the store lacks transaction capability", async () => {
    const store = new InMemoryPauseStore();
    const { service, pause } = await createPaused(store);
    Object.defineProperty(store, "withTransaction", { value: undefined, configurable: true });

    await expect(service.cancel({ pauseId: pause.pauseId, now: 1_300, expectedVersion: pause.version })).rejects.toMatchObject({ code: "ERR-121" });
    expect(await store.getPause(pause.pauseId)).toMatchObject({ state: "PAUSED", version: 0, decisionIds: [] });
    expect(await store.getDecisions(pause.pauseId)).toEqual([]);
  });

  it("serializes a rollback/race so one committed state has exactly one correlated decision", async () => {
    const store = new FailOnceAppendStore();
    const { service, pause, plan } = await createPaused(store);

    const results = await Promise.allSettled([
      service.cancel({ pauseId: pause.pauseId, now: 1_300, expectedVersion: pause.version }),
      service.cancel({ pauseId: pause.pauseId, now: 1_300, expectedVersion: pause.version }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const decisions = await store.getDecisions(pause.pauseId);
    const committed = await store.getPause(pause.pauseId) as ExecutionPause;
    expect(committed.state).toBe("CANCELLED");
    expect(committed.version).toBe(1);
    expect(decisions).toHaveLength(1);
    expect(committed.decisionIds).toEqual([decisions[0].decisionId]);
    expect(decisions[0]).toMatchObject({
      pauseId: pause.pauseId,
      kind: "CANCEL",
      actor: "user",
      planHash: plan.planHash,
      policyVersion: "v1",
    });
  });
});
