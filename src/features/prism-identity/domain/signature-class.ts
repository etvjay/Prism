// Signature classification for the verification ladder (INV-SYS-009).
//
// The ladder never downgrades to ecrecover-only: EOA recovery is one branch,
// EIP-1271 and ERC-6492 shapes are recognized structurally and validated via
// the SmartWalletSignatureChecker port.
//
// ERC-6492 wrapper layout (standard): concat(
//   abi.encode(address owner, bytes data, bytes signature),
//   magicBytes(0x64926492…6492)
// )

import {
  bytesToHex,
  hexToBytes,
  isHexString,
  readAbiDynamicBytes,
  readAbiWord,
} from "./hex";
import type { Hex } from "./hex";
import { normalizeEvmAddress } from "./identifiers";

export const ERC6492_MAGIC_BYTES =
  "0x6492649264926492649264926492649264926492649264926492649264926492" as Hex;

export interface ParsedErc6492Signature {
  kind: "erc6492";
  owner: Hex;
  innerData: Hex;
  innerSignature: Hex;
}

export type ClassifiedSignature =
  | { kind: "eoa_candidate" }
  | { kind: "erc6492"; parsed: ParsedErc6492Signature }
  | { kind: "unclassified"; reason: "malformed_signature" | "unsupported_signature_class" };

function endsWithMagic(signature: Hex): boolean {
  return signature.length >= 2 + 64 && signature.slice(-64) === ERC6492_MAGIC_BYTES.slice(2);
}

/** Pure structural parse of an ERC-6492 wrapper. Returns null when the bytes
 * end in the magic value but do not decode as the standard tuple. */
export function parseErc6492Wrapper(signature: Hex): ParsedErc6492Signature | null {
  if (!isHexString(signature) || !endsWithMagic(signature)) return null;
  const bytes = hexToBytes(signature);
  const content = bytes.slice(0, bytes.length - 32);
  // Head: word0 = owner (address), word1 = offset(data), word2 = offset(signature)
  const ownerWord = readAbiWord(content, 0);
  const owner = normalizeEvmAddress(bytesToHex(ownerWord.slice(12)));
  if (!owner) return null;
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
  const dataOffset = Number(view.getBigUint64(32 + 24));
  const signatureOffset = Number(view.getBigUint64(64 + 24));
  const innerData = readAbiDynamicBytes(content, dataOffset);
  const innerSignature = readAbiDynamicBytes(content, signatureOffset);
  if (!innerData || !innerSignature || innerSignature.length === 0) return null;
  return {
    kind: "erc6492",
    owner,
    innerData: bytesToHex(innerData),
    innerSignature: bytesToHex(innerSignature),
  };
}

/**
 * Structural classification only — it does not decide validity. A 65-byte
 * ECDSA-layout blob stays `eoa_candidate` because deployed smart wallets may
 * also emit that shape; the ladder falls through to the EIP-1271 port when
 * recovery does not match the expected account.
 */
export function classifySignature(signature: Hex): ClassifiedSignature {
  if (!isHexString(signature) || signature.length < 4) {
    return { kind: "unclassified", reason: "malformed_signature" };
  }
  const parsed6492 = parseErc6492Wrapper(signature);
  if (parsed6492) return { kind: "erc6492", parsed: parsed6492 };
  // Bytes claiming the ERC-6492 shape but failing to decode are a corrupt
  // wrapper — a malformed signature, not a different signature class.
  if (endsWithMagic(signature)) {
    return { kind: "unclassified", reason: "malformed_signature" };
  }
  if (signature.length === 2 + 130) {
    const vByte = parseInt(signature.slice(-2), 16);
    if (vByte === 27 || vByte === 28 || vByte === 0 || vByte === 1) {
      return { kind: "eoa_candidate" };
    }
    return { kind: "unclassified", reason: "malformed_signature" };
  }
  return { kind: "unclassified", reason: "unsupported_signature_class" };
}

/** Builds a standards-shaped ERC-6492 wrapper (used by adapters/fixtures and
 * round-trip tested against parseErc6492Wrapper). */
export function buildErc6492Wrapper(input: {
  owner: Hex;
  innerData: Hex;
  innerSignature: Hex;
}): Hex {
  const owner = hexToBytes(input.owner).slice(-20);
  const data = hexToBytes(input.innerData);
  const signature = hexToBytes(input.innerSignature);
  // head: owner | offset(data)=0x60 | offset(signature)
  const dataOffset = 3 * 32;
  // The encoded data block always carries its 32-byte length word, even empty.
  const signatureOffset = dataOffset + 32 + align32(data.length);
  const paddedData = padRight32(data);
  const paddedSignature = padRight32(signature);
  const out = new Uint8Array(signatureOffset + 32 + paddedSignature.length + 32);
  out.set(padBytesLeft(owner, 32), 0);
  writeWord(out, 1, BigInt(dataOffset));
  writeWord(out, 2, BigInt(signatureOffset));
  writeWord(out, 3, BigInt(data.length));
  out.set(paddedData, dataOffset);
  writeWordAtByte(out, signatureOffset, BigInt(signature.length));
  out.set(paddedSignature, signatureOffset + 32);
  out.set(hexToBytes(ERC6492_MAGIC_BYTES), out.length - 32);
  return bytesToHex(out);
}

function align32(length: number): number {
  return Math.ceil(length / 32) * 32;
}

function padRight32(bytes: Uint8Array): Uint8Array {
  const aligned = align32(bytes.length);
  const out = new Uint8Array(aligned);
  out.set(bytes, 0);
  return out;
}

function padBytesLeft(bytes: Uint8Array, length: number): Uint8Array {
  if (bytes.length >= length) return bytes;
  const out = new Uint8Array(length);
  out.set(bytes, length - bytes.length);
  return out;
}

function writeWord(target: Uint8Array, wordIndex: number, value: bigint): void {
  writeWordAtByte(target, wordIndex * 32, value);
}

function writeWordAtByte(target: Uint8Array, byteOffset: number, value: bigint): void {
  const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
  view.setBigUint64(byteOffset + 24, value);
}
