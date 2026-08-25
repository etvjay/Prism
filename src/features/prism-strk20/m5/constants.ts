// M5 Vesu canonical constants — SN_SEPOLIA pinned route.
// Source: projects/prism/BACKEND_PHASE_M5_VESU_HELPER_REVIEW.md + M5_LIVE_HELPER_VESU_PROBE.md
// All addresses normalized via BigInt comparison; string form is canonical padded.
// Do not hard-code secrets; these are public contract addresses.

export const SN_SEPOLIA_CHAIN_ID = "SN_SEPOLIA" as const;
export const SN_MAIN_CHAIN_ID = "SN_MAIN" as const;

// Public token + pool addresses (SN_SEPOLIA)
export const STRK_SEPOLIA = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d" as const;
export const VTOKEN_STRK_SEPOLIA =
  "0x07152ae40c6bcbe7ff84b08a76527becb380bf7b2e782c0f5c8de9de049f8fff" as const;
export const PRIVACY_POOL_SEPOLIA =
  "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91" as const;

// Production-candidate helper pinned to privacy pool (deployed, not yet pool-invoked)
export const HELPER_ADDRESS_SEPOLIA =
  "0x07f3dd9a08c50fb6403a8621d8a7d9ccf5f7161f338fb36b515ed629e5490adf" as const;
export const HELPER_CLASS_HASH =
  "0x00ee923c2e4401b0f8090aa15d1948c79f5ba5a45a519903a64a3a4abac244e6" as const;

// Mainnet pool (for validator/mainnet path, not used in default SEPOLIA run)
export const PRIVACY_POOL_MAINNET =
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a" as const;

// u128 boundary — pool-facing in_amount and OpenNoteDeposit.amount
export const MAX_U128 = (1n << 128n) - 1n;
export const MIN_AMOUNT = 1n;

// First-party STRK20 wallet API placeholder. The wallet resolves this to the
// id of the first transfer action whose amount is `OPEN`.
export const OPEN_NOTE_ZERO_PLACEHOLDER = "${openNoteIds[0]}" as const;

// Starknet ContractAddress is a field element in the address range [0, 2^251).
// A syntactically valid 64-hex value above this limit is not a contract address.
export const STARKNET_ADDRESS_LIMIT = 1n << 251n;
const STARKNET_ADDRESS = /^0x[0-9a-f]{1,64}$/i;

/** Structural guard for public Starknet contract addresses at this boundary. */
export function isValidStarknetAddress(value: unknown): value is string {
  if (typeof value !== "string" || !STARKNET_ADDRESS.test(value)) return false;
  try {
    const numeric = BigInt(value);
    return numeric >= 0n && numeric < STARKNET_ADDRESS_LIMIT;
  } catch {
    return false;
  }
}

// STRK decimals (18) — no conversion in helper; note is shares denominated
export const STRK_DECIMALS = 18;

// Maturity blocks for newly created notes
export const MATURITY_BLOCKS = 10;

// Fee handling — read live, never hard-coded; this default is only for X2 fixture
export const FIXTURE_FEE = 4n;

// Helper calldata verification: in_token must == STRK, out_token == vToken
export function isCanonicalHelperPair(inToken: string, outToken: string): boolean {
  return normalizeHex(inToken) === normalizeHex(STRK_SEPOLIA) &&
    normalizeHex(outToken) === normalizeHex(VTOKEN_STRK_SEPOLIA);
}

export function normalizeHex(addr: string): string {
  // Pad to 64 hex chars lower case for numeric comparison
  if (!isValidStarknetAddress(addr)) return "0xinvalid";
  const h = addr.toLowerCase().replace(/^0x/, "");
  return `0x${h.padStart(64, "0")}`;
}

export function addressesEqual(a: string, b: string): boolean {
  if (!isValidStarknetAddress(a) || !isValidStarknetAddress(b)) return false;
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
}
