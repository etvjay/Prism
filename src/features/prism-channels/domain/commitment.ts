import type { ChannelCommitmentHashPort } from "./ports";
import type { Hex, PrismChannel } from "./channel";

/** Version of the offchain-to-anchor commitment preimage format. */
export const CHANNEL_ANCHOR_SCHEMA_VERSION = 1 as const;

const COMMITMENT_PATTERN = /^0x[0-9a-fA-F]{64}$/;

function assertFullCommitment(value: string, label: string): asserts value is Hex {
  if (!COMMITMENT_PATTERN.test(value)) throw new Error(`invalid_${label}_commitment`);
}

/**
 * Builds a channel commitment from communication-key commitments only.
 * Participant identifiers and channel ids are intentionally absent from the
 * preimage, so the resulting public anchor is not a participant linkage.
 */
export function buildChannelCommitment(channel: PrismChannel, hash: ChannelCommitmentHashPort): Hex {
  const commitments = channel.participants
    .map((participant) => channel.keyCommitments[participant]?.toLowerCase() ?? "missing")
    .sort();
  for (const commitment of commitments) {
    if (commitment !== "missing") assertFullCommitment(commitment, "channel_key");
  }
  return hash.hashUtf8([
    "prism-channel-anchor",
    `v${CHANNEL_ANCHOR_SCHEMA_VERSION}`,
    ...commitments,
  ].join("|"));
}

/**
 * Builds a message commitment from opaque commitments. The local message id is
 * included only in the hash preimage and is never emitted as anchor metadata.
 */
export function buildMessageCommitment(input: {
  channelCommitment: Hex;
  ciphertextHash: Hex;
  messageId: string;
  hash: ChannelCommitmentHashPort;
}): Hex {
  assertFullCommitment(input.channelCommitment, "channel");
  assertFullCommitment(input.ciphertextHash, "ciphertext");
  if (!input.messageId || input.messageId.trim().length === 0) throw new Error("message_id_required");
  const messageIdHash = input.hash.hashUtf8(input.messageId.trim());
  return input.hash.hashUtf8([
    "prism-channel-message-anchor",
    `v${CHANNEL_ANCHOR_SCHEMA_VERSION}`,
    input.channelCommitment.toLowerCase(),
    input.ciphertextHash.toLowerCase(),
    messageIdHash.toLowerCase(),
  ].join("|"));
}
