// Policy engine — pure policy evaluation over Pause + Intent + Plan + sources.
// Produces typed check results with stable reason codes and fail-closed UNKNOWN.
// Spec: PRISM_PAUSE_PHASE_PLAN §5 verification check matrix + §6 P3.

import type { ExecutionIntent } from "./intent";
import type { ExecutionPlan } from "./execution-plan";
import type { CheckResult } from "./checks";
import { CHECK_ID, makeCheck } from "./checks";
import { PauseError, PAUSE_ERROR_CODE, PAUSE_REASON_CODE } from "./errors";
import type { ExecutionPause } from "./pause";
import {
  ResolutionContinuityCheck,
  normalizeResolutionContinuitySource,
  type ResolutionContinuitySource,
} from "./resolution-continuity";

export interface Policy {
  readonly policyVersion: string;
  readonly allowedChains: readonly string[]; // normalized lower
  readonly allowedAssets: readonly string[]; // normalized lower; "*" means any
  readonly allowedContracts: readonly string[]; // lower; "*" means any
  readonly amountCeiling: string | null; // decimal string ceiling; null = no ceiling
  readonly requireFirstUseEscalation: boolean;
  readonly requireAdditionalApprovalThreshold?: string | null; // amount threshold that escalates
  readonly allowedAgentScopes?: readonly AgentScope[] | null;
}

export interface AgentScope {
  readonly agentId: string;
  readonly allowedChains: readonly string[];
  readonly allowedAssets: readonly string[];
  readonly allowedContracts: readonly string[];
  readonly amountCeiling: string | null;
  readonly allowedRecipients?: readonly string[] | null;
}

export type RecipientBindingStatus = "BOUND" | "REVOKED" | "UNBOUND" | "UNKNOWN";

export interface VerificationSources {
  // injected read models — policy engine never does I/O, caller supplies observed values
  readonly recipientBinding?: { status?: RecipientBindingStatus | null; observedValue?: string | null };
  readonly firstUse?: { isFirstUse?: boolean | null; unknown?: boolean };
  readonly agentAuthorized?: { authorized?: boolean | null; unknown?: boolean; observedAgentId?: string | null };
  readonly routeAllowed?: { chainAllowed?: boolean | null; assetAllowed?: boolean | null; contractAllowed?: boolean | null; notRevoked?: boolean | null; unknown?: boolean };
  readonly intentPlanMatch?: { matches?: boolean | null; unknown?: boolean };
  readonly simulation?: { success?: boolean | null; effectMatches?: boolean | null; freshnessOk?: boolean | null; unknown?: boolean };
  readonly additionalApproval?: { requiresApproval?: boolean | null; unknown?: boolean };
  /** Server-side resolver assessment; request bodies cannot populate this seam. */
  readonly resolutionContinuity?: ResolutionContinuitySource | null;
}

export interface VerificationSourceContext {
  readonly intent: ExecutionIntent;
  readonly plan: ExecutionPlan;
  readonly pause: ExecutionPause;
  readonly policy: Policy;
  readonly now: number;
}

/**
 * Server-side/test-only injection seam for authoritative read models. The
 * transport layer never accepts this object from a request body. Production
 * callers without a configured resolver deliberately receive UNKNOWN checks.
 */
export type VerificationSourceProvider = (input: VerificationSourceContext) => VerificationSources | Promise<VerificationSources>;

const RECIPIENT_BINDING_STATUSES = ["BOUND", "REVOKED", "UNBOUND", "UNKNOWN"] as const satisfies readonly RecipientBindingStatus[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidSource(detail: string): never {
  throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, detail);
}

function validateOptionalBoolean(value: unknown, field: string): void {
  if (value !== undefined && value !== null && typeof value !== "boolean") invalidSource(`invalid_verification_source:${field}`);
}

function validateOptionalString(value: unknown, field: string): void {
  if (value !== undefined && value !== null && typeof value !== "string") invalidSource(`invalid_verification_source:${field}`);
}

/**
 * Runtime validation is intentional: callers can cross this boundary through
 * JSON or `as` casts, so the TypeScript unions alone are not a safety check.
 * Missing facts remain missing and are evaluated as blocking UNKNOWN.
 */
export function normalizeVerificationSources(value: unknown): VerificationSources {
  if (value === undefined) return {};
  if (!isRecord(value)) invalidSource("verification_sources_must_be_object");

  const rb = value.recipientBinding;
  if (rb !== undefined && rb !== null) {
    if (!isRecord(rb)) invalidSource("invalid_verification_source:recipientBinding");
    if (rb.status !== undefined && rb.status !== null && (typeof rb.status !== "string" || !(RECIPIENT_BINDING_STATUSES as readonly string[]).includes(rb.status))) {
      invalidSource("invalid_verification_source:recipientBinding.status");
    }
    validateOptionalString(rb.observedValue, "recipientBinding.observedValue");
  }

  const firstUse = value.firstUse;
  if (firstUse !== undefined && firstUse !== null) {
    if (!isRecord(firstUse)) invalidSource("invalid_verification_source:firstUse");
    validateOptionalBoolean(firstUse.isFirstUse, "firstUse.isFirstUse");
    validateOptionalBoolean(firstUse.unknown, "firstUse.unknown");
  }

  const auth = value.agentAuthorized;
  if (auth !== undefined && auth !== null) {
    if (!isRecord(auth)) invalidSource("invalid_verification_source:agentAuthorized");
    validateOptionalBoolean(auth.authorized, "agentAuthorized.authorized");
    validateOptionalBoolean(auth.unknown, "agentAuthorized.unknown");
    validateOptionalString(auth.observedAgentId, "agentAuthorized.observedAgentId");
  }

  const route = value.routeAllowed;
  if (route !== undefined && route !== null) {
    if (!isRecord(route)) invalidSource("invalid_verification_source:routeAllowed");
    validateOptionalBoolean(route.chainAllowed, "routeAllowed.chainAllowed");
    validateOptionalBoolean(route.assetAllowed, "routeAllowed.assetAllowed");
    validateOptionalBoolean(route.contractAllowed, "routeAllowed.contractAllowed");
    validateOptionalBoolean(route.notRevoked, "routeAllowed.notRevoked");
    validateOptionalBoolean(route.unknown, "routeAllowed.unknown");
  }

  const intentPlan = value.intentPlanMatch;
  if (intentPlan !== undefined && intentPlan !== null) {
    if (!isRecord(intentPlan)) invalidSource("invalid_verification_source:intentPlanMatch");
    validateOptionalBoolean(intentPlan.matches, "intentPlanMatch.matches");
    validateOptionalBoolean(intentPlan.unknown, "intentPlanMatch.unknown");
  }

  const simulation = value.simulation;
  if (simulation !== undefined && simulation !== null) {
    if (!isRecord(simulation)) invalidSource("invalid_verification_source:simulation");
    validateOptionalBoolean(simulation.success, "simulation.success");
    validateOptionalBoolean(simulation.effectMatches, "simulation.effectMatches");
    validateOptionalBoolean(simulation.freshnessOk, "simulation.freshnessOk");
    validateOptionalBoolean(simulation.unknown, "simulation.unknown");
  }

  const additionalApproval = value.additionalApproval;
  if (additionalApproval !== undefined && additionalApproval !== null) {
    if (!isRecord(additionalApproval)) invalidSource("invalid_verification_source:additionalApproval");
    validateOptionalBoolean(additionalApproval.requiresApproval, "additionalApproval.requiresApproval");
    validateOptionalBoolean(additionalApproval.unknown, "additionalApproval.unknown");
  }

  if (value.resolutionContinuity !== undefined) {
    normalizeResolutionContinuitySource(value.resolutionContinuity);
  }

  return value as VerificationSources;
}

interface ParsedDecimal {
  readonly whole: string;
  readonly fraction: string;
}

/** Parse only unsigned decimal strings; never coerce prefixes or exponents. */
function parseDecimal(v: string): ParsedDecimal | null {
  if (typeof v !== "string" || v.trim() !== v || !/^\d+(?:\.\d+)?$/.test(v)) return null;
  const [whole, fraction = ""] = v.split(".");
  return {
    whole: whole.replace(/^0+(?=\d)/, ""),
    fraction: fraction.replace(/0+$/, ""),
  };
}

/** Exact decimal comparison without Number rounding. */
function compareDecimals(left: ParsedDecimal, right: ParsedDecimal): -1 | 0 | 1 {
  if (left.whole.length !== right.whole.length) return left.whole.length < right.whole.length ? -1 : 1;
  if (left.whole !== right.whole) return left.whole < right.whole ? -1 : 1;
  const fractionLength = Math.max(left.fraction.length, right.fraction.length);
  const leftFraction = left.fraction.padEnd(fractionLength, "0");
  const rightFraction = right.fraction.padEnd(fractionLength, "0");
  if (leftFraction === rightFraction) return 0;
  return leftFraction < rightFraction ? -1 : 1;
}

function normalizeRecipient(v: string | null): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  if (/^0x/i.test(trimmed)) {
    if (!/^0x[0-9a-fA-F]+$/i.test(trimmed)) return null;
    return `0x${trimmed.slice(2).toLowerCase()}`;
  }
  return trimmed.toLowerCase();
}

function normalizeAllowlist(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) return null;
    result.push(item.trim().toLowerCase());
  }
  return result;
}

function allowlistedValue(value: string, allowed: unknown, normalize = (candidate: string) => candidate.trim().toLowerCase()): boolean | null {
  const list = normalizeAllowlist(allowed);
  if (list === null) return null;
  if (list.includes("*")) return true;
  const candidate = normalize(value);
  return candidate.length > 0 && list.includes(candidate);
}

function allowlistedRecipient(value: string, allowed: unknown): boolean | null {
  const list = normalizeAllowlist(allowed);
  if (list === null) return null;
  if (list.includes("*")) return true;
  const candidate = normalizeRecipient(value);
  return candidate === null ? null : list.includes(candidate);
}

function allowlistedCalls(calls: readonly string[], allowed: unknown): boolean | null {
  const list = normalizeAllowlist(allowed);
  if (list === null || !Array.isArray(calls) || calls.length === 0) return null;
  if (list.includes("*")) return true;
  return calls.every((call) => typeof call === "string" && list.includes(call.trim().toLowerCase()));
}

function scopeAmountAllowed(amount: string, ceiling: unknown): boolean | null {
  if (ceiling === null) return parseDecimal(amount) !== null;
  if (typeof ceiling !== "string") return null;
  const requested = parseDecimal(amount);
  const maximum = parseDecimal(ceiling);
  if (requested === null || maximum === null) return null;
  return compareDecimals(requested, maximum) <= 0;
}

export interface AgentAuthorityCheckInput {
  readonly intent: ExecutionIntent;
  readonly plan: ExecutionPlan;
  readonly policy: Policy;
  readonly sources: VerificationSources;
  readonly now: number;
}

export interface AgentAuthorityCheckResult {
  readonly initiator: CheckResult;
  readonly scope: CheckResult;
}

/**
 * Evaluate delegated-agent identity and scope independently of route facts.
 * Missing authoritative identity/configuration is UNKNOWN+BLOCKING; an
 * explicit mismatch/denial is FAIL+BLOCKING. No client-provided route fact can
 * turn a scope violation into a pass.
 */
export function evaluateAgentAuthority(input: AgentAuthorityCheckInput): AgentAuthorityCheckResult {
  const { intent, plan, policy, sources, now } = input;
  const auth = sources.agentAuthorized;

  if (intent.initiator !== "agent") {
    return {
      initiator: makeCheck(CHECK_ID.INITIATOR_VALID, "PASS", "BLOCKING", PAUSE_REASON_CODE.INITIATOR_INVALID, "policy", now, intent.initiator, "not_agent"),
      scope: makeCheck(CHECK_ID.AGENT_SCOPE, "NOT_APPLICABLE", "INFO", PAUSE_REASON_CODE.AGENT_SCOPE, "policy", now, intent.agentId ?? "user", "not_agent"),
    };
  }

  const expectedAgentId = typeof intent.agentId === "string" && intent.agentId.trim().length > 0 ? intent.agentId.trim() : null;
  const observedAgentId = typeof auth?.observedAgentId === "string" && auth.observedAgentId.trim().length > 0 ? auth.observedAgentId.trim() : null;

  if (!auth || auth.unknown || auth.authorized === undefined || auth.authorized === null) {
    return {
      initiator: makeCheck(CHECK_ID.INITIATOR_VALID, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.INITIATOR_INVALID, "policy", now, observedAgentId, expectedAgentId),
      scope: makeCheck(CHECK_ID.AGENT_SCOPE, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.AGENT_SCOPE, "policy", now, observedAgentId, expectedAgentId ?? "agent_id_required"),
    };
  }
  if (auth.authorized === false) {
    return {
      initiator: makeCheck(CHECK_ID.INITIATOR_VALID, "FAIL", "BLOCKING", PAUSE_REASON_CODE.INITIATOR_INVALID, "policy", now, observedAgentId, "authorized"),
      scope: makeCheck(CHECK_ID.AGENT_SCOPE, "FAIL", "BLOCKING", PAUSE_REASON_CODE.AGENT_SCOPE, "policy", now, observedAgentId ?? "unknown", "authorized"),
    };
  }
  if (expectedAgentId === null || observedAgentId === null) {
    return {
      initiator: makeCheck(CHECK_ID.INITIATOR_VALID, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.INITIATOR_INVALID, "policy", now, observedAgentId, expectedAgentId),
      scope: makeCheck(CHECK_ID.AGENT_SCOPE, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.AGENT_SCOPE, "policy", now, observedAgentId, expectedAgentId ?? "agent_id_required"),
    };
  }
  if (observedAgentId !== expectedAgentId) {
    return {
      initiator: makeCheck(CHECK_ID.INITIATOR_VALID, "FAIL", "BLOCKING", PAUSE_REASON_CODE.INITIATOR_INVALID, "policy", now, observedAgentId, expectedAgentId),
      scope: makeCheck(CHECK_ID.AGENT_SCOPE, "FAIL", "BLOCKING", PAUSE_REASON_CODE.AGENT_SCOPE, "policy", now, observedAgentId, expectedAgentId),
    };
  }

  const scopes = policy.allowedAgentScopes;
  if (!Array.isArray(scopes)) {
    return {
      initiator: makeCheck(CHECK_ID.INITIATOR_VALID, "PASS", "BLOCKING", PAUSE_REASON_CODE.INITIATOR_INVALID, "policy", now, observedAgentId, "authorized"),
      scope: makeCheck(CHECK_ID.AGENT_SCOPE, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.AGENT_SCOPE, "policy", now, observedAgentId, "agent_scope_required"),
    };
  }
  const scope = scopes.find((candidate) => candidate && typeof candidate.agentId === "string" && candidate.agentId === expectedAgentId);
  if (!scope) {
    return {
      initiator: makeCheck(CHECK_ID.INITIATOR_VALID, "PASS", "BLOCKING", PAUSE_REASON_CODE.INITIATOR_INVALID, "policy", now, observedAgentId, "authorized"),
      scope: makeCheck(CHECK_ID.AGENT_SCOPE, "FAIL", "BLOCKING", PAUSE_REASON_CODE.AGENT_SCOPE, "policy", now, observedAgentId, "scope_exists"),
    };
  }

  const chainOk = allowlistedValue(plan.chainId, scope.allowedChains);
  const assetOk = allowlistedValue(plan.asset, scope.allowedAssets);
  const amountOk = scopeAmountAllowed(intent.requestedAmount, scope.amountCeiling);
  const contractOk = allowlistedCalls(plan.calls, scope.allowedContracts);
  // Delegated scopes require an explicit recipient allowlist. A missing list
  // is UNKNOWN rather than an implicit allow-all.
  const recipientOk = scope.allowedRecipients === undefined || scope.allowedRecipients === null
    ? null
    : allowlistedRecipient(plan.recipient, scope.allowedRecipients);
  const decisions = [chainOk, assetOk, amountOk, contractOk, recipientOk];
  const unknown = decisions.some((decision) => decision === null);
  const blocked = decisions.some((decision) => decision === false);
  const detail = `agent:${expectedAgentId}:chain=${String(chainOk)}:asset=${String(assetOk)}:amount=${String(amountOk)}:contract=${String(contractOk)}:recipient=${String(recipientOk)}`;

  return {
    initiator: makeCheck(CHECK_ID.INITIATOR_VALID, "PASS", "BLOCKING", PAUSE_REASON_CODE.INITIATOR_INVALID, "policy", now, observedAgentId, "authorized"),
    scope: makeCheck(
      CHECK_ID.AGENT_SCOPE,
      unknown ? "UNKNOWN" : blocked ? "FAIL" : "PASS",
      "BLOCKING",
      PAUSE_REASON_CODE.AGENT_SCOPE,
      "policy",
      now,
      detail,
      `scope:${expectedAgentId}`,
      unknown ? "agent_scope_fact_or_configuration_unknown" : blocked ? "agent_scope_out_of_bounds" : null,
    ),
  };
}

// Alias retained for the P3 check vocabulary used by the phase plan.
export const AgentAuthorityCheck = evaluateAgentAuthority;

function routeStatus(observed: boolean | null | undefined, policyAllowed: boolean | null): "PASS" | "FAIL" | "UNKNOWN" {
  if (policyAllowed === false || observed === false) return "FAIL";
  if (policyAllowed === null || observed === undefined || observed === null) return "UNKNOWN";
  return "PASS";
}

function displayAllowlist(value: unknown): string {
  return Array.isArray(value) ? value.map((item) => typeof item === "string" ? item : "unknown").join(",") : "unknown";
}

export function evaluatePolicy(input: {
  intent: ExecutionIntent;
  plan: ExecutionPlan;
  pause: ExecutionPause;
  policy: Policy;
  sources?: VerificationSources;
  now: number;
}): CheckResult[] {
  const { intent, plan, pause, policy, now } = input;
  const sources = normalizeVerificationSources(input.sources);
  const checks: CheckResult[] = [];
  const parsedRequestedAmount = parseDecimal(intent.requestedAmount);

  // PAUSE-IDENTITY-001 initiating principal maps to expected Prism ID — here we check principal non-empty and initiator validity (simplified product source: registry)
  checks.push(
    makeCheck(
      CHECK_ID.IDENTITY,
      intent.principal.trim().length > 0 ? "PASS" : "FAIL",
      "BLOCKING",
      PAUSE_REASON_CODE.IDENTITY_MISMATCH,
      "registry",
      now,
      intent.principal,
      policy.policyVersion,
      intent.principal.trim().length > 0 ? null : "principal_empty",
    ),
  );

  // PAUSE-RECIPIENT-001/002/003
  {
    const rb = sources.recipientBinding;
    if (!rb || rb.status === undefined || rb.status === null || rb.status === "UNKNOWN") {
      checks.push(makeCheck(CHECK_ID.RECIPIENT_BINDING, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.RECIPIENT_RESOLVE_FAIL, "registry", now, rb?.observedValue ?? null, intent.requestedRecipient));
    } else if (rb.status === "BOUND" && (rb.observedValue === undefined || rb.observedValue === null)) {
      checks.push(makeCheck(CHECK_ID.RECIPIENT_BINDING, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.RECIPIENT_RESOLVE_FAIL, "registry", now, null, intent.requestedRecipient));
      checks.push(makeCheck(CHECK_ID.RECIPIENT_BOUND, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.RECIPIENT_NOT_BOUND_OR_REVOKED, "registry", now, null, "BOUND"));
    } else if (rb.status === "BOUND") {
      const requestedRecipient = normalizeRecipient(intent.requestedRecipient);
      const observedRecipient = normalizeRecipient(rb.observedValue ?? null);
      const recipientMatches = requestedRecipient !== null && requestedRecipient === observedRecipient;
      checks.push(makeCheck(CHECK_ID.RECIPIENT_BINDING, recipientMatches ? "PASS" : "FAIL", "BLOCKING", PAUSE_REASON_CODE.RECIPIENT_RESOLVE_FAIL, "registry", now, rb.observedValue ?? null, intent.requestedRecipient));
      checks.push(makeCheck(CHECK_ID.RECIPIENT_BOUND, recipientMatches ? "PASS" : "FAIL", "BLOCKING", PAUSE_REASON_CODE.RECIPIENT_NOT_BOUND_OR_REVOKED, "registry", now, rb.observedValue ?? null, "BOUND"));
    } else if (rb.status === "REVOKED" || rb.status === "UNBOUND") {
      checks.push(makeCheck(CHECK_ID.RECIPIENT_BINDING, "FAIL", "BLOCKING", PAUSE_REASON_CODE.RECIPIENT_NOT_BOUND_OR_REVOKED, "registry", now, rb.observedValue ?? null, "BOUND"));
      checks.push(makeCheck(CHECK_ID.RECIPIENT_BOUND, "FAIL", "BLOCKING", PAUSE_REASON_CODE.RECIPIENT_NOT_BOUND_OR_REVOKED, "registry", now, rb.observedValue ?? null, "BOUND"));
    }

    const fu = sources.firstUse;
    if (!fu || fu.unknown || fu.isFirstUse === undefined || fu.isFirstUse === null) {
      checks.push(makeCheck(CHECK_ID.FIRST_USE, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.FIRST_USE, "policy", now, null, policy.requireFirstUseEscalation ? "escalate_on_first_use" : "allow"));
    } else if (fu.isFirstUse && policy.requireFirstUseEscalation) {
      checks.push(makeCheck(CHECK_ID.FIRST_USE, "FAIL", "BLOCKING", PAUSE_REASON_CODE.FIRST_USE, "policy", now, "first_use", "escalate_on_first_use"));
    } else {
      checks.push(makeCheck(CHECK_ID.FIRST_USE, "PASS", "INFO", PAUSE_REASON_CODE.FIRST_USE, "policy", now, fu.isFirstUse ? "first_use" : "repeat", "ok"));
    }
  }

  // PAUSE-RISK-001 amount ceiling
  {
    if (policy.amountCeiling !== null) {
      const max = parseDecimal(policy.amountCeiling);
      if (max === null || parsedRequestedAmount === null) {
        checks.push(makeCheck(CHECK_ID.AMOUNT_CEILING, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.AMOUNT_CEILING, "policy", now, intent.requestedAmount, policy.amountCeiling));
      } else if (compareDecimals(parsedRequestedAmount, max) > 0) {
        checks.push(makeCheck(CHECK_ID.AMOUNT_CEILING, "FAIL", "BLOCKING", PAUSE_REASON_CODE.AMOUNT_CEILING, "policy", now, intent.requestedAmount, policy.amountCeiling));
      } else {
        checks.push(makeCheck(CHECK_ID.AMOUNT_CEILING, "PASS", "BLOCKING", PAUSE_REASON_CODE.AMOUNT_CEILING, "policy", now, intent.requestedAmount, policy.amountCeiling));
      }
    } else if (parsedRequestedAmount === null) {
      checks.push(makeCheck(CHECK_ID.AMOUNT_CEILING, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.AMOUNT_CEILING, "policy", now, intent.requestedAmount, "no_ceiling"));
    } else {
      checks.push(makeCheck(CHECK_ID.AMOUNT_CEILING, "PASS", "INFO", PAUSE_REASON_CODE.AMOUNT_CEILING, "policy", now, intent.requestedAmount, "no_ceiling"));
    }

    // deviation and frequency treated as NOT_APPLICABLE in this lane unless sources provided
    checks.push(makeCheck(CHECK_ID.AMOUNT_DEVIATION, "NOT_APPLICABLE", "INFO", PAUSE_REASON_CODE.AMOUNT_DEVIATION, "policy", now, null, null, "not_in_scope_P4"));
    checks.push(makeCheck(CHECK_ID.FREQUENCY, "NOT_APPLICABLE", "INFO", PAUSE_REASON_CODE.FREQUENCY_LIMIT, "policy", now, null, null, "not_in_scope_P4"));
    checks.push(makeCheck(CHECK_ID.FEE_SLIPPAGE, "NOT_APPLICABLE", "INFO", PAUSE_REASON_CODE.FEE_SLIPPAGE, "policy", now, null, null, "not_in_scope_P4"));
  }

  // PAUSE-AUTH-001/002/003
  {
    const agentAuthority = evaluateAgentAuthority({ intent, plan, policy, sources, now });
    checks.push(agentAuthority.initiator, agentAuthority.scope);

    const add = sources.additionalApproval;
    if (!add || add.unknown || add.requiresApproval === undefined || add.requiresApproval === null) {
      checks.push(makeCheck(CHECK_ID.ADDITIONAL_APPROVAL, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.ADDITIONAL_APPROVAL, "policy", now, null, "approval_check"));
    } else if (add.requiresApproval) {
      checks.push(makeCheck(CHECK_ID.ADDITIONAL_APPROVAL, "FAIL", "BLOCKING", PAUSE_REASON_CODE.ADDITIONAL_APPROVAL, "policy", now, "requires_approval", "threshold_not_met"));
    } else {
      checks.push(makeCheck(CHECK_ID.ADDITIONAL_APPROVAL, "PASS", "INFO", PAUSE_REASON_CODE.ADDITIONAL_APPROVAL, "policy", now, "no_additional_approval", "ok"));
    }
  }

  // PAUSE-ROUTE-001..004
  {
    const r = sources.routeAllowed;
    const policyChainAllowed = allowlistedValue(plan.chainId, policy.allowedChains);
    const policyAssetAllowed = allowlistedValue(plan.asset, policy.allowedAssets);
    const policyContractAllowed = allowlistedCalls(plan.calls, policy.allowedContracts);
    const observedChain = r?.unknown ? undefined : r?.chainAllowed;
    const observedAsset = r?.unknown ? undefined : r?.assetAllowed;
    const observedContract = r?.unknown ? undefined : r?.contractAllowed;
    const observedNotRevoked = r?.unknown ? undefined : r?.notRevoked;
    const chainStatus = routeStatus(observedChain, policyChainAllowed);
    const assetStatus = routeStatus(observedAsset, policyAssetAllowed);
    const contractStatus = routeStatus(observedContract, policyContractAllowed);

    checks.push(makeCheck(
      CHECK_ID.CHAIN_ALLOWED,
      chainStatus,
      "BLOCKING",
      PAUSE_REASON_CODE.CHAIN_NOT_ALLOWED,
      "policy",
      now,
      plan.chainId,
      displayAllowlist(policy.allowedChains),
    ));
    checks.push(makeCheck(
      CHECK_ID.ASSET_ALLOWED,
      assetStatus,
      "BLOCKING",
      PAUSE_REASON_CODE.ASSET_NOT_ALLOWED,
      "policy",
      now,
      plan.asset,
      displayAllowlist(policy.allowedAssets),
    ));
    checks.push(makeCheck(
      CHECK_ID.CONTRACT_ALLOWED,
      contractStatus,
      "BLOCKING",
      PAUSE_REASON_CODE.CONTRACT_NOT_ALLOWED,
      "route_adapter",
      now,
      plan.calls.join(","),
      displayAllowlist(policy.allowedContracts),
    ));
    checks.push(makeCheck(
      CHECK_ID.ROUTE_NOT_REVOKED,
      observedNotRevoked === undefined || observedNotRevoked === null ? "UNKNOWN" : observedNotRevoked ? "PASS" : "FAIL",
      "BLOCKING",
      PAUSE_REASON_CODE.ROUTE_REVOKED_OR_STALE,
      "route_adapter",
      now,
      observedNotRevoked === undefined || observedNotRevoked === null ? null : observedNotRevoked ? "active" : "revoked",
      "not_revoked",
    ));
  }

  // PAUSE-INTENT-001/002
  {
    const m = sources.intentPlanMatch;
    if (!m || m.unknown || m.matches === undefined || m.matches === null) {
      checks.push(makeCheck(CHECK_ID.INTENT_PLAN_MATCH, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.INTENT_PLAN_MISMATCH, "policy", now, plan.planHash, intent.intentId));
      checks.push(makeCheck(CHECK_ID.CALLDATA_MATCH, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.CALLDATA_MISMATCH, "policy", now, plan.calls.join(","), intent.requestedRoute));
    } else if (m.matches) {
      checks.push(makeCheck(CHECK_ID.INTENT_PLAN_MATCH, "PASS", "BLOCKING", PAUSE_REASON_CODE.INTENT_PLAN_MISMATCH, "policy", now, plan.planHash, intent.intentId));
      checks.push(makeCheck(CHECK_ID.CALLDATA_MATCH, "PASS", "BLOCKING", PAUSE_REASON_CODE.CALLDATA_MISMATCH, "policy", now, plan.calls.join(","), intent.requestedRoute));
    } else {
      checks.push(makeCheck(CHECK_ID.INTENT_PLAN_MATCH, "FAIL", "BLOCKING", PAUSE_REASON_CODE.INTENT_PLAN_MISMATCH, "policy", now, plan.planHash, intent.intentId));
      checks.push(makeCheck(CHECK_ID.CALLDATA_MATCH, "FAIL", "BLOCKING", PAUSE_REASON_CODE.CALLDATA_MISMATCH, "policy", now, plan.calls.join(","), intent.requestedRoute));
    }
  }

  // PAUSE-SIM-001..004
  {
    const sim = sources.simulation;
    if (!sim || sim.unknown || sim.success === undefined || sim.success === null) {
      checks.push(makeCheck(CHECK_ID.SIM_SUCCESS, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.SIMULATION_UNKNOWN, "simulator", now, null, "simulation_success"));
      checks.push(makeCheck(CHECK_ID.SIM_EFFECT_MATCH, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.SIMULATION_EFFECT_MISMATCH, "simulator", now, null, "effect_match"));
      checks.push(makeCheck(CHECK_ID.SIM_FRESHNESS, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.SIMULATION_STALE, "simulator", now, null, "fresh"));
      checks.push(makeCheck(CHECK_ID.SIM_UNKNOWN, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.SIMULATION_UNKNOWN, "simulator", now, null, "known"));
    } else {
      if (sim.success) {
        checks.push(makeCheck(CHECK_ID.SIM_SUCCESS, "PASS", "BLOCKING", PAUSE_REASON_CODE.SIMULATION_FAIL, "simulator", now, "success", "ok"));
      } else {
        checks.push(makeCheck(CHECK_ID.SIM_SUCCESS, "FAIL", "BLOCKING", PAUSE_REASON_CODE.SIMULATION_FAIL, "simulator", now, "failed", "success"));
      }
      if (sim.effectMatches === undefined || sim.effectMatches === null) {
        checks.push(makeCheck(CHECK_ID.SIM_EFFECT_MATCH, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.SIMULATION_EFFECT_MISMATCH, "simulator", now, null, "match"));
      } else if (sim.effectMatches) {
        checks.push(makeCheck(CHECK_ID.SIM_EFFECT_MATCH, "PASS", "BLOCKING", PAUSE_REASON_CODE.SIMULATION_EFFECT_MISMATCH, "simulator", now, "match", "ok"));
      } else {
        checks.push(makeCheck(CHECK_ID.SIM_EFFECT_MATCH, "FAIL", "BLOCKING", PAUSE_REASON_CODE.SIMULATION_EFFECT_MISMATCH, "simulator", now, "mismatch", "match"));
      }
      if (sim.freshnessOk === undefined || sim.freshnessOk === null) {
        checks.push(makeCheck(CHECK_ID.SIM_FRESHNESS, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.SIMULATION_STALE, "simulator", now, null, "fresh"));
      } else if (sim.freshnessOk) {
        checks.push(makeCheck(CHECK_ID.SIM_FRESHNESS, "PASS", "BLOCKING", PAUSE_REASON_CODE.SIMULATION_STALE, "simulator", now, "fresh", "ok"));
      } else {
        checks.push(makeCheck(CHECK_ID.SIM_FRESHNESS, "FAIL", "BLOCKING", PAUSE_REASON_CODE.SIMULATION_STALE, "simulator", now, "stale", "fresh"));
      }
      // PAUSE-SIM-004 is the catch-all UNKNOWN gate — if success unknown already handled; here we mark it as PASS when simulation known
      checks.push(makeCheck(CHECK_ID.SIM_UNKNOWN, sim.success === undefined || sim.success === null ? "UNKNOWN" : "PASS", sim.success === undefined || sim.success === null ? "BLOCKING" : "INFO", PAUSE_REASON_CODE.SIMULATION_UNKNOWN, "simulator", now, sim.success === undefined || sim.success === null ? null : "known", "known"));
    }
  }

  // Resolution continuity is a separate, typed source. Missing or unknown
  // resolver evidence is blocking; no address/chain/visibility fact is inferred
  // from the intent or plan alone.
  checks.push(ResolutionContinuityCheck({ source: sources.resolutionContinuity, now }));

  // Policy snapshots are part of the exact decision binding. A drifted
  // version is a blocking check even when all injected observations pass.
  const policyVersionMatches =
    plan.policyVersion === policy.policyVersion &&
    intent.policyVersion === policy.policyVersion &&
    pause.policyVersion === policy.policyVersion;
  checks.push(
    makeCheck(
      CHECK_ID.POLICY_VERSION,
      policyVersionMatches ? "PASS" : "FAIL",
      policyVersionMatches ? "INFO" : "BLOCKING",
      PAUSE_REASON_CODE.POLICY_VERSION_MISMATCH,
      "policy",
      now,
      `${intent.policyVersion}:${plan.policyVersion}:${pause.policyVersion}`,
      policy.policyVersion,
      policyVersionMatches ? null : "policy_version_mismatch",
    ),
  );

  return checks;
}

export function evaluateIntentPlanConsistency(intent: ExecutionIntent, plan: ExecutionPlan): boolean {
  // Minimal: recipient/amount/chain should align in normalized sense
  // This is not exhaustive; the typed checks above are authoritative. This is a pure helper.
  return plan.intentId === intent.intentId;
}
