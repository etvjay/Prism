// Explicit STRK20 consumer state machine for M4 Wallet API route.
// Authority: STRK20_CONTEXT note maturity, two-step shield, fees, relayers,
// and wallet-mediated proof/receipt semantics. A receipt is required before a
// flow can enter a confirmed/terminal state; a submitted hash alone is not
// completion evidence.

import { Strk20Error, STRK20_ERROR_CODE } from "./errors";

export const STRK20_STATES = [
  "capability_unknown",
  "mismatch",
  "registration_required",
  "approval_pending",
  "shielding",
  "confirmed",
  "maturing",
  "privately_available",
  "proving",
  "transfer_pending",
  "transfer_confirmed",
  "rejected",
  "dependency_failure",
] as const;

export type Strk20State = (typeof STRK20_STATES)[number];
export const TERMINAL_STATES: readonly Strk20State[] = ["transfer_confirmed", "rejected"] as const;
export const FAILED_STATES: readonly Strk20State[] = ["rejected", "dependency_failure", "mismatch"] as const;
export const MATURITY_BLOCKS = 10;

export type Strk20ReceiptExecutionStatus = "SUCCEEDED" | "REVERTED" | "RECEIVED" | "PENDING" | "UNKNOWN";
export type Strk20ReceiptFinalityStatus = "ACCEPTED_ON_L2" | "ACCEPTED_ON_L1" | "RECEIVED" | "PENDING" | "UNKNOWN";

/** Receipt facts retained by the workflow without retaining raw provider data. */
export interface Strk20ReceiptObservation {
  readonly transactionHash: `0x${string}`;
  readonly executionStatus: Strk20ReceiptExecutionStatus;
  readonly finalityStatus: Strk20ReceiptFinalityStatus;
  readonly blockNumber: number | null;
  readonly poolEventFound: boolean;
}

export interface Strk20Flow {
  readonly id: string;
  readonly state: Strk20State;
  readonly version: number;
  readonly updatedAt: number;
  readonly createdAt: number;
  // Auth metadata
  readonly chainId: string | null;
  readonly expectedChainId: string | null;
  readonly capable: boolean | null;
  // Shield lifecycle
  readonly quotedFee: bigint | null;
  readonly observedFee: bigint | null;
  readonly shieldTxHash: `0x${string}` | null;
  readonly transferTxHash: `0x${string}` | null;
  readonly confirmedBlock: number | null;
  readonly maturityTargetBlock: number | null;
  readonly shieldReceipt: Strk20ReceiptObservation | null;
  readonly transferReceipt: Strk20ReceiptObservation | null;
  // Screening
  readonly screening: "approved" | "rejected" | "unavailable" | null;
  readonly rejectionReason: string | null;
  // Consent
  readonly balanceConsent: "unknown" | "granted" | "denied" | "required";
  // Error
  readonly errorCode: string | null;
  readonly errorDetail: string | null;
}

export interface CreateInput {
  id: string;
  now: number;
  expectedChainId?: string | null;
}

export function createFlow(input: CreateInput): Strk20Flow {
  if (!input.id || input.id.trim().length === 0) throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "missing_flow_id");
  if (!Number.isFinite(input.now)) throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "invalid_now");
  return {
    id: input.id,
    state: "capability_unknown",
    version: 0,
    updatedAt: input.now,
    createdAt: input.now,
    chainId: null,
    expectedChainId: input.expectedChainId ?? null,
    capable: null,
    quotedFee: null,
    observedFee: null,
    shieldTxHash: null,
    transferTxHash: null,
    confirmedBlock: null,
    maturityTargetBlock: null,
    shieldReceipt: null,
    transferReceipt: null,
    screening: null,
    rejectionReason: null,
    balanceConsent: "unknown",
    errorCode: null,
    errorDetail: null,
  };
}

function s(...states: Strk20State[]): ReadonlySet<Strk20State> {
  return new Set(states);
}

const ALLOWED: Record<Strk20State, ReadonlySet<Strk20State>> = {
  capability_unknown: s("mismatch", "registration_required", "approval_pending", "dependency_failure"),
  mismatch: s("capability_unknown", "dependency_failure"),
  registration_required: s("approval_pending", "rejected", "dependency_failure", "mismatch"),
  approval_pending: s("shielding", "rejected", "dependency_failure", "mismatch"),
  shielding: s("confirmed", "rejected", "dependency_failure", "mismatch"),
  confirmed: s("maturing", "rejected", "dependency_failure"),
  maturing: s("privately_available", "rejected", "dependency_failure", "mismatch"),
  privately_available: s("proving", "transfer_pending", "shielding", "approval_pending", "rejected", "dependency_failure", "mismatch"),
  proving: s("transfer_pending", "rejected", "dependency_failure", "mismatch"),
  transfer_pending: s("transfer_confirmed", "rejected", "dependency_failure", "mismatch"),
  transfer_confirmed: s(),
  rejected: s(),
  dependency_failure: s("capability_unknown", "approval_pending", "shielding", "maturing", "proving", "transfer_pending"),
};

export function canTransition(from: Strk20State, to: Strk20State): boolean {
  if (from === to) {
    const idempotent = new Set<Strk20State>(["shielding", "maturing", "proving", "transfer_pending", "dependency_failure", "mismatch"]);
    return idempotent.has(from);
  }
  const allowed = ALLOWED[from];
  return allowed ? allowed.has(to) : false;
}

export interface TransitionInput {
  to: Strk20State;
  now: number;
  expectedVersion?: number;
  chainId?: string | null;
  capable?: boolean | null;
  quotedFee?: bigint | null;
  observedFee?: bigint | null;
  shieldTxHash?: `0x${string}` | null;
  transferTxHash?: `0x${string}` | null;
  confirmedBlock?: number | null;
  receipt?: Strk20ReceiptObservation | null;
  screening?: "approved" | "rejected" | "unavailable" | null;
  rejectionReason?: string | null;
  balanceConsent?: "granted" | "denied" | "required" | "unknown" | null;
  errorCode?: string | null;
  errorDetail?: string | null;
  currentBlock?: number | null;
}

export interface TransitionResult {
  flow: Strk20Flow;
  idempotent: boolean;
}

function isKnownState(v: string): v is Strk20State {
  return (STRK20_STATES as readonly string[]).includes(v);
}

function canonicalHash(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(value.trim())) {
    throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "malformed_receipt_transaction_hash");
  }
  return `0x${value.trim().slice(2).toLowerCase().padStart(64, "0")}`;
}

function requireFinalReceipt(
  receipt: Strk20ReceiptObservation | null | undefined,
  expectedTxHash: `0x${string}` | null,
  context: "shield" | "transfer",
): Strk20ReceiptObservation {
  if (!receipt) {
    throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, `${context}_receipt_required_before_confirmation`);
  }
  if (!expectedTxHash || canonicalHash(receipt.transactionHash) !== canonicalHash(expectedTxHash)) {
    throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, `${context}_receipt_transaction_hash_mismatch`);
  }
  if (
    receipt.executionStatus !== "SUCCEEDED" ||
    (receipt.finalityStatus !== "ACCEPTED_ON_L2" && receipt.finalityStatus !== "ACCEPTED_ON_L1") ||
    receipt.blockNumber === null ||
    !Number.isSafeInteger(receipt.blockNumber) ||
    receipt.blockNumber < 0 ||
    receipt.poolEventFound !== true
  ) {
    throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, `${context}_receipt_not_final`);
  }
  return receipt;
}

export function transition(flow: Strk20Flow, input: TransitionInput): TransitionResult {
  if (!flow || typeof flow.id !== "string") throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "unknown_flow");
  if (!isKnownState(flow.state)) throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, `unknown_from:${String(flow.state)}`);
  if (!isKnownState(input.to)) throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, `unknown_to:${String(input.to)}`);
  if (!Number.isFinite(input.now)) throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "invalid_now");
  if (input.expectedVersion !== undefined && input.expectedVersion !== flow.version) {
    throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, `stale_version:expected_${input.expectedVersion}_got_${flow.version}`);
  }

  // A confirmed/terminal M4 state is a receipt-backed observation, not a
  // synonym for a submitted hash. Unknown/pending/reverted receipts remain
  // dependency failures and cannot advance the workflow.
  let finalReceipt: Strk20ReceiptObservation | null = null;

  // Maturity guard: maturing → privately_available only after ~10 blocks.
  if (flow.state === "maturing" && input.to === "privately_available") {
    if (flow.confirmedBlock === null || flow.maturityTargetBlock === null) {
      throw new Strk20Error(STRK20_ERROR_CODE.MATURITY_PENDING, "missing_maturity_target");
    }
    const cur = input.currentBlock ?? null;
    if (cur === null || cur < flow.maturityTargetBlock) {
      throw new Strk20Error(STRK20_ERROR_CODE.MATURITY_PENDING, `maturity_pending:${String(flow.confirmedBlock)}_target_${String(flow.maturityTargetBlock)}_cur_${String(cur)}`);
    }
    if (input.balanceConsent === "denied") throw new Strk20Error(STRK20_ERROR_CODE.CONSENT_DENIED, "balance_consent_denied");
    if (input.balanceConsent !== "granted") throw new Strk20Error(STRK20_ERROR_CODE.CONSENT_REQUIRED, "balance_consent_required_for_private_available");
  }

  // Fee change guard: shielding / transfer_pending compare quoted vs observed if both present.
  if ((input.to === "shielding" || input.to === "transfer_pending") && input.quotedFee !== undefined && input.observedFee !== undefined) {
    if (input.quotedFee !== null && input.observedFee !== null && input.quotedFee !== input.observedFee) {
      throw new Strk20Error(STRK20_ERROR_CODE.FEE_CHANGED, `fee_changed_quoted_${String(input.quotedFee)}_observed_${String(input.observedFee)}`);
    }
  }

  if (input.to === "rejected" && !input.rejectionReason && !input.errorCode) {
    throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "rejection_reason_required");
  }
  if (input.to === "rejected" && input.screening === "rejected" && !input.rejectionReason) {
    throw new Strk20Error(STRK20_ERROR_CODE.SCREENING_REJECTED, "screening_rejected_without_reason");
  }

  // Idempotent same-state. Receipt-backed states were validated above; other
  // transient states retain their prior semantics.
  if (flow.state === input.to) {
    if (!canTransition(flow.state, input.to)) {
      throw new Strk20Error(STRK20_ERROR_CODE.ILLEGAL_TRANSITION, `same_state_not_idempotent:${flow.state}`);
    }
    return { flow, idempotent: true };
  }

  const allowed = ALLOWED[flow.state];
  if (!allowed || !allowed.has(input.to)) {
    throw new Strk20Error(STRK20_ERROR_CODE.ILLEGAL_TRANSITION, `illegal:${flow.state}->${input.to}`);
  }

  if (input.to === "confirmed") {
    if (flow.shieldTxHash && input.shieldTxHash && canonicalHash(flow.shieldTxHash) !== canonicalHash(input.shieldTxHash)) {
      throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "shield_tx_hash_mismatch");
    }
    finalReceipt = requireFinalReceipt(input.receipt ?? flow.shieldReceipt, input.shieldTxHash ?? flow.shieldTxHash, "shield");
    if (input.confirmedBlock !== undefined && input.confirmedBlock !== null && input.confirmedBlock !== finalReceipt.blockNumber) {
      throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "shield_receipt_block_mismatch");
    }
  } else if (input.to === "transfer_confirmed") {
    if (flow.transferTxHash && input.transferTxHash && canonicalHash(flow.transferTxHash) !== canonicalHash(input.transferTxHash)) {
      throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "transfer_tx_hash_mismatch");
    }
    finalReceipt = requireFinalReceipt(input.receipt ?? flow.transferReceipt, input.transferTxHash ?? flow.transferTxHash, "transfer");
  }

  if (input.to === "shielding" && !input.shieldTxHash && !flow.shieldTxHash) {
    throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "shield_tx_required_for_shielding");
  }
  if (input.to === "transfer_pending" && !input.transferTxHash && !flow.transferTxHash) {
    throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "transfer_tx_required_for_transfer_pending");
  }

  let nextConfirmed = flow.confirmedBlock;
  let nextMaturityTarget: number | null = flow.maturityTargetBlock;
  if (input.to === "confirmed") {
    const block = finalReceipt!.blockNumber;
    if (block === null) throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "shield_receipt_block_missing");
    nextConfirmed = block;
    nextMaturityTarget = block + MATURITY_BLOCKS;
  }
  if (flow.state === "confirmed" && input.to === "maturing" && nextConfirmed === null) {
    throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "confirmed_block_missing_for_maturing");
  }

  const next: Strk20Flow = {
    ...flow,
    state: input.to,
    version: flow.version + 1,
    updatedAt: input.now,
    chainId: input.chainId !== undefined ? input.chainId : flow.chainId,
    capable: input.capable !== undefined ? input.capable : flow.capable,
    quotedFee: input.quotedFee !== undefined ? input.quotedFee : flow.quotedFee,
    observedFee: input.observedFee !== undefined ? input.observedFee : flow.observedFee,
    shieldTxHash: input.shieldTxHash !== undefined ? input.shieldTxHash : flow.shieldTxHash,
    transferTxHash: input.transferTxHash !== undefined ? input.transferTxHash : flow.transferTxHash,
    confirmedBlock: nextConfirmed,
    maturityTargetBlock: nextMaturityTarget,
    shieldReceipt: input.to === "confirmed" ? finalReceipt : flow.shieldReceipt,
    transferReceipt: input.to === "transfer_confirmed" ? finalReceipt : flow.transferReceipt,
    screening: input.screening !== undefined ? input.screening : flow.screening,
    rejectionReason: input.rejectionReason !== undefined ? input.rejectionReason : flow.rejectionReason,
    balanceConsent: (input.balanceConsent as Strk20Flow["balanceConsent"]) ?? flow.balanceConsent,
    errorCode: input.errorCode !== undefined ? input.errorCode : flow.errorCode,
    errorDetail: input.errorDetail !== undefined ? input.errorDetail : flow.errorDetail,
  };

  return { flow: next, idempotent: false };
}

export function isTerminal(state: Strk20State): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}
