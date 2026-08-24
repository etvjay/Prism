// Focused REST Pause wiring tests — rigorous P0–P4 guards.
// Covers plan_hash binding, approval_scope_hash, CAS expectedVersion, UNKNOWN blocking, RELEASED != COMPLETED.
// Uses rigorous InMemoryPauseService adapter (delegates to domain PauseService).

import { describe, it, expect, beforeEach } from "vitest";
import { createIsolatedFactory, resetFactory } from "../factory";
import { PAUSE_ERROR_CODE } from "../../features/prism-pause/domain/errors";
import { computeApprovalScopeHash } from "../../features/prism-pause/domain/pause";
import { testPauseAuthorityResolver } from "../../features/prism-pause/__tests__/test-authority";

function createTestFactory() {
  return createIsolatedFactory(undefined, { pauseAuthorityResolver: testPauseAuthorityResolver });
}

const PRISM_ID = "prism:RESTTEST";

describe("Pause REST wiring — rigorous guards", () => {
  beforeEach(() => { resetFactory(); });

  it("default REST adapter fails closed when release/approval authority is not configured", async () => {
    const f = createIsolatedFactory();
    const intent = await f.pauseService.createIntent({ prismId: PRISM_ID, purpose: "payment", amount: "100", asset: "0xdead", recipientAddress: "0xabc", idempotencyKey: "idem-authority-open" });
    const pause = await f.pauseService.pauseIntent(intent.intentId);
    const verified = await f.pauseService.verifyPause(pause.pauseId);

    await expect(f.pauseService.releasePause(verified.pauseId, verified.version, { planHash: verified.planHash, settlementOperationId: "op-authority-open" })).rejects.toMatchObject({ code: PAUSE_ERROR_CODE.AUTHORITY_UNCONFIGURED });
    expect((await f.pauseService.getPause(verified.pauseId))?.state).toBe("RELEASE_READY");
    expect(await f.operationStore.getById("op-authority-open")).toBeUndefined();

    const blockedIntent = await f.pauseService.createIntent({ prismId: PRISM_ID, purpose: "payment", amount: "100", asset: "unknown_asset", recipientAddress: "unknown_recipient", idempotencyKey: "idem-approval-authority-open" });
    const blockedPause = await f.pauseService.pauseIntent(blockedIntent.intentId);
    const escalated = await f.pauseService.verifyPause(blockedPause.pauseId);
    await expect(f.pauseService.approvePause(escalated.pauseId, "claimed-controller")).rejects.toMatchObject({ code: PAUSE_ERROR_CODE.AUTHORITY_UNCONFIGURED });
    expect((await f.pauseService.getPause(escalated.pauseId))?.state).toBe("ESCALATED");
  });

  it("release with plan_hash mismatch fails ERR-102", async () => {
    const f = createTestFactory();
    const intent = await f.pauseService.createIntent({ prismId: PRISM_ID, purpose: "payment", amount: "100", asset: "0xdead", recipientAddress: "0xabc", idempotencyKey: "idem-plan-mismatch" });
    const pause = await f.pauseService.pauseIntent(intent.intentId);
    await f.pauseService.verifyPause(pause.pauseId);
    const wrongHash = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    await expect(f.pauseService.releasePause(pause.pauseId, null, { planHash: wrongHash })).rejects.toMatchObject({ code: PAUSE_ERROR_CODE.PLAN_HASH_MISMATCH });
  });

  it("release with approval_scope_hash mismatch fails ERR-104", async () => {
    const f = createTestFactory();
    const intent = await f.pauseService.createIntent({ prismId: PRISM_ID, purpose: "payment", amount: "100", asset: "0xdead", recipientAddress: "0xabc", idempotencyKey: "idem-approval-mismatch" });
    const pause = await f.pauseService.pauseIntent(intent.intentId);
    const verified = await f.pauseService.verifyPause(pause.pauseId);
    const correctScope = computeApprovalScopeHash(verified.pauseId, verified.planHash as `0x${string}`, "v1");
    const wrongScope = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    await expect(f.pauseService.releasePause(verified.pauseId, verified.version, { planHash: verified.planHash, approvalScopeHash: wrongScope })).rejects.toMatchObject({ code: PAUSE_ERROR_CODE.APPROVAL_SCOPE_MISMATCH });
    const released = await f.pauseService.releasePause(verified.pauseId, verified.version, { planHash: verified.planHash, approvalScopeHash: correctScope });
    expect(released.state).toBe("RELEASED");
  });

  it("verify with policyVersion mismatch fails ERR-103", async () => {
    const f = createTestFactory();
    const intent = await f.pauseService.createIntent({ prismId: PRISM_ID, purpose: "payment", amount: "100", asset: "0xdead", recipientAddress: "0xabc", idempotencyKey: "idem-policy-mismatch" });
    const pause = await f.pauseService.pauseIntent(intent.intentId);
    await expect(f.pauseService.verifyPause(pause.pauseId, { policyVersion: "v999" })).rejects.toMatchObject({ code: PAUSE_ERROR_CODE.POLICY_VERSION_MISMATCH });
  });

  it("UNKNOWN blocking — verify with unknown recipient escalates and release fails blocking", async () => {
    const f = createTestFactory();
    const intent = await f.pauseService.createIntent({ prismId: PRISM_ID, purpose: "payment", amount: "100", asset: "unknown_asset", recipientAddress: "unknown_recipient", idempotencyKey: "idem-unknown" });
    const pause = await f.pauseService.pauseIntent(intent.intentId);
    const verified = await f.pauseService.verifyPause(pause.pauseId);
    expect(verified.state).toBe("ESCALATED");
    expect(verified.riskLevel).toBe("UNKNOWN");
    const err = await f.pauseService.releasePause(verified.pauseId, verified.version).catch(e=>e);
    expect([PAUSE_ERROR_CODE.CHECK_UNKNOWN_BLOCKING, PAUSE_ERROR_CODE.RELEASE_NOT_READY].includes(err.code as never) || err.message.includes("blocking") || err.message.includes("RELEASE_READY")).toBe(true);
  });

  it("stale version/CAS on release fails ERR-111", async () => {
    const f = createTestFactory();
    const intent = await f.pauseService.createIntent({ prismId: PRISM_ID, purpose: "payment", amount: "100", asset: "0xdead", recipientAddress: "0xabc", idempotencyKey: "idem-cas-release" });
    const pause = await f.pauseService.pauseIntent(intent.intentId);
    const verified = await f.pauseService.verifyPause(pause.pauseId);
    const stale = verified.version - 1;
    await expect(f.pauseService.releasePause(verified.pauseId, stale)).rejects.toMatchObject({ code: PAUSE_ERROR_CODE.STALE_VERSION });
    const released = await f.pauseService.releasePause(verified.pauseId, verified.version);
    expect(released.state).toBe("RELEASED");
  });

  it("stale version/CAS on cancel fails ERR-111", async () => {
    const f = createTestFactory();
    const intent = await f.pauseService.createIntent({ prismId: PRISM_ID, purpose: "payment", amount: "100", asset: "0xdead", recipientAddress: "0xabc", idempotencyKey: "idem-cas-cancel" });
    const pause = await f.pauseService.pauseIntent(intent.intentId);
    await expect(f.pauseService.cancelPause(pause.pauseId, pause.version - 1 as unknown as number)).rejects.toMatchObject({ code: PAUSE_ERROR_CODE.STALE_VERSION });
    const cancelled = await f.pauseService.cancelPause(pause.pauseId, pause.version);
    expect(cancelled.state).toBe("CANCELLED");
  });

  it("RELEASED creates settlementOperationId only, not completed, and second release/cancel fails", async () => {
    const f = createTestFactory();
    const intent = await f.pauseService.createIntent({ prismId: PRISM_ID, purpose: "payment", amount: "100", asset: "0xdead", recipientAddress: "0xabc", idempotencyKey: "idem-released-semantics" });
    const pause = await f.pauseService.pauseIntent(intent.intentId);
    const verified = await f.pauseService.verifyPause(pause.pauseId);
    const released = await f.pauseService.releasePause(verified.pauseId, verified.version);
    expect(released.state).toBe("RELEASED");
    expect(released.settlementOperationId).toBeTruthy();
    expect(released.settlementOperationId).toMatch(/^op_future_/);
    const op = await f.operationStore.getById(released.settlementOperationId!);
    if (op) expect(op.state).not.toBe("completed");
    await expect(f.pauseService.releasePause(released.pauseId, released.version)).rejects.toThrow();
    await expect(f.pauseService.cancelPause(released.pauseId, released.version)).rejects.toThrow();
  });

  it("verify auto-promote is eliminated — verify stays VERIFYING or goes to ESCALATED/RELEASE_READY via policy engine, not fake auto-promote", async () => {
    const f = createTestFactory();
    const intent = await f.pauseService.createIntent({ prismId: PRISM_ID, purpose: "payment", amount: "10", asset: "0xdead", recipientAddress: "0xabc", idempotencyKey: "idem-verify-rigorous" });
    const pause = await f.pauseService.pauseIntent(intent.intentId);
    expect(pause.state).toBe("PAUSED");
    const verified = await f.pauseService.verifyPause(pause.pauseId);
    // Rigorous path: should be RELEASE_READY (passing) or ESCALATED (blocking), never skipping checks
    expect(["RELEASE_READY","ESCALATED"].includes(verified.state)).toBe(true);
    expect(verified.version).toBeGreaterThan(pause.version);
    expect(verified.lastVerifiedAt).not.toBeNull();
  });

  it("approve requires correct planHash binding", async () => {
    const f = createTestFactory();
    const intent = await f.pauseService.createIntent({ prismId: PRISM_ID, purpose: "payment", amount: "100", asset: "unknown_asset", recipientAddress: "unknown_recipient", idempotencyKey: "idem-approve-binding" });
    const pause = await f.pauseService.pauseIntent(intent.intentId);
    const escalated = await f.pauseService.verifyPause(pause.pauseId);
    expect(escalated.state).toBe("ESCALATED");
    const wrongHash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    await expect(f.pauseService.approvePause(escalated.pauseId, "approver1", { planHash: wrongHash })).rejects.toMatchObject({ code: PAUSE_ERROR_CODE.PLAN_HASH_MISMATCH });
  });
});
