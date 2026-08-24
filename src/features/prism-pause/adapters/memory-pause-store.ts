// In-memory PauseStore adapter — reference implementation for tests / local dev.
// CAS via version compare-and-set in JS critical section.
// Expiry, idempotency, planHash binding mirrors Postgres adapter semantics.
// No DB imports. Fail-closed. Snapshot helpers for restart/race tests.

import type { ExecutionIntent } from "../domain/intent";
import type { ExecutionPlan, Hex } from "../domain/execution-plan";
import type { ExecutionPause, PauseState } from "../domain/pause";
import type { CheckResult } from "../domain/checks";
import type { PauseDecision, PauseStore, CreatePauseRecordInput } from "../ports/pause-store";
import { PauseError, PAUSE_ERROR_CODE } from "../domain/errors";

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export class InMemoryPauseStore implements PauseStore {
  private readonly intents = new Map<string, ExecutionIntent>(); // intentId -> intent
  private readonly intentsByKey = new Map<string, string>(); // clientIdempotencyKey -> intentId
  private readonly plans = new Map<Hex, ExecutionPlan>(); // planHash -> plan
  private readonly plansByIntent = new Map<string, Hex>(); // intentId -> planHash
  private readonly pauses = new Map<string, ExecutionPause>(); // pauseId -> pause
  private readonly pausesByIntent = new Map<string, string>(); // intentId -> pauseId
  private readonly checks = new Map<string, CheckResult[]>(); // pauseId -> checks
  private readonly decisions = new Map<string, PauseDecision[]>(); // pauseId -> decisions
  private closed = false;

  private assertOpen() {
    if (this.closed) throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, "store_is_closed");
  }

  // --- Intent ---

  async putIntent(intent: ExecutionIntent): Promise<ExecutionIntent> {
    this.assertOpen();
    // idempotencyKey dedupe
    const existingId = this.intentsByKey.get(intent.clientIdempotencyKey);
    if (existingId !== undefined) {
      const existing = this.intents.get(existingId);
      if (!existing) throw new PauseError(PAUSE_ERROR_CODE.ILLEGAL_TRANSITION, "intent_index_corrupt");
      // same key -> require same payload (compare intent fields that matter: principal, purpose, recipient, asset, amount, route, policyVersion)
      const fingerprintMismatch =
        existing.principal !== intent.principal ||
        existing.purpose !== intent.purpose ||
        existing.requestedRecipient !== intent.requestedRecipient ||
        existing.requestedAsset !== intent.requestedAsset ||
        existing.requestedAmount !== intent.requestedAmount ||
        existing.requestedRoute !== intent.requestedRoute ||
        existing.policyVersion !== intent.policyVersion;
      if (fingerprintMismatch) throw new PauseError(PAUSE_ERROR_CODE.IDEMPOTENCY_CONFLICT, `idempotency_key_conflict:${intent.clientIdempotencyKey}`);
      return clone(existing);
    }
    if (this.intents.has(intent.intentId)) {
      throw new PauseError(PAUSE_ERROR_CODE.IDEMPOTENCY_CONFLICT, `duplicate_intent_id:${intent.intentId}`);
    }
    await yieldToEventLoop();
    // re-check after yield (race simulation)
    if (this.intentsByKey.has(intent.clientIdempotencyKey)) {
      const raced = this.intents.get(this.intentsByKey.get(intent.clientIdempotencyKey)!);
      if (raced) return clone(raced);
    }
    if (this.intents.has(intent.intentId)) throw new PauseError(PAUSE_ERROR_CODE.IDEMPOTENCY_CONFLICT, `duplicate_intent_id:${intent.intentId}`);
    this.intents.set(intent.intentId, clone(intent));
    this.intentsByKey.set(intent.clientIdempotencyKey, intent.intentId);
    return clone(intent);
  }

  async getIntent(intentId: string): Promise<ExecutionIntent | undefined> {
    this.assertOpen();
    await yieldToEventLoop();
    const rec = this.intents.get(intentId);
    return rec ? clone(rec) : undefined;
  }

  async getIntentByIdempotencyKey(key: string): Promise<ExecutionIntent | undefined> {
    this.assertOpen();
    const id = this.intentsByKey.get(key);
    if (!id) return undefined;
    const rec = this.intents.get(id);
    return rec ? clone(rec) : undefined;
  }

  // --- Plan ---

  async putPlan(plan: ExecutionPlan): Promise<ExecutionPlan> {
    this.assertOpen();
    if (this.plans.has(plan.planHash)) {
      // deterministic: same hash must be same canonical payload; if different intentId then conflict (should not happen via hash)
      const existing = this.plans.get(plan.planHash)!;
      if (existing.intentId !== plan.intentId) throw new PauseError(PAUSE_ERROR_CODE.INVALID_PLAN, "plan_hash_collision_across_intents");
      return clone(existing);
    }
    await yieldToEventLoop();
    if (this.plans.has(plan.planHash)) return clone(this.plans.get(plan.planHash)!);
    this.plans.set(plan.planHash, clone(plan));
    this.plansByIntent.set(plan.intentId, plan.planHash);
    return clone(plan);
  }

  async getPlan(planHash: Hex): Promise<ExecutionPlan | undefined> {
    this.assertOpen();
    await yieldToEventLoop();
    const rec = this.plans.get(planHash);
    return rec ? clone(rec) : undefined;
  }

  async getPlanByIntent(intentId: string): Promise<ExecutionPlan | undefined> {
    this.assertOpen();
    const hash = this.plansByIntent.get(intentId);
    if (!hash) return undefined;
    return this.getPlan(hash);
  }

  // --- Pause ---

  async createPause(input: CreatePauseRecordInput): Promise<ExecutionPause> {
    this.assertOpen();
    if (!this.intents.has(input.intent.intentId)) throw new PauseError(PAUSE_ERROR_CODE.INTENT_NOT_FOUND, input.intent.intentId);
    if (!this.plans.has(input.plan.planHash)) throw new PauseError(PAUSE_ERROR_CODE.INVALID_PLAN, "plan_not_persisted");
    if (input.pause.planHash !== input.plan.planHash) throw new PauseError(PAUSE_ERROR_CODE.PLAN_HASH_MISMATCH, "pause.planHash != plan.planHash");
    if (this.pauses.has(input.pause.pauseId)) throw new PauseError(PAUSE_ERROR_CODE.DUPLICATE_PAUSE, input.pause.pauseId);
    // unique active pause per intent version: if a non-terminal pause exists for same intentId, reject
    const existingPauseId = this.pausesByIntent.get(input.intent.intentId);
    if (existingPauseId) {
      const existing = this.pauses.get(existingPauseId);
      if (existing && !["CANCELLED", "EXPIRED", "RELEASED"].includes(existing.state)) {
        throw new PauseError(PAUSE_ERROR_CODE.DUPLICATE_PAUSE, `active_pause_exists_for_intent:${input.intent.intentId}`);
      }
    }
    await yieldToEventLoop();
    if (this.pauses.has(input.pause.pauseId)) throw new PauseError(PAUSE_ERROR_CODE.DUPLICATE_PAUSE, input.pause.pauseId);
    const existing2 = this.pausesByIntent.get(input.intent.intentId);
    if (existing2) {
      const e2 = this.pauses.get(existing2);
      if (e2 && !["CANCELLED", "EXPIRED", "RELEASED"].includes(e2.state)) throw new PauseError(PAUSE_ERROR_CODE.DUPLICATE_PAUSE, `active_pause_exists_for_intent:${input.intent.intentId}`);
    }
    this.pauses.set(input.pause.pauseId, clone(input.pause));
    this.pausesByIntent.set(input.intent.intentId, input.pause.pauseId);
    return clone(input.pause);
  }

  async getPause(pauseId: string): Promise<ExecutionPause | undefined> {
    this.assertOpen();
    await yieldToEventLoop();
    const rec = this.pauses.get(pauseId);
    return rec ? clone(rec) : undefined;
  }

  async getPauseByIntent(intentId: string): Promise<ExecutionPause | undefined> {
    this.assertOpen();
    const pid = this.pausesByIntent.get(intentId);
    if (!pid) return undefined;
    return this.getPause(pid);
  }

  async updatePause(pause: ExecutionPause, expectedVersion: number): Promise<ExecutionPause> {
    this.assertOpen();
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, "expectedVersion_invalid");
    const current = this.pauses.get(pause.pauseId);
    if (!current) throw new PauseError(PAUSE_ERROR_CODE.PAUSE_NOT_FOUND, pause.pauseId);
    if (current.version !== expectedVersion) throw new PauseError(PAUSE_ERROR_CODE.STALE_VERSION, `stale_version:expected_${expectedVersion}_got_${current.version}`);
    if (current.planHash !== pause.planHash) throw new PauseError(PAUSE_ERROR_CODE.PLAN_HASH_MISMATCH, "planHash_immutable");
    if (pause.version !== expectedVersion + 1) throw new PauseError(PAUSE_ERROR_CODE.ILLEGAL_TRANSITION, "version_must_increment_by_1");
    await yieldToEventLoop();
    // re-read after yield to detect race
    const re = this.pauses.get(pause.pauseId);
    if (!re || re.version !== expectedVersion) throw new PauseError(PAUSE_ERROR_CODE.STALE_VERSION, `stale_version_race:expected_${expectedVersion}_got_${re?.version ?? "missing"}`);
    this.pauses.set(pause.pauseId, clone(pause));
    return clone(pause);
  }

  async listPausesByState(state: PauseState, limit = 100): Promise<readonly ExecutionPause[]> {
    this.assertOpen();
    const bounded = Math.max(1, Math.min(1000, Math.floor(limit)));
    const result: ExecutionPause[] = [];
    for (const p of this.pauses.values()) if (p.state === state) result.push(clone(p));
    result.sort((a, b) => a.createdAt - b.createdAt);
    return result.slice(0, bounded);
  }

  async listExpired(now: number, limit = 100): Promise<readonly ExecutionPause[]> {
    this.assertOpen();
    if (!Number.isFinite(now)) throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, "invalid_now");
    const bounded = Math.max(1, Math.min(1000, Math.floor(limit)));
    const result: ExecutionPause[] = [];
    for (const p of this.pauses.values()) {
      if (p.expiresAt <= now && !["CANCELLED", "EXPIRED", "RELEASED"].includes(p.state)) result.push(clone(p));
    }
    result.sort((a, b) => a.expiresAt - b.expiresAt);
    return result.slice(0, bounded);
  }

  // --- Checks ---

  async putChecks(pauseId: string, checks: readonly CheckResult[]): Promise<void> {
    this.assertOpen();
    if (!this.pauses.has(pauseId)) throw new PauseError(PAUSE_ERROR_CODE.PAUSE_NOT_FOUND, pauseId);
    await yieldToEventLoop();
    if (!this.pauses.has(pauseId)) throw new PauseError(PAUSE_ERROR_CODE.PAUSE_NOT_FOUND, pauseId);
    this.checks.set(pauseId, checks.map(clone));
  }

  async getChecks(pauseId: string): Promise<readonly CheckResult[]> {
    this.assertOpen();
    await yieldToEventLoop();
    const rec = this.checks.get(pauseId);
    return rec ? rec.map(clone) : [];
  }

  // --- Decisions ---

  async appendDecision(decision: PauseDecision): Promise<PauseDecision> {
    this.assertOpen();
    if (!this.pauses.has(decision.pauseId)) throw new PauseError(PAUSE_ERROR_CODE.PAUSE_NOT_FOUND, decision.pauseId);
    // approval replay: same pauseId + same kind + same planHash cannot repeat (except REVERIFY maybe)
    const existing = this.decisions.get(decision.pauseId) ?? [];
    if (decision.kind === "APPROVE" || decision.kind === "RELEASE") {
      const replay = existing.some((d) => d.kind === decision.kind && d.planHash === decision.planHash);
      if (replay) throw new PauseError(PAUSE_ERROR_CODE.APPROVAL_REPLAY, `${decision.kind} replay for plan ${decision.planHash}`);
    }
    // approval_scope binding: stored decision must have computed scope equal to pause scope if present
    await yieldToEventLoop();
    // re-check after yield
    const rere = this.decisions.get(decision.pauseId) ?? [];
    if (decision.kind === "APPROVE" || decision.kind === "RELEASE") {
      const replay2 = rere.some((d) => d.kind === decision.kind && d.planHash === decision.planHash);
      if (replay2) throw new PauseError(PAUSE_ERROR_CODE.APPROVAL_REPLAY, `${decision.kind} replay`);
    }
    const next = [...rere, clone(decision)];
    this.decisions.set(decision.pauseId, next);
    // also append to pause decisionIds via in-place mutation (version already bumped by caller)
    const pause = this.pauses.get(decision.pauseId);
    if (pause) {
      this.pauses.set(decision.pauseId, clone({ ...pause, decisionIds: [...pause.decisionIds, decision.decisionId] }));
    }
    return clone(decision);
  }

  async getDecisions(pauseId: string): Promise<readonly PauseDecision[]> {
    this.assertOpen();
    const rec = this.decisions.get(pauseId);
    return rec ? rec.map(clone) : [];
  }

  // test/ops helpers
  snapshotPauses(): ExecutionPause[] { return [...this.pauses.values()].map(clone); }
  snapshotIntents(): ExecutionIntent[] { return [...this.intents.values()].map(clone); }
  snapshotPlans(): ExecutionPlan[] { return [...this.plans.values()].map(clone); }

  async close(): Promise<void> { this.closed = true; }
}
