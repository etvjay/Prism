// Deterministic recovery/reconciliation boundary tests.
// No DB or RPC I/O; exercises pure policy plus worker fail-closed rules.

import { describe, it, expect } from "vitest";
import { transition, createOperation, AUTHORITATIVE_SOURCE, type Hex, type OperationState } from "../domain/operation";
import type { PersistedOperation } from "../domain/operation-store";
import { tickReconciliation, recoverNonTerminalOperations, isWatermarkStale } from "../domain/recovery";
import type { OperationStore } from "../domain/operation-store";
import type { OperationReconciliationPort } from "../domain/ports";

const TX_HASH: Hex = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TX_HASH_2: Hex = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const NOW = 1_789_000_000;

// In-memory fake store for recovery tests — implements only what tick needs.
class FakeOperationStore implements OperationStore {
  private readonly rows = new Map<string, PersistedOperation>();
  byKey = new Map<string, string>();

  async create(input: { id: string; idempotencyKey: string; requestFingerprint: string; now: number; kind?: string; correlationId?: string | null }): Promise<PersistedOperation> {
    if (this.byKey.has(input.idempotencyKey)) {
      const existingId = this.byKey.get(input.idempotencyKey)!;
      const existing = this.rows.get(existingId)!;
      if (existing.requestFingerprint !== input.requestFingerprint) {
        const { OperationError, OPERATION_ERROR_CODE } = await import("../domain/errors");
        throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "idempotency_key_conflict");
      }
      return existing;
    }
    const base = createOperation({ id: input.id, kind: input.kind, now: input.now, correlationId: input.correlationId ?? null });
    const rec: PersistedOperation = {
      ...base,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.requestFingerprint,
      reconciliationWatermark: null,
      reconciliationMetadata: null,
    };
    this.rows.set(rec.id, rec);
    this.byKey.set(rec.idempotencyKey, rec.id);
    return rec;
  }

  async getById(id: string) {
    const r = this.rows.get(id);
    return r ? { ...r } : undefined;
  }
  async getByIdempotencyKey(key: string) {
    const id = this.byKey.get(key);
    if (!id) return undefined;
    return this.getById(id);
  }
  async transition(id: string, input: { to: OperationState; now: number; expectedVersion: number; txHash?: Hex | null; errorCode?: string | null; errorDetail?: string | null; reconciliationWatermark?: number | null; reconciliationMetadata?: Record<string, unknown> | null }): Promise<PersistedOperation> {
    const current = this.rows.get(id);
    if (!current) {
      const { OperationError, OPERATION_ERROR_CODE } = await import("../domain/errors");
      throw new OperationError(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT, "unknown_operation");
    }
    const { transition: domTransition } = await import("../domain/operation");
    const result = domTransition(current, {
      to: input.to,
      now: input.now,
      expectedVersion: input.expectedVersion,
      txHash: input.txHash ?? undefined,
      errorCode: input.errorCode ?? undefined,
      errorDetail: input.errorDetail ?? undefined,
    });
    if (result.idempotent) return current;
    const next: PersistedOperation = {
      ...result.operation,
      idempotencyKey: current.idempotencyKey,
      requestFingerprint: current.requestFingerprint,
      reconciliationWatermark: input.reconciliationWatermark ?? current.reconciliationWatermark,
      reconciliationMetadata: input.reconciliationMetadata ?? current.reconciliationMetadata,
    };
    this.rows.set(id, next);
    return next;
  }
  async listNonTerminal(): Promise<readonly PersistedOperation[]> {
    const terminal = new Set(["completed", "failed_terminal", "cancelled", "expired", "reverted"]);
    return Array.from(this.rows.values()).filter((r) => !terminal.has(r.state));
  }
  async close() {}
  // test helper: inject raw state
  inject(record: PersistedOperation) {
    this.rows.set(record.id, record);
    this.byKey.set(record.idempotencyKey, record.id);
  }
}

function advance(store: FakeOperationStore, id: string, to: OperationState, patch: Partial<{ txHash: Hex | null; errorCode: string | null; now: number }> = {}) {
  return store.transition(id, {
    to,
    now: patch.now ?? NOW + 10,
    expectedVersion: store["rows"].get(id)!.version,
    txHash: patch.txHash ?? undefined,
    errorCode: patch.errorCode ?? undefined,
  });
}

function staticPort(overrides: Partial<OperationReconciliationPort> = {}): OperationReconciliationPort {
  return {
    async observeChain(txHash: Hex) {
      return { txHash, finality: "ACCEPTED_ON_L2", execution: "SUCCEEDED", blockNumber: 100 } as never;
    },
    async observeIndexer(txHash: Hex) {
      return { txHash, eventObserved: true, eventName: "ExecutionIdentityBound", blockNumber: 101, eventIndex: 0 } as never;
    },
    async observeReconciliation(txHash: Hex) {
      return { chainReceiptMatched: true, eventMatchedToOperation: true, matchedTxHash: txHash } as never;
    },
    ...overrides,
  };
}

describe("recovery / reconciliation boundary (deterministic, fail-closed)", () => {
  it("submitted with unknown chain state does not advance (fail-closed)", async () => {
    const store = new FakeOperationStore();
    let op = await store.create({ id: "op-1", idempotencyKey: "idem-1", requestFingerprint: "fp-1", now: NOW });
    op = await store.transition(op.id, { to: "awaiting_authorization", now: NOW + 1, expectedVersion: 0 });
    op = await store.transition(op.id, { to: "ready", now: NOW + 2, expectedVersion: 1 });
    op = await store.transition(op.id, { to: "submitted", now: NOW + 3, expectedVersion: 2, txHash: TX_HASH });
    const port: OperationReconciliationPort = {
      async observeChain() {
        return null;
      },
      async observeIndexer() {
        return null;
      },
      async observeReconciliation() {
        return null;
      },
    };
    const result = await tickReconciliation(store, port, op.id, NOW + 10);
    expect(result.advanced).toBe(false);
    expect(result.reason).toMatch(/awaiting_chain/);
    const still = await store.getById(op.id);
    expect(still!.state).toBe("submitted");
  });

  it("never marks submitted as completed even if port fabricates completed facts", async () => {
    const store = new FakeOperationStore();
    let op = await store.create({ id: "op-2", idempotencyKey: "idem-2", requestFingerprint: "fp-2", now: NOW });
    op = await store.transition(op.id, { to: "awaiting_authorization", now: NOW + 1, expectedVersion: 0 });
    op = await store.transition(op.id, { to: "ready", now: NOW + 2, expectedVersion: 1 });
    op = await store.transition(op.id, { to: "submitted", now: NOW + 3, expectedVersion: 2, txHash: TX_HASH });
    // Port claims reconciliation already matched — pure policy should still only advance one hop (to processing), never to completed.
    const result = await tickReconciliation(store, staticPort(), op.id, NOW + 10);
    expect(result.advanced).toBe(true);
    expect(result.toState).toBe("processing");
    expect(result.toState).not.toBe("completed");
    // Second tick should go to confirming, not completed.
    const result2 = await tickReconciliation(store, staticPort(), op.id, NOW + 11);
    expect(result2.toState).toBe("confirming");
  });

  it("confirmed with indexer event advances to indexed, then reconciled, then completed stepwise", async () => {
    const store = new FakeOperationStore();
    let op = await store.create({ id: "op-3", idempotencyKey: "idem-3", requestFingerprint: "fp-3", now: NOW });
    for (const [to, v] of [
      ["awaiting_authorization" as OperationState, 0],
      ["ready" as OperationState, 1],
      ["submitted" as OperationState, 2],
      ["processing" as OperationState, 3],
      ["confirming" as OperationState, 4],
      ["confirmed" as OperationState, 5],
    ] as const) {
      op = await store.transition(op.id, {
        to,
        now: NOW + v + 1,
        expectedVersion: v,
        txHash: to === "submitted" ? TX_HASH : undefined,
      });
    }
    expect(op.state).toBe("confirmed");
    const r1 = await tickReconciliation(store, staticPort(), op.id, NOW + 20);
    expect(r1.toState).toBe("indexed");
    const r2 = await tickReconciliation(store, staticPort(), op.id, NOW + 21);
    expect(r2.toState).toBe("reconciled");
    const r3 = await tickReconciliation(store, staticPort(), op.id, NOW + 22);
    expect(r3.toState).toBe("completed");
    expect(r3.advanced).toBe(true);
  });

  it("reverted from chain is mapped to reverted state via policy", async () => {
    const store = new FakeOperationStore();
    let op = await store.create({ id: "op-4", idempotencyKey: "idem-4", requestFingerprint: "fp-4", now: NOW });
    op = await store.transition(op.id, { to: "awaiting_authorization", now: NOW + 1, expectedVersion: 0 });
    op = await store.transition(op.id, { to: "ready", now: NOW + 2, expectedVersion: 1 });
    op = await store.transition(op.id, { to: "submitted", now: NOW + 3, expectedVersion: 2, txHash: TX_HASH });
    op = await store.transition(op.id, { to: "processing", now: NOW + 4, expectedVersion: 3 });
    const port: OperationReconciliationPort = {
      async observeChain(txHash) {
        return { txHash, finality: "ACCEPTED_ON_L2", execution: "REVERTED", revertCode: "ERR-007", blockNumber: 100 } as never;
      },
      async observeIndexer() {
        return null;
      },
      async observeReconciliation() {
        return null;
      },
    };
    const result = await tickReconciliation(store, port, op.id, NOW + 10);
    expect(result.toState).toBe("reverted");
    expect(result.advanced).toBe(true);
  });

  it("dependency failure (observe throws) is fail-closed with no state change", async () => {
    const store = new FakeOperationStore();
    let op = await store.create({ id: "op-5", idempotencyKey: "idem-5", requestFingerprint: "fp-5", now: NOW });
    op = await store.transition(op.id, { to: "awaiting_authorization", now: NOW + 1, expectedVersion: 0 });
    op = await store.transition(op.id, { to: "ready", now: NOW + 2, expectedVersion: 1 });
    op = await store.transition(op.id, { to: "submitted", now: NOW + 3, expectedVersion: 2, txHash: TX_HASH });
    const port: OperationReconciliationPort = {
      async observeChain() {
        throw new Error("rpc_unavailable");
      },
      async observeIndexer() {
        return null;
      },
      async observeReconciliation() {
        return null;
      },
    };
    const result = await tickReconciliation(store, port, op.id, NOW + 10);
    expect(result.dependencyFailure).toBe(true);
    expect(result.advanced).toBe(false);
    const still = await store.getById(op.id);
    expect(still!.state).toBe("submitted");
  });

  it("mismatched txHash is treated as awaiting (no advance, fail-closed)", async () => {
    const store = new FakeOperationStore();
    let op = await store.create({ id: "op-6", idempotencyKey: "idem-6", requestFingerprint: "fp-6", now: NOW });
    op = await store.transition(op.id, { to: "awaiting_authorization", now: NOW + 1, expectedVersion: 0 });
    op = await store.transition(op.id, { to: "ready", now: NOW + 2, expectedVersion: 1 });
    op = await store.transition(op.id, { to: "submitted", now: NOW + 3, expectedVersion: 2, txHash: TX_HASH });
    const port: OperationReconciliationPort = {
      async observeChain() {
        return { txHash: TX_HASH_2, finality: "ACCEPTED_ON_L2", execution: "SUCCEEDED", blockNumber: 100 } as never;
      },
      async observeIndexer() {
        return null;
      },
      async observeReconciliation() {
        return null;
      },
    };
    const result = await tickReconciliation(store, port, op.id, NOW + 10);
    expect(result.advanced).toBe(false);
    expect(result.reason).toMatch(/awaiting/);
  });

  it("recoverNonTerminalOperations sweeps created/ready/submitted without marking submitted completed", async () => {
    const store = new FakeOperationStore();
    const opA = await store.create({ id: "op-a", idempotencyKey: "idem-a", requestFingerprint: "fp-a", now: NOW });
    let opB = await store.create({ id: "op-b", idempotencyKey: "idem-b", requestFingerprint: "fp-b", now: NOW });
    opB = await store.transition(opB.id, { to: "awaiting_authorization", now: NOW + 1, expectedVersion: 0 });
    opB = await store.transition(opB.id, { to: "ready", now: NOW + 2, expectedVersion: 1 });
    opB = await store.transition(opB.id, { to: "submitted", now: NOW + 3, expectedVersion: 2, txHash: TX_HASH });
    const port: OperationReconciliationPort = {
      async observeChain(txHash) {
        // only submitted op has tx; return null to exercise fail-closed path
        if (txHash === TX_HASH) return null;
        return null;
      },
      async observeIndexer() {
        return null;
      },
      async observeReconciliation() {
        return null;
      },
    };
    const sweep = await recoverNonTerminalOperations(store, port, NOW + 20, 10);
    expect(sweep.swept).toBe(2);
    expect(sweep.advanced).toBe(0);
    const stillB = await store.getById(opB.id);
    expect(stillB!.state).not.toBe("completed");
    expect(stillB!.state).toBe("submitted");
  });

  it("isWatermarkStale respects confirmedBlock - K bound", () => {
    expect(isWatermarkStale(null, 100, 10)).toBe(true);
    expect(isWatermarkStale(95, 100, 10)).toBe(false); // 95 >= 90
    expect(isWatermarkStale(89, 100, 10)).toBe(true); // 89 < 90
    expect(isWatermarkStale(100, 100, 0)).toBe(false);
    expect(isWatermarkStale(99, 100, 0)).toBe(true);
  });

  it("terminal states are noops in tick", async () => {
    const store = new FakeOperationStore();
    let op = await store.create({ id: "op-term", idempotencyKey: "idem-term", requestFingerprint: "fp-term", now: NOW });
    // fast-forward to completed via pure policy steps (reuse staticPort)
    for (const to of [
      "awaiting_authorization",
      "ready",
      "submitted",
      "processing",
      "confirming",
      "confirmed",
      "indexed",
      "reconciled",
      "completed",
    ] as OperationState[]) {
      op = await store.transition(op.id, {
        to,
        now: NOW + op.version + 1,
        expectedVersion: op.version,
        txHash: to === "submitted" ? TX_HASH : undefined,
      });
    }
    expect(op.state).toBe("completed");
    const result = await tickReconciliation(store, staticPort(), op.id, NOW + 100);
    expect(result.advanced).toBe(false);
    expect(result.reason).toContain("terminal");
  });
});
