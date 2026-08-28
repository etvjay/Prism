import { describe, expect, it } from "vitest";
import { keccak256, toBytes } from "viem";
import { createChannel } from "../domain/channel";
import { buildChannelCommitment, buildMessageCommitment } from "../domain/commitment";
import { viemChannelCommitmentHash } from "../adapters/channel-crypto";
import { ALICE, BOB, makeCommitment } from "../testing/fixtures";

const CHANNEL = createChannel({
  channelId: "ch_hash_01",
  initiator: ALICE,
  peer: BOB,
  initiatorCommitment: makeCommitment(ALICE, "hash-a"),
  now: 5_000_000,
});

const CIPHERTEXT_HASH = `0x${"cd".repeat(32)}` as `0x${string}`;

describe("PrismChannel authenticated commitment derivation", () => {
  it("uses the maintained keccak256 primitive instead of a deterministic placeholder", () => {
    const input = "prism-channel-commitment-test";
    expect(viemChannelCommitmentHash.hashUtf8(input)).toBe(keccak256(toBytes(input)));
  });

  it("derives a stable channel commitment from key commitments without participant identifiers", () => {
    const commitment = buildChannelCommitment(CHANNEL, viemChannelCommitmentHash);
    expect(commitment).toMatch(/^0x[0-9a-f]{64}$/);
    expect(commitment).not.toContain(ALICE.slice(2));
    expect(commitment).not.toContain(BOB.slice(2));
    expect(buildChannelCommitment(CHANNEL, viemChannelCommitmentHash)).toBe(commitment);
  });

  it("derives a distinct message commitment from the channel and ciphertext commitments", () => {
    const channelCommitment = buildChannelCommitment(CHANNEL, viemChannelCommitmentHash);
    const first = buildMessageCommitment({
      channelCommitment,
      ciphertextHash: CIPHERTEXT_HASH,
      messageId: "msg_hash_01",
      hash: viemChannelCommitmentHash,
    });
    const second = buildMessageCommitment({
      channelCommitment,
      ciphertextHash: CIPHERTEXT_HASH,
      messageId: "msg_hash_02",
      hash: viemChannelCommitmentHash,
    });
    expect(first).toMatch(/^0x[0-9a-f]{64}$/);
    expect(second).toMatch(/^0x[0-9a-f]{64}$/);
    expect(second).not.toBe(first);
  });
});
