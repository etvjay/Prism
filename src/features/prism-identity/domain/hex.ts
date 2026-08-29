// Self-contained hex/byte helpers for the PRISM-8 offchain domain.
// Deliberately dependency-free: the domain layer imports no web framework,
// RPC driver, or DB driver (SD-003 constraint).

export type Hex = `0x${string}`;

const HEX_CHARS = "0123456789abcdef";

export function isHexString(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value) && value.length % 2 === 0;
}

export function hexToBytes(hex: Hex): Uint8Array {
  const body = hex.slice(2);
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): Hex {
  let out = "0x";
  for (const byte of bytes) {
    out += HEX_CHARS[byte >> 4] + HEX_CHARS[byte & 0x0f];
  }
  return out as Hex;
}

export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function padBytesLeft(bytes: Uint8Array, length: number): Uint8Array {
  if (bytes.length >= length) return bytes;
  const out = new Uint8Array(length);
  out.set(bytes, length - bytes.length);
  return out;
}

/** Reads one ABI-encoded word (32 bytes) at the given byte offset. */
export function readAbiWord(bytes: Uint8Array, wordIndex: number): Uint8Array {
  return bytes.slice(wordIndex * 32, wordIndex * 32 + 32);
}

/** Reads an ABI-encoded dynamic `bytes` value located at a byte offset. */
export function readAbiDynamicBytes(bytes: Uint8Array, byteOffset: number): Uint8Array | null {
  if (byteOffset < 0 || byteOffset + 32 > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = Number(view.getBigUint64(byteOffset + 24));
  if (!Number.isSafeInteger(length) || length < 0 || byteOffset + 32 + length > bytes.length) {
    return null;
  }
  return bytes.slice(byteOffset + 32, byteOffset + 32 + length);
}
