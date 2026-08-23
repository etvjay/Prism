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
  ChallengeState,
  NonceState,
  OwnershipProofStore,
  StoredOwnershipChallenge,
} from "../domain/ports";
import type { Hex } from "../domain/hex";

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export class InMemoryOwnershipProofStore implements OwnershipProofStore {
  private readonly records = new Map<Hex, StoredOwnershipChallenge>();

  async putIssued(record: StoredOwnershipChallenge): Promise<void> {
    if (this.records.has(record.challengeId)) {
      throw new Error("duplicate_challenge_id");
    }
    await yieldToEventLoop();
    if (this.records.has(record.challengeId)) {
      throw new Error("duplicate_challenge_id");
    }
    // Store an owned copy so callers cannot mutate terminal state in place.
    this.records.set(record.challengeId, { ...record });
  }

  async getById(challengeId: Hex): Promise<StoredOwnershipChallenge | undefined> {
    await yieldToEventLoop();
    const record = this.records.get(challengeId);
    return record ? { ...record } : undefined;
  }

  async consumeNonce(
    challengeId: Hex,
  ): Promise<"consumed" | "already_consumed" | "unknown"> {
    const record = this.records.get(challengeId);
    if (!record) return "unknown";
    // Synchronous critical section: no awaits between read and write.
    const nextState: NonceState = record.nonceState === "UNUSED" ? "CONSUMED" : record.nonceState;
    if (record.nonceState !== "UNUSED") {
      return "already_consumed";
    }
    record.nonceState = nextState;
    return "consumed";
  }

  async transitionState(
    challengeId: Hex,
    from: ChallengeState,
    to: ChallengeState,
    patch: Partial<Pick<StoredOwnershipChallenge, "verifiedSignatureClass" | "verifiedAt" | "rejection">>,
  ): Promise<boolean> {
    await yieldToEventLoop();
    const record = this.records.get(challengeId);
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
