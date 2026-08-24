// Stable error catalogue for M4 Wallet API consumer route.
// No raw stacks escape; every domain rejection is a typed Strk20Error.
// Authority: SYSTEM_FOUNDRY error catalogue + AUDIT FT-007 privacy guard.

export const STRK20_ERROR_CODE = {
  CAPABILITY_UNKNOWN: "STRK20-001",
  NETWORK_MISMATCH: "STRK20-002",
  REGISTRATION_REQUIRED: "STRK20-003",
  CONSENT_REQUIRED: "STRK20-004",
  CONSENT_DENIED: "STRK20-005",
  SCREENING_REJECTED: "STRK20-006",
  SCREENING_UNAVAILABLE: "STRK20-007",
  FEE_CHANGED: "STRK20-008",
  FEE_UNAVAILABLE: "STRK20-009",
  MATURITY_PENDING: "STRK20-010",
  STALE_STATE: "STRK20-011",
  ILLEGAL_TRANSITION: "STRK20-012",
  DEPENDENCY_FAILURE: "STRK20-013",
  PRIVACY_OVERCLAIM: "STRK20-014",
  VIEWING_KEY_FORBIDDEN: "STRK20-015",
  INVALID_AMOUNT: "STRK20-016",
  RELAYER_ATTRIBUTION_FORBIDDEN: "STRK20-017",
} as const;

export type Strk20ErrorCode = (typeof STRK20_ERROR_CODE)[keyof typeof STRK20_ERROR_CODE];

const ERROR_SHAPES: Record<Strk20ErrorCode, { name: string; category: string; retryable: string; httpStatusHint: number; userAction: string }> = {
  "STRK20-001": { name: "capability_unknown", category: "unknown", retryable: "re_read", httpStatusHint: 409, userAction: "re_detect_capability" },
  "STRK20-002": { name: "network_mismatch", category: "validation", retryable: "no", httpStatusHint: 409, userAction: "switch_network" },
  "STRK20-003": { name: "registration_required", category: "conflict", retryable: "no", httpStatusHint: 409, userAction: "register_via_wallet" },
  "STRK20-004": { name: "consent_required", category: "authorization", retryable: "no", httpStatusHint: 403, userAction: "grant_balance_consent" },
  "STRK20-005": { name: "consent_denied", category: "authorization", retryable: "no", httpStatusHint: 403, userAction: "retry_with_consent" },
  "STRK20-006": { name: "screening_rejected", category: "privacy", retryable: "no", httpStatusHint: 422, userAction: "screening_rejected_no_retry_same_deposit" },
  "STRK20-007": { name: "screening_unavailable", category: "dependency", retryable: "true_backoff", httpStatusHint: 503, userAction: "wait_retry" },
  "STRK20-008": { name: "fee_changed", category: "stale_state", retryable: "re_quote", httpStatusHint: 409, userAction: "re_quote_fee" },
  "STRK20-009": { name: "fee_unavailable", category: "dependency", retryable: "true_backoff", httpStatusHint: 503, userAction: "wait_retry" },
  "STRK20-010": { name: "maturity_pending", category: "stale_state", retryable: "poll_only", httpStatusHint: 202, userAction: "wait_maturity" },
  "STRK20-011": { name: "stale_state", category: "stale_state", retryable: "re_read", httpStatusHint: 409, userAction: "refresh" },
  "STRK20-012": { name: "illegal_transition", category: "validation", retryable: "no", httpStatusHint: 409, userAction: "refresh" },
  "STRK20-013": { name: "dependency_failure", category: "dependency", retryable: "true_backoff", httpStatusHint: 503, userAction: "wait_retry" },
  "STRK20-014": { name: "privacy_overclaim", category: "validation", retryable: "no", httpStatusHint: 422, userAction: "audit_copy" },
  "STRK20-015": { name: "viewing_key_forbidden", category: "privacy", retryable: "no", httpStatusHint: 400, userAction: "remove_viewing_key" },
  "STRK20-016": { name: "invalid_amount", category: "validation", retryable: "no", httpStatusHint: 422, userAction: "correct_amount" },
  "STRK20-017": { name: "relayer_attribution_forbidden", category: "validation", retryable: "no", httpStatusHint: 422, userAction: "use_pool_event" },
};

export class Strk20Error extends Error {
  readonly code: Strk20ErrorCode;
  readonly category: string;
  readonly retryable: string;
  readonly httpStatusHint: number;
  readonly userAction: string;
  readonly detail?: string;

  constructor(code: Strk20ErrorCode, detail?: string) {
    const shape = ERROR_SHAPES[code] ?? ERROR_SHAPES["STRK20-013"];
    super(`[${code}] ${shape.name}${detail ? ` (${detail})` : ""}`);
    this.code = code;
    this.category = shape.category;
    this.retryable = shape.retryable;
    this.httpStatusHint = shape.httpStatusHint;
    this.userAction = shape.userAction;
    this.detail = detail;
    this.name = shape.name;
  }

  toExternalShape() {
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

export function isStrk20Error(v: unknown): v is Strk20Error {
  return v instanceof Strk20Error;
}
