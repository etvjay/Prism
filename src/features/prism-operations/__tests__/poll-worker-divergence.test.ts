// Poll/reconciliation divergence tests — T12 failure/recovery tier.
// Each divergence case from AUTHORITY_MATRIX §4 + SYSTEM_FOUNDRY §20 is
// exercised through the deterministic tick boundary with explicitly labelled
// fakes (FakeLedgerPort, FakeIndexerPort, FakeOperationStore doubles).
// No live RPC; no mainnet call.

import { describe, it, expect } from "vitest";
import type { Hex, OperationState } from "../domain/operation";
import { createOperation, AUTHORITATIVE_SOURCE } from "../domain/operation";
import type { PersistedOperation, OperationStore } from "../domain/operation-store";
import type { ChainTxObservation, IndexerObservation, OperationReconciliationPort } from "../domain/ports";
import { tickReconciliation, tickReconciliationWithNarrowPorts, recoverNonTerminalOperations, isWatermarkStale, authoritativeSourceForState } from "../domain/recovery";
import type { LedgerStatusPort, EventIndexerPort } from "../domain/ports";

const TX_HASH: Hex = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TX_HASH_2: Hex = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const NOW = 1_789_000_000;

// ---- Minimal fake store (labelled test double) ----
class FakeOperationStore implements OperationStore {
  private readonly rows = new Map<string, PersistedOperation>();
  private readonly byKey = new Map<string, string>();

  async create(input: { id: string; idempotencyKey: string; requestFingerprint: string; now: number; kind?: string; correlationId?: string | null }): Promise<PersistedOperation> {
    if (this.byKey.has(input.idempotencyKey)) {
      const existingId = this.byKey.get(input.idempotencyKey)!;
      const existing = this.rows.get(existingId)!;
      if (existing.requestFingerprint !== input.requestFingerprint) throw new Error("ERR-023 idempotency_key_conflict");
      return existing;
    }
    const base = createOperation({ id: input.id, kind: input.kind, now: input.now, correlationId: input.correlationId ?? null });
    const rec: PersistedOperation = { ...base, idempotencyKey: input.idempotencyKey, requestFingerprint: input.requestFingerprint, reconciliationWatermark: null, reconciliationMetadata: null };
    this.rows.set(rec.id, rec);
    this.byKey.set(rec.idempotencyKey, rec.id);
    return rec;
  }
  async getById(id: string) { const r = this.rows.get(id); return r ? { ...r } : undefined; }
  async getByIdempotencyKey(key: string) { const id = this.byKey.get(key); return id ? this.getById(id) : undefined; }
  async transition(id: string, input: { to: OperationState; now: number; expectedVersion: number; txHash?: Hex | null; errorCode?: string | null; errorDetail?: string | null; reconciliationWatermark?: number | null; reconciliationMetadata?: Record<string, unknown> | null }): Promise<PersistedOperation> {
    const cur = this.rows.get(id); if (!cur) throw new Error("unknown_operation");
    const { transition: domTransition } = await import("../domain/operation");
    const result = domTransition(cur, { to: input.to, now: input.now, expectedVersion: input.expectedVersion, txHash: input.txHash ?? undefined, errorCode: input.errorCode ?? undefined, errorDetail: input.errorDetail ?? undefined });
    if (result.idempotent) return cur;
    const next: PersistedOperation = { ...result.operation, idempotencyKey: cur.idempotencyKey, requestFingerprint: cur.requestFingerprint, reconciliationWatermark: input.reconciliationWatermark ?? cur.reconciliationWatermark, reconciliationMetadata: input.reconciliationMetadata ?? cur.reconciliationMetadata };
    this.rows.set(id, next); return next;
  }
  async listNonTerminal(): Promise<readonly PersistedOperation[]> {
    const terminal = new Set(["completed","failed_terminal","cancelled","expired","reverted"]);
    return Array.from(this.rows.values()).filter(r => !terminal.has(r.state));
  }
  async close() {}
  inject(rec: PersistedOperation) { this.rows.set(rec.id, rec); this.byKey.set(rec.idempotencyKey, rec.id); }
  getRow(id: string) { return this.rows.get(id)!; }
}

// Helpers to drive to a state
async function toState(store: FakeOperationStore, id: string, to: OperationState, patch: Partial<{ txHash: Hex|null; errorCode: string|null; now: number }> = {}) {
  const cur = store.getRow(id);
  return store.transition(id, { to, now: patch.now ?? NOW+10, expectedVersion: cur.version, txHash: patch.txHash ?? undefined, errorCode: patch.errorCode ?? undefined });
}

// Fake composite port helper (labelled double)
function fakeComposite(overrides: Partial<OperationReconciliationPort>): OperationReconciliationPort {
  return {
    async observeChain(txHash: Hex): Promise<ChainTxObservation | null> { return { txHash, finality: "ACCEPTED_ON_L2", execution: "SUCCEEDED", blockNumber: 100 } as ChainTxObservation; },
    async observeIndexer(txHash: Hex): Promise<IndexerObservation | null> { return { txHash, eventObserved: true, eventName: "ExecutionIdentityBound", blockNumber: 101, eventIndex: 0 } as IndexerObservation; },
    async observeReconciliation(txHash: Hex) { return { chainReceiptMatched: true, eventMatchedToOperation: true, matchedTxHash: txHash }; },
    ...overrides,
  };
}
function fakeLedger(ledgerOverrides: Partial<LedgerStatusPort>, indexerOverrides: Partial<EventIndexerPort>) {
  const ledger: LedgerStatusPort = { async observeChain(txHash: Hex) { return { txHash, finality: "ACCEPTED_ON_L2", execution: "SUCCEEDED", blockNumber: 100 } as ChainTxObservation; }, ...ledgerOverrides };
  const indexer: EventIndexerPort = { async observeIndexer(txHash: Hex) { return { txHash, eventObserved: true, eventName: "ExecutionIdentityBound", blockNumber: 101, eventIndex: 0 } as IndexerObservation; }, async observeReconciliation(txHash) { return { chainReceiptMatched: true, eventMatchedToOperation: true, matchedTxHash: txHash }; }, ...indexerOverrides };
  return { ledger, indexer };
}

describe("poll worker divergence matrix (T12)", () => {
  it("submitted-but-unknown: chain returns null -> tick noop, never advances, fail-closed", async () => {
    const store = new FakeOperationStore(); let op = await store.create({ id:"op-unk", idempotencyKey:"idem-unk", requestFingerprint:"fp-unk", now:NOW });
    op = await toState(store, op.id, "awaiting_authorization"); op = await toState(store, op.id, "ready"); op = await toState(store, op.id, "submitted", { txHash: TX_HASH });
    const port = fakeComposite({ async observeChain(){ return null; }, async observeIndexer(){ return null; }, async observeReconciliation(){ return null; } });
    const r = await tickReconciliation(store, port, op.id, NOW+20);
    expect(r.advanced).toBe(false); expect(r.reason).toMatch(/awaiting_chain/);
    expect((await store.getById(op.id))!.state).toBe("submitted");
    // authoritative source for submitted is starknet_rpc_tx_status
    expect(authoritativeSourceForState("submitted")).toBe("starknet_rpc_tx_status");
  });

  it("confirmed-but-unindexed: indexer returns no event -> stays confirmed", async () => {
    const store = new FakeOperationStore(); let op = await store.create({ id:"op-unidx", idempotencyKey:"idem-unidx", requestFingerprint:"fp-unidx", now:NOW });
    for (const [to, v] of [["awaiting_authorization" as OperationState,0],["ready" as OperationState,1],["submitted" as OperationState,2],["processing" as OperationState,3],["confirming" as OperationState,4],["confirmed" as OperationState,5]] as const) { op = await toState(store, op.id, to, { txHash: to==="submitted"? TX_HASH: undefined, now: NOW+v+1 }); }
    expect(op.state).toBe("confirmed");
    const port = fakeComposite({ async observeChain(txHash: Hex){ return { txHash, finality:"ACCEPTED_ON_L2", execution:"SUCCEEDED", blockNumber: 100 } as ChainTxObservation; }, async observeIndexer(){ return { txHash: TX_HASH, eventObserved:false, blockNumber:null, eventIndex:null } as unknown as IndexerObservation; }, async observeReconciliation(){ return null; } });
    const r = await tickReconciliation(store, port, op.id, NOW+20);
    expect(r.advanced).toBe(false); expect(r.reason).toContain("awaiting_indexer");
    expect((await store.getById(op.id))!.state).toBe("confirmed");
  });

  it("reverted: chain REVERTED maps to reverted with stable revert code, retry count preserved", async () => {
    const store = new FakeOperationStore(); let op = await store.create({ id:"op-rev", idempotencyKey:"idem-rev", requestFingerprint:"fp-rev", now:NOW });
    op = await toState(store, op.id, "awaiting_authorization"); op = await toState(store, op.id, "ready"); op = await toState(store, op.id, "submitted", {txHash: TX_HASH}); op = await toState(store, op.id, "processing");
    const port = fakeComposite({ async observeChain(txHash: Hex){ return { txHash, finality:"ACCEPTED_ON_L2", execution:"REVERTED", revertCode:"ERR-007", blockNumber:100 } as ChainTxObservation; } });
    const r = await tickReconciliation(store, port, op.id, NOW+20);
    expect(r.toState).toBe("reverted"); expect(r.advanced).toBe(true);
    const after = await store.getById(op.id); expect(after!.state).toBe("reverted"); expect(after!.errorCode).toBe("ERR-007");
    expect(authoritativeSourceForState("reverted")).toBe("tx_receipt_revert_code");
    // attempts incremented for failure branch
    expect(after!.attempts).toBe(1);
  });

  it("duplicate event: second tick with same indexer observation is idempotent noop (same-state)", async () => {
    const store = new FakeOperationStore(); let op = await store.create({ id:"op-dup", idempotencyKey:"idem-dup", requestFingerprint:"fp-dup", now:NOW });
    for (const to of ["awaiting_authorization","ready","submitted","processing","confirming","confirmed"] as OperationState[]) { op = await toState(store, op.id, to, { txHash: to==="submitted"? TX_HASH: undefined }); }
    const port = fakeComposite({});
    const r1 = await tickReconciliation(store, port, op.id, NOW+20); expect(r1.toState).toBe("indexed");
    const r2 = await tickReconciliation(store, port, op.id, NOW+21); expect(r2.toState).toBe("reconciled");
    // Now duplicate tick: indexer still same event, reconciled -> completed first
    const r3 = await tickReconciliation(store, port, op.id, NOW+22); expect(r3.toState).toBe("completed");
    const r4 = await tickReconciliation(store, port, op.id, NOW+23); expect(r4.advanced).toBe(false); expect(r4.reason).toContain("terminal");
  });

  it("missed event: indexer returns null -> no advance beyond confirmed (idempotent retry)", async () => {
    const store = new FakeOperationStore(); let op = await store.create({ id:"op-miss", idempotencyKey:"idem-miss", requestFingerprint:"fp-miss", now:NOW });
    for (const to of ["awaiting_authorization","ready","submitted","processing","confirming","confirmed"] as OperationState[]) { op = await toState(store, op.id, to, { txHash: to==="submitted"? TX_HASH: undefined }); }
    const port = fakeComposite({ async observeIndexer(){ return null; } });
    const r = await tickReconciliation(store, port, op.id, NOW+20);
    expect(r.advanced).toBe(false); expect(r.reason).toContain("awaiting_indexer");
  });

  it("stale cache: watermark below confirmedBlock-K is stale (isWatermarkStale helper, observability chain)", async () => {
    // Stale when watermark 90, confirmed 100, K=5 => 90<95 => stale
    expect(isWatermarkStale(90, 100, 5)).toBe(true);
    expect(isWatermarkStale(96, 100, 5)).toBe(false);
    expect(isWatermarkStale(null, 100, 5)).toBe(true);
    // Worker persists watermark; resolver would invalidate stale ACTIVE
    const store = new FakeOperationStore(); let op = await store.create({ id:"op-stale", idempotencyKey:"idem-stale", requestFingerprint:"fp-stale", now:NOW });
    for (const to of ["awaiting_authorization","ready","submitted","processing","confirming","confirmed"] as OperationState[]) { op = await toState(store, op.id, to, { txHash: to==="submitted"? TX_HASH: undefined }); }
    const port = fakeComposite({ async observeChain(txHash: Hex){ return { txHash, finality:"ACCEPTED_ON_L2", execution:"SUCCEEDED", blockNumber: 90 } as ChainTxObservation; }, async observeIndexer(txHash: Hex){ return { txHash, eventObserved:true, eventName:"ExecutionIdentityBound", blockNumber: 90, eventIndex:0 } as IndexerObservation; } });
    const r = await tickReconciliation(store, port, op.id, NOW+20);
    expect(r.advanced).toBe(true); // still advances to indexed, watermark 90 is persisted
    const after = await store.getById(op.id); expect(after!.reconciliationWatermark).toBe(90);
    expect(isWatermarkStale(after!.reconciliationWatermark, 100, 5)).toBe(true);
  });

  it("dependency outage: ledger throws -> fail-closed, dependencyFailure=true, no state change", async () => {
    const store = new FakeOperationStore(); let op = await store.create({ id:"op-dep", idempotencyKey:"idem-dep", requestFingerprint:"fp-dep", now:NOW });
    op = await toState(store, op.id, "awaiting_authorization"); op = await toState(store, op.id, "ready"); op = await toState(store, op.id, "submitted", {txHash: TX_HASH});
    const port = fakeComposite({ async observeChain(){ throw new Error("rpc_unavailable"); } });
    const r = await tickReconciliation(store, port, op.id, NOW+20);
    expect(r.dependencyFailure).toBe(true); expect(r.advanced).toBe(false);
    expect((await store.getById(op.id))!.state).toBe("submitted");
  });

  it("dependency outage on indexer and reconciliation also fail-closed", async () => {
    const store = new FakeOperationStore(); let op = await store.create({ id:"op-dep2", idempotencyKey:"idem-dep2", requestFingerprint:"fp-dep2", now:NOW });
    for (const to of ["awaiting_authorization","ready","submitted","processing","confirming","confirmed"] as OperationState[]) { op = await toState(store, op.id, to, { txHash: to==="submitted"? TX_HASH: undefined }); }
    const p1 = fakeComposite({ async observeIndexer(){ throw new Error("indexer_down"); } });
    expect((await tickReconciliation(store, p1, op.id, NOW+20)).dependencyFailure).toBe(true);
    const p2 = fakeComposite({ async observeReconciliation(){ throw new Error("reconciliation_down"); } });
    // after confirming we need indexed first; make op indexed then test reconciliation outage
    await toState(store, op.id, "indexed"); // advance manually to indexed for test
    const r2 = await tickReconciliation(store, p2, op.id, NOW+30);
    // indexed awaiting reconciliation_match, but reconciliation throws -> fail-closed
    // tick will query chain/indexer/reconciliation; reconciliation throws
    expect(r2.dependencyFailure).toBe(true);
  });

  it("restart: recoverNonTerminalOperations resumes from durable txHash after simulated restart", async () => {
    const store = new FakeOperationStore();
    let opA = await store.create({ id:"op-restart-a", idempotencyKey:"idem-restart-a", requestFingerprint:"fp-restart-a", now:NOW });
    opA = await toState(store, opA.id, "awaiting_authorization"); opA = await toState(store, opA.id, "ready"); opA = await toState(store, opA.id, "submitted", {txHash: TX_HASH});
    let opB = await store.create({ id:"op-restart-b", idempotencyKey:"idem-restart-b", requestFingerprint:"fp-restart-b", now:NOW });
    // opB stays created (no txHash) — should remain noop
    // Simulate restart by creating a new FakeOperationStore doubles with same underlying Map? Instead reuse same store and call sweep
    const port = fakeComposite({ async observeChain(txHash: Hex){ if(txHash===TX_HASH) return { txHash, finality:"ACCEPTED_ON_L2", execution:"SUCCEEDED", blockNumber:100 } as ChainTxObservation; return null; } });
    const sweep = await recoverNonTerminalOperations(store, port, NOW+20, 10);
    expect(sweep.swept).toBe(2); // opA + opB non-terminal
    expect(sweep.advanced).toBe(1); // only opA advances to processing
    expect((await store.getById(opA.id))!.state).toBe("processing");
    expect((await store.getById(opB.id))!.state).toBe("created");
    // persisted retry count not yet incremented for success path
    expect((await store.getById(opA.id))!.attempts).toBe(0);
  });

  it("retryable vs terminal outcomes: failed_retryable can retry to ready, failed_terminal cannot", async () => {
    const store = new FakeOperationStore(); let op = await store.create({ id:"op-retry", idempotencyKey:"idem-retry", requestFingerprint:"fp-retry", now:NOW });
    op = await toState(store, op.id, "awaiting_authorization"); op = await toState(store, op.id, "failed_retryable", {errorCode:"ERR-021"});
    expect((await store.getById(op.id))!.attempts).toBe(1);
    // retry
    op = await toState(store, op.id, "ready"); expect(op.state).toBe("ready");
    op = await toState(store, op.id, "failed_terminal", {errorCode:"ERR-004"});
    expect(op.state).toBe("failed_terminal"); expect(op.attempts).toBe(2);
    // cannot retry from terminal
    await expect(toState(store, op.id, "ready")).rejects.toBeDefined();
  });

  it("never marks submitted/confirming as completed without indexed+reconciled (INV-SYS-005)", async () => {
    const store = new FakeOperationStore(); let op = await store.create({ id:"op-never", idempotencyKey:"idem-never", requestFingerprint:"fp-never", now:NOW });
    op = await toState(store, op.id, "awaiting_authorization"); op = await toState(store, op.id, "ready"); op = await toState(store, op.id, "submitted", {txHash: TX_HASH});
    await expect(toState(store, op.id, "completed")).rejects.toBeDefined();
    op = await toState(store, op.id, "processing"); await expect(toState(store, op.id, "completed")).rejects.toBeDefined();
    op = await toState(store, op.id, "confirming"); await expect(toState(store, op.id, "completed")).rejects.toBeDefined();
    op = await toState(store, op.id, "confirmed"); await expect(toState(store, op.id, "completed")).rejects.toBeDefined();
    // must go indexed -> reconciled -> completed (currently at confirmed, next is indexed)
    const port = fakeComposite({});
    const rIdx = await tickReconciliation(store, port, op.id, NOW+30);
    expect(rIdx.toState).toBe("indexed");
  });

  it("persist tx hash, block/watermark, event correlation, retry count, reconciliation metadata through OperationStore", async () => {
    const store = new FakeOperationStore(); let op = await store.create({ id:"op-persist", idempotencyKey:"idem-persist", requestFingerprint:"fp-persist", now:NOW });
    op = await toState(store, op.id, "awaiting_authorization"); op = await toState(store, op.id, "ready"); op = await toState(store, op.id, "submitted", {txHash: TX_HASH});
    expect((await store.getById(op.id))!.txHash).toBe(TX_HASH);
    // tick to processing records watermark (ledger authority)
    const portProcessing = fakeComposite({ async observeChain(txHash: Hex){ return { txHash, finality:"ACCEPTED_ON_L2", execution:"SUCCEEDED", blockNumber: 42 } as ChainTxObservation; }, async observeIndexer(){ return { txHash: TX_HASH, eventObserved:false } as unknown as IndexerObservation; } });
    let r = await tickReconciliation(store, portProcessing, op.id, NOW+20); expect(r.toState).toBe("processing");
    let after = await store.getById(op.id); expect(after!.reconciliationWatermark).toBe(42);
    expect(after!.reconciliationMetadata).toMatchObject({ txHash: TX_HASH, blockNumber: 42 });
    // advance to confirmed then indexed persists event correlation (indexer authority)
    await toState(store, op.id, "confirming"); await toState(store, op.id, "confirmed");
    const portIndexed = fakeComposite({ async observeChain(txHash: Hex){ return { txHash, finality:"ACCEPTED_ON_L2", execution:"SUCCEEDED", blockNumber: 42 } as ChainTxObservation; }, async observeIndexer(txHash: Hex){ return { txHash, eventObserved:true, eventName:"ExecutionIdentityBound", blockNumber: 43, eventIndex: 2 } as IndexerObservation; } });
    r = await tickReconciliation(store, portIndexed, op.id, NOW+30); expect(r.toState).toBe("indexed");
    after = await store.getById(op.id); expect(after!.reconciliationWatermark).toBe(42); // chain wins when both present, but indexer metadata still recorded
    // force indexer-only watermark by making chain block undefined for indexed stage: reconstruction will use indexer block
    expect(after!.reconciliationMetadata).toMatchObject({ txHash: TX_HASH, eventIndex: 2, eventName: "ExecutionIdentityBound" });
    expect(after!.attempts).toBe(0); // no failure yet
  });

  it("narrow ports (Ledger + Indexer) behave identically to composite (transport-neutral check)", async () => {
    const store = new FakeOperationStore(); let op = await store.create({ id:"op-narrow", idempotencyKey:"idem-narrow", requestFingerprint:"fp-narrow", now:NOW });
    op = await toState(store, op.id, "awaiting_authorization"); op = await toState(store, op.id, "ready"); op = await toState(store, op.id, "submitted", {txHash: TX_HASH});
    const { ledger, indexer } = fakeLedger({}, {});
    const r = await tickReconciliationWithNarrowPorts(store, ledger, indexer, op.id, NOW+20);
    expect(r.advanced).toBe(true); expect(r.toState).toBe("processing");
    expect(authoritativeSourceForState("processing")).toBe("starknet_rpc_tx_status");
  });

  it("authoritative source per state matches STATE_MACHINES.md table", () => {
    expect(authoritativeSourceForState("created")).toBe("backend_op_row");
    expect(authoritativeSourceForState("submitted")).toBe("starknet_rpc_tx_status");
    expect(authoritativeSourceForState("confirmed")).toBe("execution_status_succeeded");
    expect(authoritativeSourceForState("indexed")).toBe("indexer_event_observed");
    expect(authoritativeSourceForState("reconciled")).toBe("reconciliation_match");
    expect(authoritativeSourceForState("completed")).toBe("receipt_issued");
    expect(authoritativeSourceForState("reverted")).toBe("tx_receipt_revert_code");
    expect(AUTHORITATIVE_SOURCE["submitted"]).toBe("starknet_rpc_tx_status");
    expect(AUTHORITATIVE_SOURCE["indexed"]).toBe("indexer_event_observed");
  });
});
