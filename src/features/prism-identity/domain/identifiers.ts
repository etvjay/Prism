// Canonical identifiers for the PRISM-8 offchain slice.
// INV-SYS-001: a Prism ID is structurally distinct from every execution
// account and controller address — it is never an address-typed value.

import { PRISM_ERROR_CODE, PrismError, PRISM_ERROR_DETAIL } from "./errors";

export const VENUES = ["BASE"] as const;
export type Venue = (typeof VENUES)[number];

/** Prism IDs are registry-allocated identifiers (`prism:<registry-id>`).
 * They are format-checked here only; existence in the registry is a PRISM-7
 * read and becomes checkable at V8.3 integration time. */
export type PrismId = string;

const PRISM_ID_PATTERN = /^prism:[0-9A-Za-z]{1,64}$/;

export type EvmAddress = `0x${string}`;

const EVM_ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function normalizeEvmAddress(value: string): EvmAddress | null {
  const lowered = value.trim().toLowerCase();
  if (!EVM_ADDRESS_PATTERN.test(lowered)) return null;
  return lowered as EvmAddress;
}

/** ERR-005: zero/malformed Base address. */
export function assertValidExecutionAccount(value: string): EvmAddress {
  const normalized = normalizeEvmAddress(value);
  if (!normalized) {
    throw new PrismError(PRISM_ERROR_CODE.INVALID_EXECUTION_ACCOUNT, "malformed_base_address");
  }
  if (normalized === ZERO_ADDRESS) {
    throw new PrismError(PRISM_ERROR_CODE.INVALID_EXECUTION_ACCOUNT, "zero_address");
  }
  return normalized;
}

/** Structurally invalid Prism identifiers cannot exist in any registry; they
 * are reported under the identity_not_found family with an explicit detail
 * (catalogue has no separate malformed-identifier code — documented gap). */
export function assertValidPrismId(value: string): PrismId {
  const trimmed = value.trim();
  if (!PRISM_ID_PATTERN.test(trimmed)) {
    throw new PrismError(PRISM_ERROR_CODE.IDENTITY_NOT_FOUND, PRISM_ERROR_DETAIL.MALFORMED_PRISM_ID);
  }
  return trimmed;
}

/** ERR-001: venue enum lacks value. */
export function assertSupportedVenue(value: string): Venue {
  const candidate = value.trim().toUpperCase();
  if (!(VENUES as readonly string[]).includes(candidate)) {
    throw new PrismError(PRISM_ERROR_CODE.INVALID_VENUE, "venue_enum_lacks_value");
  }
  return candidate as Venue;
}
