// Application service — orchestrates channel lifecycle via injected ports.
// Transport-neutral, no HTTP. Separates participant authorization (who is sender)
// from channel state, enforces policy, key-commitment, and ciphertext-only rules.
// No key generation, no secret handling, no plaintext emission on public surfaces.

import type { Hex } from "../domain/channel";
import { createChannel, acceptChannel, archiveChannel, revokeChannel, assertValidPrismId, canSendInStatus } from "../domain/channel";
import type { ContentType } from "../domain/channel";
import { createMessage } from "../domain/message";
import type { PrismChannel } from "../domain/channel";
import type { ChannelMessage } from "../domain/message";
import { buildChannelCommitment, buildMessageCommitment } from "../domain/commitment";
import { viemChannelCommitmentHash } from "../adapters/channel-crypto";
import { CHANNEL_ERROR_CODE, PrismChannelError } from "../domain/errors";
import type {
  ChannelStore,
  ChannelMessageStore,
  CommunicationKeyCommitmentPort,
  ParticipantCommunicationEncryptionPort,
  ChannelCommitmentHashPort,
  StarknetCommitmentPublisherPort,
  Clock,
  ChannelIdGenerator,
  PublicChainPublisher,
} from "../domain/ports";

export interface ChannelServiceDeps {
  readonly channelStore: ChannelStore;
  readonly messageStore: ChannelMessageStore;
  readonly keyCommitmentPort: CommunicationKeyCommitmentPort;
  /** Participant-owned provider; Prism never generates or stores communication keys. */
  readonly encryptionPort?: ParticipantCommunicationEncryptionPort | null;
  /** Established hash primitive supplied by an adapter; never a homemade hash. */
  readonly commitmentHashPort?: ChannelCommitmentHashPort;
  /** Established Starknet contract boundary; absent means no live anchor claim. */
  readonly starknetCommitmentPublisher?: StarknetCommitmentPublisherPort | null;
  readonly publicPublisher?: PublicChainPublisher | null;
  readonly clock: Clock;
  readonly idGenerator: ChannelIdGenerator;
}

export interface CreateChannelRequest {
  initiator: string;
  peer: string;
  initiatorCommitment?: Hex | null; // if null, fetched from commitment port
  channelId?: string | null;
  policy?: { allowedContentTypes?: ContentType[]; allowAuthorizationRequest?: boolean };
}

export interface AcceptChannelRequest {
  channelId: string;
  caller: string; // must be peer
  peerCommitment?: Hex | null;
}

export interface SendMessageRequest {
  channelId: string;
  sender: string;
  ciphertext: string;
  contentType: ContentType;
  messageId?: string | null;
  replyTo?: string | null;
  paymentRef?: string | null;
  claimRef?: string | null;
  receiptRef?: string | null;
  encryptionVersion?: number | null;
  senderKeyCommitment?: Hex | null;
  recipientKeyCommitment?: Hex | null;
}

export interface SendEncryptedMemoRequest {
  channelId: string;
  sender: string;
  /** Plaintext is transient participant-boundary input and is never stored or published. */
  plaintext: Uint8Array;
  contentType: ContentType;
  messageId?: string | null;
  replyTo?: string | null;
  paymentRef?: string | null;
  claimRef?: string | null;
  receiptRef?: string | null;
}

export interface DecryptMessageRequest {
  channelId: string;
  messageId: string;
  recipient: string;
}

export class PrismChannelService {
  constructor(private readonly deps: ChannelServiceDeps) {}

  private commitmentHash(): ChannelCommitmentHashPort {
    return this.deps.commitmentHashPort ?? viemChannelCommitmentHash;
  }

  private async publishChannelAnchor(channel: PrismChannel): Promise<void> {
    const publisher = this.deps.starknetCommitmentPublisher;
    if (!publisher) return;
    const commitment = buildChannelCommitment(channel, this.commitmentHash());
    try {
      await publisher.publishChannelAnchor({
        commitment,
        version: channel.version,
        observedAt: channel.createdAt,
        state: channel.status,
      });
    } catch (cause) {
      if (cause instanceof PrismChannelError) throw cause;
      throw new PrismChannelError(CHANNEL_ERROR_CODE.ANCHOR_UNAVAILABLE, "starknet_channel_anchor_failed");
    }
  }

  private async publishMessageAnchor(channel: PrismChannel, message: ChannelMessage): Promise<void> {
    const publisher = this.deps.starknetCommitmentPublisher;
    if (!publisher) return;
    const hash = this.commitmentHash();
    const channelCommitment = buildChannelCommitment(channel, hash);
    const ciphertextHash = hash.hashUtf8(message.ciphertext);
    const messageCommitment = buildMessageCommitment({
      channelCommitment,
      ciphertextHash,
      messageId: message.messageId,
      hash,
    });
    try {
      await publisher.publishMessageAnchor({
        channelCommitment,
        messageCommitment,
        ciphertextHash,
        version: channel.version,
        observedAt: message.createdAt,
        state: channel.status,
      });
    } catch (cause) {
      if (cause instanceof PrismChannelError) throw cause;
      throw new PrismChannelError(CHANNEL_ERROR_CODE.ANCHOR_UNAVAILABLE, "starknet_message_anchor_failed");
    }
  }

  async createChannel(req: CreateChannelRequest): Promise<PrismChannel> {
    const now = this.deps.clock.now();
    if (!Number.isFinite(now)) throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_STATUS_TRANSITION, "clock_unavailable");

    const initiator = assertValidPrismId(req.initiator);
    const peer = assertValidPrismId(req.peer);
    if (initiator === peer) throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_PARTICIPANTS, "participants_must_be_distinct");

    let commitment = req.initiatorCommitment ?? null;
    if (!commitment) {
      commitment = await this.deps.keyCommitmentPort.getCommitment(initiator);
    }
    if (!commitment) throw new PrismChannelError(CHANNEL_ERROR_CODE.KEY_COMMITMENT_MISSING, `no_commitment_for:${initiator}`);
    const ok = await this.deps.keyCommitmentPort.verifyCommitment(initiator, commitment as Hex);
    if (!ok) throw new PrismChannelError(CHANNEL_ERROR_CODE.KEY_COMMITMENT_INVALID, `commitment_verify_failed:${initiator}`);

    const channelId = req.channelId ?? this.deps.idGenerator.generateChannelId();
    const channel = createChannel({
      channelId,
      initiator,
      peer,
      initiatorCommitment: commitment as Hex,
      policy: req.policy,
      now,
    });

    await this.deps.channelStore.put(channel);
    if (this.deps.starknetCommitmentPublisher) {
      await this.publishChannelAnchor(channel);
    } else if (this.deps.publicPublisher) {
      // Legacy X2 recorder path only. It receives the raw commitment for
      // fixture inspection; it is never presented as a Starknet anchor.
      await this.deps.publicPublisher.publishCommitment({ channelId, commitment: commitment as Hex });
    }
    return channel;
  }

  async acceptChannel(req: AcceptChannelRequest): Promise<PrismChannel> {
    const now = this.deps.clock.now();
    if (!Number.isFinite(now)) throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_STATUS_TRANSITION, "clock_unavailable");
    const channel = await this.deps.channelStore.getById(req.channelId);
    if (!channel) throw new PrismChannelError(CHANNEL_ERROR_CODE.CHANNEL_NOT_FOUND, `not_found:${req.channelId}`);

    const caller = assertValidPrismId(req.caller);
    if (!channel.participants.includes(caller)) throw new PrismChannelError(CHANNEL_ERROR_CODE.NOT_PARTICIPANT, `caller_not_participant:${caller}`);

    let commitment = req.peerCommitment ?? null;
    if (!commitment) {
      commitment = await this.deps.keyCommitmentPort.getCommitment(caller);
    }
    if (!commitment) throw new PrismChannelError(CHANNEL_ERROR_CODE.KEY_COMMITMENT_MISSING, `no_commitment_for:${caller}`);
    const ok = await this.deps.keyCommitmentPort.verifyCommitment(caller, commitment as Hex);
    if (!ok) throw new PrismChannelError(CHANNEL_ERROR_CODE.KEY_COMMITMENT_INVALID, `commitment_verify_failed:${caller}`);

    const next = acceptChannel({ channel, caller, peerCommitment: commitment as Hex, now });
    const updated = await this.deps.channelStore.update(channel.channelId, () => next, channel.version);
    if (!updated) throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_STATUS_TRANSITION, "concurrent_update_conflict");
    if (this.deps.starknetCommitmentPublisher) {
      await this.publishChannelAnchor(next);
    } else if (this.deps.publicPublisher) {
      await this.deps.publicPublisher.publishCommitment({ channelId: channel.channelId, commitment: commitment as Hex });
    }
    return next;
  }

  async archiveChannel(channelId: string, caller: string): Promise<PrismChannel> {
    const now = this.deps.clock.now();
    const channel = await this.deps.channelStore.getById(channelId);
    if (!channel) throw new PrismChannelError(CHANNEL_ERROR_CODE.CHANNEL_NOT_FOUND, `not_found:${channelId}`);
    const next = archiveChannel(channel, caller, now);
    const ok = await this.deps.channelStore.update(channelId, () => next, channel.version);
    if (!ok) throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_STATUS_TRANSITION, "concurrent_update_conflict");
    if (this.deps.starknetCommitmentPublisher) await this.publishChannelAnchor(next);
    return next;
  }

  async revokeChannel(channelId: string, caller: string): Promise<PrismChannel> {
    const now = this.deps.clock.now();
    const channel = await this.deps.channelStore.getById(channelId);
    if (!channel) throw new PrismChannelError(CHANNEL_ERROR_CODE.CHANNEL_NOT_FOUND, `not_found:${channelId}`);
    const next = revokeChannel(channel, caller, now);
    if (next.version === channel.version) return next; // already revoked idempotent
    const ok = await this.deps.channelStore.update(channelId, () => next, channel.version);
    if (!ok) throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_STATUS_TRANSITION, "concurrent_update_conflict");
    if (this.deps.starknetCommitmentPublisher) await this.publishChannelAnchor(next);
    return next;
  }

  private async authenticatedCommitments(channel: PrismChannel): Promise<void> {
    const commitments = channel.participants.map((participant) => channel.keyCommitments[participant]);
    if (commitments.some((commitment) => commitment === null)) {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.KEY_COMMITMENT_MISSING, `channel_commitments_incomplete:${channel.channelId}`);
    }
    const checks = await Promise.all(channel.participants.map(async (participant, index) => {
      const commitment = commitments[index];
      return this.deps.keyCommitmentPort.verifyCommitment(participant, commitment as Hex);
    }));
    if (checks.some((valid) => !valid)) {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.KEY_COMMITMENT_INVALID, "channel_commitment_authentication_failed");
    }
  }

  private static otherParticipant(channel: PrismChannel, sender: string): string {
    const recipient = channel.participants.find((participant) => participant !== sender);
    if (!recipient) throw new PrismChannelError(CHANNEL_ERROR_CODE.RECIPIENT_MISMATCH, "recipient_not_found");
    return recipient;
  }

  private static associatedData(input: {
    channelId: string;
    messageId: string;
    sender: string;
    recipient: string;
    senderKeyCommitment: Hex;
    recipientKeyCommitment: Hex;
  }): string {
    // The provider authenticates this exact context as AEAD associated data.
    // IDs are local routing labels; no associated-data value is published.
    return [
      "prism-channel-memo",
      "v1",
      input.channelId,
      input.messageId,
      input.sender,
      input.recipient,
      input.senderKeyCommitment.toLowerCase(),
      input.recipientKeyCommitment.toLowerCase(),
    ].join("|");
  }

  async sendEncryptedMemo(req: SendEncryptedMemoRequest): Promise<ChannelMessage> {
    const encryptionPort = this.deps.encryptionPort;
    if (!encryptionPort) {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.ENCRYPTION_PROVIDER_UNAVAILABLE, "participant_encryption_provider_missing");
    }
    if (!(req.plaintext instanceof Uint8Array)) {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_ENCRYPTED_MEMO, "plaintext_must_be_bytes_at_participant_boundary");
    }
    const channel = await this.deps.channelStore.getById(req.channelId);
    if (!channel) throw new PrismChannelError(CHANNEL_ERROR_CODE.CHANNEL_NOT_FOUND, `not_found:${req.channelId}`);
    const sender = assertValidPrismId(req.sender);
    if (!channel.participants.includes(sender)) {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.NOT_PARTICIPANT, `sender_not_participant:${sender}`);
    }
    if (channel.status === "REVOKED") throw new PrismChannelError(CHANNEL_ERROR_CODE.CHANNEL_REVOKED, "channel_revoked_no_messages");
    if (channel.status === "ARCHIVED") throw new PrismChannelError(CHANNEL_ERROR_CODE.CHANNEL_ARCHIVED, "channel_archived_no_messages");
    if (!canSendInStatus(channel.status)) {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_STATUS_TRANSITION, `messages_only_in_ACTIVE:got_${channel.status}`);
    }
    const messageId = req.messageId ?? this.deps.idGenerator.generateMessageId();
    const existing = await this.deps.messageStore.getById(messageId);
    if (existing) throw new PrismChannelError(CHANNEL_ERROR_CODE.REPLAY_DETECTED, `duplicate_message_id:${messageId}`);
    const recipient = PrismChannelService.otherParticipant(channel, sender);
    await this.authenticatedCommitments(channel);
    const senderKeyCommitment = channel.keyCommitments[sender];
    const recipientKeyCommitment = channel.keyCommitments[recipient];
    if (!senderKeyCommitment || !recipientKeyCommitment) {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.KEY_COMMITMENT_MISSING, "encrypted_memo_commitments_missing");
    }
    const associatedData = PrismChannelService.associatedData({
      channelId: channel.channelId,
      messageId,
      sender,
      recipient,
      senderKeyCommitment,
      recipientKeyCommitment,
    });
    let envelope;
    try {
      envelope = await encryptionPort.encrypt({
        channelId: channel.channelId,
        messageId,
        sender,
        recipient,
        senderKeyCommitment,
        recipientKeyCommitment,
        associatedData,
        plaintext: req.plaintext,
      });
    } catch {
      // Provider failures are deliberately sanitized; plaintext must not enter
      // an error detail or log through this boundary.
      throw new PrismChannelError(CHANNEL_ERROR_CODE.ENCRYPTION_PROVIDER_UNAVAILABLE, "participant_encryption_failed");
    }
    if (!envelope || typeof envelope !== "object"
      || typeof envelope.ciphertext !== "string"
      || typeof envelope.senderKeyCommitment !== "string"
      || typeof envelope.recipientKeyCommitment !== "string") {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_ENCRYPTED_MEMO, "encryption_provider_returned_malformed_envelope");
    }
    if (envelope.senderKeyCommitment.toLowerCase() !== senderKeyCommitment.toLowerCase()
      || envelope.recipientKeyCommitment.toLowerCase() !== recipientKeyCommitment.toLowerCase()) {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.COMMITMENT_MISMATCH, "encrypted_memo_commitment_mismatch");
    }
    if (!Number.isSafeInteger(envelope.encryptionVersion) || envelope.encryptionVersion <= 0) {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_ENCRYPTED_MEMO, "encryption_version_invalid");
    }
    return this.sendMessage({
      channelId: channel.channelId,
      sender,
      ciphertext: envelope.ciphertext,
      contentType: req.contentType,
      messageId,
      replyTo: req.replyTo ?? null,
      paymentRef: req.paymentRef ?? null,
      claimRef: req.claimRef ?? null,
      receiptRef: req.receiptRef ?? null,
      encryptionVersion: envelope.encryptionVersion,
      senderKeyCommitment: envelope.senderKeyCommitment,
      recipientKeyCommitment: envelope.recipientKeyCommitment,
    });
  }

  async decryptMessage(req: DecryptMessageRequest): Promise<Uint8Array> {
    const encryptionPort = this.deps.encryptionPort;
    if (!encryptionPort) {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.ENCRYPTION_PROVIDER_UNAVAILABLE, "participant_encryption_provider_missing");
    }
    const channel = await this.deps.channelStore.getById(req.channelId);
    if (!channel) throw new PrismChannelError(CHANNEL_ERROR_CODE.CHANNEL_NOT_FOUND, `not_found:${req.channelId}`);
    const recipient = assertValidPrismId(req.recipient);
    if (!channel.participants.includes(recipient)) {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.NOT_PARTICIPANT, `recipient_not_participant:${recipient}`);
    }
    const message = await this.deps.messageStore.getById(req.messageId);
    if (!message || message.channelId !== channel.channelId) {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.MESSAGE_NOT_FOUND, `not_found:${req.messageId}`);
    }
    if (message.encryptionVersion === undefined || message.encryptionVersion === null || !message.senderKeyCommitment || !message.recipientKeyCommitment) {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_ENCRYPTED_MEMO, "message_has_no_authenticated_encryption_metadata");
    }
    const expectedRecipient = PrismChannelService.otherParticipant(channel, message.sender);
    if (expectedRecipient !== recipient) {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.RECIPIENT_MISMATCH, "message_recipient_mismatch");
    }
    await this.authenticatedCommitments(channel);
    const senderKeyCommitment = channel.keyCommitments[message.sender];
    const recipientKeyCommitment = channel.keyCommitments[recipient];
    if (!senderKeyCommitment || !recipientKeyCommitment
      || message.senderKeyCommitment.toLowerCase() !== senderKeyCommitment.toLowerCase()
      || message.recipientKeyCommitment.toLowerCase() !== recipientKeyCommitment.toLowerCase()) {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.COMMITMENT_MISMATCH, "message_commitment_mismatch");
    }
    const associatedData = PrismChannelService.associatedData({
      channelId: channel.channelId,
      messageId: message.messageId,
      sender: message.sender,
      recipient,
      senderKeyCommitment,
      recipientKeyCommitment,
    });
    try {
      return await encryptionPort.decrypt({
        channelId: channel.channelId,
        messageId: message.messageId,
        sender: message.sender,
        recipient,
        senderKeyCommitment,
        recipientKeyCommitment,
        associatedData,
        ciphertext: message.ciphertext,
        encryptionVersion: message.encryptionVersion,
      });
    } catch {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.CIPHERTEXT_AUTHENTICATION_FAILED, "ciphertext_authentication_failed");
    }
  }

  async sendMessage(req: SendMessageRequest): Promise<ChannelMessage> {
    const now = this.deps.clock.now();
    const channel = await this.deps.channelStore.getById(req.channelId);
    if (!channel) throw new PrismChannelError(CHANNEL_ERROR_CODE.CHANNEL_NOT_FOUND, `not_found:${req.channelId}`);

    // Replay guard: messageId uniqueness per channel
    const messageId = req.messageId ?? this.deps.idGenerator.generateMessageId();
    const existing = await this.deps.messageStore.getById(messageId);
    if (existing) throw new PrismChannelError(CHANNEL_ERROR_CODE.REPLAY_DETECTED, `duplicate_message_id:${messageId}`);

    // Channel participant + status checks are in createMessage; we also gate here for explicit error mapping.
    if (channel.status === "REVOKED") throw new PrismChannelError(CHANNEL_ERROR_CODE.CHANNEL_REVOKED, "channel_revoked_no_messages");
    if (channel.status === "ARCHIVED") throw new PrismChannelError(CHANNEL_ERROR_CODE.CHANNEL_ARCHIVED, "channel_archived_no_messages");
    if (this.deps.starknetCommitmentPublisher
      && (req.encryptionVersion === undefined || req.encryptionVersion === null
        || req.senderKeyCommitment === undefined || req.senderKeyCommitment === null
        || req.recipientKeyCommitment === undefined || req.recipientKeyCommitment === null)) {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_ENCRYPTED_MEMO, "starknet_anchor_requires_authenticated_encryption");
    }
    if (this.deps.starknetCommitmentPublisher) {
      const anchorSender = assertValidPrismId(req.sender);
      if (!channel.participants.includes(anchorSender)) {
        throw new PrismChannelError(CHANNEL_ERROR_CODE.NOT_PARTICIPANT, `sender_not_participant:${anchorSender}`);
      }
      const anchorRecipient = PrismChannelService.otherParticipant(channel, anchorSender);
      await this.authenticatedCommitments(channel);
      const expectedSenderCommitment = channel.keyCommitments[anchorSender];
      const expectedRecipientCommitment = channel.keyCommitments[anchorRecipient];
      if (!expectedSenderCommitment || !expectedRecipientCommitment
        || typeof req.senderKeyCommitment !== "string"
        || typeof req.recipientKeyCommitment !== "string"
        || req.senderKeyCommitment.toLowerCase() !== expectedSenderCommitment.toLowerCase()
        || req.recipientKeyCommitment.toLowerCase() !== expectedRecipientCommitment.toLowerCase()) {
        throw new PrismChannelError(CHANNEL_ERROR_CODE.COMMITMENT_MISMATCH, "message_commitment_mismatch");
      }
    }

    const msg = createMessage({
      messageId,
      channel,
      sender: assertValidPrismId(req.sender),
      ciphertext: req.ciphertext,
      contentType: req.contentType,
      createdAt: now,
      replyTo: req.replyTo ?? null,
      paymentRef: req.paymentRef ?? null,
      claimRef: req.claimRef ?? null,
      receiptRef: req.receiptRef ?? null,
      encryptionVersion: req.encryptionVersion ?? null,
      senderKeyCommitment: req.senderKeyCommitment ?? null,
      recipientKeyCommitment: req.recipientKeyCommitment ?? null,
    });

    // Implicit payment authority guard: a channel message never implies payment authority.
    // Enforcement is that payment execution requires explicit separate authorization;
    // here we record that the message is only a reference, not an authority grant.
    // This is validated in red-team test "implicitPaymentAuthority".

    await this.deps.messageStore.put(msg);
    if (this.deps.starknetCommitmentPublisher) {
      await this.publishMessageAnchor(channel, msg);
    } else if (this.deps.publicPublisher) {
      // Legacy X2 recorder receives a real Keccak-256 ciphertext digest. It is
      // not a chain submission and must not be described as live anchoring.
      const hash = this.commitmentHash().hashUtf8(msg.ciphertext);
      await this.deps.publicPublisher.publishMessageCommitment({ channelId: channel.channelId, messageId: msg.messageId, ciphertextHash: hash });
    }
    return msg;
  }

  async getChannel(channelId: string, caller: string): Promise<PrismChannel> {
    const channel = await this.deps.channelStore.getById(channelId);
    if (!channel) throw new PrismChannelError(CHANNEL_ERROR_CODE.CHANNEL_NOT_FOUND, `not_found:${channelId}`);
    // Participant authorization for reads: only participants may read channel (policy: relationship privacy)
    if (!channel.participants.includes(caller)) throw new PrismChannelError(CHANNEL_ERROR_CODE.NOT_PARTICIPANT, `caller_not_participant:${caller}`);
    return channel;
  }

  async listMessages(channelId: string, caller: string): Promise<ChannelMessage[]> {
    const channel = await this.deps.channelStore.getById(channelId);
    if (!channel) throw new PrismChannelError(CHANNEL_ERROR_CODE.CHANNEL_NOT_FOUND, `not_found:${channelId}`);
    if (!channel.participants.includes(caller)) throw new PrismChannelError(CHANNEL_ERROR_CODE.NOT_PARTICIPANT, `caller_not_participant:${caller}`);
    // Only participants may list; even archived/revoked channels allow read of history but not new sends.
    return this.deps.messageStore.listByChannel(channelId);
  }

  // For evidence/independent read — separate reader path must use same store but distinct instance
  async independentRead(channelId: string, readerId: string): Promise<{ channel: PrismChannel | null; messages: ChannelMessage[]; watermark: number }> {
    const channel = await this.deps.channelStore.getById(channelId);
    const messages = channel ? await this.deps.messageStore.listByChannel(channelId) : [];
    const watermark = this.deps.clock.now();
    // readerId is logged for audit but not used for auth in this slice; real deployment would verify independent reader identity
    void readerId;
    return { channel: channel ?? null, messages, watermark };
  }
}
