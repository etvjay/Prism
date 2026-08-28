// Application service for the public Base Sepolia gift route. It composes
// domain transitions with narrow storage, proof, nullifier, and escrow ports;
// it never resolves a claim token/address/alias to a Prism ID.

import { PaymentClaimError, PAYMENT_CLAIM_ERROR_CODE } from "../domain/errors";
import {
  claimClaimableGift,
  reconcileClaimableGift,
  reconcileRefundableGift,
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
  type GiftReceipt,
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

export interface FundGiftInput { readonly now: number; readonly payerApproval: `0x${string}`; }

export interface MarkClaimableInput {
  readonly now: number;
}

export interface ClaimGiftInput {
  readonly now: number;
  /** Opaque proof is passed to the verifier and never stored or projected. */
  readonly proof: unknown;
  readonly recipientAddress: GiftHex;
  readonly recipientSignature?: `0x${string}`;
}

function validSignature(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{130}$/.test(value);
}

export class ClaimableGiftService {
  constructor(private readonly deps: ClaimableGiftServiceDeps) {
    if (deps.escrow.chainId !== 84_532) {
      throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.NETWORK_MISMATCH, "escrow_must_target_base_sepolia");
    }
  }

  async create(input: CreateClaimableGiftInput): Promise<ClaimableGift> {
    const gift = await this.deps.store.create(createClaimableGift(input));
    if (this.deps.escrow.createTerms) await this.deps.escrow.createTerms({ claimId: gift.claimId, refundDestination: gift.refundRecipient, commitment: gift.nullifierCommitment, amount: gift.amount, expiry: gift.expiresAt, nonce: 0 });
    return gift;
  }

  async fund(claimId: string, input: FundGiftInput): Promise<ClaimableGift> {
    const gift = await this.require(claimId);
    if (gift.state !== "created") throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.INVALID_STATE_TRANSITION, `fund_requires_created:${gift.state}`);
    if (!validSignature(input.payerApproval)) throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.WALLET_APPROVAL_REQUIRED, "payer_signature_required");
    if (!this.deps.escrow.fundEscrow) throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.ESCROW_UNAVAILABLE, "funding_adapter_unavailable");
    try { await this.deps.escrow.fundEscrow({ claimId, payerApproval: input.payerApproval }); }
    catch (cause) { if ((cause as { kind?: string }).kind === "unknown") throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.SUBMISSION_STATUS_UNKNOWN, "poll_funding_transaction"); throw cause; }
    return this.recordFunding(claimId, { now: input.now });
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
      throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.CLAIM_PROOF_INVALID, "claim_proof_invalid");
    }
    const authorization = verified as GiftClaimAuthorization;
    if (authorization.claimId !== gift.claimId || authorization.nullifier !== gift.nullifierCommitment) {
      throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.CLAIM_PROOF_INVALID, "claim_authorization_mismatch");
    }
    const signature = authorization.signature ?? input.recipientSignature;
    if (!validSignature(signature)) {
      throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.CLAIM_PROOF_INVALID, "recipient_signature_required");
    }
    const reserved = await this.deps.nullifierStore.reserve(authorization.nullifier, gift.claimId);
    if (reserved === "already_reserved") {
      throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.NULLIFIER_REPLAY, "claim_nullifier_already_reserved");
    }
    let submitted;
    try {
      submitted = await this.deps.escrow.claimEscrow({
        claimId: gift.claimId,
        recipientAddress: authorization.recipientAddress,
        nullifier: authorization.nullifier,
        authorization: signature,
      });
    } catch (cause) {
      if ((cause as { kind?: string }).kind === "unknown") {
        throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.SUBMISSION_STATUS_UNKNOWN, "claim_submission_unknown");
      }
      await this.deps.nullifierStore.release?.(authorization.nullifier, gift.claimId);
      throw cause;
    }
    if (submitted.status === "unknown" || (submitted.status === "submitted" && submitted.blockNumber === null)) {
      const state = submitted.status === "unknown" ? "claim_unknown" : "claim_submitted";
      return this.deps.store.update(claimId, gift.version, (current) => ({ ...current, state, version: current.version + 1, claimSubmissionHash: submitted.transactionHash }));
    }
    if (!submitted.transactionHash || submitted.blockNumber === null) {
      throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.SUBMISSION_STATUS_UNKNOWN, "claim_submission_missing_receipt");
    }
    const claimTransactionHash = submitted.transactionHash;
    const claimBlockNumber = submitted.blockNumber;
    try {
      return await this.deps.store.update(claimId, gift.version, (current) =>
        claimClaimableGift(current, {
          now: input.now,
          authorization: { ...authorization, signature },
          transactionHash: claimTransactionHash,
          blockNumber: claimBlockNumber,
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
    let submitted;
    try { submitted = await this.deps.escrow.refundEscrow({ claimId: gift.claimId }); }
    catch (cause) {
      if ((cause as { kind?: string }).kind === "unknown") throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.SUBMISSION_STATUS_UNKNOWN, "refund_submission_unknown");
      throw cause;
    }
    if (submitted.status === "unknown" || (submitted.status === "submitted" && submitted.blockNumber === null)) {
      const state = submitted.status === "unknown" ? "refund_unknown" : "refund_submitted";
      return this.deps.store.update(claimId, gift.version, (current) => ({ ...current, state, version: current.version + 1, refundSubmissionHash: submitted.transactionHash }));
    }
    if (!submitted.transactionHash || submitted.blockNumber === null) throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.RECEIPT_MISMATCH, "refund_submission_missing_receipt");
    const refundTransactionHash = submitted.transactionHash;
    const refundBlockNumber = submitted.blockNumber;
    return this.deps.store.update(claimId, gift.version, (current) =>
      refundClaimableGift(current, {
        now: input.now,
        actor: input.actor,
        transactionHash: refundTransactionHash,
        blockNumber: refundBlockNumber,
      }),
    );
  }

  async reconcileClaim(claimId: string, now: number, authorization: GiftClaimAuthorization, receipt: GiftReceipt): Promise<ClaimableGift> {
    const gift = await this.require(claimId);
    if (receipt.claimId !== claimId) throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.RECEIPT_MISMATCH, "claim_receipt_mismatch");
    const result = await this.deps.store.update(claimId, gift.version, (current) => reconcileClaimableGift(current, { now, authorization, receipt }));
    if (receipt.status === "reverted") await this.deps.nullifierStore.release?.(authorization.nullifier, claimId);
    return result;
  }

  async reconcileRefund(claimId: string, now: number, actor: GiftHex, receipt: GiftReceipt): Promise<ClaimableGift> {
    const gift = await this.require(claimId);
    if (receipt.claimId !== claimId) throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.RECEIPT_MISMATCH, "refund_receipt_mismatch");
    return this.deps.store.update(claimId, gift.version, (current) => reconcileRefundableGift(current, { now, actor, receipt }));
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
