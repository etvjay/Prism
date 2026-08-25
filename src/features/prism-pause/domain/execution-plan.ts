// Canonical ExecutionPlan — normalized route + deterministic plan_hash.
// No framework imports. Pure domain value.
// Spec: PRISM_PAUSE_PHASE_PLAN §2 (ExecutionPlan) + §3 illegal transitions.

import { createHash } from "node:crypto";
import { PauseError, PAUSE_ERROR_CODE } from "./errors";
import { canonicalizeRecipient } from "./recipient";

export type Hex = `0x${string}`;

export interface ExecutionPlan {
  readonly planHash: Hex;
  readonly chainId: string; // exact destination chain (normalized)
  readonly asset: string; // exact token/asset contract (normalized)
  readonly recipient: string; // normalized destination/capability
  readonly calls: readonly string[]; // canonical call summary or calldata commitment (sorted? preserved order is canonical)
  readonly valueLimits: {
    readonly maxValue: string;
    readonly slippageBps?: number | null;
    readonly maxFee?: string | null;
    readonly maxGas?: string | null;
  };
  readonly policyVersion: string; // snapshot used for evaluation
  readonly simulationRef?: string | null;
  readonly intentId: string;
  readonly createdAt: number;
}

export interface CreateExecutionPlanInput {
  chainId: string;
  asset: string;
  recipient: string;
  calls: readonly string[];
  valueLimits: { maxValue: string; slippageBps?: number | null; maxFee?: string | null; maxGas?: string | null };
  policyVersion: string;
  simulationRef?: string | null;
  intentId: string;
  createdAt: number;
}

function requireNonEmpty(v: string, field: string): string {
  if (typeof v !== "string" || v.trim().length === 0) throw new PauseError(PAUSE_ERROR_CODE.INVALID_PLAN, `${field}_required`);
  return v.trim();
}

function normalizeChainId(v: string): string {
  const s = requireNonEmpty(v, "chain_id");
  // canonical lower-case, strip spaces; keep numeric string as-is but normalized
  return s.toLowerCase().replace(/\s+/g, "");
}

function normalizeAddressLike(v: string, field: string): string {
  const s = requireNonEmpty(v, field);
  // hex addresses normalized to lower-case; non-hex identifiers lower-cased trimmed
  if (s.startsWith("0x") || s.startsWith("0X")) {
    if (!/^0x[0-9a-fA-F]+$/.test(s)) throw new PauseError(PAUSE_ERROR_CODE.INVALID_PLAN, `${field}_malformed_hex`);
    return s.toLowerCase() as string;
  }
  return s.toLowerCase();
}

function normalizeCalls(calls: readonly string[]): readonly string[] {
  if (!Array.isArray(calls)) throw new PauseError(PAUSE_ERROR_CODE.INVALID_PLAN, "calls_must_be_array");
  if (calls.length === 0) throw new PauseError(PAUSE_ERROR_CODE.INVALID_PLAN, "calls_empty");
  return calls.map((c, i) => {
    if (typeof c !== "string" || c.trim().length === 0) throw new PauseError(PAUSE_ERROR_CODE.INVALID_PLAN, `calls[${i}]_empty`);
    return c.trim();
  });
}

function validateValueLimits(v: { maxValue: string; slippageBps?: number | null; maxFee?: string | null; maxGas?: string | null }) {
  if (!v || typeof v.maxValue !== "string" || v.maxValue.trim().length === 0) throw new PauseError(PAUSE_ERROR_CODE.INVALID_PLAN, "maxValue_required");
  if (v.slippageBps !== undefined && v.slippageBps !== null) {
    if (!Number.isInteger(v.slippageBps) || v.slippageBps < 0 || v.slippageBps > 10000) throw new PauseError(PAUSE_ERROR_CODE.INVALID_PLAN, "slippageBps_invalid");
  }
}

export interface CanonicalPlanPayload {
  chain_id: string;
  asset: string;
  recipient: string;
  calls: readonly string[];
  value_limits: { max_value: string; slippage_bps: number | null; max_fee: string | null; max_gas: string | null };
  policy_version: string;
  intent_id: string;
}

// Deterministic serialization: sorted keys, no whitespace variance.
// Uses JSON.stringify with explicit key order.
function canonicalJson(payload: CanonicalPlanPayload): string {
  return JSON.stringify({
    asset: payload.asset,
    calls: payload.calls,
    chain_id: payload.chain_id,
    intent_id: payload.intent_id,
    policy_version: payload.policy_version,
    recipient: payload.recipient,
    value_limits: {
      max_fee: payload.value_limits.max_fee,
      max_gas: payload.value_limits.max_gas,
      max_value: payload.value_limits.max_value,
      slippage_bps: payload.value_limits.slippage_bps,
    },
  });
}

export function computePlanHash(payload: CanonicalPlanPayload): Hex {
  const canonical = canonicalJson(payload);
  const digest = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `0x${digest}` as Hex;
}

export function createExecutionPlan(input: CreateExecutionPlanInput): ExecutionPlan {
  const chainId = normalizeChainId(input.chainId);
  const asset = normalizeAddressLike(input.asset, "asset");
  const recipient = canonicalizeRecipient(input.recipient, "recipient", PAUSE_ERROR_CODE.INVALID_PLAN);
  const calls = normalizeCalls(input.calls);
  validateValueLimits(input.valueLimits);
  const policyVersion = requireNonEmpty(input.policyVersion, "policy_version");
  const intentId = requireNonEmpty(input.intentId, "intent_id");
  if (!Number.isFinite(input.createdAt)) throw new PauseError(PAUSE_ERROR_CODE.INVALID_PLAN, "created_at_invalid");

  const payload: CanonicalPlanPayload = {
    chain_id: chainId,
    asset,
    recipient,
    calls,
    value_limits: {
      max_value: input.valueLimits.maxValue.trim(),
      slippage_bps: input.valueLimits.slippageBps ?? null,
      max_fee: input.valueLimits.maxFee?.trim() ?? null,
      max_gas: input.valueLimits.maxGas?.trim() ?? null,
    },
    policy_version: policyVersion,
    intent_id: intentId,
  };
  const planHash = computePlanHash(payload);
  return {
    planHash,
    chainId,
    asset,
    recipient,
    calls,
    valueLimits: {
      maxValue: payload.value_limits.max_value,
      slippageBps: payload.value_limits.slippage_bps,
      maxFee: payload.value_limits.max_fee,
      maxGas: payload.value_limits.max_gas,
    },
    policyVersion,
    simulationRef: input.simulationRef ?? null,
    intentId,
    createdAt: input.createdAt,
  };
}

export function canonicalPlanPayloadOf(plan: ExecutionPlan): CanonicalPlanPayload {
  return {
    chain_id: plan.chainId,
    asset: plan.asset,
    recipient: plan.recipient,
    calls: plan.calls,
    value_limits: {
      max_value: plan.valueLimits.maxValue,
      slippage_bps: plan.valueLimits.slippageBps ?? null,
      max_fee: plan.valueLimits.maxFee ?? null,
      max_gas: plan.valueLimits.maxGas ?? null,
    },
    policy_version: plan.policyVersion,
    intent_id: plan.intentId,
  };
}

export function verifyPlanHash(plan: ExecutionPlan): boolean {
  const payload = canonicalPlanPayloadOf(plan);
  return computePlanHash(payload) === plan.planHash;
}
