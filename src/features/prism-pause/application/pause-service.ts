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
import { evaluatePolicy, normalizeVerificationSources } from "../domain/policy-engine";
import type { Policy, VerificationSources } from "../domain/policy-engine";
import { PauseError, PAUSE_ERROR_CODE } from "../domain/errors";
import { assertRecipientMatches } from "../domain/recipient";
import type { OperationStore, PersistedOperation } from "../../prism-operations/domain/operation-store";
import type { PauseExecutionAdapter, SettlementChain } from "../ports/execution-adapter";
import { resolveChainFromPlan } from "../ports/execution-adapter";
import type { PauseMetrics } from "../ports/metrics";
import type { PauseAuthorityAction, PauseAuthorityActor, PauseAuthorityDecision, PauseAuthorityResolver } from "../ports/authority";
import { TERMINAL_FAILURE_STATES, TERMINAL_STATES } from "../../prism-operations/domain/operation";

export interface PauseServiceOptions {
  store: PauseStore;
  // default TTLs if not supplied per intent
  defaultPauseTtlMs?: number;
  // P5 settlement bridge — injectable, no live chain call. When present, RELEASED creates durable Operation.
  operationStore?: OperationStore;
  executionAdapters?: Map<SettlementChain, PauseExecutionAdapter>;
  metrics?: PauseMetrics;
  /** Explicit Product/System authority policy. Omitted means approve/release fail closed. */
  authorityResolver?: PauseAuthorityResolver;
  now?: () => number;
}

let decisionSeq = 0;
function nextDecisionId(): string { decisionSeq +=1; return `dec_${Date.now()}_${decisionSeq}`; }

const AUTHORITY_ACTORS: ReadonlySet<string> = new Set<PauseAuthorityActor>(["user", "controller", "authorized_agent", "operator"]);
const NON_REUSABLE_OPERATION_STATES: ReadonlySet<string> = new Set<string>([
  ...TERMINAL_STATES,
  ...TERMINAL_FAILURE_STATES,
]);

export class PauseService {
  constructor(private readonly store: PauseStore, private readonly opts: PauseServiceOptions = { store: undefined as unknown as PauseStore }) {
    if (!opts.store) this.opts = { store, defaultPauseTtlMs: 10*60*1000 }; else this.opts = opts;
    // Ensure defaults for settlement fields
    if (!this.opts.now) this.opts.now = () => Date.now();
  }

  private settlementFingerprint(pause: ExecutionPause): string {
    return `${pause.planHash}:${pause.policyVersion}:${pause.pauseId}`;
  }

  private assertSettlementOperationReusable(operation: PersistedOperation): void {
    if (NON_REUSABLE_OPERATION_STATES.has(operation.state)) {
      throw new PauseError(PAUSE_ERROR_CODE.OPERATION_NOT_REUSABLE, `settlement_operation_terminal:${operation.state}`);
    }
  }

  private async resolveAuthority(input: {
    action: PauseAuthorityAction;
    subject?: string | null;
    claimedActor?: string | null;
    pause: ExecutionPause;
    intent: ExecutionIntent;
    plan: ExecutionPlan;
  }): Promise<PauseAuthorityDecision & { actor: PauseAuthorityActor }> {
    const resolver = this.opts.authorityResolver;
    if (!resolver) {
      throw new PauseError(PAUSE_ERROR_CODE.AUTHORITY_UNCONFIGURED, "pause_authority_policy_not_configured");
    }

    let decision: PauseAuthorityDecision;
    try {
      const request = {
        action: input.action,
        subject: input.subject ?? null,
        claimedActor: input.claimedActor ?? null,
        pause: input.pause,
        intent: input.intent,
        plan: input.plan,
      };
      decision = await (typeof resolver === "function" ? resolver(request) : resolver.resolve(request));
    } catch (cause) {
      if (cause instanceof PauseError) throw cause;
      throw new PauseError(PAUSE_ERROR_CODE.AUTHORITY_UNAVAILABLE, "pause_authority_resolution_failed");
    }
    if (!decision || decision.authorized !== true) {
      throw new PauseError(PAUSE_ERROR_CODE.AUTHORITY_DENIED, "pause_authority_denied");
    }
    if (!decision.actor || !AUTHORITY_ACTORS.has(decision.actor)) {
      throw new PauseError(PAUSE_ERROR_CODE.AUTHORITY_UNAVAILABLE, "pause_authority_result_invalid");
    }
    return { ...decision, actor: decision.actor };
  }

  private async prepareSettlementOperation(input: {
    pause: ExecutionPause;
    plan: ExecutionPlan;
    operationId: string;
    now: number;
    correlationId: string | null;
  }): Promise<{ operation: PersistedOperation; created: boolean }> {
    const operationStore = this.opts.operationStore;
    if (!operationStore) throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, "operation_store_required");
    const idempotencyKey = `pause_settlement:${input.pause.pauseId}:${input.pause.planHash}`;
    const requestFingerprint = this.settlementFingerprint(input.pause);
    const byId = await operationStore.getById(input.operationId);
    if (byId) {
      if (byId.idempotencyKey !== idempotencyKey || byId.requestFingerprint !== requestFingerprint) {
        throw new PauseError(PAUSE_ERROR_CODE.IDEMPOTENCY_CONFLICT, `settlement_operation_id_conflict:${input.operationId}`);
      }
      this.assertSettlementOperationReusable(byId);
      return { operation: byId, created: false };
    }
    const byKey = await operationStore.getByIdempotencyKey(idempotencyKey);
    if (byKey) {
      if (byKey.id !== input.operationId) {
        throw new PauseError(PAUSE_ERROR_CODE.OPERATION_ALREADY_LINKED, `settlement idempotency maps to ${byKey.id} not ${input.operationId}`);
      }
      if (byKey.requestFingerprint !== requestFingerprint) {
        throw new PauseError(PAUSE_ERROR_CODE.IDEMPOTENCY_CONFLICT, `settlement idempotency fingerprint mismatch for ${input.operationId}`);
      }
      this.assertSettlementOperationReusable(byKey);
      return { operation: byKey, created: false };
    }
    const operation = await operationStore.create({
      id: input.operationId,
      kind: `pause_settlement:${resolveChainFromPlan(input.plan)}`,
      idempotencyKey,
      requestFingerprint,
      now: input.now,
      correlationId: input.correlationId,
    });
    this.assertSettlementOperationReusable(operation);
    try { this.opts.metrics?.increment("settlement_operation_created", { chain: resolveChainFromPlan(input.plan) }); } catch {}
    return { operation, created: true };
  }

  private async abandonPreparedSettlementOperation(input: {
    prepared: { operation: PersistedOperation; created: boolean };
    pauseId: string;
    operationId: string;
    now: number;
  }): Promise<void> {
    if (!input.prepared.created || !this.opts.operationStore) return;
    try {
      const currentPause = await this.store.getPause(input.pauseId);
      if (currentPause?.state === "RELEASED" && currentPause.settlementOperationId === input.operationId) return;
      const currentOperation = await this.opts.operationStore.getById(input.operationId);
      if (currentOperation && ["created", "awaiting_authorization", "ready"].includes(currentOperation.state)) {
        await this.opts.operationStore.transition(input.operationId, {
          to: "cancelled",
          now: input.now,
          expectedVersion: currentOperation.version,
          errorDetail: "pause_release_cas_failed_before_link",
        });
      }
    } catch {
      // Cleanup is best-effort; never turn a failed CAS into an unverified release.
    }
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
    assertRecipientMatches(intent.requestedRecipient, plan.recipient);
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

  async verify(input: { pauseId: string; policy: Policy; sources?: VerificationSources; now?: number }): Promise<ExecutionPause> {
    const now = input.now ?? (this.opts.now ? this.opts.now() : Date.now());
    const pause = await this.store.getPause(input.pauseId);
    if (!pause) throw new PauseError(PAUSE_ERROR_CODE.PAUSE_NOT_FOUND, input.pauseId);
    const plan = await this.store.getPlan(pause.planHash);
    if (!plan) throw new PauseError(PAUSE_ERROR_CODE.INVALID_PLAN, pause.planHash);
    const intent = await this.store.getIntent(pause.intentId);
    if (!intent) throw new PauseError(PAUSE_ERROR_CODE.INTENT_NOT_FOUND, pause.intentId);
    // Validate the injected boundary before changing PAUSED → VERIFYING. A
    // malformed source is not an UNKNOWN observation and must not leave a
    // partially-mutated verification behind.
    const sources = normalizeVerificationSources(input.sources);
    if (now >= pause.expiresAt) {
      // auto-expire path
      const expired = domainExpire(pause, now, pause.version);
      const next = await this.store.updatePause(expired, pause.version);
      await this.store.appendDecision({ decisionId: nextDecisionId(), pauseId: pause.pauseId, kind: "EXPIRE", actor: "system", policyVersion: pause.policyVersion, planHash: pause.planHash, approvalScopeHash: null, reasonCodes: ["PAUSE_EXPIRED"], createdAt: now });
      return next;
    }
    if (
      pause.policyVersion !== input.policy.policyVersion ||
      plan.policyVersion !== input.policy.policyVersion ||
      intent.policyVersion !== input.policy.policyVersion
    ) {
      throw new PauseError(
        PAUSE_ERROR_CODE.POLICY_VERSION_MISMATCH,
        `bound policy versions differ:pause=${pause.policyVersion}:plan=${plan.policyVersion}:intent=${intent.policyVersion}:policy=${input.policy.policyVersion}`,
      );
    }
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
    const checks = evaluatePolicy({ intent, plan, pause: current, policy: input.policy, sources, now });
    const completed = completeVerification(current, { checks, now, expectedVersion: current.version });
    await this.store.putChecks(pause.pauseId, checks);
    const next = await this.store.updatePause(completed, current.version);
    try { this.opts.metrics?.increment(completed.state === "RELEASE_READY" ? "pause_verified" : "pause_verify_blocked_unknown", { state: completed.state, risk: completed.riskLevel }); } catch {}
    if (completed.state === "ESCALATED") {
      await this.store.appendDecision({ decisionId: nextDecisionId(), pauseId: pause.pauseId, kind: "ESCALATE", actor: "policy_engine", policyVersion: pause.policyVersion, planHash: pause.planHash, approvalScopeHash: completed.approvalScopeHash, reasonCodes: [...completed.reasonCodes], createdAt: now });
    }
    return next;
  }

  async release(input: { pauseId: string; planHash: Hex; approvalScopeHash?: Hex | null; settlementOperationId: string; now?: number; expectedVersion?: number; correlationId?: string | null; authoritySubject?: string | null; authorityClaim?: string | null }): Promise<ExecutionPause> {
    const now = input.now ?? (this.opts.now ? this.opts.now() : Date.now());
    const pause = await this.store.getPause(input.pauseId);
    if (!pause) throw new PauseError(PAUSE_ERROR_CODE.PAUSE_NOT_FOUND, input.pauseId);
    const expectedVersion = input.expectedVersion ?? pause.version;
    const next = domainRelease(pause, { planHash: input.planHash, approvalScopeHash: input.approvalScopeHash ?? null, settlementOperationId: input.settlementOperationId, now, expectedVersion });
    const plan = await this.store.getPlan(next.planHash);
    if (!plan) throw new PauseError(PAUSE_ERROR_CODE.INVALID_PLAN, next.planHash);
    const intent = await this.store.getIntent(pause.intentId);
    if (!intent) throw new PauseError(PAUSE_ERROR_CODE.INTENT_NOT_FOUND, pause.intentId);
    const authority = await this.resolveAuthority({ action: "release", subject: input.authoritySubject, claimedActor: input.authorityClaim, pause, intent, plan });

    // The operation row is the durable settlement boundary. Preflight and
    // persist it before the pause CAS so a store outage cannot leave RELEASED
    // pointing at an operation that does not exist.
    let prepared: { operation: PersistedOperation; created: boolean } | undefined;
    if (this.opts.operationStore) {
      prepared = await this.prepareSettlementOperation({
        pause,
        plan,
        operationId: input.settlementOperationId,
        now,
        correlationId: input.correlationId ?? null,
      });
    }

    let persisted: ExecutionPause;
    try {
      persisted = await this.store.updatePause(next, expectedVersion);
    } catch (cause) {
      if (prepared) {
        await this.abandonPreparedSettlementOperation({
          prepared,
          pauseId: pause.pauseId,
          operationId: input.settlementOperationId,
          now,
        });
      }
      throw cause;
    }

    await this.store.appendDecision({ decisionId: nextDecisionId(), pauseId: pause.pauseId, kind: "RELEASE", actor: authority.actor, policyVersion: pause.policyVersion, planHash: pause.planHash, approvalScopeHash: computeApprovalScopeHash(pause.pauseId, pause.planHash, pause.policyVersion), reasonCodes: [...persisted.reasonCodes], createdAt: now });
    try { this.opts.metrics?.increment("pause_released", { state: persisted.state }); } catch {}

    // Submit via injected adapter if available and op not yet terminal/completed.
    // Never mark completed here; reconciliation owns that transition.
    if (prepared && plan && this.opts.executionAdapters) {
      const chain = resolveChainFromPlan(plan);
      const adapter = this.opts.executionAdapters.get(chain);
      if (adapter) {
        let op = prepared.operation;
        if (!["submitted", "processing", "confirming", "confirmed", "indexed", "reconciled", "completed"].includes(op.state)) {
          if (op.state === "created") {
            op = await this.opts.operationStore!.transition(op.id, { to: "awaiting_authorization", now, expectedVersion: op.version });
            op = await this.opts.operationStore!.transition(op.id, { to: "ready", now, expectedVersion: op.version });
          } else if (op.state === "awaiting_authorization") {
            op = await this.opts.operationStore!.transition(op.id, { to: "ready", now, expectedVersion: op.version });
          }
          if (op.state === "ready") {
            try {
              const submitted = await adapter.submit({ operation: op, pause: persisted, plan, correlationId: input.correlationId ?? null, operationId: input.settlementOperationId });
              if (submitted.id !== op.id || submitted.id !== input.settlementOperationId) throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, "adapter_operation_id_mismatch");
              if (submitted.state === "completed") throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, "adapter_must_not_mark_completed");
              if (!["submitted", "processing", "confirming", "confirmed", "indexed", "reconciled"].includes(submitted.state)) {
                throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, `adapter_submit_returned_invalid_state:${submitted.state}`);
              }
              try { this.opts.metrics?.increment("settlement_operation_submitted", { chain }); } catch {}
            } catch (e) {
              if (e instanceof PauseError) throw e;
              // Adapter failure is retryable; the operation remains durable and
              // the pause remains RELEASED without claiming settlement success.
              try { this.opts.metrics?.increment("pause_release_blocked", { reason: "adapter_submit_failed" }); } catch {}
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

  async approve(input: { pauseId: string; planHash: Hex; approvalScopeHash?: Hex | null; now?: number; expectedVersion?: number; authoritySubject?: string | null; authorityClaim?: string | null }): Promise<ExecutionPause> {
    const now = input.now ?? (this.opts.now ? this.opts.now() : Date.now());
    const pause = await this.store.getPause(input.pauseId);
    if (!pause) throw new PauseError(PAUSE_ERROR_CODE.PAUSE_NOT_FOUND, input.pauseId);
    const expectedVersion = input.expectedVersion ?? pause.version;
    const next = approveEscalation(pause, { planHash: input.planHash, approvalScopeHash: input.approvalScopeHash ?? null, now, expectedVersion });
    const plan = await this.store.getPlan(pause.planHash);
    if (!plan) throw new PauseError(PAUSE_ERROR_CODE.INVALID_PLAN, pause.planHash);
    const intent = await this.store.getIntent(pause.intentId);
    if (!intent) throw new PauseError(PAUSE_ERROR_CODE.INTENT_NOT_FOUND, pause.intentId);
    const authority = await this.resolveAuthority({ action: "approve", subject: input.authoritySubject, claimedActor: input.authorityClaim, pause, intent, plan });
    const persisted = await this.store.updatePause(next, expectedVersion);
    await this.store.appendDecision({ decisionId: nextDecisionId(), pauseId: pause.pauseId, kind: "APPROVE", actor: authority.actor, policyVersion: pause.policyVersion, planHash: pause.planHash, approvalScopeHash: persisted.approvalScopeHash, reasonCodes: [...persisted.reasonCodes], createdAt: now });
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
      } catch (e) {
        // Concurrent sweepers may legitimately lose the CAS or observe a
        // terminal transition. Operational/store failures must propagate so a
        // caller cannot mistake an incomplete sweep for a successful one.
        if (
          e instanceof PauseError &&
          ([PAUSE_ERROR_CODE.STALE_VERSION, PAUSE_ERROR_CODE.ILLEGAL_TRANSITION, PAUSE_ERROR_CODE.PAUSE_EXPIRED, PAUSE_ERROR_CODE.PAUSE_NOT_FOUND] as readonly string[]).includes(e.code)
        ) {
          continue;
        }
        throw e;
      }
    }
    try { this.opts.metrics?.increment("pause_sweep", { count: String(results.length) }); } catch {}
    return results;
  }

  async getPause(pauseId: string): Promise<ExecutionPause | undefined> { return this.store.getPause(pauseId); }
  async getIntent(intentId: string): Promise<ExecutionIntent | undefined> { return this.store.getIntent(intentId); }
}
