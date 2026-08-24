// Prism Pause stable error/reason catalogue — P0–P4 foundation.
// Authority: System Foundry ERROR_CATALOGUE + PRISM_PAUSE_PHASE_PLAN §§5–6.
// Every error is a stable domain contract; no raw stacks leak. UNKNOWN is
// fail-closed (blocking) per plan §5.

export const PAUSE_ERROR_CODE = {
  // Inherited / shared validation
  INVALID_INTENT: "ERR-100",
  INVALID_PLAN: "ERR-101",
  PLAN_HASH_MISMATCH: "ERR-102",
  POLICY_VERSION_MISMATCH: "ERR-103",
  APPROVAL_SCOPE_MISMATCH: "ERR-104",
  INTENT_EXPIRED: "ERR-105",
  PAUSE_EXPIRED: "ERR-106",
  IDEMPOTENCY_CONFLICT: "ERR-107",
  PAUSE_NOT_FOUND: "ERR-108",
  INTENT_NOT_FOUND: "ERR-109",
  ILLEGAL_TRANSITION: "ERR-110",
  STALE_VERSION: "ERR-111",
  DUPLICATE_PAUSE: "ERR-112",
  EXPIRED_PAUSE_CANNOT_RELEASE: "ERR-113",
  APPROVAL_REQUIRED: "ERR-114",
  APPROVAL_REPLAY: "ERR-115",
  CHECK_UNKNOWN_BLOCKING: "ERR-116",
  RELEASE_NOT_READY: "ERR-117",
  CANCEL_NOT_ALLOWED: "ERR-118",
  ESCALATE_NOT_ALLOWED: "ERR-119",
  REVERIFY_NOT_ALLOWED: "ERR-120",
  INVALID_STATE: "ERR-121",
  OPERATION_ALREADY_LINKED: "ERR-122",
  // Preserve existing system codes where applicable
  STALE_STATE_CONFLICT: "ERR-023",
  RPC_UNAVAILABLE: "ERR-021",
} as const;

export type PauseErrorCode = (typeof PAUSE_ERROR_CODE)[keyof typeof PAUSE_ERROR_CODE];

const SHAPES: Record<string, { name: string; category: string; retryable: string; userAction: string; httpStatusHint: number }> = {
  "ERR-100": { name: "invalid_intent", category: "validation", retryable: "no", userAction: "correct_intent", httpStatusHint: 422 },
  "ERR-101": { name: "invalid_plan", category: "validation", retryable: "no", userAction: "correct_plan", httpStatusHint: 422 },
  "ERR-102": { name: "plan_hash_mismatch", category: "conflict", retryable: "no", userAction: "reverify_with_current_plan", httpStatusHint: 409 },
  "ERR-103": { name: "policy_version_mismatch", category: "conflict", retryable: "no", userAction: "reverify_policy", httpStatusHint: 409 },
  "ERR-104": { name: "approval_scope_mismatch", category: "authorization", retryable: "no", userAction: "approve_exact_plan", httpStatusHint: 403 },
  "ERR-105": { name: "intent_expired", category: "stale_state", retryable: "no", userAction: "create_new_intent", httpStatusHint: 410 },
  "ERR-106": { name: "pause_expired", category: "stale_state", retryable: "no", userAction: "create_new_intent", httpStatusHint: 410 },
  "ERR-107": { name: "idempotency_conflict", category: "conflict", retryable: "no", userAction: "reuse_same_payload", httpStatusHint: 409 },
  "ERR-108": { name: "pause_not_found", category: "not_found", retryable: "no", userAction: "check_pause_id", httpStatusHint: 404 },
  "ERR-109": { name: "intent_not_found", category: "not_found", retryable: "no", userAction: "check_intent_id", httpStatusHint: 404 },
  "ERR-110": { name: "illegal_transition", category: "stale_state", retryable: "no", userAction: "refresh_state", httpStatusHint: 409 },
  "ERR-111": { name: "stale_version", category: "stale_state", retryable: "re_read", userAction: "refresh", httpStatusHint: 409 },
  "ERR-112": { name: "duplicate_pause", category: "conflict", retryable: "no", userAction: "use_existing_pause", httpStatusHint: 409 },
  "ERR-113": { name: "expired_pause_cannot_release", category: "stale_state", retryable: "no", userAction: "create_new_intent", httpStatusHint: 410 },
  "ERR-114": { name: "approval_required", category: "authorization", retryable: "no", userAction: "obtain_approval", httpStatusHint: 403 },
  "ERR-115": { name: "approval_replay", category: "replay", retryable: "no", userAction: "approve_once_per_intent", httpStatusHint: 409 },
  "ERR-116": { name: "check_unknown_blocking", category: "dependency", retryable: "no", userAction: "resolve_unknown_check", httpStatusHint: 409 },
  "ERR-117": { name: "release_not_ready", category: "conflict", retryable: "no", userAction: "verify_first", httpStatusHint: 409 },
  "ERR-118": { name: "cancel_not_allowed", category: "conflict", retryable: "no", userAction: "check_state", httpStatusHint: 409 },
  "ERR-119": { name: "escalate_not_allowed", category: "conflict", retryable: "no", userAction: "check_state", httpStatusHint: 409 },
  "ERR-120": { name: "reverify_not_allowed", category: "conflict", retryable: "no", userAction: "check_state", httpStatusHint: 409 },
  "ERR-121": { name: "invalid_state", category: "validation", retryable: "no", userAction: "correct_state", httpStatusHint: 422 },
  "ERR-122": { name: "operation_already_linked", category: "conflict", retryable: "no", userAction: "use_existing_operation", httpStatusHint: 409 },
  "ERR-023": { name: "stale_state_conflict", category: "stale_state", retryable: "re_read", userAction: "refresh", httpStatusHint: 409 },
  "ERR-021": { name: "rpc_unavailable", category: "dependency", retryable: "true_backoff", userAction: "wait_retry", httpStatusHint: 503 },
};

export class PauseError extends Error {
  readonly code: PauseErrorCode;
  readonly name: string;
  readonly category: string;
  readonly retryable: string;
  readonly userAction: string;
  readonly httpStatusHint: number;
  readonly detail?: string;
  constructor(code: PauseErrorCode, detail?: string) {
    const shape = SHAPES[code] ?? SHAPES["ERR-110"];
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

// Stable reason codes for typed checks (PRISM_PAUSE §5).
export const PAUSE_REASON_CODE = {
  // Identity & recipient
  IDENTITY_MISMATCH: "PAUSE-IDENTITY-001",
  RECIPIENT_RESOLVE_FAIL: "PAUSE-RECIPIENT-001",
  RECIPIENT_NOT_BOUND_OR_REVOKED: "PAUSE-RECIPIENT-002",
  FIRST_USE: "PAUSE-RECIPIENT-003",
  // Amount / frequency
  AMOUNT_CEILING: "PAUSE-RISK-001",
  AMOUNT_DEVIATION: "PAUSE-RISK-002",
  FREQUENCY_LIMIT: "PAUSE-RISK-003",
  FEE_SLIPPAGE: "PAUSE-RISK-004",
  // Authority & route
  INITIATOR_INVALID: "PAUSE-AUTH-001",
  AGENT_SCOPE: "PAUSE-AUTH-002",
  ADDITIONAL_APPROVAL: "PAUSE-AUTH-003",
  CHAIN_NOT_ALLOWED: "PAUSE-ROUTE-001",
  ASSET_NOT_ALLOWED: "PAUSE-ROUTE-002",
  CONTRACT_NOT_ALLOWED: "PAUSE-ROUTE-003",
  ROUTE_REVOKED_OR_STALE: "PAUSE-ROUTE-004",
  // Intent integrity & simulation
  INTENT_PLAN_MISMATCH: "PAUSE-INTENT-001",
  CALLDATA_MISMATCH: "PAUSE-INTENT-002",
  SIMULATION_FAIL: "PAUSE-SIM-001",
  SIMULATION_EFFECT_MISMATCH: "PAUSE-SIM-002",
  SIMULATION_STALE: "PAUSE-SIM-003",
  SIMULATION_UNKNOWN: "PAUSE-SIM-004",
  POLICY_VERSION_MISMATCH: "PAUSE-POLICY-001",
  // Generic
  UNKNOWN_BLOCKING: "PAUSE-UNKNOWN-001",
} as const;

export type PauseReasonCode = (typeof PAUSE_REASON_CODE)[keyof typeof PAUSE_REASON_CODE];
