// Stable error semantics for the SM-PRISM-003 operation lifecycle.
// Mirrors projects/prism/system/errors.yaml authority (ERROR_CATALOGUE.md).
// No raw stacks escape; every throw is a typed OperationError with a stable
// catalogue code, category, retryability, and user action.

export const OPERATION_ERROR_CODE = {
  INVALID_VENUE: "ERR-001",
  IDENTITY_NOT_FOUND: "ERR-002",
  NOT_CONTROLLER: "ERR-004",
  INVALID_EXECUTION_ACCOUNT: "ERR-005",
  BINDING_ALREADY_REVOKED: "ERR-011",
  RPC_UNAVAILABLE: "ERR-021",
  TIMEOUT_UNKNOWN_STATUS: "ERR-022",
  STALE_STATE_CONFLICT: "ERR-023",
  ILLEGAL_OPERATION_TRANSITION: "ERR-023",
  UNKNOWN_OPERATION_STATE: "ERR-023",
} as const;

export type OperationErrorCode = (typeof OPERATION_ERROR_CODE)[keyof typeof OPERATION_ERROR_CODE];

const ERROR_SHAPES: Record<string, { name: string; category: string; retryable: string; userAction: string; httpStatusHint: number }> = {
  "ERR-001": { name: "invalid_venue", category: "validation", retryable: "no", userAction: "use_supported_venue", httpStatusHint: 422 },
  "ERR-002": { name: "identity_not_found", category: "not_found", retryable: "no", userAction: "check_identifier", httpStatusHint: 404 },
  "ERR-004": { name: "not_controller", category: "authorization", retryable: "no", userAction: "sign_with_controller_account", httpStatusHint: 403 },
  "ERR-005": { name: "invalid_execution_account", category: "validation", retryable: "no", userAction: "correct_input", httpStatusHint: 422 },
  "ERR-011": { name: "binding_already_revoked", category: "stale_state", retryable: "benign_returns_existing_fact", userAction: "none_needed", httpStatusHint: 200 },
  "ERR-021": { name: "rpc_unavailable", category: "dependency", retryable: "true_backoff", userAction: "wait_retry", httpStatusHint: 503 },
  "ERR-022": { name: "timeout_unknown_status", category: "stale_state", retryable: "poll_only", userAction: "honest_still_processing", httpStatusHint: 202 },
  "ERR-023": { name: "stale_state_conflict", category: "stale_state", retryable: "re_read", userAction: "refresh", httpStatusHint: 409 },
};

export class OperationError extends Error {
  readonly code: OperationErrorCode;
  readonly name: string;
  readonly category: string;
  readonly retryable: string;
  readonly userAction: string;
  readonly httpStatusHint: number;
  readonly detail?: string;

  constructor(code: OperationErrorCode, detail?: string) {
    const shape = ERROR_SHAPES[code] ?? ERROR_SHAPES["ERR-023"];
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

export function isOperationError(v: unknown): v is OperationError {
  return v instanceof OperationError;
}

export function illegalTransitionError(detail: string): OperationError {
  return new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, detail);
}

export function staleVersionError(detail: string): OperationError {
  return new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, detail);
}

export function unknownStateError(detail: string): OperationError {
  return new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, detail);
}
