import { describe, expect, it } from "vitest";
import type { Hex } from "../domain/operation";
import { InMemoryOperationStore } from "../adapters/memory-operation-store";

const TX_HASH: Hex = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const NOW = 1_789_000_000;

async function createSubmitted(store: InMemoryOperationStore, id: string) {
  let operation = await store.create({
    id,
    idempotencyKey: `idem-${id}`,
    requestFingerprint: `fp-${id}`,
    now: NOW,
  });
  operation = await store.transition(operation.id, {
    to: "awaiting_authorization",
    now: NOW + 1,
    expectedVersion: operation.version,
  });
  operation = await store.transition(operation.id, {
    to: "ready",
    now: NOW + 2,
    expectedVersion: operation.version,
  });
  return store.transition(operation.id, {
    to: "submitted",
    now: NOW + 3,
    expectedVersion: operation.version,
    txHash: TX_HASH,
  });
}

describe("InMemoryOperationStore reconciliation CAS", () => {
  it("increments version for a same-state reconciliation watermark update", async () => {
    const store = new InMemoryOperationStore();
    const current = await createSubmitted(store, "op-watermark-version");

    const updated = await store.transition(current.id, {
      to: "submitted",
      now: NOW + 4,
      expectedVersion: current.version,
      txHash: TX_HASH,
      reconciliationWatermark: 42,
    });

    expect(updated.reconciliationWatermark).toBe(42);
    expect(updated.version).toBe(current.version + 1);
    expect(updated.updatedAt).toBe(NOW + 4);
  });

  it("increments version for a same-state reconciliation metadata update and not for a no-op", async () => {
    const store = new InMemoryOperationStore();
    const current = await createSubmitted(store, "op-metadata-version");

    const updated = await store.transition(current.id, {
      to: "submitted",
      now: NOW + 4,
      expectedVersion: current.version,
      txHash: TX_HASH,
      reconciliationMetadata: { eventIndex: 0, writer: "first" },
    });
    const unchanged = await store.transition(updated.id, {
      to: "submitted",
      now: NOW + 5,
      expectedVersion: updated.version,
      txHash: TX_HASH,
      reconciliationMetadata: { eventIndex: 0, writer: "first" },
    });

    expect(updated.reconciliationMetadata).toEqual({ eventIndex: 0, writer: "first" });
    expect(updated.version).toBe(current.version + 1);
    expect(unchanged).toEqual(updated);
  });

  it("rejects a stale same-state reconciliation writer instead of overwriting the winner", async () => {
    const store = new InMemoryOperationStore();
    const current = await createSubmitted(store, "op-stale-reconciliation-writer");

    const first = store.transition(current.id, {
      to: "submitted",
      now: NOW + 4,
      expectedVersion: current.version,
      txHash: TX_HASH,
      reconciliationWatermark: 42,
      reconciliationMetadata: { writer: "first" },
    });
    const stale = store.transition(current.id, {
      to: "submitted",
      now: NOW + 5,
      expectedVersion: current.version,
      txHash: TX_HASH,
      reconciliationWatermark: 99,
      reconciliationMetadata: { writer: "stale" },
    });

    const results = await Promise.allSettled([first, stale]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejection = results.find((result) => result.status === "rejected");
    expect(rejection).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ detail: expect.stringContaining("stale_version") }),
    });

    const persisted = await store.getById(current.id);
    expect(persisted?.version).toBe(current.version + 1);
    expect(persisted?.reconciliationWatermark).toBe(42);
    expect(persisted?.reconciliationMetadata).toEqual({ writer: "first" });
  });

  it("persists a monotonic submission fence through quarantine and submitted, and never clears it", async () => {
    const store = new InMemoryOperationStore();
    let operation = await store.create({
      id: "op-submission-fence",
      idempotencyKey: "idem-submission-fence",
      requestFingerprint: "fp-submission-fence",
      now: NOW,
    });
    operation = await store.transition(operation.id, {
      to: "awaiting_authorization",
      now: NOW + 1,
      expectedVersion: operation.version,
    });
    operation = await store.transition(operation.id, {
      to: "ready",
      now: NOW + 2,
      expectedVersion: operation.version,
    });
    operation = await store.transition(operation.id, {
      to: "requires_attention",
      now: NOW + 3,
      expectedVersion: operation.version,
      errorCode: "ERR-022",
      errorDetail: "submission_attempted_poll_only",
      submissionAttempted: true,
    });
    expect(operation.submissionAttempted).toBe(true);

    operation = await store.transition(operation.id, {
      to: "submitted",
      now: NOW + 4,
      expectedVersion: operation.version,
      txHash: TX_HASH,
    });
    expect(operation.submissionAttempted).toBe(true);
    expect(operation.txHash).toBe(TX_HASH);

    await expect(
      store.transition(operation.id, {
        to: "processing",
        now: NOW + 5,
        expectedVersion: operation.version,
        txHash: TX_HASH,
        submissionAttempted: false,
      }),
    ).rejects.toMatchObject({ detail: "submission_attempted_fence_cannot_clear" });
  });
});
