import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryOwnershipProofStore } from "../adapters/memory-ownership-proof-store";
import { SqliteOwnershipProofStore } from "../adapters/sqlite-ownership-proof-store";
import type { OwnershipProofStore, StoredOwnershipChallenge } from "../domain/ports";
import type { Hex } from "../domain/hex";

const PRISM_ID = "prism:P7F21";
const ACCOUNT = "0xabc0000000000000000000000000000000000001" as Hex;
const OTHER_ACCOUNT = "0xabc0000000000000000000000000000000000002" as Hex;
const CHALLENGE_ID = "0xdef1000000000000000000000000000000000000000000000000000000000001" as Hex;
const DIGEST = "0xdead000000000000000000000000000000000000000000000000000000000001" as Hex;
const NOW = 1_789_000_100;
const EXPIRES_AT = 1_789_000_600;

const dirsToClean: string[] = [];
afterEach(() => {
  for (const dir of dirsToClean.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function verifiedRecord(overrides: Partial<StoredOwnershipChallenge> = {}): StoredOwnershipChallenge {
  return {
    schemaVersion: 2,
    chainId: 84532,
    domain: "prism.example",
    venue: "BASE",
    executionAccount: ACCOUNT,
    prismId: PRISM_ID,
    challengeId: CHALLENGE_ID,
    nonce: "0xfeed000000000000000000000000000000000000000000000000000000000001" as Hex,
    issuedAt: 1_789_000_000,
    expiresAt: EXPIRES_AT,
    digest: DIGEST,
    state: "VERIFIED",
    nonceState: "CONSUMED",
    bindingUseState: "UNUSED",
    verifiedSignatureClass: "EOA",
    verifiedAt: 1_789_000_010,
    ...overrides,
  };
}

function claimInput(overrides: Partial<Parameters<OwnershipProofStore["claimVerifiedBinding"]>[0]> = {}) {
  return {
    challengeId: CHALLENGE_ID,
    proofDigest: DIGEST,
    prismId: PRISM_ID,
    venue: "BASE" as const,
    executionAccount: ACCOUNT,
    chainId: 84532,
    expiresAt: EXPIRES_AT,
    now: NOW,
    ...overrides,
  };
}

async function seedVerified(store: OwnershipProofStore): Promise<void> {
  await store.putIssued(verifiedRecord());
}

describe("verified proof binding claim store boundary", () => {
  it("requires exact challenge correspondence and claims a verified proof once in memory", async () => {
    const store = new InMemoryOwnershipProofStore();
    await seedVerified(store);

    await expect(store.claimVerifiedBinding(claimInput({ executionAccount: OTHER_ACCOUNT }))).resolves.toBe("mismatch");
    await expect(store.claimVerifiedBinding(claimInput())).resolves.toBe("claimed");
    await expect(store.claimVerifiedBinding(claimInput())).resolves.toBe("already_claimed");
    expect((await store.getById(CHALLENGE_ID))?.bindingUseState).toBe("CONSUMED");
  });

  it("has exactly one winner under concurrent in-memory claims and refuses expiry", async () => {
    const store = new InMemoryOwnershipProofStore();
    await seedVerified(store);
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => store.claimVerifiedBinding(claimInput())),
    );
    expect(outcomes.filter((outcome) => outcome === "claimed")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "already_claimed")).toHaveLength(7);

    const expiredStore = new InMemoryOwnershipProofStore();
    await seedVerified(expiredStore);
    await expect(expiredStore.claimVerifiedBinding(claimInput({ now: EXPIRES_AT }))).resolves.toBe("expired");
    expect((await expiredStore.getById(CHALLENGE_ID))?.bindingUseState).toBe("UNUSED");
  });

  it("persists the one-time binding claim across SQLite close and reopen", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-proof-bind-"));
    dirsToClean.push(dir);
    const filePath = join(dir, "ownership.db");
    const store = new SqliteOwnershipProofStore({ filePath });
    await seedVerified(store);

    await expect(store.claimVerifiedBinding(claimInput())).resolves.toBe("claimed");
    store.close();

    const reopened = new SqliteOwnershipProofStore({ filePath });
    await expect(reopened.claimVerifiedBinding(claimInput())).resolves.toBe("already_claimed");
    expect((await reopened.getById(CHALLENGE_ID))?.bindingUseState).toBe("CONSUMED");
    reopened.close();
  });

  it("uses one canonical lowercase digest identity across memory and SQLite claims", async () => {
    const memory = new InMemoryOwnershipProofStore();
    const dir = mkdtempSync(join(tmpdir(), "prism-proof-bind-case-"));
    dirsToClean.push(dir);
    const sqlite = new SqliteOwnershipProofStore({ filePath: join(dir, "ownership.db") });

    for (const store of [memory, sqlite]) {
      await seedVerified(store);
      await expect(
        store.claimVerifiedBinding(
          claimInput({
            challengeId: CHALLENGE_ID.toUpperCase() as Hex,
            proofDigest: DIGEST.toUpperCase() as Hex,
          }),
        ),
      ).resolves.toBe("claimed");
    }
    sqlite.close();
  });

  it("rejects incompatible schema records and incomplete VERIFIED evidence", async () => {
    const memory = new InMemoryOwnershipProofStore();
    const dir = mkdtempSync(join(tmpdir(), "prism-proof-bind-validation-"));
    dirsToClean.push(dir);
    const sqlite = new SqliteOwnershipProofStore({ filePath: join(dir, "ownership.db") });

    for (const store of [memory, sqlite]) {
      await expect(store.putIssued(verifiedRecord({ schemaVersion: 1 }))).rejects.toThrow(/schema/i);
      await expect(store.putIssued(verifiedRecord({ verifiedAt: undefined }))).rejects.toThrow(/verified/i);
      await expect(store.putIssued(verifiedRecord({ verifiedSignatureClass: undefined }))).rejects.toThrow(/verified/i);
    }
    sqlite.close();
  });
});
