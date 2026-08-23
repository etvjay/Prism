// viem-backed ChallengeCrypto adapter (port: ChallengeCrypto).
//
// This adapter lives OUTSIDE the domain/application layers; only adapters may
// import an RPC/chain SDK. viem is used here purely for primitives
// (keccak256, EIP-191 recovery) — no transport is created.

import { keccak256, recoverMessageAddress, toBytes } from "viem";
import type { ChallengeCrypto } from "../domain/ports";
import type { EvmAddress } from "../domain/identifiers";
import type { Hex } from "../domain/hex";
import { bytesToHex } from "../domain/hex";

export const viemChallengeCrypto: ChallengeCrypto = {
  keccak256Utf8(text: string): Hex {
    return keccak256(toBytes(text)) as Hex;
  },

  async recoverPersonalSignAddress(input: {
    message: string;
    signature: Hex;
  }): Promise<EvmAddress | null> {
    try {
      const recovered = await recoverMessageAddress({
        message: input.message,
        signature: input.signature,
      });
      // Challenge accounts are normalized lowercase; recovery returns a
      // checksummed address — normalize before comparison.
      return recovered.toLowerCase() as EvmAddress;
    } catch {
      return null;
    }
  },

  randomNonceHex(byteLength: number): Hex {
    if (byteLength <= 0 || byteLength > 512) {
      throw new Error("invariant_violation: nonce_byte_length_out_of_range");
    }
    const bytes = new Uint8Array(byteLength);
    globalThis.crypto.getRandomValues(bytes);
    return bytesToHex(bytes);
  },
};
