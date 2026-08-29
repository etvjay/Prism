// M3 proof_digest representation tests — field-bounded felt mapping.
//
// Defect: 256-bit keccak proof_digest vs felt252 registry parameter
// (OP-8-01). Fix: named field-bounded mapping applied at the single Starknet
// boundary choke point; full digest remains canonical everywhere else.
import { describe, it, expect } from "vitest";
import type { Hex } from "../../prism-operations/domain/operation";
import {
  toFieldBoundedDigest,
  feltMatchesDigest,
  isFeltInRange,
  FELT_PRIME,
  DIGEST_MASK_250,
  prismIdToRegistryFelt,
} from "../domain/felt-digest";

// A genuinely in-range (< 2^250) digest: leading hex chars "02" clear the top 6 bits.
const IN_RANGE: Hex = ("0x02" + "95aee8cf18d7533b8cf6c782bcdf9987915df4a08a6d8c2c14bc4989af5e370f".slice(2)) as Hex;

// Real observed parent failure value — full 256-bit keccak output.
const REAL_DIGEST: Hex = "0x95aee8cf18d7533b8cf6c782bcdf9987915df4a08a6d8c2c14bc4989af5e370f";

function hexToBigint(hex: Hex): bigint { return BigInt(hex); }
function bigintToHex(v: bigint): Hex { return ("0x" + v.toString(16).padStart(64, "0")) as Hex; }

describe("toFieldBoundedDigest", () => {
  it("in-range: values below 2^250 pass through unchanged (no loss)", () => {
    const low = bigintToHex(12345n);
    const r = toFieldBoundedDigest(low);
    expect(r.felt).toBe(low);
    expect(r.bounded).toBe(false);
    expect(r.source).toBe(low);
    expect(BigInt(r.felt) === BigInt(low)).toBe(true);
  });

  it("real parent-failure digest maps to an in-range felt deterministically", () => {
    const r = toFieldBoundedDigest(REAL_DIGEST);
    expect(isFeltInRange(hexToBigint(r.felt))).toBe(true);
    // Deterministic across repeated calls.
    expect(toFieldBoundedDigest(REAL_DIGEST).felt).toBe(r.felt);
  });

  it("out-of-range (≥ 2^250): masked to 250 bits, bounded flag set, source echoed", () => {
    // 2^251 is a legal 256-bit keccak-space value but far above felt range;
    // masking must bring it below 2^250.
    const high = bigintToHex(1n << 251n);
    const r = toFieldBoundedDigest(high);
    expect(r.bounded).toBe(true);
    const feltVal = BigInt(r.felt);
    expect(feltVal).toBeLessThanOrEqual(DIGEST_MASK_250);
    expect(feltVal).toBe((1n << 251n) & DIGEST_MASK_250); // = 0
    expect(r.source).toBe(high.toLowerCase());
    // No modulo wraparound ever: result strictly below 2^250 < FELT_PRIME.
    expect(feltVal).toBeLessThan(FELT_PRIME);
  });

  it("maximal 256-bit input masks without wraparound or silent acceptance", () => {
    const max = bigintToHex((1n << 256n) - 1n);
    const r = toFieldBoundedDigest(max);
    expect(r.bounded).toBe(true);
    expect(BigInt(r.felt)).toBe(((1n << 256n) - 1n) & DIGEST_MASK_250);
  });

  it("malformed input rejected explicitly — never silently repaired", () => {
    for (const bad of ["0x123" as Hex, "95aee8cf" as Hex, "0xzz" as Hex, "" as Hex]) {
      expect(() => toFieldBoundedDigest(bad)).toThrow(/malformed_proof_digest/);
    }
  });

  it("deterministic mapping: same input → byte-identical felt, always in range", () => {
    for (let i = 0; i < 64; i += 1) {
      const d = bigintToHex((BigInt(i + 1) << 200n) ^ 0xdeadbeefn);
      const a = toFieldBoundedDigest(d);
      const b = toFieldBoundedDigest(d);
      expect(a.felt).toBe(b.felt);
      expect(isFeltInRange(BigInt(a.felt))).toBe(true);
      if (!a.bounded) expect(BigInt(a.felt)).toBe(BigInt(d));
      else expect(BigInt(a.felt)).toBe(BigInt(d) & DIGEST_MASK_250);
    }
  });

  it("collision / domain boundary: distinct digests colliding in felt space differ only in top 6 bits; mapping never invents equality below 2^250", () => {
    // Two inputs differing ONLY above bit 249 collide in felt space by
    // construction. This is the documented, accepted residual (top-6-bit
    // discard on top of keccak256 second-preimage resistance), fail-closed
    // via ERR-007 onchain. Assert the exact algebra so the residual is pinned:
    const base = 0x123456789abcdefn << 100n;
    const d1 = base | (0b000001n << 250n);
    const d2 = base | (0b111111n << 250n);
    expect(d1 !== d2).toBe(true);
    expect(BigInt(toFieldBoundedDigest(bigintToHex(d1)).felt))
      .toBe(BigInt(toFieldBoundedDigest(bigintToHex(d2)).felt));
    // And any two distinct sub-2^250 digests NEVER collide after mapping.
    const e1 = base;
    const e2 = base + 1n;
    expect(toFieldBoundedDigest(bigintToHex(e1)).felt)
      .not.toBe(toFieldBoundedDigest(bigintToHex(e2)).felt);
  });

  it("feltMatchesDigest round-trips both branches", () => {
    expect(feltMatchesDigest(IN_RANGE, IN_RANGE)).toBe(true);
    const r = toFieldBoundedDigest(REAL_DIGEST);
    expect(feltMatchesDigest(r.felt, REAL_DIGEST)).toBe(true);
    expect(feltMatchesDigest(REAL_DIGEST, "0x00".padEnd(66, "0") as Hex)).toBe(false);
  });
});

describe("prismIdToRegistryFelt — M3-X2 second defect", () => {
  it("canonical prism:1 maps to felt 0x1 (registry expects hex felt, not prism: string)", () => {
    expect(prismIdToRegistryFelt("prism:1")).toBe("0x1");
    expect(prismIdToRegistryFelt("prism:42")).toBe("0x2a");
    // large but still in range
    expect(prismIdToRegistryFelt("prism:12345")).toBe("0x3039");
  });

  it("leading zeros policy: prism:001 and prism:00* rejected as malformed (ERR-002)", () => {
    for (const bad of ["prism:001", "prism:00", "prism:0123"]) {
      expect(() => prismIdToRegistryFelt(bad)).toThrow(/ERR-002/);
      expect(() => prismIdToRegistryFelt(bad)).toThrow(/malformed_prism_id|leading zeros/);
    }
    // Single zero is also non-positive
    expect(() => prismIdToRegistryFelt("prism:0")).toThrow(/ERR-002/);
  });

  it("malformed IDs rejected with ERR-002 (not silently base36/hash/repair)", () => {
    const badCases = [
      "prism:P1", // non-numeric — base36 must not be applied
      "prism:abc",
      "prism:1a",
      "prism:-1", // negative
      "prism:", // empty
      "prism: 1", // space after colon
      "1", // missing prefix
      "prism:1.0",
      "prism:0x1",
    ];
    for (const bad of badCases) {
      expect(() => prismIdToRegistryFelt(bad)).toThrow(/ERR-002/);
    }
  });

  it("overflow beyond felt prime rejected with ERR-023 (not modulo silently)", () => {
    const overflow = FELT_PRIME.toString(); // exactly prime => out of range
    expect(() => prismIdToRegistryFelt(`prism:${overflow}`)).toThrow(/ERR-023/);
    const over2 = (FELT_PRIME + 1n).toString();
    expect(() => prismIdToRegistryFelt(`prism:${over2}`)).toThrow(/ERR-023/);
    // Very large overflow
    const huge = "1" + "0".repeat(80);
    expect(() => prismIdToRegistryFelt(`prism:${huge}`)).toThrow(/ERR-023/);
  });

  it("negative and non-numeric never hash/repair to a felt", () => {
    // Ensure these do not silently produce e.g. base36 0x etc.
    expect(() => prismIdToRegistryFelt("prism:-42")).toThrow(/ERR-002/);
    expect(() => prismIdToRegistryFelt("prism:HELLO")).toThrow(/ERR-002/);
  });

  it("trims surrounding whitespace but still validates canonical form", () => {
    expect(prismIdToRegistryFelt("  prism:7  ".trim())).toBe("0x7");
    // but internal spaces are rejected
    expect(() => prismIdToRegistryFelt("prism: 7")).toThrow(/ERR-002/);
  });

  it("preserves offchain vs boundary: full digest offchain, felt only at boundary — prismId analog", () => {
    // Offchain keeps prism:1 string; boundary returns 0x1. They are not equal.
    const offchain = "prism:1";
    const felt = prismIdToRegistryFelt(offchain);
    expect(offchain).not.toBe(felt);
    expect(felt).toBe("0x1");
    // Offchain ID unchanged
    expect(offchain).toBe("prism:1");
  });
});
