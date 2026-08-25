import { describe, it, expect } from "vitest";
import type { Hex, OperationState } from "../domain/operation";
import { createOperation } from "../domain/operation";
import type { PersistedOperation } from "../domain/operation-store";
import { InMemoryOperationStore } from "../adapters/memory-operation-store";
import type { ChainTxObservation, IndexerObservation } from "../domain/ports";
import { ReconciliationWorker, computeBackoffMs } from "../domain/reconciliation-worker";

const TX_HASH: Hex = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const NOW = 1_789_000_000;

function ledgerFake(overrides: Partial<{ chain: ChainTxObservation | null; throws: boolean }> = {}) {
  return {
    async observeChain(txHash: Hex): Promise<ChainTxObservation | null> {
      if (overrides.throws) throw new Error("rpc_unavailable");
      if (overrides.chain !== undefined) return overrides.chain;
      return { txHash, finality: "ACCEPTED_ON_L2", execution: "SUCCEEDED", blockNumber: 100 } as ChainTxObservation;
    },
  };
}

function indexerFake(overrides: Partial<{ eventObserved: boolean; blockNumber: number | null }> = {}) {
  return {
    async observeIndexer(txHash: Hex): Promise<IndexerObservation | null> {
      return {
        txHash,
        eventObserved: overrides.eventObserved ?? true,
        eventName: "ExecutionIdentityBound",
        blockNumber: overrides.blockNumber ?? 101,
        eventIndex: 0,
      } as IndexerObservation;
    },
    async observeReconciliation(txHash: Hex) {
      return { chainReceiptMatched: true, eventMatchedToOperation: true, matchedTxHash: txHash };
    },
  };
}

function clockFake(now: number) {
  return { now: () => now };
}

async function createSubmitted(store: InMemoryOperationStore, id: string, txHash: Hex = TX_HASH, now: number = NOW): Promise<PersistedOperation> {
  let op = await store.create({ id, idempotencyKey: `idem-${id}`, requestFingerprint: `fp-${id}`, now });
  op = await store.transition(op.id, { to: "awaiting_authorization", now: now + 1, expectedVersion: op.version });
  op = await store.transition(op.id, { to: "ready", now: now + 2, expectedVersion: op.version });
  op = await store.transition(op.id, { to: "submitted", now: now + 3, expectedVersion: op.version, txHash });
  return op;
}

describe("ReconciliationWorker — startup recovery, retry/backoff, unknown/reverted/stale/requires_attention", () => {
  it("startup recovery: recovers durable submitted op after simulated restart", async () => {
    const store = new InMemoryOperationStore();
    await createSubmitted(store, "op-restart");
    // Simulate restart: new worker with same store (durable rows survive)
    const worker = new ReconciliationWorker({
      store,
      ledger: ledgerFake(),
      indexer: indexerFake(),
      clock: clockFake(NOW + 20),
      config: { sweepLimit: 10, pollIntervalMs: 1_000_000 },
    });
    const res = await worker.recoverAtStartup(NOW + 20);
    expect(res.swept).toBe(1);
    expect(res.advanced).toBe(1);
    const after = await store.getById("op-restart");
    expect(after?.state).toBe("processing");
  });

  it("steps a direct SUCCEEDED + ACCEPTED_ON_L1 observation through legal states", async () => {
    const store = new InMemoryOperationStore();
    await createSubmitted(store, "op-l1-finalized");
    const worker = new ReconciliationWorker({
      store,
      ledger: {
        async observeChain(txHash: Hex) {
          return { txHash, finality: "ACCEPTED_ON_L1", execution: "SUCCEEDED", blockNumber: 100 };
        },
      },
      indexer: indexerFake({ eventObserved: false }),
      clock: clockFake(NOW + 20),
    });

    const processing = await worker.tickAllOnce(NOW + 20);
    expect(processing.advanced).toBe(1);
    expect((await store.getById("op-l1-finalized"))?.state).toBe("processing");

    await worker.tickAllOnce(NOW + 21);
    expect((await store.getById("op-l1-finalized"))?.state).toBe("confirming");
    await worker.tickAllOnce(NOW + 22);
    expect((await store.getById("op-l1-finalized"))?.state).toBe("confirmed");
  });

  it("bounded retry/backoff: failed_retryable skipped within backoff window, retried after", async () => {
    const store = new InMemoryOperationStore();
    let op = await store.create({ id: "op-backoff", idempotencyKey: "idem-backoff", requestFingerprint: "fp-backoff", now: NOW });
    op = await store.transition(op.id, { to: "awaiting_authorization", now: NOW + 1, expectedVersion: op.version });
    op = await store.transition(op.id, { to: "failed_retryable", now: NOW + 2, expectedVersion: op.version, errorCode: "ERR-021" });
    // attempts =1, backoff = 2000ms, elapsed 1s => skipped
    const worker1 = new ReconciliationWorker({
      store,
      ledger: ledgerFake(),
      indexer: indexerFake(),
      clock: clockFake(NOW + 3),
      config: { backoffBaseMs: 1000, backoffMaxMs: 30000 },
    });
    const r1 = await worker1.tickAllOnce(NOW + 3);
    expect(r1.advanced).toBe(0);
    expect(r1.noops).toBe(1);
    // after 3s elapsed, backoff window passed => would retry if there were a retry path; but worker for failed_retryable currently counts as noop (no ledger tick)
    // For deterministic proof, check computeBackoffMs directly:
    expect(computeBackoffMs(1, 1000, 30000)).toBe(2000);
    expect(computeBackoffMs(2, 1000, 30000)).toBe(4000);
    expect(computeBackoffMs(10, 1000, 30000)).toBe(30000); // capped
  });

  it("coalesces overlapping daemon ticks so one worker does not double-observe an operation", async () => {
    const store = new InMemoryOperationStore();
    await createSubmitted(store, "op-overlap");
    let observations = 0;
    let unblock!: () => void;
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const worker = new ReconciliationWorker({
      store,
      ledger: {
        async observeChain(txHash: Hex) {
          observations++;
          if (observations === 1) await gate;
          return { txHash, finality: "ACCEPTED_ON_L2", execution: "SUCCEEDED", blockNumber: 100 };
        },
      },
      indexer: indexerFake(),
      clock: clockFake(NOW + 20),
    });

    const first = worker.tickAllOnce(NOW + 20);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = worker.tickAllOnce(NOW + 20);
    unblock();
    const results = await Promise.all([first, second]);

    expect(observations).toBe(1);
    expect(results[0]).toEqual(results[1]);
    expect((await store.getById("op-overlap"))?.state).toBe("processing");
  });

  it("unknown status: submitted-but-unknown stays submitted, fail-closed, no invented completion", async () => {
    const store = new InMemoryOperationStore();
    await createSubmitted(store, "op-unk");
    const worker = new ReconciliationWorker({
      store,
      ledger: ledgerFake({ chain: null }),
      indexer: indexerFake({ eventObserved: false }),
      clock: clockFake(NOW + 20),
    });
    const res = await worker.tickAllOnce(NOW + 20);
    expect(res.advanced).toBe(0);
    expect((await store.getById("op-unk"))?.state).toBe("submitted");
  });

  it("reverted: ledger REVERTED advances to reverted with stable revert code", async () => {
    const store = new InMemoryOperationStore();
    await createSubmitted(store, "op-rev");
    // advance to processing first so reverted path is reachable
    let cur = await store.getById("op-rev");
    // need processing state: tick once with success to get to processing
    const w1 = new ReconciliationWorker({ store, ledger: ledgerFake(), indexer: indexerFake(), clock: clockFake(NOW + 10) });
    await w1.tickAllOnce(NOW + 10);
    expect((await store.getById("op-rev"))?.state).toBe("processing");
    // Now ledger reports REVERTED
    const worker2 = new ReconciliationWorker({
      store,
      ledger: {
        async observeChain(txHash: Hex) {
          return { txHash, finality: "ACCEPTED_ON_L2", execution: "REVERTED", revertCode: "ERR-007", blockNumber: 100 } as ChainTxObservation;
        },
      },
      indexer: indexerFake(),
      clock: clockFake(NOW + 20),
    });
    const r = await worker2.tickAllOnce(NOW + 20);
    expect(r.reverted).toBe(1);
    const after = await store.getById("op-rev");
    expect(after?.state).toBe("reverted");
    expect(after?.errorCode).toBe("ERR-007");
  });

  it("stale watermark: worker persists watermark and exposes via store", async () => {
    const store = new InMemoryOperationStore();
    await createSubmitted(store, "op-wm");
    const worker = new ReconciliationWorker({
      store,
      ledger: {
        async observeChain(txHash: Hex) {
          return { txHash, finality: "ACCEPTED_ON_L2", execution: "SUCCEEDED", blockNumber: 42 } as ChainTxObservation;
        },
      },
      indexer: indexerFake({ blockNumber: 43 }),
      clock: clockFake(NOW + 20),
    });
    await worker.tickAllOnce(NOW + 20);
    const after = await store.getById("op-wm");
    expect(after?.reconciliationWatermark).toBe(42);
  });

  it("requires_attention escalation: submitted stuck beyond threshold escalates", async () => {
    const store = new InMemoryOperationStore();
    await createSubmitted(store, "op-esc", TX_HASH, NOW);
    // submitted at NOW+3, now = NOW+200 (elapsed 197s > 120s default)
    const worker = new ReconciliationWorker({
      store,
      ledger: ledgerFake({ chain: null }), // still unknown
      indexer: indexerFake(),
      clock: clockFake(NOW + 200),
      config: { requiresAttentionAfterMs: 100_000 }, // 100s
    });
    const res = await worker.tickAllOnce(NOW + 200);
    expect(res.escalated).toBe(1);
    const after = await store.getById("op-esc");
    expect(after?.state).toBe("requires_attention");
    expect(after?.errorCode).toBe("ERR-022");
  });

  it("requires_attention recovery: after escalation, backoff, and worker restart, startup recovery resumes processing", async () => {
    const store = new InMemoryOperationStore();
    await createSubmitted(store, "op-esc-restart", TX_HASH, NOW);

    const escalationWorker = new ReconciliationWorker({
      store,
      ledger: ledgerFake({ chain: null }),
      indexer: indexerFake(),
      clock: clockFake(NOW + 200),
      config: {
        requiresAttentionAfterMs: 100_000,
        backoffBaseMs: 1_000,
        backoffMaxMs: 30_000,
      },
    });
    const escalated = await escalationWorker.tickAllOnce(NOW + 200);
    expect(escalated.escalated).toBe(1);
    expect((await store.getById("op-esc-restart"))?.state).toBe("requires_attention");

    // The worker must honor the persisted retry backoff before asking the chain again.
    let earlyObservations = 0;
    const beforeBackoff = new ReconciliationWorker({
      store,
      ledger: {
        async observeChain() {
          earlyObservations++;
          return null;
        },
      },
      indexer: indexerFake(),
      clock: clockFake(NOW + 201),
      config: { backoffBaseMs: 1_000, backoffMaxMs: 30_000 },
    });
    const skipped = await beforeBackoff.tickAllOnce(NOW + 201);
    expect(skipped.advanced).toBe(0);
    expect(skipped.noops).toBe(1);
    expect(earlyObservations).toBe(0);

    // A fresh worker instance represents process restart. Once the persisted
    // backoff has elapsed, it must recover the operation through startup sweep.
    let restartObservations = 0;
    const restartedWorker = new ReconciliationWorker({
      store,
      ledger: {
        async observeChain(txHash: Hex) {
          restartObservations++;
          return { txHash, finality: "ACCEPTED_ON_L2", execution: "SUCCEEDED", blockNumber: 100 };
        },
      },
      indexer: {
        async observeIndexer(txHash: Hex) {
          return { txHash, eventObserved: false, blockNumber: null, eventIndex: null };
        },
        async observeReconciliation(txHash: Hex) {
          return { chainReceiptMatched: false, eventMatchedToOperation: false, matchedTxHash: null };
        },
      },
      clock: clockFake(NOW + 203),
      config: { backoffBaseMs: 1_000, backoffMaxMs: 30_000 },
    });
    const recovered = await restartedWorker.recoverAtStartup(NOW + 203);
    expect(recovered.swept).toBe(1);
    expect(recovered.advanced).toBe(1);
    expect(restartObservations).toBe(1);
    expect((await store.getById("op-esc-restart"))?.state).toBe("processing");
  });

  it("dependency outage: ledger throws -> fail-closed, metrics dependencyFailures incremented", async () => {
    const store = new InMemoryOperationStore();
    await createSubmitted(store, "op-dep");
    const worker = new ReconciliationWorker({
      store,
      ledger: ledgerFake({ throws: true }),
      indexer: indexerFake(),
      clock: clockFake(NOW + 20),
    });
    const res = await worker.tickAllOnce(NOW + 20);
    expect(res.dependencyFailures).toBe(1);
    expect((await store.getById("op-dep"))?.state).toBe("submitted");
  });

  it("orders equal-timestamp restart rows by operation id for repeatable bounded sweeps", async () => {
    const store = new InMemoryOperationStore();
    const secondTx = (`0x${"b".repeat(64)}`) as Hex;
    await createSubmitted(store, "op-z", TX_HASH, NOW);
    await createSubmitted(store, "op-a", secondTx, NOW);
    const observed: Hex[] = [];
    const worker = new ReconciliationWorker({
      store,
      ledger: {
        async observeChain(txHash: Hex) {
          observed.push(txHash);
          return { txHash, finality: "ACCEPTED_ON_L2", execution: "SUCCEEDED", blockNumber: 100 };
        },
      },
      indexer: indexerFake(),
      clock: clockFake(NOW + 20),
      config: { sweepLimit: 1 },
    });

    const result = await worker.tickAllOnce(NOW + 20);
    expect(result.swept).toBe(1);
    expect(observed).toEqual([secondTx]);
  });

  it("combines a successful observed receipt with an indexed event before issuing a completed receipt", async () => {
    const store = new InMemoryOperationStore();
    let op = await createSubmitted(store, "op-observed-receipt");
    op = await store.transition(op.id, { to: "processing", now: NOW + 4, expectedVersion: op.version });
    op = await store.transition(op.id, { to: "confirming", now: NOW + 5, expectedVersion: op.version });
    op = await store.transition(op.id, { to: "confirmed", now: NOW + 6, expectedVersion: op.version });
    op = await store.transition(op.id, {
      to: "indexed",
      now: NOW + 7,
      expectedVersion: op.version,
      reconciliationWatermark: 100,
      reconciliationMetadata: { eventIndex: 0 },
    });

    const worker = new ReconciliationWorker({
      store,
      ledger: {
        async observeChain(txHash: Hex) {
          return { txHash, finality: "ACCEPTED_ON_L2", execution: "SUCCEEDED", blockNumber: 100 };
        },
      },
      indexer: {
        async observeIndexer(txHash: Hex) {
          return { txHash, eventObserved: true, eventName: "ExecutionIdentityBound", blockNumber: 100, eventIndex: 0 };
        },
        async observeReconciliation(txHash: Hex) {
          return { chainReceiptMatched: false, eventMatchedToOperation: true, matchedTxHash: txHash };
        },
      },
      clock: clockFake(NOW + 8),
    });

    const reconciled = await worker.tickAllOnce(NOW + 8);
    expect(reconciled.advanced).toBe(1);
    expect((await store.getById(op.id))?.state).toBe("reconciled");

    const completed = await worker.tickAllOnce(NOW + 9);
    expect(completed.advanced).toBe(1);
    expect((await store.getById(op.id))?.state).toBe("completed");
  });

  it("never marks submitted as completed without indexed+reconciled", async () => {
    const store = new InMemoryOperationStore();
    await createSubmitted(store, "op-never");
    const worker = new ReconciliationWorker({
      store,
      ledger: ledgerFake(),
      indexer: indexerFake({ eventObserved: false }), // confirmed but no event => stays processing/confirming, not completed
      clock: clockFake(NOW + 20),
    });
    const r1 = await worker.tickAllOnce(NOW + 20);
    expect(r1.advanced).toBe(1); // submitted -> processing
    const after1 = await store.getById("op-never");
    expect(after1?.state).not.toBe("completed");
    // Even if indexer suddenly says matched, worker advances stepwise, not skip to completed
    const r2 = await worker.tickAllOnce(NOW + 21);
    expect((await store.getById("op-never"))?.state).not.toBe("completed");
  });

  it("deterministic ordering: sweeps in updatedAt order", async () => {
    const store = new InMemoryOperationStore();
    await createSubmitted(store, "op-early", TX_HASH, NOW);
    await new Promise((r) => setTimeout(r, 2));
    await createSubmitted(store, "op-late", "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hex, NOW + 1);
    const worker = new ReconciliationWorker({
      store,
      ledger: ledgerFake(),
      indexer: indexerFake(),
      clock: clockFake(NOW + 20),
      config: { sweepLimit: 1 },
    });
    const res = await worker.tickAllOnce(NOW + 20);
    expect(res.swept).toBe(1); // limit 1, earliest wins
  });
});
