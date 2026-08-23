// T7 DB-integration tests — durable SQLite OwnershipProofStore adapter.
// Proves INV-SYS-010 enforcement on a real ACID store: duplicate challenge
// rejection, concurrent nonce race (exactly one winner), guarded transition
// race, close/reopen durability, and expiry/state preservation.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SqliteOwnershipProofStore,
  SqliteOwnershipProofStoreError,
} from "../adapters/sqlite-ownership-proof-store";
import type {
  ChallengeState,
  StoredOwnershipChallenge,
} from "../domain/ports";
import type { Hex } from "../domain/hex";

const dirsToClean: string[] = [];
afterEach(() => {
  for (const dir of dirsToClean.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeTempStore(): { store: SqliteOwnershipProofStore; filePath: string } {
  const dir = mkdtempSync(join(tmpdir(), "prism-t7-"));
  dirsToClean.push(dir);
  const filePath = join(dir, "ownership.db");
  return { store: new SqliteOwnershipProofStore({ filePath }), filePath };
}

function makeRecord(overrides: Partial<StoredOwnershipChallenge> = {}): StoredOwnershipChallenge {
  return {
    schemaVersion: 1,
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

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("SqliteOwnershipProofStore (T7, INV-SYS-010)", () => {
  it("rejects a duplicate challengeId with a stable adapter error", async () => {
    const { store } = makeTempStore();
    const record = makeRecord();
    await store.putIssued(record);
    await expect(store.putIssued({ ...record })).rejects.toMatchObject({
      name: "SqliteOwnershipProofStoreError",
      code: "duplicate_challenge_id",
    });
  });

  it("returns owned copies from getById", async () => {
    const { store } = makeTempStore();
    await store.putIssued(makeRecord());
    const a = await store.getById(makeRecord().challengeId);
    const b = await store.getById(makeRecord().challengeId);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    // In-place mutation must not corrupt durable state.
    a!.state = "VERIFIED";
    expect((await store.getById(makeRecord().challengeId))!.state).toBe("ISSUED");
  });

  it("consumes the nonce exactly once under concurrent callers", async () => {
    const { store } = makeTempStore();
    const record = makeRecord();
    await store.putIssued(record);

    // Interleave macrotask yields like the in-memory concurrency tests so
    // callers genuinely overlap rather than run strictly sequentially.
    const callers = Array.from({ length: 8 }, async (_, i) => {
      if (i % 2 === 0) await yieldToEventLoop();
      return store.consumeNonce(record.challengeId);
    });
    const results = await Promise.all(callers);

    expect(results.filter((r) => r === "consumed")).toHaveLength(1);
    const consumed = results.filter((r) => r === "already_consumed");
    expect(consumed.length + results.filter((r) => r === "unknown").length).toBe(7);
    expect(results).not.toContain(undefined);
    expect((await store.getById(record.challengeId))!.nonceState).toBe("CONSUMED");

    // Late sequential caller is also rejected.
    await expect(store.consumeNonce(record.challengeId)).resolves.toBe("already_consumed");
  });

  it("reports unknown for a missing challenge", async () => {
    const { store } = makeTempStore();
    await expect(
      store.consumeNonce("0x1111111111111111111111111111111111111111111111111111111111111111" as Hex),
    ).resolves.toBe("unknown");
  });

  it("allows only one guarded state transition winner under concurrency", async () => {
    const { store } = makeTempStore();
    const record = makeRecord();
    await store.putIssued(record);

    const attempts = Array.from({ length: 6 }, () =>
      store.transitionState(record.challengeId, "ISSUED", "VERIFIED", {
        verifiedSignatureClass: "EOA",
        verifiedAt: record.issuedAt + 5,
      }),
    );
    const results = await Promise.all(attempts);
    expect(results.filter(Boolean)).toHaveLength(1);
    const stored = await store.getById(record.challengeId);
    expect(stored!.state).toBe("VERIFIED");
    expect(stored!.verifiedSignatureClass).toBe("EOA");
    expect(stored!.verifiedAt).toBe(record.issuedAt + 5);
  });

  it("rejects a transition whose expected current state does not match", async () => {
    const { store } = makeTempStore();
    await store.putIssued(makeRecord());
    const moved = await store.transitionState(
      "0xdef1000000000000000000000000000000000000000000000000000000000001" as Hex,
      "EXPIRED" as ChallengeState,
      "REJECTED",
      { rejection: { code: "ERR-013" } },
    );
    expect(moved).toBe(false);
  });

  it("preserves signature class, verifiedAt, rejection, expiry and nonce state across close/reopen", async () => {
    const { store, filePath } = makeTempStore();
    const record = makeRecord();
    await store.putIssued(record);
    await store.consumeNonce(record.challengeId);
    await store.transitionState(record.challengeId, "ISSUED", "REJECTED", {
      rejection: { code: "ERR-003", detail: "wrong signer" },
    });

    store.close();
    const reopened = new SqliteOwnershipProofStore({ filePath });
    const stored = await reopened.getById(record.challengeId);
    expect(stored).toMatchObject({
      schemaVersion: 1,
      domain: record.domain,
      venue: record.venue,
      executionAccount: record.executionAccount,
      prismId: record.prismId,
      expiresAt: record.expiresAt,
      digest: record.digest,
      state: "REJECTED",
      nonceState: "CONSUMED",
      rejection: { code: "ERR-003", detail: "wrong signer" },
    });
    // A rejected record's nonce stays consumed across reopen — no replay path.
    await expect(reopened.consumeNonce(record.challengeId)).resolves.toBe("already_consumed");
    reopened.close();
  });

  it("preserves VERIFIED evidence fields across reopen and refuses downgrade transitions", async () => {
    const { store, filePath } = makeTempStore();
    const record = makeRecord();
    await store.putIssued(record);
    await store.transitionState(record.challengeId, "ISSUED", "VERIFIED", {
      verifiedSignatureClass: "EIP1271",
      verifiedAt: record.issuedAt + 42,
    });
    store.close();

    const reopened = new SqliteOwnershipProofStore({ filePath });
    const stored = await reopened.getById(record.challengeId);
    expect(stored).toMatchObject({
      state: "VERIFIED",
      verifiedSignatureClass: "EIP1271",
      verifiedAt: record.issuedAt + 42,
      nonceState: "UNUSED",
    });
    // Guarded CAS: no ISSUED→ anything downgrade after terminal state.
    await expect(
      reopened.transitionState(record.challengeId, "ISSUED", "REJECTED", {}),
    ).resolves.toBe(false);
    reopened.close();
  });

  it("preserves an expired challenge's expiry boundary across reopen", async () => {
    const { store, filePath } = makeTempStore();
    const record = makeRecord({ state: "EXPIRED" });
    await store.putIssued(record);
    store.close();

    const reopened = new SqliteOwnershipProofStore({ filePath });
    const stored = await reopened.getById(record.challengeId);
    expect(stored!.state).toBe("EXPIRED");
    expect(stored!.expiresAt).toBe(record.expiresAt);
    reopened.close();
  });

  it("fails closed with a stable error when the file cannot be opened", () => {
    expect(
      () => new SqliteOwnershipProofStore({ filePath: "/nonexistent-dir-prism/ownership.db" }),
    ).toThrowError(SqliteOwnershipProofStoreError);
    try {
      new SqliteOwnershipProofStore({ filePath: "/nonexistent-dir-prism/ownership.db" });
    } catch (error) {
      expect((error as SqliteOwnershipProofStoreError).code).toBe("store_open_failed");
    }
  });
});
