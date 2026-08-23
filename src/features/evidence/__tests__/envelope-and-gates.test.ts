// Evidence envelope + gate tests — static/fixture, offline, no secrets, no RPC.
// Covers: chainId target mismatch, missing secrets/receipt fields, malformed receipt,
// wrong network, absent independent read, X maturity, and strk20.json guard.

import { describe, it, expect } from "vitest";
import {
  buildEvidenceEnvelope,
  validateEvidenceEnvelope,
  canonicalStringify,
  assertNoStrk20JsonWrite,
  type DeploymentEvidence,
  type TxEvidence,
} from "../evidence-envelope";

function baseValid() {
  const dep: DeploymentEvidence = {
    network: "SN_SEPOLIA",
    address: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    class_hash: "0x0abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    deploy_tx: "0x0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0dead",
    block_number: 12345,
    status: "SUCCEEDED",
  };
  const tx: TxEvidence = { network: "SN_SEPOLIA", hash: "0x0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0dead", block: 12345, status: "SUCCEEDED" };
  return {
    evidence_id: "EVD-PRISM-004",
    claim: "PrismIdentityRegistry deploy fixture",
    environment: "SN_SEPOLIA" as const,
    build: { commit_sha: "5684163", spec_versions: { scarb: "2.20.0", snforge: "0.63.0" } },
    procedure: ["scarb build", "snforge test", "TEST DOUBLE deploy"],
    inputs: { chainId: 84532 },
    deployment: dep,
    transactions: [tx],
    contracts: [{ address: dep.address, class_hash: dep.class_hash, name: "PrismIdentityRegistry" }],
    claim_scope: "fixture only",
    limitations: ["TEST DOUBLE — no live RPC"],
    independent_verification: { explorer_url: "https://sepolia.voyager.online/tx/0x0dead", rpc_second_read: { block: 12345, status: "SUCCEEDED", address_match: true }, verified_at: "2026-08-23T00:00:00Z" },
    maturity: "X3" as const,
    target_manifest: { environment: "testnet", network: "SN_SEPOLIA" as const, chain_id: 84532 },
  };
}

describe("evidence envelope — deterministic + promotion guards", () => {
  it("valid fixture is promotable and deterministic", () => {
    const fixed = { ...baseValid(), observed_at: "2026-08-23T00:00:00Z", build: { ...baseValid().build, observed_at: "2026-08-23T00:00:00Z" } };
    const e1 = buildEvidenceEnvelope(fixed);
    const e2 = buildEvidenceEnvelope(fixed);
    expect(canonicalStringify(e1)).toBe(canonicalStringify(e2));
    const v = validateEvidenceEnvelope(e1);
    expect(v.valid).toBe(true);
    expect(v.promotable).toBe(true);
    expect(v.blockers).toEqual([]);
    expect(v.suggestedMaturity).toBe("X3");
  });

  it("chainId target mismatch is a promotion blocker (altered_fields:chain_id)", () => {
    const e = buildEvidenceEnvelope({ ...baseValid(), inputs: { chainId: 8453 } }); // Base mainnet vs manifest 84532
    const v = validateEvidenceEnvelope(e);
    expect(v.promotable).toBe(false);
    expect(v.blockers.join(" ")).toMatch(/chainId target mismatch|altered_fields:chain_id/);
  });

  it("missing deployment fields block promotion (not valid for X3+)", () => {
    const input = baseValid();
    const e = buildEvidenceEnvelope({ ...input, deployment: null });
    const v = validateEvidenceEnvelope(e);
    expect(v.promotable).toBe(false);
    expect(v.blockers.join(" ")).toMatch(/deployment missing/);
    expect(v.suggestedMaturity).toBe("X2");
  });

  it("malformed receipt — bad hex address, UNKNOWN status, missing block — produces errors/blockers", () => {
    const dep = { ...baseValid().deployment!, address: "not-hex" as never };
    const e1 = buildEvidenceEnvelope({ ...baseValid(), deployment: dep as DeploymentEvidence });
    expect(validateEvidenceEnvelope(e1).valid).toBe(false); // structural error

    const txBad = { network: "SN_SEPOLIA" as const, hash: "0xzzzz" as never, block: null, status: "UNKNOWN" as const };
    const e2 = buildEvidenceEnvelope({ ...baseValid(), transactions: [txBad as TxEvidence] });
    const v2 = validateEvidenceEnvelope(e2);
    expect(v2.promotable).toBe(false);
    expect([...v2.blockers, ...v2.errors].join(" ")).toMatch(/malformed|UNKNOWN|block missing/);
  });

  it("wrong network is a blocker (envelope SN_MAIN vs deployment SN_SEPOLIA, tx network mismatch)", () => {
    const e = buildEvidenceEnvelope({ ...baseValid(), environment: "SN_MAIN" as const });
    const v = validateEvidenceEnvelope(e);
    expect(v.promotable).toBe(false);
    expect(v.blockers.join(" ")).toMatch(/wrong network/);
    // Also tx network mismatch
    const e2 = buildEvidenceEnvelope({ ...baseValid(), transactions: [{ network: "SN_MAIN" as const, hash: "0x0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0dead", block: 12345, status: "SUCCEEDED" }] });
    expect(validateEvidenceEnvelope(e2).blockers.join(" ")).toMatch(/wrong network/);
  });

  it("absent independent read is a promotion blocker and downgrades X maturity to X2", () => {
    const e = buildEvidenceEnvelope({ ...baseValid(), independent_verification: { explorer_url: null, rpc_second_read: null, verified_at: null }, maturity: "X3" as const });
    const v = validateEvidenceEnvelope(e);
    expect(v.promotable).toBe(false);
    expect(v.blockers.join(" ")).toMatch(/independent_verification missing/);
    expect(v.suggestedMaturity).toBe("X2");
    expect(e.maturity).toBe("X2"); // builder clamps
    expect(e.promotion_blockers.length).toBeGreaterThan(0);
  });

  it("X maturity assignment: structural errors → X0, missing promotable fields → X2, independent read present → claimed maturity preserved", () => {
    // structural error -> X0
    const e0 = buildEvidenceEnvelope({ ...baseValid(), environment: "UNKNOWN" as never });
    expect(validateEvidenceEnvelope(e0).suggestedMaturity).toBe("X0");
    // missing independent read -> X2 even when claimed X3
    const e2 = buildEvidenceEnvelope({ ...baseValid(), independent_verification: { explorer_url: null, rpc_second_read: null, verified_at: null }, maturity: "X4" as const });
    expect(validateEvidenceEnvelope(e2).suggestedMaturity).toBe("X2");
    // valid + independent read keeps claimed X3
    const e3 = buildEvidenceEnvelope(baseValid());
    expect(validateEvidenceEnvelope(e3).suggestedMaturity).toBe("X3");
  });

  it("reverted transaction blocks promotion", () => {
    const e = buildEvidenceEnvelope({ ...baseValid(), transactions: [{ network: "SN_SEPOLIA" as const, hash: "0x0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0dead", block: 12345, status: "REVERTED" as const, revert_reason: "ERR-007" }] });
    expect(validateEvidenceEnvelope(e).blockers.join(" ")).toMatch(/REVERTED/);
    expect(validateEvidenceEnvelope(e).promotable).toBe(false);
  });

  it("cannot write strk20.json — builder throws, validator blocks", () => {
    expect(() => assertNoStrk20JsonWrite("strk20.json")).toThrow(/must never write strk20\.json/);
    expect(() => assertNoStrk20JsonWrite("ops/strk20.json")).toThrow();
    expect(() => buildEvidenceEnvelope({ ...baseValid(), inputs: { writeStrk20Json: true } as never })).not.toThrow(); // builder allows input flag but validator blocks it
    const e = buildEvidenceEnvelope({ ...baseValid(), procedure: ["do not write strk20.json — correct"], inputs: { chainId: 84532 } });
    expect(validateEvidenceEnvelope(e).promotable).toBe(true); // mentioning the guard phrase is allowed
    expect(() => buildEvidenceEnvelope({ ...baseValid(), procedure: ["write strk20.json with hash 0x..."], inputs: { chainId: 84532 } })).toThrow(/must not write strk20\.json/);
    // So test the validator directly with a raw envelope that bypasses the builder guard
    const raw = { ...e, procedure: ["write strk20.json"] as string[] };
    expect(validateEvidenceEnvelope(raw as never).promotable).toBe(false);
    expect(validateEvidenceEnvelope(raw as never).errors.join(" ")).toMatch(/strk20\.json/);
    // Also file-path guard: build via helper must not target strk20.json
    expect(() => assertNoStrk20JsonWrite("/tmp/strk20.json")).toThrow();
  });

  it("missing secrets — envelope is secret-free (no private key) and promotable without embedding secrets", () => {
    // The envelope never contains secrets; missing env var is a harness-level guard (STARKNET_RPC_URL etc.).
    // We assert the fixture contains only expected tx/addr hashes (allowed) and no 0x private key literal beyond those,
    // and that the validator does not require a secret literal to promote.
    const e = buildEvidenceEnvelope(baseValid());
    const canon = canonicalStringify(e);
    // Envelope legitimately contains deploy_tx / address hashes — so we check that no env var literal with key is present
    expect(canon).not.toMatch(/PRIVATE_KEY/);
    expect(canon).not.toMatch(/api_key|secret/i);
    expect(validateEvidenceEnvelope(e).promotable).toBe(true);
    // Simulate missing env: harness would fail before building envelope; envelope builder itself needs no secret
    expect(e.build.commit_sha).toBe("5684163");
  });
});
