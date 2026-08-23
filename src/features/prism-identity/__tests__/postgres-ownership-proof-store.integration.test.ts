// LIVE PostgreSQL integration tier for the OwnershipProofStore adapter.
//
// GATED: runs ONLY when PRISM_POSTGRES_TEST_URL is set to a reachable
// PostgreSQL connection string. When absent, the suite reports SKIPPED —
// never passed. There is no pg-mem / fake fallback: a skipped integration
// tier is an explicit NOT RUN evidence state.
//
// Proves on a real server: migration, duplicate rejection, concurrent nonce
// race across independent pool connections (multi-instance simulation),
// guarded transition race, restart/reopen durability, and fail-closed
// behavior against a dead endpoint.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  PostgresOwnershipProofStore,
  PostgresOwnershipProofStoreError,
} from "../adapters/postgres-ownership-proof-store";
import type { StoredOwnershipChallenge } from "../domain/ports";
import type { Hex } from "../domain/hex";

const TEST_URL = process.env.PRISM_POSTGRES_TEST_URL;
const suite = TEST_URL ? describe : describe.skip;

function makeRecord(suffix: string, overrides: Partial<StoredOwnershipChallenge> = {}): StoredOwnershipChallenge {
  return {
    schemaVersion: 1,
    domain: "prism.example",
    venue: "BASE",
    executionAccount: `0xabc00000000000000000000000000000000000${suffix}` as Hex,
    prismId: `prism:P7F21-${suffix}`,
    challengeId: (`0xdef1${suffix}000000000000000000000000000000000000000000000000000000`) as Hex,
    nonce: (`0xfeed${suffix}000000000000000000000000000000000000000000000000000000`) as Hex,
    issuedAt: 1_789_000_000,
    expiresAt: 1_789_000_600,
    digest: (`0xdead${suffix}000000000000000000000000000000000000000000000000000000`) as Hex,
    state: "ISSUED",
    nonceState: "UNUSED",
    ...overrides,
  };
}

let store: PostgresOwnershipProofStore;

beforeAll(async () => {
  store = await PostgresOwnershipProofStore.create({
    connectionString: TEST_URL,
    max: 10,
  });
});

afterAll(async () => {
  await store.close();
});

suite("PostgresOwnershipProofStore (LIVE integration, INV-SYS-010)", () => {
  it("migrates idempotently and round-trips a record with evidence fields", async () => {
    const record = makeRecord("aa", {
      verifiedSignatureClass: "EOA",
      verifiedAt: 1_789_000_100,
      rejection: { code: "ERR-021", detail: "probe" },
    });
    await store.putIssued(record);
    const back = await store.getById(record.challengeId);
    expect(back).toEqual(record);
  });

  it("rejects duplicate challengeId with a stable adapter error", async () => {
    const record = makeRecord("bb");
    await store.putIssued(record);
    await expect(store.putIssued({ ...record })).rejects.toMatchObject({
      name: "PostgresOwnershipProofStoreError",
      code: "duplicate_challenge_id",
    });
  });

  it("nonce race across independent pools: exactly one winner", async () => {
    const record = makeRecord("cc");
    await store.putIssued(record);
    // Independent pools simulate separate instances/processes.
    const contenders = await Promise.all(
      Array.from({ length: 8 }, () =>
        PostgresOwnershipProofStore.create({ connectionString: TEST_URL, max: 2 }),
      ),
    );
    try {
      const results = await Promise.all(contenders.map((c) => c.consumeNonce(record.challengeId)));
      expect(results.filter((r) => r === "consumed")).toHaveLength(1);
      expect(results.filter((r) => r === "already_consumed")).toHaveLength(7);
    } finally {
      await Promise.all(contenders.map((c) => c.close()));
    }
  });

  it("guarded transition race: exactly one winner, evidence preserved", async () => {
    const record = makeRecord("dd");
    await store.putIssued(record);
    const contenders = await Promise.all(
      Array.from({ length: 6 }, () =>
        PostgresOwnershipProofStore.create({ connectionString: TEST_URL, max: 2 }),
      ),
    );
    try {
      const results = await Promise.all(
        contenders.map((c, i) =>
          c.transitionState(record.challengeId, "ISSUED", "VERIFIED", {
            verifiedSignatureClass: "EOA",
            verifiedAt: 1_789_000_100 + i,
          }),
        ),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      const final = await store.getById(record.challengeId);
      expect(final!.state).toBe("VERIFIED");
      expect(final!.verifiedAt).toBeDefined();
    } finally {
      await Promise.all(contenders.map((c) => c.close()));
    }
  });

  it("restart/reopen durability: nonce stays consumed, evidence survives", async () => {
    const record = makeRecord("ee");
    await store.putIssued(record);
    expect(await store.consumeNonce(record.challengeId)).toBe("consumed");
    await store.transitionState(record.challengeId, "ISSUED", "VERIFIED", {
      verifiedSignatureClass: "EIP1271",
      verifiedAt: 1_789_000_200,
    });
    // Full close + fresh pool = process restart.
    await store.close();
    const reopened = await PostgresOwnershipProofStore.create({ connectionString: TEST_URL });
    try {
      const back = await reopened.getById(record.challengeId);
      expect(back).toMatchObject({
        state: "VERIFIED",
        nonceState: "CONSUMED",
        verifiedSignatureClass: "EIP1271",
        verifiedAt: 1_789_000_200,
      });
      // Replay after restart is still blocked.
      expect(await reopened.consumeNonce(record.challengeId)).toBe("already_consumed");
      // Downgrade CAS refused.
      expect(await reopened.transitionState(record.challengeId, "ISSUED", "REJECTED", {})).toBe(false);
    } finally {
      await reopened.close();
      // Restore a pool for afterAll.
      store = await PostgresOwnershipProofStore.create({ connectionString: TEST_URL });
    }
  });

  it("fails closed against an unreachable endpoint", async () => {
    await expect(
      PostgresOwnershipProofStore.create({
        connectionString: "postgresql://nobody:nothing@127.0.0.1:1/prism_none",
        connectionTimeoutMillis: 1500,
      }),
    ).rejects.toMatchObject({
      name: "PostgresOwnershipProofStoreError",
      code: "store_connect_failed",
    });
  });
});
