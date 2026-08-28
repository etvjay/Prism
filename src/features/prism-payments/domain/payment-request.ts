// Prism v0 request-payment boundary.
// This aggregate is deliberately separate from Registry V2 and from the
// generic chain Operation lifecycle. It owns the payer-facing request state;
// a submitted chain operation may be linked later without replacing this view.

import { PAYMENT_CLAIM_ERROR_CODE, PaymentClaimError } from "./errors";

export const PAYMENT_CLAIM_PROTOCOL_VERSION = "v0" as const;
export const PAYMENT_REQUEST_SCHEMA_VERSION = 1 as const;
export const BASE_SEPOLIA_CHAIN_ID = 84_532 as const;
export const BASE_SEPOLIA_NETWORK = "BASE_SEPOLIA" as const;
export const PAYMENT_REQUEST_STATES = [
  "requested",
  "viewed",
  "approved",
  "submitted",
  "processing",
  "confirmed",
  "rejected",
  "expired",
  "reverted",
  "cancelled",
  "unknown",
] as const;
export type PaymentRequestState = (typeof PAYMENT_REQUEST_STATES)[number];
export type PaymentHex = `0x${string}`;
export type PaymentAsset = "native" | PaymentHex;
export type PaymentRecipientKind = "prism_id" | "claim_token" | "alias" | "email" | "address";

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

function validateRecipient(recipient: PaymentRecipient): void {
  if (!recipient || typeof recipient !== "object") {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.INVALID_REQUEST, "recipient_required");
  }
  if (!( ["prism_id", "claim_token", "alias", "email", "address"] as readonly string[]).includes(recipient.kind)) {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.INVALID_REQUEST, "recipient_kind_invalid");
  }
  if (!HASH_PATTERN.test(recipient.commitment)) {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.INVALID_REQUEST, "recipient_commitment_invalid");
  }
  const record = recipient as unknown as Record<string, unknown>;
  if (recipient.kind !== "prism_id" && ("prismId" in record || "resolvedPrismId" in record)) {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.INVALID_REQUEST, "external_recipient_must_not_infer_prism_id");
  }
}

/**
 * An external recipient is represented by a caller-provided commitment. The
 * commitment is not resolved to, or interpreted as, a Prism ID by this lane.
 */
export type PaymentRecipient = {
  readonly kind: PaymentRecipientKind;
  readonly commitment: PaymentHex;
};

export interface PaymentApproval {
  readonly requestId: string;
  readonly walletAddress: PaymentHex;
  readonly chainId: typeof BASE_SEPOLIA_CHAIN_ID;
  readonly asset: PaymentAsset;
  readonly amount: bigint;
  readonly recipientCommitment: PaymentHex;
  readonly expiresAt: number;
  readonly approvedAt: number;
  /** Opaque provider reference; never a signature, proof, or secret. */
  readonly approvalReference: string;
  /** Binds approval to the exact request terms without storing raw calldata. */
  readonly termsCommitment: PaymentHex;
}

export interface PaymentRequest {
  readonly protocolVersion: typeof PAYMENT_CLAIM_PROTOCOL_VERSION;
  readonly schemaVersion: typeof PAYMENT_REQUEST_SCHEMA_VERSION;
  readonly requestId: string;
  readonly requesterRef: string;
  readonly recipient: PaymentRecipient;
  readonly asset: PaymentAsset;
  readonly amount: bigint;
  readonly chainId: typeof BASE_SEPOLIA_CHAIN_ID;
  readonly expiresAt: number;
  readonly state: PaymentRequestState;
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly approval: PaymentApproval | null;
  readonly transactionHash: PaymentHex | null;
  readonly operationId: string | null;
  readonly submissionAttempted: boolean;
  readonly viewedAt: number | null;
  readonly rejectedAt: number | null;
  readonly rejectionReason: string | null;
  readonly confirmedAt: number | null;
  readonly confirmationBlockNumber: number | null;
  readonly errorCode: string | null;
  readonly errorDetail: string | null;
}

export interface CreatePaymentRequestInput {
  readonly requestId: string;
  readonly requesterRef: string;
  readonly recipient: PaymentRecipient;
  readonly asset: PaymentAsset;
  readonly amount: bigint;
  readonly chainId: typeof BASE_SEPOLIA_CHAIN_ID;
  readonly expiresAt: number;
  readonly now: number;
}

export function createPaymentRequest(input: CreatePaymentRequestInput): PaymentRequest {
  if (input.chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.INVALID_CHAIN, `expected_${BASE_SEPOLIA_CHAIN_ID}`);
  }
  if (typeof input.amount !== "bigint" || input.amount <= 0n) {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.INVALID_AMOUNT, "amount_must_be_positive");
  }
  validateRecipient(input.recipient);
  if (!Number.isSafeInteger(input.now) || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= input.now) {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.INVALID_EXPIRY, "expiry_must_be_after_now");
  }
  return {
    protocolVersion: PAYMENT_CLAIM_PROTOCOL_VERSION,
    schemaVersion: PAYMENT_REQUEST_SCHEMA_VERSION,
    requestId: input.requestId,
    requesterRef: input.requesterRef,
    recipient: input.recipient,
    asset: input.asset,
    amount: input.amount,
    chainId: input.chainId,
    expiresAt: input.expiresAt,
    state: "requested",
    version: 0,
    createdAt: input.now,
    updatedAt: input.now,
    approval: null,
    transactionHash: null,
    operationId: null,
    submissionAttempted: false,
    viewedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    confirmedAt: null,
    confirmationBlockNumber: null,
    errorCode: null,
    errorDetail: null,
  };
}

export interface PaymentReceiptObservation {
  readonly requestId: string;
  readonly transactionHash: PaymentHex;
  readonly chainId: typeof BASE_SEPOLIA_CHAIN_ID;
  readonly status: "succeeded" | "reverted" | "pending" | "unknown";
  readonly blockNumber: number | null;
}

export interface PaymentTransitionInput {
  readonly to: PaymentRequestState;
  readonly now: number;
  readonly transactionHash?: PaymentHex | null;
  readonly rejectionReason?: string | null;
  readonly errorCode?: string | null;
  readonly errorDetail?: string | null;
  /** Monotonic fence; true means the wallet boundary was entered. */
  readonly submissionAttempted?: boolean;
  readonly actorRef?: string;
  readonly receipt?: PaymentReceiptObservation;
}

/** First vertical state transition; later transitions remain fail-closed. */
export function transitionPaymentRequest(payment: PaymentRequest, input: PaymentTransitionInput): PaymentRequest {
  if (payment.state === "requested" && input.to === "viewed") {
    return {
      ...payment,
      state: "viewed",
      version: payment.version + 1,
      updatedAt: input.now,
      viewedAt: input.now,
    };
  }
  if (payment.state === "approved" && input.to === "submitted" && input.transactionHash) {
    return {
      ...payment,
      state: "submitted",
      version: payment.version + 1,
      updatedAt: input.now,
      transactionHash: input.transactionHash,
    };
  }
  if (payment.state === "submitted" && input.to === "processing" && payment.transactionHash) {
    return {
      ...payment,
      state: "processing",
      version: payment.version + 1,
      updatedAt: input.now,
    };
  }
  if (payment.state === "approved" && input.to === "unknown" && input.submissionAttempted === true) {
    return {
      ...payment,
      state: "unknown",
      version: payment.version + 1,
      updatedAt: input.now,
      submissionAttempted: true,
      errorCode: input.errorCode ?? PAYMENT_CLAIM_ERROR_CODE.SUBMISSION_STATUS_UNKNOWN,
      errorDetail: input.errorDetail ?? "submission_boundary_entered",
    };
  }
  if ((payment.state === "submitted" || payment.state === "processing") && input.to === "unknown" && payment.transactionHash) {
    return {
      ...payment,
      state: "unknown",
      version: payment.version + 1,
      updatedAt: input.now,
      errorCode: input.errorCode ?? null,
      errorDetail: input.errorDetail ?? null,
    };
  }
  if (payment.state === "unknown" && input.to === "processing" && payment.transactionHash) {
    const receipt = input.receipt;
    if (
      receipt &&
      receipt.requestId === payment.requestId &&
      receipt.transactionHash === payment.transactionHash &&
      receipt.chainId === payment.chainId &&
      (receipt.status === "pending" || receipt.status === "succeeded")
    ) {
      return {
        ...payment,
        state: "processing",
        version: payment.version + 1,
        updatedAt: input.now,
      };
    }
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.RECEIPT_MISMATCH, "existing_transaction_observation_mismatch");
  }
  if (payment.state === "unknown" && input.to === "submitted" && payment.submissionAttempted && input.transactionHash) {
    return {
      ...payment,
      state: "submitted",
      version: payment.version + 1,
      updatedAt: input.now,
      transactionHash: input.transactionHash,
    };
  }
  if (payment.state === "unknown" && input.to === "rejected" && payment.submissionAttempted) {
    return {
      ...payment,
      state: "rejected",
      version: payment.version + 1,
      updatedAt: input.now,
      rejectedAt: input.now,
      rejectionReason: input.rejectionReason ?? "payer_declined",
    };
  }
  if ((payment.state === "requested" || payment.state === "viewed" || payment.state === "approved") && input.to === "cancelled") {
    if (input.actorRef !== payment.requesterRef) {
      throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.UNAUTHORIZED, "requester_authority_required");
    }
    return {
      ...payment,
      state: "cancelled",
      version: payment.version + 1,
      updatedAt: input.now,
    };
  }
  if ((payment.state === "requested" || payment.state === "viewed" || payment.state === "approved") && input.to === "expired") {
    if (input.now < payment.expiresAt) {
      throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.REFUND_NOT_AVAILABLE, "payment_request_not_expired");
    }
    return {
      ...payment,
      state: "expired",
      version: payment.version + 1,
      updatedAt: input.now,
    };
  }
  if (payment.state === "processing" && input.to === "confirmed") {
    const receipt = input.receipt;
    if (
      receipt &&
      receipt.requestId === payment.requestId &&
      receipt.transactionHash === payment.transactionHash &&
      receipt.chainId === payment.chainId &&
      receipt.status === "succeeded" &&
      Number.isSafeInteger(receipt.blockNumber) &&
      (receipt.blockNumber as number) >= 0
    ) {
      return {
        ...payment,
        state: "confirmed",
        version: payment.version + 1,
        updatedAt: input.now,
        confirmedAt: input.now,
        confirmationBlockNumber: receipt.blockNumber,
      };
    }
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.RECEIPT_MISMATCH, "receipt_does_not_match_request");
  }
  if ((payment.state === "submitted" || payment.state === "processing") && input.to === "reverted") {
    const receipt = input.receipt;
    if (
      receipt &&
      receipt.requestId === payment.requestId &&
      receipt.transactionHash === payment.transactionHash &&
      receipt.chainId === payment.chainId &&
      receipt.status === "reverted" &&
      input.errorCode
    ) {
      return {
        ...payment,
        state: "reverted",
        version: payment.version + 1,
        updatedAt: input.now,
        errorCode: input.errorCode,
        errorDetail: input.errorDetail ?? null,
      };
    }
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.RECEIPT_MISMATCH, "revert_receipt_does_not_match_request");
  }
  if (input.to === "confirmed") {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.RECEIPT_MISMATCH, "receipt_observation_required");
  }
  if ((payment.state === "requested" || payment.state === "viewed" || payment.state === "approved") && input.to === "rejected") {
    return {
      ...payment,
      state: "rejected",
      version: payment.version + 1,
      updatedAt: input.now,
      rejectedAt: input.now,
      rejectionReason: input.rejectionReason ?? null,
    };
  }
  throw new Error(`illegal_payment_request_transition:${payment.state}->${input.to}`);
}

export interface ApprovePaymentRequestInput {
  readonly now: number;
  readonly approval: PaymentApproval;
}

export function approvePaymentRequest(payment: PaymentRequest, input: ApprovePaymentRequestInput): PaymentRequest {
  if (payment.state !== "viewed") {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.WALLET_APPROVAL_REQUIRED, `approval_requires_viewed:${payment.state}`);
  }
  const approval = input.approval;
  if (
    approval.requestId !== payment.requestId ||
    approval.chainId !== payment.chainId ||
    approval.asset !== payment.asset ||
    approval.amount !== payment.amount ||
    approval.recipientCommitment !== payment.recipient.commitment ||
    approval.expiresAt !== payment.expiresAt
  ) {
    throw new PaymentClaimError(PAYMENT_CLAIM_ERROR_CODE.APPROVAL_TERMS_MISMATCH, "payment_wallet_approval_terms_mismatch");
  }
  return {
    ...payment,
    state: "approved",
    version: payment.version + 1,
    updatedAt: input.now,
    approval,
  };
}
