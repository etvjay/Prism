// Canonical typed challenge construction (OBJ-PRISM-005 / CMD-B-01).
//
// SD-005 envelope: the challenge is a typed structured message carrying
// {chain_id, domain, venue, execution_account, prism_id, nonce, expiry}; its
// digest is keccak256 over a canonical serialization. The exact wire format
// inside that envelope is an implementation detail; this module defines it
// once and tests pin its determinism (TEST-8-1-1, INV-SYS-011).

import {
  CHALLENGE_SCHEMA_VERSION,
  type OwnershipChallengeFields,
  type StoredOwnershipChallenge,
} from "./ports";
import type { ChallengeCrypto } from "./ports";
import { utf8ToBytes } from "./hex";
import type { Hex } from "./hex";
import { normalizeProofDigestIdentity } from "./proof-digest";

export const CHALLENGE_TTL_BOUNDS = {
  /** Spec ceiling: challenge_ttl ≤ 10 minutes (SM-PRISM-001). */
  maxSeconds: 600,
  minSeconds: 30,
} as const;

const CANONICAL_HEADER = "PRISM-OWNERSHIP-CHALLENGE v2";

/**
 * Deterministic canonical encoding of one full challenge (fields + nonce +
 * issuance/expiry). Key order is fixed by construction; values are normalized
 * upstream (lowercase address, trimmed identifiers). Two encodings of the same
 * logical challenge are byte-identical — TEST-8-1-1.
 */
export function serializeCanonicalChallenge(
  fields: OwnershipChallengeFields & {
    nonce: Hex;
    issuedAt: number;
    expiresAt: number;
  },
): string {
  if (fields.schemaVersion !== CHALLENGE_SCHEMA_VERSION) {
    throw new Error(`invariant_violation: unsupported_challenge_schema_version:${String(fields.schemaVersion)}`);
  }
  const ordered: Array<[string, string | number]> = [
    ["chain_id", fields.chainId],
    ["domain", fields.domain],
    ["execution_account", fields.executionAccount],
    ["expires_at", fields.expiresAt],
    ["issued_at", fields.issuedAt],
    ["nonce", fields.nonce],
    ["prism_id", fields.prismId],
    ["schema_version", fields.schemaVersion],
    ["venue", fields.venue],
  ];
  const body = ordered
    .map(([key, value]) => `${JSON.stringify(key)}:${JSON.stringify(value)}`)
    .join(",");
  return `${CANONICAL_HEADER}\n{${body}}`;
}

/**
 * Human-readable signable message (SIWE-class UX per SD-005/S4). Every bound
 * field is visible; wallets sign exactly these bytes via personal_sign.
 */
export function renderSignableMessage(challenge: {
  schemaVersion: number;
  chainId: number;
  domain: string;
  venue: string;
  executionAccount: string;
  prismId: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}): string {
  return [
    "Prism wants you to prove control of a Base account.",
    "",
    `Domain: ${challenge.domain}`,
    `Schema version: ${challenge.schemaVersion}`,
    `Venue: ${challenge.venue}`,
    `Chain ID: ${challenge.chainId}`,
    `Execution account: ${challenge.executionAccount}`,
    `Prism ID: ${challenge.prismId}`,
    `Nonce: ${challenge.nonce}`,
    `Issued at: ${challenge.issuedAt}`,
    `Expires at: ${challenge.expiresAt}`,
    "",
    "Signing proves control of the execution account above for binding it to the Prism ID above.",
    "Verification alone has no canonical effect; a binding becomes canonical only after a Starknet registry transition.",
  ].join("\n");
}

/** proof_digest = keccak256(canonical challenge bytes) (OBJ-PRISM-005).
 * The challenge id equals the digest: content-addressed, unique per nonce,
 * and directly reusable as the future V8.3 onchain single-use value. */
export function buildChallenge(
  fields: OwnershipChallengeFields,
  inputs: { nonce: Hex; issuedAt: number; ttlSeconds: number },
  crypto: ChallengeCrypto,
): StoredOwnershipChallenge {
  if (fields.schemaVersion !== CHALLENGE_SCHEMA_VERSION) {
    throw new Error(`invariant_violation: unsupported_challenge_schema_version:${String(fields.schemaVersion)}`);
  }
  const ttlSeconds = Math.floor(inputs.ttlSeconds);
  if (!Number.isFinite(ttlSeconds)) {
    throw new Error("invariant_violation: ttl_seconds_not_finite");
  }
  const clampedTtl = Math.min(Math.max(ttlSeconds, CHALLENGE_TTL_BOUNDS.minSeconds), CHALLENGE_TTL_BOUNDS.maxSeconds);
  const expiresAt = inputs.issuedAt + clampedTtl;
  const canonical = serializeCanonicalChallenge({
    ...fields,
    schemaVersion: CHALLENGE_SCHEMA_VERSION,
    nonce: inputs.nonce,
    issuedAt: inputs.issuedAt,
    expiresAt,
  });
  const digest = normalizeProofDigestIdentity(crypto.keccak256Utf8(canonical));
  return {
    ...fields,
    schemaVersion: CHALLENGE_SCHEMA_VERSION,
    challengeId: digest,
    nonce: inputs.nonce,
    issuedAt: inputs.issuedAt,
    expiresAt,
    digest,
    state: "ISSUED",
    nonceState: "UNUSED",
    bindingUseState: "UNUSED",
  };
}

export function challengeDigestBytes(challenge: StoredOwnershipChallenge): Uint8Array {
  return utf8ToBytes(serializeCanonicalChallenge({
    ...challenge,
  }));
}
