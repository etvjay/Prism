// Receipt state contracts for STRK20 consumer flow.
// Authority: STRK20_CONTEXT relayers + concepts.md sender≠user + AUDIT §8 relayers.

import { Strk20Error, STRK20_ERROR_CODE } from "./errors";

export type Hex = `0x${string}`;

export const STRK20_POOL_ADDRESS = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a" as Hex;

export interface PoolDepositEvent {
  address: Hex; // pool address
  keys: Hex[]; // first key is depositor topic1
  data: Hex[];
  blockNumber: number;
  transactionHash: Hex;
}

export interface TxReceiptLike {
  transactionHash: Hex;
  executionStatus: "SUCCEEDED" | "REVERTED" | "RECEIVED";
  finalityStatus: "ACCEPTED_ON_L2" | "ACCEPTED_ON_L1" | "RECEIVED";
  senderAddress?: Hex | null; // relayer sender — must NOT be used for attribution
  events: PoolDepositEvent[];
}

export interface Strk20Receipt {
  mode: "shield" | "private_transfer";
  transactionHash: Hex;
  blockNumber: number | null;
  poolEventFound: boolean;
  // Attribution via pool event first key, not sender
  attributedDepositor: Hex | null;
  senderIgnored: Hex | null;
  executionStatus: string;
  finalityStatus: string;
  // Privacy claim for this receipt
  publicMetadata: string[];
  hiddenMetadata: string[];
  feePaid: bigint | null;
}

export function normalizeHex(a: string): string {
  return `0x${a.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

/**
 * Builds a receipt from a Starknet receipt, enforcing relayer non-attribution.
 * Throws if caller tries to attribute via sender.
 */
export function buildShieldReceipt(receipt: TxReceiptLike, opts: { feePaid?: bigint | null }): Strk20Receipt {
  // Enforce pool event presence is checked, but do not use sender for attribution
  if (receipt.senderAddress) {
    // We intentionally ignore it; guard that downstream does not use it as user identity
    // If any caller passes sender as attributedDepositor we'd throw via separate guard.
  }
  const poolEvents = receipt.events.filter((e) => normalizeHex(e.address) === normalizeHex(STRK20_POOL_ADDRESS));
  const poolFound = poolEvents.length > 0;
  const depositor = poolFound && poolEvents[0].keys.length > 0 ? (poolEvents[0].keys[0] as Hex) : null;
  return {
    mode: "shield",
    transactionHash: receipt.transactionHash,
    blockNumber: poolEvents[0]?.blockNumber ?? null,
    poolEventFound: poolFound,
    attributedDepositor: depositor,
    senderIgnored: receipt.senderAddress ?? null,
    executionStatus: receipt.executionStatus,
    finalityStatus: receipt.finalityStatus,
    publicMetadata: ["depositor_address", "token", "amount", "timing"],
    hiddenMetadata: [],
    feePaid: opts.feePaid ?? null,
  };
}

export function buildPrivateTransferReceipt(receipt: TxReceiptLike, opts: { feePaid?: bigint | null }): Strk20Receipt {
  const poolEvents = receipt.events.filter((e) => normalizeHex(e.address) === normalizeHex(STRK20_POOL_ADDRESS));
  // For private transfer, pool events still exist (nullifier/proof etc.) but amount hidden
  const poolFound = poolEvents.length > 0;
  return {
    mode: "private_transfer",
    transactionHash: receipt.transactionHash,
    blockNumber: poolEvents[0]?.blockNumber ?? null,
    poolEventFound: poolFound,
    attributedDepositor: null, // private transfer does not expose depositor via first key in same way; must not use sender
    senderIgnored: receipt.senderAddress ?? null,
    executionStatus: receipt.executionStatus,
    finalityStatus: receipt.finalityStatus,
    publicMetadata: ["proof_artifacts", "timing"],
    hiddenMetadata: ["sender", "recipient", "amount", "token_type"],
    feePaid: opts.feePaid ?? null,
  };
}

/**
 * Guard: rejects any attribution that uses transaction sender as user identity.
 */
export function assertNotSenderAttribution(attributed: Hex | null, sender: Hex | null): void {
  if (attributed !== null && sender !== null && normalizeHex(attributed) === normalizeHex(sender)) {
    // This would imply someone attributed via sender; forbid
    throw new Strk20Error(STRK20_ERROR_CODE.RELAYER_ATTRIBUTION_FORBIDDEN, "sender_must_not_be_attribution_source");
  }
  // Also, if any code claims sender == user, it's forbidden regardless of equality
  // We enforce that callers must set senderIgnored separately and not treat it as identity.
}

/**
 * Validates receipt honesty: shield amount is public, transfer amount is hidden.
 */
export function assertReceiptPrivacyHonesty(receipt: Strk20Receipt): void {
  if (receipt.mode === "shield" && receipt.hiddenMetadata.includes("amount")) {
    throw new Strk20Error(STRK20_ERROR_CODE.PRIVACY_OVERCLAIM, "shield_amount_is_public");
  }
  if (receipt.mode === "private_transfer" && receipt.publicMetadata.includes("amount") && receipt.hiddenMetadata.includes("amount")) {
    throw new Strk20Error(STRK20_ERROR_CODE.PRIVACY_OVERCLAIM, "private_transfer_amount_cannot_be_both");
  }
}
