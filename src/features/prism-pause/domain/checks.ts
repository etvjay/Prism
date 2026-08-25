// Typed check results — P3 verification/policy engine foundation.
// No boolean-only scores. Every check returns typed result per plan §5.
// UNKNOWN is FAIL-CLOSED (blocking) — auto-release forbidden when blocking UNKNOWN.

import { PauseError, PAUSE_ERROR_CODE, PAUSE_REASON_CODE } from "./errors";

export type CheckStatus = "PASS" | "FAIL" | "UNKNOWN" | "NOT_APPLICABLE";
export type CheckSeverity = "INFO" | "WARNING" | "BLOCKING";

export const CHECK_STATUSES = ["PASS", "FAIL", "UNKNOWN", "NOT_APPLICABLE"] as const satisfies readonly CheckStatus[];
export const CHECK_SEVERITIES = ["INFO", "WARNING", "BLOCKING"] as const satisfies readonly CheckSeverity[];

export function isCheckStatus(value: unknown): value is CheckStatus {
  return typeof value === "string" && (CHECK_STATUSES as readonly string[]).includes(value);
}

export function isCheckSeverity(value: unknown): value is CheckSeverity {
  return typeof value === "string" && (CHECK_SEVERITIES as readonly string[]).includes(value);
}

export function assertCheckStatus(value: unknown, field = "status"): asserts value is CheckStatus {
  if (!isCheckStatus(value)) throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, `invalid_check_status:${field}`);
}

export function assertCheckSeverity(value: unknown, field = "severity"): asserts value is CheckSeverity {
  if (!isCheckSeverity(value)) throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, `invalid_check_severity:${field}`);
}

export interface CheckResult {
  readonly checkId: string; // e.g. PAUSE-RECIPIENT-002
  readonly status: CheckStatus;
  readonly severity: CheckSeverity;
  readonly reasonCode: string; // stable code from PAUSE_REASON_CODE
  readonly observedValue?: string | null; // redacted/public-safe
  readonly expectedValue?: string | null; // policy-derived
  readonly source: string; // registry | proof_verifier | policy | simulator | route_adapter
  readonly checkedAt: number;
  readonly detail?: string | null;
}

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";

export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "UNKNOWN"] as const satisfies readonly RiskLevel[];

export function isRiskLevel(value: unknown): value is RiskLevel {
  return typeof value === "string" && (RISK_LEVELS as readonly string[]).includes(value);
}

export function assertRiskLevel(value: unknown, field = "riskLevel"): asserts value is RiskLevel {
  if (!isRiskLevel(value)) throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, `invalid_risk_level:${field}`);
}

// stable check IDs
export const CHECK_ID = {
  IDENTITY: "PAUSE-IDENTITY-001",
  RECIPIENT_BINDING: "PAUSE-RECIPIENT-001",
  RECIPIENT_BOUND: "PAUSE-RECIPIENT-002",
  FIRST_USE: "PAUSE-RECIPIENT-003",
  AMOUNT_CEILING: "PAUSE-RISK-001",
  AMOUNT_DEVIATION: "PAUSE-RISK-002",
  FREQUENCY: "PAUSE-RISK-003",
  FEE_SLIPPAGE: "PAUSE-RISK-004",
  INITIATOR_VALID: "PAUSE-AUTH-001",
  AGENT_SCOPE: "PAUSE-AUTH-002",
  ADDITIONAL_APPROVAL: "PAUSE-AUTH-003",
  CHAIN_ALLOWED: "PAUSE-ROUTE-001",
  ASSET_ALLOWED: "PAUSE-ROUTE-002",
  CONTRACT_ALLOWED: "PAUSE-ROUTE-003",
  ROUTE_NOT_REVOKED: "PAUSE-ROUTE-004",
  INTENT_PLAN_MATCH: "PAUSE-INTENT-001",
  CALLDATA_MATCH: "PAUSE-INTENT-002",
  SIM_SUCCESS: "PAUSE-SIM-001",
  SIM_EFFECT_MATCH: "PAUSE-SIM-002",
  SIM_FRESHNESS: "PAUSE-SIM-003",
  SIM_UNKNOWN: "PAUSE-SIM-004",
  POLICY_VERSION: "PAUSE-POLICY-001",
} as const;

export function makeCheck(
  checkId: string,
  status: CheckStatus,
  severity: CheckSeverity,
  reasonCode: string,
  source: string,
  checkedAt: number,
  observedValue?: string | null,
  expectedValue?: string | null,
  detail?: string | null,
): CheckResult {
  assertCheckStatus(status);
  assertCheckSeverity(severity);
  if (typeof checkId !== "string" || checkId.trim().length === 0) {
    throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, "check_id_required");
  }
  if (typeof reasonCode !== "string" || reasonCode.trim().length === 0) {
    throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, "check_reason_code_required");
  }
  if (typeof source !== "string" || source.trim().length === 0) {
    throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, "check_source_required");
  }
  if (!Number.isFinite(checkedAt)) {
    throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, "check_timestamp_invalid");
  }
  for (const [field, value] of [["observedValue", observedValue], ["expectedValue", expectedValue], ["detail", detail]] as const) {
    if (value !== undefined && value !== null && typeof value !== "string") {
      throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, `check_${field}_invalid`);
    }
  }
  return {
    checkId,
    status,
    severity,
    reasonCode,
    observedValue: observedValue ?? null,
    expectedValue: expectedValue ?? null,
    source,
    checkedAt,
    detail: detail ?? null,
  };
}

// Whether a set of checks permits auto-release.
// Blocking FAIL or blocking UNKNOWN prevents release.
export function canAutoRelease(checks: readonly CheckResult[]): boolean {
  if (!Array.isArray(checks) || checks.length === 0) return false;
  assertTypedResults(checks);
  for (const c of checks) {
    if (c.severity === "BLOCKING" && (c.status === "FAIL" || c.status === "UNKNOWN")) return false;
  }
  return true;
}

// Whether any blocking failure exists
export function hasBlockingFailure(checks: readonly CheckResult[]): boolean {
  if (!Array.isArray(checks)) throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, "checks_must_be_array");
  assertTypedResults(checks);
  return checks.some((c) => c.severity === "BLOCKING" && (c.status === "FAIL" || c.status === "UNKNOWN"));
}

// Compute risk level from check severities/statuses
export function deriveRiskLevel(checks: readonly CheckResult[]): RiskLevel {
  if (checks.length === 0) return "UNKNOWN";
  assertTypedResults(checks);
  if (checks.some((c) => c.status === "UNKNOWN")) return "UNKNOWN";
  if (checks.some((c) => c.severity === "BLOCKING" && c.status === "FAIL")) return "HIGH";
  if (checks.some((c) => c.severity === "WARNING" && c.status === "FAIL")) return "MEDIUM";
  return "LOW";
}

// Require explicit typed results — helpers to validate no opaque score used.
export function assertTypedResults(checks: readonly CheckResult[]): void {
  if (!Array.isArray(checks)) throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, "checks_must_be_array");
  checks.forEach((c, index) => {
    if (!c || typeof c !== "object") {
      throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, `check_invalid:${index}`);
    }
    const candidate = c as CheckResult;
    if (typeof candidate.checkId !== "string" || candidate.checkId.trim().length === 0) {
      throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, `check_id_required:${index}`);
    }
    assertCheckStatus(candidate.status, `checks[${index}].status`);
    assertCheckSeverity(candidate.severity, `checks[${index}].severity`);
    if (typeof candidate.reasonCode !== "string" || candidate.reasonCode.trim().length === 0) {
      throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, `check_reason_code_required:${index}`);
    }
    if (typeof candidate.source !== "string" || candidate.source.trim().length === 0) {
      throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, `check_source_required:${index}`);
    }
    if (!Number.isFinite(candidate.checkedAt)) {
      throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, `check_timestamp_invalid:${index}`);
    }
    for (const [field, value] of [["observedValue", candidate.observedValue], ["expectedValue", candidate.expectedValue], ["detail", candidate.detail]] as const) {
      if (value !== undefined && value !== null && typeof value !== "string") {
        throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, `check_${field}_invalid:${index}`);
      }
    }
  });
}
