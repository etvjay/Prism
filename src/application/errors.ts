// Stable application error catalogue — transport-neutral.
// Maps to System Foundry ERROR_CATALOGUE (projects/prism/system/errors.yaml)
// and OPERATION errors. No stack traces leak; every throw is AppError with
// stable code, category, retryable, userAction, httpStatusHint.

export const APP_ERROR_CODE = {
  INVALID_VENUE: "ERR-001",
  IDENTITY_NOT_FOUND: "ERR-002",
  INVALID_SIGNER: "ERR-003",
  NOT_CONTROLLER: "ERR-004",
  INVALID_EXECUTION_ACCOUNT: "ERR-005",
  NONCE_ALREADY_USED: "ERR-006",
  PROOF_DIGEST_ALREADY_CONSUMED: "ERR-007",
  BINDING_ALREADY_ACTIVE: "ERR-008",
  BINDING_NOT_FOUND: "ERR-009",
  IDENTITY_NOT_FOUND_READ: "ERR-010",
  BINDING_ALREADY_REVOKED: "ERR-011",
  ALTERED_MESSAGE: "ERR-012",
  PROOF_EXPIRED: "ERR-013",
  UNSUPPORTED_SIGNATURE_CLASS: "ERR-014",
  RPC_UNAVAILABLE: "ERR-021",
  TIMEOUT_UNKNOWN_STATUS: "ERR-022",
  STALE_STATE_CONFLICT: "ERR-023",
} as const;

export type AppErrorCode = (typeof APP_ERROR_CODE)[keyof typeof APP_ERROR_CODE];

const SHAPES: Record<string, { name: string; category: string; retryable: string; userAction: string; httpStatusHint: number }> = {
  "ERR-001": { name: "invalid_venue", category: "validation", retryable: "no", userAction: "use_supported_venue", httpStatusHint: 422 },
  "ERR-002": { name: "identity_not_found", category: "not_found", retryable: "no", userAction: "check_identifier", httpStatusHint: 404 },
  "ERR-003": { name: "invalid_signer", category: "authentication", retryable: "false_new_challenge", userAction: "reconnect_wallet_restart_flow", httpStatusHint: 401 },
  "ERR-004": { name: "not_controller", category: "authorization", retryable: "no", userAction: "sign_with_controller_account", httpStatusHint: 403 },
  "ERR-005": { name: "invalid_execution_account", category: "validation", retryable: "no", userAction: "correct_input", httpStatusHint: 422 },
  "ERR-006": { name: "nonce_already_used", category: "replay", retryable: "false_new_challenge", userAction: "restart_binding_flow", httpStatusHint: 409 },
  "ERR-007": { name: "proof_digest_already_consumed", category: "replay", retryable: "false_new_proof", userAction: "restart_binding_flow", httpStatusHint: 409 },
  "ERR-008": { name: "binding_already_active", category: "conflict", retryable: "no", userAction: "resolve_current_binding_first", httpStatusHint: 409 },
  "ERR-009": { name: "binding_not_found", category: "not_found", retryable: "no", userAction: "check_binding_exists", httpStatusHint: 404 },
  "ERR-010": { name: "identity_not_found_read", category: "not_found", retryable: "no", userAction: "n_a", httpStatusHint: 404 },
  "ERR-011": { name: "binding_already_revoked", category: "stale_state", retryable: "benign_returns_existing_fact", userAction: "none_needed", httpStatusHint: 200 },
  "ERR-012": { name: "altered_message", category: "validation", retryable: "false_new_challenge", userAction: "restart_flow", httpStatusHint: 400 },
  "ERR-013": { name: "proof_expired", category: "stale_state", retryable: "new_challenge", userAction: "restart_flow", httpStatusHint: 410 },
  "ERR-014": { name: "unsupported_signature_class", category: "unsupported", retryable: "no", userAction: "use_supported_wallet_type", httpStatusHint: 422 },
  "ERR-021": { name: "rpc_unavailable", category: "dependency", retryable: "true_backoff", userAction: "wait_retry", httpStatusHint: 503 },
  "ERR-022": { name: "timeout_unknown_status", category: "stale_state", retryable: "poll_only", userAction: "honest_still_processing", httpStatusHint: 202 },
  "ERR-023": { name: "stale_state_conflict", category: "stale_state", retryable: "re_read", userAction: "refresh", httpStatusHint: 409 },
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly name: string;
  readonly category: string;
  readonly retryable: string;
  readonly userAction: string;
  readonly httpStatusHint: number;
  readonly detail?: string;
  constructor(code: AppErrorCode, detail?: string) {
    const shape = SHAPES[code] ?? SHAPES["ERR-023"];
    super(`[${code}] ${shape.name}${detail ? ` (${detail})` : ""}`);
    this.code = code;
    this.name = shape.name;
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

export function isAppError(v: unknown): v is AppError {
  return v instanceof AppError;
}

// Helpers to map domain errors to stable AppError without inventing codes.
export function mapPrismErrorToApp(cause: unknown): AppError {
  // PrismError shape: code like ERR-012
  const code = (cause as { code?: string })?.code;
  const detail = (cause as { detail?: string })?.detail;
  if (code && SHAPES[code]) return new AppError(code as AppErrorCode, detail);
  return new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, detail ?? String((cause as Error)?.message ?? "unknown"));
}

export function mapOperationErrorToApp(cause: unknown): AppError {
  const code = (cause as { code?: string })?.code;
  const detail = (cause as { detail?: string })?.detail;
  if (code && SHAPES[code]) return new AppError(code as AppErrorCode, detail);
  return new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, detail ?? String((cause as Error)?.message ?? "unknown"));
}
