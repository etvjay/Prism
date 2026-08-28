// Ports — injected boundaries for channel storage, key commitments, and time.
// No secret handling; communication-key generation is outside app code (docs §17).
// INV-PRISM-012: communication key ≠ Starknet/Base/STRK20 viewing key.

import type { Hex, PrismChannel, ChannelStatus } from "./channel";
import type { ChannelMessage } from "./message";

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------
export interface Clock {
  now(): number; // unix seconds
}

// ---------------------------------------------------------------------------
// Communication key commitments — separate port, no secret handling.
// ---------------------------------------------------------------------------
/**
 * Communication-key commitment port.
 * - App code never generates keys or handles secrets.
 * - External provider supplies public commitment (e.g. hash of public key).
 * - Commitment is bound to a Prism ID and is verified without exposing material.
 */
export interface CommunicationKeyCommitmentPort {
  /** Returns existing commitment for prismId or null if not registered. */
  getCommitment(prismId: string): Promise<Hex | null>;
  /** Verifies that commitment belongs to prismId (opaque check, no secret). */
  verifyCommitment(prismId: string, commitment: Hex): Promise<boolean>;
  /** Lists all commitments (for audit); never returns secrets. */
  listCommitments?(): Promise<ReadonlyMap<string, Hex>>;
}

// ---------------------------------------------------------------------------
// Participant-owned encryption — the application never owns key material.
// ---------------------------------------------------------------------------
/**
 * Result returned by a participant-owned communication provider.
 * The provider owns key generation, storage, rotation, and recovery. Prism
 * receives only an authenticated opaque ciphertext envelope and commitments.
 */
export interface EncryptedMemoEnvelope {
  readonly ciphertext: Hex;
  readonly encryptionVersion: number;
  readonly senderKeyCommitment: Hex;
  readonly recipientKeyCommitment: Hex;
}

export interface ParticipantCommunicationEncryptionPort {
  /**
   * Encrypts at the participant boundary. `plaintext` is transient input only;
   * it must never be written to a Prism store, log, anchor, or error detail.
   */
  encrypt(input: {
    readonly channelId: string;
    readonly messageId: string;
    readonly sender: string;
    readonly recipient: string;
    readonly senderKeyCommitment: Hex;
    readonly recipientKeyCommitment: Hex;
    readonly associatedData: string;
    readonly plaintext: Uint8Array;
  }): Promise<EncryptedMemoEnvelope>;
  /**
   * Decrypts only after the service has authenticated the participant and bound
   * both commitments to the channel. Authentication failures must reject.
   */
  decrypt(input: {
    readonly channelId: string;
    readonly messageId: string;
    readonly sender: string;
    readonly recipient: string;
    readonly senderKeyCommitment: Hex;
    readonly recipientKeyCommitment: Hex;
    readonly associatedData: string;
    readonly ciphertext: Hex;
    readonly encryptionVersion: number;
  }): Promise<Uint8Array>;
}

// Hashing is an adapter concern. The production implementation is expected to
// use an established primitive (currently viem keccak256), never a homemade
// deterministic hash.
export interface ChannelCommitmentHashPort {
  hashUtf8(input: string): Hex;
}

// ---------------------------------------------------------------------------
// Channel storage — durable port, replaceable.
// ---------------------------------------------------------------------------
export interface ChannelStore {
  put(channel: PrismChannel): Promise<void>;
  getById(channelId: string): Promise<PrismChannel | undefined>;
  /** CAS update: returns true if version matched and stored. */
  update(channelId: string, updater: (current: PrismChannel) => PrismChannel, expectedVersion: number): Promise<boolean>;
  listByParticipant(prismId: string): Promise<PrismChannel[]>;
}

// ---------------------------------------------------------------------------
// Message storage — append-only per channel.
// ---------------------------------------------------------------------------
export interface ChannelMessageStore {
  put(message: ChannelMessage): Promise<void>;
  getById(messageId: string): Promise<ChannelMessage | undefined>;
  listByChannel(channelId: string): Promise<ChannelMessage[]>;
  /** For independent read verification: raw ciphertext scan. */
  scanCiphertexts?(): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Starknet commitment anchor — typed provider boundary, no implicit fallback.
// ---------------------------------------------------------------------------
export const STARKNET_CHANNEL_ANCHOR_ABI_VERSION = "prism-channel-anchor-v1" as const;
export type StarknetChannelAnchorAbiVersion = typeof STARKNET_CHANNEL_ANCHOR_ABI_VERSION;
export type StarknetAnchorKind = "channel" | "message";

/** Payload admitted to a Starknet commitment contract. All identifiers are opaque hashes. */
export interface StarknetAnchorPayload {
  readonly kind: StarknetAnchorKind;
  readonly anchorRef: Hex;
  readonly commitment: Hex;
  readonly relatedCommitment: Hex | null;
  readonly version: number;
  readonly observedAt: number;
  readonly state: ChannelStatus;
}

export interface StarknetAnchorSubmission {
  readonly txHash: Hex;
}

export interface StarknetCommitmentContractPort {
  readonly abiVersion: StarknetChannelAnchorAbiVersion;
  readonly contractAddress: string;
  /** The injected adapter owns Account/RPC details and any user authorization. */
  submitAnchor(input: StarknetAnchorPayload): Promise<{ transactionHash: string }>;
  /** Independent read path; a missing read implementation is not promotable. */
  readAnchor(input: { anchorRef: Hex }): Promise<StarknetAnchorPayload | null>;
}

export interface StarknetCommitmentPublisherPort {
  readonly isTestDouble: false;
  readonly abiVersion: StarknetChannelAnchorAbiVersion;
  readonly contractAddress: string;
  publishChannelAnchor(input: {
    readonly commitment: Hex;
    readonly version: number;
    readonly observedAt: number;
    readonly state: ChannelStatus;
  }): Promise<StarknetAnchorSubmission>;
  publishMessageAnchor(input: {
    readonly channelCommitment: Hex;
    readonly messageCommitment: Hex;
    readonly ciphertextHash: Hex;
    readonly version: number;
    readonly observedAt: number;
    readonly state: ChannelStatus;
  }): Promise<StarknetAnchorSubmission>;
  readAnchor(anchorRef: Hex): Promise<StarknetAnchorPayload | null>;
}

// ---------------------------------------------------------------------------
// Public-chain surface guard — legacy X2 test recorder only.
// ---------------------------------------------------------------------------
export interface PublicChainPublisher {
  /** This surface is retained only for X2 fixture inspection. */
  readonly isTestDouble?: boolean;
  /** Publish only opaque commitments/ciphertext hashes — never plaintext. */
  publishCommitment(input: { channelId: string; commitment: Hex }): Promise<void>;
  publishMessageCommitment(input: { channelId: string; messageId: string; ciphertextHash: Hex }): Promise<void>;
  getPublished(): Promise<ReadonlyArray<{ channelId: string; payload: string }>>;
  /** Scan for plaintext leakage in published payloads. */
  scanForPlaintext(): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// ID generation — deterministic/test-friendly.
// ---------------------------------------------------------------------------
export interface ChannelIdGenerator {
  generateChannelId(): string;
  generateMessageId(): string;
}
