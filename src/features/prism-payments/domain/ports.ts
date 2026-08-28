// Effect boundaries for the versioned payment/claim feature.
// None of these ports are Registry V2 ports, generic external-call ports, or
// authority shortcuts. Implementations must preserve the immutable request
// terms and optimistic version fence.

import type {
  ClaimableGift,
  GiftClaimAuthorization,
  GiftHex,
  GiftFundingObservation,
} from "./claimable-gift";
import type {
  PaymentApproval,
  PaymentHex,
  PaymentReceiptObservation,
  PaymentRequest,
} from "./payment-request";

export interface PaymentRequestStore {
  create(input: {
    readonly payment: PaymentRequest;
    readonly idempotencyKey: string;
    readonly requestFingerprint: string;
  }): Promise<PaymentRequest>;
  getById(requestId: string): Promise<PaymentRequest | undefined>;
  getByIdempotencyKey(idempotencyKey: string): Promise<PaymentRequest | undefined>;
  update(
    requestId: string,
    expectedVersion: number,
    updater: (current: PaymentRequest) => PaymentRequest,
  ): Promise<PaymentRequest>;
}

export interface ClaimableGiftStore {
  create(gift: ClaimableGift): Promise<ClaimableGift>;
  getById(claimId: string): Promise<ClaimableGift | undefined>;
  update(
    claimId: string,
    expectedVersion: number,
    updater: (current: ClaimableGift) => ClaimableGift,
  ): Promise<ClaimableGift>;
}

/** Global nullifier fence; reserve is atomic and never implicitly released. */
export interface ClaimNullifierStore {
  reserve(nullifier: GiftHex, claimId: string): Promise<"reserved" | "already_reserved">;
}

/** Payer wallet authority. Calling this port is the only submit path. */
export interface PayerWalletPort {
  submitPayment(input: { readonly payment: PaymentRequest }): Promise<{ readonly transactionHash: PaymentHex }>;
}

export interface PaymentReceiptPort {
  observePayment(request: PaymentRequest): Promise<PaymentReceiptObservation | null>;
}

export interface ClaimProofVerifier {
  /**
   * Receives an opaque proof only in memory. The service must not persist or
   * serialize it; the verifier returns the public, checked authorization fact.
   */
  verify(input: {
    readonly claimId: string;
    readonly nullifierCommitment: GiftHex;
    readonly proof: unknown;
    readonly recipientAddress: GiftHex;
  }): Promise<GiftClaimAuthorization | { readonly valid: false; readonly reason?: string }>;
}

/**
 * Narrow Base Sepolia escrow contract boundary. Deliberately no `execute`,
 * arbitrary beneficiary, admin withdrawal, upgrade, or generic call method.
 */
export interface PublicBaseSepoliaEscrowPort {
  readonly chainId: 84_532;
  readonly isTestDouble?: boolean;
  createEscrow(input: {
    readonly claimId: string;
    readonly sender: GiftHex;
    readonly asset: "native" | GiftHex;
    readonly amount: bigint;
    readonly expiresAt: number;
    readonly nullifierCommitment: GiftHex;
  }): Promise<{ readonly transactionHash: GiftHex }>;
  claimEscrow(input: {
    readonly claimId: string;
    readonly recipientAddress: GiftHex;
    readonly nullifier: GiftHex;
  }): Promise<{ readonly transactionHash: GiftHex; readonly blockNumber: number }>;
  /** Refund destination is contract-stored sender; no beneficiary argument. */
  refundEscrow(input: { readonly claimId: string }): Promise<{ readonly transactionHash: GiftHex; readonly blockNumber: number }>;
  observeFunding(claimId: string): Promise<GiftFundingObservation | null>;
}
