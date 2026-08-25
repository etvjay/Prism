// Fake execution adapters — deterministic, no network.
// Each adapter transitions Operation created -> submitted via operationStore.transition
// with a deterministic fake txHash (0x + 64 hex). They never transition beyond
// submitted; confirming/confirmed/indexed/reconciled/completed remain distinct
// and require explicit reconciliation calls (not provided here).

import type { PauseExecutionAdapter, SettlementChain, SettlementSubmissionInput } from "../ports/execution-adapter";
import type { OperationStore } from "../../prism-operations/domain/operation-store";
import type { Hex } from "../../prism-operations/domain/operation";

function fakeTxHash(chain: SettlementChain, operationId: string): Hex {
  // deterministic fake: sha-like padding, never a real broadcast
  const base = `${chain}:${operationId}`.padEnd(64, "0").slice(0, 64);
  // hex encode ascii bytes then pad
  let hex = "";
  for (let i = 0; i < base.length; i++) hex += base.charCodeAt(i).toString(16).padStart(2, "0");
  hex = hex.slice(0, 64).padEnd(64, "0");
  return `0x${hex}` as Hex;
}

abstract class FakeBaseAdapter implements PauseExecutionAdapter {
  constructor(
    public readonly chain: SettlementChain,
    protected readonly operationStore: OperationStore,
  ) {}

  async submit(input: SettlementSubmissionInput): Promise<import("../../prism-operations/domain/operation-store").PersistedOperation> {
    // Enforce operation is in created/ready before submitted; allow created -> submitted directly for settlement slice
    // Operation domain requires ready -> submitted, but settlement helper may be created -> submitted.
    // To honor SM-PRISM-003 without bypassing, we transition created->ready->submitted stepwise.
    const opId = input.operation.id;
    let cur = await this.operationStore.getById(opId);
    if (!cur) throw new Error(`operation_not_found:${opId}`);
    const txHash = fakeTxHash(this.chain, opId);
    const now = Date.now();
    // created -> awaiting_authorization -> ready -> submitted is the legal path.
    // For settlement we use a trimmed path: created -> ready -> submitted via intermediate steps.
    if (cur.state === "created") {
      cur = await this.operationStore.transition(opId, { to: "awaiting_authorization", now, expectedVersion: cur.version });
      cur = await this.operationStore.transition(opId, { to: "ready", now, expectedVersion: cur.version });
    } else if (cur.state === "awaiting_authorization") {
      cur = await this.operationStore.transition(opId, { to: "ready", now, expectedVersion: cur.version });
    }
    if (cur.state !== "ready" && cur.state !== "requires_attention") {
      // already beyond ready — attempt submitted idempotently if already submitted
      if (["submitted", "processing", "confirming", "confirmed", "indexed", "reconciled", "completed"].includes(cur.state)) {
        return cur;
      }
      throw new Error(`operation_not_ready_for_submit:state=${cur.state}`);
    }
    if (cur.state === "requires_attention" && !cur.submissionAttempted) {
      throw new Error("operation_requires_attention_without_submission_fence");
    }
    const submitted = await this.operationStore.transition(opId, {
      to: "submitted",
      now,
      expectedVersion: cur.version,
      txHash,
    });
    // Never auto-advance to confirming/confirmed/indexed/reconciled/completed — distinct states remain distinct.
    return submitted;
  }
}

export class FakeStarknetAdapter extends FakeBaseAdapter {
  constructor(operationStore: OperationStore) { super("starknet", operationStore); }
}
export class FakeBaseAdapterImpl extends FakeBaseAdapter {
  constructor(operationStore: OperationStore) { super("base", operationStore); }
}
export class FakeStrk20Adapter extends FakeBaseAdapter {
  constructor(operationStore: OperationStore) { super("strk20", operationStore); }
}

export function createFakeAdapterRegistry(operationStore: OperationStore): Map<SettlementChain, PauseExecutionAdapter> {
  return new Map<SettlementChain, PauseExecutionAdapter>([
    ["starknet", new FakeStarknetAdapter(operationStore)],
    ["base", new FakeBaseAdapterImpl(operationStore)],
    ["strk20", new FakeStrk20Adapter(operationStore)],
  ]);
}
