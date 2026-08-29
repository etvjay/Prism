// Fixtures for C1 tests — deterministic, secret-free.
// All commitments/ciphertexts are X2 test values; no real keys.

import type { Hex } from "../domain/channel";
import type { ContentType } from "../domain/channel";
import { InMemoryKeyCommitmentPort } from "../adapters/memory-channel-store";

export const ALICE = "prism:ALICE01";
export const BOB = "prism:BOB02";
export const CAROL = "prism:CAROL03"; // non-participant for red-team

export function makeCommitment(prismId: string, salt = "salt1"): Hex {
  return InMemoryKeyCommitmentPort.deterministicCommitment(prismId, salt);
}

// Ciphertext fixture: 32-byte hex, opaque. Content is not meaningful — just hex length.
// Real crypto would be handled outside app; tests use these opaque values.
export function makeCiphertext(seed: string, lenBytes = 64): Hex {
  let h = "";
  for (let i = 0; seed.length > 0 && h.length < lenBytes * 2;) {
    for (let c = 0; c < seed.length && h.length < lenBytes * 2; c++) {
      const code = seed.charCodeAt(c) + h.length;
      h += (code % 16).toString(16);
    }
    // pad
    if (h.length < lenBytes * 2) h += "ab";
  }
  h = h.slice(0, lenBytes * 2);
  // ensure length >=64 hex chars after 0x
  while (h.length < 64) h += "00";
  return `0x${h}` as Hex;
}

export function plaintextLeakCiphertext(): string {
  // Deliberately contains plaintext pattern for leakage test
  return "hello @alice payment_memo 25 USDC prism:ALICE01";
}

export const CONTENT_TYPES: ContentType[] = ["payment_memo", "receipt", "claim_invitation", "authorization_request"];

export function opaqueRef(seed: string): Hex {
  return makeCiphertext(seed, 32);
}
