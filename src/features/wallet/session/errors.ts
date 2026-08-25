/**
 * Stable, transport-neutral errors for wallet-session authority boundaries.
 *
 * Provider messages are deliberately not copied into this catalogue. Wallet
 * errors can contain addresses, RPC material, or user-entered text; callers
 * receive a safe code/detail pair instead.
 */
export const WALLET_SESSION_ERROR_CODE = {
  CAPABILITY_UNKNOWN: "CAPABILITY_UNKNOWN",
  NETWORK_UNKNOWN: "NETWORK_UNKNOWN",
  NETWORK_MISMATCH: "NETWORK_MISMATCH",
  CONSENT_REQUIRED: "CONSENT_REQUIRED",
  CONSENT_DENIED: "CONSENT_DENIED",
  PROVIDER_DISCONNECTED: "PROVIDER_DISCONNECTED",
  PROVIDER_FAILURE: "PROVIDER_FAILURE",
  ILLEGAL_TRANSITION: "ILLEGAL_TRANSITION",
  STALE_STATE: "STALE_STATE",
  VENUE_MISMATCH: "VENUE_MISMATCH",
  PROOF_REQUIRED: "PROOF_REQUIRED",
  SUBMISSION_REQUIRED: "SUBMISSION_REQUIRED",
  RECEIPT_REQUIRED: "RECEIPT_REQUIRED",
  RECEIPT_MISMATCH: "RECEIPT_MISMATCH",
  SECRET_FORBIDDEN: "SECRET_FORBIDDEN",
  MALFORMED_OBSERVATION: "MALFORMED_OBSERVATION",
} as const;

export type WalletSessionErrorCode =
  (typeof WALLET_SESSION_ERROR_CODE)[keyof typeof WALLET_SESSION_ERROR_CODE];

export class WalletSessionError extends Error {
  readonly code: WalletSessionErrorCode;
  readonly detail: string | null;

  constructor(code: WalletSessionErrorCode, detail: string | null = null) {
    super(`[${code}]${detail ? ` ${detail}` : ""}`);
    this.name = "WalletSessionError";
    this.code = code;
    this.detail = detail;
  }
}

export function isWalletSessionError(value: unknown): value is WalletSessionError {
  return value instanceof WalletSessionError;
}

/** Convert arbitrary provider failures without retaining their raw message. */
export function asProviderFailure(value: unknown): WalletSessionError {
  if (value instanceof WalletSessionError) return value;
  return new WalletSessionError(WALLET_SESSION_ERROR_CODE.PROVIDER_FAILURE, "provider_operation_failed");
}

/** Only user-consent wording is inspected; raw provider text is never returned. */
export function isUserConsentRejection(value: unknown): boolean {
  const message = value instanceof Error ? value.message.toLowerCase() : "";
  return ["reject", "denied", "declin", "cancel", "authoriz"].some((word) => message.includes(word));
}
