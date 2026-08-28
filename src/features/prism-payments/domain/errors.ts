// Stable errors for the versioned payment/claim boundary.
// This range is intentionally separate from the immutable Registry V2 errors;
// no payment/claim error is a registry revert or a live-chain receipt claim.

export const PAYMENT_CLAIM_ERROR_CODE = {
  INVALID_REQUEST: "ERR-050",
  INVALID_CHAIN: "ERR-051",
  INVALID_ASSET: "ERR-052",
  INVALID_AMOUNT: "ERR-053",
  INVALID_EXPIRY: "ERR-054",
  INVALID_STATE_TRANSITION: "ERR-055",
  WALLET_APPROVAL_REQUIRED: "ERR-056",
  APPROVAL_TERMS_MISMATCH: "ERR-057",
  TRANSACTION_HASH_REQUIRED: "ERR-058",
  REPLAY_DETECTED: "ERR-059",
  PAYMENT_NOT_FOUND: "ERR-060",
  VERSION_CONFLICT: "ERR-061",
  ESCROW_UNAVAILABLE: "ERR-062",
  CLAIM_PROOF_INVALID: "ERR-063",
  CLAIM_EXPIRED: "ERR-064",
  UNAUTHORIZED: "ERR-065",
  NULLIFIER_REPLAY: "ERR-066",
  CLAIM_NOT_FOUND: "ERR-067",
  NETWORK_MISMATCH: "ERR-068",
  RECEIPT_MISMATCH: "ERR-069",
  REFUND_NOT_AVAILABLE: "ERR-070",
  CONTRACT_UNSAFE: "ERR-071",
  WALLET_REJECTED: "ERR-072",
  SUBMISSION_STATUS_UNKNOWN: "ERR-073",
} as const;

export type PaymentClaimErrorCode = (typeof PAYMENT_CLAIM_ERROR_CODE)[keyof typeof PAYMENT_CLAIM_ERROR_CODE];

const SHAPES: Record<PaymentClaimErrorCode, { name: string; category: string; retryable: string; userAction: string; httpStatusHint: number }> = {
  "ERR-050": { name: "invalid_request", category: "validation", retryable: "no", userAction: "correct_input", httpStatusHint: 422 },
  "ERR-051": { name: "invalid_chain", category: "validation", retryable: "no", userAction: "use_base_sepolia", httpStatusHint: 422 },
  "ERR-052": { name: "invalid_asset", category: "validation", retryable: "no", userAction: "correct_asset", httpStatusHint: 422 },
  "ERR-053": { name: "invalid_amount", category: "validation", retryable: "no", userAction: "correct_amount", httpStatusHint: 422 },
  "ERR-054": { name: "invalid_expiry", category: "validation", retryable: "no", userAction: "choose_future_expiry", httpStatusHint: 422 },
  "ERR-055": { name: "invalid_state_transition", category: "stale_state", retryable: "no", userAction: "refresh_resource", httpStatusHint: 409 },
  "ERR-056": { name: "wallet_approval_required", category: "authorization", retryable: "no", userAction: "approve_in_payer_wallet", httpStatusHint: 403 },
  "ERR-057": { name: "approval_terms_mismatch", category: "authorization", retryable: "no", userAction: "review_payment_terms", httpStatusHint: 409 },
  "ERR-058": { name: "transaction_hash_required", category: "validation", retryable: "no", userAction: "submit_from_wallet", httpStatusHint: 422 },
  "ERR-059": { name: "replay_detected", category: "replay", retryable: "no", userAction: "use_new_request_or_proof", httpStatusHint: 409 },
  "ERR-060": { name: "payment_not_found", category: "not_found", retryable: "no", userAction: "check_request_id", httpStatusHint: 404 },
  "ERR-061": { name: "version_conflict", category: "stale_state", retryable: "re_read", userAction: "refresh_resource", httpStatusHint: 409 },
  "ERR-062": { name: "escrow_unavailable", category: "dependency", retryable: "true_backoff", userAction: "wait_retry", httpStatusHint: 503 },
  "ERR-063": { name: "claim_proof_invalid", category: "authorization", retryable: "no", userAction: "provide_valid_claim_proof", httpStatusHint: 403 },
  "ERR-064": { name: "claim_expired", category: "stale_state", retryable: "no", userAction: "request_new_claim", httpStatusHint: 410 },
  "ERR-065": { name: "unauthorized", category: "authorization", retryable: "no", userAction: "use_authorized_actor", httpStatusHint: 403 },
  "ERR-066": { name: "nullifier_replay", category: "replay", retryable: "no", userAction: "use_unconsumed_claim_proof", httpStatusHint: 409 },
  "ERR-067": { name: "claim_not_found", category: "not_found", retryable: "no", userAction: "check_claim_id", httpStatusHint: 404 },
  "ERR-068": { name: "network_mismatch", category: "validation", retryable: "no", userAction: "switch_to_base_sepolia", httpStatusHint: 422 },
  "ERR-069": { name: "receipt_mismatch", category: "stale_state", retryable: "poll_only", userAction: "verify_receipt", httpStatusHint: 409 },
  "ERR-070": { name: "refund_not_available", category: "stale_state", retryable: "no", userAction: "wait_for_expiry", httpStatusHint: 409 },
  "ERR-071": { name: "unsafe_contract_surface", category: "unsupported", retryable: "no", userAction: "use_reviewed_escrow", httpStatusHint: 501 },
  "ERR-072": { name: "wallet_rejected", category: "authorization", retryable: "no", userAction: "review_and_retry", httpStatusHint: 409 },
  "ERR-073": { name: "submission_status_unknown", category: "stale_state", retryable: "poll_only", userAction: "poll_existing_transaction", httpStatusHint: 202 },
};

export class PaymentClaimError extends Error {
  readonly code: PaymentClaimErrorCode;
  readonly category: string;
  readonly retryable: string;
  readonly userAction: string;
  readonly httpStatusHint: number;
  readonly detail?: string;

  constructor(code: PaymentClaimErrorCode, detail?: string) {
    const shape = SHAPES[code];
    super(`[${code}] ${shape.name}${detail ? ` (${detail})` : ""}`);
    this.name = shape.name;
    this.code = code;
    this.category = shape.category;
    this.retryable = shape.retryable;
    this.userAction = shape.userAction;
    this.httpStatusHint = shape.httpStatusHint;
    this.detail = detail;
  }

  toExternalShape(): { code: string; name: string; category: string; retryable: string; userAction: string; httpStatusHint: number; detail?: string } {
    return {
      code: this.code,
      name: this.name,
      category: this.category,
      retryable: this.retryable,
      userAction: this.userAction,
      httpStatusHint: this.httpStatusHint,
      ...(this.detail ? { detail: this.detail } : {}),
    };
  }
}

export function isPaymentClaimError(value: unknown): value is PaymentClaimError {
  return value instanceof PaymentClaimError;
}
