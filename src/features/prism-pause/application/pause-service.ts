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
import type { OperationStore } from "../../prism-operations/domain/operation-store";
import type { PauseExecutionAdapter, SettlementChain } from "../ports/execution-adapter";
import { resolveChainFromPlan } from "../ports/execution-adapter";
import type { PauseMetrics } from "../ports/metrics";

export interface PauseServiceOptions {
  store: PauseStore;
  // default TTLs if not supplied per intent
  defaultPauseTtlMs?: number;
  // P5 settlement bridge — injectable, no live chain call. When present, RELEASED creates durable Operation.
  operationStore?: OperationStore;
  executionAdapters?: Map<SettlementChain, PauseExecutionAdapter>;
  metrics?: PauseMetrics;
  now?: () => number;
}

let decisionSeq = 0;
function nextDecisionId(): string { decisionSeq +=1; return `dec_${Date.now()}_${decisionSeq}`; }

export class PauseService {
  constructor(private readonly store: PauseStore, private readonly opts: PauseServiceOptions = { store: undefined as unknown as PauseStore }) {
    if (!opts.store) this.opts = { store, defaultPauseTtlMs: 10*60*1000 }; else this.opts = opts;
    // Ensure defaults for settlement fields
    if (!this.opts.now) this.opts.now = () => Date.now();
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
    const now = input.now ?? (this.opts.now ? this.opts.now() : Date.now());
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
    try { this.opts.metrics?.increment(completed.state === "RELEASE_READY" ? "pause_verified" : "pause_verify_blocked_unknown", { state: completed.state, risk: completed.riskLevel }); } catch {}
    if (completed.state === "ESCALATED") {
      await this.store.appendDecision({ decisionId: nextDecisionId(), pauseId: pause.pauseId, kind: "ESCALATE", actor: "policy_engine", policyVersion: pause.policyVersion, planHash: pause.planHash, approvalScopeHash: completed.approvalScopeHash, reasonCodes: [...completed.reasonCodes], createdAt: now });
    }
    return next;
  }

  async release(input: { pauseId: string; planHash: Hex; approvalScopeHash?: Hex | null; settlementOperationId: string; now?: number; expectedVersion?: number; correlationId?: string | null }): Promise<ExecutionPause> {
    const now = input.now ?? (this.opts.now ? this.opts.now() : Date.now());
    const pause = await this.store.getPause(input.pauseId);
    if (!pause) throw new PauseError(PAUSE_ERROR_CODE.PAUSE_NOT_FOUND, input.pauseId);
    const expectedVersion = input.expectedVersion ?? pause.version;
    const next = domainRelease(pause, { planHash: input.planHash, approvalScopeHash: input.approvalScopeHash ?? null, settlementOperationId: input.settlementOperationId, now, expectedVersion });
    const persisted = await this.store.updatePause(next, expectedVersion);
    await this.store.appendDecision({ decisionId: nextDecisionId(), pauseId: pause.pauseId, kind: "RELEASE", actor: "user", policyVersion: pause.policyVersion, planHash: pause.planHash, approvalScopeHash: computeApprovalScopeHash(pause.pauseId, pause.planHash, pause.policyVersion), reasonCodes: [...persisted.reasonCodes], createdAt: now });
    try { this.opts.metrics?.increment("pause_released", { state: persisted.state }); } catch {}
    // P5 settlement bridge: create durable Operation intent/plan link without marking completed; then submit via injected adapter (no live call).
    if (this.opts.operationStore) {
      const plan = await this.store.getPlan(persisted.planHash);
      if (plan) {
        const fingerprint = `${persisted.planHash}:${persisted.policyVersion}:${persisted.pauseId}`;
        const idempotencyKey = `pause_settlement:${persisted.pauseId}:${persisted.planHash}`;
        const opId = input.settlementOperationId;
        // Idempotent operation creation: same key + fingerprint benign; different fingerprint conflicts
        let op = await this.opts.operationStore.getById(opId);
        if (!op) {
          const existingByKey = await this.opts.operationStore.getByIdempotencyKey(idempotencyKey);
          if (existingByKey) {
            if (existingByKey.requestFingerprint !== fingerprint) {
              throw new PauseError(PAUSE_ERROR_CODE.IDEMPOTENCY_CONFLICT, `settlement idempotency fingerprint mismatch for ${opId}`);
            }
            op = existingByKey;
          } else {
            op = await this.opts.operationStore.create({
              id: opId,
              kind: `pause_settlement:${resolveChainFromPlan(plan)}`,
              idempotencyKey,
              requestFingerprint: fingerprint,
              now,
              correlationId: input.correlationId ?? null,
            });
            try { this.opts.metrics?.increment("settlement_operation_created", { chain: resolveChainFromPlan(plan) }); } catch {}
          }
        }
        // Submit via injected adapter if available and op not yet terminal/completed. Never mark completed.
        if (this.opts.executionAdapters) {
          const chain = resolveChainFromPlan(plan);
          const adapter = this.opts.executionAdapters.get(chain);
          if (adapter) {
            // Only submit if op is not already submitted or beyond; otherwise idempotent.
            if (!["submitted", "processing", "confirming", "confirmed", "indexed", "reconciled", "completed"].includes(op.state)) {
              // legal path: created -> awaiting_authorization -> ready -> submitted
              if (op.state === "created") {
                op = await this.opts.operationStore.transition(op.id, { to: "awaiting_authorization", now, expectedVersion: op.version });
                op = await this.opts.operationStore.transition(op.id, { to: "ready", now, expectedVersion: op.version });
              } else if (op.state === "awaiting_authorization") {
                op = await this.opts.operationStore.transition(op.id, { to: "ready", now, expectedVersion: op.version });
              }
              if (op.state === "ready") {
                // deterministic fake txHash via adapter's submit logic (reuse adapter for txHash generation by delegating to transition)
                // Generate same fake as adapter: if adapter provides custom, use it; otherwise use local submit path.
                try {
                  const submitted = await adapter.submit({ operation: op, pause: persisted, plan, correlationId: input.correlationId ?? null, operationId: opId });
                  if (submitted.state === "completed") throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, "adapter_must_not_mark_completed");
                  try { this.opts.metrics?.increment("settlement_operation_submitted", { chain }); } catch {}
                } catch (e) {
                  if (e instanceof PauseError) throw e;
                  // adapter failure is retryable dependency, don't fail the pause release itself — operation remains created/ready for retry
                  try { this.opts.metrics?.increment("pause_release_blocked", { reason: "adapter_submit_failed" }); } catch {}
                }
              }
            }
          }
        }
      }
    }
    return persisted;
  }

  async cancel(input: { pauseId: string; now?: number; expectedVersion?: number; reason?: string }): Promise<ExecutionPause> {
    const now = input.now ?? (this.opts.now ? this.opts.now() : Date.now());
    const pause = await this.store.getPause(input.pauseId);
    if (!pause) throw new PauseError(PAUSE_ERROR_CODE.PAUSE_NOT_FOUND, input.pauseId);
    const expectedVersion = input.expectedVersion ?? pause.version;
    const next = domainCancel(pause, { now, expectedVersion, reason: input.reason });
    const persisted = await this.store.updatePause(next, expectedVersion);
    await this.store.appendDecision({ decisionId: nextDecisionId(), pauseId: pause.pauseId, kind: "CANCEL", actor: "user", policyVersion: pause.policyVersion, planHash: pause.planHash, approvalScopeHash: pause.approvalScopeHash, reasonCodes: [...persisted.reasonCodes], createdAt: now });
    try { this.opts.metrics?.increment("pause_cancelled"); } catch {}
    return persisted;
  }

  async escalate(input: { pauseId: string; reasonCodes: readonly string[]; requiredApprovalCount: number; now?: number; expectedVersion?: number }): Promise<ExecutionPause> {
    const now = input.now ?? (this.opts.now ? this.opts.now() : Date.now());
    const pause = await this.store.getPause(input.pauseId);
    if (!pause) throw new PauseError(PAUSE_ERROR_CODE.PAUSE_NOT_FOUND, input.pauseId);
    const expectedVersion = input.expectedVersion ?? pause.version;
    const next = domainEscalate(pause, { reasonCodes: input.reasonCodes, requiredApprovalCount: input.requiredApprovalCount, now, expectedVersion });
    const persisted = await this.store.updatePause(next, expectedVersion);
    await this.store.appendDecision({ decisionId: nextDecisionId(), pauseId: pause.pauseId, kind: "ESCALATE", actor: "policy_engine", policyVersion: pause.policyVersion, planHash: pause.planHash, approvalScopeHash: persisted.approvalScopeHash, reasonCodes: [...input.reasonCodes], createdAt: now });
    try { this.opts.metrics?.increment("pause_escalated"); } catch {}
    return persisted;
  }

  async approve(input: { pauseId: string; planHash: Hex; approvalScopeHash?: Hex | null; now?: number; expectedVersion?: number }): Promise<ExecutionPause> {
    const now = input.now ?? (this.opts.now ? this.opts.now() : Date.now());
    const pause = await this.store.getPause(input.pauseId);
    if (!pause) throw new PauseError(PAUSE_ERROR_CODE.PAUSE_NOT_FOUND, input.pauseId);
    const expectedVersion = input.expectedVersion ?? pause.version;
    const next = approveEscalation(pause, { planHash: input.planHash, approvalScopeHash: input.approvalScopeHash ?? null, now, expectedVersion });
    const persisted = await this.store.updatePause(next, expectedVersion);
    await this.store.appendDecision({ decisionId: nextDecisionId(), pauseId: pause.pauseId, kind: "APPROVE", actor: "controller", policyVersion: pause.policyVersion, planHash: pause.planHash, approvalScopeHash: persisted.approvalScopeHash, reasonCodes: [...persisted.reasonCodes], createdAt: now });
    try { this.opts.metrics?.increment("pause_approved", { to: persisted.state }); } catch {}
    return persisted;
  }

  async reverify(input: { pauseId: string; now?: number; expectedVersion?: number }): Promise<ExecutionPause> {
    const now = input.now ?? (this.opts.now ? this.opts.now() : Date.now());
    const pause = await this.store.getPause(input.pauseId);
    if (!pause) throw new PauseError(PAUSE_ERROR_CODE.PAUSE_NOT_FOUND, input.pauseId);
    const expectedVersion = input.expectedVersion ?? pause.version;
    const next = domainReverify(pause, { now, expectedVersion });
    const persisted = await this.store.updatePause(next, expectedVersion);
    await this.store.appendDecision({ decisionId: nextDecisionId(), pauseId: pause.pauseId, kind: "REVERIFY", actor: "policy_engine", policyVersion: pause.policyVersion, planHash: pause.planHash, approvalScopeHash: pause.approvalScopeHash, reasonCodes: [...persisted.reasonCodes], createdAt: now });
    return persisted;
  }

  async expire(input: { pauseId: string; now?: number; expectedVersion?: number }): Promise<ExecutionPause> {
    const now = input.now ?? (this.opts.now ? this.opts.now() : Date.now());
    const pause = await this.store.getPause(input.pauseId);
    if (!pause) throw new PauseError(PAUSE_ERROR_CODE.PAUSE_NOT_FOUND, input.pauseId);
    const next = domainExpire(pause, now, input.expectedVersion);
    const expectedVersion = input.expectedVersion ?? pause.version;
    const persisted = await this.store.updatePause(next, expectedVersion);
    await this.store.appendDecision({ decisionId: nextDecisionId(), pauseId: pause.pauseId, kind: "EXPIRE", actor: "system", policyVersion: pause.policyVersion, planHash: pause.planHash, approvalScopeHash: pause.approvalScopeHash, reasonCodes: ["PAUSE_EXPIRED"], createdAt: now });
    try { this.opts.metrics?.increment("pause_expired"); } catch {}
    return persisted;
  }

  async sweepExpired(now?: number): Promise<readonly ExecutionPause[]> {
    const n = now ?? (this.opts.now ? this.opts.now() : Date.now());
    const expired = await this.store.listExpired(n, 100);
    const results: ExecutionPause[] = [];
    for (const p of expired) {
      try {
        const next = await this.expire({ pauseId: p.pauseId, now: n });
        results.push(next);
      } catch {}
    }
    try { this.opts.metrics?.increment("pause_sweep", { count: String(results.length) }); } catch {}
    return results;
  }

  async getPause(pauseId: string): Promise<ExecutionPause | undefined> { return this.store.getPause(pauseId); }
  async getIntent(intentId: string): Promise<ExecutionIntent | undefined> { return this.store.getIntent(intentId); }
}
