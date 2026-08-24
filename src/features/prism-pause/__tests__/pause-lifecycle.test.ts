import { describe, it, expect } from "vitest";
import { createPause, toVerifying, completeVerification, release, cancel, expire, escalate, approveEscalation, reverify, computeApprovalScopeHash } from "../domain/pause";
import { makeCheck, CHECK_ID } from "../domain/checks";
import { PAUSE_REASON_CODE } from "../domain/errors";

function freshPause() {
  return createPause({ pauseId: "pause_1", intentId: "intent_1", planHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`, policyVersion: "v1", createdAt: 1000, expiresAt: 10_000 });
}

describe("P2 Pause state machine", () => {
  it("PAUSED -> VERIFYING -> RELEASE_READY with passing checks", () => {
    let p = freshPause();
    p = toVerifying(p, 1500, 0);
    expect(p.state).toBe("VERIFYING");
    const checks = [makeCheck(CHECK_ID.CHAIN_ALLOWED, "PASS", "BLOCKING", PAUSE_REASON_CODE.CHAIN_NOT_ALLOWED, "policy", 1500, "base", "allowed")];
    // Use a passing set (no blocking failures)
    const passing = [makeCheck(CHECK_ID.CHAIN_ALLOWED, "PASS", "BLOCKING", PAUSE_REASON_CODE.CHAIN_NOT_ALLOWED, "policy", 1500)];
    // completeVerification with no blocking -> RELEASE_READY
    const ready = completeVerification(p, { checks: [makeCheck(CHECK_ID.AMOUNT_CEILING, "PASS", "BLOCKING", PAUSE_REASON_CODE.AMOUNT_CEILING, "policy", 1500)], now: 1600, expectedVersion: 1 });
    expect(ready.state).toBe("RELEASE_READY");
  });

  it("VERIFYING with blocking FAIL -> ESCALATED (fail-closed)", () => {
    let p = freshPause();
    p = toVerifying(p, 1500, 0);
    const failing = [makeCheck(CHECK_ID.CHAIN_ALLOWED, "FAIL", "BLOCKING", PAUSE_REASON_CODE.CHAIN_NOT_ALLOWED, "policy", 1500, "evil", "allowed")];
    const next = completeVerification(p, { checks: failing, now: 1600, expectedVersion: 1 });
    expect(next.state).toBe("ESCALATED");
  });

  it("UNKNOWN blocking prevents RELEASE_READY", () => {
    let p = freshPause();
    p = toVerifying(p, 1500, 0);
    const unknown = [makeCheck(CHECK_ID.SIM_SUCCESS, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.SIMULATION_UNKNOWN, "simulator", 1500)];
    const next = completeVerification(p, { checks: unknown, now: 1600, expectedVersion: 1 });
    expect(next.state).toBe("ESCALATED");
    expect(next.riskLevel).toBe("UNKNOWN");
  });

  it("RELEASED creates future Operation link only (not completed)", () => {
    let p = freshPause();
    p = toVerifying(p, 1500, 0);
    p = completeVerification(p, { checks: [makeCheck(CHECK_ID.AMOUNT_CEILING, "PASS", "BLOCKING", PAUSE_REASON_CODE.AMOUNT_CEILING, "policy", 1600)], now: 1600, expectedVersion: 1 });
    expect(p.state).toBe("RELEASE_READY");
    const released = release(p, { planHash: p.planHash, settlementOperationId: "op_future_123", now: 1700, expectedVersion: 2 });
    expect(released.state).toBe("RELEASED");
    expect(released.settlementOperationId).toBe("op_future_123");
    // RELEASED does NOT mean completed — settlementOperationId is just a link
  });

  it("illegal transitions blocked", () => {
    let p = freshPause();
    // CANCELLED -> RELEASED illegal
    p = cancel(p, { now: 1500, expectedVersion: 0 });
    expect(p.state).toBe("CANCELLED");
    expect(() => release(p as unknown as ReturnType<typeof freshPause>, { planHash: p.planHash, settlementOperationId: "op", now: 1600, expectedVersion: 1 })).toThrow();
  });

  it("EXPIRED cannot release", () => {
    let p = freshPause();
    p = expire(p, 11_000);
    expect(p.state).toBe("EXPIRED");
    expect(() => release(p, { planHash: p.planHash, settlementOperationId: "op", now: 11_000, expectedVersion: 1 })).toThrow();
  });

  it("RELEASED cannot cancel", () => {
    let p = freshPause();
    p = toVerifying(p, 1500, 0);
    p = completeVerification(p, { checks: [makeCheck(CHECK_ID.AMOUNT_CEILING, "PASS", "BLOCKING", PAUSE_REASON_CODE.AMOUNT_CEILING, "policy", 1600)], now: 1600, expectedVersion: 1 });
    p = release(p, { planHash: p.planHash, settlementOperationId: "op1", now: 1700, expectedVersion: 2 });
    expect(() => cancel(p, { now: 1800, expectedVersion: 3 })).toThrow();
  });

  it("plan mutation after approval invalidates -> requires reverify", () => {
    let p = freshPause();
    p = toVerifying(p, 1500, 0);
    p = completeVerification(p, { checks: [makeCheck(CHECK_ID.AMOUNT_CEILING, "FAIL", "BLOCKING", PAUSE_REASON_CODE.AMOUNT_CEILING, "policy", 1600)], now: 1600, expectedVersion: 1 });
    expect(p.state).toBe("ESCALATED");
    // approve with correct hash succeeds
    const scope = computeApprovalScopeHash(p.pauseId, p.planHash, p.policyVersion);
    const approved = approveEscalation(p, { planHash: p.planHash, approvalScopeHash: scope, now: 1700, expectedVersion: 2 });
    expect(approved.state).toBe("RELEASE_READY");
    // wrong plan hash fails
    expect(() => approveEscalation(p, { planHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as `0x${string}`, approvalScopeHash: scope, now: 1700, expectedVersion: 2 })).toThrow();
  });

  it("reverify from RELEASE_READY goes to VERIFYING", () => {
    let p = freshPause();
    p = toVerifying(p, 1500, 0);
    p = completeVerification(p, { checks: [makeCheck(CHECK_ID.AMOUNT_CEILING, "PASS", "BLOCKING", PAUSE_REASON_CODE.AMOUNT_CEILING, "policy", 1600)], now: 1600, expectedVersion: 1 });
    const rev = reverify(p, { now: 1650, expectedVersion: 2 });
    expect(rev.state).toBe("VERIFYING");
  });

  it("escalate requires approval count", () => {
    let p = freshPause();
    p = toVerifying(p, 1500, 0);
    p = completeVerification(p, { checks: [makeCheck(CHECK_ID.AMOUNT_CEILING, "PASS", "BLOCKING", PAUSE_REASON_CODE.AMOUNT_CEILING, "policy", 1600)], now: 1600, expectedVersion: 1 });
    // from RELEASE_READY can escalate
    const esc = escalate(p, { reasonCodes: ["PAUSE-RISK-001"], requiredApprovalCount: 1, now: 1700, expectedVersion: 2 });
    expect(esc.state).toBe("ESCALATED");
  });
});
