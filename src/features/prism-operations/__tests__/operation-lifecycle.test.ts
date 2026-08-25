import { describe, it, expect } from "vitest";
import {
  createOperation,
  transition,
  canTransition,
  canRetry,
  isTerminal,
  isRetryableFailure,
  isFailureBranch,
  AUTHORITATIVE_SOURCE,
  TERMINAL_STATES,
  type Operation,
  type OperationState,
} from "../domain/operation";
import { OperationError, OPERATION_ERROR_CODE } from "../domain/errors";
import { decideReconciliationStep } from "../domain/ports";
import type { Hex } from "../domain/operation";

// Deterministic fixtures — no SDK imports.
const TX_HASH: Hex = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TX_HASH_2: Hex = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const NOW = 1_789_000_000;

function advance(op: Operation, to: OperationState, patch: Partial<{ txHash: Hex | null; errorCode: string | null; errorDetail: string | null }> = {}): Operation {
  const result = transition(op, {
    to,
    now: NOW + op.version + 1,
    expectedVersion: op.version,
    txHash: patch.txHash !== undefined ? patch.txHash : undefined,
    errorCode: patch.errorCode !== undefined ? patch.errorCode : undefined,
    errorDetail: patch.errorDetail !== undefined ? patch.errorDetail : undefined,
  });
  return result.operation;
}

function mustThrow(fn: () => unknown, contains?: string): OperationError {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(OperationError);
  if (contains) expect((err as OperationError).message).toContain(contains);
  return err as OperationError;
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("operation lifecycle — SM-PRISM-003 happy path", () => {
  it("walks created → awaiting_authorization → ready → submitted → processing → confirming → confirmed → indexed → reconciled → completed", () => {
    let op = createOperation({ id: "op-happy", now: NOW });
    expect(op.state).toBe("created");
    expect(op.authoritativeSource).toBe(AUTHORITATIVE_SOURCE.created);
    expect(op.version).toBe(0);

    op = advance(op, "awaiting_authorization");
    expect(op.state).toBe("awaiting_authorization");
    expect(op.authoritativeSource).toBe(AUTHORITATIVE_SOURCE.awaiting_authorization);

    op = advance(op, "ready");
    expect(op.state).toBe("ready");

    op = advance(op, "submitted", { txHash: TX_HASH });
    expect(op.state).toBe("submitted");
    expect(op.txHash).toBe(TX_HASH);
    expect(op.authoritativeSource).toBe(AUTHORITATIVE_SOURCE.submitted);

    op = advance(op, "processing");
    expect(op.state).toBe("processing");
    expect(op.txHash).toBe(TX_HASH);
    // authoritative source preserved from RPC for these states
    expect(op.authoritativeSource).toBe(AUTHORITATIVE_SOURCE.processing);

    op = advance(op, "confirming");
    expect(op.state).toBe("confirming");

    op = advance(op, "confirmed");
    expect(op.state).toBe("confirmed");
    expect(op.authoritativeSource).toBe(AUTHORITATIVE_SOURCE.confirmed);

    op = advance(op, "indexed");
    expect(op.state).toBe("indexed");
    expect(op.authoritativeSource).toBe(AUTHORITATIVE_SOURCE.indexed);

    op = advance(op, "reconciled");
    expect(op.state).toBe("reconciled");
    expect(op.authoritativeSource).toBe(AUTHORITATIVE_SOURCE.reconciled);

    op = advance(op, "completed");
    expect(op.state).toBe("completed");
    expect(op.authoritativeSource).toBe(AUTHORITATIVE_SOURCE.completed);
    expect(isTerminal(op.state)).toBe(true);
    expect(op.version).toBe(9);
  });

  it("preserves authoritative-source metadata at every hop", () => {
    let op = createOperation({ id: "op-source", now: NOW });
    const steps: Array<{ to: OperationState; txHash?: Hex }> = [
      { to: "awaiting_authorization" },
      { to: "ready" },
      { to: "submitted", txHash: TX_HASH },
      { to: "processing" },
      { to: "confirming" },
      { to: "confirmed" },
      { to: "indexed" },
      { to: "reconciled" },
      { to: "completed" },
    ];
    for (const s of steps) {
      op = advance(op, s.to, s.txHash ? { txHash: s.txHash } : {});
      expect(op.authoritativeSource).toBe(AUTHORITATIVE_SOURCE[s.to]);
    }
  });
});

// ---------------------------------------------------------------------------
// Every failure branch
// ---------------------------------------------------------------------------

describe("failure branches — each explicitly reachable", () => {
  it("failed_retryable from awaiting_authorization (retryable policy)", () => {
    let op = createOperation({ id: "op-fr1", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "failed_retryable", { errorCode: "ERR-021", errorDetail: "rpc_unavailable" });
    expect(op.state).toBe("failed_retryable");
    expect(op.errorCode).toBe("ERR-021");
    expect(isRetryableFailure(op.state)).toBe(true);
    expect(isTerminal(op.state)).toBe(false);
    expect(isFailureBranch(op.state)).toBe(true);
  });

  it("failed_terminal from ready (terminal policy)", () => {
    let op = createOperation({ id: "op-ft", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "failed_terminal", { errorCode: "ERR-004", errorDetail: "not_controller" });
    expect(op.state).toBe("failed_terminal");
    expect(isTerminal(op.state)).toBe(true);
    expect(isRetryableFailure(op.state)).toBe(false);
  });

  it("reverted from submitted (tx executed but reverted maps to ERR)", () => {
    let op = createOperation({ id: "op-rev1", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    op = advance(op, "reverted", { errorCode: "ERR-007", errorDetail: "digest_already_consumed" });
    expect(op.state).toBe("reverted");
    expect(op.authoritativeSource).toBe(AUTHORITATIVE_SOURCE.reverted);
    expect(op.errorCode).toBe("ERR-007");
  });

  it("reverted from processing", () => {
    let op = createOperation({ id: "op-rev2", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    op = advance(op, "processing");
    op = advance(op, "reverted", { errorCode: "ERR-008" });
    expect(op.state).toBe("reverted");
  });

  it("reverted from confirming (any_active → reverted per TR-O2)", () => {
    let op = createOperation({ id: "op-rev3", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    op = advance(op, "processing");
    op = advance(op, "confirming");
    op = advance(op, "reverted", { errorCode: "ERR-005" });
    expect(op.state).toBe("reverted");
  });

  it("expired from created (ttl policy)", () => {
    let op = createOperation({ id: "op-exp1", now: NOW });
    op = advance(op, "expired", { errorCode: "ERR-013", errorDetail: "ttl_exceeded" });
    expect(op.state).toBe("expired");
    expect(op.authoritativeSource).toBe(AUTHORITATIVE_SOURCE.expired);
    expect(isTerminal(op.state)).toBe(true);
  });

  it("expired from awaiting_authorization", () => {
    let op = createOperation({ id: "op-exp2", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "expired", { errorCode: "ERR-013" });
    expect(op.state).toBe("expired");
  });

  it("cancelled from created (user_or_operator)", () => {
    let op = createOperation({ id: "op-cancel1", now: NOW });
    op = advance(op, "cancelled", { errorCode: "ERR-011", errorDetail: "user_cancel" });
    expect(op.state).toBe("cancelled");
    expect(op.authoritativeSource).toBe(AUTHORITATIVE_SOURCE.cancelled);
    expect(isTerminal(op.state)).toBe(true);
  });

  it("cancelled from ready", () => {
    let op = createOperation({ id: "op-cancel2", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "cancelled", { errorCode: "ERR-011" });
    expect(op.state).toBe("cancelled");
  });

  it("requires_attention from submitted (timeout never reported as onchain failure per TR-O3)", () => {
    let op = createOperation({ id: "op-ra1", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    op = advance(op, "requires_attention", { errorCode: "ERR-022", errorDetail: "timeout_unknown_status" });
    expect(op.state).toBe("requires_attention");
    expect(op.authoritativeSource).toBe(AUTHORITATIVE_SOURCE.requires_attention);
    expect(isRetryableFailure(op.state)).toBe(true);
  });

  it("requires_attention from processing and confirming", () => {
    let op = createOperation({ id: "op-ra2", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    op = advance(op, "processing");
    op = advance(op, "requires_attention", { errorCode: "ERR-022" });
    expect(op.state).toBe("requires_attention");

    let op2 = createOperation({ id: "op-ra3", now: NOW });
    op2 = advance(op2, "awaiting_authorization");
    op2 = advance(op2, "ready");
    op2 = advance(op2, "submitted", { txHash: TX_HASH });
    op2 = advance(op2, "processing");
    op2 = advance(op2, "confirming");
    op2 = advance(op2, "requires_attention", { errorCode: "ERR-022" });
    expect(op2.state).toBe("requires_attention");
  });

  it("failed_retryable vs failed_terminal are distinct branches with different terminality", () => {
    expect(TERMINAL_STATES).toContain("failed_terminal");
    expect(TERMINAL_STATES).not.toContain("failed_retryable");
    expect(isTerminal("failed_retryable" as OperationState)).toBe(false);
    expect(isTerminal("failed_terminal" as OperationState)).toBe(true);
    expect(isRetryableFailure("failed_retryable" as OperationState)).toBe(true);
    expect(isRetryableFailure("failed_terminal" as OperationState)).toBe(false);
  });

  it("submissionAttempted is a hard fence against retryable rebroadcast states", () => {
    let op = createOperation({ id: "op-fenced-retry", now: NOW });
    op = transition(op, { to: "awaiting_authorization", now: NOW + 1, expectedVersion: op.version }).operation;
    op = transition(op, {
      to: "failed_retryable",
      now: NOW + 2,
      expectedVersion: op.version,
      errorCode: "ERR-021",
      submissionAttempted: true,
    }).operation;

    expect(op.submissionAttempted).toBe(true);
    expect(canRetry(op)).toBe(false);
    for (const target of ["ready", "awaiting_authorization"] as const) {
      expect(() =>
        transition(op, {
          to: target,
          now: NOW + 3,
          expectedVersion: op.version,
        }),
      ).toThrow("submission_attempted_fence");
    }
  });
});

// ---------------------------------------------------------------------------
// Illegal skips — only specified transitions allowed
// ---------------------------------------------------------------------------

describe("illegal transitions are rejected", () => {
  it("rejects created → completed (skip)", () => {
    const op = createOperation({ id: "op-il1", now: NOW });
    mustThrow(() => transition(op, { to: "completed", now: NOW + 1, expectedVersion: 0 }), "illegal");
  });

  it("rejects created → confirmed", () => {
    const op = createOperation({ id: "op-il2", now: NOW });
    mustThrow(() => transition(op, { to: "confirmed", now: NOW + 1, expectedVersion: 0 }), "illegal");
  });

  it("rejects submitted → completed (INV-SYS-005: submitted ≠ completed)", () => {
    let op = createOperation({ id: "op-il3", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    mustThrow(() => transition(op, { to: "completed", now: NOW + 10, expectedVersion: op.version }), "submitted_is_not_completed");
  });

  it("rejects confirming → completed before indexed+reconciled", () => {
    let op = createOperation({ id: "op-il4", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    op = advance(op, "processing");
    op = advance(op, "confirming");
    mustThrow(() => transition(op, { to: "completed", now: NOW + 10, expectedVersion: op.version }), "submitted_is_not_completed");
  });

  it("rejects confirmed → completed (must go indexed → reconciled → completed)", () => {
    let op = createOperation({ id: "op-il5", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    op = advance(op, "processing");
    op = advance(op, "confirming");
    op = advance(op, "confirmed");
    mustThrow(() => transition(op, { to: "completed", now: NOW + 20, expectedVersion: op.version }), "submitted_is_not_completed");
  });

  it("rejects indexed → completed (skip reconciled)", () => {
    let op = createOperation({ id: "op-il6", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    op = advance(op, "processing");
    op = advance(op, "confirming");
    op = advance(op, "confirmed");
    op = advance(op, "indexed");
    mustThrow(() => transition(op, { to: "completed", now: NOW + 20, expectedVersion: op.version }), "illegal");
  });

  it("rejects ready → confirming (skip submitted)", () => {
    let op = createOperation({ id: "op-il7", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    mustThrow(() => transition(op, { to: "confirming", now: NOW + 1, expectedVersion: op.version }), "illegal");
  });

  it("rejects confirmed → reconciled (skip indexed)", () => {
    let op = createOperation({ id: "op-il8", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    op = advance(op, "processing");
    op = advance(op, "confirming");
    op = advance(op, "confirmed");
    mustThrow(() => transition(op, { to: "reconciled", now: NOW + 1, expectedVersion: op.version }), "illegal");
  });

  it("rejects terminal states from advancing (completed, expired, cancelled, failed_terminal, reverted)", () => {
    let op = createOperation({ id: "op-term", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    op = advance(op, "processing");
    op = advance(op, "confirming");
    op = advance(op, "confirmed");
    op = advance(op, "indexed");
    op = advance(op, "reconciled");
    op = advance(op, "completed");
    mustThrow(() => transition(op, { to: "ready", now: NOW + 99, expectedVersion: op.version }), "illegal");

    let op2 = createOperation({ id: "op-exp-term", now: NOW });
    op2 = advance(op2, "expired", { errorCode: "ERR-013" });
    mustThrow(() => transition(op2, { to: "ready", now: NOW + 99, expectedVersion: op2.version }), "illegal");

    let op3 = createOperation({ id: "op-rev-term", now: NOW });
    op3 = advance(op3, "awaiting_authorization");
    op3 = advance(op3, "ready");
    op3 = advance(op3, "submitted", { txHash: TX_HASH });
    op3 = advance(op3, "reverted", { errorCode: "ERR-007" });
    mustThrow(() => transition(op3, { to: "processing", now: NOW + 99, expectedVersion: op3.version }), "illegal");
  });
});

// ---------------------------------------------------------------------------
// Stale / unknown transition rejection
// ---------------------------------------------------------------------------

describe("stale and unknown transition rejection", () => {
  it("rejects stale version (ERR-023)", () => {
    let op = createOperation({ id: "op-stale1", now: NOW });
    op = advance(op, "awaiting_authorization");
    // op.version is 1, but caller supplies stale 0
    const err = mustThrow(() => transition(op, { to: "ready", now: NOW + 5, expectedVersion: 0 }), "stale_version");
    expect(err.code).toBe(OPERATION_ERROR_CODE.STALE_STATE_CONFLICT);
    expect(err.httpStatusHint).toBe(409);
  });

  it("rejects unknown to-state", () => {
    const op = createOperation({ id: "op-unk1", now: NOW });
    mustThrow(() => transition(op, { to: "nonexistent_state" as OperationState, now: NOW + 1, expectedVersion: 0 }), "unknown_to_state");
  });

  it("rejects unknown from-state", () => {
    const op = { ...createOperation({ id: "op-unk2", now: NOW }), state: "bogus" as OperationState };
    mustThrow(() => transition(op, { to: "ready", now: NOW + 1, expectedVersion: 0 }), "unknown_from_state");
  });

  it("rejects submitted without txHash", () => {
    let op = createOperation({ id: "op-nohash", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    mustThrow(() => transition(op, { to: "submitted", now: NOW + 1, expectedVersion: op.version }), "tx_hash_required");
  });

  it("rejects reverted without revert code", () => {
    let op = createOperation({ id: "op-norevert", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    mustThrow(() => transition(op, { to: "reverted", now: NOW + 1, expectedVersion: op.version }), "revert_code_required");
  });

  it("rejects failed_retryable without errorCode", () => {
    let op = createOperation({ id: "op-noerr", now: NOW });
    op = advance(op, "awaiting_authorization");
    mustThrow(() => transition(op, { to: "failed_retryable", now: NOW + 1, expectedVersion: op.version }), "error_code_required");
  });

  it("rejects malformed txHash", () => {
    let op = createOperation({ id: "op-badhash", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    mustThrow(
      () => transition(op, { to: "submitted", now: NOW + 1, expectedVersion: op.version, txHash: "0x123" as Hex }),
      "malformed_tx_hash",
    );
  });
});

// ---------------------------------------------------------------------------
// Idempotent same-state facts where System spec permits them
// ---------------------------------------------------------------------------

describe("idempotent same-state facts", () => {
  it("allows idempotent re-apply for RPC polling states (submitted)", () => {
    let op = createOperation({ id: "op-idem1", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    const { operation: op2, idempotent } = transition(op, {
      to: "submitted",
      now: NOW + 10,
      expectedVersion: op.version,
      txHash: TX_HASH,
    });
    expect(idempotent).toBe(true);
    expect(op2.version).toBe(op.version);
    expect(op2.txHash).toBe(TX_HASH);
  });

  it("allows idempotent for confirmed, indexed, reconciled, completed", () => {
    let op = createOperation({ id: "op-idem2", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    op = advance(op, "processing");
    op = advance(op, "confirming");
    op = advance(op, "confirmed");
    // idempotent confirmed
    let r = transition(op, { to: "confirmed", now: NOW + 10, expectedVersion: op.version, txHash: TX_HASH });
    expect(r.idempotent).toBe(true);
    expect(r.operation.version).toBe(op.version);

    op = advance(op, "indexed");
    r = transition(op, { to: "indexed", now: NOW + 11, expectedVersion: op.version, txHash: TX_HASH });
    expect(r.idempotent).toBe(true);

    op = advance(op, "reconciled");
    r = transition(op, { to: "reconciled", now: NOW + 12, expectedVersion: op.version, txHash: TX_HASH });
    expect(r.idempotent).toBe(true);

    op = advance(op, "completed");
    r = transition(op, { to: "completed", now: NOW + 13, expectedVersion: op.version });
    expect(r.idempotent).toBe(true);
    expect(r.operation.version).toBe(op.version);
  });

  it("allows idempotent for terminal failures (failed_terminal, reverted, expired, cancelled)", () => {
    let op = createOperation({ id: "op-idem-term", now: NOW });
    op = advance(op, "failed_terminal", { errorCode: "ERR-004" });
    let r = transition(op, { to: "failed_terminal", now: NOW + 5, expectedVersion: op.version, errorCode: "ERR-004" });
    expect(r.idempotent).toBe(true);

    let op2 = createOperation({ id: "op-idem-rev", now: NOW });
    op2 = advance(op2, "awaiting_authorization");
    op2 = advance(op2, "ready");
    op2 = advance(op2, "submitted", { txHash: TX_HASH });
    op2 = advance(op2, "reverted", { errorCode: "ERR-007" });
    r = transition(op2, { to: "reverted", now: NOW + 5, expectedVersion: op2.version, errorCode: "ERR-007" });
    expect(r.idempotent).toBe(true);
  });

  it("rejects idempotent when txHash diverges", () => {
    let op = createOperation({ id: "op-idem-div", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    mustThrow(
      () => transition(op, { to: "submitted", now: NOW + 10, expectedVersion: op.version, txHash: TX_HASH_2 }),
      "idempotent_tx_hash_mismatch",
    );
  });

  it("rejects idempotent when errorCode diverges", () => {
    let op = createOperation({ id: "op-idem-err", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "failed_retryable", { errorCode: "ERR-021" });
    mustThrow(
      () => transition(op, { to: "failed_retryable", now: NOW + 5, expectedVersion: op.version, errorCode: "ERR-004" }),
      "idempotent_error_code_mismatch",
    );
  });

  it("rejects same-state for early workflow states not in IDEMPOTENT set (created)", () => {
    const op = createOperation({ id: "op-idem-created", now: NOW });
    mustThrow(() => transition(op, { to: "created", now: NOW + 1, expectedVersion: op.version }), "same_state_not_idempotent");
  });
});

// ---------------------------------------------------------------------------
// Retry / recovery
// ---------------------------------------------------------------------------

describe("retry and recovery", () => {
  it("failed_retryable can retry to ready and resume happy path", () => {
    let op = createOperation({ id: "op-retry1", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "failed_retryable", { errorCode: "ERR-021" });
    expect(isRetryableFailure(op.state)).toBe(true);
    // retry
    op = advance(op, "ready");
    expect(op.state).toBe("ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    op = advance(op, "processing");
    op = advance(op, "confirming");
    op = advance(op, "confirmed");
    op = advance(op, "indexed");
    op = advance(op, "reconciled");
    op = advance(op, "completed");
    expect(op.state).toBe("completed");
  });

  it("failed_retryable can escalate to failed_terminal", () => {
    let op = createOperation({ id: "op-retry2", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "failed_retryable", { errorCode: "ERR-021" });
    op = advance(op, "failed_terminal", { errorCode: "ERR-004" });
    expect(isTerminal(op.state)).toBe(true);
  });

  it("requires_attention can be resolved to processing (manual resume) and continue", () => {
    let op = createOperation({ id: "op-ra-recover", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    op = advance(op, "requires_attention", { errorCode: "ERR-022" });
    // operator resumes polling
    op = advance(op, "processing");
    op = advance(op, "confirming");
    op = advance(op, "confirmed");
    op = advance(op, "indexed");
    op = advance(op, "reconciled");
    op = advance(op, "completed");
    expect(op.state).toBe("completed");
  });

  it("requires_attention can resolve to failed_retryable or cancelled", () => {
    let op = createOperation({ id: "op-ra-fr", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    op = advance(op, "requires_attention", { errorCode: "ERR-022" });
    op = advance(op, "failed_retryable", { errorCode: "ERR-021" });
    expect(op.state).toBe("failed_retryable");

    let op2 = createOperation({ id: "op-ra-cancel", now: NOW });
    op2 = advance(op2, "awaiting_authorization");
    op2 = advance(op2, "ready");
    op2 = advance(op2, "submitted", { txHash: TX_HASH });
    op2 = advance(op2, "requires_attention", { errorCode: "ERR-022" });
    op2 = advance(op2, "cancelled", { errorCode: "ERR-011" });
    expect(op2.state).toBe("cancelled");
  });

  it("canTransition reflects retry affordances", () => {
    expect(canTransition("failed_retryable", "ready")).toBe(true);
    expect(canTransition("failed_retryable", "failed_terminal")).toBe(true);
    expect(canTransition("failed_terminal", "ready")).toBe(false);
    expect(canTransition("reverted", "ready")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// submitted-is-not-completed invariant (INV-SYS-005)
// ---------------------------------------------------------------------------

describe("submitted-is-not-completed invariant", () => {
  const preCompletion: OperationState[] = ["submitted", "processing", "confirming", "confirmed"];
  for (const from of preCompletion) {
    it(`prevents ${from} → completed`, () => {
      let op = createOperation({ id: `op-inv-${from}`, now: NOW });
      // drive to that state
      op = advance(op, "awaiting_authorization");
      op = advance(op, "ready");
      op = advance(op, "submitted", { txHash: TX_HASH });
      if (from === "processing" || from === "confirming" || from === "confirmed") {
        op = advance(op, "processing");
      }
      if (from === "confirming" || from === "confirmed") {
        op = advance(op, "confirming");
      }
      if (from === "confirmed") {
        op = advance(op, "confirmed");
      }
      // now op.state === from
      expect(op.state).toBe(from);
      const err = mustThrow(() => transition(op, { to: "completed", now: NOW + 99, expectedVersion: op.version }));
      expect(err.message).toMatch(/submitted_is_not_completed|illegal_skip_to_completed/);
    });
  }

  it("only reconciled may become completed", () => {
    expect(canTransition("reconciled", "completed")).toBe(true);
    expect(canTransition("indexed", "completed")).toBe(false);
    expect(canTransition("confirmed", "completed")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stable failure/error semantics & versioning
// ---------------------------------------------------------------------------

describe("stable failure semantics", () => {
  it("preserves errorCode across non-error transitions when not overwritten", () => {
    let op = createOperation({ id: "op-err-pres", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "failed_retryable", { errorCode: "ERR-021", errorDetail: "rpc_down" });
    expect(op.errorCode).toBe("ERR-021");
    // retry to ready should retain error metadata unless explicitly cleared;
    // current impl preserves previous errorCode if not supplied — caller may
    // clear by passing null explicitly. Verify preservation.
    const prevCode = op.errorCode;
    op = advance(op, "ready");
    expect(op.errorCode).toBe(prevCode);
  });

  it("increments version on each forward transition", () => {
    let op = createOperation({ id: "op-ver", now: NOW });
    expect(op.version).toBe(0);
    op = advance(op, "awaiting_authorization");
    expect(op.version).toBe(1);
    op = advance(op, "ready");
    expect(op.version).toBe(2);
    op = advance(op, "submitted", { txHash: TX_HASH });
    expect(op.version).toBe(3);
  });

  it("does not increment version on idempotent same-state", () => {
    let op = createOperation({ id: "op-ver-idem", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    const vBefore = op.version;
    const { operation: op2, idempotent } = transition(op, {
      to: "submitted",
      now: NOW + 99,
      expectedVersion: op.version,
      txHash: TX_HASH,
    });
    expect(idempotent).toBe(true);
    expect(op2.version).toBe(vBefore);
  });
});

// ---------------------------------------------------------------------------
// Reconciliation pure policy (typed boundary, no fake worker)
// ---------------------------------------------------------------------------

describe("reconciliation port — pure policy", () => {
  it("submitted with no chain facts stays (poll again)", () => {
    let op = createOperation({ id: "op-rec1", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    const d = decideReconciliationStep(op, { chain: null, indexer: null, reconciliation: null });
    expect(d.nextState).toBeNull();
    expect(d.reason).toContain("awaiting_chain");
  });

  it("requires_attention recovers into processing when chain facts become available", () => {
    let op = createOperation({ id: "op-rec-recover", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    op = advance(op, "requires_attention", { errorCode: "ERR-022" });
    const d = decideReconciliationStep(op, {
      chain: { txHash: TX_HASH, finality: "ACCEPTED_ON_L2", execution: "SUCCEEDED", blockNumber: 100 },
      indexer: null,
      reconciliation: null,
    });
    expect(d.nextState).toBe("processing");
    expect(d.reason).toBe("requires_attention_recovered_chain");
  });

  it("requires_attention can resume at reconciled only with an exact receipt/event match", () => {
    let op = createOperation({ id: "op-rec-reconciled", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    op = advance(op, "requires_attention", { errorCode: "ERR-022" });
    const d = decideReconciliationStep(op, {
      chain: { txHash: TX_HASH, finality: "ACCEPTED_ON_L1", execution: "SUCCEEDED", blockNumber: 100 },
      indexer: null,
      reconciliation: { chainReceiptMatched: true, eventMatchedToOperation: true, matchedTxHash: TX_HASH },
    });
    expect(d.nextState).toBe("reconciled");
    expect(d.authoritativeSource).toBe(AUTHORITATIVE_SOURCE.reconciled);
  });

  it("submitted with SUCCEEDED ACCEPTED_ON_L2 advances to processing", () => {
    let op = createOperation({ id: "op-rec2", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    const d = decideReconciliationStep(op, {
      chain: { txHash: TX_HASH, finality: "ACCEPTED_ON_L2", execution: "SUCCEEDED", blockNumber: 100 },
      indexer: null,
      reconciliation: null,
    });
    expect(d.nextState).toBe("processing");
    expect(d.authoritativeSource).toBe(AUTHORITATIVE_SOURCE.processing);
  });

  it("confirming with REVERTED maps to reverted (TR-O2)", () => {
    let op = createOperation({ id: "op-rec3", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    op = advance(op, "processing");
    op = advance(op, "confirming");
    const d = decideReconciliationStep(op, {
      chain: { txHash: TX_HASH, finality: "ACCEPTED_ON_L2", execution: "REVERTED", revertCode: "ERR-007" },
      indexer: null,
      reconciliation: null,
    });
    expect(d.nextState).toBe("reverted");
    expect(d.authoritativeSource).toBe(AUTHORITATIVE_SOURCE.reverted);
  });

  it("confirmed with indexer event advances to indexed", () => {
    let op = createOperation({ id: "op-rec4", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    op = advance(op, "processing");
    op = advance(op, "confirming");
    op = advance(op, "confirmed");
    const d = decideReconciliationStep(op, {
      chain: null,
      indexer: { txHash: TX_HASH, eventObserved: true, eventName: "ExecutionIdentityBound", blockNumber: 101, eventIndex: 0 },
      reconciliation: null,
    });
    expect(d.nextState).toBe("indexed");
    expect(d.authoritativeSource).toBe(AUTHORITATIVE_SOURCE.indexed);
  });

  it("indexed with reconciliation match advances to reconciled", () => {
    let op = createOperation({ id: "op-rec5", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    op = advance(op, "processing");
    op = advance(op, "confirming");
    op = advance(op, "confirmed");
    op = advance(op, "indexed");
    const d = decideReconciliationStep(op, {
      chain: null,
      indexer: null,
      reconciliation: { chainReceiptMatched: true, eventMatchedToOperation: true, matchedTxHash: TX_HASH },
    });
    expect(d.nextState).toBe("reconciled");
  });

  it("reconciled with reconciliation match advances to completed (receipt_issued)", () => {
    let op = createOperation({ id: "op-rec6", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    op = advance(op, "processing");
    op = advance(op, "confirming");
    op = advance(op, "confirmed");
    op = advance(op, "indexed");
    op = advance(op, "reconciled");
    const d = decideReconciliationStep(op, {
      chain: null,
      indexer: null,
      reconciliation: { chainReceiptMatched: true, eventMatchedToOperation: true, matchedTxHash: TX_HASH },
    });
    expect(d.nextState).toBe("completed");
    expect(d.authoritativeSource).toBe(AUTHORITATIVE_SOURCE.completed);
  });

  it("blocks indexed reconciliation when the observed receipt hash is ambiguous or mismatched", () => {
    let op = createOperation({ id: "op-rec5-mismatch", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    op = advance(op, "processing");
    op = advance(op, "confirming");
    op = advance(op, "confirmed");
    op = advance(op, "indexed");

    for (const matchedTxHash of [null, TX_HASH_2]) {
      const d = decideReconciliationStep(op, {
        chain: null,
        indexer: null,
        reconciliation: { chainReceiptMatched: true, eventMatchedToOperation: true, matchedTxHash },
      });
      expect(d.nextState).toBeNull();
      expect(d.reason).toBe("awaiting_reconciliation_match");
    }
  });

  it("blocks completion when the observed receipt hash does not match the operation", () => {
    let op = createOperation({ id: "op-rec6-mismatch", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    op = advance(op, "processing");
    op = advance(op, "confirming");
    op = advance(op, "confirmed");
    op = advance(op, "indexed");
    op = advance(op, "reconciled");
    const d = decideReconciliationStep(op, {
      chain: null,
      indexer: null,
      reconciliation: { chainReceiptMatched: true, eventMatchedToOperation: true, matchedTxHash: TX_HASH_2 },
    });
    expect(d.nextState).toBeNull();
    expect(d.reason).toBe("awaiting_receipt_issue");
  });

  it("terminal states never advance via reconciliation", () => {
    let op = createOperation({ id: "op-rec-term", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    op = advance(op, "processing");
    op = advance(op, "confirming");
    op = advance(op, "confirmed");
    op = advance(op, "indexed");
    op = advance(op, "reconciled");
    op = advance(op, "completed");
    const d = decideReconciliationStep(op, {
      chain: { txHash: TX_HASH, finality: "ACCEPTED_ON_L2", execution: "SUCCEEDED" },
      indexer: { txHash: TX_HASH, eventObserved: true },
      reconciliation: { chainReceiptMatched: true, eventMatchedToOperation: true },
    });
    expect(d.nextState).toBeNull();
    expect(d.reason).toContain("terminal");
  });

  it("does not fabricate chain truth: mismatched txHash yields no advance", () => {
    let op = createOperation({ id: "op-rec-mismatch", now: NOW });
    op = advance(op, "awaiting_authorization");
    op = advance(op, "ready");
    op = advance(op, "submitted", { txHash: TX_HASH });
    const d = decideReconciliationStep(op, {
      chain: { txHash: TX_HASH_2, finality: "ACCEPTED_ON_L2", execution: "SUCCEEDED" },
      indexer: null,
      reconciliation: null,
    });
    expect(d.nextState).toBeNull();
  });
});
