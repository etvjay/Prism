// Application layer — PRISM-8 offchain commands.
//
// CMD-B-01 IssueChallenge and CMD-B-02 SubmitProof per
// projects/prism/system/operations.yaml. This layer owns the SM-PRISM-001
// lifecycle transitions (minus TR-P4 CONSUMED, which belongs to V8.3 onchain
// acceptance and is deliberately absent here).
//
// Boundary statement (INV-SYS-003): a VERIFIED result confers zero canonical
// effect. This slice implements no canonical binding, no resolve, no revoke,
// and no registry mutation of any kind. `claimVerifiedProof` is only an
// offchain single-use reservation of already-verified evidence before the
// separate controller-authorized registry submission.

import { buildChallenge, renderSignableMessage } from "../domain/challenge";
import {
  dependencyError,
  describeUnknownFailure,
  isPrismError,
  PRISM_ERROR_CODE,
  PrismError,
  PRISM_ERROR_DETAIL,
} from "../domain/errors";
import type { Hex } from "../domain/hex";
import {
  assertSupportedVenue,
  assertValidExecutionAccount,
  assertValidPrismId,
  isValidChainId,
} from "../domain/identifiers";
import {
  CHALLENGE_SCHEMA_VERSION,
  type BindingClaimResult,
  type ChallengeCrypto,
  type Clock,
  type OwnershipProofStore,
  type SignatureClass,
  type SmartWalletSignatureChecker,
  type StoredOwnershipChallenge,
  type VerifiedBindingClaim,
} from "../domain/ports";
import {
  assertPresentedFaithful,
  runLadder,
  type PresentedChallengeFields,
} from "../domain/verification";

export interface ChallengeServicePolicy {
  /** Default challenge TTL in seconds; hard-capped at 600 (SM-PRISM-001). */
  defaultTtlSeconds: number;
  defaultDomain: string;
  /** EIP-155 chain id bound into every issued challenge (schema v2). */
  defaultChainId: number;
  nonceByteLength?: number;
}

export interface ChallengeServiceDeps {
  clock: Clock;
  crypto: ChallengeCrypto;
  checker: SmartWalletSignatureChecker;
  store: OwnershipProofStore;
  policy: ChallengeServicePolicy;
}

export interface IssueChallengeCommand {
  prismId: string;
  venue: string;
  executionAccount: string;
  ttlSeconds?: number;
}

export interface IssuedChallengeView {
  challengeId: Hex;
  digest: Hex;
  schemaVersion: number;
  chainId: number;
  domain: string;
  venue: string;
  executionAccount: string;
  prismId: string;
  nonce: Hex;
  issuedAt: number;
  expiresAt: number;
  messageToSign: string;
}

export interface SubmitProofCommand {
  challengeId: Hex;
  presented: PresentedChallengeFields;
  signature: Hex;
}

export interface VerifiedProofResult {
  status: "verified";
  signatureClass: SignatureClass;
  digest: Hex;
  verifiedAt: number;
}

function nowOrThrow(clock: Clock): number {
  try {
    const value = clock.now();
    if (!Number.isFinite(value)) throw new Error("non_finite_time");
    return Math.floor(value);
  } catch (failure) {
    throw dependencyError(`${PRISM_ERROR_DETAIL.CLOCK_UNAVAILABLE}:${describeUnknownFailure(failure)}`);
  }
}

async function storeOrThrow<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (failure) {
    throw dependencyError(
      `${PRISM_ERROR_DETAIL.CHALLENGE_STORE_UNAVAILABLE}:${describeUnknownFailure(failure)}`,
    );
  }
}

/** CMD-B-01 + CMD-B-02 over injected ports. No framework imports. */
export class PrismChallengeService {
  private readonly deps: ChallengeServiceDeps;

  constructor(deps: ChallengeServiceDeps) {
    if (!deps.policy.defaultDomain || deps.policy.defaultDomain.trim().length === 0) {
      // Domain is server-controlled configuration, not user input; a missing
      // domain is a wiring defect, surfaced as an invariant violation.
      throw new Error("invariant_violation: policy.defaultDomain must be configured");
    }
    if (!isValidChainId(deps.policy.defaultChainId)) {
      // Same wiring-defect class: an invalid chain id must never reach a
      // signed challenge (it would silently un-bind the network).
      throw new Error("invariant_violation: policy.defaultChainId must be a positive integer");
    }
    this.deps = deps;
  }

  async issueChallenge(command: IssueChallengeCommand): Promise<IssuedChallengeView> {
    const venue = assertSupportedVenue(command.venue);
    const executionAccount = assertValidExecutionAccount(command.executionAccount);
    const prismId = assertValidPrismId(command.prismId);

    const issuedAt = nowOrThrow(this.deps.clock);
    const nonce = this.deps.crypto.randomNonceHex(this.deps.policy.nonceByteLength ?? 32);

    const record = buildChallenge(
      {
        schemaVersion: CHALLENGE_SCHEMA_VERSION,
        chainId: this.deps.policy.defaultChainId,
        domain: this.deps.policy.defaultDomain.trim().toLowerCase(),
        venue,
        executionAccount,
        prismId,
      },
      {
        nonce,
        issuedAt,
        ttlSeconds: command.ttlSeconds ?? this.deps.policy.defaultTtlSeconds,
      },
      this.deps.crypto,
    );

    await storeOrThrow(() => this.deps.store.putIssued(record));

    return toIssuedView(record);
  }

  async submitProof(command: SubmitProofCommand): Promise<VerifiedProofResult> {
    const stored = await storeOrThrow(() => this.deps.store.getById(command.challengeId));
    if (!stored) {
      // Nothing was issued under this id; the presented material cannot be a
      // faithful echo of any issued challenge (ERR-012 family, distinct detail).
      throw new PrismError(PRISM_ERROR_CODE.ALTERED_MESSAGE, PRISM_ERROR_DETAIL.UNKNOWN_CHALLENGE);
    }
    if (stored.schemaVersion !== CHALLENGE_SCHEMA_VERSION) {
      throw new PrismError(PRISM_ERROR_CODE.ALTERED_MESSAGE, "altered_fields:schema_version");
    }

    // Step 1: structural form + faithful echo (ERR-001/002/005/012).
    const expected = assertPresentedFaithful({
      stored,
      presented: command.presented,
    });

    // Step 2: expiry before consumption so EXPIRED never flips through CONSUMED.
    const now = nowOrThrow(this.deps.clock);
    if (stored.state === "EXPIRED" || now >= stored.expiresAt) {
      await this.markExpiredIfPossible(stored.challengeId, stored.state);
      throw new PrismError(PRISM_ERROR_CODE.PROOF_EXPIRED);
    }

    // Step 3: atomic single-use consumption (INV-SYS-010). Consume happens on
    // the attempt, matching CMD-B-02 irreversibility: REJECTED is terminal and
    // a second submission fails ERR-006 even with a valid signature.
    const consumeOutcome = await storeOrThrow(() =>
      this.deps.store.consumeNonce(stored.challengeId),
    );
    if (consumeOutcome === "already_consumed") {
      throw new PrismError(PRISM_ERROR_CODE.NONCE_ALREADY_USED);
    }
    if (consumeOutcome === "unknown") {
      throw dependencyError(
        `${PRISM_ERROR_DETAIL.CHALLENGE_STORE_UNAVAILABLE}:challenge_vanished_mid_verification`,
      );
    }

    // Step 4: verification ladder (EOA → EIP-1271 → ERC-6492).
    try {
      const message = renderSignableMessage({
        schemaVersion: stored.schemaVersion,
        chainId: stored.chainId,
        domain: stored.domain,
        venue: stored.venue,
        executionAccount: stored.executionAccount,
        prismId: stored.prismId,
        nonce: stored.nonce,
        issuedAt: stored.issuedAt,
        expiresAt: stored.expiresAt,
      });
      const outcome = await runLadder(
        { signature: command.signature, message, expected },
        { crypto: this.deps.crypto, checker: this.deps.checker },
      );
      const persisted = await storeOrThrow(() =>
        this.deps.store.transitionState(stored.challengeId, "ISSUED", "VERIFIED", {
          verifiedSignatureClass: outcome.signatureClass,
          verifiedAt: now,
        }),
      );
      if (!persisted) {
        // Defensive: state moved between consume and persist. Treat as replay.
        throw new PrismError(PRISM_ERROR_CODE.NONCE_ALREADY_USED, "state_transition_race");
      }
      return {
        status: "verified",
        signatureClass: outcome.signatureClass,
        digest: stored.digest,
        verifiedAt: now,
      };
    } catch (failure) {
      if (isPrismError(failure)) {
        await this.markRejectedBestEffort(stored.challengeId, failure);
      }
      throw failure;
    }
  }

  async getChallenge(challengeId: Hex): Promise<StoredOwnershipChallenge | undefined> {
    return storeOrThrow(() => this.deps.store.getById(challengeId));
  }

  /** Reserve a verified challenge for the bind handoff with a durable CAS. */
  async claimVerifiedProof(input: VerifiedBindingClaim): Promise<BindingClaimResult> {
    return storeOrThrow(() => this.deps.store.claimVerifiedBinding(input));
  }

  private async markExpiredIfPossible(challengeId: Hex, currentState: StoredOwnershipChallenge["state"]): Promise<void> {
    if (currentState !== "ISSUED") return;
    try {
      await this.deps.store.transitionState(challengeId, "ISSUED", "EXPIRED", {});
    } catch {
      // Best effort only; ERR-013 is already authoritative for the caller.
    }
  }

  private async markRejectedBestEffort(challengeId: Hex, failure: PrismError): Promise<void> {
    try {
      await this.deps.store.transitionState(challengeId, "ISSUED", "REJECTED", {
        rejection: { code: failure.code, ...(failure.detail ? { detail: failure.detail } : {}) },
      });
    } catch {
      // The original rejection is authoritative; persistence is best-effort.
    }
  }
}

function toIssuedView(record: StoredOwnershipChallenge): IssuedChallengeView {
  return {
    challengeId: record.challengeId,
    digest: record.digest,
    schemaVersion: record.schemaVersion,
    chainId: record.chainId,
    domain: record.domain,
    venue: record.venue,
    executionAccount: record.executionAccount,
    prismId: record.prismId,
    nonce: record.nonce,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    messageToSign: renderSignableMessage({
      schemaVersion: record.schemaVersion,
      chainId: record.chainId,
      domain: record.domain,
      venue: record.venue,
      executionAccount: record.executionAccount,
      prismId: record.prismId,
      nonce: record.nonce,
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt,
    }),
  };
}
