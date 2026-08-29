// Stable error semantics for the PRISM-8 offchain slice.
// Codes, names, categories, retryability, user actions, and HTTP hints mirror
// projects/prism/system/errors.yaml (authority: ERROR_CATALOGUE.md).
// Raw internal failures are never surfaced as external errors; every PrismError
// carries a stable catalogue code plus a machine-readable `detail` discriminator.

export const PRISM_ERROR_CODE = {
  INVALID_VENUE: "ERR-001",
  IDENTITY_NOT_FOUND: "ERR-002",
  INVALID_SIGNER: "ERR-003",
  INVALID_EXECUTION_ACCOUNT: "ERR-005",
  NONCE_ALREADY_USED: "ERR-006",
  ALTERED_MESSAGE: "ERR-012",
  PROOF_EXPIRED: "ERR-013",
  UNSUPPORTED_SIGNATURE_CLASS: "ERR-014",
  RPC_UNAVAILABLE: "ERR-021",
} as const;

export type PrismErrorCode = (typeof PRISM_ERROR_CODE)[keyof typeof PRISM_ERROR_CODE];

const ERROR_SHAPES: Record<PrismErrorCode, {
  name: string;
  category: string;
  retryable: string;
  userAction: string;
  httpStatusHint: number;
}> = {
  "ERR-001": {
    name: "invalid_venue",
    category: "validation",
    retryable: "no",
    userAction: "use_supported_venue",
    httpStatusHint: 422,
  },
  "ERR-002": {
    name: "identity_not_found",
    category: "not_found",
    retryable: "no",
    userAction: "check_identifier",
    httpStatusHint: 404,
  },
  "ERR-003": {
    name: "invalid_signer",
    category: "authentication",
    retryable: "false_new_challenge",
    userAction: "reconnect_wallet_restart_flow",
    httpStatusHint: 401,
  },
  "ERR-005": {
    name: "invalid_execution_account",
    category: "validation",
    retryable: "no",
    userAction: "correct_input",
    httpStatusHint: 422,
  },
  "ERR-006": {
    name: "nonce_already_used",
    category: "replay",
    retryable: "false_new_challenge",
    userAction: "restart_binding_flow",
    httpStatusHint: 409,
  },
  "ERR-012": {
    name: "altered_message",
    category: "validation",
    retryable: "false_new_challenge",
    userAction: "restart_flow",
    httpStatusHint: 400,
  },
  "ERR-013": {
    name: "proof_expired",
    category: "stale_state",
    retryable: "new_challenge",
    userAction: "restart_flow",
    httpStatusHint: 410,
  },
  "ERR-014": {
    name: "unsupported_signature_class",
    category: "unsupported",
    retryable: "no",
    userAction: "use_supported_wallet_type",
    httpStatusHint: 422,
  },
  "ERR-021": {
    name: "rpc_unavailable",
    category: "dependency",
    retryable: "true_backoff",
    userAction: "wait_retry",
    httpStatusHint: 503,
  },
};

/** Detail discriminators. Distinct causes stay distinguishable while sharing a
 * stable catalogue code (ERROR_CATALOGUE rule A8-9). */
export const PRISM_ERROR_DETAIL = {
  MALFORMED_PRISM_ID: "malformed_prism_id",
  MALFORMED_SIGNATURE: "malformed_signature",
  UNSUPPORTED_SIGNATURE_CLASS: "unsupported_signature_class",
  UNKNOWN_CHALLENGE: "unknown_challenge",
  CLOCK_UNAVAILABLE: "clock_unavailable",
  CHALLENGE_STORE_UNAVAILABLE: "challenge_store_unavailable",
  DUPLICATE_CHALLENGE_ID: "duplicate_challenge_id",
  SIGNATURE_CHECKER_UNAVAILABLE: "signature_checker_unavailable",
} as const;

export class PrismError extends Error {
  readonly code: PrismErrorCode;
  readonly name: string;
  readonly category: string;
  readonly retryable: string;
  readonly userAction: string;
  readonly httpStatusHint: number;
  readonly detail?: string;

  constructor(code: PrismErrorCode, detail?: string) {
    const shape = ERROR_SHAPES[code];
    super(`[${code}] ${shape.name}${detail ? ` (${detail})` : ""}`);
    this.code = code;
    this.name = shape.name;
    this.category = shape.category;
    this.retryable = shape.retryable;
    this.userAction = shape.userAction;
    this.httpStatusHint = shape.httpStatusHint;
    this.detail = detail;
  }

  /** Serializable external shape — no stack traces cross this boundary. */
  toExternalShape(): {
    code: PrismErrorCode;
    name: string;
    category: string;
    retryable: string;
    userAction: string;
    httpStatusHint: number;
    detail?: string;
  } {
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

export type AlteredField =
  | "chain_id"
  | "domain"
  | "venue"
  | "execution_account"
  | "prism_id"
  | "nonce"
  | "expiry";

export function alteredMessageError(fields: AlteredField[]): PrismError {
  return new PrismError(PRISM_ERROR_CODE.ALTERED_MESSAGE, `altered_fields:${fields.sort().join("+")}`);
}

export function invalidSignerError(detail: string): PrismError {
  return new PrismError(PRISM_ERROR_CODE.INVALID_SIGNER, detail);
}

export function unsupportedSignatureError(detail: string): PrismError {
  return new PrismError(PRISM_ERROR_CODE.UNSUPPORTED_SIGNATURE_CLASS, detail);
}

export function dependencyError(detail: string): PrismError {
  return new PrismError(PRISM_ERROR_CODE.RPC_UNAVAILABLE, detail);
}

export type ExternalPrismError = ReturnType<PrismError["toExternalShape"]>;

export function isPrismError(value: unknown): value is PrismError {
  return value instanceof PrismError;
}

/** Guard used by adapters so raw driver errors never leak past the boundary.
 * Long hex blobs (tx hashes, calldata) are collapsed before any logging. */
export function describeUnknownFailure(failure: unknown): string {
  if (failure instanceof Error && failure.message.length > 0) {
    const firstLine = failure.message.split("\n")[0];
    return firstLine.slice(0, 160).replace(/[0-9a-fx]{16,}/gi, "<opaque>");
  }
  return "unspecified_failure";
}
