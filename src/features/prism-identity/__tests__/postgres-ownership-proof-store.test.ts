// Unit / SQL-contract tests for the PostgreSQL OwnershipProofStore adapter.
//
// These run WITHOUT a live PostgreSQL server. They pin:
// - exact parameterized SQL issued for each operation (no string interpolation
//   of values anywhere);
// - row <-> record mapping (snake_case columns, bigint-as-string tolerance,
//   optional-field preservation);
// - duplicate rejection classification (23505 -> `duplicate_challenge_id`);
// - conditional CAS SQL shape (consumeNonce, guarded transitionState) and
//   patch-field-only SET lists;
// - fail-closed error codes for connect/write/read failures;
// - pool shutdown and closed-store refusal.
//
// The live-server integration tier is a separate file gated on
// PRISM_POSTGRES_TEST_URL (see postgres-ownership-proof-store.integration.test.ts).

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { QueryResult } from "pg";
import {
  OWNERSHIP_STORE_MIGRATION_SQL,
  PostgresOwnershipProofStore,
  PostgresOwnershipProofStoreError,
} from "../adapters/postgres-ownership-proof-store";
import type { StoredOwnershipChallenge } from "../domain/ports";
import type { Hex } from "../domain/hex";

type CapturedQuery = { text: string; values?: unknown[] };

function makeRecord(overrides: Partial<StoredOwnershipChallenge> = {}): StoredOwnershipChallenge {
  return {
    schemaVersion: 2,
    chainId: 84532,
    domain: "prism.example",
    venue: "BASE",
    executionAccount: "0xabc0000000000000000000000000000000000001" as Hex,
    prismId: "prism:P7F21",
    challengeId: "0xdef1000000000000000000000000000000000000000000000000000000000001" as Hex,
    nonce: "0xfeed000000000000000000000000000000000000000000000000000000000001" as Hex,
    issuedAt: 1_789_000_000,
    expiresAt: 1_789_000_600,
    digest: "0xdead000000000000000000000000000000000000000000000000000000000001" as Hex,
    state: "ISSUED",
    nonceState: "UNUSED",
    ...overrides,
  };
}

class FakePool {
  static queries: CapturedQuery[] = [];
  static endCount = 0;
  static resultFactory?: (text: string) => Promise<Partial<QueryResult>>;
  static reset() {
    FakePool.queries = [];
    FakePool.endCount = 0;
    FakePool.resultFactory = undefined;
  }
  constructor(_config?: unknown) {}
  async query(text: string, values?: unknown[]) {
    FakePool.queries.push({ text, values });
    if (FakePool.resultFactory) return FakePool.resultFactory(text);
    return { rowCount: 0, rows: [] } as Partial<QueryResult>;
  }
  async connect() {
    throw new Error("connect not expected in unit tier");
  }
  async end() {
    FakePool.endCount += 1;
  }
}

function installFakePool(overrides: {
  queryResult?: Partial<QueryResult>;
  queryImpl?: (text: string, values?: unknown[]) => Promise<Partial<QueryResult>>;
} = {}) {
  FakePool.reset();
  if (overrides.queryImpl) {
    FakePool.resultFactory = (text) => overrides.queryImpl!(text, undefined);
  } else if (overrides.queryResult) {
    const base = overrides.queryResult;
    FakePool.resultFactory = async () => ({
      rowCount: base.rowCount ?? (base.rows ?? []).length,
      rows: (base.rows ?? []) as never[],
    }) as Partial<QueryResult>;
  }
  vi.doMock("pg", () => ({ Pool: FakePool }));
  return FakePool;
}

let restoreEnv: Array<[string, string | undefined]> = [];

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  for (const [key, value] of restoreEnv.splice(0)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function loadStoreModule() {
  return await import("../adapters/postgres-ownership-proof-store");
}

describe("PostgresOwnershipProofStore (unit/SQL contract)", () => {
  it("putIssued issues fully parameterized INSERT with all 16 typed fields", async () => {
    const fake = installFakePool();
    const { PostgresOwnershipProofStore: Store } = await loadStoreModule();
    const store = new Store({ connectionString: "postgres://u:p@db:5432/prism" });
    await store.putIssued(makeRecord());
    expect(fake.queries).toHaveLength(1);
    const q = fake.queries[0];
    expect(q.text).toContain("INSERT INTO ownership_challenges");
    expect(q.text).not.toContain("0xdef1"); // no literal values in SQL text
    expect(q.values).toEqual([
      2,
      84532,
      "0xdef1000000000000000000000000000000000000000000000000000000000001",
      "0xfeed000000000000000000000000000000000000000000000000000000000001",
      "prism.example",
      "BASE",
      "0xabc0000000000000000000000000000000000001",
      "prism:P7F21",
      1_789_000_000,
      1_789_000_600,
      "0xdead000000000000000000000000000000000000000000000000000000000001",
      "ISSUED",
      "UNUSED",
      null,
      null,
      null,
    ]);
  });

  it("putIssued serializes an optional rejection patch", async () => {
    const fake = installFakePool();
    const { PostgresOwnershipProofStore: Store } = await loadStoreModule();
    const store = new Store({});
    await store.putIssued(
      makeRecord({
        verifiedSignatureClass: "EIP1271",
        verifiedAt: 42,
        rejection: { code: "ERR-021", detail: "undetermined" },
      }),
    );
    expect(fake.queries[0].values!.slice(-3)).toEqual(["EIP1271", 42, JSON.stringify({ code: "ERR-021", detail: "undetermined" })]);
  });

  it("classifies unique violation (23505 on pkey) as duplicate_challenge_id", async () => {
    installFakePool({
      queryImpl: async () => {
        const e = new Error("duplicate key") as Error & { code?: string; constraint?: string; detail?: string };
        e.code = "23505";
        e.constraint = "ownership_challenges_pkey";
        e.detail = "Key (challenge_id)=(0xdef1...) already exists.";
        throw e;
      },
    });
    const { PostgresOwnershipProofStore: Store } = await loadStoreModule();
    const store = new Store({});
    await expect(store.putIssued(makeRecord())).rejects.toMatchObject({
      name: "PostgresOwnershipProofStoreError",
      code: "duplicate_challenge_id",
    });
  });

  it("does not misclassify unique violations on other constraints", async () => {
    installFakePool({
      queryImpl: async () => {
        const e = new Error("dup") as Error & { code?: string; constraint?: string };
        e.code = "23505";
        e.constraint = "some_other_index";
        throw e;
      },
    });
    const { PostgresOwnershipProofStore: Store } = await loadStoreModule();
    const store = new Store({});
    await expect(store.putIssued(makeRecord())).rejects.toMatchObject({ code: "store_write_failed" });
  });

  it("getById maps snake_case row to owned record, tolerating bigint strings", async () => {
    installFakePool({
      queryImpl: async () => ({
        rowCount: 1,
        rows: [
          {
            schema_version: 2, chain_id: 84532,
            challenge_id: "0xdef1",
            nonce: "0xfeed",
            domain: "prism.example",
            venue: "BASE",
            execution_account: "0xabc1",
            prism_id: "prism:P7F21",
            issued_at: "1789000000", // pg returns BIGINT as string
            expires_at: "1789000600",
            digest: "0xdead",
            state: "ISSUED",
            nonce_state: "CONSUMED",
            verified_signature_class: "EOA",
            verified_at: null,
            rejection_json: null,
          },
        ],
      }) as unknown as Partial<QueryResult>,
    });
    const { PostgresOwnershipProofStore: Store } = await loadStoreModule();
    const store = new Store({});
    const rec = await store.getById("0xdef1" as Hex);
    expect(rec).toEqual({
      schemaVersion: 2,
      chainId: 84532,
      challengeId: "0xdef1",
      nonce: "0xfeed",
      domain: "prism.example",
      venue: "BASE",
      executionAccount: "0xabc1",
      prismId: "prism:P7F21",
      issuedAt: 1_789_000_000,
      expiresAt: 1_789_000_600,
      digest: "0xdead",
      state: "ISSUED",
      nonceState: "CONSUMED",
      verifiedSignatureClass: "EOA",
    });
    // Absent optionals stay absent.
    expect("verifiedAt" in rec!).toBe(false);
    expect("rejection" in rec!).toBe(false);
  });

  it("getById returns undefined when no row and parameterizes the lookup", async () => {
    const fake = installFakePool({ queryResult: { rowCount: 0, rows: [] } });
    const { PostgresOwnershipProofStore: Store } = await loadStoreModule();
    const store = new Store({});
    expect(await store.getById("0x404" as Hex)).toBeUndefined();
    expect(fake.queries[0].values).toEqual(["0x404"]);
  });

  it("corrupt rejection_json fails closed with store_read_failed", async () => {
    installFakePool({
      queryImpl: async () => ({
        rowCount: 1,
        rows: [
          {
            schema_version: 2, chain_id: 84532, challenge_id: "c", nonce: "n", domain: "d", venue: "V",
            execution_account: "0xa", prism_id: "p", issued_at: 1, expires_at: 2,
            digest: "g", state: "REJECTED", nonce_state: "CONSUMED",
            verified_signature_class: null, verified_at: null, rejection_json: "{not-json",
          },
        ],
      }) as unknown as Partial<QueryResult>,
    });
    const { PostgresOwnershipProofStore: Store } = await loadStoreModule();
    const store = new Store({});
    await expect(store.getById("c" as Hex)).rejects.toMatchObject({ code: "store_read_failed" });
  });

  it("consumeNonce uses one conditional UPDATE on nonce_state='UNUSED'", async () => {
    const fake = installFakePool({ queryResult: { rowCount: 1, rows: [] } });
    const { PostgresOwnershipProofStore: Store } = await loadStoreModule();
    const store = new Store({});
    expect(await store.consumeNonce("0xc1" as Hex)).toBe("consumed");
    expect(fake.queries[0].text).toBe(
      "UPDATE ownership_challenges SET nonce_state = 'CONSUMED' WHERE challenge_id = $1 AND nonce_state = 'UNUSED'",
    );
    expect(fake.queries[0].values).toEqual(["0xc1"]);
  });

  it("consumeNonce classifies zero-row update as already_consumed via lookup", async () => {
    const fake = installFakePool({
      queryImpl: async (text) =>
        text.startsWith("UPDATE")
          ? ({ rowCount: 0, rows: [] } as Partial<QueryResult>)
          : ({ rowCount: 1, rows: [{ nonce_state: "CONSUMED" }] } as unknown as Partial<QueryResult>),
    });
    const { PostgresOwnershipProofStore: Store } = await loadStoreModule();
    const store = new Store({});
    expect(await store.consumeNonce("0xc1" as Hex)).toBe("already_consumed");
    // Second statement is the parameterized follow-up SELECT.
    expect(fake.queries[1].text).toBe(
      "SELECT nonce_state FROM ownership_challenges WHERE challenge_id = $1",
    );
  });

  it("consumeNonce returns unknown when the challenge does not exist", async () => {
    installFakePool({
      queryImpl: async (text) =>
        text.startsWith("UPDATE")
          ? ({ rowCount: 0, rows: [] } as Partial<QueryResult>)
          : ({ rowCount: 0, rows: [] } as Partial<QueryResult>),
    });
    const { PostgresOwnershipProofStore: Store } = await loadStoreModule();
    const store = new Store({});
    expect(await store.consumeNonce("0x404" as Hex)).toBe("unknown");
  });

  it("transitionState writes only present patch fields and pins from-state", async () => {
    const fake = installFakePool({ queryResult: { rowCount: 1, rows: [] } });
    const { PostgresOwnershipProofStore: Store } = await loadStoreModule();
    const store = new Store({});
    const ok = await store.transitionState("0xc1" as Hex, "ISSUED", "VERIFIED", {
      verifiedSignatureClass: "ERC6492",
      verifiedAt: 7,
    });
    expect(ok).toBe(true);
    const text = fake.queries[0].text;
    expect(text).toContain("state = $2");
    expect(text).toContain("verified_signature_class = $3");
    expect(text).toContain("verified_at = $4");
    expect(text).not.toContain("rejection_json");
    expect(text).toContain("AND state = $5");
    expect(fake.queries[0].values).toEqual(["0xc1", "VERIFIED", "ERC6492", 7, "ISSUED"]);
  });

  it("transitionState with empty patch changes state only (preservation)", async () => {
    const fake = installFakePool({ queryResult: { rowCount: 0, rows: [] } });
    const { PostgresOwnershipProofStore: Store } = await loadStoreModule();
    const store = new Store({});
    expect(await store.transitionState("0xc1" as Hex, "ISSUED", "VERIFIED", {})).toBe(false);
    expect(fake.queries[0].text.replace(/\s+/g, " ")).toBe(
      "UPDATE ownership_challenges SET state = $2 WHERE challenge_id = $1 AND state = $3",
    );
  });

  it("transitionState can explicitly clear rejection with NULL", async () => {
    const fake = installFakePool({ queryResult: { rowCount: 1, rows: [] } });
    const { PostgresOwnershipProofStore: Store } = await loadStoreModule();
    const store = new Store({});
    await store.transitionState("0xc1" as Hex, "REJECTED", "EXPIRED", { rejection: undefined });
    expect(fake.queries[0].text).toContain("rejection_json = $3");
    expect(fake.queries[0].values![2]).toBeNull();
  });

  it("rejects invalid states before touching the database", async () => {
    const fake = installFakePool();
    const { PostgresOwnershipProofStore: Store } = await loadStoreModule();
    const store = new Store({});
    await expect(
      store.transitionState("0xc1" as Hex, "NOPE" as never, "VERIFIED", {}),
    ).rejects.toMatchObject({ code: "invalid_record" });
    await expect(store.putIssued(makeRecord({ state: "BOGUS" as never }))).rejects.toMatchObject({
      code: "invalid_record",
    });
    expect(fake.queries).toHaveLength(0);
  });

  it("driver write failures fail closed with stable codes", async () => {
    installFakePool({
      queryImpl: async (text) => {
        if (text.startsWith("SELECT")) throw new Error("connection terminated");
        throw new Error("connection terminated");
      },
    });
    const { PostgresOwnershipProofStore: Store } = await loadStoreModule();
    const store = new Store({});
    await expect(store.consumeNonce("0xc1" as Hex)).rejects.toMatchObject({ code: "store_write_failed" });
    await expect(store.transitionState("0xc1" as Hex, "ISSUED", "VERIFIED", {})).rejects.toMatchObject({
      code: "store_write_failed",
    });
  });

  it("close ends the pool; operations after close are refused", async () => {
    const Fake = installFakePool();
    const { PostgresOwnershipProofStore: Store } = await loadStoreModule();
    const store = new Store({});
    await store.close();
    expect(Fake.endCount).toBe(1);
    await store.close(); // idempotent — second close must not re-end
    expect(Fake.endCount).toBe(1);
    await expect(store.getById("0xc1" as Hex)).rejects.toMatchObject({
      name: "PostgresOwnershipProofStoreError",
      code: "store_connect_failed",
    });
  });

  it("exposes versioned migration SQL with typed state/nonce checks", () => {
    expect(OWNERSHIP_STORE_MIGRATION_SQL).toContain("challenge_id TEXT PRIMARY KEY");
    expect(OWNERSHIP_STORE_MIGRATION_SQL).toContain("nonce_state TEXT NOT NULL CHECK (nonce_state IN ('UNUSED','CONSUMED'))");
    expect(OWNERSHIP_STORE_MIGRATION_SQL).toContain("state TEXT NOT NULL CHECK (state IN ('ISSUED','VERIFIED','REJECTED','EXPIRED'))");
    expect(OWNERSHIP_STORE_MIGRATION_SQL).toContain("expires_at BIGINT NOT NULL");
  });
});
