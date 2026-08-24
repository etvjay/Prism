// Stable error catalogue for PrismChannel C1 slice.
// Separate code range ERR-030+ to avoid colliding with identity/operation codes.
// Every throw is PrismChannelError with stable code; no raw errors cross boundary.

export const CHANNEL_ERROR_CODE = {
  INVALID_PRISM_ID: "ERR-030",
  INVALID_CHANNEL_ID: "ERR-031",
  INVALID_PARTICIPANTS: "ERR-032",
  NOT_PARTICIPANT: "ERR-033",
  INVALID_STATUS_TRANSITION: "ERR-034",
  CHANNEL_NOT_FOUND: "ERR-035",
  CHANNEL_REVOKED: "ERR-036",
  CHANNEL_ARCHIVED: "ERR-037",
  KEY_COMMITMENT_MISSING: "ERR-038",
  KEY_COMMITMENT_INVALID: "ERR-039",
  CIPHERTEXT_REQUIRED: "ERR-040",
  PLAINTEXT_LEAKAGE: "ERR-041",
  INVALID_CONTENT_TYPE: "ERR-042",
  POLICY_VIOLATION: "ERR-043",
  REPLAY_DETECTED: "ERR-044",
  KEY_REUSE: "ERR-045",
  IMPLICIT_PAYMENT_AUTHORITY: "ERR-046",
  MESSAGE_NOT_FOUND: "ERR-047",
  STORAGE_UNAVAILABLE: "ERR-048",
} as const;

export type ChannelErrorCode = (typeof CHANNEL_ERROR_CODE)[keyof typeof CHANNEL_ERROR_CODE];

const SHAPES: Record<string, { name: string; category: string; retryable: string; userAction: string; httpStatusHint: number }> = {
  "ERR-030": { name: "invalid_prism_id", category: "validation", retryable: "no", userAction: "correct_identifier", httpStatusHint: 422 },
  "ERR-031": { name: "invalid_channel_id", category: "validation", retryable: "no", userAction: "correct_identifier", httpStatusHint: 422 },
  "ERR-032": { name: "invalid_participants", category: "validation", retryable: "no", userAction: "provide_two_distinct_prism_ids", httpStatusHint: 422 },
  "ERR-033": { name: "not_participant", category: "authorization", retryable: "no", userAction: "use_participant_authority", httpStatusHint: 403 },
  "ERR-034": { name: "invalid_status_transition", category: "conflict", retryable: "no", userAction: "check_channel_state", httpStatusHint: 409 },
  "ERR-035": { name: "channel_not_found", category: "not_found", retryable: "no", userAction: "check_channel_id", httpStatusHint: 404 },
  "ERR-036": { name: "channel_revoked", category: "stale_state", retryable: "no", userAction: "channel_revoked_no_messages", httpStatusHint: 410 },
  "ERR-037": { name: "channel_archived", category: "stale_state", retryable: "no", userAction: "channel_archived_no_messages", httpStatusHint: 409 },
  "ERR-038": { name: "key_commitment_missing", category: "validation", retryable: "no", userAction: "provide_key_commitment", httpStatusHint: 422 },
  "ERR-039": { name: "key_commitment_invalid", category: "validation", retryable: "no", userAction: "provide_valid_commitment", httpStatusHint: 422 },
  "ERR-040": { name: "ciphertext_required", category: "validation", retryable: "no", userAction: "provide_ciphertext", httpStatusHint: 422 },
  "ERR-041": { name: "plaintext_leakage", category: "validation", retryable: "no", userAction: "use_ciphertext_only", httpStatusHint: 422 },
  "ERR-042": { name: "invalid_content_type", category: "validation", retryable: "no", userAction: "use_allowed_content_type", httpStatusHint: 422 },
  "ERR-043": { name: "policy_violation", category: "policy", retryable: "no", userAction: "check_channel_policy", httpStatusHint: 403 },
  "ERR-044": { name: "replay_detected", category: "replay", retryable: "no", userAction: "use_new_message_id", httpStatusHint: 409 },
  "ERR-045": { name: "key_reuse", category: "conflict", retryable: "no", userAction: "use_distinct_commitments", httpStatusHint: 409 },
  "ERR-046": { name: "implicit_payment_authority", category: "policy", retryable: "no", userAction: "explicit_authorization_required", httpStatusHint: 403 },
  "ERR-047": { name: "message_not_found", category: "not_found", retryable: "no", userAction: "check_message_id", httpStatusHint: 404 },
  "ERR-048": { name: "storage_unavailable", category: "dependency", retryable: "true_backoff", userAction: "retry", httpStatusHint: 503 },
};

export class PrismChannelError extends Error {
  readonly code: ChannelErrorCode;
  readonly name: string;
  readonly category: string;
  readonly retryable: string;
  readonly userAction: string;
  readonly httpStatusHint: number;
  readonly detail?: string;

  constructor(code: ChannelErrorCode, detail?: string) {
    const shape = SHAPES[code] ?? SHAPES["ERR-034"];
    super(`[${code}] ${shape.name}${detail ? ` (${detail})` : ""}`);
    this.code = code;
    this.name = shape.name;
    this.category = shape.category;
    this.retryable = shape.retryable;
    this.userAction = shape.userAction;
    this.httpStatusHint = shape.httpStatusHint;
    this.detail = detail;
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

export function isChannelError(v: unknown): v is PrismChannelError {
  return v instanceof PrismChannelError;
}
