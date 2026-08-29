import type { Hex } from "./hex";

/**
 * Proof digests are identifiers, not user-facing text. All durable and replay
 * paths use the same lowercase representation so memory, SQLite, PostgreSQL,
 * and registry adapters cannot disagree on a claim merely because hex casing
 * changed in transit. Structural validation remains at the application/RPC
 * boundaries; this helper only canonicalizes identity.
 */
export function normalizeProofDigestIdentity(value: string): Hex {
  return value.toLowerCase() as Hex;
}

export function sameProofDigestIdentity(left: string, right: string): boolean {
  return normalizeProofDigestIdentity(left) === normalizeProofDigestIdentity(right);
}
