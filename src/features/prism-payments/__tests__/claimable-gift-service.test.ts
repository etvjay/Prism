import { describe, expect, it } from "vitest";
import { PaymentClaimError, PAYMENT_CLAIM_ERROR_CODE } from "../domain/errors";
import { ClaimableGiftService } from "../application/claimable-gift-service";
import {
  InMemoryClaimableGiftStore,
  InMemoryClaimNullifierStore,
} from "../adapters/memory-payment-claim-store";
import type { ClaimProofVerifier, PublicBaseSepoliaEscrowPort } from "../domain/ports";
import type { GiftClaimAuthorization, GiftFundingObservation } from "../domain/claimable-gift";

const FUND_TX = `0x${"a".repeat(64)}` as `0x${string}`;
const CLAIM_TX = `0x${"b".repeat(64)}` as `0x${string}`;
const NULLIFIER = `0x${"c".repeat(64)}` as `0x${string}`;
const TOKEN = `0x${"d".repeat(40)}` as `0x${string}`;
const SENDER = `0x${"e".repeat(40)}` as `0x${string}`;
const RECIPIENT = `0x${"f".repeat(40)}` as `0x${string}`;
const SIGNATURE = `0x${"1".repeat(130)}` as `0x${string}`;

class RecordingEscrow implements PublicBaseSepoliaEscrowPort {
  readonly chainId = 84532 as const;
  claimCalls = 0;
  refundCalls = 0;
  lastClaimInput: unknown = null;

  async createEscrow(): Promise<{ transactionHash: `0x${string}` }> {
    return { transactionHash: FUND_TX };
  }

  async claimEscrow(input: { claimId: string; recipientAddress: `0x${string}`; nullifier: `0x${string}` }): Promise<{ transactionHash: `0x${string}`; blockNumber: number }> {
    this.lastClaimInput = input;
    this.claimCalls += 1;
    return { transactionHash: CLAIM_TX, blockNumber: 20 };
  }

  async refundEscrow(input: { claimId: string }): Promise<{ transactionHash: `0x${string}`; blockNumber: number }> {
    void input;
    this.refundCalls += 1;
    return { transactionHash: FUND_TX, blockNumber: 21 };
  }

  async observeFunding(claimId: string): Promise<GiftFundingObservation | null> {
    return {
      claimId,
      transactionHash: FUND_TX,
      chainId: 84532,
      sender: SENDER,
      asset: TOKEN,
      amount: 500n,
      status: "succeeded",
      blockNumber: 10,
    };
  }
}

class FixedClaimProofVerifier implements ClaimProofVerifier {
  async verify(input: { claimId: string; nullifierCommitment: `0x${string}`; proof: unknown; recipientAddress: `0x${string}` }): Promise<GiftClaimAuthorization> {
    void input.proof;
    return {
      claimId: input.claimId,
      nullifier: input.nullifierCommitment,
      recipientAddress: input.recipientAddress,
      signature: SIGNATURE,
    };
  }
}

describe("public claimable-gift application boundary", () => {
  it("consumes a verifier result once and never persists the raw claim proof", async () => {
    const escrow = new RecordingEscrow();
    const service = new ClaimableGiftService({
      store: new InMemoryClaimableGiftStore(),
      nullifierStore: new InMemoryClaimNullifierStore(),
      escrow,
      claimProofVerifier: new FixedClaimProofVerifier(),
    });

    const created = await service.create({
      claimId: "gift_01H00000000000000000000000",
      sender: SENDER,
      asset: TOKEN,
      amount: 500n,
      chainId: 84532,
      expiresAt: 200,
      nullifierCommitment: NULLIFIER,
      now: 1,
    });
    const funded = await service.recordFunding(created.claimId, { now: 10 });
    const claimable = await service.markClaimable(funded.claimId, { now: 11 });

    const claimed = await service.claim(claimable.claimId, {
      now: 12,
      proof: "raw-secret-proof-must-not-persist",
      recipientAddress: RECIPIENT,
    });

    expect(claimed.state).toBe("claimed");
    expect(claimed.recipient?.address).toBe(RECIPIENT);
    expect(JSON.stringify(claimed, (_key, value) => typeof value === "bigint" ? value.toString() : value)).not.toContain("raw-secret-proof");
    expect(escrow.claimCalls).toBe(1);
    expect(escrow.lastClaimInput).toMatchObject({ claimId: claimable.claimId, recipientAddress: RECIPIENT, nullifier: NULLIFIER, authorization: SIGNATURE });

    let replayFailure: unknown;
    try {
      await service.claim(claimable.claimId, {
        now: 13,
        proof: "raw-secret-proof-must-not-persist",
        recipientAddress: RECIPIENT,
      });
    } catch (error) {
      replayFailure = error;
    }
    expect(replayFailure).toBeInstanceOf(PaymentClaimError);
    expect((replayFailure as PaymentClaimError).code).toBe(PAYMENT_CLAIM_ERROR_CODE.INVALID_STATE_TRANSITION);
    expect(escrow.claimCalls).toBe(1);
  });
});
