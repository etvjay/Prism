import { describe, it, expect } from "vitest";
import { PauseError, PAUSE_ERROR_CODE, PAUSE_REASON_CODE } from "../domain/errors";
import { createIntent } from "../domain/intent";
import { createExecutionPlan } from "../domain/execution-plan";
import { createPause, release } from "../domain/pause";
import { makeCheck, CHECK_ID } from "../domain/checks";

describe("stable error/reason catalogue and fail-closed UNKNOWN", () => {
  it("error catalogue codes are stable and mapped", () => {
    const e = new PauseError(PAUSE_ERROR_CODE.PLAN_HASH_MISMATCH, "test");
    expect(e.code).toBe("ERR-102");
    expect(e.httpStatusHint).toBe(409);
    expect(e.toExternalShape().code).toBe("ERR-102");
  });

  it("reason codes are stable", () => {
    expect(PAUSE_REASON_CODE.RECIPIENT_NOT_BOUND_OR_REVOKED).toBe("PAUSE-RECIPIENT-002");
    expect(PAUSE_REASON_CODE.SIMULATION_UNKNOWN).toBe("PAUSE-SIM-004");
  });

  it("UNKNOWN blocking check fails closed (no auto-release)", async () => {
    const pause = createPause({ pauseId: "p1", intentId: "i1", planHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`, policyVersion: "v1", createdAt: 1000, expiresAt: 10_000 });
    // manually craft a pause in RELEASE_READY but with UNKNOWN blocking check -> release should be blocked at domain guard
    const unknownPause = { ...pause, state: "RELEASE_READY" as const, version: 2, checks: [makeCheck(CHECK_ID.SIM_SUCCESS, "UNKNOWN", "BLOCKING", PAUSE_REASON_CODE.SIMULATION_UNKNOWN, "simulator", 1500)], reasonCodes: [PAUSE_REASON_CODE.SIMULATION_UNKNOWN], riskLevel: "UNKNOWN" as const, approvalScopeHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as `0x${string}`, lastVerifiedAt: 1500 };
    expect(() => release(unknownPause, { planHash: pause.planHash, settlementOperationId: "op", now: 1600, expectedVersion: 2 })).toThrow();
  });

  it("malformed plan hash rejected with stable code", () => {
    expect(() => createPause({ pauseId: "p2", intentId: "i1", planHash: "bad" as `0x${string}`, policyVersion: "v1", createdAt: 1000, expiresAt: 2000 })).toThrow();
    try { createPause({ pauseId: "p2", intentId: "i1", planHash: "bad" as `0x${string}`, policyVersion: "v1", createdAt: 1000, expiresAt: 2000 }); } catch (e) { expect((e as PauseError).code).toBeDefined(); }
  });

  it("no opaque risk score: checks are typed", () => {
    const c = makeCheck(CHECK_ID.CHAIN_ALLOWED, "PASS", "BLOCKING", PAUSE_REASON_CODE.CHAIN_NOT_ALLOWED, "policy", Date.now());
    expect(c.checkId).toBeTruthy();
    expect(c.status).toBeTruthy();
    expect(c.severity).toBeTruthy();
    expect(c.reasonCode).toBeTruthy();
  });
});
