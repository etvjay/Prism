// Durable Pause port — PostgreSQL-oriented with in-memory test adapter.
// Tables: execution_intents, execution_plans, execution_pauses, pause_checks, pause_decisions, approval_records
// Invariants enforced at store layer + domain layer:
// - unique active pause per (intentId, intentVersion) while not terminal
// - plan_hash immutable binding per pause
// - idempotency on clientIdempotencyKey
// - version CAS on every mutation
// - append-only decision history

import type { ExecutionIntent } from "../domain/intent";
import type { ExecutionPlan, Hex } from "../domain/execution-plan";
import type { ExecutionPause, PauseState } from "../domain/pause";
import type { CheckResult } from "../domain/checks";

export interface PauseDecision {
  readonly decisionId: string;
  readonly pauseId: string;
  readonly kind: "RELEASE" | "CANCEL" | "ESCALATE" | "EXPIRE" | "REVERIFY" | "APPROVE";
  readonly actor: string; // policy_engine | user | controller | authorized_agent | operator
  readonly policyVersion: string;
  readonly planHash: Hex;
  readonly approvalScopeHash: Hex | null;
  readonly reasonCodes: readonly string[];
  readonly createdAt: number;
  readonly expiresAt?: number | null;
}

/**
 * Write surface exposed while a PauseStore transaction is open.
 *
 * PauseService must use this boundary for every state transition that emits
 * an audit decision. Implementations must commit all calls or roll them back
 * together; callers must not mix these methods with the parent store.
 */
export interface PauseStoreTransaction {
  updatePause(pause: ExecutionPause, expectedVersion: number): Promise<ExecutionPause>;
  putChecks(pauseId: string, checks: readonly CheckResult[]): Promise<void>;
  appendDecision(decision: PauseDecision): Promise<PauseDecision>;
}

export interface CreatePauseRecordInput {
  intent: ExecutionIntent;
  plan: ExecutionPlan;
  pause: ExecutionPause;
}

export interface PauseStore {
  // Intent persistence (idempotency + expiry oriented)
  putIntent(intent: ExecutionIntent): Promise<ExecutionIntent>;
  getIntent(intentId: string): Promise<ExecutionIntent | undefined>;
  getIntentByIdempotencyKey(clientIdempotencyKey: string): Promise<ExecutionIntent | undefined>;

  // Plan persistence (plan_hash deterministic; stored per intent)
  putPlan(plan: ExecutionPlan): Promise<ExecutionPlan>;
  getPlan(planHash: Hex): Promise<ExecutionPlan | undefined>;
  getPlanByIntent(intentId: string): Promise<ExecutionPlan | undefined>;

  // Pause persistence — CAS versioned
  createPause(input: CreatePauseRecordInput): Promise<ExecutionPause>;
  getPause(pauseId: string): Promise<ExecutionPause | undefined>;
  getPauseByIntent(intentId: string): Promise<ExecutionPause | undefined>;
  /** Transition with expectedVersion CAS; throws PAUSE_ERROR_CODE.STALE_VERSION on mismatch. */
  updatePause(pause: ExecutionPause, expectedVersion: number): Promise<ExecutionPause>;
  listPausesByState(state: PauseState, limit?: number): Promise<readonly ExecutionPause[]>;
  listExpired(now: number, limit?: number): Promise<readonly ExecutionPause[]>;

  // Checks (append + read)
  putChecks(pauseId: string, checks: readonly CheckResult[]): Promise<void>;
  getChecks(pauseId: string): Promise<readonly CheckResult[]>;

  // Decisions (append-only)
  appendDecision(decision: PauseDecision): Promise<PauseDecision>;
  getDecisions(pauseId: string): Promise<readonly PauseDecision[]>;

  /**
   * Execute related pause writes atomically. Stores that cannot provide this
   * guarantee must omit the capability; PauseService then fails closed before
   * mutating state rather than falling back to update-then-append.
   */
  withTransaction?<T>(callback: (transaction: PauseStoreTransaction) => Promise<T>): Promise<T>;

  // Lifecycle
  close?(): Promise<void>;
  migrate?(): Promise<void>;
}
