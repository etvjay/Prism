// ChannelMessage — ciphertext/encrypted-reference only.
// No plaintext social/payment metadata is stored or emitted.
// See docs §§15–19: message carries ciphertext + opaque references only.

import { CHANNEL_ERROR_CODE, PrismChannelError } from "./errors";
import type { ContentType } from "./channel";
import { CONTENT_TYPES } from "./channel";
import type { PrismChannel } from "./channel";
import { assertValidCommitment, canSendInStatus } from "./channel";
import type { Hex } from "./channel";

export interface ChannelMessage {
  readonly messageId: string;
  readonly channelId: string;
  readonly sender: string; // Prism ID of sender (must be participant, but stored as commitment-scoped identifier)
  readonly ciphertext: Hex; // opaque encrypted payload — never plaintext
  readonly contentType: ContentType;
  readonly createdAt: number;
  readonly replyTo?: string | null; // messageId ref (opaque)
  readonly paymentRef?: Hex | null; // encrypted payment reference (opaque hex)
  readonly claimRef?: Hex | null;
  readonly receiptRef?: Hex | null;
  readonly encryptionVersion?: number | null;
  readonly senderKeyCommitment?: Hex | null;
  readonly recipientKeyCommitment?: Hex | null;
  readonly version: number;
}

export interface CreateMessageInput {
  messageId: string;
  channel: PrismChannel;
  sender: string;
  ciphertext: string; // must be hex ciphertext
  contentType: ContentType;
  createdAt: number;
  replyTo?: string | null;
  paymentRef?: string | null;
  claimRef?: string | null;
  receiptRef?: string | null;
  encryptionVersion?: number | null;
  senderKeyCommitment?: string | null;
  recipientKeyCommitment?: string | null;
}

// Plaintext leakage detection — simple heuristic for tests/red-team.
// Real deployment would enforce via crypto layer; here we ensure no
// plaintext handle/amount/memo is persisted as ciphertext.
const PLAINTEXT_PATTERNS: RegExp[] = [
  /@\w{2,}/, // social handle
  /\b\d+(\.\d+)?\s*(USDC|STRK|ETH)\b/i, // amount
  /payment_memo/i,
  /prism:/i,
  /BEGIN PLAINTEXT/i,
];

const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const HEX_CIPHERTEXT_PATTERN = /^0x[0-9a-fA-F]{56,}$/; // at least 28 bytes (12-byte IV + 16-byte AEAD tag)
const HEX_REF_PATTERN = /^0x[0-9a-fA-F]{32,}$/;

export function assertValidMessageId(value: string): string {
  if (!MESSAGE_ID_PATTERN.test(value)) throw new PrismChannelError(CHANNEL_ERROR_CODE.CIPHERTEXT_REQUIRED, `malformed_message_id:${value}`);
  return value;
}

export function detectPlaintextLeakage(ciphertext: string): void {
  for (const pat of PLAINTEXT_PATTERNS) {
    if (pat.test(ciphertext)) {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.PLAINTEXT_LEAKAGE, `ciphertext_contains_plaintext_pattern:${pat.source}`);
    }
  }
  // Also ensure ciphertext is hex, not raw text
  if (!HEX_CIPHERTEXT_PATTERN.test(ciphertext)) {
    // If not hex, it might be plaintext — reject
    // Allow base64-like? No, we require hex for this slice to avoid ambiguity.
    throw new PrismChannelError(CHANNEL_ERROR_CODE.PLAINTEXT_LEAKAGE, "ciphertext_must_be_hex_opaque");
  }
}

export function createMessage(input: CreateMessageInput): ChannelMessage {
  assertValidMessageId(input.messageId);
  if (!input.channel) throw new PrismChannelError(CHANNEL_ERROR_CODE.CHANNEL_NOT_FOUND, "missing_channel");
  if (!canSendInStatus(input.channel.status)) {
    if (input.channel.status === "REVOKED") throw new PrismChannelError(CHANNEL_ERROR_CODE.CHANNEL_REVOKED, "channel_revoked_no_messages");
    if (input.channel.status === "ARCHIVED") throw new PrismChannelError(CHANNEL_ERROR_CODE.CHANNEL_ARCHIVED, "channel_archived_no_messages");
    throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_STATUS_TRANSITION, `messages_only_in_ACTIVE:got_${input.channel.status}`);
  }
  if (!input.channel.participants.includes(input.sender)) {
    throw new PrismChannelError(CHANNEL_ERROR_CODE.NOT_PARTICIPANT, `sender_not_participant:${input.sender}`);
  }
  if (!(CONTENT_TYPES as readonly string[]).includes(input.contentType)) {
    throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_CONTENT_TYPE, `unsupported:${input.contentType}`);
  }
  // Policy check: allowed content types
  if (!input.channel.policy.allowedContentTypes.includes(input.contentType)) {
    throw new PrismChannelError(CHANNEL_ERROR_CODE.POLICY_VIOLATION, `content_type_not_allowed:${input.contentType}`);
  }
  // Authorization request policy — separate flag
  if (input.contentType === "authorization_request" && !input.channel.policy.allowAuthorizationRequest) {
    throw new PrismChannelError(CHANNEL_ERROR_CODE.POLICY_VIOLATION, "authorization_request_not_allowed_by_policy");
  }
  // Implicit payment authority guard: authorization_request content must not be conflated with payment execution.
  // This check is structural: we never allow a message to be treated as implicit authority.
  // The service layer will enforce that no payment is executed from a message alone.

  if (!input.ciphertext || input.ciphertext.trim().length === 0) {
    throw new PrismChannelError(CHANNEL_ERROR_CODE.CIPHERTEXT_REQUIRED, "ciphertext_required");
  }
  detectPlaintextLeakage(input.ciphertext);

  // Opaque refs must also be hex or null, never plaintext handles
  if (input.paymentRef !== undefined && input.paymentRef !== null) {
    if (!HEX_REF_PATTERN.test(input.paymentRef)) throw new PrismChannelError(CHANNEL_ERROR_CODE.PLAINTEXT_LEAKAGE, "payment_ref_must_be_opaque_hex");
  }
  if (input.claimRef !== undefined && input.claimRef !== null) {
    if (!HEX_REF_PATTERN.test(input.claimRef)) throw new PrismChannelError(CHANNEL_ERROR_CODE.PLAINTEXT_LEAKAGE, "claim_ref_must_be_opaque_hex");
  }
  if (input.receiptRef !== undefined && input.receiptRef !== null) {
    if (!HEX_REF_PATTERN.test(input.receiptRef)) throw new PrismChannelError(CHANNEL_ERROR_CODE.PLAINTEXT_LEAKAGE, "receipt_ref_must_be_opaque_hex");
  }
  if (input.replyTo !== undefined && input.replyTo !== null) {
    if (!MESSAGE_ID_PATTERN.test(input.replyTo)) throw new PrismChannelError(CHANNEL_ERROR_CODE.CIPHERTEXT_REQUIRED, "reply_to_malformed");
  }
  if (!Number.isFinite(input.createdAt)) throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_STATUS_TRANSITION, "invalid_created_at");

  const hasEncryptionMetadata = (input.encryptionVersion !== undefined && input.encryptionVersion !== null)
    || (input.senderKeyCommitment !== undefined && input.senderKeyCommitment !== null)
    || (input.recipientKeyCommitment !== undefined && input.recipientKeyCommitment !== null);
  const hasCompleteEncryptionMetadata = input.encryptionVersion !== null
    && input.encryptionVersion !== undefined
    && input.senderKeyCommitment !== null
    && input.senderKeyCommitment !== undefined
    && input.recipientKeyCommitment !== null
    && input.recipientKeyCommitment !== undefined;
  if (hasEncryptionMetadata && !hasCompleteEncryptionMetadata) {
    throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_ENCRYPTED_MEMO, "encryption_metadata_incomplete");
  }
  if (hasCompleteEncryptionMetadata) {
    if (!Number.isSafeInteger(input.encryptionVersion) || (input.encryptionVersion as number) <= 0) {
      throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_ENCRYPTED_MEMO, "encryption_version_invalid");
    }
    assertValidCommitment(input.senderKeyCommitment as string);
    assertValidCommitment(input.recipientKeyCommitment as string);
  }

  return {
    messageId: input.messageId,
    channelId: input.channel.channelId,
    sender: input.sender,
    ciphertext: input.ciphertext as Hex,
    contentType: input.contentType,
    createdAt: input.createdAt,
    replyTo: input.replyTo ?? null,
    paymentRef: (input.paymentRef as Hex) ?? null,
    claimRef: (input.claimRef as Hex) ?? null,
    receiptRef: (input.receiptRef as Hex) ?? null,
    encryptionVersion: hasCompleteEncryptionMetadata ? input.encryptionVersion as number : null,
    senderKeyCommitment: hasCompleteEncryptionMetadata ? input.senderKeyCommitment as Hex : null,
    recipientKeyCommitment: hasCompleteEncryptionMetadata ? input.recipientKeyCommitment as Hex : null,
    version: 0,
  };
}
