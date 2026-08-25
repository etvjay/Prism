// M5 maturity-state contract. The WalletAccountV6 surface exposes no proven
// note-maturity query, so the runner only promotes this state when an injected
// adapter supplies explicit block and consent observations. It never derives
// maturity from a receipt block alone.

import { assertNoViewingKey } from "../domain/privacy-guard";
import { M5_ERROR_CODE, M5Error } from "./errors";

export type M5MaturityState = "maturing" | "privately_available";
export type M5BalanceConsent = "granted" | "denied" | "unknown";

export interface M5MaturityObservation {
  readonly confirmedBlock: number;
  /** Supplied by the protocol/session adapter; not assumed from a local constant. */
  readonly maturityTargetBlock: number;
  readonly currentBlock: number;
  readonly balanceConsent: M5BalanceConsent;
}

export interface M5MaturityResult {
  readonly state: M5MaturityState;
  readonly ready: boolean;
  readonly confirmedBlock: number;
  readonly maturityTargetBlock: number;
  readonly currentBlock: number;
}

function invalid(detail: string): never {
  throw new M5Error(M5_ERROR_CODE.MATURITY_PENDING, detail);
}

function validBlock(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function evaluateM5Maturity(observation: M5MaturityObservation): M5MaturityResult {
  assertNoViewingKey(observation as unknown as Record<string, unknown>, "evaluateM5Maturity");
  if (!observation || typeof observation !== "object") invalid("maturity_observation_missing");
  if (!validBlock(observation.confirmedBlock)) invalid("confirmed_block_invalid");
  if (!validBlock(observation.maturityTargetBlock)) invalid("maturity_target_invalid");
  if (!validBlock(observation.currentBlock)) invalid("current_block_invalid");
  if (observation.maturityTargetBlock < observation.confirmedBlock) invalid("maturity_target_before_confirmation");
  if (observation.currentBlock < observation.confirmedBlock) invalid("current_block_before_confirmation");

  if (observation.currentBlock < observation.maturityTargetBlock) {
    return {
      state: "maturing",
      ready: false,
      confirmedBlock: observation.confirmedBlock,
      maturityTargetBlock: observation.maturityTargetBlock,
      currentBlock: observation.currentBlock,
    };
  }

  if (observation.balanceConsent !== "granted") {
    invalid(observation.balanceConsent === "denied" ? "balance_consent_denied" : "balance_consent_required");
  }

  return {
    state: "privately_available",
    ready: true,
    confirmedBlock: observation.confirmedBlock,
    maturityTargetBlock: observation.maturityTargetBlock,
    currentBlock: observation.currentBlock,
  };
}
