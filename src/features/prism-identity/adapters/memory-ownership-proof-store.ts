// In-memory OwnershipProofStore adapter (port: OwnershipProofStore).
//
// Reference implementation for this slice and for tests. consumeNonce is a
// synchronous compare-and-set inside the JS event loop, which makes it atomic
// within one process; interleaving is introduced via macrotask yields so the
// concurrency tests exercise realistic async races (INV-SYS-010).
//
// A production deployment must satisfy this port with an ACID store using a
// conditional write (T7 DB-integration tier) — explicitly out of scope here.

import type {
  BindingClaimResult,
  ChallengeState,
  NonceState,
  OwnershipProofStore,
  StoredOwnershipChallenge,
  VerifiedBindingClaim,
} from "../domain/ports";
import type { Hex } from "../domain/hex";
import { normalizeProofDigestIdentity } from "../domain/proof-digest";
import {
  assertStoredOwnershipChallenge,
  assertVerifiedEvidencePatch,
  hasVerifiedEvidence,
} from "../domain/ownership-challenge-validation";

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export class InMemoryOwnershipProofStore implements OwnershipProofStore {
  private readonly records = new Map<Hex, StoredOwnershipChallenge>();

  async putIssued(record: StoredOwnershipChallenge): Promise<void> {
    try {
      assertStoredOwnershipChallenge(record);
    } catch (cause) {
      const error = new Error(cause instanceof Error ? cause.message : String(cause)) as Error & { code?: string };
      error.code = "invalid_record";
      throw error;
    }
    const normalized = {
      ...record,
      challengeId: normalizeProofDigestIdentity(record.challengeId),
      digest: normalizeProofDigestIdentity(record.digest),
      executionAccount: record.executionAccount.toLowerCase() as StoredOwnershipChallenge["executionAccount"],
      bindingUseState: record.bindingUseState ?? "UNUSED",
    };
    if (this.records.has(normalized.challengeId)) {
      throw new Error("duplicate_challenge_id");
    }
    await yieldToEventLoop();
    if (this.records.has(normalized.challengeId)) {
      throw new Error("duplicate_challenge_id");
    }
    // Store an owned copy so callers cannot mutate terminal state in place.
    this.records.set(normalized.challengeId, normalized);
  }

  async getById(challengeId: Hex): Promise<StoredOwnershipChallenge | undefined> {
    await yieldToEventLoop();
    const record = this.records.get(normalizeProofDigestIdentity(challengeId));
    return record ? { ...record } : undefined;
  }

  async consumeNonce(
    challengeId: Hex,
  ): Promise<"consumed" | "already_consumed" | "unknown"> {
    const record = this.records.get(normalizeProofDigestIdentity(challengeId));
    if (!record) return "unknown";
    // Synchronous critical section: no awaits between read and write.
    const nextState: NonceState = record.nonceState === "UNUSED" ? "CONSUMED" : record.nonceState;
    if (record.nonceState !== "UNUSED") {
      return "already_consumed";
    }
    record.nonceState = nextState;
    return "consumed";
  }

  async claimVerifiedBinding(input: VerifiedBindingClaim): Promise<BindingClaimResult> {
    const challengeId = normalizeProofDigestIdentity(input.challengeId);
    const proofDigest = normalizeProofDigestIdentity(input.proofDigest);
    const executionAccount = input.executionAccount.toLowerCase();
    const record = this.records.get(challengeId);
    if (!record) return "unknown";
    if (
      record.challengeId !== challengeId ||
      record.digest !== proofDigest ||
      record.prismId !== input.prismId ||
      record.venue !== input.venue ||
      record.executionAccount !== executionAccount ||
      record.chainId !== input.chainId ||
      record.expiresAt !== input.expiresAt
    ) {
      return "mismatch";
    }
    if (record.bindingUseState === "CONSUMED") return "already_claimed";
    if (record.bindingUseState !== undefined && record.bindingUseState !== "UNUSED") return "mismatch";
    if (input.now >= record.expiresAt || record.state === "EXPIRED") return "expired";
    if (
      record.state !== "VERIFIED" ||
      record.nonceState !== "CONSUMED" ||
      !hasVerifiedEvidence(record)
    ) {
      return "not_verified";
    }
    // Synchronous compare-and-set: no await between the UNUSED read and the
    // CONSUMED write, so concurrent callers in this process have one winner.
    record.bindingUseState = "CONSUMED";
    return "claimed";
  }

  async transitionState(
    challengeId: Hex,
    from: ChallengeState,
    to: ChallengeState,
    patch: Partial<Pick<StoredOwnershipChallenge, "verifiedSignatureClass" | "verifiedAt" | "rejection">>,
  ): Promise<boolean> {
    if (to === "VERIFIED") {
      try {
        assertVerifiedEvidencePatch(patch);
      } catch (cause) {
        const error = new Error(cause instanceof Error ? cause.message : String(cause)) as Error & { code?: string };
        error.code = "invalid_record";
        throw error;
      }
    }
    await yieldToEventLoop();
    const record = this.records.get(normalizeProofDigestIdentity(challengeId));
    if (!record || record.state !== from) return false;
    // Synchronous critical section.
    record.state = to;
    Object.assign(record, patch);
    return true;
  }

  /** Test/ops inspection only — not part of the port. */
  snapshot(): StoredOwnershipChallenge[] {
    return [...this.records.values()].map((record) => ({ ...record }));
  }
}
