// Explicit STRK20 consumer state machine for M4 Wallet API route.
// Required 12 states: capability_unknown, mismatch, registration_required,
// approval_pending, shielding, confirmed, maturing, privately_available,
// transfer_pending, transfer_confirmed, rejected, dependency_failure
// Authority: STRK20_CONTEXT note maturity ~10 blocks, two-tx shield, fees, relayers, screening.

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
  "transfer_pending",
  "transfer_confirmed",
  "rejected",
  "dependency_failure",
] as const;

export type Strk20State = (typeof STRK20_STATES)[number];

export const TERMINAL_STATES: readonly Strk20State[] = ["transfer_confirmed", "rejected"] as const;
export const FAILED_STATES: readonly Strk20State[] = ["rejected", "dependency_failure", "mismatch"] as const;

export const MATURITY_BLOCKS = 10;

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
  privately_available: s("transfer_pending", "shielding", "approval_pending", "rejected", "dependency_failure", "mismatch"),
  transfer_pending: s("transfer_confirmed", "rejected", "dependency_failure", "mismatch"),
  transfer_confirmed: s(),
  rejected: s(),
  dependency_failure: s("capability_unknown", "approval_pending", "shielding", "maturing", "transfer_pending"),
};

export function canTransition(from: Strk20State, to: Strk20State): boolean {
  if (from === to) {
    // Only allow idempotent re-apply for pending/transient states; terminal not
    const idempotent = new Set<Strk20State>(["shielding", "maturing", "transfer_pending", "dependency_failure", "mismatch"]);
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

export function transition(flow: Strk20Flow, input: TransitionInput): TransitionResult {
  if (!flow || typeof flow.id !== "string") throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "unknown_flow");
  if (!isKnownState(flow.state)) throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, `unknown_from:${String(flow.state)}`);
  if (!isKnownState(input.to)) throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, `unknown_to:${String(input.to)}`);
  if (!Number.isFinite(input.now)) throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "invalid_now");
  if (input.expectedVersion !== undefined && input.expectedVersion !== flow.version) {
    throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, `stale_version:expected_${input.expectedVersion}_got_${flow.version}`);
  }

  // Maturity guard: maturing → privately_available only after ~10 blocks
  if (flow.state === "maturing" && input.to === "privately_available") {
    if (flow.confirmedBlock === null || flow.maturityTargetBlock === null) {
      throw new Strk20Error(STRK20_ERROR_CODE.MATURITY_PENDING, "missing_maturity_target");
    }
    const cur = input.currentBlock ?? null;
    if (cur === null || cur < flow.maturityTargetBlock) {
      throw new Strk20Error(
        STRK20_ERROR_CODE.MATURITY_PENDING,
        `maturity_pending:${String(flow.confirmedBlock)}_target_${String(flow.maturityTargetBlock)}_cur_${String(cur)}`,
      );
    }
    // Consent gate: private balance requires explicit consent
    if (input.balanceConsent === "denied") {
      throw new Strk20Error(STRK20_ERROR_CODE.CONSENT_DENIED, "balance_consent_denied");
    }
    if (input.balanceConsent !== "granted") {
      throw new Strk20Error(STRK20_ERROR_CODE.CONSENT_REQUIRED, "balance_consent_required_for_private_available");
    }
  }

  // Fee change guard: shielding / transfer_pending compare quoted vs observed if both present
  if ((input.to === "shielding" || input.to === "transfer_pending") && input.quotedFee !== undefined && input.observedFee !== undefined) {
    if (input.quotedFee !== null && input.observedFee !== null && input.quotedFee !== input.observedFee) {
      throw new Strk20Error(STRK20_ERROR_CODE.FEE_CHANGED, `fee_changed_quoted_${String(input.quotedFee)}_observed_${String(input.observedFee)}`);
    }
  }

  // Screening distinct states
  if (input.to === "rejected" && !input.rejectionReason && !input.errorCode) {
    // Require a reason for rejected
    throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "rejection_reason_required");
  }
  if (input.to === "rejected" && input.screening === "rejected" && !input.rejectionReason) {
    throw new Strk20Error(STRK20_ERROR_CODE.SCREENING_REJECTED, "screening_rejected_without_reason");
  }

  // Idempotent same-state
  if (flow.state === input.to) {
    if (!canTransition(flow.state, input.to)) {
      throw new Strk20Error(STRK20_ERROR_CODE.ILLEGAL_TRANSITION, `same_state_not_idempotent:${flow.state}`);
    }
    return { flow, idempotent: true };
  }

  // Standard allowed check
  const allowed = ALLOWED[flow.state];
  if (!allowed || !allowed.has(input.to)) {
    throw new Strk20Error(STRK20_ERROR_CODE.ILLEGAL_TRANSITION, `illegal:${flow.state}->${input.to}`);
  }

  // Shielding requires txHash
  if (input.to === "shielding" && !input.shieldTxHash && !flow.shieldTxHash) {
    throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "shield_tx_required_for_shielding");
  }
  if (input.to === "transfer_pending" && !input.transferTxHash && !flow.transferTxHash) {
    throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "transfer_tx_required_for_transfer_pending");
  }
  // confirmed requires block
  if (input.to === "confirmed" && input.confirmedBlock === null && input.confirmedBlock !== undefined) {
    throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "confirmed_block_required");
  }

  // Build next
  let nextConfirmed = flow.confirmedBlock;
  let nextMaturityTarget: number | null = flow.maturityTargetBlock;
  if (input.to === "confirmed" && input.confirmedBlock !== undefined && input.confirmedBlock !== null) {
    nextConfirmed = input.confirmedBlock;
    nextMaturityTarget = input.confirmedBlock + MATURITY_BLOCKS;
  }
  if (flow.state === "confirmed" && input.to === "maturing") {
    // maturityTarget already set at confirmed
    if (nextConfirmed === null) {
      throw new Strk20Error(STRK20_ERROR_CODE.STALE_STATE, "confirmed_block_missing_for_maturing");
    }
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
