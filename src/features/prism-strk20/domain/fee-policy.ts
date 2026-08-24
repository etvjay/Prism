// Fee policy for STRK20 pool: live read, fee change detection, MAX calculation.
// Authority: STRK20_CONTEXT pool fees + STRK20_PRIVACY_PROFILE + wallet-api-route gotcha.
// Never hard-code fee; always read via injected FeePort (Wallet API boundary exposes getFee via pool call or wallet).

import { Strk20Error, STRK20_ERROR_CODE } from "./errors";

export type FeeAmount = bigint;

export interface FeeQuote {
  fee: FeeAmount;
  quotedAtBlock: number | null;
  quotedAtTime: number;
}

export interface FeePolicyInput {
  requestedAmount: FeeAmount;
  quotedFee: FeeQuote;
  currentFee: FeeAmount;
  maxBalance: FeeAmount;
}

/**
 * MAX calculation must reserve fee. Throws if amount violates fee-aware bounds.
 */
export function assertAmountWithFee(input: { amount: FeeAmount; fee: FeeAmount; balance: FeeAmount }): void {
  if (input.amount <= 0n) throw new Strk20Error(STRK20_ERROR_CODE.INVALID_AMOUNT, "amount_must_be_positive");
  if (input.fee < 0n) throw new Strk20Error(STRK20_ERROR_CODE.FEE_UNAVAILABLE, "negative_fee");
  if (input.amount + input.fee > input.balance) {
    throw new Strk20Error(STRK20_ERROR_CODE.INVALID_AMOUNT, "insufficient_for_fee");
  }
}

export function computeMaxSpendable(balance: FeeAmount, fee: FeeAmount): FeeAmount {
  if (fee < 0n) throw new Strk20Error(STRK20_ERROR_CODE.FEE_UNAVAILABLE, "negative_fee");
  if (balance <= fee) return 0n;
  return balance - fee;
}

/**
 * Detects fee change between quote and current read. Call before submitting transfer/shield.
 */
export function assertFeeUnchanged(quoted: FeeQuote, current: FeeAmount): void {
  if (quoted.fee !== current) {
    throw new Strk20Error(STRK20_ERROR_CODE.FEE_CHANGED, `quoted_${String(quoted.fee)}_current_${String(current)}`);
  }
}

/**
 * Pure fee-change decision helper: returns next action without I/O.
 */
export function decideFeeAction(quoted: FeeQuote, current: FeeAmount | null): { ok: boolean; reason: string } {
  if (current === null) return { ok: false, reason: "fee_unavailable" };
  if (quoted.fee !== current) return { ok: false, reason: `fee_changed:quoted_${String(quoted.fee)}_current_${String(current)}` };
  return { ok: true, reason: "fee_unchanged" };
}
