// Typed check results — P3 verification/policy engine foundation.
// No boolean-only scores. Every check returns typed result per plan §5.
// UNKNOWN is FAIL-CLOSED (blocking) — auto-release forbidden when blocking UNKNOWN.

import { PAUSE_REASON_CODE } from "./errors";

export type CheckStatus = "PASS" | "FAIL" | "UNKNOWN" | "NOT_APPLICABLE";
export type CheckSeverity = "INFO" | "WARNING" | "BLOCKING";

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
  for (const c of checks) {
    if (c.severity === "BLOCKING" && (c.status === "FAIL" || c.status === "UNKNOWN")) return false;
  }
  return true;
}

// Whether any blocking failure exists
export function hasBlockingFailure(checks: readonly CheckResult[]): boolean {
  return checks.some((c) => c.severity === "BLOCKING" && (c.status === "FAIL" || c.status === "UNKNOWN"));
}

// Compute risk level from check severities/statuses
export function deriveRiskLevel(checks: readonly CheckResult[]): RiskLevel {
  if (checks.length === 0) return "UNKNOWN";
  if (checks.some((c) => c.status === "UNKNOWN")) return "UNKNOWN";
  if (checks.some((c) => c.severity === "BLOCKING" && c.status === "FAIL")) return "HIGH";
  if (checks.some((c) => c.severity === "WARNING" && c.status === "FAIL")) return "MEDIUM";
  return "LOW";
}

// Require explicit typed results — helpers to validate no opaque score used.
export function assertTypedResults(checks: readonly CheckResult[]): void {
  for (const c of checks) {
    if (!c.checkId || !c.status || !c.severity || !c.reasonCode || !c.source) {
      throw new Error(`check missing typed field: ${JSON.stringify(c)}`);
    }
  }
}
