// Ports — injected boundaries for channel storage, key commitments, and time.
// No secret handling; communication-key generation is outside app code (docs §17).
// INV-PRISM-012: communication key ≠ Starknet/Base/STRK20 viewing key.

import type { Hex, PrismChannel } from "./channel";
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
// Public-chain surface guard — ensures no plaintext leaks onchain.
// In X2 this is a fake that records what would be published onchain.
// In real testnet, this would be a commitment publisher (hash only).
// ---------------------------------------------------------------------------
export interface PublicChainPublisher {
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
