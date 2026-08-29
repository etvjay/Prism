import { describe, expect, it, vi } from "vitest";
import { PrismChannelService } from "../application/channel-service";
import {
  FixedClock,
  InMemoryChannelStore,
  InMemoryKeyCommitmentPort,
  InMemoryMessageStore,
  SequentialIdGenerator,
} from "../adapters/memory-channel-store";
import type { ParticipantCommunicationEncryptionPort, StarknetCommitmentPublisherPort } from "../domain/ports";
import { buildChannelCommitment } from "../domain/commitment";
import { viemChannelCommitmentHash } from "../adapters/channel-crypto";
import { ALICE, BOB, makeCommitment } from "../testing/fixtures";

const CIPHERTEXT = `0x${"aa".repeat(48)}` as `0x${string}`;

function makeAnchor(): StarknetCommitmentPublisherPort & {
  channelInputs: Array<Parameters<StarknetCommitmentPublisherPort["publishChannelAnchor"]>[0]>;
  messageInputs: Array<Parameters<StarknetCommitmentPublisherPort["publishMessageAnchor"]>[0]>;
} {
  const channelInputs: Array<Parameters<StarknetCommitmentPublisherPort["publishChannelAnchor"]>[0]> = [];
  const messageInputs: Array<Parameters<StarknetCommitmentPublisherPort["publishMessageAnchor"]>[0]> = [];
  return {
    isTestDouble: false,
    abiVersion: "prism-channel-anchor-v1",
    contractAddress: "0x0000000000000000000000000000000000000000000000000000000000001234",
    channelInputs,
    messageInputs,
    publishChannelAnchor: vi.fn(async (input) => { channelInputs.push(input); return { txHash: `0x${"01".repeat(32)}` as `0x${string}` }; }),
    publishMessageAnchor: vi.fn(async (input) => { messageInputs.push(input); return { txHash: `0x${"02".repeat(32)}` as `0x${string}` }; }),
    readAnchor: vi.fn(async () => null),
  };
}

describe("PrismChannel service Starknet anchor integration", () => {
  it("does not anchor an unauthenticated raw ciphertext path", async () => {
    const keyCommitmentPort = new InMemoryKeyCommitmentPort();
    keyCommitmentPort.register(ALICE, makeCommitment(ALICE, "anchor-raw-a"));
    keyCommitmentPort.register(BOB, makeCommitment(BOB, "anchor-raw-b"));
    const anchor = makeAnchor();
    const service = new PrismChannelService({
      channelStore: new InMemoryChannelStore(),
      messageStore: new InMemoryMessageStore(),
      keyCommitmentPort,
      starknetCommitmentPublisher: anchor,
      clock: new FixedClock(8_000_100),
      idGenerator: new SequentialIdGenerator(),
    });
    await service.createChannel({ initiator: ALICE, peer: BOB, channelId: "ch_anchor_02" });
    await service.acceptChannel({ channelId: "ch_anchor_02", caller: BOB });

    await expect(service.sendMessage({
      channelId: "ch_anchor_02",
      sender: ALICE,
      ciphertext: CIPHERTEXT,
      contentType: "payment_memo",
      messageId: "msg_anchor_02",
    })).rejects.toMatchObject({ code: "ERR-053" });
    expect(anchor.messageInputs).toHaveLength(0);
  });

  it("rejects typed-anchor messages whose commitments are not authenticated to channel participants", async () => {
    const keyCommitmentPort = new InMemoryKeyCommitmentPort();
    keyCommitmentPort.register(ALICE, makeCommitment(ALICE, "anchor-mismatch-a"));
    keyCommitmentPort.register(BOB, makeCommitment(BOB, "anchor-mismatch-b"));
    const anchor = makeAnchor();
    const service = new PrismChannelService({
      channelStore: new InMemoryChannelStore(),
      messageStore: new InMemoryMessageStore(),
      keyCommitmentPort,
      starknetCommitmentPublisher: anchor,
      clock: new FixedClock(8_000_150),
      idGenerator: new SequentialIdGenerator(),
    });
    await service.createChannel({ initiator: ALICE, peer: BOB, channelId: "ch_anchor_04" });
    await service.acceptChannel({ channelId: "ch_anchor_04", caller: BOB });

    await expect(service.sendMessage({
      channelId: "ch_anchor_04",
      sender: ALICE,
      ciphertext: CIPHERTEXT,
      contentType: "payment_memo",
      messageId: "msg_anchor_04",
      encryptionVersion: 1,
      senderKeyCommitment: makeCommitment(ALICE, "anchor-mismatch-a"),
      recipientKeyCommitment: `0x${"ff".repeat(32)}`,
    })).rejects.toMatchObject({ code: "ERR-052" });
    expect(anchor.messageInputs).toHaveLength(0);
  });
  it("anchors terminal channel state transitions without publishing participant linkage", async () => {
    const keyCommitmentPort = new InMemoryKeyCommitmentPort();
    keyCommitmentPort.register(ALICE, makeCommitment(ALICE, "anchor-state-a"));
    keyCommitmentPort.register(BOB, makeCommitment(BOB, "anchor-state-b"));
    const anchor = makeAnchor();
    const service = new PrismChannelService({
      channelStore: new InMemoryChannelStore(),
      messageStore: new InMemoryMessageStore(),
      keyCommitmentPort,
      starknetCommitmentPublisher: anchor,
      clock: new FixedClock(8_000_200),
      idGenerator: new SequentialIdGenerator(),
    });
    await service.createChannel({ initiator: ALICE, peer: BOB, channelId: "ch_anchor_03" });
    await service.acceptChannel({ channelId: "ch_anchor_03", caller: BOB });
    await service.archiveChannel("ch_anchor_03", ALICE);
    await service.revokeChannel("ch_anchor_03", BOB);

    expect(anchor.channelInputs.map((input) => input.state)).toEqual(["PROPOSED", "ACTIVE", "ARCHIVED", "REVOKED"]);
    expect(JSON.stringify(anchor.channelInputs)).not.toContain("prism:ALICE");
  });
  it("anchors channel state and encrypted messages using opaque commitments only", async () => {
    const keyCommitmentPort = new InMemoryKeyCommitmentPort();
    keyCommitmentPort.register(ALICE, makeCommitment(ALICE, "anchor-a"));
    keyCommitmentPort.register(BOB, makeCommitment(BOB, "anchor-b"));
    const encryptionPort: ParticipantCommunicationEncryptionPort = {
      encrypt: vi.fn(async (input) => ({
        ciphertext: CIPHERTEXT,
        encryptionVersion: 1,
        senderKeyCommitment: input.senderKeyCommitment,
        recipientKeyCommitment: input.recipientKeyCommitment,
      })),
      decrypt: vi.fn(),
    };
    const anchor = makeAnchor();
    const channelStore = new InMemoryChannelStore();
    const service = new PrismChannelService({
      channelStore,
      messageStore: new InMemoryMessageStore(),
      keyCommitmentPort,
      encryptionPort,
      commitmentHashPort: viemChannelCommitmentHash,
      starknetCommitmentPublisher: anchor,
      clock: new FixedClock(8_000_000),
      idGenerator: new SequentialIdGenerator(),
    });

    const proposed = await service.createChannel({ initiator: ALICE, peer: BOB, channelId: "ch_anchor_01" });
    const active = await service.acceptChannel({ channelId: proposed.channelId, caller: BOB });
    await service.sendEncryptedMemo({
      channelId: proposed.channelId,
      sender: ALICE,
      contentType: "payment_memo",
      messageId: "msg_anchor_01",
      plaintext: new TextEncoder().encode("private memo"),
    });

    expect(anchor.channelInputs).toHaveLength(2);
    expect(anchor.channelInputs[0]).toMatchObject({ state: "PROPOSED", version: 0, observedAt: 8_000_000 });
    expect(anchor.channelInputs[1]).toMatchObject({
      state: "ACTIVE",
      version: active.version,
      observedAt: 8_000_000,
      commitment: buildChannelCommitment(active, viemChannelCommitmentHash),
    });
    expect(anchor.messageInputs).toHaveLength(1);
    expect(anchor.messageInputs[0].ciphertextHash).toBe(viemChannelCommitmentHash.hashUtf8(CIPHERTEXT));
    expect(JSON.stringify(anchor.channelInputs)).not.toContain("prism:ALICE");
    expect(JSON.stringify(anchor.messageInputs)).not.toContain("private memo");
  });
});
