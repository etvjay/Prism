// TEST-8-1-1 — challenge carries chain_id+domain+venue+account+prism_id+nonce+
// expiry; digest is stable over canonical serialization and sensitive to every
// bound field, including the chain binding (INV-SYS-011 serialization half,
// schema v2 per audit F-1/S1).

import { describe, expect, it } from "vitest";
import { serializeCanonicalChallenge, buildChallenge, renderSignableMessage } from "../domain/challenge";
import type { OwnershipChallengeFields } from "../domain/ports";
import { viemChallengeCrypto } from "../adapters/viem-crypto";
import { CHALLENGE_CHAIN_ID, CHALLENGE_DOMAIN, PRISM_ID } from "./harness";

const BASE_FIELDS: OwnershipChallengeFields & { nonce: `0x${string}`; issuedAt: number; expiresAt: number } = {
  schemaVersion: 2,
  chainId: CHALLENGE_CHAIN_ID,
  domain: CHALLENGE_DOMAIN,
  venue: "BASE",
  executionAccount: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  prismId: PRISM_ID,
  nonce: "0x1111111111111111111111111111111111111111111111111111111111111111",
  issuedAt: 1_789_000_000,
  expiresAt: 1_789_000_600,
};

describe("canonical challenge serialization (TEST-8-1-1)", () => {
  it("is byte-deterministic across repeated invocations", () => {
    const first = serializeCanonicalChallenge(BASE_FIELDS);
    const second = serializeCanonicalChallenge({ ...BASE_FIELDS });
    expect(second).toBe(first);
    expect(first.startsWith("PRISM-OWNERSHIP-CHALLENGE v2\n")).toBe(true);
    expect(first).toContain('"chain_id":84532');
    expect(first).toContain('"execution_account":"0xaaaa');
    expect(first).toContain('"prism_id":"prism:P7F21"');
    expect(first).toContain('"venue":"BASE"');
    expect(first).toContain('"nonce":"0x1111');
    expect(first).toContain('"expires_at":1789000600');
  });

  it("rejects v1 challenge material instead of silently treating it as v2", () => {
    expect(() => serializeCanonicalChallenge({ ...BASE_FIELDS, schemaVersion: 1 })).toThrow(/schema_version/i);
    expect(() =>
      buildChallenge(
        { schemaVersion: 1, chainId: CHALLENGE_CHAIN_ID, domain: CHALLENGE_DOMAIN, venue: "BASE", executionAccount: BASE_FIELDS.executionAccount, prismId: PRISM_ID },
        { nonce: BASE_FIELDS.nonce, issuedAt: BASE_FIELDS.issuedAt, ttlSeconds: 600 },
        viemChallengeCrypto,
      ),
    ).toThrow(/schema_version/i);
  });

  it("changes the digest when any single bound field changes", () => {
    const baseline = buildChallenge(
      { schemaVersion: 2, chainId: CHALLENGE_CHAIN_ID, domain: CHALLENGE_DOMAIN, venue: "BASE", executionAccount: BASE_FIELDS.executionAccount, prismId: PRISM_ID },
      { nonce: BASE_FIELDS.nonce, issuedAt: BASE_FIELDS.issuedAt, ttlSeconds: 600 },
      viemChallengeCrypto,
    );

    const variants = [
      { ...baseline, chainId: 8453 },
      { ...baseline, domain: "other.example" },
      { ...baseline, prismId: "prism:ZZZZ99" },
      { ...baseline, executionAccount: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    ];
    // The venue enum has exactly one member (BASE), so a venue mutation can
    // only be expressed as an unsupported value; that case is covered by the
    // service-level mutation-matrix suite.

    for (const variant of variants) {
      const digest = viemChallengeCrypto.keccak256Utf8(
        serializeCanonicalChallenge({ ...(variant as typeof BASE_FIELDS) }),
      );
      expect(digest).not.toBe(baseline.digest);
    }

    const nonceShifted = buildChallenge(
      { schemaVersion: 2, chainId: CHALLENGE_CHAIN_ID, domain: CHALLENGE_DOMAIN, venue: "BASE", executionAccount: BASE_FIELDS.executionAccount, prismId: PRISM_ID },
      { nonce: "0x2222222222222222222222222222222222222222222222222222222222222222", issuedAt: BASE_FIELDS.issuedAt, ttlSeconds: 600 },
      viemChallengeCrypto,
    );
    expect(nonceShifted.digest).not.toBe(baseline.digest);

    const expiryShifted = buildChallenge(
      { schemaVersion: 2, chainId: CHALLENGE_CHAIN_ID, domain: CHALLENGE_DOMAIN, venue: "BASE", executionAccount: BASE_FIELDS.executionAccount, prismId: PRISM_ID },
      { nonce: BASE_FIELDS.nonce, issuedAt: BASE_FIELDS.issuedAt + 1, ttlSeconds: 600 },
      viemChallengeCrypto,
    );
    expect(expiryShifted.digest).not.toBe(baseline.digest);
  });

  it("binds challenge id and digest to the target chain (cross-network resistance)", () => {
    // Same logical challenge on Base Sepolia vs Base mainnet: identical bytes
    // except chain_id, provably distinct digests — a signature or proof digest
    // minted for one network is not valid on the other (audit F-1).
    const sepolia = buildChallenge(
      { schemaVersion: 2, chainId: 84_532, domain: CHALLENGE_DOMAIN, venue: "BASE", executionAccount: BASE_FIELDS.executionAccount, prismId: PRISM_ID },
      { nonce: BASE_FIELDS.nonce, issuedAt: BASE_FIELDS.issuedAt, ttlSeconds: 600 },
      viemChallengeCrypto,
    );
    const mainnet = buildChallenge(
      { schemaVersion: 2, chainId: 8453, domain: CHALLENGE_DOMAIN, venue: "BASE", executionAccount: BASE_FIELDS.executionAccount, prismId: PRISM_ID },
      { nonce: BASE_FIELDS.nonce, issuedAt: BASE_FIELDS.issuedAt, ttlSeconds: 600 },
      viemChallengeCrypto,
    );
    expect(mainnet.chainId).toBe(8453);
    expect(sepolia.digest).not.toBe(mainnet.digest);
    expect(sepolia.challengeId).not.toBe(mainnet.challengeId);
  });

  it("clamps TTL to the spec ceiling of ten minutes", () => {
    const overzealous = buildChallenge(
      { schemaVersion: 2, chainId: CHALLENGE_CHAIN_ID, domain: CHALLENGE_DOMAIN, venue: "BASE", executionAccount: BASE_FIELDS.executionAccount, prismId: PRISM_ID },
      { nonce: BASE_FIELDS.nonce, issuedAt: BASE_FIELDS.issuedAt, ttlSeconds: 100_000 },
      viemChallengeCrypto,
    );
    expect(overzealous.expiresAt - overzealous.issuedAt).toBe(600);
  });

  it("renders a signable message containing every binding", () => {
    const record = buildChallenge(
      { schemaVersion: 2, chainId: CHALLENGE_CHAIN_ID, domain: CHALLENGE_DOMAIN, venue: "BASE", executionAccount: BASE_FIELDS.executionAccount, prismId: PRISM_ID },
      { nonce: BASE_FIELDS.nonce, issuedAt: BASE_FIELDS.issuedAt, ttlSeconds: 600 },
      viemChallengeCrypto,
    );
    const message = renderSignableMessage(record);
    for (const binding of [
      CHALLENGE_DOMAIN,
      `Schema version: ${record.schemaVersion}`,
      "BASE",
      `Chain ID: ${record.chainId}`,
      record.executionAccount,
      PRISM_ID,
      record.nonce,
      String(record.expiresAt),
    ]) {
      expect(message).toContain(binding);
    }
    expect(message).toContain(
      "Verification alone has no canonical effect; a binding becomes canonical only after a Starknet registry transition.",
    );
  });

  it("renders different signable messages when only the chain differs", () => {
    const base = renderSignableMessage({
      ...BASE_FIELDS,
      venue: "BASE",
    });
    const crossChain = renderSignableMessage({
      ...BASE_FIELDS,
      chainId: 8453,
      venue: "BASE",
    });
    expect(crossChain).toContain("Chain ID: 8453");
    expect(crossChain).not.toBe(base);
  });
});
