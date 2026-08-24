// X2 TEST DOUBLE — In-memory channel/message stores.
// Clearly labeled: NOT for testnet/production, no durability.
// Implements ChannelStore + ChannelMessageStore ports with CAS semantics.

import type { PrismChannel } from "../domain/channel";
import type { ChannelMessage } from "../domain/message";
import type { ChannelStore, ChannelMessageStore, CommunicationKeyCommitmentPort, PublicChainPublisher, Clock, ChannelIdGenerator } from "../domain/ports";
import type { Hex } from "../domain/channel";

export class InMemoryChannelStore implements ChannelStore {
  private readonly map = new Map<string, PrismChannel>();
  async put(channel: PrismChannel): Promise<void> {
    if (this.map.has(channel.channelId)) throw new Error(`duplicate_channel:${channel.channelId}`);
    this.map.set(channel.channelId, channel);
  }
  async getById(channelId: string): Promise<PrismChannel | undefined> {
    return this.map.get(channelId);
  }
  async update(channelId: string, updater: (current: PrismChannel) => PrismChannel, expectedVersion: number): Promise<boolean> {
    const cur = this.map.get(channelId);
    if (!cur) return false;
    if (cur.version !== expectedVersion) return false;
    const next = updater(cur);
    this.map.set(channelId, next);
    return true;
  }
  async listByParticipant(prismId: string): Promise<PrismChannel[]> {
    return Array.from(this.map.values()).filter((c) => c.participants.includes(prismId));
  }
  // Test helper
  clear(): void { this.map.clear(); }
  size(): number { return this.map.size; }
}

export class InMemoryMessageStore implements ChannelMessageStore {
  private readonly byId = new Map<string, ChannelMessage>();
  private readonly byChannel = new Map<string, ChannelMessage[]>();
  async put(message: ChannelMessage): Promise<void> {
    if (this.byId.has(message.messageId)) throw new Error(`duplicate_message:${message.messageId}`);
    this.byId.set(message.messageId, message);
    const list = this.byChannel.get(message.channelId) ?? [];
    list.push(message);
    this.byChannel.set(message.channelId, list);
  }
  async getById(messageId: string): Promise<ChannelMessage | undefined> {
    return this.byId.get(messageId);
  }
  async listByChannel(channelId: string): Promise<ChannelMessage[]> {
    return [...(this.byChannel.get(channelId) ?? [])];
  }
  async scanCiphertexts(): Promise<string[]> {
    return Array.from(this.byId.values()).map((m) => m.ciphertext);
  }
  clear(): void { this.byId.clear(); this.byChannel.clear(); }
  size(): number { return this.byId.size; }
}

// X2 TEST DOUBLE — Fixed commitment registry, no secret handling.
// Commitment = deterministic hex derived from prismId for tests; verify checks equality.
export class InMemoryKeyCommitmentPort implements CommunicationKeyCommitmentPort {
  private readonly map = new Map<string, Hex>();
  /** Register a commitment for a prismId (simulates external key provider supplying commitment). */
  register(prismId: string, commitment: Hex): void {
    this.map.set(prismId, commitment.toLowerCase() as Hex);
  }
  /** Generate deterministic commitment for testing (X2 only) — labels that app never calls this in prod. */
  static deterministicCommitment(prismId: string, salt = "c1"): Hex {
    let h = 0;
    const s = `${prismId}:${salt}`;
    for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
    const hex = h.toString(16).padStart(8, "0").repeat(8).slice(0, 64);
    return `0x${hex}` as Hex;
  }
  async getCommitment(prismId: string): Promise<Hex | null> {
    return this.map.get(prismId) ?? null;
  }
  async verifyCommitment(prismId: string, commitment: Hex): Promise<boolean> {
    const stored = this.map.get(prismId);
    if (!stored) return false;
    return stored.toLowerCase() === commitment.toLowerCase();
  }
  async listCommitments(): Promise<ReadonlyMap<string, Hex>> {
    return new Map(this.map);
  }
  clear(): void { this.map.clear(); }
}

// X2 TEST DOUBLE — Public chain publisher that records commitments only.
export class InMemoryPublicChainPublisher implements PublicChainPublisher {
  private readonly published: Array<{ channelId: string; payload: string }> = [];
  async publishCommitment(input: { channelId: string; commitment: Hex }): Promise<void> {
    this.published.push({ channelId: input.channelId, payload: input.commitment });
  }
  async publishMessageCommitment(input: { channelId: string; messageId: string; ciphertextHash: Hex }): Promise<void> {
    this.published.push({ channelId: input.channelId, payload: input.ciphertextHash });
  }
  async getPublished(): Promise<ReadonlyArray<{ channelId: string; payload: string }>> {
    return [...this.published];
  }
  async scanForPlaintext(): Promise<string[]> {
    const leaks: string[] = [];
    const plain = /@\w{2,}|prism:|USDC|payment_memo/i;
    for (const p of this.published) if (plain.test(p.payload)) leaks.push(p.payload);
    return leaks;
  }
  clear(): void { this.published.length = 0; }
}

export class FixedClock implements Clock {
  constructor(private t: number) {}
  now(): number { return this.t; }
  advance(delta: number): void { this.t += delta; }
  set(t: number): void { this.t = t; }
}

export class SequentialIdGenerator implements ChannelIdGenerator {
  private c = 0;
  private m = 0;
  generateChannelId(): string { this.c++; return `ch_${String(this.c).padStart(4, "0")}_${Date.now()}`; }
  generateMessageId(): string { this.m++; return `msg_${String(this.m).padStart(4, "0")}_${Date.now()}`; }
  reset(): void { this.c = 0; this.m = 0; }
}
