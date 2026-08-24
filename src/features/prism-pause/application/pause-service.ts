// Application service — coordinates Intent/Plan/Pause lifecycle.
// Pure use-case orchestration over PauseStore port. No HTTP, no DB driver beyond port.
// Requirements:
// - idempotency (clientIdempotencyKey) at intent layer
// - deterministic plan_hash
// - expiry guard (intent and pause)
// - CAS version on every mutation
// - plan_hash and approval_scope binding for release/cancel/escalate/reverify/expire
// - RELEASED creates future Operation link only, never completed.

import type { PauseStore, PauseDecision } from "../ports/pause-store";
import { createIntent, isIntentExpired } from "../domain/intent";
import type { ExecutionIntent } from "../domain/intent";
import { createExecutionPlan, verifyPlanHash } from "../domain/execution-plan";
import type { ExecutionPlan, Hex } from "../domain/execution-plan";
import { createPause, computeApprovalScopeHash, toVerifying, completeVerification, escalate as domainEscalate, approveEscalation, release as domainRelease, cancel as domainCancel, expire as domainExpire, reverify as domainReverify } from "../domain/pause";
import type { ExecutionPause } from "../domain/pause";
import { evaluatePolicy } from "../domain/policy-engine";
import type { Policy, VerificationSources } from "../domain/policy-engine";
import { PauseError, PAUSE_ERROR_CODE } from "../domain/errors";

export interface PauseServiceOptions {
  store: PauseStore;
  // default TTLs if not supplied per intent
  defaultPauseTtlMs?: number;
}

let decisionSeq = 0;
function nextDecisionId(): string { decisionSeq +=1; return `dec_${Date.now()}_${decisionSeq}`; }

export class PauseService {
  constructor(private readonly store: PauseStore, private readonly opts: PauseServiceOptions = { store: undefined as unknown as PauseStore }) {
    if (!opts.store) this.opts = { store, defaultPauseTtlMs: 10*60*1000 }; else this.opts = opts;
  }

  // P1: create intent + normalized plan + pause (idempotent)
  async createIntent(input: Parameters<typeof createIntent>[0]): Promise<ExecutionIntent> {
    // Create via domain validation first (createdAt < expiresAt invariant). Expiry is enforced at pause/verify time with caller-supplied now.
    const intent = createIntent(input);
    return this.store.putIntent(intent);
  }

  async createPlan(input: Parameters<typeof createExecutionPlan>[0]): Promise<ExecutionPlan> {
    const plan = createExecutionPlan(input);
    if (!verifyPlanHash(plan)) throw new PauseError(PAUSE_ERROR_CODE.INVALID_PLAN, "plan_hash_verify_failed");
    // ensure intent exists
    const intent = await this.store.getIntent(plan.intentId);
    if (!intent) throw new PauseError(PAUSE_ERROR_CODE.INTENT_NOT_FOUND, plan.intentId);
    if (intent.policyVersion !== plan.policyVersion) throw new PauseError(PAUSE_ERROR_CODE.POLICY_VERSION_MISMATCH, `intent policy ${intent.policyVersion} != plan ${plan.policyVersion}`);
    return this.store.putPlan(plan);
  }

  async pause(input: { intentId: string; planHash: Hex; now?: number }): Promise<ExecutionPause> {
    const now = input.now ?? Date.now();
    const intent = await this.store.getIntent(input.intentId);
    if (!intent) throw new PauseError(PAUSE_ERROR_CODE.INTENT_NOT_FOUND, input.intentId);
    if (isIntentExpired(intent, now)) throw new PauseError(PAUSE_ERROR_CODE.INTENT_EXPIRED, intent.intentId);
    const plan = await this.store.getPlan(input.planHash);
    if (!plan) throw new PauseError(PAUSE_ERROR_CODE.INVALID_PLAN, `plan not found ${input.planHash}`);
    if (plan.intentId !== intent.intentId) throw new PauseError(PAUSE_ERROR_CODE.PLAN_HASH_MISMATCH, "plan intent mismatch");
    if (!verifyPlanHash(plan)) throw new PauseError(PAUSE_ERROR_CODE.INVALID_PLAN, "plan_hash_verify_failed");

    const pauseId = `pause_${intent.intentId}_v${intent.intentVersion}`;
    const existing = await this.store.getPause(pauseId);
    if (existing) return existing;
    // also check by intent (active guard in store)
    const byIntent = await this.store.getPauseByIntent(intent.intentId);
    if (byIntent && !["CANCELLED","EXPIRED","RELEASED"].includes(byIntent.state)) throw new PauseError(PAUSE_ERROR_CODE.DUPLICATE_PAUSE, `active_pause_exists:${intent.intentId}`);

    const ttl = this.opts.defaultPauseTtlMs ?? 10*60*1000;
    const pause = createPause({ pauseId, intentId: intent.intentId, planHash: plan.planHash, policyVersion: plan.policyVersion, createdAt: now, expiresAt: now + ttl });
    return this.store.createPause({ intent, plan, pause });
  }

  async verify(input: { pauseId: string; policy: Policy; sources: VerificationSources; now?: number }): Promise<ExecutionPause> {
    const now = input.now ?? Date.now();
    const pause = await this.store.getPause(input.pauseId);
    if (!pause) throw new PauseError(PAUSE_ERROR_CODE.PAUSE_NOT_FOUND, input.pauseId);
    const plan = await this.store.getPlan(pause.planHash);
    if (!plan) throw new PauseError(PAUSE_ERROR_CODE.INVALID_PLAN, pause.planHash);
    const intent = await this.store.getIntent(pause.intentId);
    if (!intent) throw new PauseError(PAUSE_ERROR_CODE.INTENT_NOT_FOUND, pause.intentId);
    if (now >= pause.expiresAt) {
      // auto-expire path
      const expired = domainExpire(pause, now, pause.version);
      const next = await this.store.updatePause(expired, pause.version);
      await this.store.appendDecision({ decisionId: nextDecisionId(), pauseId: pause.pauseId, kind: "EXPIRE", actor: "system", policyVersion: pause.policyVersion, planHash: pause.planHash, approvalScopeHash: null, reasonCodes: ["PAUSE_EXPIRED"], createdAt: now });
      return next;
    }
    if (pause.policyVersion !== input.policy.policyVersion) throw new PauseError(PAUSE_ERROR_CODE.POLICY_VERSION_MISMATCH, `pause ${pause.policyVersion} != policy ${input.policy.policyVersion}`);
    // to verifying
    let verifying: ExecutionPause;
    try {
      verifying = toVerifying(pause, now, pause.version);
    } catch (e) {
      // if already VERIFYING, allow re-entry via completeVerification directly
      if (pause.state === "VERIFYING") verifying = pause;
      else throw e;
    }
    if (verifying !== pause) {
      await this.store.updatePause(verifying, pause.version);
    }
    const current = verifying !== pause ? verifying : pause;
    const checks = evaluatePolicy({ intent, plan, pause: current, policy: input.policy, sources: input.sources, now });
    const completed = completeVerification(current, { checks, now, expectedVersion: current.version });
    await this.store.putChecks(pause.pauseId, checks);
    const next = await this.store.updatePause(completed, current.version);
    // decision for verify is not a PauseDecision kind; we append a REVERIFY-like audit if needed? Use REVERIFY for verify cycle
    return next;
  }

  async release(input: { pauseId: string; planHash: Hex; approvalScopeHash?: Hex | null; settlementOperationId: string; now?: number; expectedVersion?: number }): Promise<ExecutionPause> {
    const now = input.now ?? Date.now();
    const pause = await this.store.getPause(input.pauseId);
    if (!pause) throw new PauseError(PAUSE_ERROR_CODE.PAUSE_NOT_FOUND, input.pauseId);
    const expectedVersion = input.expectedVersion ?? pause.version;
    const next = domainRelease(pause, { planHash: input.planHash, approvalScopeHash: input.approvalScopeHash ?? null, settlementOperationId: input.settlementOperationId, now, expectedVersion });
    const persisted = await this.store.updatePause(next, expectedVersion);
    await this.store.appendDecision({ decisionId: nextDecisionId(), pauseId: pause.pauseId, kind: "RELEASE", actor: "user", policyVersion: pause.policyVersion, planHash: pause.planHash, approvalScopeHash: computeApprovalScopeHash(pause.pauseId, pause.planHash, pause.policyVersion), reasonCodes: [...persisted.reasonCodes], createdAt: now });
    return persisted;
  }

  async cancel(input: { pauseId: string; now?: number; expectedVersion?: number; reason?: string }): Promise<ExecutionPause> {
    const now = input.now ?? Date.now();
    const pause = await this.store.getPause(input.pauseId);
    if (!pause) throw new PauseError(PAUSE_ERROR_CODE.PAUSE_NOT_FOUND, input.pauseId);
    const expectedVersion = input.expectedVersion ?? pause.version;
    const next = domainCancel(pause, { now, expectedVersion, reason: input.reason });
    const persisted = await this.store.updatePause(next, expectedVersion);
    await this.store.appendDecision({ decisionId: nextDecisionId(), pauseId: pause.pauseId, kind: "CANCEL", actor: "user", policyVersion: pause.policyVersion, planHash: pause.planHash, approvalScopeHash: pause.approvalScopeHash, reasonCodes: [...persisted.reasonCodes], createdAt: now });
    return persisted;
  }

  async escalate(input: { pauseId: string; reasonCodes: readonly string[]; requiredApprovalCount: number; now?: number; expectedVersion?: number }): Promise<ExecutionPause> {
    const now = input.now ?? Date.now();
    const pause = await this.store.getPause(input.pauseId);
    if (!pause) throw new PauseError(PAUSE_ERROR_CODE.PAUSE_NOT_FOUND, input.pauseId);
    const expectedVersion = input.expectedVersion ?? pause.version;
    const next = domainEscalate(pause, { reasonCodes: input.reasonCodes, requiredApprovalCount: input.requiredApprovalCount, now, expectedVersion });
    const persisted = await this.store.updatePause(next, expectedVersion);
    await this.store.appendDecision({ decisionId: nextDecisionId(), pauseId: pause.pauseId, kind: "ESCALATE", actor: "policy_engine", policyVersion: pause.policyVersion, planHash: pause.planHash, approvalScopeHash: persisted.approvalScopeHash, reasonCodes: [...input.reasonCodes], createdAt: now });
    return persisted;
  }

  async approve(input: { pauseId: string; planHash: Hex; approvalScopeHash?: Hex | null; now?: number; expectedVersion?: number }): Promise<ExecutionPause> {
    const now = input.now ?? Date.now();
    const pause = await this.store.getPause(input.pauseId);
    if (!pause) throw new PauseError(PAUSE_ERROR_CODE.PAUSE_NOT_FOUND, input.pauseId);
    const expectedVersion = input.expectedVersion ?? pause.version;
    const next = approveEscalation(pause, { planHash: input.planHash, approvalScopeHash: input.approvalScopeHash ?? null, now, expectedVersion });
    const persisted = await this.store.updatePause(next, expectedVersion);
    await this.store.appendDecision({ decisionId: nextDecisionId(), pauseId: pause.pauseId, kind: "APPROVE", actor: "controller", policyVersion: pause.policyVersion, planHash: pause.planHash, approvalScopeHash: persisted.approvalScopeHash, reasonCodes: [...persisted.reasonCodes], createdAt: now });
    return persisted;
  }

  async reverify(input: { pauseId: string; now?: number; expectedVersion?: number }): Promise<ExecutionPause> {
    const now = input.now ?? Date.now();
    const pause = await this.store.getPause(input.pauseId);
    if (!pause) throw new PauseError(PAUSE_ERROR_CODE.PAUSE_NOT_FOUND, input.pauseId);
    const expectedVersion = input.expectedVersion ?? pause.version;
    const next = domainReverify(pause, { now, expectedVersion });
    const persisted = await this.store.updatePause(next, expectedVersion);
    await this.store.appendDecision({ decisionId: nextDecisionId(), pauseId: pause.pauseId, kind: "REVERIFY", actor: "policy_engine", policyVersion: pause.policyVersion, planHash: pause.planHash, approvalScopeHash: pause.approvalScopeHash, reasonCodes: [...persisted.reasonCodes], createdAt: now });
    return persisted;
  }

  async expire(input: { pauseId: string; now?: number; expectedVersion?: number }): Promise<ExecutionPause> {
    const now = input.now ?? Date.now();
    const pause = await this.store.getPause(input.pauseId);
    if (!pause) throw new PauseError(PAUSE_ERROR_CODE.PAUSE_NOT_FOUND, input.pauseId);
    const next = domainExpire(pause, now, input.expectedVersion);
    const expectedVersion = input.expectedVersion ?? pause.version;
    const persisted = await this.store.updatePause(next, expectedVersion);
    await this.store.appendDecision({ decisionId: nextDecisionId(), pauseId: pause.pauseId, kind: "EXPIRE", actor: "system", policyVersion: pause.policyVersion, planHash: pause.planHash, approvalScopeHash: pause.approvalScopeHash, reasonCodes: ["PAUSE_EXPIRED"], createdAt: now });
    return persisted;
  }

  async sweepExpired(now?: number): Promise<readonly ExecutionPause[]> {
    const n = now ?? Date.now();
    const expired = await this.store.listExpired(n, 100);
    const results: ExecutionPause[] = [];
    for (const p of expired) {
      try {
        const next = await this.expire({ pauseId: p.pauseId, now: n });
        results.push(next);
      } catch {}
    }
    return results;
  }

  async getPause(pauseId: string): Promise<ExecutionPause | undefined> { return this.store.getPause(pauseId); }
  async getIntent(intentId: string): Promise<ExecutionIntent | undefined> { return this.store.getIntent(intentId); }
}
