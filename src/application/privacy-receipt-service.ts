import type { PrivacyActionView } from "../features/prism-strk20/application/privacy-action-service";
import { STRK20_ERROR_CODE } from "../features/prism-strk20/domain/errors";
import { APP_ERROR_CODE } from "./errors";
import { err, ok } from "./schemas";
import type { AppResponse, PrivacyReceiptData } from "./schemas";

export interface PrivacyActionReadPort {
  getAction(id: string): PrivacyActionView | null;
}

function mechanismFor(view: PrivacyActionView): PrivacyReceiptData["mechanism"] {
  if (view.kind === "shield") return "NONE";
  if (view.kind === "private_transfer") return "STRK20_PRIVATE_TRANSFER";
  if (view.kind === "application") return "STRK20_PRIVATE_INVOKE";
  return "NONE";
}

function normalizedHash(value: unknown): string | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(value.trim())) return null;
  return `0x${value.trim().slice(2).toLowerCase().padStart(64, "0")}`;
}

function receiptActionMismatch(view: PrivacyActionView): boolean {
  if (!view.receipt) return false;
  const submitted = normalizedHash(view.transactionHash);
  const observed = normalizedHash(view.receipt.transactionHash);
  return submitted === null || observed === null || submitted !== observed;
}

function statusFor(view: PrivacyActionView): PrivacyReceiptData["observationStatus"] {
  if (view.transactionHash !== null && normalizedHash(view.transactionHash) === null) return "UNAVAILABLE";
  if (receiptActionMismatch(view)) return "UNAVAILABLE";
  if (!view.receipt) {
    if (view.submissionAttempted && view.transactionHash === null) return "UNAVAILABLE";
    if (view.state === "dependency_failure" || view.state === "mismatch" || view.state === "fee_pending") return "UNAVAILABLE";
    if (!view.transactionHash) return "UNOBSERVED";
    return "PENDING";
  }
  if (view.receipt.executionStatus === "REVERTED" && view.receipt.blockNumber !== null) return "UNAVAILABLE";
  if (view.receipt.executionStatus === "UNKNOWN") return "UNAVAILABLE";
  if (
    view.receipt.executionStatus === "SUCCEEDED" &&
    (view.receipt.finalityStatus === "ACCEPTED_ON_L1" || view.receipt.finalityStatus === "ACCEPTED_ON_L2") &&
    view.receipt.blockNumber !== null &&
    view.receipt.poolEventFound
  ) {
    return "OBSERVED";
  }
  return "PENDING";
}

function evidenceFor(view: PrivacyActionView, status: PrivacyReceiptData["observationStatus"]): PrivacyReceiptData["evidenceSource"] {
  if (receiptActionMismatch(view)) return "NONE";
  if (view.receipt) return "PROVIDER_RECEIPT";
  if (status === "UNOBSERVED" && view.capability?.status === "supported") return "WALLET_DECLARED_API";
  return "NONE";
}

function policyFor(view: PrivacyActionView): Pick<PrivacyReceiptData, "protectedProperties" | "publicProperties" | "limitations"> {
  if (view.kind === "shield") {
    return {
      protectedProperties: [],
      publicProperties: ["depositor_address", "token", "amount", "timing"],
      limitations: ["shield_deposit_is_public", "later_private_state_is_not_proven_by_shield_receipt"],
    };
  }
  if (view.kind === "private_transfer") {
    return {
      protectedProperties: ["sender", "recipient", "amount", "token_type", "spent_note_relation"],
      publicProperties: ["proof_artifacts", "nullifier", "encrypted_note_artifacts"],
      limitations: ["proof_artifacts_remain_public", "timing_and_funding_correlation_are_not_hidden", "historical_unlinkability_not_claimed"],
    };
  }
  return {
    // Private invoke can hide direct user linkage when the supported route is
    // used, but public downstream execution can expose amount and timing.
    protectedProperties: ["direct_user_identity", "private_note_relation"],
    publicProperties: ["target_protocol", "action_type", "amount", "timing", "open_note_amount"],
    limitations: ["target_action_amount_and_timing_may_be_correlatable", "open_note_amount_may_be_public", "raw_calldata_is_not_projected", "historical_unlinkability_not_claimed"],
  };
}

/**
 * Project only mechanism/policy/status facts from the internal action view.
 * This is an allow-list projection: it never spreads the view or its request,
 * proof, call, receipt events, fee BigInts, notes, or provider response.
 */
export function projectPrivacyReceipt(view: PrivacyActionView, receiptId = view.id): PrivacyReceiptData {
  const observationStatus = statusFor(view);
  const policy = policyFor(view);
  const limitations = [...policy.limitations];
  if (observationStatus === "PENDING") limitations.push("receipt_pending_or_missing_finality");
  if (observationStatus === "UNAVAILABLE") limitations.push("provider_or_receipt_observation_unavailable");
  if (view.transactionHash !== null && normalizedHash(view.transactionHash) === null) limitations.push("malformed_transaction_hash");
  if (receiptActionMismatch(view)) limitations.push("receipt_action_mismatch");
  if (view.receipt && !view.receipt.poolEventFound) limitations.push("pinned_pool_event_required");
  if (view.receipt && view.receipt.finalityStatus !== "ACCEPTED_ON_L1" && view.receipt.finalityStatus !== "ACCEPTED_ON_L2") limitations.push("accepted_finality_required");

  const transactionHash = normalizedHash(view.transactionHash) ?? undefined;
  const blockNumber = !receiptActionMismatch(view) && view.receipt?.blockNumber !== null && view.receipt?.blockNumber !== undefined
    ? view.receipt.blockNumber
    : undefined;
  return {
    receiptId,
    actionId: view.id,
    mechanism: mechanismFor(view),
    observationStatus,
    evidenceSource: evidenceFor(view, observationStatus),
    protectedProperties: [...policy.protectedProperties],
    publicProperties: [...policy.publicProperties],
    limitations: [...new Set(limitations)],
    ...(transactionHash === undefined ? {} : { transactionHash }),
    ...(blockNumber === undefined ? {} : { blockNumber }),
  };
}

function unknownReceipt(receiptId: string, requestId: string | null): AppResponse<never> {
  return err({
    code: APP_ERROR_CODE.IDENTITY_NOT_FOUND,
    name: "privacy_receipt_not_found",
    category: "not_found",
    retryable: "no",
    userAction: "check_identifier",
    httpStatusHint: 404,
    detail: `unknown_privacy_receipt:${receiptId}`,
  }, requestId);
}

/** Derived policy projection over the action lifecycle; no second ledger. */
export class PrivacyReceiptService {
  constructor(private readonly source: PrivacyActionReadPort | null) {}

  async getReceipt(receiptId: string, requestId: string | null): Promise<AppResponse<PrivacyReceiptData>> {
    if (!this.source) {
      return err({
        code: STRK20_ERROR_CODE.UNSUPPORTED_WALLET_METHOD,
        name: "privacy_provider_unavailable",
        category: "dependency",
        retryable: "true_backoff",
        userAction: "connect_supported_wallet",
        httpStatusHint: 503,
        detail: "external_wallet_provider_required_x2",
      }, requestId);
    }
    const view = this.source.getAction(receiptId);
    if (!view) return unknownReceipt(receiptId, requestId);
    return ok<PrivacyReceiptData>(projectPrivacyReceipt(view, receiptId), undefined, requestId);
  }

  async getPrivacyReceipt(receiptId: string, requestId: string | null): Promise<AppResponse<PrivacyReceiptData>> {
    return this.getReceipt(receiptId, requestId);
  }
}
