// Application service for the public Base Sepolia gift route. It composes
// domain transitions with narrow storage, proof, nullifier, and escrow ports;
// it never resolves a claim token/address/alias to a Prism ID.

import { PaymentClaimError, PAYMENT_CLAIM_ERROR_CODE } from "../domain/errors";
import {
  claimClaimableGift,
  createClaimableGift,
  expireClaimableGift,
  fundClaimableGift,
  markGiftClaimable,
  refundClaimableGift,
  type ClaimableGift,
  type ClaimClaimableGiftInput,
  type CreateClaimableGiftInput,
  type ExpireClaimableGiftInput,
  type GiftClaimAuthorization,
  type GiftHex,
  type GiftRefundInput,
} from "../domain/claimable-gift";
import type {
  ClaimNullifierStore,
  ClaimProofVerifier,
  ClaimableGiftStore,
  PublicBaseSepoliaEscrowPort,
} from "../domain/ports";

export interface ClaimableGiftServiceDeps {
  readonly store: ClaimableGiftStore;
  readonly nullifierStore: ClaimNullifierStore;
  readonly escrow: PublicBaseSepoliaEscrowPort;
  readonly claimProofVerifier: ClaimProofVerifier;
}

export interface RecordFundingInput {
  readonly now: number;
}

export interface MarkClaimableInput {
  readonly now: number;
}

export interface ClaimGiftInput {
  readonly now: number;
  /** Opaque proof is passed to the verifier and never stored or projected. */
  readonly proof: unknown;
  readonly recipientAddress: GiftHex;
}

export class ClaimableGiftService {
  constructor(private readonly deps: ClaimableGiftServiceDeps) {
    if (deps.escrow.chainId !== 84_532) {
      throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.NETWORK_MISMATCH, "escrow_must_target_base_sepolia");
    }
  }

  async create(input: CreateClaimableGiftInput): Promise<ClaimableGift> {
    return this.deps.store.create(createClaimableGift(input));
  }

  async recordFunding(claimId: string, input: RecordFundingInput): Promise<ClaimableGift> {
    const gift = await this.require(claimId);
    const observation = await this.deps.escrow.observeFunding(claimId);
    if (!observation) {
      throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.RECEIPT_MISMATCH, "funding_observation_missing");
    }
    return this.deps.store.update(claimId, gift.version, (current) => fundClaimableGift(current, { now: input.now, observation }));
  }

  async markClaimable(claimId: string, input: MarkClaimableInput): Promise<ClaimableGift> {
    const gift = await this.require(claimId);
    return this.deps.store.update(claimId, gift.version, (current) => markGiftClaimable(current, input));
  }

  async claim(claimId: string, input: ClaimGiftInput): Promise<ClaimableGift> {
    const gift = await this.require(claimId);
    if (gift.state !== "claimable") {
      throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.INVALID_STATE_TRANSITION, `claim_requires_claimable:${gift.state}`);
    }
    const verified = await this.deps.claimProofVerifier.verify({
      claimId: gift.claimId,
      nullifierCommitment: gift.nullifierCommitment,
      proof: input.proof,
      recipientAddress: input.recipientAddress,
    });
    if ("valid" in verified && verified.valid === false) {
      throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.CLAIM_PROOF_INVALID, verified.reason ?? "claim_proof_invalid");
    }
    const authorization = verified as GiftClaimAuthorization;
    if (authorization.claimId !== gift.claimId || authorization.nullifier !== gift.nullifierCommitment) {
      throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.CLAIM_PROOF_INVALID, "claim_authorization_mismatch");
    }
    const reserved = await this.deps.nullifierStore.reserve(authorization.nullifier, gift.claimId);
    if (reserved === "already_reserved") {
      throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.NULLIFIER_REPLAY, "claim_nullifier_already_reserved");
    }
    const submitted = await this.deps.escrow.claimEscrow({
      claimId: gift.claimId,
      recipientAddress: authorization.recipientAddress,
      nullifier: authorization.nullifier,
    });
    try {
      return await this.deps.store.update(claimId, gift.version, (current) =>
        claimClaimableGift(current, {
          now: input.now,
          authorization,
          transactionHash: submitted.transactionHash,
          blockNumber: submitted.blockNumber,
        }),
      );
    } catch (cause) {
      throw cause instanceof PaymentClaimError
        ? cause
        : new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.RECEIPT_MISMATCH, "claim_state_persistence_failed_after_submission");
    }
  }

  async expire(claimId: string, input: ExpireClaimableGiftInput): Promise<ClaimableGift> {
    const gift = await this.require(claimId);
    return this.deps.store.update(claimId, gift.version, (current) => expireClaimableGift(current, input));
  }

  async refund(claimId: string, input: Omit<GiftRefundInput, "transactionHash" | "blockNumber">): Promise<ClaimableGift> {
    const gift = await this.require(claimId);
    if (gift.state !== "expired") {
      throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.REFUND_NOT_AVAILABLE, `refund_requires_expired:${gift.state}`);
    }
    if (input.actor.toLowerCase() !== gift.sender.toLowerCase()) {
      throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.UNAUTHORIZED, "sender_refund_authority_required");
    }
    const submitted = await this.deps.escrow.refundEscrow({ claimId: gift.claimId });
    return this.deps.store.update(claimId, gift.version, (current) =>
      refundClaimableGift(current, {
        now: input.now,
        actor: input.actor,
        transactionHash: submitted.transactionHash,
        blockNumber: submitted.blockNumber,
      }),
    );
  }

  async get(claimId: string): Promise<ClaimableGift | undefined> {
    return this.deps.store.getById(claimId);
  }

  private async require(claimId: string): Promise<ClaimableGift> {
    const gift = await this.deps.store.getById(claimId);
    if (!gift) throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.CLAIM_NOT_FOUND, `unknown_claim:${claimId}`);
    return gift;
  }
}
