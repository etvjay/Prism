// Shared Starknet ContractAddress boundary invariant.
//
// Every Starknet address entering or leaving the application is a non-zero
// felt in the ContractAddress range and is represented as lowercase 0x + 64
// hex digits. Callers that need a different error catalogue wrap this error at
// their own boundary; the numeric validation and canonical form stay here.

/** ContractAddress is a non-zero felt252 constrained to the Starknet address range. */
export const STARKNET_CONTRACT_ADDRESS_LIMIT = 1n << 251n;

export type StarknetContractAddress = `0x${string}`;
export type StarknetContractAddressErrorReason = "malformed" | "zero" | "out_of_range";

export class StarknetContractAddressError extends Error {
  readonly reason: StarknetContractAddressErrorReason;
  readonly label: string;

  constructor(label: string, reason: StarknetContractAddressErrorReason) {
    super(`invalid_starknet_contract_address:${label}:${reason}`);
    this.name = "StarknetContractAddressError";
    this.reason = reason;
    this.label = label;
  }
}

/**
 * Normalize and validate one Starknet ContractAddress.
 *
 * This intentionally accepts short/uppercase/0X input at trusted adapter
 * boundaries, but the returned value is always canonical. Zero, values at or
 * above 2^251, and every non-hex shape are rejected.
 */
export function normalizeStarknetContractAddress(value: unknown, label = "address"): StarknetContractAddress {
  if (typeof value !== "string") {
    throw new StarknetContractAddressError(label, "malformed");
  }
  const normalized = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{1,64}$/.test(normalized)) {
    throw new StarknetContractAddressError(label, "malformed");
  }
  const numeric = BigInt(normalized);
  if (numeric === 0n) {
    throw new StarknetContractAddressError(label, "zero");
  }
  if (numeric >= STARKNET_CONTRACT_ADDRESS_LIMIT) {
    throw new StarknetContractAddressError(label, "out_of_range");
  }
  return `0x${numeric.toString(16).padStart(64, "0")}`;
}

/** Shape/range check for untrusted payloads that must be skipped, not thrown. */
export function isValidStarknetContractAddress(value: unknown): value is string {
  try {
    normalizeStarknetContractAddress(value);
    return true;
  } catch {
    return false;
  }
}

/** Numeric ContractAddress equality after applying the shared invariant. */
export function sameStarknetContractAddress(left: unknown, right: unknown): boolean {
  return normalizeStarknetContractAddress(left, "left") === normalizeStarknetContractAddress(right, "right");
}
