// Typed resolution-continuity assessment for Prism Pause.
// This module is deliberately pure: a server-side resolver supplies the
// observation and this code maps typed risks to explicit policy outcomes.
// No resolution, chain, or settlement I/O occurs here.

import {
  CHECK_ID,
  makeCheck,
  type CheckResult,
  type PolicyOutcome,
} from "./checks";
import { PauseError, PAUSE_ERROR_CODE, PAUSE_REASON_CODE } from "./errors";

export const RESOLUTION_CONTINUITY_RISK = {
  ADDRESS_CHANGED: "ADDRESS_CHANGED",
  ALIAS_CHANGED: "ALIAS_CHANGED",
  FIRST_TIME_RECIPIENT: "FIRST_TIME_RECIPIENT",
  BINDING_REVOKED: "BINDING_REVOKED",
  VISIBILITY_CHANGED: "VISIBILITY_CHANGED",
  CHAIN_CHANGED: "CHAIN_CHANGED",
  NO_ACTIVE_DESTINATION: "NO_ACTIVE_DESTINATION",
} as const;

export type ResolutionContinuityRisk = (typeof RESOLUTION_CONTINUITY_RISK)[keyof typeof RESOLUTION_CONTINUITY_RISK];
/** Compatibility alias with the upstream resolution feature vocabulary. */
export const RESOLUTION_RISK_CODE = RESOLUTION_CONTINUITY_RISK;
export type ResolutionRiskCode = ResolutionContinuityRisk;

export const RESOLUTION_CONTINUITY_OUTCOME = {
  ALLOW: "ALLOW",
  REQUIRE_CONFIRMATION: "REQUIRE_CONFIRMATION",
  BLOCK: "BLOCK",
  ESCALATE: "ESCALATE",
} as const satisfies Record<string, PolicyOutcome>;
/** Compatibility alias for callers that name the decision vocabulary directly. */
export const RESOLUTION_POLICY_OUTCOME = RESOLUTION_CONTINUITY_OUTCOME;

export type ResolutionContinuityOutcome = (typeof RESOLUTION_CONTINUITY_OUTCOME)[keyof typeof RESOLUTION_CONTINUITY_OUTCOME];
/** Alias for callers that use the longer policy-oriented name. */
export type ResolutionContinuityPolicyOutcome = ResolutionContinuityOutcome;

/**
 * Conservative X2 defaults. These are an implementation seam, not a silent
 * Product/System canonicalization; see docs/PAUSE_RESOLUTION_CONTINUITY.md.
 */
export const DEFAULT_RESOLUTION_CONTINUITY_OUTCOMES: Readonly<Record<ResolutionContinuityRisk, ResolutionContinuityOutcome>> = {
  ADDRESS_CHANGED: "REQUIRE_CONFIRMATION",
  ALIAS_CHANGED: "REQUIRE_CONFIRMATION",
  FIRST_TIME_RECIPIENT: "REQUIRE_CONFIRMATION",
  BINDING_REVOKED: "BLOCK",
  VISIBILITY_CHANGED: "ESCALATE",
  CHAIN_CHANGED: "REQUIRE_CONFIRMATION",
  NO_ACTIVE_DESTINATION: "BLOCK",
};

const RESOLUTION_RISKS = Object.values(RESOLUTION_CONTINUITY_RISK) as readonly ResolutionContinuityRisk[];
const RESOLUTION_OUTCOMES = Object.values(RESOLUTION_CONTINUITY_OUTCOME) as readonly ResolutionContinuityOutcome[];
const OUTCOME_PRECEDENCE: Readonly<Record<ResolutionContinuityOutcome, number>> = {
  ALLOW: 0,
  REQUIRE_CONFIRMATION: 1,
  ESCALATE: 2,
  BLOCK: 3,
};

export interface ResolutionContinuityRiskEvidence {
  /** Upstream resolution services may provide additional risk codes. */
  readonly code: string;
  readonly level?: string;
  readonly blocking?: boolean;
  readonly detail?: string;
}

export type ResolutionContinuityRiskInput = ResolutionContinuityRisk | ResolutionContinuityRiskEvidence;

export interface ResolutionContinuityAssessmentSource {
  readonly risks?: readonly ResolutionContinuityRiskInput[] | null;
  readonly risk?: ResolutionContinuityRiskInput | null;
  readonly unknown?: boolean;
  /** Upstream continuity services expose a resolved/no-active/blocked status. */
  readonly status?: "KNOWN" | "UNKNOWN" | "RESOLVED" | "NO_ACTIVE_DESTINATION" | "BLOCKED" | null;
  readonly blocked?: boolean;
  /** Public-safe/redacted observation only. Never place secrets here. */
  readonly observedValue?: string | null;
  readonly expectedValue?: string | null;
  readonly detail?: string | null;
  /** Optional assertion from a trusted assessment producer; it must agree with the mapping. */
  readonly outcome?: ResolutionContinuityOutcome | null;
}

export interface ResolutionContinuitySource extends ResolutionContinuityAssessmentSource {
  /** Supports a resolver that wraps its observation in an assessment object. */
  readonly assessment?: ResolutionContinuityAssessmentSource | null;
}

export interface ResolutionContinuityAssessment {
  readonly status: "KNOWN" | "UNKNOWN";
  readonly risks: readonly ResolutionContinuityRisk[];
  readonly unmappedRiskCodes?: readonly string[];
  readonly policyOutcome: ResolutionContinuityOutcome;
  readonly observedValue: string | null;
  readonly expectedValue: string | null;
  readonly detail: string | null;
}

export interface ResolutionContinuityCheckInput {
  readonly source?: ResolutionContinuitySource | null;
  readonly now: number;
}

export interface ResolutionContinuityCheckResult extends CheckResult {
  readonly assessment: ResolutionContinuityAssessment;
}

function invalidSource(detail: string): never {
  throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, `invalid_resolution_continuity_source:${detail}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateOptionalString(value: unknown, field: string): void {
  if (value !== undefined && value !== null && typeof value !== "string") invalidSource(`${field}_invalid`);
}

function assertRisk(value: unknown, field: string): asserts value is ResolutionContinuityRisk {
  if (typeof value !== "string" || !(RESOLUTION_RISKS as readonly string[]).includes(value)) invalidSource(`${field}_invalid`);
}

function assertRiskInput(value: unknown, field: string): asserts value is ResolutionContinuityRiskInput {
  if (typeof value === "string") {
    assertRisk(value, field);
    return;
  }
  if (!isRecord(value) || typeof value.code !== "string" || value.code.trim().length === 0) invalidSource(`${field}_invalid`);
  validateOptionalString(value.level, `${field}.level`);
  if (value.blocking !== undefined && value.blocking !== null && typeof value.blocking !== "boolean") invalidSource(`${field}.blocking_invalid`);
  validateOptionalString(value.detail, `${field}.detail`);
}

function validateRiskList(value: unknown, field: string): void {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) invalidSource(`${field}_must_be_array`);
  value.forEach((risk, index) => assertRiskInput(risk, `${field}[${index}]`));
}

function validateSourceShape(value: unknown, field = "source"): void {
  if (value === null || value === undefined) return;
  if (!isRecord(value)) invalidSource(`${field}_must_be_object`);
  validateRiskList(value.risks, `${field}.risks`);
  if (value.risk !== undefined && value.risk !== null) assertRiskInput(value.risk, `${field}.risk`);
  if (value.unknown !== undefined && value.unknown !== null && typeof value.unknown !== "boolean") invalidSource(`${field}.unknown_invalid`);
  if (value.status !== undefined && value.status !== null && !["KNOWN", "UNKNOWN", "RESOLVED", "NO_ACTIVE_DESTINATION", "BLOCKED"].includes(value.status as string)) invalidSource(`${field}.status_invalid`);
  if (value.blocked !== undefined && value.blocked !== null && typeof value.blocked !== "boolean") invalidSource(`${field}.blocked_invalid`);
  if (value.outcome !== undefined && value.outcome !== null && (typeof value.outcome !== "string" || !(RESOLUTION_OUTCOMES as readonly string[]).includes(value.outcome))) {
    invalidSource(`${field}.outcome_invalid`);
  }
  validateOptionalString(value.observedValue, `${field}.observedValue`);
  validateOptionalString(value.expectedValue, `${field}.expectedValue`);
  validateOptionalString(value.detail, `${field}.detail`);
  if (value.assessment !== undefined && value.assessment !== null) validateSourceShape(value.assessment, `${field}.assessment`);
}

/**
 * Validate the server-side source at the runtime boundary. TypeScript casts
 * and JSON can bypass unions, so malformed risks must never become ALLOW.
 */
export function normalizeResolutionContinuitySource(value: unknown): ResolutionContinuitySource | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return { unknown: true };
  validateSourceShape(value);
  return value as ResolutionContinuitySource;
}

function collectSource(source: ResolutionContinuitySource): {
  risks: ResolutionContinuityRisk[];
  unmappedRiskCodes: string[];
  unknown: boolean;
  observedValue: string | null;
  expectedValue: string | null;
  detail: string | null;
  outcome: ResolutionContinuityOutcome | null;
} {
  const nested = source.assessment;
  const risks: ResolutionContinuityRisk[] = [];
  const unmappedRiskCodes: string[] = [];
  const candidates = [source.risk, ...(source.risks ?? []), nested?.risk, ...(nested?.risks ?? [])];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const code = typeof candidate === "string" ? candidate : candidate.code;
    if ((RESOLUTION_RISKS as readonly string[]).includes(code)) {
      if (!risks.includes(code as ResolutionContinuityRisk)) risks.push(code as ResolutionContinuityRisk);
    } else if (!unmappedRiskCodes.includes(code)) {
      unmappedRiskCodes.push(code);
    }
  }
  const status = source.status ?? nested?.status ?? null;
  if (status === "NO_ACTIVE_DESTINATION" && !risks.includes("NO_ACTIVE_DESTINATION")) risks.push("NO_ACTIVE_DESTINATION");
  const hasEvidence = [
    source.risks,
    source.risk,
    source.status,
    source.unknown,
    source.blocked,
    source.outcome,
    nested?.risks,
    nested?.risk,
    nested?.status,
    nested?.unknown,
    nested?.blocked,
    nested?.outcome,
  ].some((value) => value !== undefined);
  return {
    risks,
    unmappedRiskCodes,
    unknown:
      source.unknown === true ||
      nested?.unknown === true ||
      source.risks === null ||
      nested?.risks === null ||
      source.assessment === null ||
      status === "UNKNOWN" ||
      (status === "BLOCKED" && risks.length === 0) ||
      (source.blocked === true && risks.length === 0 && unmappedRiskCodes.length === 0) ||
      !hasEvidence ||
      unmappedRiskCodes.length > 0,
    observedValue: source.observedValue ?? nested?.observedValue ?? null,
    expectedValue: source.expectedValue ?? nested?.expectedValue ?? null,
    detail: source.detail ?? nested?.detail ?? null,
    outcome: source.outcome ?? nested?.outcome ?? null,
  };
}

function aggregateOutcome(risks: readonly ResolutionContinuityRisk[]): ResolutionContinuityOutcome {
  let selected: ResolutionContinuityOutcome = "ALLOW";
  for (const risk of risks) {
    const candidate = DEFAULT_RESOLUTION_CONTINUITY_OUTCOMES[risk];
    if (OUTCOME_PRECEDENCE[candidate] > OUTCOME_PRECEDENCE[selected]) selected = candidate;
  }
  return selected;
}

/** Resolve a typed assessment into one explicit policy outcome. */
export function assessResolutionContinuity(input: ResolutionContinuityAssessmentSource & { readonly source?: ResolutionContinuitySource | null }): ResolutionContinuityAssessment {
  const candidate = Object.prototype.hasOwnProperty.call(input, "source") ? input.source : input;
  const normalized = normalizeResolutionContinuitySource(candidate);
  if (normalized === undefined || normalized === null) {
    return {
      status: "UNKNOWN",
      risks: [],
      policyOutcome: "BLOCK",
      observedValue: null,
      expectedValue: "resolution_continuity_assessment",
      detail: "resolution_continuity_assessment_missing",
    };
  }

  const collected = collectSource(normalized);
  if (collected.unknown) {
    if (collected.outcome !== null && collected.outcome !== "BLOCK") invalidSource("unknown_outcome_must_be_block");
    return {
      status: "UNKNOWN",
      risks: collected.risks,
      unmappedRiskCodes: collected.unmappedRiskCodes,
      policyOutcome: "BLOCK",
      observedValue: collected.observedValue,
      expectedValue: collected.expectedValue ?? "known_resolution_continuity",
      detail: collected.detail ?? "resolution_continuity_assessment_unknown",
    };
  }

  const policyOutcome = aggregateOutcome(collected.risks);
  if (collected.outcome !== null && collected.outcome !== policyOutcome) {
    invalidSource(`outcome_mismatch:expected_${policyOutcome}_got_${collected.outcome}`);
  }
  return {
    status: "KNOWN",
    risks: collected.risks,
    ...(collected.unmappedRiskCodes.length > 0 ? { unmappedRiskCodes: collected.unmappedRiskCodes } : {}),
    policyOutcome,
    observedValue: collected.observedValue,
    expectedValue: collected.expectedValue ?? (collected.risks.length === 0 ? "no_resolution_risk" : null),
    detail: collected.detail,
  };
}

/**
 * Materialize the assessment as the normal Pause typed check. Any outcome
 * other than ALLOW is a blocking decision for automatic release; confirmation
 * and escalation continue through the existing authority/CAS path.
 */
export function ResolutionContinuityCheck(input: ResolutionContinuityCheckInput): ResolutionContinuityCheckResult {
  const assessment = assessResolutionContinuity({ source: input.source });
  const isUnknown = assessment.status === "UNKNOWN";
  const check = makeCheck(
    CHECK_ID.RESOLUTION_CONTINUITY,
    isUnknown ? "UNKNOWN" : assessment.policyOutcome === "ALLOW" ? "PASS" : "FAIL",
    isUnknown || assessment.policyOutcome !== "ALLOW" ? "BLOCKING" : "INFO",
    isUnknown ? PAUSE_REASON_CODE.RESOLUTION_CONTINUITY_UNKNOWN : PAUSE_REASON_CODE.RESOLUTION_CONTINUITY,
    "resolution_continuity",
    input.now,
    assessment.observedValue ?? (assessment.risks.length > 0 ? assessment.risks.join(",") : null),
    assessment.expectedValue,
    assessment.detail,
    assessment.policyOutcome,
    [...assessment.risks, ...(assessment.unmappedRiskCodes ?? [])],
  );
  return { ...check, assessment };
}

export const evaluateResolutionContinuity = ResolutionContinuityCheck;
