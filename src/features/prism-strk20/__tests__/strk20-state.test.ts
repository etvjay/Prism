import { describe, it, expect } from "vitest";
import { createFlow, transition, MATURITY_BLOCKS } from "../domain/strk20-state";

// X2 — TEST DOUBLE: pure state machine, no RPC, no wallet
describe("M4 STRK20 State Machine — 12 explicit states X2", () => {
  const now = 1_000_000;

  it("starts at capability_unknown", () => {
    const f = createFlow({ id: "f1", now });
    expect(f.state).toBe("capability_unknown");
  });

  it("allows capability_unknown -> mismatch and back to capability_unknown", () => {
    let f = createFlow({ id: "f2", now });
    let r = transition(f, { to: "mismatch", now: now + 1 });
    expect(r.flow.state).toBe("mismatch");
    f = r.flow;
    r = transition(f, { to: "capability_unknown", now: now + 2 });
    expect(r.flow.state).toBe("capability_unknown");
  });

  it("full happy path: capability_unknown -> registration_required -> approval_pending -> shielding -> confirmed -> maturing -> privately_available -> transfer_pending -> transfer_confirmed", () => {
    let f = createFlow({ id: "happy", now });
    f = transition(f, { to: "registration_required", now: now + 1 }).flow;
    f = transition(f, { to: "approval_pending", now: now + 2 }).flow;
    f = transition(f, { to: "shielding", now: now + 3, shieldTxHash: "0x0000000000000000000000000000000000000000000000000000000000000001" }).flow;
    expect(f.state).toBe("shielding");
    f = transition(f, { to: "confirmed", now: now + 4, confirmedBlock: 100 }).flow;
    expect(f.maturityTargetBlock).toBe(100 + MATURITY_BLOCKS);
    f = transition(f, { to: "maturing", now: now + 5 }).flow;
    expect(f.state).toBe("maturing");
    f = transition(f, { to: "privately_available", now: now + 6, currentBlock: 110, balanceConsent: "granted" }).flow;
    expect(f.state).toBe("privately_available");
    f = transition(f, { to: "transfer_pending", now: now + 7, transferTxHash: "0x0000000000000000000000000000000000000000000000000000000000000002" }).flow;
    f = transition(f, { to: "transfer_confirmed", now: now + 8 }).flow;
    expect(f.state).toBe("transfer_confirmed");
  });

  it("maturity guard: need 10 blocks before privately_available", () => {
    let f = createFlow({ id: "mat", now });
    f = transition(f, { to: "registration_required", now: now + 1 }).flow;
    f = transition(f, { to: "approval_pending", now: now + 2 }).flow;
    f = transition(f, { to: "shielding", now: now + 3, shieldTxHash: "0x0000000000000000000000000000000000000000000000000000000000000001" }).flow;
    f = transition(f, { to: "confirmed", now: now + 4, confirmedBlock: 100 }).flow;
    f = transition(f, { to: "maturing", now: now + 5 }).flow;
    expect(() => transition(f, { to: "privately_available", now: now + 6, currentBlock: 105, balanceConsent: "granted" })).toThrow(/maturity_pending/);
    expect(() => transition(f, { to: "privately_available", now: now + 6, currentBlock: 109, balanceConsent: "granted" })).toThrow();
    const r = transition(f, { to: "privately_available", now: now + 6, currentBlock: 110, balanceConsent: "granted" });
    expect(r.flow.state).toBe("privately_available");
  });

  it("consent gate: privately_available requires granted consent", () => {
    let f = createFlow({ id: "cons", now });
    f = transition(f, { to: "registration_required", now: now + 1 }).flow;
    f = transition(f, { to: "approval_pending", now: now + 2 }).flow;
    f = transition(f, { to: "shielding", now: now + 3, shieldTxHash: "0x0000000000000000000000000000000000000000000000000000000000000001" }).flow;
    f = transition(f, { to: "confirmed", now: now + 4, confirmedBlock: 50 }).flow;
    f = transition(f, { to: "maturing", now: now + 5 }).flow;
    expect(() => transition(f, { to: "privately_available", now: now + 6, currentBlock: 60, balanceConsent: "denied" })).toThrow(/consent_denied|denied/);
    expect(() => transition(f, { to: "privately_available", now: now + 6, currentBlock: 60, balanceConsent: "required" })).toThrow(/consent_required/);
    expect(() => transition(f, { to: "privately_available", now: now + 6, currentBlock: 60 })).toThrow(/consent_required/);
  });

  it("rejected requires reason", () => {
    let f = createFlow({ id: "rej", now });
    f = transition(f, { to: "registration_required", now: now + 1 }).flow;
    f = transition(f, { to: "approval_pending", now: now + 2 }).flow;
    expect(() => transition(f, { to: "rejected", now: now + 3 })).toThrow(/rejection_reason_required/);
    const r = transition(f, { to: "rejected", now: now + 3, rejectionReason: "screening_rejected", screening: "rejected", errorCode: "STRK20-006" });
    expect(r.flow.state).toBe("rejected");
  });

  it("enforces tx hashes for shielding and transfer_pending", () => {
    let f = createFlow({ id: "txh", now });
    f = transition(f, { to: "registration_required", now: now + 1 }).flow;
    f = transition(f, { to: "approval_pending", now: now + 2 }).flow;
    expect(() => transition(f, { to: "shielding", now: now + 3 })).toThrow(/shield_tx_required/);
  });

  it("fee change guard throws on mismatched quoted vs observed", () => {
    let f = createFlow({ id: "fee", now });
    f = transition(f, { to: "registration_required", now: now + 1 }).flow;
    f = transition(f, { to: "approval_pending", now: now + 2 }).flow;
    expect(() => transition(f, { to: "shielding", now: now + 3, shieldTxHash: "0x0000000000000000000000000000000000000000000000000000000000000001", quotedFee: 4n, observedFee: 5n })).toThrow(/fee_changed/);
  });

  it("stale version throws", () => {
    const f = createFlow({ id: "stale", now });
    const r = transition(f, { to: "registration_required", now: now + 1 });
    expect(() => transition(r.flow, { to: "approval_pending", now: now + 2, expectedVersion: 0 })).toThrow(/stale_version/);
  });

  it("illegal transition throws", () => {
    const f = createFlow({ id: "ill", now });
    expect(() => transition(f, { to: "transfer_confirmed", now: now + 1 })).toThrow(/illegal/);
  });

  it("dependency_failure recovery to capability_unknown", () => {
    let f = createFlow({ id: "dep", now });
    f = transition(f, { to: "registration_required", now: now + 1 }).flow;
    f = transition(f, { to: "dependency_failure", now: now + 2, errorCode: "STRK20-013" }).flow;
    expect(f.state).toBe("dependency_failure");
    const r = transition(f, { to: "capability_unknown", now: now + 3 });
    expect(r.flow.state).toBe("capability_unknown");
  });

  it("screening rejected path from shielding", () => {
    let f = createFlow({ id: "screen", now });
    f = transition(f, { to: "registration_required", now: now + 1 }).flow;
    f = transition(f, { to: "approval_pending", now: now + 2 }).flow;
    f = transition(f, { to: "shielding", now: now + 3, shieldTxHash: "0x0000000000000000000000000000000000000000000000000000000000000001" }).flow;
    f = transition(f, { to: "rejected", now: now + 4, screening: "rejected", rejectionReason: "compliance_screening_rejected", errorCode: "STRK20-006" }).flow;
    expect(f.state).toBe("rejected");
  });

  it("idempotent re-apply for shielding/maturing/transfer_pending", () => {
    let f = createFlow({ id: "idem", now });
    f = transition(f, { to: "registration_required", now: now + 1 }).flow;
    f = transition(f, { to: "approval_pending", now: now + 2 }).flow;
    f = transition(f, { to: "shielding", now: now + 3, shieldTxHash: "0x0000000000000000000000000000000000000000000000000000000000000001" }).flow;
    const r = transition(f, { to: "shielding", now: now + 4, shieldTxHash: "0x0000000000000000000000000000000000000000000000000000000000000001" });
    expect(r.idempotent).toBe(true);
    expect(r.flow.version).toBe(f.version);
  });
});
