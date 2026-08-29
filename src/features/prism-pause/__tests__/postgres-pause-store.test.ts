import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryResult } from "pg";
import type { PauseDecision } from "../ports/pause-store";
import { createPause } from "../domain/pause";

interface CapturedQuery {
  text: string;
  values?: unknown[];
}

interface QueuedQuery {
  error?: unknown;
  result?: Partial<QueryResult>;
}

class FakeClient {
  readonly queries: CapturedQuery[] = [];
  readonly queue: QueuedQuery[] = [];
  released = false;

  async query(text: string, values?: unknown[]) {
    this.queries.push({ text, values });
    const next = this.queue.shift();
    if (!next) return { rowCount: 0, rows: [] } as unknown as QueryResult;
    if (next.error) throw next.error;
    return (next.result ?? { rowCount: 0, rows: [] }) as QueryResult;
  }

  release() {
    this.released = true;
  }
}

class FakePool {
  static client: FakeClient;
  static endCount = 0;
  static poolQueries: CapturedQuery[] = [];

  constructor(_config?: unknown) {
    FakePool.client = new FakeClient();
  }

  async query(text: string, values?: unknown[]) {
    FakePool.poolQueries.push({ text, values });
    return { rowCount: 0, rows: [] } as unknown as QueryResult;
  }

  async connect() {
    return FakePool.client;
  }

  async end() {
    FakePool.endCount += 1;
  }
}

function installFakePool() {
  FakePool.endCount = 0;
  FakePool.poolQueries = [];
  vi.doMock("pg", () => ({ Pool: FakePool }));
  return FakePool;
}

beforeEach(() => {
  vi.resetModules();
});

async function loadStoreModule() {
  return await import("../adapters/postgres-pause-store");
}

const PLAN_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

function decision(overrides: Partial<PauseDecision> = {}): PauseDecision {
  return {
    decisionId: "decision-1",
    pauseId: "pause-1",
    kind: "CANCEL",
    actor: "user",
    policyVersion: "v1",
    planHash: PLAN_HASH,
    approvalScopeHash: null,
    reasonCodes: ["test"],
    createdAt: 100,
    expiresAt: null,
    ...overrides,
  };
}

function result(rowCount = 0, rows: unknown[] = []): QueuedQuery {
  return { result: { rowCount, rows } as unknown as Partial<QueryResult> };
}

describe("PostgresPauseStore (unit/transaction contract)", () => {
  it("commits a CAS state mutation and its correlated audit decision on one client", async () => {
    const fake = installFakePool();
    const { PostgresPauseStore } = await loadStoreModule();
    const store = new PostgresPauseStore({});
    const client = fake.client;
    const pause = createPause({ pauseId: "pause-1", intentId: "intent-1", planHash: PLAN_HASH, policyVersion: "v1", createdAt: 1, expiresAt: 100 });
    const next = { ...pause, state: "CANCELLED" as const, version: 1 };
    client.queue.push(result(), result(1), result(1), result(), result(), result(1), result());

    await expect(store.withTransaction!(async (transaction) => {
      const persisted = await transaction.updatePause(next, 0);
      await transaction.appendDecision(decision());
      return persisted;
    })).resolves.toMatchObject({ state: "CANCELLED", version: 1 });

    expect(client.queries.map((query) => query.text)).toEqual([
      "BEGIN",
      expect.stringContaining("UPDATE execution_pauses"),
      expect.stringContaining("SELECT pause_id, plan_hash, policy_version FROM execution_pauses"),
      expect.stringContaining("SELECT decision_id FROM pause_decisions"),
      expect.stringContaining("INSERT INTO pause_decisions"),
      expect.stringContaining("UPDATE execution_pauses"),
      "COMMIT",
    ]);
    expect(client.queries.map((query) => query.text)).not.toContain("ROLLBACK");
    expect(client.released).toBe(true);
  });

  it("appends the decision and metadata mirror in one client transaction", async () => {
    const fake = installFakePool();
    const { PostgresPauseStore } = await loadStoreModule();
    const store = new PostgresPauseStore({ connectionString: "postgres://u:***@db:5432/prism" });
    const client = fake.client;
    client.queue.push(result(), result(1), result(), result(1), result(1), result());

    const record = decision();
    await expect(store.appendDecision(record)).resolves.toEqual(record);

    expect(client.queries.map((query) => query.text)).toEqual([
      "BEGIN",
      expect.stringContaining("SELECT pause_id, plan_hash, policy_version FROM execution_pauses"),
      expect.stringContaining("SELECT decision_id FROM pause_decisions"),
      expect.stringContaining("INSERT INTO pause_decisions"),
      expect.stringContaining("UPDATE execution_pauses"),
      "COMMIT",
    ]);
    const metadataUpdate = client.queries[4];
    expect(metadataUpdate.text).toContain("jsonb_build_array");
    expect(metadataUpdate.text).toContain("WHERE pause_id=$1");
    expect(metadataUpdate.values).toEqual([record.pauseId, record.decisionId]);
    expect(client.queries.map((query) => query.text)).not.toContain("ROLLBACK");
    expect(client.released).toBe(true);
  });

  it("rolls back the decision row when the metadata mirror fails", async () => {
    const fake = installFakePool();
    const { PostgresPauseStore } = await loadStoreModule();
    const store = new PostgresPauseStore({});
    const client = fake.client;
    const metadataFailure = Object.assign(new Error("metadata constraint failed"), { code: "23514" });
    client.queue.push(result(), result(1), result(), result(1), { error: metadataFailure }, result());

    await expect(store.appendDecision(decision())).rejects.toMatchObject({
      name: "PostgresPauseStoreError",
      code: "store_write_failed",
    });

    expect(client.queries.map((query) => query.text)).toEqual([
      "BEGIN",
      expect.stringContaining("SELECT pause_id, plan_hash, policy_version FROM execution_pauses"),
      expect.stringContaining("SELECT decision_id FROM pause_decisions"),
      expect.stringContaining("INSERT INTO pause_decisions"),
      expect.stringContaining("UPDATE execution_pauses"),
      "ROLLBACK",
    ]);
    expect(client.queries.map((query) => query.text)).not.toContain("COMMIT");
    expect(client.released).toBe(true);
  });

  it("fails closed and rolls back when the metadata update affects no pause row", async () => {
    const fake = installFakePool();
    const { PostgresPauseStore } = await loadStoreModule();
    const store = new PostgresPauseStore({});
    const client = fake.client;
    client.queue.push(result(), result(1), result(), result(1), result(0), result());

    await expect(store.appendDecision(decision())).rejects.toMatchObject({
      name: "PostgresPauseStoreError",
      code: "store_write_failed",
    });

    expect(client.queries.at(-1)?.text).toBe("ROLLBACK");
    expect(client.queries.map((query) => query.text)).not.toContain("COMMIT");
  });

  it("migrates a database-level replay guard for RELEASE and APPROVE decisions", async () => {
    installFakePool();
    const { PAUSE_STORE_MIGRATION_SQL } = await loadStoreModule();

    expect(PAUSE_STORE_MIGRATION_SQL).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_pause_decisions_approval_replay");
    expect(PAUSE_STORE_MIGRATION_SQL).toContain("DROP INDEX IF EXISTS idx_pause_decisions_approval_replay");
    expect(PAUSE_STORE_MIGRATION_SQL).toContain("WHERE kind IN ('RELEASE','APPROVE','CONFIRM')");
  });
});
