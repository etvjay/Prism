// Public Base Sepolia claimable-gift boundary.
// This module is not a Registry V2 contract and does not expose a generic
// external-call, admin-withdrawal, beneficiary-override, or upgrade surface.

import { BASE_SEPOLIA_CHAIN_ID, PAYMENT_CLAIM_PROTOCOL_VERSION, type PaymentHex } from "./payment-request";
import { PAYMENT_CLAIM_ERROR_CODE, PaymentClaimError } from "./errors";

export { BASE_SEPOLIA_CHAIN_ID } from "./payment-request";

export const CLAIMABLE_GIFT_SCHEMA_VERSION = 1 as const;
export const BASE_SEPOLIA_NETWORK = "BASE_SEPOLIA" as const;
export const CLAIMABLE_GIFT_STATES = ["created", "funded", "claimable", "claim_submitted", "claim_unknown", "claimed", "expired", "refund_submitted", "refund_unknown", "refunded"] as const;
export type ClaimableGiftState = (typeof CLAIMABLE_GIFT_STATES)[number];
export type GiftHex = PaymentHex;
/** Opaque 65-byte EIP-712 signature; never returned in public projections. */
export type GiftSignature = `0x${string}`;
export type GiftAsset = "native" | GiftHex;

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HASH32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ZERO_EVM_ADDRESS = "0x0000000000000000000000000000000000000000";

function isValidEvmAddress(value: string): boolean {
  return EVM_ADDRESS_PATTERN.test(value) && value.toLowerCase() !== ZERO_EVM_ADDRESS;
}

export interface GiftRecipientBinding {
  readonly address: GiftHex;
  readonly boundAt: number;
  /** Consumed public nullifier commitment; raw proof is never retained. */
  readonly nullifier: GiftHex;
}

export interface ClaimableGift {
  readonly protocolVersion: typeof PAYMENT_CLAIM_PROTOCOL_VERSION;
  readonly schemaVersion: typeof CLAIMABLE_GIFT_SCHEMA_VERSION;
  readonly network: typeof BASE_SEPOLIA_NETWORK;
  readonly chainId: typeof BASE_SEPOLIA_CHAIN_ID;
  readonly claimId: string;
  readonly sender: GiftHex;
  /** Immutable refund destination; no call can override it. */
  readonly refundRecipient: GiftHex;
  readonly asset: GiftAsset;
  readonly amount: bigint;
  readonly expiresAt: number;
  readonly nullifierCommitment: GiftHex;
  readonly state: ClaimableGiftState;
  readonly version: number;
  readonly createdAt: number;
  readonly fundedAt: number | null;
  readonly claimableAt: number | null;
  readonly claimedAt: number | null;
  readonly expiredAt: number | null;
  readonly refundedAt: number | null;
  readonly fundingTransactionHash: GiftHex | null;
  readonly fundingBlockNumber: number | null;
  readonly claimTransactionHash: GiftHex | null;
  readonly refundTransactionHash: GiftHex | null;
  readonly refundBlockNumber: number | null;
  readonly claimSubmissionHash: GiftHex | null;
  readonly refundSubmissionHash: GiftHex | null;
  readonly recipient: GiftRecipientBinding | null;
}

export interface CreateClaimableGiftInput {
  readonly claimId: string;
  readonly sender: GiftHex;
  readonly asset: GiftAsset;
  readonly amount: bigint;
  readonly chainId: typeof BASE_SEPOLIA_CHAIN_ID;
  readonly expiresAt: number;
  readonly nullifierCommitment: GiftHex;
  readonly now: number;
}

export function createClaimableGift(input: CreateClaimableGiftInput): ClaimableGift {
  if (input.chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.INVALID_CHAIN, `expected_Base_Sepolia_${BASE_SEPOLIA_CHAIN_ID}`);
  }
  if (typeof input.amount !== "bigint" || input.amount <= 0n) {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.INVALID_AMOUNT, "amount_must_be_positive");
  }
  if (!isValidEvmAddress(input.sender)) {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.INVALID_REQUEST, "sender_address_invalid");
  }
  if (input.asset !== "native" && !isValidEvmAddress(input.asset)) {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.INVALID_ASSET, "asset_address_invalid");
  }
  if (!HASH32_PATTERN.test(input.nullifierCommitment)) {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.INVALID_REQUEST, "nullifier_commitment_invalid");
  }
  if (!Number.isSafeInteger(input.now) || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= input.now) {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.INVALID_EXPIRY, "expiry_must_be_after_now");
  }
  return {
    protocolVersion: PAYMENT_CLAIM_PROTOCOL_VERSION,
    schemaVersion: CLAIMABLE_GIFT_SCHEMA_VERSION,
    network: BASE_SEPOLIA_NETWORK,
    chainId: input.chainId,
    claimId: input.claimId,
    sender: input.sender,
    refundRecipient: input.sender,
    asset: input.asset,
    amount: input.amount,
    expiresAt: input.expiresAt,
    nullifierCommitment: input.nullifierCommitment,
    state: "created",
    version: 0,
    createdAt: input.now,
    fundedAt: null,
    claimableAt: null,
    claimedAt: null,
    expiredAt: null,
    refundedAt: null,
    fundingTransactionHash: null,
    fundingBlockNumber: null,
    claimTransactionHash: null,
    refundTransactionHash: null,
    refundBlockNumber: null,
    claimSubmissionHash: null,
    refundSubmissionHash: null,
    recipient: null,
  };
}

export interface GiftFundingObservation {
  readonly claimId: string;
  readonly transactionHash: GiftHex;
  readonly chainId: typeof BASE_SEPOLIA_CHAIN_ID;
  readonly sender: GiftHex;
  readonly asset: GiftAsset;
  readonly amount: bigint;
  readonly status: "succeeded" | "reverted" | "pending" | "unknown";
  readonly blockNumber: number | null;
}

export interface FundClaimableGiftInput {
  readonly now: number;
  readonly observation: GiftFundingObservation;
}

export function fundClaimableGift(gift: ClaimableGift, input: FundClaimableGiftInput): ClaimableGift {
  const observation = input.observation;
  if (
    gift.state !== "created" ||
    observation.claimId !== gift.claimId ||
    observation.transactionHash.length === 0 ||
    observation.chainId !== gift.chainId ||
    observation.sender.toLowerCase() !== gift.sender.toLowerCase() ||
    observation.asset.toLowerCase() !== gift.asset.toLowerCase() ||
    observation.amount !== gift.amount ||
    observation.status !== "succeeded" ||
    !Number.isSafeInteger(observation.blockNumber) ||
    (observation.blockNumber as number) < 0
  ) {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.RECEIPT_MISMATCH, "funding_observation_does_not_match_gift");
  }
  return {
    ...gift,
    state: "funded",
    version: gift.version + 1,
    fundedAt: input.now,
    fundingTransactionHash: observation.transactionHash,
    fundingBlockNumber: observation.blockNumber,
  };
}

export interface MarkGiftClaimableInput {
  readonly now: number;
}

export function markGiftClaimable(gift: ClaimableGift, input: MarkGiftClaimableInput): ClaimableGift {
  if (gift.state !== "funded") {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.INVALID_STATE_TRANSITION, `claimable_requires_funded:${gift.state}`);
  }
  if (input.now >= gift.expiresAt) {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.CLAIM_EXPIRED, "gift_expired_before_claimable");
  }
  return {
    ...gift,
    state: "claimable",
    version: gift.version + 1,
    claimableAt: input.now,
  };
}

export interface ExpireClaimableGiftInput {
  readonly now: number;
}

export function expireClaimableGift(gift: ClaimableGift, input: ExpireClaimableGiftInput): ClaimableGift {
  if (gift.state !== "created" && gift.state !== "funded" && gift.state !== "claimable") {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.INVALID_STATE_TRANSITION, `expire_not_allowed:${gift.state}`);
  }
  if (input.now < gift.expiresAt) {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.REFUND_NOT_AVAILABLE, "gift_not_expired");
  }
  return {
    ...gift,
    state: "expired",
    version: gift.version + 1,
    expiredAt: input.now,
  };
}

export interface GiftRefundInput {
  readonly now: number;
  /** The actor must be the immutable sender; there is no beneficiary parameter. */
  readonly actor: GiftHex;
  readonly transactionHash: GiftHex;
  readonly blockNumber: number;
}

export interface GiftReceipt {
  readonly claimId: string;
  readonly transactionHash: GiftHex;
  readonly blockNumber: number;
  readonly status: "succeeded";
}

export function refundClaimableGift(gift: ClaimableGift, input: GiftRefundInput): ClaimableGift {
  if (gift.state !== "expired") {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.REFUND_NOT_AVAILABLE, `refund_requires_expired:${gift.state}`);
  }
  if (input.actor.toLowerCase() !== gift.sender.toLowerCase()) {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.UNAUTHORIZED, "sender_refund_authority_required");
  }
  if (!input.transactionHash || !Number.isSafeInteger(input.blockNumber) || input.blockNumber < 0) {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.RECEIPT_MISMATCH, "refund_observation_invalid");
  }
  return {
    ...gift,
    state: "refunded",
    version: gift.version + 1,
    refundedAt: input.now,
    refundTransactionHash: input.transactionHash,
    refundBlockNumber: input.blockNumber,
  };
}

export interface GiftClaimAuthorization {
  readonly claimId: string;
  /** Public nullifier value returned by a verifier; raw proof is not stored. */
  readonly nullifier: GiftHex;
  readonly recipientAddress: GiftHex;
  /** Recipient EIP-712 authorization passed unchanged to claim(). */
  readonly signature?: GiftSignature;
}

export interface ClaimClaimableGiftInput {
  readonly now: number;
  readonly authorization: GiftClaimAuthorization;
  readonly transactionHash: GiftHex;
  readonly blockNumber: number;
}

export function claimClaimableGift(gift: ClaimableGift, input: ClaimClaimableGiftInput): ClaimableGift {
  const authorization = input.authorization;
  if (gift.state !== "claimable") {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.INVALID_STATE_TRANSITION, `claim_requires_claimable:${gift.state}`);
  }
  if (input.now >= gift.expiresAt) {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.CLAIM_EXPIRED, "gift_expired_before_claim");
  }
  if (!isValidEvmAddress(authorization.recipientAddress)) {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.CLAIM_PROOF_INVALID, "invalid_recipient_address");
  }
  if (
    authorization.claimId !== gift.claimId ||
    authorization.nullifier !== gift.nullifierCommitment ||
    !input.transactionHash ||
    !Number.isSafeInteger(input.blockNumber) ||
    input.blockNumber < 0
  ) {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.CLAIM_PROOF_INVALID, "claim_authorization_does_not_match_gift");
  }
  return {
    ...gift,
    state: "claimed",
    version: gift.version + 1,
    claimedAt: input.now,
    claimTransactionHash: input.transactionHash,
    recipient: {
      address: authorization.recipientAddress,
      boundAt: input.now,
      nullifier: authorization.nullifier,
    },
  };
}
