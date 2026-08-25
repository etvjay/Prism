// LIVE PostgreSQL integration tier for the PauseStore adapter.
// GATED: runs only when PRISM_POSTGRES_TEST_URL points at a reachable
// PostgreSQL server. Without it, the suite is skipped and makes no X3 claim.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresPauseStore } from "../adapters/postgres-pause-store";
import { createExecutionPlan } from "../domain/execution-plan";
import { createIntent } from "../domain/intent";
import { createPause, toVerifying } from "../domain/pause";
import type { PauseDecision } from "../ports/pause-store";

const TEST_URL = process.env.PRISM_POSTGRES_TEST_URL;
const suite = TEST_URL ? describe : describe.skip;
const TEST_SCHEMA = `prism_pause_${process.pid}`;

function storeOptions(extra: Record<string, unknown> = {}) {
  return { connectionString: TEST_URL, options: `-c search_path=${TEST_SCHEMA}`, ...extra };
}

function createStore(extra: Record<string, unknown> = {}) {
  return PostgresPauseStore.create(storeOptions(extra));
}

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

let store: PostgresPauseStore;
let adminPool: Pool;

async function createPauseFixture(suffix: string) {
  const intent = createIntent({
    intentId: `intent_${suffix}`,
    principal: "prism:alice",
    initiator: "user",
    purpose: "payment",
    requestedRecipient: "0xabc",
    requestedAsset: "0xdead",
    requestedAmount: "100",
    requestedRoute: "base:0xdead:transfer",
    createdAt: 1_789_000_000,
    expiresAt: 1_789_001_000,
    clientIdempotencyKey: `idem_${suffix}`,
    policyVersion: "v1",
  });
  await store.putIntent(intent);
  const plan = createExecutionPlan({
    chainId: "base",
    asset: "0xdead",
    recipient: "0xabc",
    calls: ["transfer"],
    valueLimits: { maxValue: "100" },
    policyVersion: "v1",
    intentId: intent.intentId,
    createdAt: 1_789_000_001,
  });
  await store.putPlan(plan);
  const pause = createPause({
    pauseId: `pause_${suffix}`,
    intentId: intent.intentId,
    planHash: plan.planHash,
    policyVersion: "v1",
    createdAt: 1_789_000_002,
    expiresAt: 1_789_001_000,
  });
  await store.createPause({ intent, plan, pause });
  return { intent, plan, pause };
}

function makeDecision(input: {
  decisionId: string;
  pauseId: string;
  planHash: string;
  kind?: PauseDecision["kind"];
  createdAt?: number;
}): PauseDecision {
  return {
    decisionId: input.decisionId,
    pauseId: input.pauseId,
    kind: input.kind ?? "CANCEL",
    actor: "user",
    policyVersion: "v1",
    planHash: input.planHash as PauseDecision["planHash"],
    approvalScopeHash: null,
    reasonCodes: ["test"],
    createdAt: input.createdAt ?? 1_789_000_010,
    expiresAt: null,
  };
}

beforeAll(async () => {
  if (!TEST_URL) return;
  adminPool = new Pool({ connectionString: TEST_URL, max: 1 });
  await adminPool.query(`CREATE SCHEMA IF NOT EXISTS "${TEST_SCHEMA}"`);
  store = await createStore({ max: 10 });
});

afterAll(async () => {
  if (store) await store.close().catch(() => undefined);
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE`).catch(() => undefined);
    await adminPool.end().catch(() => undefined);
  }
});

suite("PostgresPauseStore (LIVE integration, M7 decision durability)", () => {
  it("round-trips ordered decisions and decision_ids across close/reopen", async () => {
    const { pause, plan } = await createPauseFixture(uniqueSuffix());
    const first = makeDecision({ decisionId: `decision_first_${uniqueSuffix()}`, pauseId: pause.pauseId, planHash: plan.planHash, createdAt: 1_789_000_010 });
    const second = makeDecision({ decisionId: `decision_second_${uniqueSuffix()}`, pauseId: pause.pauseId, planHash: plan.planHash, kind: "REVERIFY", createdAt: 1_789_000_011 });

    await store.appendDecision(first);
    await store.appendDecision(second);
    expect((await store.getDecisions(pause.pauseId)).map((decision) => decision.decisionId)).toEqual([first.decisionId, second.decisionId]);
    expect((await store.getPause(pause.pauseId))?.decisionIds).toEqual([first.decisionId, second.decisionId]);

    await store.close();
    const reopened = await createStore();
    store = reopened;
    try {
      expect((await reopened.getDecisions(pause.pauseId)).map((decision) => decision.decisionId)).toEqual([first.decisionId, second.decisionId]);
      expect((await reopened.getPause(pause.pauseId))?.decisionIds).toEqual([first.decisionId, second.decisionId]);
    } catch (error) {
      await reopened.close();
      throw error;
    }
  });

  it("reads decisions in the same append order as the decision_ids metadata", async () => {
    const { pause, plan } = await createPauseFixture(uniqueSuffix());
    const first = makeDecision({ decisionId: `decision_order_first_${uniqueSuffix()}`, pauseId: pause.pauseId, planHash: plan.planHash, createdAt: 1_789_000_020 });
    const second = makeDecision({ decisionId: `decision_order_second_${uniqueSuffix()}`, pauseId: pause.pauseId, planHash: plan.planHash, kind: "REVERIFY", createdAt: 1_789_000_010 });

    await store.appendDecision(first);
    await store.appendDecision(second);

    expect((await store.getDecisions(pause.pauseId)).map((decision) => decision.decisionId)).toEqual([first.decisionId, second.decisionId]);
    expect((await store.getPause(pause.pauseId))?.decisionIds).toEqual([first.decisionId, second.decisionId]);
  });

  it("rolls back the decision row when the metadata mirror is rejected", async () => {
    const suffix = uniqueSuffix();
    const { pause, plan } = await createPauseFixture(suffix);
    const decisionId = `decision_failure_${suffix}`;
    const constraint = `decision_metadata_failure_${suffix}`;
    const decisionJson = JSON.stringify([decisionId]);
    await adminPool.query(
      `ALTER TABLE "${TEST_SCHEMA}"."execution_pauses" ADD CONSTRAINT "${constraint}" CHECK (NOT (decision_ids_json::jsonb @> '${decisionJson}'::jsonb))`,
    );
    try {
      await expect(
        store.appendDecision(makeDecision({ decisionId, pauseId: pause.pauseId, planHash: plan.planHash })),
      ).rejects.toMatchObject({ code: "store_write_failed" });

      const pauseRow = await adminPool.query(
        `SELECT decision_ids_json FROM "${TEST_SCHEMA}"."execution_pauses" WHERE pause_id=$1`,
        [pause.pauseId],
      );
      const decisionRows = await adminPool.query(
        `SELECT decision_id FROM "${TEST_SCHEMA}"."pause_decisions" WHERE decision_id=$1`,
        [decisionId],
      );
      expect(pauseRow.rows[0]?.decision_ids_json).toBe("[]");
      expect(decisionRows.rowCount).toBe(0);
      expect(await store.getDecisions(pause.pauseId)).toEqual([]);
      expect((await store.getPause(pause.pauseId))?.decisionIds).toEqual([]);
    } finally {
      await adminPool.query(`ALTER TABLE "${TEST_SCHEMA}"."execution_pauses" DROP CONSTRAINT "${constraint}"`);
    }
  });

  it("database replay guard gives exactly one winner for concurrent RELEASE appends", async () => {
    const { pause, plan } = await createPauseFixture(uniqueSuffix());
    const contenders = await Promise.all(
      Array.from({ length: 6 }, () => createStore({ max: 2, skipMigration: true })),
    );
    try {
      const results = await Promise.allSettled(
        contenders.map((candidate, index) =>
          candidate.appendDecision(
            makeDecision({
              decisionId: `decision_release_${uniqueSuffix()}_${index}`,
              pauseId: pause.pauseId,
              planHash: plan.planHash,
              kind: "RELEASE",
              createdAt: 1_789_000_020 + index,
            }),
          ),
        ),
      );
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(5);
      for (const result of results.filter((candidate) => candidate.status === "rejected")) {
        expect((result as PromiseRejectedResult).reason).toMatchObject({ code: "ERR-115" });
      }
      const decisions = await store.getDecisions(pause.pauseId);
      expect(decisions).toHaveLength(1);
      expect((await store.getPause(pause.pauseId))?.decisionIds).toEqual([decisions[0].decisionId]);
    } finally {
      await Promise.all(contenders.map((candidate) => candidate.close()));
    }
  });

  it("pause version CAS has exactly one concurrent winner", async () => {
    const { pause } = await createPauseFixture(uniqueSuffix());
    const next = toVerifying(pause, 1_789_000_010, 0);
    const contenders = await Promise.all(
      Array.from({ length: 6 }, () => createStore({ max: 2, skipMigration: true })),
    );
    try {
      const results = await Promise.allSettled(contenders.map((candidate) => candidate.updatePause(next, 0)));
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(5);
      for (const result of results.filter((candidate) => candidate.status === "rejected")) {
        expect((result as PromiseRejectedResult).reason).toMatchObject({ code: "ERR-111" });
      }
      const final = await store.getPause(pause.pauseId);
      expect(final?.state).toBe("VERIFYING");
      expect(final?.version).toBe(1);
    } finally {
      await Promise.all(contenders.map((candidate) => candidate.close()));
    }
  });

  it("fails closed against an unreachable endpoint", async () => {
    await expect(
      PostgresPauseStore.create({ connectionString: "postgresql://nobody:***@127.0.0.1:1/prism_none", connectionTimeoutMillis: 1200 }),
    ).rejects.toMatchObject({ code: "store_connect_failed" });
  });
});
