// Canonical recipient normalization shared by Intent and ExecutionPlan.
// Recipient values are opaque Prism IDs or address-like identifiers at this layer;
// transport-specific fields must converge on one canonical value before persistence.

import { PauseError, PAUSE_ERROR_CODE } from "./errors";
import type { PauseErrorCode } from "./errors";

export function canonicalizeRecipient(
  value: string,
  field = "recipient",
  errorCode: PauseErrorCode = PAUSE_ERROR_CODE.INVALID_PLAN,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PauseError(errorCode, `${field}_required`);
  }
  const trimmed = value.trim();
  if (/^0x/i.test(trimmed)) {
    if (!/^0x[0-9a-fA-F]+$/i.test(trimmed)) {
      throw new PauseError(errorCode, `${field}_malformed_hex`);
    }
    return `0x${trimmed.slice(2).toLowerCase()}`;
  }
  return trimmed.toLowerCase();
}

export function canonicalizeOptionalRecipient(
  value: string | null | undefined,
  field: string,
  errorCode: PauseErrorCode = PAUSE_ERROR_CODE.INVALID_PLAN,
): string | null {
  return value === null || value === undefined ? null : canonicalizeRecipient(value, field, errorCode);
}

export function assertRecipientMatches(requestedRecipient: string, planRecipient: string): void {
  const requested = canonicalizeRecipient(requestedRecipient, "requested_recipient", PAUSE_ERROR_CODE.INVALID_PLAN);
  const planned = canonicalizeRecipient(planRecipient, "recipient", PAUSE_ERROR_CODE.INVALID_PLAN);
  if (requested !== planned) {
    throw new PauseError(PAUSE_ERROR_CODE.INVALID_PLAN, "recipient_mismatch");
  }
}
