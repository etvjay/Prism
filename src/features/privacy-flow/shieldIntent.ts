/**
 * Shield-intent form model: token + amount + fee-quote display + two-hash
 * receipt slots. Pure logic only — no wallet calls, no retained secrets.
 */

import { STRK20_ERROR_CODE, Strk20Error } from "../prism-strk20/domain/errors";
import { MOCK_APPROVAL_HASH, MOCK_FEE_LABEL, MOCK_FEE_WEI, MOCK_SHIELD_HASH } from "./mockPrivacyWallet";

export const SHIELD_TOKENS = ["STRK", "USDC"] as const;
export type ShieldToken = (typeof SHIELD_TOKENS)[number];

export interface ShieldIntent {
  readonly token: ShieldToken;
  readonly amount: string;
  readonly feeLabel: string;
  readonly feeWei: string;
}

export interface ReceiptSlot {
  readonly slot: "approval" | "shield";
  readonly label: string;
  readonly transactionHash: `0x${string}` | null;
}

export function createShieldIntent(token: ShieldToken = "STRK"): ShieldIntent {
  return { token, amount: "", feeLabel: MOCK_FEE_LABEL, feeWei: MOCK_FEE_WEI };
}

/** Positive decimal with up to 18 fractional digits. */
export function validateShieldAmount(amount: string): { ok: true } | { ok: false; error: string } {
  if (!/^\d+(\.\d{1,18})?$/.test(amount) || Number(amount) <= 0) {
    return { ok: false, error: "Enter a positive amount with up to 18 decimal places." };
  }
  return { ok: true };
}

export function canRequestShield(intent: ShieldIntent, consentGranted: boolean, connected: boolean): boolean {
  return connected && consentGranted && validateShieldAmount(intent.amount).ok;
}

/**
 * Fee freshness guard (G3/G4): the quoted fee must equal the freshly read
 * fee. A mismatch blocks the shield with FEE_CHANGED — never silently.
 */
export function assertFeeFresh(quotedFeeWei: string, observedFeeWei: string): void {
  if (quotedFeeWei.trim().toLowerCase() !== observedFeeWei.trim().toLowerCase()) {
    throw new Strk20Error(STRK20_ERROR_CODE.FEE_CHANGED, "fee_changed_re_quote_before_shield");
  }
}

/** Two-hash receipt slots: approval hash first, shield hash second (mock). */
export function twoHashSlots(intent: ShieldIntent, submitted: boolean): readonly ReceiptSlot[] {
  if (!submitted || !validateShieldAmount(intent.amount).ok) {
    return [
      { slot: "approval", label: "Approval hash", transactionHash: null },
      { slot: "shield", label: "Shield hash", transactionHash: null },
    ];
  }
  return [
    { slot: "approval", label: "Approval hash", transactionHash: MOCK_APPROVAL_HASH },
    { slot: "shield", label: "Shield hash", transactionHash: MOCK_SHIELD_HASH },
  ];
}
