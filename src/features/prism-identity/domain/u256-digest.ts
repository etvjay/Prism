// Exact 256-bit Keccak digest serialization for Registry V2.
// Cairo u256 ABI is two u128 limbs: low first, high second.
// No felt masking, modulo, truncation, or alternate hash is performed.

import type { Hex } from "./hex";

const U128_MASK = (1n << 128n) - 1n;

export function toU256Calldata(digest: Hex): readonly [Hex, Hex] {
  if (!/^0x[0-9a-fA-F]{64}$/.test(digest)) throw new Error(`ERR-023: malformed_proof_digest:${digest}`);
  const value = BigInt(digest);
  const low = value & U128_MASK;
  const high = value >> 128n;
  return [
    `0x${low.toString(16).padStart(32, "0")}` as Hex,
    `0x${high.toString(16).padStart(32, "0")}` as Hex,
  ];
}
