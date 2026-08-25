// P5 settlement bridge — links RELEASED Pause to durable Operation without marking completed.
// The caller may provide a pause/plan snapshot for compatibility, but those
// values are never authoritative. This bridge reloads the Pause, Plan, Intent,
// and release Decision from the injected PauseStore before any adapter call.

import type { PauseStore } from "../ports/pause-store";
import type { ExecutionPause } from "../domain/pause";
import { computeApprovalScopeHash } from "../domain/pause";
import type { ExecutionPlan } from "../domain/execution-plan";
import { verifyPlanHash } from "../domain/execution-plan";
import type { PauseMetrics } from "../ports/metrics";
import type { OperationStore, PersistedOperation } from "../../prism-operations/domain/operation-store";
import type { PauseExecutionAdapter, SettlementChain } from "../ports/execution-adapter";
import { resolveChainFromPlan } from "../ports/execution-adapter";
import { PauseError, PAUSE_ERROR_CODE } from "../domain/errors";
import { TERMINAL_FAILURE_STATES, TERMINAL_STATES } from "../../prism-operations/domain/operation";
import { invokeSettlementAdapter } from "./settlement-submission";

export interface PauseSettlementBridgeOptions {
  pauseStore: PauseStore;
  operationStore: OperationStore;
  adapters: Map<SettlementChain, PauseExecutionAdapter>;
  metrics?: PauseMetrics;
  now?: () => number;
}

const NON_REUSABLE_OPERATION_STATES: ReadonlySet<string> = new Set<string>([
  ...TERMINAL_STATES,
  ...TERMINAL_FAILURE_STATES,
]);

const POST_SUBMISSION_STATES = new Set<string>([
  "submitted",
  "processing",
  "confirming",
  "confirmed",
  "indexed",
  "reconciled",
  "completed",
]);

export class PauseSettlementBridge {
  constructor(private readonly opts: PauseSettlementBridgeOptions) {}

  private assertExistingOperationUsable(operation: PersistedOperation): void {
    // A completed operation is an idempotent readback only. Other terminal
    // states can never be submitted again or linked during a retry.
    if (NON_REUSABLE_OPERATION_STATES.has(operation.state) && operation.state !== "completed") {
      throw new PauseError(PAUSE_ERROR_CODE.OPERATION_NOT_REUSABLE, `settlement_operation_terminal:${operation.state}`);
    }
  }

  private metrics(): PauseMetrics | undefined { return this.opts.metrics; }
  private nowMs(): number { return this.opts.now ? this.opts.now() : Date.now(); }

  private async readAuthoritativePause(input: {
    pauseId: string;
    operationId: string;
  }): Promise<{ pause: ExecutionPause; plan: ExecutionPlan }> {
    const pause = await this.opts.pauseStore.getPause(input.pauseId);
    if (!pause) throw new PauseError(PAUSE_ERROR_CODE.PAUSE_NOT_FOUND, input.pauseId);
    if (pause.pauseId !== input.pauseId) throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, "durable_pause_id_mismatch");
    if (pause.state !== "RELEASED") {
      throw new PauseError(PAUSE_ERROR_CODE.RELEASE_NOT_READY, `settlement_bridge requires RELEASED, got ${pause.state}`);
    }
    if (!pause.settlementOperationId || pause.settlementOperationId !== input.operationId) {
      throw new PauseError(PAUSE_ERROR_CODE.OPERATION_ALREADY_LINKED, "settlement_operation_link_mismatch");
    }

    const plan = await this.opts.pauseStore.getPlan(pause.planHash);
    if (!plan || plan.planHash !== pause.planHash || plan.intentId !== pause.intentId || !verifyPlanHash(plan)) {
      throw new PauseError(PAUSE_ERROR_CODE.INVALID_PLAN, "durable_pause_plan_invalid");
    }
    const intent = await this.opts.pauseStore.getIntent(pause.intentId);
    if (!intent || intent.intentId !== plan.intentId || intent.policyVersion !== pause.policyVersion || plan.policyVersion !== pause.policyVersion) {
      throw new PauseError(PAUSE_ERROR_CODE.INTENT_NOT_FOUND, "durable_pause_authority_snapshot_invalid");
    }

    const decisions = await this.opts.pauseStore.getDecisions(pause.pauseId);
    const expectedScope = computeApprovalScopeHash(pause.pauseId, pause.planHash, pause.policyVersion);
    const releaseDecision = decisions.find((decision) =>
      decision.kind === "RELEASE" &&
      pause.decisionIds.includes(decision.decisionId),
    );
    if (
      !releaseDecision ||
      releaseDecision.pauseId !== pause.pauseId ||
      releaseDecision.planHash !== pause.planHash ||
      releaseDecision.policyVersion !== pause.policyVersion ||
      releaseDecision.approvalScopeHash !== expectedScope ||
      pause.approvalScopeHash !== expectedScope
    ) {
      throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, "durable_release_decision_missing_or_mismatched");
    }

    return { pause, plan };
  }

  /**
   * After a pause is RELEASED (settlementOperationId links a future
   * operation), create/read the durable Operation and invoke the adapter at
   * most once. The operation fence is persisted before invocation and adapter
   * return values are accepted only after durable readback.
   */
  async createAndSubmitSettlement(input: {
    /** Compatibility snapshot; only its pauseId is used. */
    pause?: ExecutionPause;
    /** Preferred durable identifier. */
    pauseId?: string;
    /** Compatibility snapshot; ignored in favor of PauseStore.getPlan. */
    plan?: ExecutionPlan;
    operationId: string;
    correlationId?: string | null;
    kind?: string;
  }): Promise<PersistedOperation> {
    const pauseId = input.pauseId ?? input.pause?.pauseId;
    if (!pauseId) throw new PauseError(PAUSE_ERROR_CODE.PAUSE_NOT_FOUND, "pause_id_required");
    const { pause, plan } = await this.readAuthoritativePause({ pauseId, operationId: input.operationId });

    const fingerprint = `${pause.planHash}:${pause.policyVersion}:${pause.pauseId}`;
    const idempotencyKey = `pause_settlement:${pause.pauseId}:${pause.planHash}`;
    const now = this.nowMs();

    // Idempotent create: same key + same fingerprint returns existing; a
    // different operation resource is a conflict with the durable pause link.
    let op = await this.opts.operationStore.getById(input.operationId);
    if (op) {
      if (op.idempotencyKey !== idempotencyKey || op.requestFingerprint !== fingerprint) {
        throw new PauseError(PAUSE_ERROR_CODE.IDEMPOTENCY_CONFLICT, `settlement_operation_id_conflict:${input.operationId}`);
      }
    }
    if (!op) {
      const existingByKey = await this.opts.operationStore.getByIdempotencyKey(idempotencyKey);
      if (existingByKey) {
        if (existingByKey.requestFingerprint !== fingerprint) {
          throw new PauseError(PAUSE_ERROR_CODE.IDEMPOTENCY_CONFLICT, `settlement idempotency fingerprint mismatch for ${input.operationId}`);
        }
        if (existingByKey.id !== input.operationId) {
          throw new PauseError(PAUSE_ERROR_CODE.OPERATION_ALREADY_LINKED, `settlement idempotency maps to ${existingByKey.id} not ${input.operationId}`);
        }
        op = existingByKey;
      } else {
        op = await this.opts.operationStore.create({
          id: input.operationId,
          kind: `pause_settlement:${resolveChainFromPlan(plan)}`,
          idempotencyKey,
          requestFingerprint: fingerprint,
          now,
          correlationId: input.correlationId ?? null,
        });
        try { this.metrics()?.increment("settlement_operation_created", { chain: resolveChainFromPlan(plan) }); } catch {}
      }
    }

    this.assertExistingOperationUsable(op);

    // A durable post-submit readback, including completed, is idempotent. A
    // fenced requires_attention row is poll-only and must not be rebroadcast.
    if (POST_SUBMISSION_STATES.has(op.state) || op.submissionAttempted && op.state === "requires_attention") {
      return op;
    }

    const chain = resolveChainFromPlan(plan);
    const adapter = this.opts.adapters.get(chain);
    if (!adapter) throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, `no_adapter_for_chain:${chain}`);

    const outcome = await invokeSettlementAdapter({
      operationStore: this.opts.operationStore,
      operation: op,
      pause,
      plan,
      adapter,
      chain,
      operationId: input.operationId,
      correlationId: input.correlationId ?? null,
      now,
    });
    if (outcome.quarantined) {
      try { this.metrics()?.increment("pause_release_blocked", { reason: "settlement_submit_quarantined" }); } catch {}
      throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, "settlement_submission_quarantined_poll_only");
    }
    if (outcome.adapterInvoked) {
      try { this.metrics()?.increment("settlement_operation_submitted", { chain }); } catch {}
    }
    return outcome.operation;
  }
}
