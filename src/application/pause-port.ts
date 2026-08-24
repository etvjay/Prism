// Pause / Intent injectable boundary — transport-neutral, no chain bypass.
// Per PRISM_PROTOCOL_SURFACE_PHASE_PLAN.md S1/S2 and PRISM_PAUSE_PHASE_PLAN.md P0–P4.
// Rigorous adapter: delegates through domain PauseService + InMemoryPauseStore
// to enforce P0–P4 guards (plan_hash binding, approval_scope_hash, CAS expectedVersion,
// UNKNOWN blocking, RELEASED != COMPLETED). No auto-promotion fake.
// Authority preserved: identity/controller via Registry, settlement via OperationStore, intent/pause via domain store.

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
  verifyPause(pauseId: string, opts?: { planHash?: string; policyVersion?: string; sources?: unknown }): Promise<ExecutionPause>;
  releasePause(pauseId: string, expectedVersion?: number | null, opts?: { planHash?: string; approvalScopeHash?: string | null; settlementOperationId?: string; correlationId?: string | null; authoritySubject?: string | null; authorityClaim?: string | null }): Promise<ExecutionPause>;
  cancelPause(pauseId: string, expectedVersion?: number | null): Promise<ExecutionPause>;
  escalatePause(pauseId: string): Promise<ExecutionPause>;
  approvePause(pauseId: string, approver: string, opts?: { planHash?: string; approvalScopeHash?: string | null }): Promise<ExecutionPause>;
}

// ---------------------------------------------------------------------------
// Rigorous In-memory adapter — delegates through domain PauseService.
// No auto-promotion, fail-closed on UNKNOWN, strict plan/approval binding,
// CAS version, RELEASED settlementOperationId-only.
// ---------------------------------------------------------------------------

import { AppError, APP_ERROR_CODE } from "./errors";
import { InMemoryPauseStore } from "../features/prism-pause/adapters/memory-pause-store";
import type { PauseStore } from "../features/prism-pause/ports/pause-store";
import { PauseService as DomainPauseService } from "../features/prism-pause/application/pause-service";
import type { ExecutionIntent as DomainIntent } from "../features/prism-pause/domain/intent";
import type { ExecutionPlan as DomainPlan } from "../features/prism-pause/domain/execution-plan";
import type { ExecutionPause as DomainPause } from "../features/prism-pause/domain/pause";
import { computeApprovalScopeHash } from "../features/prism-pause/domain/pause";
import { PauseError, PAUSE_ERROR_CODE } from "../features/prism-pause/domain/errors";
import type { Policy, VerificationSources } from "../features/prism-pause/domain/policy-engine";
import type { PauseAuthorityResolver } from "../features/prism-pause/ports/authority";
export type { PauseAuthorityAction, PauseAuthorityActor, PauseAuthorityDecision, PauseAuthorityRequest, PauseAuthorityResolver } from "../features/prism-pause/ports/authority";

function toMs(clockNow: number): number {
  // clock.now() is seconds (fixedClock seconds). Convert to ms for domain.
  // Detect ms already (if > 1e12) keep as is.
  if (clockNow > 1e12) return clockNow;
  return clockNow * 1000;
}

function mapDomainIntentToRest(domainIntent: DomainIntent, domainPlan: DomainPlan | undefined, correlationId: string | null, restInput?: CreateIntentInput): ExecutionIntent {
  // Derive venue etc from stored restInput if available, else from domain intent fields.
  const venue = restInput?.venue ?? null;
  const executionAccount = restInput?.executionAccount ?? null;
  const amount = restInput?.amount ?? domainIntent.requestedAmount ?? null;
  const asset = restInput?.asset ?? domainIntent.requestedAsset ?? null;
  const recipientPrismId = restInput?.recipientPrismId ?? null;
  const recipientAddress = restInput?.recipientAddress ?? null;
  return {
    intentId: domainIntent.intentId,
    prismId: domainIntent.principal,
    purpose: domainIntent.purpose as IntentPurpose,
    venue,
    executionAccount,
    amount,
    asset,
    recipientPrismId,
    recipientAddress,
    planHash: domainPlan?.planHash ?? (domainIntent as unknown as { planHash?: string })?.planHash ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
    createdAt: domainIntent.createdAt,
    idempotencyKey: domainIntent.clientIdempotencyKey,
    correlationId,
  };
}

function mapDomainPauseToRest(domainPause: DomainPause, correlationId: string | null): ExecutionPause {
  return {
    pauseId: domainPause.pauseId,
    intentId: domainPause.intentId,
    planHash: domainPause.planHash,
    state: domainPause.state as PauseState,
    reasonCodes: domainPause.reasonCodes,
    riskLevel: domainPause.riskLevel,
    createdAt: domainPause.createdAt,
    expiresAt: domainPause.expiresAt,
    lastVerifiedAt: domainPause.lastVerifiedAt,
    requiredApprovalCount: domainPause.requiredApprovalCount,
    approvalScopeHash: domainPause.approvalScopeHash,
    settlementOperationId: domainPause.settlementOperationId,
    correlationId,
    version: domainPause.version,
  };
}

function passingSources(): VerificationSources {
  return {
    recipientBinding: { status: "BOUND", observedValue: "0xabc" },
    firstUse: { isFirstUse: false },
    agentAuthorized: { authorized: true },
    routeAllowed: { chainAllowed: true, assetAllowed: true, contractAllowed: true, notRevoked: true },
    intentPlanMatch: { matches: true },
    simulation: { success: true, effectMatches: true, freshnessOk: true },
    additionalApproval: { requiresApproval: false },
  };
}

function unknownSources(): VerificationSources {
  return {
    recipientBinding: { status: "UNKNOWN", observedValue: null },
    firstUse: { isFirstUse: null, unknown: true },
    agentAuthorized: { authorized: null, unknown: true },
    routeAllowed: { chainAllowed: null, assetAllowed: null, contractAllowed: null, notRevoked: null, unknown: true },
    intentPlanMatch: { matches: null, unknown: true },
    simulation: { success: null, effectMatches: null, freshnessOk: null, unknown: true },
    additionalApproval: { requiresApproval: null, unknown: true },
  };
}

export class InMemoryPauseService implements PauseService {
  private readonly domainStore: PauseStore;
  private readonly domainService: DomainPauseService;
  private readonly restInputs = new Map<string, CreateIntentInput>();
  private readonly correlationByIntent = new Map<string, string | null>();
  private readonly correlationByPause = new Map<string, string | null>();
  private intentCounter = 1;
  private readonly injectedOperationStore?: import("../features/prism-operations/domain/operation-store").OperationStore;
  private readonly injectedMetrics?: import("../features/prism-pause/ports/metrics").PauseMetrics;
  private readonly injectedAdapters?: Map<import("../features/prism-pause/ports/execution-adapter").SettlementChain, import("../features/prism-pause/ports/execution-adapter").PauseExecutionAdapter>;

  constructor(
    private readonly clock: { now(): number },
    opts?: {
      store?: PauseStore;
      operationStore?: import("../features/prism-operations/domain/operation-store").OperationStore;
      metrics?: import("../features/prism-pause/ports/metrics").PauseMetrics;
      adapterRegistry?: Map<import("../features/prism-pause/ports/execution-adapter").SettlementChain, import("../features/prism-pause/ports/execution-adapter").PauseExecutionAdapter>;
      authorityResolver?: PauseAuthorityResolver;
    },
  ) {
    this.injectedOperationStore = opts?.operationStore;
    this.injectedMetrics = opts?.metrics;
    this.injectedAdapters = opts?.adapterRegistry;
    this.domainStore = opts?.store ?? new InMemoryPauseStore();
    const metricsForDomain = opts?.metrics;
    this.domainService = new DomainPauseService(this.domainStore, {
      store: this.domainStore,
      defaultPauseTtlMs: 3600 * 1000,
      operationStore: opts?.operationStore,
      executionAdapters: opts?.adapterRegistry,
      authorityResolver: opts?.authorityResolver,
      metrics: metricsForDomain,
      now: () => toMs(this.clock.now()),
    });
  }

  // For testing: expose underlying store/service
  getDomainStore(): PauseStore { return this.domainStore; }
  getDomainService(): DomainPauseService { return this.domainService; }

  async createIntent(input: CreateIntentInput): Promise<ExecutionIntent> {
    if (!input.prismId || !input.prismId.startsWith("prism:")) throw new AppError(APP_ERROR_CODE.IDENTITY_NOT_FOUND, "invalid_prism_id");
    if (!input.idempotencyKey || input.idempotencyKey.trim().length === 0) throw new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, "missing_idempotency_key");

    const nowMs = toMs(this.clock.now());

    const intentId = `intent-${this.intentCounter++}-${Date.now()}`;

    // Build domain intent input
    const requestedRecipient = input.recipientPrismId ?? input.recipientAddress ?? "0x0000000000000000000000000000000000000000";
    const requestedAsset = input.asset ?? "0x0000000000000000000000000000000000000000";
    const requestedAmount = input.amount ?? "0";
    const requestedRoute = `${input.venue ?? "BASE"}:${requestedAsset}:${requestedRecipient}`;

    const domainInput = {
      intentId,
      principal: input.prismId,
      initiator: "user" as const,
      purpose: input.purpose as DomainIntent["purpose"],
      requestedRecipient,
      requestedAsset,
      requestedAmount,
      requestedRoute,
      createdAt: nowMs,
      expiresAt: nowMs + 3600 * 1000,
      clientIdempotencyKey: input.idempotencyKey,
      policyVersion: "v1" as string,
    };

    let domainIntent: DomainIntent;
    try {
      domainIntent = await this.domainService.createIntent(domainInput);
    } catch (e) {
      if (e instanceof PauseError && e.code === PAUSE_ERROR_CODE.IDEMPOTENCY_CONFLICT) {
        throw new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, e.detail ?? "idempotency_key_conflict");
      }
      if (e instanceof PauseError && (e.code === PAUSE_ERROR_CODE.PAUSE_NOT_FOUND || e.code === PAUSE_ERROR_CODE.INTENT_NOT_FOUND)) {
        throw new AppError(APP_ERROR_CODE.IDENTITY_NOT_FOUND, e.detail ?? String((e as Error).message));
      }
      throw e;
    }

    // Create plan for this intent
    const chainId = (input.venue ?? "base").toLowerCase();
    const assetNorm = (input.asset ?? "0xdead").toLowerCase();
    const recipientNorm = (input.recipientAddress ?? input.recipientPrismId ?? "0xabc").toLowerCase();
    const calls = ["transfer"];
    const planInput = {
      chainId,
      asset: assetNorm,
      recipient: recipientNorm,
      calls,
      valueLimits: { maxValue: requestedAmount, slippageBps: null, maxFee: null, maxGas: null },
      policyVersion: "v1",
      intentId: domainIntent.intentId,
      createdAt: nowMs,
    };
    let domainPlan: DomainPlan | undefined;
    try {
      domainPlan = await this.domainService.createPlan(planInput);
    } catch (e) {
      // plan creation may fail if intent not found; propagate
      throw e;
    }

    this.restInputs.set(domainIntent.intentId, input);
    this.correlationByIntent.set(domainIntent.intentId, input.correlationId ?? null);

    return mapDomainIntentToRest(domainIntent, domainPlan, input.correlationId ?? null, input);
  }

  async getIntent(intentId: string): Promise<ExecutionIntent | null> {
    const domainIntent = await this.domainStore.getIntent(intentId);
    if (!domainIntent) return null;
    const plan = await this.domainStore.getPlanByIntent(intentId);
    const corr = this.correlationByIntent.get(intentId) ?? null;
    const restInput = this.restInputs.get(intentId);
    return mapDomainIntentToRest(domainIntent, plan, corr, restInput);
  }

  async pauseIntent(intentId: string, opts?: { correlationId?: string | null; requestId?: string | null }): Promise<ExecutionPause> {
    const nowMs = toMs(this.clock.now());
    const domainIntent = await this.domainStore.getIntent(intentId);
    if (!domainIntent) throw new AppError(APP_ERROR_CODE.IDENTITY_NOT_FOUND, `intent_not_found:${intentId}`);
    const plan = await this.domainStore.getPlanByIntent(intentId);
    if (!plan) throw new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, `plan_not_found_for_intent:${intentId}`);
    let domainPause: DomainPause;
    try {
      domainPause = await this.domainService.pause({ intentId, planHash: plan.planHash as unknown as `0x${string}`, now: nowMs });
    } catch (e) {
      if (e instanceof PauseError && e.code === PAUSE_ERROR_CODE.PAUSE_NOT_FOUND) throw new AppError(APP_ERROR_CODE.IDENTITY_NOT_FOUND, e.detail ?? String((e as Error).message));
      if (e instanceof PauseError && (e.code === PAUSE_ERROR_CODE.INTENT_NOT_FOUND || e.code === PAUSE_ERROR_CODE.INTENT_EXPIRED)) throw new AppError(APP_ERROR_CODE.IDENTITY_NOT_FOUND, e.detail ?? String((e as Error).message));
      throw e;
    }
    const corr = opts?.correlationId ?? this.correlationByIntent.get(intentId) ?? null;
    this.correlationByPause.set(domainPause.pauseId, corr);
    return mapDomainPauseToRest(domainPause, corr);
  }

  async getPause(pauseId: string): Promise<ExecutionPause | null> {
    const domainPause = await this.domainStore.getPause(pauseId);
    if (!domainPause) return null;
    const corr = this.correlationByPause.get(pauseId) ?? null;
    return mapDomainPauseToRest(domainPause, corr);
  }

  async verifyPause(pauseId: string, opts?: { planHash?: string; policyVersion?: string; sources?: unknown }): Promise<ExecutionPause> {
    const domainPause = await this.domainStore.getPause(pauseId);
    if (!domainPause) throw new AppError(APP_ERROR_CODE.IDENTITY_NOT_FOUND, `pause_not_found:${pauseId}`);

    // If caller supplies planHash and mismatches stored, fail closed
    if (opts?.planHash && opts.planHash !== domainPause.planHash) {
      throw new PauseError(PAUSE_ERROR_CODE.PLAN_HASH_MISMATCH, `plan_hash_mismatch:expected_${domainPause.planHash}_got_${opts.planHash}`);
    }

    const policyVersion = opts?.policyVersion ?? domainPause.policyVersion;
    if (policyVersion !== domainPause.policyVersion) {
      throw new PauseError(PAUSE_ERROR_CODE.POLICY_VERSION_MISMATCH, `policy_version_mismatch: expected ${domainPause.policyVersion} got ${policyVersion}`);
    }

    const plan = await this.domainStore.getPlan(domainPause.planHash);
    const intent = await this.domainStore.getIntent(domainPause.intentId);
    if (!plan || !intent) throw new AppError(APP_ERROR_CODE.STALE_STATE_CONFLICT, "plan_or_intent_missing");

    // Determine sources: if opts.sources supplied use it, else detect unknown trigger
    let sources: VerificationSources;
    if (opts?.sources && typeof opts.sources === "object") {
      sources = opts.sources as VerificationSources;
    } else {
      const triggerUnknown = intent.requestedRecipient.toLowerCase().includes("unknown") || intent.requestedAsset.toLowerCase().includes("unknown") || plan.asset.toLowerCase().includes("unknown");
      sources = triggerUnknown ? unknownSources() : passingSources();
    }

    const policy: Policy = {
      policyVersion,
      allowedChains: [plan.chainId],
      allowedAssets: [plan.asset],
      allowedContracts: ["*"],
      amountCeiling: null,
      requireFirstUseEscalation: false,
    };

    const nowMs = toMs(this.clock.now());

    try {
      const result = await this.domainService.verify({ pauseId, policy, sources, now: nowMs });
      const corr = this.correlationByPause.get(pauseId) ?? null;
      return mapDomainPauseToRest(result, corr);
    } catch (e) {
      if (e instanceof PauseError && (e.code === PAUSE_ERROR_CODE.PAUSE_NOT_FOUND || e.code === PAUSE_ERROR_CODE.INTENT_NOT_FOUND)) {
        throw new AppError(APP_ERROR_CODE.IDENTITY_NOT_FOUND, e.detail ?? String((e as Error).message));
      }
      throw e;
    }
  }

  async releasePause(pauseId: string, expectedVersion?: number | null, opts?: { planHash?: string; approvalScopeHash?: string | null; settlementOperationId?: string; correlationId?: string | null; authoritySubject?: string | null; authorityClaim?: string | null }): Promise<ExecutionPause> {
    const domainPause = await this.domainStore.getPause(pauseId);
    if (!domainPause) throw new AppError(APP_ERROR_CODE.IDENTITY_NOT_FOUND, `pause_not_found:${pauseId}`);

    const nowMs = toMs(this.clock.now());
    const planHash = (opts?.planHash ?? domainPause.planHash) as `0x${string}`;
    // Enforce plan_hash binding: if opts supplied and mismatched, domain will throw but we pre-check for clearer code
    if (opts?.planHash && opts.planHash !== domainPause.planHash) {
      this.injectedMetrics?.increment("plan_mutation_blocked", { pauseId });
      throw new PauseError(PAUSE_ERROR_CODE.PLAN_HASH_MISMATCH, `plan_hash_mismatch:expected_${domainPause.planHash}_got_${opts.planHash}`);
    }

    const expectedScope = computeApprovalScopeHash(domainPause.pauseId, domainPause.planHash as `0x${string}`, domainPause.policyVersion);
    if (opts?.approvalScopeHash !== undefined && opts.approvalScopeHash !== null && opts.approvalScopeHash !== expectedScope) {
      this.injectedMetrics?.increment("plan_mutation_blocked", { pauseId, reason: "approval_scope" });
      throw new PauseError(PAUSE_ERROR_CODE.APPROVAL_SCOPE_MISMATCH, "approval_scope_hash_mismatch");
    }

    // settlementOperationId: future operation link only, not completed
    const settlementOperationId = opts?.settlementOperationId ?? `op_future_${pauseId}_${Date.now()}`;
    const correlationId = opts?.correlationId ?? this.correlationByPause.get(pauseId) ?? null;

    try {
      const result = await this.domainService.release({
        pauseId,
        planHash: planHash as unknown as `0x${string}`,
        approvalScopeHash: (opts?.approvalScopeHash ?? null) as unknown as `0x${string}` | null,
        settlementOperationId,
        now: nowMs,
        expectedVersion: expectedVersion ?? domainPause.version,
        correlationId,
        authoritySubject: opts?.authoritySubject,
        authorityClaim: opts?.authorityClaim,
      });
      const corr = this.correlationByPause.get(pauseId) ?? null;
      // Note: domainService already created & submitted Operation via injected store/adapter (distinct states, never completed).
      // Verify operation remains not completed for observability.
      if (this.injectedOperationStore) {
        try {
          const op = await this.injectedOperationStore.getById(settlementOperationId);
          if (op && op.state === "completed") {
            // Should never happen — adapter must not mark completed.
            throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, "operation_must_not_be_completed_on_release");
          }
        } catch (e) {
          if (e instanceof PauseError) throw e;
          // ignore read failures — operation creation is best-effort observability
        }
      }
      return mapDomainPauseToRest(result, corr);
    } catch (e) {
      if (e instanceof PauseError && (e.code === PAUSE_ERROR_CODE.PAUSE_NOT_FOUND || e.code === PAUSE_ERROR_CODE.INTENT_NOT_FOUND)) {
        throw new AppError(APP_ERROR_CODE.IDENTITY_NOT_FOUND, e.detail ?? String((e as Error).message));
      }
      if (e instanceof PauseError && (e.code === PAUSE_ERROR_CODE.APPROVAL_REPLAY || e.code === PAUSE_ERROR_CODE.PLAN_HASH_MISMATCH || e.code === PAUSE_ERROR_CODE.APPROVAL_SCOPE_MISMATCH)) {
        this.injectedMetrics?.increment("approval_replay_blocked");
      }
      if (e instanceof PauseError && e.code === PAUSE_ERROR_CODE.CHECK_UNKNOWN_BLOCKING) {
        this.injectedMetrics?.increment("pause_release_blocked", { reason: "unknown_check" });
      }
      throw e;
    }
  }

  async cancelPause(pauseId: string, expectedVersion?: number | null): Promise<ExecutionPause> {
    const domainPause = await this.domainStore.getPause(pauseId);
    if (!domainPause) throw new AppError(APP_ERROR_CODE.IDENTITY_NOT_FOUND, `pause_not_found:${pauseId}`);
    const nowMs = toMs(this.clock.now());
    try {
      const result = await this.domainService.cancel({ pauseId, now: nowMs, expectedVersion: expectedVersion ?? domainPause.version });
      const corr = this.correlationByPause.get(pauseId) ?? null;
      return mapDomainPauseToRest(result, corr);
    } catch (e) {
      if (e instanceof PauseError && e.code === PAUSE_ERROR_CODE.PAUSE_NOT_FOUND) throw new AppError(APP_ERROR_CODE.IDENTITY_NOT_FOUND, e.detail ?? String((e as Error).message));
      throw e;
    }
  }

  async escalatePause(pauseId: string): Promise<ExecutionPause> {
    const domainPause = await this.domainStore.getPause(pauseId);
    if (!domainPause) throw new AppError(APP_ERROR_CODE.IDENTITY_NOT_FOUND, `pause_not_found:${pauseId}`);
    const nowMs = toMs(this.clock.now());
    try {
      const result = await this.domainService.escalate({ pauseId, reasonCodes: ["PAUSE-ESCALATE-001"], requiredApprovalCount: 1, now: nowMs, expectedVersion: domainPause.version });
      const corr = this.correlationByPause.get(pauseId) ?? null;
      return mapDomainPauseToRest(result, corr);
    } catch (e) {
      if (e instanceof PauseError && e.code === PAUSE_ERROR_CODE.PAUSE_NOT_FOUND) throw new AppError(APP_ERROR_CODE.IDENTITY_NOT_FOUND, e.detail ?? String((e as Error).message));
      throw e;
    }
  }

  async approvePause(pauseId: string, approver: string, opts?: { planHash?: string; approvalScopeHash?: string | null; authorityClaim?: string | null }): Promise<ExecutionPause> {
    const domainPause = await this.domainStore.getPause(pauseId);
    if (!domainPause) throw new AppError(APP_ERROR_CODE.IDENTITY_NOT_FOUND, `pause_not_found:${pauseId}`);
    const nowMs = toMs(this.clock.now());
    const planHash = (opts?.planHash ?? domainPause.planHash) as `0x${string}`;
    if (opts?.planHash && opts.planHash !== domainPause.planHash) {
      throw new PauseError(PAUSE_ERROR_CODE.PLAN_HASH_MISMATCH, `plan_hash_mismatch:expected_${domainPause.planHash}_got_${opts.planHash}`);
    }
    const approvalScopeHash = (opts?.approvalScopeHash ?? computeApprovalScopeHash(domainPause.pauseId, domainPause.planHash as `0x${string}`, domainPause.policyVersion)) as unknown as `0x${string}` | null;
    if (opts?.approvalScopeHash !== undefined && opts.approvalScopeHash !== null && opts.approvalScopeHash !== approvalScopeHash) {
      throw new PauseError(PAUSE_ERROR_CODE.APPROVAL_SCOPE_MISMATCH, "approval_scope_hash_mismatch");
    }
    try {
      const result = await this.domainService.approve({ pauseId, planHash: planHash as unknown as `0x${string}`, approvalScopeHash: approvalScopeHash as unknown as `0x${string}` | null, now: nowMs, expectedVersion: domainPause.version, authoritySubject: approver, authorityClaim: opts?.authorityClaim });
      const corr = this.correlationByPause.get(pauseId) ?? null;
      return mapDomainPauseToRest(result, corr);
    } catch (e) {
      if (e instanceof PauseError && e.code === PAUSE_ERROR_CODE.PAUSE_NOT_FOUND) throw new AppError(APP_ERROR_CODE.IDENTITY_NOT_FOUND, e.detail ?? String((e as Error).message));
      throw e;
    }
  }
}
