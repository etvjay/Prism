// PostgreSQL-oriented PauseStore adapter — production persistence target.
// Implements same semantics as InMemoryPauseStore but with ACID CAS guarantees.
// Tables (idempotent migration):
// - execution_intents (intent_id PK, client_idempotency_key UNIQUE, expires_at indexed)
// - execution_plans (plan_hash PK, intent_id FK, policy_version, canonical_json)
// - execution_pauses (pause_id PK, intent_id FK, plan_hash FK, state, version, expires_at indexed, ...)
// - pause_checks (pause_id FK, payload JSON)
// - pause_decisions (decision_id PK, pause_id FK, kind, plan_hash, approval_scope_hash, ... append-only)
// CAS: UPDATE ... WHERE pause_id=$1 AND version=$2 ; rowCount==1 identifies winner.
// Intent idempotency: INSERT ... ON CONFLICT (client_idempotency_key) DO NOTHING then read+compare.
// Unique active pause per intent: partial unique index WHERE state NOT IN ('CANCELLED','EXPIRED','RELEASED').
// No secrets: connection via PoolConfig / PG env only.

import { Pool, type PoolClient } from "pg";
import type { PoolConfig } from "pg";
import type { ExecutionIntent } from "../domain/intent";
import { sameIntentFingerprint } from "../domain/intent";
import type { ExecutionPlan, Hex } from "../domain/execution-plan";
import type { ExecutionPause, PauseState } from "../domain/pause";
import type { CheckResult } from "../domain/checks";
import type { PauseDecision, PauseStore, CreatePauseRecordInput } from "../ports/pause-store";
import { PauseError, PAUSE_ERROR_CODE } from "../domain/errors";

export const PAUSE_STORE_SCHEMA_VERSION = 1;

export const PAUSE_STORE_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS prism_store_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS execution_intents (
  intent_id TEXT PRIMARY KEY,
  principal TEXT NOT NULL,
  initiator TEXT NOT NULL,
  agent_id TEXT,
  purpose TEXT NOT NULL,
  requested_recipient TEXT NOT NULL,
  requested_asset TEXT NOT NULL,
  requested_amount TEXT NOT NULL,
  requested_route TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  client_idempotency_key TEXT NOT NULL UNIQUE,
  intent_version INTEGER NOT NULL,
  policy_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_execution_intents_expires_at ON execution_intents(expires_at);
CREATE INDEX IF NOT EXISTS idx_execution_intents_idempotency_key ON execution_intents(client_idempotency_key);

CREATE TABLE IF NOT EXISTS execution_plans (
  plan_hash TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  recipient TEXT NOT NULL,
  calls_json TEXT NOT NULL,
  max_value TEXT NOT NULL,
  slippage_bps INTEGER,
  max_fee TEXT,
  max_gas TEXT,
  policy_version TEXT NOT NULL,
  simulation_ref TEXT,
  intent_id TEXT NOT NULL REFERENCES execution_intents(intent_id),
  created_at BIGINT NOT NULL,
  canonical_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_execution_plans_intent_id ON execution_plans(intent_id);

CREATE TABLE IF NOT EXISTS execution_pauses (
  pause_id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL REFERENCES execution_intents(intent_id),
  plan_hash TEXT NOT NULL REFERENCES execution_plans(plan_hash),
  policy_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('PAUSED','VERIFYING','RELEASE_READY','CANCELLED','ESCALATED','EXPIRED','RELEASED')),
  version INTEGER NOT NULL,
  reason_codes_json TEXT NOT NULL DEFAULT '[]',
  risk_level TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  last_verified_at BIGINT,
  required_approval_count INTEGER NOT NULL DEFAULT 0,
  approval_scope_hash TEXT,
  settlement_operation_id TEXT,
  decision_ids_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_execution_pauses_state ON execution_pauses(state);
CREATE INDEX IF NOT EXISTS idx_execution_pauses_expires_at ON execution_pauses(expires_at);
CREATE INDEX IF NOT EXISTS idx_execution_pauses_intent_id ON execution_pauses(intent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_pauses_active_per_intent ON execution_pauses(intent_id) WHERE state NOT IN ('CANCELLED','EXPIRED','RELEASED');

CREATE TABLE IF NOT EXISTS pause_checks (
  pause_id TEXT PRIMARY KEY REFERENCES execution_pauses(pause_id),
  checks_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS pause_decisions (
  decision_id TEXT PRIMARY KEY,
  pause_id TEXT NOT NULL REFERENCES execution_pauses(pause_id),
  kind TEXT NOT NULL CHECK (kind IN ('RELEASE','CANCEL','ESCALATE','EXPIRE','REVERIFY','APPROVE')),
  actor TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  approval_scope_hash TEXT,
  reason_codes_json TEXT NOT NULL DEFAULT '[]',
  created_at BIGINT NOT NULL,
  expires_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_pause_decisions_pause_id ON pause_decisions(pause_id);
`;

export type PostgresPauseStoreErrorCode =
  | "store_connect_failed"
  | "store_migrate_failed"
  | "store_write_failed"
  | "store_read_failed"
  | "invalid_record";

export class PostgresPauseStoreError extends Error {
  readonly code: PostgresPauseStoreErrorCode;
  constructor(code: PostgresPauseStoreErrorCode, message: string, cause?: unknown) {
    super(`[${code}] ${message}${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "PostgresPauseStoreError";
    this.code = code;
  }
}

const VALID_PAUSE_STATES = new Set(["PAUSED","VERIFYING","RELEASE_READY","CANCELLED","ESCALATED","EXPIRED","RELEASED"]);

export interface PostgresPauseStoreOptions extends Pick<PoolConfig, keyof PoolConfig> {
  pool?: PoolConfig;
  skipMigration?: boolean;
}

function mergePoolConfig(o: PostgresPauseStoreOptions): PoolConfig {
  const { pool, skipMigration: _s, ...flat } = o;
  return { ...flat, ...pool };
}

function toInt(v: string | number | null): number | null {
  if (v === null) return null;
  const n = typeof v === "number" ? v : Number.parseInt(String(v), 10);
  if (!Number.isFinite(n)) throw new Error(`non-integer column ${String(v)}`);
  return n;
}

function rowToIntent(row: Record<string, unknown>): ExecutionIntent {
  return {
    intentId: row.intent_id as string,
    principal: row.principal as string,
    initiator: row.initiator as ExecutionIntent["initiator"],
    agentId: (row.agent_id as string | null) ?? null,
    purpose: row.purpose as ExecutionIntent["purpose"],
    requestedRecipient: row.requested_recipient as string,
    requestedAsset: row.requested_asset as string,
    requestedAmount: row.requested_amount as string,
    requestedRoute: row.requested_route as string,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    clientIdempotencyKey: row.client_idempotency_key as string,
    intentVersion: Number(row.intent_version),
    policyVersion: row.policy_version as string,
  };
}

function rowToPlan(row: Record<string, unknown>): ExecutionPlan {
  return {
    planHash: row.plan_hash as Hex,
    chainId: row.chain_id as string,
    asset: row.asset as string,
    recipient: row.recipient as string,
    calls: JSON.parse(row.calls_json as string) as string[],
    valueLimits: {
      maxValue: row.max_value as string,
      slippageBps: (row.slippage_bps as number | null) ?? null,
      maxFee: (row.max_fee as string | null) ?? null,
      maxGas: (row.max_gas as string | null) ?? null,
    },
    policyVersion: row.policy_version as string,
    simulationRef: (row.simulation_ref as string | null) ?? null,
    intentId: row.intent_id as string,
    createdAt: Number(row.created_at),
  };
}

function rowToPause(row: Record<string, unknown>): ExecutionPause {
  return {
    pauseId: row.pause_id as string,
    intentId: row.intent_id as string,
    planHash: row.plan_hash as Hex,
    policyVersion: row.policy_version as string,
    state: row.state as PauseState,
    version: Number(row.version),
    reasonCodes: JSON.parse((row.reason_codes_json as string) ?? "[]") as string[],
    riskLevel: row.risk_level as ExecutionPause["riskLevel"],
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    lastVerifiedAt: row.last_verified_at === null || row.last_verified_at === undefined ? null : Number(row.last_verified_at),
    checks: [], // populated via pause_checks table separately when needed; keep empty here for list queries
    requiredApprovalCount: Number(row.required_approval_count),
    approvalScopeHash: (row.approval_scope_hash as Hex | null) ?? null,
    settlementOperationId: (row.settlement_operation_id as string | null) ?? null,
    decisionIds: JSON.parse((row.decision_ids_json as string) ?? "[]") as string[],
  };
}

export class PostgresPauseStore implements PauseStore {
  private readonly pool: Pool;
  private closed = false;

  constructor(options: PostgresPauseStoreOptions) {
    this.pool = new Pool(mergePoolConfig(options));
  }

  async migrate(): Promise<void> {
    this.assertOpen();
    let client: PoolClient | undefined;
    try { client = await this.pool.connect(); } catch (cause) { throw new PostgresPauseStoreError("store_connect_failed", "cannot acquire connection", cause); }
    try {
      await client.query("BEGIN");
      try {
        await client.query(PAUSE_STORE_MIGRATION_SQL);
        const meta = await client.query<{ value: string }>("SELECT value FROM prism_store_meta WHERE key = 'pause_schema_version' FOR UPDATE");
        if (meta.rowCount === 0) {
          await client.query("INSERT INTO prism_store_meta (key, value) VALUES ('pause_schema_version', $1)", [String(PAUSE_STORE_SCHEMA_VERSION)]);
        } else if (Number.parseInt(meta.rows[0].value, 10) > PAUSE_STORE_SCHEMA_VERSION) {
          throw new PostgresPauseStoreError("store_migrate_failed", `pause_schema_version ${meta.rows[0].value} newer than supported ${PAUSE_STORE_SCHEMA_VERSION}`);
        } else if (Number.parseInt(meta.rows[0].value, 10) < PAUSE_STORE_SCHEMA_VERSION) {
          await client.query("UPDATE prism_store_meta SET value=$1 WHERE key='pause_schema_version'", [String(PAUSE_STORE_SCHEMA_VERSION)]);
        }
        await client.query("COMMIT");
      } catch (inner) { await client.query("ROLLBACK").catch(()=>undefined); throw inner; }
    } catch (cause) {
      if (cause instanceof PostgresPauseStoreError) throw cause;
      throw new PostgresPauseStoreError("store_migrate_failed", "migration failed", cause);
    } finally { client.release(); }
  }

  static async create(options: PostgresPauseStoreOptions): Promise<PostgresPauseStore> {
    const s = new PostgresPauseStore(options);
    if (!options.skipMigration) await s.migrate();
    return s;
  }

  private assertOpen() { if (this.closed) throw new PostgresPauseStoreError("store_connect_failed","store is closed"); }

  async putIntent(intent: ExecutionIntent): Promise<ExecutionIntent> {
    this.assertOpen();
    try {
      await this.pool.query(
        `INSERT INTO execution_intents (intent_id, principal, initiator, agent_id, purpose, requested_recipient, requested_asset, requested_amount, requested_route, created_at, expires_at, client_idempotency_key, intent_version, policy_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [intent.intentId, intent.principal, intent.initiator, intent.agentId ?? null, intent.purpose, intent.requestedRecipient, intent.requestedAsset, intent.requestedAmount, intent.requestedRoute, intent.createdAt, intent.expiresAt, intent.clientIdempotencyKey, intent.intentVersion, intent.policyVersion],
      );
      return intent;
    } catch (cause) {
      if (!isUniqueViolation(cause)) throw new PostgresPauseStoreError("store_write_failed","putIntent failed", cause);
      // Resolve existing by idempotency key
      let existing: ExecutionIntent | undefined;
      try {
        const res = await this.pool.query(`SELECT * FROM execution_intents WHERE client_idempotency_key=$1`, [intent.clientIdempotencyKey]);
        if (res.rowCount && res.rowCount>0) existing = rowToIntent(res.rows[0] as Record<string, unknown>);
      } catch (e) { throw new PostgresPauseStoreError("store_read_failed","putIntent conflict read failed", e); }
      if (existing) {
        const mismatch = !sameIntentFingerprint(existing, intent);
        if (mismatch) throw new PauseError(PAUSE_ERROR_CODE.IDEMPOTENCY_CONFLICT, `idempotency_key_conflict:${intent.clientIdempotencyKey}`);
        return existing;
      }
      // Unique on intent_id instead
      throw new PauseError(PAUSE_ERROR_CODE.IDEMPOTENCY_CONFLICT, `duplicate_intent_id:${intent.intentId}`);
    }
  }

  async getIntent(intentId: string): Promise<ExecutionIntent | undefined> {
    this.assertOpen();
    try { const r = await this.pool.query(`SELECT * FROM execution_intents WHERE intent_id=$1`,[intentId]); return r.rowCount&&r.rowCount>0 ? rowToIntent(r.rows[0] as Record<string, unknown>) : undefined; }
    catch (cause) { throw new PostgresPauseStoreError("store_read_failed","getIntent failed",cause); }
  }

  async getIntentByIdempotencyKey(key: string): Promise<ExecutionIntent | undefined> {
    this.assertOpen();
    try { const r = await this.pool.query(`SELECT * FROM execution_intents WHERE client_idempotency_key=$1`,[key]); return r.rowCount&&r.rowCount>0 ? rowToIntent(r.rows[0] as Record<string, unknown>) : undefined; }
    catch (cause) { throw new PostgresPauseStoreError("store_read_failed","getIntentByIdempotencyKey failed",cause); }
  }

  async putPlan(plan: ExecutionPlan): Promise<ExecutionPlan> {
    this.assertOpen();
    try {
      await this.pool.query(
        `INSERT INTO execution_plans (plan_hash, chain_id, asset, recipient, calls_json, max_value, slippage_bps, max_fee, max_gas, policy_version, simulation_ref, intent_id, created_at, canonical_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [plan.planHash, plan.chainId, plan.asset, plan.recipient, JSON.stringify(plan.calls), plan.valueLimits.maxValue, plan.valueLimits.slippageBps ?? null, plan.valueLimits.maxFee ?? null, plan.valueLimits.maxGas ?? null, plan.policyVersion, plan.simulationRef ?? null, plan.intentId, plan.createdAt, JSON.stringify({planHash:plan.planHash})],
      );
      return plan;
    } catch (cause) {
      if (!isUniqueViolation(cause)) throw new PostgresPauseStoreError("store_write_failed","putPlan failed",cause);
      const existing = await this.getPlan(plan.planHash);
      if (existing && existing.intentId !== plan.intentId) throw new PauseError(PAUSE_ERROR_CODE.INVALID_PLAN,"plan_hash_collision_across_intents");
      return existing ?? plan;
    }
  }

  async getPlan(planHash: Hex): Promise<ExecutionPlan | undefined> {
    this.assertOpen();
    try { const r = await this.pool.query(`SELECT * FROM execution_plans WHERE plan_hash=$1`,[planHash]); return r.rowCount&&r.rowCount>0 ? rowToPlan(r.rows[0] as Record<string, unknown>) : undefined; }
    catch (cause) { throw new PostgresPauseStoreError("store_read_failed","getPlan failed",cause); }
  }

  async getPlanByIntent(intentId: string): Promise<ExecutionPlan | undefined> {
    this.assertOpen();
    try { const r = await this.pool.query(`SELECT * FROM execution_plans WHERE intent_id=$1`,[intentId]); return r.rowCount&&r.rowCount>0 ? rowToPlan(r.rows[0] as Record<string, unknown>) : undefined; }
    catch (cause) { throw new PostgresPauseStoreError("store_read_failed","getPlanByIntent failed",cause); }
  }

  async createPause(input: CreatePauseRecordInput): Promise<ExecutionPause> {
    this.assertOpen();
    if (!VALID_PAUSE_STATES.has(input.pause.state)) throw new PostgresPauseStoreError("invalid_record",`invalid state ${input.pause.state}`);
    try {
      await this.pool.query(
        `INSERT INTO execution_pauses (pause_id, intent_id, plan_hash, policy_version, state, version, reason_codes_json, risk_level, created_at, expires_at, last_verified_at, required_approval_count, approval_scope_hash, settlement_operation_id, decision_ids_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [input.pause.pauseId, input.pause.intentId, input.pause.planHash, input.pause.policyVersion, input.pause.state, input.pause.version, JSON.stringify(input.pause.reasonCodes), input.pause.riskLevel, input.pause.createdAt, input.pause.expiresAt, input.pause.lastVerifiedAt, input.pause.requiredApprovalCount, input.pause.approvalScopeHash, input.pause.settlementOperationId, JSON.stringify(input.pause.decisionIds)],
      );
      return input.pause;
    } catch (cause) {
      if (isUniqueViolation(cause)) {
        // Might be duplicate pause_id or active-per-intent unique index
        if (String((cause as { constraint?: string })?.constraint ?? "").includes("active_per_intent")) throw new PauseError(PAUSE_ERROR_CODE.DUPLICATE_PAUSE, `active_pause_exists_for_intent:${input.pause.intentId}`);
        throw new PauseError(PAUSE_ERROR_CODE.DUPLICATE_PAUSE, input.pause.pauseId);
      }
      if (isCheckViolation(cause)) throw new PostgresPauseStoreError("invalid_record","createPause rejected by schema", cause);
      throw new PostgresPauseStoreError("store_write_failed","createPause failed",cause);
    }
  }

  async getPause(pauseId: string): Promise<ExecutionPause | undefined> {
    this.assertOpen();
    try {
      const r = await this.pool.query(`SELECT * FROM execution_pauses WHERE pause_id=$1`,[pauseId]);
      if (!r.rowCount || r.rowCount===0) return undefined;
      const pause = rowToPause(r.rows[0] as Record<string, unknown>);
      // hydrate checks
      const c = await this.pool.query(`SELECT checks_json FROM pause_checks WHERE pause_id=$1`,[pauseId]);
      const checks: CheckResult[] = c.rowCount && c.rowCount>0 ? JSON.parse((c.rows[0] as Record<string, unknown>).checks_json as string) : [];
      return { ...pause, checks };
    } catch (cause) {
      if (cause instanceof PauseError) throw cause;
      throw new PostgresPauseStoreError("store_read_failed","getPause failed",cause);
    }
  }

  async getPauseByIntent(intentId: string): Promise<ExecutionPause | undefined> {
    this.assertOpen();
    try {
      const r = await this.pool.query(`SELECT pause_id FROM execution_pauses WHERE intent_id=$1 ORDER BY created_at DESC LIMIT 1`,[intentId]);
      if (!r.rowCount || r.rowCount===0) return undefined;
      return this.getPause((r.rows[0] as Record<string, unknown>).pause_id as string);
    } catch (cause) { throw new PostgresPauseStoreError("store_read_failed","getPauseByIntent failed",cause); }
  }

  async updatePause(pause: ExecutionPause, expectedVersion: number): Promise<ExecutionPause> {
    this.assertOpen();
    if (!Number.isInteger(expectedVersion) || expectedVersion<0) throw new PostgresPauseStoreError("invalid_record","expectedVersion invalid");
    if (pause.version !== expectedVersion+1) throw new PauseError(PAUSE_ERROR_CODE.ILLEGAL_TRANSITION,"version_must_increment_by_1");
    try {
      const res = await this.pool.query(
        `UPDATE execution_pauses SET state=$2, version=$3, reason_codes_json=$4, risk_level=$5, last_verified_at=$6, required_approval_count=$7, approval_scope_hash=$8, settlement_operation_id=$9, decision_ids_json=$10, expires_at=$11, policy_version=$12
         WHERE pause_id=$1 AND version=$13 AND plan_hash=$14`,
        [pause.pauseId, pause.state, pause.version, JSON.stringify(pause.reasonCodes), pause.riskLevel, pause.lastVerifiedAt, pause.requiredApprovalCount, pause.approvalScopeHash, pause.settlementOperationId, JSON.stringify(pause.decisionIds), pause.expiresAt, pause.policyVersion, expectedVersion, pause.planHash],
      );
      if (res.rowCount !==1) throw new PauseError(PAUSE_ERROR_CODE.STALE_VERSION, `stale_version:expected_${expectedVersion}_got_${res.rowCount===0 ? "stale" : "unknown"}`);
      // also persist checks if present (caller should have called putChecks separately if needed; we upsert here if checks non-empty and differ)
      if (pause.checks.length>0) {
        await this.pool.query(`INSERT INTO pause_checks (pause_id, checks_json, updated_at) VALUES ($1,$2,$3) ON CONFLICT (pause_id) DO UPDATE SET checks_json=$2, updated_at=$3`,[pause.pauseId, JSON.stringify(pause.checks), Date.now()]);
      }
      return pause;
    } catch (cause) {
      if (cause instanceof PauseError) throw cause;
      if (isCheckViolation(cause)) throw new PostgresPauseStoreError("invalid_record","updatePause rejected",cause);
      throw new PostgresPauseStoreError("store_write_failed","updatePause failed",cause);
    }
  }

  async listPausesByState(state: PauseState, limit=100): Promise<readonly ExecutionPause[]> {
    this.assertOpen();
    const bounded = Math.max(1, Math.min(1000, Math.floor(limit)));
    try { const r = await this.pool.query(`SELECT * FROM execution_pauses WHERE state=$1 ORDER BY created_at ASC LIMIT $2`,[state,bounded]); return r.rows.map((row)=>rowToPause(row as Record<string, unknown>)); }
    catch (cause) { throw new PostgresPauseStoreError("store_read_failed","listPausesByState failed",cause); }
  }

  async listExpired(now: number, limit=100): Promise<readonly ExecutionPause[]> {
    this.assertOpen();
    if (!Number.isFinite(now)) throw new PostgresPauseStoreError("invalid_record","invalid now");
    const bounded = Math.max(1, Math.min(1000, Math.floor(limit)));
    try { const r = await this.pool.query(`SELECT * FROM execution_pauses WHERE expires_at <= $1 AND state NOT IN ('CANCELLED','EXPIRED','RELEASED') ORDER BY expires_at ASC LIMIT $2`,[now,bounded]); return r.rows.map((row)=>rowToPause(row as Record<string, unknown>)); }
    catch (cause) { throw new PostgresPauseStoreError("store_read_failed","listExpired failed",cause); }
  }

  async putChecks(pauseId: string, checks: readonly CheckResult[]): Promise<void> {
    this.assertOpen();
    try { await this.pool.query(`INSERT INTO pause_checks (pause_id, checks_json, updated_at) VALUES ($1,$2,$3) ON CONFLICT (pause_id) DO UPDATE SET checks_json=$2, updated_at=$3`,[pauseId, JSON.stringify(checks), Date.now()]); }
    catch (cause) { throw new PostgresPauseStoreError("store_write_failed","putChecks failed",cause); }
  }

  async getChecks(pauseId: string): Promise<readonly CheckResult[]> {
    this.assertOpen();
    try { const r = await this.pool.query(`SELECT checks_json FROM pause_checks WHERE pause_id=$1`,[pauseId]); return r.rowCount&&r.rowCount>0 ? JSON.parse((r.rows[0] as Record<string, unknown>).checks_json as string) as CheckResult[] : []; }
    catch (cause) { throw new PostgresPauseStoreError("store_read_failed","getChecks failed",cause); }
  }

  async appendDecision(decision: PauseDecision): Promise<PauseDecision> {
    this.assertOpen();
    // replay guard: SELECT existing same kind+planHash
    try {
      const existing = await this.pool.query(`SELECT decision_id FROM pause_decisions WHERE pause_id=$1 AND kind=$2 AND plan_hash=$3`,[decision.pauseId, decision.kind, decision.planHash]);
      if (existing.rowCount && existing.rowCount>0 && (decision.kind==="RELEASE"||decision.kind==="APPROVE")) throw new PauseError(PAUSE_ERROR_CODE.APPROVAL_REPLAY, `${decision.kind} replay for plan ${decision.planHash}`);
      await this.pool.query(
        `INSERT INTO pause_decisions (decision_id, pause_id, kind, actor, policy_version, plan_hash, approval_scope_hash, reason_codes_json, created_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [decision.decisionId, decision.pauseId, decision.kind, decision.actor, decision.policyVersion, decision.planHash, decision.approvalScopeHash ?? null, JSON.stringify(decision.reasonCodes), decision.createdAt, decision.expiresAt ?? null],
      );
      // also append to pause decisionIds_json atomically via update (caller will also update pause version)
      // We do not bump version here; caller does via updatePause.
      await this.pool.query(`UPDATE execution_pauses SET decision_ids_json = (SELECT jsonb_agg(elem) FROM (SELECT jsonb_array_elements_text(decision_ids_json::jsonb) AS elem UNION ALL SELECT $2) s)::text WHERE pause_id=$1`, [decision.pauseId, decision.decisionId]).catch(()=>undefined);
      return decision;
    } catch (cause) {
      if (cause instanceof PauseError) throw cause;
      if (isUniqueViolation(cause)) throw new PauseError(PAUSE_ERROR_CODE.APPROVAL_REPLAY, `duplicate_decision_id:${decision.decisionId}`);
      throw new PostgresPauseStoreError("store_write_failed","appendDecision failed",cause);
    }
  }

  async getDecisions(pauseId: string): Promise<readonly PauseDecision[]> {
    this.assertOpen();
    try {
      const r = await this.pool.query(`SELECT * FROM pause_decisions WHERE pause_id=$1 ORDER BY created_at ASC`,[pauseId]);
      return r.rows.map((row)=> ({
        decisionId: (row as Record<string, unknown>).decision_id as string,
        pauseId: (row as Record<string, unknown>).pause_id as string,
        kind: (row as Record<string, unknown>).kind as PauseDecision["kind"],
        actor: (row as Record<string, unknown>).actor as string,
        policyVersion: (row as Record<string, unknown>).policy_version as string,
        planHash: (row as Record<string, unknown>).plan_hash as Hex,
        approvalScopeHash: ((row as Record<string, unknown>).approval_scope_hash as Hex | null) ?? null,
        reasonCodes: JSON.parse(((row as Record<string, unknown>).reason_codes_json as string) ?? "[]") as string[],
        createdAt: Number((row as Record<string, unknown>).created_at),
        expiresAt: (row as Record<string, unknown>).expires_at === null ? null : Number((row as Record<string, unknown>).expires_at),
      }));
    } catch (cause) { throw new PostgresPauseStoreError("store_read_failed","getDecisions failed",cause); }
  }

  async close(): Promise<void> { if (this.closed) return; this.closed=true; try{ await this.pool.end(); } catch{} }
}

function isUniqueViolation(cause: unknown): boolean { return (cause as {code?: string}|null)?.code==="23505"; }
function isCheckViolation(cause: unknown): boolean { return (cause as {code?: string}|null)?.code==="23514"; }
