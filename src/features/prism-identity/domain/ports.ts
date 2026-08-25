// Ports (hexagonal boundaries) for the PRISM-8 offchain slice.
// SD-003: the domain layer imports no web framework, RPC SDK, or DB driver;
// every effectful capability is expressed as a port and satisfied by adapters.

import type { Hex } from "./hex";
import type { EvmAddress, PrismId, Venue } from "./identifiers";

/** Time source. Unix seconds. */
export interface Clock {
  now(): number;
}

/** Pure cryptographic primitives needed by the domain. No transport. */
export interface ChallengeCrypto {
  /** keccak256 over UTF-8 bytes of `text`. */
  keccak256Utf8(text: string): Hex;
  /** EIP-191 personal-sign recovery. Returns null when the signature is not
   * recoverable; never throws for malformed input. */
  recoverPersonalSignAddress(input: {
    message: string;
    signature: Hex;
  }): Promise<EvmAddress | null>;
  /** Cryptographically random nonce bytes, hex-encoded. */
  randomNonceHex(byteLength: number): Hex;
}

export type SignatureClass = "EOA" | "EIP1271" | "ERC6492";

export interface SmartWalletCheckInput {
  /** Account whose isValidSignature semantics decide validity. */
  account: EvmAddress;
  /** The message exactly as presented to the signer (the adapter derives the
   * contract-visible hash). */
  message: string;
  /** Signature bytes; ERC-6492 wrapped signatures are passed whole. */
  signature: Hex;
}

export type SmartWalletCheckResult =
  | { status: "valid" }
  | { status: "invalid" }
  | { status: "undetermined"; reason: string };

/** EIP-1271 semantic check port. Implementations MUST NOT fall back to
 * ecrecover-only acceptance (INV-SYS-009). Transport failures are reported as
 * { status: "undetermined", reason } so the service can surface ERR-021
 * explicitly instead of silently rejecting. */
export interface SmartWalletSignatureChecker {
  check(input: SmartWalletCheckInput): Promise<SmartWalletCheckResult>;
}

// ---------------------------------------------------------------------------
// OwnershipProof record + store (OBJ-PRISM-005, INV-SYS-010 enforcement point)
// ---------------------------------------------------------------------------

/** v2: adds `chainId` to the canonical field set (F-1/S1 — the signature is
 * cryptographically bound to the target network; v1 challenges are invalid). */
export const CHALLENGE_SCHEMA_VERSION = 2;

export type ChallengeState = "ISSUED" | "VERIFIED" | "REJECTED" | "EXPIRED";

export type NonceState = "UNUSED" | "CONSUMED";

/** Offchain single-use fence for the proof-to-bind handoff. This is distinct
 * from the registry's onchain consumed_digests map: it records that one
 * verified challenge has been reserved for one bind submission. */
export type BindingUseState = "UNUSED" | "CONSUMED";

export interface OwnershipChallengeFields {
  schemaVersion: number;
  /** EIP-155 chain id of the network the execution account lives on.
   * Bound into the digest and the signable message (cross-network replay). */
  chainId: number;
  domain: string;
  venue: Venue;
  executionAccount: EvmAddress;
  prismId: PrismId;
}

export interface StoredOwnershipChallenge extends OwnershipChallengeFields {
  challengeId: Hex;
  nonce: Hex;
  issuedAt: number;
  expiresAt: number;
  digest: Hex;
  state: ChallengeState;
  nonceState: NonceState;
  /** Optional for pre-binding-fence records; absent legacy rows are treated as UNUSED. */
  bindingUseState?: BindingUseState;
  verifiedSignatureClass?: SignatureClass;
  verifiedAt?: number;
  rejection?: { code: string; detail?: string };
}

export interface VerifiedBindingClaim {
  readonly challengeId: Hex;
  readonly proofDigest: Hex;
  readonly prismId: PrismId;
  readonly venue: Venue;
  readonly executionAccount: EvmAddress;
  readonly chainId: number;
  readonly expiresAt: number;
  readonly now: number;
}

export type BindingClaimResult =
  | "claimed"
  | "already_claimed"
  | "unknown"
  | "not_verified"
  | "expired"
  | "mismatch";

/**
 * Durable server-side challenge/nonce storage.
 *
 * consumeNonce is the atomic compare-and-set that enforces INV-SYS-010:
 * exactly one caller observes "consumed"; every other concurrent or repeated
 * caller observes "already_consumed". A production adapter must implement this
 * with an ACID conditional write (T7 DB-integration tier); the in-memory
 * adapter in this slice documents that boundary.
 */
export interface OwnershipProofStore {
  putIssued(record: StoredOwnershipChallenge): Promise<void>;
  getById(challengeId: Hex): Promise<StoredOwnershipChallenge | undefined>;
  consumeNonce(
    challengeId: Hex,
  ): Promise<"consumed" | "already_consumed" | "unknown">;
  /**
   * Atomically reserve one VERIFIED challenge for one bind submission. The
   * conditional write re-checks every proof-to-bind field and expiry so a
   * caller cannot turn a stale read or arbitrary digest into authority.
   */
  claimVerifiedBinding(input: VerifiedBindingClaim): Promise<BindingClaimResult>;
  /** Optimistic guarded transition; returns false when current state differs. */
  transitionState(
    challengeId: Hex,
    from: ChallengeState,
    to: ChallengeState,
    patch: Partial<Pick<StoredOwnershipChallenge, "verifiedSignatureClass" | "verifiedAt" | "rejection">>,
  ): Promise<boolean>;
}
