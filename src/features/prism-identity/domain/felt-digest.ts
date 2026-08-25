// Field-bounded digest representation for Starknet felt252 calldata.
//
// DEFECT (M3): the schema-v2 challenge service emits proof_digest =
// keccak256(canonical challenge bytes) — a full 256-bit value
// (src/features/prism-identity/domain/challenge.ts buildChallenge), while
// PrismIdentityRegistry.bind_execution_identity accepts proof_digest:
// felt252 (contracts/prism_identity_registry/src/lib.cairo OP-8-01). A real
// digest (0x95aee8cf…) was rejected by sncast as out-of-range before
// broadcast. Felt252 range: [0, 2^251 + 17·2^192 + 1); a uniform 256-bit
// keccak output lands out of range with overwhelming probability (~1 − 2⁻⁵).
//
// CANONICAL MAPPING (named, explicit, lossless-in-security):
//   felt_digest(d) = d                    if d < 2^250          (in-range pass-through)
//   felt_digest(d) = d & (2^250 − 1)      otherwise             ("starknet-masked")
// This mirrors the ecosystem convention already used by Starknet's own
// keccak (starknetKeccak masks the 256-bit KECCAK output to 250 bits), so it
// follows repo/dependency canon rather than inventing one.
//
// SECURITY / REPLAY SEMANTICS:
// - The FULL 256-bit digest remains the canonical proof_digest everywhere
//   except the Starknet boundary: challenge response, persisted challenge
//   record, application-layer replay pre-check, evidence. Nothing is
//   rewritten or truncated in storage or runbooks.
// - The mapping is a pure function applied at exactly one choke point (the
//   StarknetSubmitAdapter calldata assembly), so challenge → persisted digest
//   → bind calldata → registry consumed_digests all derive from the same
//   representation deterministically.
// - Domain separation: masking discards only the top 6 bits of a keccak
//   output. Two distinct canonical challenges colliding in felt space
//   requires a ~2^-6 event per pair ON TOP of second-preimage resistance of
//   keccak256 over distinct serialized bytes (INV-SYS-011 tamper evidence is
//   unchanged: the verifier recomputes and compares the FULL digest). The
//   residual felt-space collision risk is explicitly accepted here and
//   flagged for owner ratification (DEC-PRISM-SYS-004 proposal); the onchain
//   single-use map (INV-SYS-004) keys the felt value, so a felt collision
//   manifests as an ERR-007 replay rejection — fail-closed, never a double
//   spend of a proof.
// - No silent loss: callers can always recover whether bounding occurred
//   via wasBounded() and recompute the inverse relation is unnecessary
//   because the full digest is persisted alongside.

import type { Hex } from "./hex";

/** Cairo felt252 modulus: 2^251 + 17·2^192 + 1. */
export const FELT_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;

/**
 * Mask width for field-bounded digests: 250 bits, matching the starknetKeccak
 * convention (keccak outputs masked to 250 bits stay far below FELT_PRIME,
 * leaving headroom for downstream arithmetic without modular wraparound).
 */
export const DIGEST_MASK_250 = (1n << 250n) - 1n;

export function isFeltInRange(value: bigint): boolean {
  return value >= 0n && value < FELT_PRIME;
}

export interface FieldBoundedDigest {
  /** felt252-safe representation actually placed in bind calldata. */
  felt: Hex;
  /** Full 256-bit input (canonical persisted digest) — echoed for audit. */
  source: Hex;
  /** True iff masking was required (input ≥ 2^250). */
  bounded: boolean;
}

/**
 * Named conversion: 256-bit keccak proof_digest → felt252-safe representation.
 * Throws on malformed input; never silently accepts non-hex or wrong length.
 */
export function toFieldBoundedDigest(digest: Hex): FieldBoundedDigest {
  if (!/^0x[0-9a-fA-F]{64}$/.test(digest)) {
    throw new Error(`invariant_violation: malformed_proof_digest:${digest}`);
  }
  const value = BigInt(digest);
  // Any 256-bit input (including values in [FELT_PRIME, 2^256)) maps into
  // range by the 250-bit mask below: masked result is strictly < 2^250
  // < FELT_PRIME. No modulo wraparound ever occurs.
  if (value <= DIGEST_MASK_250) {
    return { felt: digest.toLowerCase() as Hex, source: digest.toLowerCase() as Hex, bounded: false };
  }
  const masked = value & DIGEST_MASK_250;
  return {
    felt: `0x${masked.toString(16).padStart(64, "0")}` as Hex,
    source: digest.toLowerCase() as Hex,
    bounded: true,
  };
}

/** Whether a given calldata felt could correspond to a given full digest. */
export function feltMatchesDigest(felt: Hex, digest: Hex): boolean {
  return toFieldBoundedDigest(digest).felt === felt.toLowerCase();
}

// ---------------------------------------------------------------------------
// PrismID → felt252 boundary conversion (M3 follow-up, second defect).
//
// DEFECT (M3-X2): StarknetSubmitAdapter.submitBind passed application Prism
// IDs (e.g. `prism:1`) verbatim into calldata. The registry expects
// `felt252` `0x1`; `prism:1` is not a felt and is rejected by the sequencer.
// Fix is a named explicit conversion applied at the Starknet boundary only;
// application/Product IDs remain unchanged offchain.
//
// CANONICAL FORM: `prism:<decimal registry id>` where <decimal> is a
// positive base-10 integer without sign, leading zeros, or non-digit chars,
// and whose numeric value is in [1, FELT_PRIME). The hex felt is the
// minimal `0x` hex encoding of that integer (e.g. `prism:1` → `0x1`).
// No base36, hash, or silent repair is performed — malformed or
// unrepresentable inputs are rejected explicitly with stable ERR codes.
// ---------------------------------------------------------------------------

/**
 * Named conversion: canonical `prism:<decimal>` → felt252 hex.
 * Throws explicitly on malformed/overflow input; never silently coerces.
 * Error messages are prefixed with `ERR-002` (identity_not_found family)
 * for malformed/non-numeric/leading-zero/zero cases and `ERR-023`
 * (stale_state_conflict) for overflow beyond FELT_PRIME, so callers can
 * map to stable catalogue codes without inventing a new encoding.
 */
export function prismIdToRegistryFelt(prismId: string): Hex {
  if (typeof (prismId as unknown) !== "string") {
    throw new Error(`ERR-002: malformed_prism_id: non-string id: ${String(prismId)}`);
  }
  const trimmed = prismId.trim();
  const prefix = "prism:";
  if (!trimmed.startsWith(prefix)) {
    throw new Error(`ERR-002: malformed_prism_id: missing prefix prism:: ${prismId}`);
  }
  const suffix = trimmed.slice(prefix.length);
  if (suffix.length === 0) {
    throw new Error(`ERR-002: malformed_prism_id: empty id: ${prismId}`);
  }
  if (!/^[0-9]+$/.test(suffix)) {
    throw new Error(`ERR-002: malformed_prism_id: non-decimal id: ${prismId}`);
  }
  // Leading zeros policy: canonical decimal has no leading zeros unless the
  // value is exactly "0" (which is itself rejected as non-positive). This
  // makes `prism:001` malformed, not silently normalized to `prism:1`.
  if (suffix.length > 1 && suffix.startsWith("0")) {
    throw new Error(`ERR-002: malformed_prism_id: leading zeros: ${prismId}`);
  }
  let value: bigint;
  try {
    value = BigInt(suffix);
  } catch {
    throw new Error(`ERR-002: malformed_prism_id: unparseable: ${prismId}`);
  }
  if (value <= 0n) {
    throw new Error(`ERR-002: malformed_prism_id: not positive: ${prismId}`);
  }
  if (value >= FELT_PRIME) {
    throw new Error(`ERR-023: prism_id_out_of_range: ${prismId} exceeds felt prime`);
  }
  return `0x${value.toString(16)}` as Hex;
}
