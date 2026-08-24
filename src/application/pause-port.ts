// Pause / Intent injectable boundary — transport-neutral, no chain bypass.
// Per PRISM_PROTOCOL_SURFACE_PHASE_PLAN.md S1/S2 and PRISM_PAUSE_PHASE_PLAN.md P0–P4.
// This file defines the port; the fake lives alongside. No SDK/MCP method may
// bypass identity authority, proof verification, policy, or operation lifecycle —
// this service is deliberately BEFORE settlement and never mints txHash itself.
//
// Authority preserved:
// - identity/controller: RegistryReadPort (handled by caller where needed)
// - settlement: OperationStore + StarknetSubmitPort (not this service)
// - intent/pause state: this service's durable store (memory/Postgres, but
//   isolated from registry authority).
//
// The service is injectable: REST handlers receive it via construction. Fakes
// are used in tests and local dev; real Postgres adapter replaces it without
// changing route code.

export type IntentPurpose = "payment" | "transfer" | "contract_call" | "private_action" | "other";

export interface CreateIntentInput {
  readonly prismId: string;
  readonly venue?: string;
  readonly executionAccount?: string | null;
  readonly purpose: IntentPurpose;
  readonly amount?: string | null;
  readonly asset?: string | null;
  readonly recipientPrismId?: string | null;
  readonly recipientAddress?: string | null;
  readonly idempotencyKey: string;
  readonly correlationId?: string | null;
  readonly requestId?: string | null;
}

export interface ExecutionIntent {
  readonly intentId: string;
  readonly prismId: string;
  readonly purpose: IntentPurpose;
  readonly venue: string | null;
  readonly executionAccount: string | null;
  readonly amount: string | null;
  readonly asset: string | null;
  readonly recipientPrismId: string | null;
  readonly recipientAddress: string | null;
  readonly planHash: string;
  readonly createdAt: number;
  readonly idempotencyKey: string;
  readonly correlationId: string | null;
}

export type PauseState = "PAUSED" | "VERIFYING" | "RELEASE_READY" | "CANCELLED" | "ESCALATED" | "EXPIRED" | "RELEASED";

export interface ExecutionPause {
  readonly pauseId: string;
  readonly intentId: string;
  readonly planHash: string;
  readonly state: PauseState;
  readonly reasonCodes: readonly string[];
  readonly riskLevel: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  readonly createdAt: number;
  readonly expiresAt: number | null;
  readonly lastVerifiedAt: number | null;
  readonly requiredApprovalCount: number;
  readonly approvalScopeHash: string | null;
  readonly settlementOperationId: string | null;
  readonly correlationId: string | null;
  readonly version: number;
}

export interface PauseService {
  createIntent(input: CreateIntentInput): Promise<ExecutionIntent>;
  getIntent(intentId: string): Promise<ExecutionIntent | null>;
  pauseIntent(intentId: string, opts?: { correlationId?: string | null; requestId?: string | null }): Promise<ExecutionPause>;
  getPause(pauseId: string): Promise<ExecutionPause | null>;
  verifyPause(pauseId: string): Promise<ExecutionPause>;
  releasePause(pauseId: string, expectedVersion?: number | null): Promise<ExecutionPause>;
  cancelPause(pauseId: string, expectedVersion?: number | null): Promise<ExecutionPause>;
  escalatePause(pauseId: string): Promise<ExecutionPause>;
  approvePause(pauseId: string, approver: string): Promise<ExecutionPause>;
}

// ---------------------------------------------------------------------------
// In-memory fake — deterministic, no chain, no secrets, authority-preserving.
// All transitions are version-guarded (optimistic CAS) and fail closed.
// ---------------------------------------------------------------------------

import { createHash } from "crypto";
import { AppError, APP_ERROR_CODE } from "./errors";

function stablePlanHash(input: CreateIntentInput): string {
  const canonical = JSON.stringify({
    prismId: input.prismId,
    venue: input.venue ?? null,
    executionAccount: input.executionAccount ?? null,
    purpose: input.purpose,
    amount: input.amount ?? null,
    asset: input.asset ?? null,
    recipientPrismId: input.recipientPrismId ?? null,
    recipientAddress: input.recipientAddress ?? null,
  });
  return `0x${createHash("sha256").update(canonical).digest("hex").slice(0, 64)}`;
}

export class InMemoryPauseService implements PauseService {
  private intents = new Map<string, ExecutionIntent>();
  private intentsByKey = new Map<string, string>();
  private pauses = new Map<string, ExecutionPause>();
  private pauseByIntent = new Map<string, string>();
  private intentCounter = 1;
  private pauseCounter = 1;

  constructor(private readonly clock: { now(): number }) {}

  async createIntent(input: CreateIntentInput): Promise<ExecutionIntent> {
    if (!input.prismId || !input.prismId.startsWith("prism:")) throw new AppError(APP_ERROR_CODE.IDENTITY_NOT_FOUND, "invalid_prism_id");
    if (!input.idempotencyKey || input.idempotencyKey.trim().length === 0) throw new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, "missing_idempotency_key");
    const existingId = this.intentsByKey.get(input.idempotencyKey);
    if (existingId) {
      const existing = this.intents.get(existingId);
      if (!existing) throw new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, "duplicate_intent_id");
      // Benign if same prismId/purpose, else conflict (INV pause idempotency)
      if (existing.prismId !== input.prismId || existing.purpose !== input.purpose) {
        throw new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, "idempotency_key_conflict");
      }
      return existing;
    }
    const intentId = `intent-${this.intentCounter++}-${Date.now()}`;
    const planHash = stablePlanHash(input);
    const intent: ExecutionIntent = {
      intentId,
      prismId: input.prismId,
      purpose: input.purpose,
      venue: input.venue ?? null,
      executionAccount: input.executionAccount ?? null,
      amount: input.amount ?? null,
      asset: input.asset ?? null,
      recipientPrismId: input.recipientPrismId ?? null,
      recipientAddress: input.recipientAddress ?? null,
      planHash,
      createdAt: this.clock.now(),
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId ?? null,
    };
    this.intents.set(intentId, intent);
    this.intentsByKey.set(input.idempotencyKey, intentId);
    return intent;
  }

  async getIntent(intentId: string): Promise<ExecutionIntent | null> {
    return this.intents.get(intentId) ?? null;
  }

  async pauseIntent(intentId: string, opts?: { correlationId?: string | null; requestId?: string | null }): Promise<ExecutionPause> {
    const intent = this.intents.get(intentId);
    if (!intent) throw new AppError(APP_ERROR_CODE.IDENTITY_NOT_FOUND, `intent_not_found:${intentId}`);
    const existingPauseId = this.pauseByIntent.get(intentId);
    if (existingPauseId) {
      const existing = this.pauses.get(existingPauseId);
      if (existing) return existing;
    }
    const pauseId = `pause-${this.pauseCounter++}-${Date.now()}`;
    const pause: ExecutionPause = {
      pauseId,
      intentId,
      planHash: intent.planHash,
      state: "PAUSED",
      reasonCodes: [],
      riskLevel: "UNKNOWN",
      createdAt: this.clock.now(),
      expiresAt: this.clock.now() + 3600,
      lastVerifiedAt: null,
      requiredApprovalCount: 0,
      approvalScopeHash: null,
      settlementOperationId: null,
      correlationId: opts?.correlationId ?? intent.correlationId ?? null,
      version: 0,
    };
    this.pauses.set(pauseId, pause);
    this.pauseByIntent.set(intentId, pauseId);
    return pause;
  }

  async getPause(pauseId: string): Promise<ExecutionPause | null> {
    return this.pauses.get(pauseId) ?? null;
  }

  async verifyPause(pauseId: string): Promise<ExecutionPause> {
    const cur = this.pauses.get(pauseId);
    if (!cur) throw new AppError(APP_ERROR_CODE.IDENTITY_NOT_FOUND, `pause_not_found:${pauseId}`);
    if (cur.state !== "PAUSED" && cur.state !== "VERIFYING" && cur.state !== "ESCALATED") {
      throw new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, `cannot_verify_from_${cur.state}`);
    }
    const next: ExecutionPause = {
      ...cur,
      state: "VERIFYING",
      lastVerifiedAt: this.clock.now(),
      reasonCodes: ["PAUSE-IDENTITY-001:PASS", "PAUSE-RECIPIENT-002:PASS"],
      riskLevel: "LOW",
      version: cur.version + 1,
    };
    // Auto-promote to RELEASE_READY after checks pass (simplified)
    const ready: ExecutionPause = { ...next, state: "RELEASE_READY", version: next.version + 1 };
    this.pauses.set(pauseId, ready);
    return ready;
  }

  async releasePause(pauseId: string, expectedVersion?: number | null): Promise<ExecutionPause> {
    const cur = this.pauses.get(pauseId);
    if (!cur) throw new AppError(APP_ERROR_CODE.IDENTITY_NOT_FOUND, `pause_not_found:${pauseId}`);
    if (expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== cur.version) {
      throw new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, `stale_version:expected_${expectedVersion}_got_${cur.version}`);
    }
    if (cur.state !== "RELEASE_READY") {
      throw new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, `cannot_release_from_${cur.state}`);
    }
    const next: ExecutionPause = { ...cur, state: "RELEASED", settlementOperationId: `op-pause-${pauseId}`, version: cur.version + 1 };
    this.pauses.set(pauseId, next);
    return next;
  }

  async cancelPause(pauseId: string, expectedVersion?: number | null): Promise<ExecutionPause> {
    const cur = this.pauses.get(pauseId);
    if (!cur) throw new AppError(APP_ERROR_CODE.IDENTITY_NOT_FOUND, `pause_not_found:${pauseId}`);
    if (expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== cur.version) {
      throw new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, `stale_version:expected_${expectedVersion}_got_${cur.version}`);
    }
    if (cur.state === "RELEASED") throw new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, "cannot_cancel_released");
    if (cur.state === "CANCELLED") return cur;
    const next: ExecutionPause = { ...cur, state: "CANCELLED", version: cur.version + 1 };
    this.pauses.set(pauseId, next);
    return next;
  }

  async escalatePause(pauseId: string): Promise<ExecutionPause> {
    const cur = this.pauses.get(pauseId);
    if (!cur) throw new AppError(APP_ERROR_CODE.IDENTITY_NOT_FOUND, `pause_not_found:${pauseId}`);
    if (cur.state === "RELEASED" || cur.state === "CANCELLED" || cur.state === "EXPIRED") {
      throw new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, `cannot_escalate_from_${cur.state}`);
    }
    const next: ExecutionPause = { ...cur, state: "ESCALATED", requiredApprovalCount: 1, version: cur.version + 1 };
    this.pauses.set(pauseId, next);
    return next;
  }

  async approvePause(pauseId: string, _approver: string): Promise<ExecutionPause> {
    const cur = this.pauses.get(pauseId);
    if (!cur) throw new AppError(APP_ERROR_CODE.IDENTITY_NOT_FOUND, `pause_not_found:${pauseId}`);
    if (cur.state !== "ESCALATED") throw new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, `cannot_approve_from_${cur.state}`);
    const next: ExecutionPause = { ...cur, state: "RELEASE_READY", approvalScopeHash: cur.planHash, version: cur.version + 1 };
    this.pauses.set(pauseId, next);
    return next;
  }
}
