import { describe, it, expect } from "vitest";
import { computeMaxSpendable, assertFeeUnchanged, decideFeeAction, assertAmountWithFee } from "../domain/fee-policy";

// X2 — TEST DOUBLE: pure fee logic
describe("M4 Fee Policy — X2", () => {
  it("MAX reserves fee", () => {
    expect(computeMaxSpendable(100n, 4n)).toBe(96n);
    expect(computeMaxSpendable(4n, 4n)).toBe(0n);
    expect(computeMaxSpendable(3n, 4n)).toBe(0n);
  });

  it("rejects amounts that would exceed balance with fee", () => {
    expect(() => assertAmountWithFee({ amount: 97n, fee: 4n, balance: 100n })).toThrow(/insufficient_for_fee/);
    expect(() => assertAmountWithFee({ amount: 96n, fee: 4n, balance: 100n })).not.toThrow();
  });

  it("detects fee change", () => {
    const quoted = { fee: 4n, quotedAtBlock: 10, quotedAtTime: 1000 };
    expect(() => assertFeeUnchanged(quoted, 5n)).toThrow(/fee_changed/);
    expect(() => assertFeeUnchanged(quoted, 4n)).not.toThrow();
  });

  it("decideFeeAction returns fee_changed vs ok", () => {
    const q = { fee: 4n, quotedAtBlock: 10, quotedAtTime: 1000 };
    expect(decideFeeAction(q, 4n)).toEqual({ ok: true, reason: "fee_unchanged" });
    expect(decideFeeAction(q, 5n).ok).toBe(false);
    expect(decideFeeAction(q, null).ok).toBe(false);
  });
});
