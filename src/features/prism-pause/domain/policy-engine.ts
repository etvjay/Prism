// Policy engine — pure policy evaluation over Pause + Intent + Plan + sources.
// Produces typed check results with stable reason codes and fail-closed UNKNOWN.
// Spec: PRISM_PAUSE_PHASE_PLAN §5 verification check matrix + §6 P3.

import type { ExecutionIntent } from "./intent";
import type { ExecutionPlan } from "./execution-plan";
import type { CheckResult } from "./checks";
import { CHECK_ID, makeCheck } from "./checks";
import { PAUSE_REASON_CODE } from "./errors";
import type { ExecutionPause } from "./pause";

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

export interface VerificationSources {
  // injected read models — policy engine never does I/O, caller supplies observed values
  readonly recipientBinding?: { status: "BOUND" | "REVOKED" | "UNBOUND" | "UNKNOWN"; observedValue: string | null };
  readonly firstUse?: { isFirstUse: boolean | null; unknown?: boolean };
  readonly agentAuthorized?: { authorized: boolean | null; unknown?: boolean; observedAgentId?: string | null };
  readonly routeAllowed?: { chainAllowed: boolean | null; assetAllowed: boolean | null; contractAllowed: boolean | null; notRevoked: boolean | null; unknown?: boolean };
  readonly intentPlanMatch?: { matches: boolean | null; unknown?: boolean };
  readonly simulation?: { success: boolean | null; effectMatches: boolean | null; freshnessOk: boolean | null; unknown?: boolean };
  readonly additionalApproval?: { requiresApproval: boolean | null; unknown?: boolean };
}

function parseDecimal(v: string): number {
  const n = Number.parseFloat(v);
  return n;
}

export function evaluatePolicy(input: {
  intent: ExecutionIntent;
  plan: ExecutionPlan;
  pause: ExecutionPause;
  policy: Policy;
  sources: VerificationSources;
  now: number;
}): CheckResult[] {
  const { intent, plan, pause, policy, sources, now } = input;
  const checks: CheckResult[] = [];

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
    if (!rb || rb.status === "UNKNOWN") {
      checks.push(makeCheck(CHECK_ID.RECIPIENT_BINDING, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.RECIPIENT_RESOLVE_FAIL, "registry", now, rb?.observedValue ?? null, intent.requestedRecipient));
    } else if (rb.status === "BOUND") {
      checks.push(makeCheck(CHECK_ID.RECIPIENT_BINDING, "PASS", "BLOCKING", PAUSE_REASON_CODE.RECIPIENT_RESOLVE_FAIL, "registry", now, rb.observedValue, intent.requestedRecipient));
      checks.push(makeCheck(CHECK_ID.RECIPIENT_BOUND, "PASS", "BLOCKING", PAUSE_REASON_CODE.RECIPIENT_NOT_BOUND_OR_REVOKED, "registry", now, rb.observedValue, "BOUND"));
    } else if (rb.status === "REVOKED" || rb.status === "UNBOUND") {
      checks.push(makeCheck(CHECK_ID.RECIPIENT_BINDING, "FAIL", "BLOCKING", PAUSE_REASON_CODE.RECIPIENT_NOT_BOUND_OR_REVOKED, "registry", now, rb.observedValue, "BOUND"));
      checks.push(makeCheck(CHECK_ID.RECIPIENT_BOUND, "FAIL", "BLOCKING", PAUSE_REASON_CODE.RECIPIENT_NOT_BOUND_OR_REVOKED, "registry", now, rb.observedValue, "BOUND"));
    }

    const fu = sources.firstUse;
    if (!fu || fu.unknown || fu.isFirstUse === null) {
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
      const amt = parseDecimal(intent.requestedAmount);
      if (!Number.isFinite(max) || !Number.isFinite(amt)) {
        checks.push(makeCheck(CHECK_ID.AMOUNT_CEILING, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.AMOUNT_CEILING, "policy", now, intent.requestedAmount, policy.amountCeiling));
      } else if (amt > max) {
        checks.push(makeCheck(CHECK_ID.AMOUNT_CEILING, "FAIL", "BLOCKING", PAUSE_REASON_CODE.AMOUNT_CEILING, "policy", now, intent.requestedAmount, policy.amountCeiling));
      } else {
        checks.push(makeCheck(CHECK_ID.AMOUNT_CEILING, "PASS", "BLOCKING", PAUSE_REASON_CODE.AMOUNT_CEILING, "policy", now, intent.requestedAmount, policy.amountCeiling));
      }
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
    const auth = sources.agentAuthorized;
    if (!auth || auth.unknown || auth.authorized === null) {
      checks.push(makeCheck(CHECK_ID.INITIATOR_VALID, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.INITIATOR_INVALID, "policy", now, null, intent.initiator));
      checks.push(makeCheck(CHECK_ID.AGENT_SCOPE, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.AGENT_SCOPE, "policy", now, auth?.observedAgentId ?? null, intent.agentId ?? "n/a"));
    } else if (auth.authorized === false) {
      checks.push(makeCheck(CHECK_ID.INITIATOR_VALID, "FAIL", "BLOCKING", PAUSE_REASON_CODE.INITIATOR_INVALID, "policy", now, String(auth.authorized), "authorized"));
      checks.push(makeCheck(CHECK_ID.AGENT_SCOPE, "FAIL", "BLOCKING", PAUSE_REASON_CODE.AGENT_SCOPE, "policy", now, auth.observedAgentId ?? intent.agentId ?? "unknown", "in_scope"));
    } else {
      checks.push(makeCheck(CHECK_ID.INITIATOR_VALID, "PASS", "BLOCKING", PAUSE_REASON_CODE.INITIATOR_INVALID, "policy", now, intent.initiator, "authorized"));
      // agent scope detail: if intent is agent-initiated, check ceiling/recipients
      if (intent.initiator === "agent" && policy.allowedAgentScopes) {
        const scope = policy.allowedAgentScopes.find((s) => s.agentId === intent.agentId);
        if (!scope) {
          checks.push(makeCheck(CHECK_ID.AGENT_SCOPE, "FAIL", "BLOCKING", PAUSE_REASON_CODE.AGENT_SCOPE, "policy", now, intent.agentId ?? "unknown", "scope_exists"));
        } else {
          // simplified: scope matches if chain/asset allowed and amount under ceiling
          const chainOk = scope.allowedChains.includes("*") || scope.allowedChains.includes(plan.chainId.toLowerCase());
          const assetOk = scope.allowedAssets.includes("*") || scope.allowedAssets.includes(plan.asset.toLowerCase());
          const amtOk = scope.amountCeiling === null || parseDecimal(intent.requestedAmount) <= parseDecimal(scope.amountCeiling);
          if (!chainOk || !assetOk || !amtOk) {
            checks.push(makeCheck(CHECK_ID.AGENT_SCOPE, "FAIL", "BLOCKING", PAUSE_REASON_CODE.AGENT_SCOPE, "policy", now, `${plan.chainId}:${plan.asset}:${intent.requestedAmount}`, `scope:${scope.agentId}`));
          } else {
            checks.push(makeCheck(CHECK_ID.AGENT_SCOPE, "PASS", "BLOCKING", PAUSE_REASON_CODE.AGENT_SCOPE, "policy", now, scope.agentId, "in_scope"));
          }
        }
      } else {
        checks.push(makeCheck(CHECK_ID.AGENT_SCOPE, "PASS", "INFO", PAUSE_REASON_CODE.AGENT_SCOPE, "policy", now, intent.agentId ?? "user", "not_agent_or_no_scope"));
      }
    }

    const add = sources.additionalApproval;
    if (!add || add.unknown || add.requiresApproval === null) {
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
    if (!r || r.unknown) {
      checks.push(makeCheck(CHECK_ID.CHAIN_ALLOWED, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.CHAIN_NOT_ALLOWED, "policy", now, plan.chainId, policy.allowedChains.join(",")));
      checks.push(makeCheck(CHECK_ID.ASSET_ALLOWED, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.ASSET_NOT_ALLOWED, "policy", now, plan.asset, policy.allowedAssets.join(",")));
      checks.push(makeCheck(CHECK_ID.CONTRACT_ALLOWED, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.CONTRACT_NOT_ALLOWED, "route_adapter", now, plan.calls.join(","), policy.allowedContracts.join(",")));
      checks.push(makeCheck(CHECK_ID.ROUTE_NOT_REVOKED, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.ROUTE_REVOKED_OR_STALE, "route_adapter", now, null, "not_revoked"));
    } else {
      // chain
      if (r.chainAllowed === null) checks.push(makeCheck(CHECK_ID.CHAIN_ALLOWED, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.CHAIN_NOT_ALLOWED, "policy", now, plan.chainId, policy.allowedChains.join(",")));
      else if (r.chainAllowed) checks.push(makeCheck(CHECK_ID.CHAIN_ALLOWED, "PASS", "BLOCKING", PAUSE_REASON_CODE.CHAIN_NOT_ALLOWED, "policy", now, plan.chainId, "allowed"));
      else checks.push(makeCheck(CHECK_ID.CHAIN_ALLOWED, "FAIL", "BLOCKING", PAUSE_REASON_CODE.CHAIN_NOT_ALLOWED, "policy", now, plan.chainId, policy.allowedChains.join(",")));

      if (r.assetAllowed === null) checks.push(makeCheck(CHECK_ID.ASSET_ALLOWED, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.ASSET_NOT_ALLOWED, "policy", now, plan.asset, policy.allowedAssets.join(",")));
      else if (r.assetAllowed) checks.push(makeCheck(CHECK_ID.ASSET_ALLOWED, "PASS", "BLOCKING", PAUSE_REASON_CODE.ASSET_NOT_ALLOWED, "policy", now, plan.asset, "allowed"));
      else checks.push(makeCheck(CHECK_ID.ASSET_ALLOWED, "FAIL", "BLOCKING", PAUSE_REASON_CODE.ASSET_NOT_ALLOWED, "policy", now, plan.asset, policy.allowedAssets.join(",")));

      if (r.contractAllowed === null) checks.push(makeCheck(CHECK_ID.CONTRACT_ALLOWED, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.CONTRACT_NOT_ALLOWED, "route_adapter", now, plan.calls.join(","), "allowed"));
      else if (r.contractAllowed) checks.push(makeCheck(CHECK_ID.CONTRACT_ALLOWED, "PASS", "BLOCKING", PAUSE_REASON_CODE.CONTRACT_NOT_ALLOWED, "route_adapter", now, plan.calls[0] ?? "call", "allowed"));
      else checks.push(makeCheck(CHECK_ID.CONTRACT_ALLOWED, "FAIL", "BLOCKING", PAUSE_REASON_CODE.CONTRACT_NOT_ALLOWED, "route_adapter", now, plan.calls[0] ?? "call", policy.allowedContracts.join(",")));

      if (r.notRevoked === null) checks.push(makeCheck(CHECK_ID.ROUTE_NOT_REVOKED, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.ROUTE_REVOKED_OR_STALE, "route_adapter", now, null, "not_revoked"));
      else if (r.notRevoked) checks.push(makeCheck(CHECK_ID.ROUTE_NOT_REVOKED, "PASS", "BLOCKING", PAUSE_REASON_CODE.ROUTE_REVOKED_OR_STALE, "route_adapter", now, "active", "not_revoked"));
      else checks.push(makeCheck(CHECK_ID.ROUTE_NOT_REVOKED, "FAIL", "BLOCKING", PAUSE_REASON_CODE.ROUTE_REVOKED_OR_STALE, "route_adapter", now, "revoked", "active"));
    }
  }

  // PAUSE-INTENT-001/002
  {
    const m = sources.intentPlanMatch;
    if (!m || m.unknown || m.matches === null) {
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
    if (!sim || sim.unknown || sim.success === null) {
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
      if (sim.effectMatches === null) {
        checks.push(makeCheck(CHECK_ID.SIM_EFFECT_MATCH, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.SIMULATION_EFFECT_MISMATCH, "simulator", now, null, "match"));
      } else if (sim.effectMatches) {
        checks.push(makeCheck(CHECK_ID.SIM_EFFECT_MATCH, "PASS", "BLOCKING", PAUSE_REASON_CODE.SIMULATION_EFFECT_MISMATCH, "simulator", now, "match", "ok"));
      } else {
        checks.push(makeCheck(CHECK_ID.SIM_EFFECT_MATCH, "FAIL", "BLOCKING", PAUSE_REASON_CODE.SIMULATION_EFFECT_MISMATCH, "simulator", now, "mismatch", "match"));
      }
      if (sim.freshnessOk === null) {
        checks.push(makeCheck(CHECK_ID.SIM_FRESHNESS, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.SIMULATION_STALE, "simulator", now, null, "fresh"));
      } else if (sim.freshnessOk) {
        checks.push(makeCheck(CHECK_ID.SIM_FRESHNESS, "PASS", "BLOCKING", PAUSE_REASON_CODE.SIMULATION_STALE, "simulator", now, "fresh", "ok"));
      } else {
        checks.push(makeCheck(CHECK_ID.SIM_FRESHNESS, "FAIL", "BLOCKING", PAUSE_REASON_CODE.SIMULATION_STALE, "simulator", now, "stale", "fresh"));
      }
      // PAUSE-SIM-004 is the catch-all UNKNOWN gate — if success unknown already handled; here we mark it as PASS when simulation known
      checks.push(makeCheck(CHECK_ID.SIM_UNKNOWN, sim.success === null ? "UNKNOWN" : "PASS", sim.success === null ? "BLOCKING" : "INFO", PAUSE_REASON_CODE.SIMULATION_UNKNOWN, "simulator", now, sim.success === null ? null : "known", "known"));
    }
  }

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
