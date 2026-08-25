// Durable Pause domain state machine — P2 foundation.
// States: PAUSED, VERIFYING, RELEASE_READY, CANCELLED, ESCALATED, EXPIRED, RELEASED
// No DB/RPC imports. Pure transition function with CAS expectedVersion guard.
// Invariants:
// - RELEASED never means completed (creates future Operation link only).
// - plan_hash immutable binding; mutation requires reverify.
// - CANCELLED/EXPIRED never → RELEASED; RELEASED never → CANCELLED.
// - approval binding: approval_scope_hash ties plan_hash + decision.
// - fail-closed UNKNOWN blocking checks prevent RELEASE_READY.

import { PauseError, PAUSE_ERROR_CODE, PAUSE_REASON_CODE } from "./errors";
import type { Hex } from "./execution-plan";
import type { CheckResult, RiskLevel } from "./checks";
import { assertTypedResults, hasBlockingFailure, deriveRiskLevel } from "./checks";
import { createHash } from "node:crypto";

export const PAUSE_STATE = {
  PAUSED: "PAUSED",
  VERIFYING: "VERIFYING",
  RELEASE_READY: "RELEASE_READY",
  CANCELLED: "CANCELLED",
  ESCALATED: "ESCALATED",
  EXPIRED: "EXPIRED",
  RELEASED: "RELEASED",
} as const;

export type PauseState = (typeof PAUSE_STATE)[keyof typeof PAUSE_STATE];

export const ALL_PAUSE_STATES: readonly PauseState[] = Object.values(PAUSE_STATE);

export function isPauseState(value: unknown): value is PauseState {
  return typeof value === "string" && (ALL_PAUSE_STATES as readonly string[]).includes(value);
}

export function assertPauseState(value: unknown, field = "state"): asserts value is PauseState {
  if (!isPauseState(value)) throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, `invalid_pause_state:${field}`);
}

export const TERMINAL_PAUSE_STATES: readonly PauseState[] = ["CANCELLED", "EXPIRED", "RELEASED"] as const;

export interface ExecutionPause {
  readonly pauseId: string;
  readonly intentId: string;
  readonly planHash: Hex;
  readonly policyVersion: string;
  readonly state: PauseState;
  readonly version: number;
  readonly reasonCodes: readonly string[];
  readonly riskLevel: RiskLevel;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly lastVerifiedAt: number | null;
  readonly checks: readonly CheckResult[];
  readonly requiredApprovalCount: number;
  readonly approvalScopeHash: Hex | null; // exact plan/decision binding (hash of planHash+policyVersion+pauseId)
  readonly settlementOperationId: string | null; // set only after RELEASED, future Operation link
  readonly decisionIds: readonly string[]; // append-only history
}

export interface CreatePauseInput {
  pauseId: string;
  intentId: string;
  planHash: Hex;
  policyVersion: string;
  createdAt: number;
  expiresAt: number;
}

function requireNonEmpty(v: string, field: string): string {
  if (typeof v !== "string" || v.trim().length === 0) throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, `${field}_required`);
  return v.trim();
}

export function computeApprovalScopeHash(pauseId: string, planHash: Hex, policyVersion: string): Hex {
  const canonical = JSON.stringify({ pause_id: pauseId, plan_hash: planHash, policy_version: policyVersion });
  const digest = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `0x${digest}` as Hex;
}

export function createPause(input: CreatePauseInput): ExecutionPause {
  const pauseId = requireNonEmpty(input.pauseId, "pause_id");
  const intentId = requireNonEmpty(input.intentId, "intent_id");
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.planHash)) throw new PauseError(PAUSE_ERROR_CODE.INVALID_PLAN, "plan_hash_malformed");
  const policyVersion = requireNonEmpty(input.policyVersion, "policy_version");
  if (!Number.isFinite(input.createdAt) || !Number.isFinite(input.expiresAt)) throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, "invalid_timestamps");
  if (input.expiresAt <= input.createdAt) throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, "expires_at_must_be_after_created_at");
  return {
    pauseId,
    intentId,
    planHash: input.planHash as Hex,
    policyVersion,
    state: PAUSE_STATE.PAUSED,
    version: 0,
    reasonCodes: [],
    riskLevel: "UNKNOWN",
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    lastVerifiedAt: null,
    checks: [],
    requiredApprovalCount: 0,
    approvalScopeHash: null,
    settlementOperationId: null,
    decisionIds: [],
  };
}

// Transition table
type TransitionSet = ReadonlySet<PauseState>;
function s(...states: PauseState[]): TransitionSet { return new Set(states); }

const ALLOWED: Record<PauseState, TransitionSet> = {
  PAUSED: s("VERIFYING", "CANCELLED", "EXPIRED"),
  VERIFYING: s("RELEASE_READY", "CANCELLED", "ESCALATED", "EXPIRED"),
  RELEASE_READY: s("RELEASED", "CANCELLED", "ESCALATED", "EXPIRED", "VERIFYING"),
  CANCELLED: s(),
  ESCALATED: s("RELEASE_READY", "CANCELLED", "EXPIRED", "VERIFYING"),
  EXPIRED: s(),
  RELEASED: s(),
};

export function canTransition(from: PauseState, to: PauseState): boolean {
  if (!isPauseState(from) || !isPauseState(to)) return false;
  if (from === to) return false; // same-state not idempotent for pause
  const allowed = ALLOWED[from];
  return allowed ? allowed.has(to) : false;
}

export interface VerifyInput {
  checks: readonly CheckResult[];
  now: number;
  expectedVersion: number;
  // require planHash unchanged (illegal mutation guard done externally)
}

export interface EscalateInput {
  reasonCodes: readonly string[];
  requiredApprovalCount: number;
  now: number;
  expectedVersion: number;
}

export interface ApproveInput {
  planHash: Hex;
  approvalScopeHash: Hex | null; // must match computed scope
  now: number;
  expectedVersion: number;
}

export interface ReleaseInput {
  planHash: Hex;
  approvalScopeHash?: Hex | null;
  settlementOperationId: string; // future Operation link (must be provided, not broadcast)
  now: number;
  expectedVersion: number;
}

export interface CancelInput { now: number; expectedVersion: number; reason?: string }
export interface ExpireInput { now: number; expectedVersion?: number } // internal sweeper may not supply version
export interface ReverifyInput { now: number; expectedVersion: number }

// Pure helpers
function assertVersion(pause: ExecutionPause, expected: number): void {
  if (pause.version !== expected) throw new PauseError(PAUSE_ERROR_CODE.STALE_VERSION, `stale_version:expected_${expected}_got_${pause.version}`);
}

function assertNotExpired(pause: ExecutionPause, now: number): void {
  if (now >= pause.expiresAt && pause.state !== "EXPIRED" && pause.state !== "RELEASED" && pause.state !== "CANCELLED") {
    // caller should expire first; but transition itself will be blocked by state check if needed
  }
}

// VERIFYING entry — must be PAUSED or reverify path
export function toVerifying(pause: ExecutionPause, now: number, expectedVersion: number): ExecutionPause {
  assertPauseState(pause.state);
  assertVersion(pause, expectedVersion);
  if (!canTransition(pause.state, PAUSE_STATE.VERIFYING)) throw new PauseError(PAUSE_ERROR_CODE.ILLEGAL_TRANSITION, `illegal_transition:${pause.state}->VERIFYING`);
  if (now >= pause.expiresAt) throw new PauseError(PAUSE_ERROR_CODE.PAUSE_EXPIRED, "pause_expired_cannot_verify");
  return { ...pause, state: PAUSE_STATE.VERIFYING, version: pause.version + 1, lastVerifiedAt: now };
}

// Complete verification with typed checks; fail-closed UNKNOWN => ESCALATED or stay VERIFYING
// Returns next pause (RELEASE_READY or ESCALATED or VERIFYING) — caller chooses? Instead we auto-route:
// - if blocking failure/unknown -> ESCALATED (if policy requires escalation) otherwise remains VERIFYING
// This pure function computes RELEASE_READY vs ESCALATED via hasBlockingFailure and requiredApprovalCount hint
export function completeVerification(pause: ExecutionPause, input: VerifyInput): ExecutionPause {
  assertPauseState(pause.state);
  if (!Array.isArray(input.checks) || input.checks.length === 0) throw new PauseError(PAUSE_ERROR_CODE.CHECK_UNKNOWN_BLOCKING, "verification_checks_missing");
  assertTypedResults(input.checks);
  assertVersion(pause, input.expectedVersion);
  if (pause.state !== PAUSE_STATE.VERIFYING) throw new PauseError(PAUSE_ERROR_CODE.ILLEGAL_TRANSITION, `completeVerification requires VERIFYING, got ${pause.state}`);
  if (input.now >= pause.expiresAt) {
    return { ...pause, state: PAUSE_STATE.EXPIRED, version: pause.version + 1, lastVerifiedAt: input.now, checks: input.checks, reasonCodes: input.checks.map((c) => c.reasonCode), riskLevel: deriveRiskLevel(input.checks) };
  }
  const blocking = hasBlockingFailure(input.checks);
  const riskLevel = deriveRiskLevel(input.checks);
  const reasonCodes = input.checks.map((c) => c.reasonCode);
  if (blocking) {
    // fail-closed: do not go to RELEASE_READY
    // If any check is ADDITIONAL_APPROVAL or HIGH risk, we go ESCALATED; otherwise stay VERIFYING with failure visible
    // For determinism, blocking -> ESCALATED so caller can approve; alternative is explicit escalate command.
    // We'll return ESCALATED to enforce fail-closed via escalation.
    return {
      ...pause,
      state: PAUSE_STATE.ESCALATED,
      version: pause.version + 1,
      lastVerifiedAt: input.now,
      checks: input.checks,
      reasonCodes,
      riskLevel,
      requiredApprovalCount: 1,
      approvalScopeHash: computeApprovalScopeHash(pause.pauseId, pause.planHash, pause.policyVersion),
    };
  }
  return {
    ...pause,
    state: PAUSE_STATE.RELEASE_READY,
    version: pause.version + 1,
    lastVerifiedAt: input.now,
    checks: input.checks,
    reasonCodes,
    riskLevel,
    requiredApprovalCount: 0,
    approvalScopeHash: computeApprovalScopeHash(pause.pauseId, pause.planHash, pause.policyVersion),
  };
}

export function escalate(pause: ExecutionPause, input: EscalateInput): ExecutionPause {
  assertPauseState(pause.state);
  assertVersion(pause, input.expectedVersion);
  if (!canTransition(pause.state, PAUSE_STATE.ESCALATED)) throw new PauseError(PAUSE_ERROR_CODE.ESCALATE_NOT_ALLOWED, `cannot_escalate_from_${pause.state}`);
  if (input.now >= pause.expiresAt) throw new PauseError(PAUSE_ERROR_CODE.PAUSE_EXPIRED, "pause_expired_cannot_escalate");
  if (!Number.isInteger(input.requiredApprovalCount) || input.requiredApprovalCount < 1) throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, "requiredApprovalCount_invalid");
  return {
    ...pause,
    state: PAUSE_STATE.ESCALATED,
    version: pause.version + 1,
    reasonCodes: [...input.reasonCodes],
    requiredApprovalCount: input.requiredApprovalCount,
    approvalScopeHash: computeApprovalScopeHash(pause.pauseId, pause.planHash, pause.policyVersion),
    lastVerifiedAt: input.now,
  };
}

export function approveEscalation(pause: ExecutionPause, input: ApproveInput): ExecutionPause {
  assertPauseState(pause.state);
  assertVersion(pause, input.expectedVersion);
  if (pause.state !== PAUSE_STATE.ESCALATED) throw new PauseError(PAUSE_ERROR_CODE.ILLEGAL_TRANSITION, `approve requires ESCALATED, got ${pause.state}`);
  if (!Array.isArray(pause.checks) || pause.checks.length === 0) throw new PauseError(PAUSE_ERROR_CODE.CHECK_UNKNOWN_BLOCKING, "verification_checks_missing");
  assertTypedResults(pause.checks);
  if (input.now >= pause.expiresAt) throw new PauseError(PAUSE_ERROR_CODE.PAUSE_EXPIRED, "pause_expired_cannot_approve");
  if (input.planHash !== pause.planHash) throw new PauseError(PAUSE_ERROR_CODE.PLAN_HASH_MISMATCH, `plan_hash_mismatch:expected_${pause.planHash}_got_${input.planHash}`);
  const expectedScope = computeApprovalScopeHash(pause.pauseId, pause.planHash, pause.policyVersion);
  if (input.approvalScopeHash !== null && input.approvalScopeHash !== expectedScope) throw new PauseError(PAUSE_ERROR_CODE.APPROVAL_SCOPE_MISMATCH, "approval_scope_hash_mismatch");
  if (input.approvalScopeHash === null && pause.approvalScopeHash !== null && pause.approvalScopeHash !== expectedScope) {
    throw new PauseError(PAUSE_ERROR_CODE.APPROVAL_SCOPE_MISMATCH, "approval_scope_required");
  }
  // Approval reduces required count by 1 (quorum simplified to 1 in this lane)
  // After approval, pause moves to RELEASE_READY if no blocking checks remain
  if (pause.checks.some((check) => check.status === "UNKNOWN") || pause.reasonCodes.includes(PAUSE_REASON_CODE.UNKNOWN_BLOCKING)) {
    // Every UNKNOWN verification result remains blocking until D-P0-003 is decided.
    throw new PauseError(PAUSE_ERROR_CODE.CHECK_UNKNOWN_BLOCKING, "unknown_blocking_cannot_approve_to_release");
  }
  return {
    ...pause,
    state: PAUSE_STATE.RELEASE_READY,
    version: pause.version + 1,
    lastVerifiedAt: input.now,
    approvalScopeHash: expectedScope,
  };
}

export function release(pause: ExecutionPause, input: ReleaseInput): ExecutionPause {
  assertPauseState(pause.state);
  assertVersion(pause, input.expectedVersion);
  if (pause.state !== PAUSE_STATE.RELEASE_READY) throw new PauseError(PAUSE_ERROR_CODE.RELEASE_NOT_READY, `release requires RELEASE_READY, got ${pause.state}`);
  if (!Array.isArray(pause.checks) || pause.checks.length === 0) throw new PauseError(PAUSE_ERROR_CODE.CHECK_UNKNOWN_BLOCKING, "verification_checks_missing");
  assertTypedResults(pause.checks);
  if (input.now >= pause.expiresAt) throw new PauseError(PAUSE_ERROR_CODE.EXPIRED_PAUSE_CANNOT_RELEASE, "pause_expired");
  if (input.planHash !== pause.planHash) throw new PauseError(PAUSE_ERROR_CODE.PLAN_HASH_MISMATCH, `plan_hash_mismatch:expected_${pause.planHash}_got_${input.planHash}`);
  const expectedScope = computeApprovalScopeHash(pause.pauseId, pause.planHash, pause.policyVersion);
  if (pause.approvalScopeHash !== null && pause.approvalScopeHash !== expectedScope) throw new PauseError(PAUSE_ERROR_CODE.APPROVAL_SCOPE_MISMATCH, "stored_approval_scope_mismatch");
  if (input.approvalScopeHash !== undefined && input.approvalScopeHash !== null && input.approvalScopeHash !== expectedScope) {
    throw new PauseError(PAUSE_ERROR_CODE.APPROVAL_SCOPE_MISMATCH, "supplied_approval_scope_mismatch");
  }
  if (hasBlockingFailure(pause.checks)) throw new PauseError(PAUSE_ERROR_CODE.CHECK_UNKNOWN_BLOCKING, "blocking_check_cannot_release");
  if (!input.settlementOperationId || input.settlementOperationId.trim().length === 0) throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, "settlement_operation_id_required");
  if (pause.settlementOperationId !== null) throw new PauseError(PAUSE_ERROR_CODE.OPERATION_ALREADY_LINKED, "operation_already_linked");
  return {
    ...pause,
    state: PAUSE_STATE.RELEASED,
    version: pause.version + 1,
    settlementOperationId: input.settlementOperationId,
    lastVerifiedAt: input.now,
  };
}

export function cancel(pause: ExecutionPause, input: CancelInput): ExecutionPause {
  assertPauseState(pause.state);
  assertVersion(pause, input.expectedVersion);
  if (pause.state === PAUSE_STATE.RELEASED) throw new PauseError(PAUSE_ERROR_CODE.CANCEL_NOT_ALLOWED, "released_cannot_cancel");
  if (pause.state === PAUSE_STATE.EXPIRED) throw new PauseError(PAUSE_ERROR_CODE.CANCEL_NOT_ALLOWED, "expired_cannot_cancel");
  if (pause.state === PAUSE_STATE.CANCELLED) throw new PauseError(PAUSE_ERROR_CODE.CANCEL_NOT_ALLOWED, "already_cancelled");
  if (!canTransition(pause.state, PAUSE_STATE.CANCELLED)) throw new PauseError(PAUSE_ERROR_CODE.CANCEL_NOT_ALLOWED, `cannot_cancel_from_${pause.state}`);
  if (pause.settlementOperationId !== null) throw new PauseError(PAUSE_ERROR_CODE.CANCEL_NOT_ALLOWED, "already_has_settlement_operation");
  const reasonCode = typeof input.reason === "string" && input.reason.trim().length > 0
    ? input.reason.trim()
    : PAUSE_REASON_CODE.CANCEL_REASON_UNSPECIFIED;
  return {
    ...pause,
    state: PAUSE_STATE.CANCELLED,
    version: pause.version + 1,
    reasonCodes: [...pause.reasonCodes, reasonCode],
  };
}

export function expire(pause: ExecutionPause, now: number, expectedVersion?: number): ExecutionPause {
  assertPauseState(pause.state);
  if (expectedVersion !== undefined && pause.version !== expectedVersion) throw new PauseError(PAUSE_ERROR_CODE.STALE_VERSION, `stale_version:expected_${expectedVersion}_got_${pause.version}`);
  if (pause.state === PAUSE_STATE.RELEASED || pause.state === PAUSE_STATE.CANCELLED || pause.state === PAUSE_STATE.EXPIRED) {
    throw new PauseError(PAUSE_ERROR_CODE.ILLEGAL_TRANSITION, `cannot_expire_from_${pause.state}`);
  }
  if (now < pause.expiresAt) throw new PauseError(PAUSE_ERROR_CODE.ILLEGAL_TRANSITION, "not_yet_expired");
  return { ...pause, state: PAUSE_STATE.EXPIRED, version: pause.version + 1 };
}

export function reverify(pause: ExecutionPause, input: ReverifyInput): ExecutionPause {
  assertPauseState(pause.state);
  assertVersion(pause, input.expectedVersion);
  if (!([PAUSE_STATE.RELEASE_READY, PAUSE_STATE.ESCALATED, PAUSE_STATE.VERIFYING] as readonly string[]).includes(pause.state)) {
    throw new PauseError(PAUSE_ERROR_CODE.REVERIFY_NOT_ALLOWED, `reverify not allowed from ${pause.state}`);
  }
  if (input.now >= pause.expiresAt) throw new PauseError(PAUSE_ERROR_CODE.PAUSE_EXPIRED, "pause_expired_cannot_reverify");
  return { ...pause, state: PAUSE_STATE.VERIFYING, version: pause.version + 1, lastVerifiedAt: input.now };
}

// Guard: plan mutation after approval invalidates decision → caller must reverify.
// Pure helper to detect plan change.
export function isPlanHashChanged(pause: ExecutionPause, candidatePlanHash: Hex): boolean {
  return pause.planHash !== candidatePlanHash;
}
