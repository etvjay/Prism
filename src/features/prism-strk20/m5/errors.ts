// Stable local M5 error and blocker vocabulary.
// Transport adapters may map provider-specific failures into these codes, but
// this file never handles wallet keys, proofs, or private state.

export const M5_ERROR_CODE = {
  CAPABILITY_UNKNOWN: "M5-001",
  NETWORK_MISMATCH: "M5-002",
  NOT_REGISTERED: "M5-003",
  SCREENING_REJECTED: "M5-004",
  SCREENING_UNAVAILABLE: "M5-005",
  MATURITY_PENDING: "M5-006",
  ZERO_OUTPUT: "M5-007",
  HELPER_REVERT: "M5-008",
  POOL_ROLLBACK: "M5-009",
  VALIDATOR_MINE_FALSE: "M5-010",
  UNKNOWN_RECEIPT: "M5-011",
  FEE_UNAVAILABLE: "M5-012",
  FEE_CHANGED: "M5-013",
  INVALID_AMOUNT: "M5-014",
  VIEWING_KEY_FORBIDDEN: "M5-015",
  WALLET_UNAVAILABLE: "M5-016",
  AMOUNT_OVERFLOW: "M5-017",
  CALLDATA_MISMATCH: "M5-018",
  CONSERVATION_FAILED: "M5-019",
  STRANDED_BALANCE: "M5-020",
  NOTE_DENOMINATION_WRONG: "M5-021",
  SIMULATION_PROOF_INVALID: "M5-022",
  CONFIG_INVALID: "M5-023",
  RECEIPT_INVALID: "M5-024",
  INDEPENDENT_READ_MISMATCH: "M5-025",
  OPERATION_STALE: "M5-026",
  USER_REJECTED: "M5-027",
} as const;

export type M5ErrorCode = (typeof M5_ERROR_CODE)[keyof typeof M5_ERROR_CODE];

export class M5Error extends Error {
  readonly code: M5ErrorCode;
  readonly detail?: string;

  constructor(code: M5ErrorCode, detail?: string) {
    super(`[${code}] ${detail ?? code}`);
    this.code = code;
    this.detail = detail;
    this.name = code;
  }
}

export const M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE = "M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE" as const;
export type M5BlockedReason =
  | "NO_WALLET"
  | "NO_PROVER"
  | "CAPABILITY_UNAVAILABLE"
  | "RPC_UNAVAILABLE"
  | "ENV_MISSING";

export interface M5Blocked {
  verdict: typeof M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE;
  reason: M5BlockedReason;
  detail: string;
  commit?: string;
}
