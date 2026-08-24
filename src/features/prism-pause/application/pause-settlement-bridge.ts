// P5 settlement bridge — links RELEASED Pause to durable Operation without marking completed.
// Sequence per PRISM_PAUSE_PHASE_PLAN.md P5:
//   Pause RELEASED -> create Operation row -> attach plan_hash/pause_id -> submit via adapter
// Never: RELEASED -> COMPLETED, simulation -> COMPLETED, wallet_accepted -> SETTLED
// Adapters are injectable; no live chain call. Distinct operation states remain distinct
// (submitted/processing/confirming/confirmed/indexed/reconciled/completed).

import type { PauseStore } from "../ports/pause-store";
import type { ExecutionPause } from "../domain/pause";
import type { ExecutionPlan } from "../domain/execution-plan";
import type { PauseMetrics } from "../ports/metrics";
import type { OperationStore } from "../../prism-operations/domain/operation-store";
import type { PauseExecutionAdapter, SettlementChain } from "../ports/execution-adapter";
import { resolveChainFromPlan } from "../ports/execution-adapter";
import { PauseError, PAUSE_ERROR_CODE } from "../domain/errors";
import { TERMINAL_FAILURE_STATES, TERMINAL_STATES } from "../../prism-operations/domain/operation";

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

export class PauseSettlementBridge {
  constructor(private readonly opts: PauseSettlementBridgeOptions) {}

  private assertExistingOperationUsable(operation: import("../../prism-operations/domain/operation-store").PersistedOperation): void {
    // A completed operation may be returned only as an idempotent readback of
    // the same already-linked RELEASED pause. Other terminal states can never
    // be submitted again or linked during a retry.
    if (NON_REUSABLE_OPERATION_STATES.has(operation.state) && operation.state !== "completed") {
      throw new PauseError(PAUSE_ERROR_CODE.OPERATION_NOT_REUSABLE, `settlement_operation_terminal:${operation.state}`);
    }
  }

  private metrics(): PauseMetrics | undefined { return this.opts.metrics; }
  private nowMs(): number { return this.opts.now ? this.opts.now() : Date.now(); }

  /**
   * After a pause is RELEASED (settlementOperationId links future operation),
   * create the durable Operation row idempotently and advance it to submitted
   * via the injected chain adapter. Never marks completed.
   * Returns the submitted Operation.
   */
  async createAndSubmitSettlement(input: {
    pause: ExecutionPause;
    plan: ExecutionPlan;
    operationId: string;
    correlationId?: string | null;
    kind?: string;
  }): Promise<import("../../prism-operations/domain/operation-store").PersistedOperation> {
    const { pause, plan, operationId, correlationId, kind } = input;
    if (pause.state !== "RELEASED") throw new PauseError(PAUSE_ERROR_CODE.RELEASE_NOT_READY, `settlement_bridge requires RELEASED, got ${pause.state}`);
    if (pause.settlementOperationId !== operationId) throw new PauseError(PAUSE_ERROR_CODE.PLAN_HASH_MISMATCH, `settlementOperationId mismatch expected ${pause.settlementOperationId} got ${operationId}`);
    if (pause.planHash !== plan.planHash) throw new PauseError(PAUSE_ERROR_CODE.PLAN_HASH_MISMATCH, "planHash mismatch bridge");

    const fingerprint = `${pause.planHash}:${pause.policyVersion}:${pause.pauseId}`;
    const idempotencyKey = `pause_settlement:${pause.pauseId}:${pause.planHash}`;
    const now = this.nowMs();

    // Idempotent create: same key + same fingerprint returns existing; different fingerprint conflicts.
    let op = await this.opts.operationStore.getById(operationId);
    if (op) {
      if (op.idempotencyKey !== idempotencyKey || op.requestFingerprint !== fingerprint) {
        throw new PauseError(PAUSE_ERROR_CODE.IDEMPOTENCY_CONFLICT, `settlement_operation_id_conflict:${operationId}`);
      }
    }
    if (!op) {
      const existingByKey = await this.opts.operationStore.getByIdempotencyKey(idempotencyKey);
      if (existingByKey) {
        if (existingByKey.requestFingerprint !== fingerprint) {
          throw new PauseError(PAUSE_ERROR_CODE.IDEMPOTENCY_CONFLICT, `settlement idempotency fingerprint mismatch for ${operationId}`);
        }
        op = existingByKey;
        // if existing op id differs, still use existing
        if (existingByKey.id !== operationId) {
          // operationId derived from pause's settlementOperationId must match the idempotent key owner
          throw new PauseError(PAUSE_ERROR_CODE.OPERATION_ALREADY_LINKED, `settlement idempotency maps to ${existingByKey.id} not ${operationId}`);
        }
        this.assertExistingOperationUsable(op);
      } else {
        op = await this.opts.operationStore.create({
          id: operationId,
          kind: kind ?? `pause_settlement:${resolveChainFromPlan(plan)}`,
          idempotencyKey,
          requestFingerprint: fingerprint,
          now,
          correlationId: correlationId ?? null,
        });
        this.metrics()?.increment("settlement_operation_created", { chain: resolveChainFromPlan(plan) });
      }
    }

    this.assertExistingOperationUsable(op);

    // If already submitted or beyond, idempotent return (distinct states preserved)
    if (["submitted", "processing", "confirming", "confirmed", "indexed", "reconciled", "completed"].includes(op.state)) {
      return op;
    }

    const chain = resolveChainFromPlan(plan);
    const adapter = this.opts.adapters.get(chain);
    if (!adapter) throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, `no_adapter_for_chain:${chain}`);
    const submitted = await adapter.submit({ operation: op, pause, plan, correlationId: correlationId ?? null, operationId });
    if (submitted.id !== op.id || submitted.id !== operationId) throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, "adapter_operation_id_mismatch");
    // Never auto-complete: guard that adapter did not jump to completed and
    // did return a post-submit lifecycle state.
    if (submitted.state === "completed") throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, "adapter_must_not_mark_completed");
    if (!["submitted", "processing", "confirming", "confirmed", "indexed", "reconciled"].includes(submitted.state)) {
      throw new PauseError(PAUSE_ERROR_CODE.INVALID_STATE, `adapter_submit_returned_invalid_state:${submitted.state}`);
    }
    this.metrics()?.increment("settlement_operation_submitted", { chain });
    return submitted;
  }
}
