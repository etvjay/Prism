// Public claimable-gift projections. Only explicitly public Base escrow
// lifecycle metadata crosses this boundary. Raw claim material, recipient
// private data, notes, viewing keys, and verifier output are never projected.

import type { ClaimableGift, ClaimableGiftState, GiftAsset, GiftHex } from "./claimable-gift";
import { BASE_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_NETWORK } from "./claimable-gift";
import { PAYMENT_CLAIM_PROTOCOL_VERSION } from "./payment-request";

export const PUBLIC_GIFT_EVENT_TYPES = ["created", "funded", "claimable", "claimed", "expired", "refunded"] as const;
export type PublicGiftEventType = (typeof PUBLIC_GIFT_EVENT_TYPES)[number];

export interface PublicGiftProjection {
  readonly protocolVersion: typeof PAYMENT_CLAIM_PROTOCOL_VERSION;
  readonly schemaVersion: number;
  readonly claimId: string;
  readonly network: typeof BASE_SEPOLIA_NETWORK;
  readonly chainId: typeof BASE_SEPOLIA_CHAIN_ID;
  readonly state: ClaimableGiftState;
  readonly asset: GiftAsset;
  readonly amount: string;
  readonly expiresAt: number;
  readonly sender: GiftHex;
  readonly refundRecipient: GiftHex;
  readonly nullifierCommitment: GiftHex;
  readonly recipientBound: boolean;
  readonly createdAt: number;
  readonly fundedAt: number | null;
  readonly claimableAt: number | null;
  readonly claimedAt: number | null;
  readonly expiredAt: number | null;
  readonly refundedAt: number | null;
  readonly fundingTransactionHash: GiftHex | null;
  readonly claimTransactionHash: GiftHex | null;
  readonly refundTransactionHash: GiftHex | null;
}

export interface PublicGiftEvent {
  readonly eventId: string;
  readonly eventName: `Gift${Capitalize<PublicGiftEventType>}`;
  readonly type: PublicGiftEventType;
  readonly protocolVersion: typeof PAYMENT_CLAIM_PROTOCOL_VERSION;
  readonly schemaVersion: number;
  readonly claimId: string;
  readonly network: typeof BASE_SEPOLIA_NETWORK;
  readonly chainId: typeof BASE_SEPOLIA_CHAIN_ID;
  readonly asset: GiftAsset;
  readonly amount: string;
  readonly expiresAt: number;
  readonly sender: GiftHex;
  readonly refundRecipient: GiftHex;
  readonly nullifierCommitment: GiftHex;
  readonly occurredAt: number;
  readonly transactionHash: GiftHex | null;
  readonly blockNumber: number | null;
  readonly recipientBound: boolean;
}

export function toPublicGiftProjection(gift: ClaimableGift): PublicGiftProjection {
  return {
    protocolVersion: gift.protocolVersion,
    schemaVersion: gift.schemaVersion,
    claimId: gift.claimId,
    network: gift.network,
    chainId: gift.chainId,
    state: gift.state,
    asset: gift.asset,
    amount: gift.amount.toString(10),
    expiresAt: gift.expiresAt,
    sender: gift.sender,
    refundRecipient: gift.refundRecipient,
    nullifierCommitment: gift.nullifierCommitment,
    recipientBound: gift.recipient !== null,
    createdAt: gift.createdAt,
    fundedAt: gift.fundedAt,
    claimableAt: gift.claimableAt,
    claimedAt: gift.claimedAt,
    expiredAt: gift.expiredAt,
    refundedAt: gift.refundedAt,
    fundingTransactionHash: gift.fundingTransactionHash,
    claimTransactionHash: gift.claimTransactionHash,
    refundTransactionHash: gift.refundTransactionHash,
  };
}

function eventName(type: PublicGiftEventType): `Gift${Capitalize<PublicGiftEventType>}` {
  return `Gift${type.slice(0, 1).toUpperCase()}${type.slice(1)}` as `Gift${Capitalize<PublicGiftEventType>}`;
}

function eventFor(gift: ClaimableGift, type: PublicGiftEventType): PublicGiftEvent {
  const occurredAt = type === "created"
    ? gift.createdAt
    : type === "funded"
      ? gift.fundedAt!
      : type === "claimable"
        ? gift.claimableAt!
        : type === "claimed"
          ? gift.claimedAt!
          : type === "expired"
            ? gift.expiredAt!
            : gift.refundedAt!;
  const transactionHash = type === "funded"
    ? gift.fundingTransactionHash
    : type === "claimed"
      ? gift.claimTransactionHash
      : type === "refunded"
        ? gift.refundTransactionHash
        : null;
  const blockNumber = type === "funded"
    ? gift.fundingBlockNumber
    : type === "refunded"
      ? gift.refundBlockNumber
      : null;
  return {
    eventId: `${gift.claimId}:${type}`,
    eventName: eventName(type),
    type,
    protocolVersion: gift.protocolVersion,
    schemaVersion: gift.schemaVersion,
    claimId: gift.claimId,
    network: gift.network,
    chainId: gift.chainId,
    asset: gift.asset,
    amount: gift.amount.toString(10),
    expiresAt: gift.expiresAt,
    sender: gift.sender,
    refundRecipient: gift.refundRecipient,
    nullifierCommitment: gift.nullifierCommitment,
    occurredAt,
    transactionHash,
    blockNumber,
    recipientBound: gift.recipient !== null,
  };
}

/** Reconstructs the append-only public lifecycle facts without private proof data. */
export function derivePublicGiftEvents(gift: ClaimableGift): readonly PublicGiftEvent[] {
  const types: PublicGiftEventType[] = ["created"];
  if (gift.fundedAt !== null) types.push("funded");
  if (gift.claimableAt !== null) types.push("claimable");
  if (gift.claimedAt !== null) types.push("claimed");
  if (gift.expiredAt !== null) types.push("expired");
  if (gift.refundedAt !== null) types.push("refunded");
  return types.map((type) => eventFor(gift, type));
}
