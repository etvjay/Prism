// P5 settlement adapter boundary — injectable ports for Starknet / Base / STRK20.
// No live chain call; adapters only mark durable Operation rows as submitted.
// Distinct states remain distinct: RELEASED -> Operation {created -> submitted}
// never jumps to confirming/confirmed/indexed/reconciled/completed without
// explicit transitions (operation domain guards submitted != completed).

import type { PersistedOperation } from "../../prism-operations/domain/operation-store";
import type { ExecutionPause } from "../domain/pause";
import type { ExecutionPlan } from "../domain/execution-plan";

export type SettlementChain = "starknet" | "base" | "strk20";

export interface SettlementSubmissionInput {
  readonly operation: PersistedOperation;
  readonly pause: ExecutionPause;
  readonly plan: ExecutionPlan;
  readonly correlationId: string | null;
  readonly operationId: string;
}

export interface PauseExecutionAdapter {
  readonly chain: SettlementChain;
  /** Submit marks operation as submitted (creates txHash) without completing it. Must never mark completed. */
  submit(input: SettlementSubmissionInput): Promise<PersistedOperation>;
}

export interface PauseSettlementPort {
  /** Create durable Operation row for RELEASED pause; never marks completed. */
  createSettlementOperation(input: {
    pause: ExecutionPause;
    plan: ExecutionPlan;
    correlationId: string | null;
    operationId: string;
    kind?: string;
  }): Promise<PersistedOperation>;
  /** Advance created -> submitted via injected chain adapter (no live RPC). */
  submitToChain(input: SettlementSubmissionInput & { adapter: PauseExecutionAdapter }): Promise<PersistedOperation>;
}

export function resolveChainFromPlan(plan: ExecutionPlan): SettlementChain {
  const cid = plan.chainId.toLowerCase();
  if (cid.includes("starknet") || cid.includes("sn_")) return "starknet";
  if (cid.includes("strk20") || cid.includes("privacy")) return "strk20";
  return "base";
}
