// Opt-in participant-owned Web Crypto adapter.
//
// Web Crypto supplies the maintained AES-GCM primitive. This adapter never
// generates, exports, persists, or discovers keys: the injected key provider
// owns participant key material and recovery. The application receives only
// the opaque envelope returned here.

import { bytesToHex, hexToBytes } from "../../prism-identity/domain/hex";
import type { Hex } from "../domain/channel";
import type { EncryptedMemoEnvelope, ParticipantCommunicationEncryptionPort } from "../domain/ports";

const ENCRYPTION_VERSION = 1;
const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const FULL_HEX = /^0x[0-9a-fA-F]+$/;

export interface ParticipantEncryptionKeyContext {
  readonly channelId: string;
  readonly messageId: string;
  readonly sender: string;
  readonly recipient: string;
  readonly senderKeyCommitment: Hex;
  readonly recipientKeyCommitment: Hex;
}

/** Resolves an already-owned non-exportable key; it never receives plaintext. */
export interface ParticipantEncryptionKeyProvider {
  getKey(input: ParticipantEncryptionKeyContext): Promise<CryptoKey>;
}

export interface WebCryptoLike {
  readonly subtle: SubtleCrypto;
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

function contextOf(input: ParticipantEncryptionKeyContext): ParticipantEncryptionKeyContext {
  return {
    channelId: input.channelId,
    messageId: input.messageId,
    sender: input.sender,
    recipient: input.recipient,
    senderKeyCommitment: input.senderKeyCommitment,
    recipientKeyCommitment: input.recipientKeyCommitment,
  };
}

function associatedDataBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.byteLength + right.byteLength);
  result.set(left, 0);
  result.set(right, left.byteLength);
  return result;
}

/**
 * AES-GCM with the exact associated-data string supplied by Prism. The IV is
 * prefixed to the opaque ciphertext envelope and is not secret.
 */
export class WebCryptoParticipantCommunicationEncryption implements ParticipantCommunicationEncryptionPort {
  readonly encryptionVersion = ENCRYPTION_VERSION;
  private readonly keys: ParticipantEncryptionKeyProvider;
  private readonly crypto: WebCryptoLike;

  constructor(options: { keys: ParticipantEncryptionKeyProvider; crypto?: WebCryptoLike }) {
    if (!options.keys || typeof options.keys.getKey !== "function") {
      throw new Error("invariant_violation: participant_key_provider_required");
    }
    const crypto = options.crypto ?? globalThis.crypto;
    if (!crypto || !crypto.subtle || typeof crypto.getRandomValues !== "function") {
      throw new Error("invariant_violation: web_crypto_unavailable");
    }
    this.keys = options.keys;
    this.crypto = crypto;
  }

  async encrypt(input: {
    readonly channelId: string;
    readonly messageId: string;
    readonly sender: string;
    readonly recipient: string;
    readonly senderKeyCommitment: Hex;
    readonly recipientKeyCommitment: Hex;
    readonly associatedData: string;
    readonly plaintext: Uint8Array;
  }): Promise<EncryptedMemoEnvelope> {
    if (!(input.plaintext instanceof Uint8Array)) throw new Error("plaintext_bytes_required");
    const key = await this.keys.getKey(contextOf(input));
    const iv = this.crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const encrypted = await this.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource, additionalData: associatedDataBytes(input.associatedData) as BufferSource, tagLength: 128 },
      key,
      input.plaintext as BufferSource,
    );
    return {
      ciphertext: bytesToHex(concat(iv, new Uint8Array(encrypted))),
      encryptionVersion: ENCRYPTION_VERSION,
      senderKeyCommitment: input.senderKeyCommitment,
      recipientKeyCommitment: input.recipientKeyCommitment,
    };
  }

  async decrypt(input: {
    readonly channelId: string;
    readonly messageId: string;
    readonly sender: string;
    readonly recipient: string;
    readonly senderKeyCommitment: Hex;
    readonly recipientKeyCommitment: Hex;
    readonly associatedData: string;
    readonly ciphertext: Hex;
    readonly encryptionVersion: number;
  }): Promise<Uint8Array> {
    if (input.encryptionVersion !== ENCRYPTION_VERSION) throw new Error("unsupported_encryption_version");
    if (!FULL_HEX.test(input.ciphertext)) throw new Error("ciphertext_hex_required");
    const envelope = hexToBytes(input.ciphertext);
    if (envelope.byteLength < IV_BYTES + GCM_TAG_BYTES) throw new Error("ciphertext_envelope_too_short");
    const key = await this.keys.getKey(contextOf(input));
    const plaintext = await this.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: envelope.slice(0, IV_BYTES) as BufferSource, additionalData: associatedDataBytes(input.associatedData) as BufferSource, tagLength: 128 },
      key,
      envelope.slice(IV_BYTES) as BufferSource,
    );
    return new Uint8Array(plaintext);
  }
}
