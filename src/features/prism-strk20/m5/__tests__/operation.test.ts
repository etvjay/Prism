import { describe, expect, it } from "vitest";
import {
  createM5Operation,
  markM5SubmissionStarted,
  markM5Submitted,
  recoverM5Operation,
  type M5ReceiptObservation,
} from "../operation";
import { PRIVACY_POOL_SEPOLIA } from "../constants";

const TX = "0x05abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123ab" as `0x${string}`;

function successReceipt(overrides: Partial<M5ReceiptObservation> = {}): M5ReceiptObservation {
  return {
    transactionHash: TX,
    executionStatus: "SUCCEEDED",
    finalityStatus: "ACCEPTED_ON_L2",
    blockNumber: 100,
    poolEventFound: true,
    events: [{ address: PRIVACY_POOL_SEPOLIA, keys: [], data: [] }],
    ...overrides,
  };
}

describe("M5 operation/recovery contract", () => {
  it("records submission once and fences recovery against rebroadcast", () => {
    const created = createM5Operation("m5-op", 1);
    const submitted = markM5Submitted(created, TX, 2);
    expect(submitted.state).toBe("submitted");
    expect(submitted.submissionAttempted).toBe(true);
    expect(() => markM5Submitted(submitted, TX, 3)).toThrow(/submission_attempted/);
  });

  it("fences before the wallet call when submission completion is ambiguous", () => {
    const started = markM5SubmissionStarted(createM5Operation("m5-op", 1), 2);
    expect(started.state).toBe("submitting");
    expect(started.submissionAttempted).toBe(true);
    expect(started.txHash).toBeNull();
    expect(() => markM5SubmissionStarted(started, 3)).toThrow(/submission_attempted/);
    expect(() => recoverM5Operation(started, null, { now: 101, timeoutAt: 100 })).not.toThrow();
  });

  it("recovers RECEIVED into polling and then succeeds only on final receipt", () => {
    const submitted = markM5Submitted(createM5Operation("m5-op", 1), TX, 2);
    const received = recoverM5Operation(submitted, successReceipt({ executionStatus: "RECEIVED", finalityStatus: "RECEIVED", blockNumber: null }), { now: 3, timeoutAt: 100 });
    expect(received.operation.state).toBe("received");
    const done = recoverM5Operation(received.operation, successReceipt(), { now: 4, timeoutAt: 100 });
    expect(done.operation.state).toBe("succeeded");
    expect(done.operation.txHash).toBe(TX);
  });

  it("treats timeout and hash mismatch as recovery attention, never as success", () => {
    const submitted = markM5Submitted(createM5Operation("m5-op", 1), TX, 2);
    const timeout = recoverM5Operation(submitted, null, { now: 101, timeoutAt: 100 });
    expect(timeout.operation.state).toBe("requires_attention");
    expect(timeout.operation.submissionAttempted).toBe(true);
    const mismatch = recoverM5Operation(submitted, successReceipt({ transactionHash: "0x1" as `0x${string}` }), { now: 4, timeoutAt: 100 });
    expect(mismatch.operation.state).toBe("submitted");
    expect(mismatch.advanced).toBe(false);
  });

  it("does not promote a successful receipt without a pinned pool event", () => {
    const submitted = markM5Submitted(createM5Operation("m5-op", 1), TX, 2);
    const result = recoverM5Operation(submitted, successReceipt({ poolEventFound: false }), { now: 3, timeoutAt: 100 });
    expect(result.operation.state).not.toBe("succeeded");
    expect(result.advanced).toBe(false);
  });

  it("does not trust a pool-event flag when the receipt has no event evidence", () => {
    const submitted = markM5Submitted(createM5Operation("m5-op", 1), TX, 2);
    const result = recoverM5Operation(submitted, successReceipt({ events: [], poolEventFound: true }), { now: 3, timeoutAt: 100 });
    expect(result.operation.state).not.toBe("succeeded");
    expect(result.advanced).toBe(false);
  });
});
