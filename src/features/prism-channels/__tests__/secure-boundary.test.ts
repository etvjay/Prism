import { describe, expect, it, vi } from "vitest";
import { PrismChannelService } from "../application/channel-service";
import {
  FixedClock,
  InMemoryChannelStore,
  InMemoryKeyCommitmentPort,
  InMemoryMessageStore,
  SequentialIdGenerator,
} from "../adapters/memory-channel-store";
import { CHANNEL_ERROR_CODE } from "../domain/errors";
import type { ParticipantCommunicationEncryptionPort } from "../domain/ports";
import { ALICE, BOB, makeCommitment } from "../testing/fixtures";

const SECRET_MEMO = new TextEncoder().encode("Dinner reimbursement: 25 STRK");
const CIPHERTEXT = `0x${"ab".repeat(48)}` as `0x${string}`;

function makeSecureService(encryptionPort?: ParticipantCommunicationEncryptionPort) {
  const channelStore = new InMemoryChannelStore();
  const messageStore = new InMemoryMessageStore();
  const keyCommitmentPort = new InMemoryKeyCommitmentPort();
  const service = new PrismChannelService({
    channelStore,
    messageStore,
    keyCommitmentPort,
    encryptionPort,
    clock: new FixedClock(4_000_000),
    idGenerator: new SequentialIdGenerator(),
  });
  keyCommitmentPort.register(ALICE, makeCommitment(ALICE, "secure-a"));
  keyCommitmentPort.register(BOB, makeCommitment(BOB, "secure-b"));
  return { service, channelStore, messageStore, keyCommitmentPort };
}

async function createActiveChannel(service: PrismChannelService): Promise<void> {
  await service.createChannel({ initiator: ALICE, peer: BOB, channelId: "ch_secure_01" });
  await service.acceptChannel({ channelId: "ch_secure_01", caller: BOB });
}

describe("PrismChannel participant-owned encryption boundary", () => {
  it("encrypts at the injected participant boundary and persists only the encrypted envelope", async () => {
    const encryptionPort: ParticipantCommunicationEncryptionPort = {
      encrypt: vi.fn(async (input) => ({
        ciphertext: CIPHERTEXT,
        encryptionVersion: 1,
        senderKeyCommitment: input.senderKeyCommitment,
        recipientKeyCommitment: input.recipientKeyCommitment,
      })),
      decrypt: vi.fn(),
    };
    const { service, messageStore } = makeSecureService(encryptionPort);
    await createActiveChannel(service);

    const message = await service.sendEncryptedMemo({
      channelId: "ch_secure_01",
      sender: ALICE,
      contentType: "payment_memo",
      messageId: "msg_secure_01",
      plaintext: SECRET_MEMO,
      paymentRef: `0x${"11".repeat(32)}`,
    });

    expect(encryptionPort.encrypt).toHaveBeenCalledOnce();
    expect(message.ciphertext).toBe(CIPHERTEXT);
    expect(message.encryptionVersion).toBe(1);
    expect(message.senderKeyCommitment).toBe(makeCommitment(ALICE, "secure-a"));
    expect(message.recipientKeyCommitment).toBe(makeCommitment(BOB, "secure-b"));
    const stored = await messageStore.getById("msg_secure_01");
    expect(stored).toEqual(message);
    expect(JSON.stringify(stored)).not.toContain("Dinner reimbursement");
    expect(JSON.stringify(stored)).not.toContain("25 STRK");
    expect(stored?.paymentRef).toBe(`0x${"11".repeat(32)}`);
  });

  it("binds decryption to the authenticated recipient and rejects the other participant", async () => {
    const encryptionPort: ParticipantCommunicationEncryptionPort = {
      encrypt: vi.fn(async (input) => ({
        ciphertext: CIPHERTEXT,
        encryptionVersion: 1,
        senderKeyCommitment: input.senderKeyCommitment,
        recipientKeyCommitment: input.recipientKeyCommitment,
      })),
      decrypt: vi.fn(async (input) => {
        if (input.recipient !== BOB) throw new Error("wrong_recipient");
        return SECRET_MEMO;
      }),
    };
    const { service } = makeSecureService(encryptionPort);
    await createActiveChannel(service);
    await service.sendEncryptedMemo({
      channelId: "ch_secure_01",
      sender: ALICE,
      contentType: "payment_memo",
      messageId: "msg_secure_03",
      plaintext: SECRET_MEMO,
    });

    await expect(service.decryptMessage({ channelId: "ch_secure_01", messageId: "msg_secure_03", recipient: BOB }))
      .resolves.toEqual(SECRET_MEMO);
    await expect(service.decryptMessage({ channelId: "ch_secure_01", messageId: "msg_secure_03", recipient: ALICE }))
      .rejects.toMatchObject({ code: CHANNEL_ERROR_CODE.RECIPIENT_MISMATCH });
  });

  it("maps authenticated decryption failure to a sanitized tamper error", async () => {
    const encryptionPort: ParticipantCommunicationEncryptionPort = {
      encrypt: vi.fn(async (input) => ({
        ciphertext: CIPHERTEXT,
        encryptionVersion: 1,
        senderKeyCommitment: input.senderKeyCommitment,
        recipientKeyCommitment: input.recipientKeyCommitment,
      })),
      decrypt: vi.fn(async () => {
        throw new Error("ciphertext_or_aad_tampered");
      }),
    };
    const { service } = makeSecureService(encryptionPort);
    await createActiveChannel(service);
    await service.sendEncryptedMemo({
      channelId: "ch_secure_01",
      sender: ALICE,
      contentType: "payment_memo",
      messageId: "msg_secure_04",
      plaintext: SECRET_MEMO,
    });

    await expect(service.decryptMessage({ channelId: "ch_secure_01", messageId: "msg_secure_04", recipient: BOB }))
      .rejects.toMatchObject({ code: CHANNEL_ERROR_CODE.CIPHERTEXT_AUTHENTICATION_FAILED });
  });

  it("rejects a provider envelope whose commitments do not authenticate the channel", async () => {
    const encryptionPort: ParticipantCommunicationEncryptionPort = {
      encrypt: vi.fn(async (input) => ({
        ciphertext: CIPHERTEXT,
        encryptionVersion: 1,
        senderKeyCommitment: input.senderKeyCommitment,
        recipientKeyCommitment: `0x${"ff".repeat(32)}` as `0x${string}`,
      })),
      decrypt: vi.fn(),
    };
    const { service } = makeSecureService(encryptionPort);
    await createActiveChannel(service);

    await expect(service.sendEncryptedMemo({
      channelId: "ch_secure_01",
      sender: ALICE,
      contentType: "payment_memo",
      messageId: "msg_secure_06",
      plaintext: SECRET_MEMO,
    })).rejects.toMatchObject({ code: CHANNEL_ERROR_CODE.COMMITMENT_MISMATCH });
  });

  it("rejects malformed provider envelopes without leaking a raw provider error", async () => {
    const encryptionPort: ParticipantCommunicationEncryptionPort = {
      encrypt: vi.fn(async () => undefined as never),
      decrypt: vi.fn(),
    };
    const { service } = makeSecureService(encryptionPort);
    await createActiveChannel(service);

    await expect(service.sendEncryptedMemo({
      channelId: "ch_secure_01",
      sender: ALICE,
      contentType: "payment_memo",
      messageId: "msg_secure_07",
      plaintext: SECRET_MEMO,
    })).rejects.toMatchObject({ code: CHANNEL_ERROR_CODE.INVALID_ENCRYPTED_MEMO });
  });

  it("checks message replay before invoking participant encryption", async () => {
    const encryptionPort: ParticipantCommunicationEncryptionPort = {
      encrypt: vi.fn(async (input) => ({
        ciphertext: CIPHERTEXT,
        encryptionVersion: 1,
        senderKeyCommitment: input.senderKeyCommitment,
        recipientKeyCommitment: input.recipientKeyCommitment,
      })),
      decrypt: vi.fn(),
    };
    const { service } = makeSecureService(encryptionPort);
    await createActiveChannel(service);
    const request = {
      channelId: "ch_secure_01",
      sender: ALICE,
      contentType: "payment_memo" as const,
      messageId: "msg_secure_05",
      plaintext: SECRET_MEMO,
    };
    await service.sendEncryptedMemo(request);
    await expect(service.sendEncryptedMemo(request)).rejects.toMatchObject({ code: CHANNEL_ERROR_CODE.REPLAY_DETECTED });
    expect(encryptionPort.encrypt).toHaveBeenCalledOnce();
  });
  it("sanitizes participant provider failures so plaintext never reaches the error boundary", async () => {
    const encryptionPort: ParticipantCommunicationEncryptionPort = {
      encrypt: vi.fn(async () => {
        throw new Error(`provider failed for ${new TextDecoder().decode(SECRET_MEMO)}`);
      }),
      decrypt: vi.fn(),
    };
    const { service } = makeSecureService(encryptionPort);
    await createActiveChannel(service);

    const result = service.sendEncryptedMemo({
      channelId: "ch_secure_01",
      sender: ALICE,
      contentType: "payment_memo",
      messageId: "msg_secure_08",
      plaintext: SECRET_MEMO,
    });
    await expect(result).rejects.toMatchObject({ code: CHANNEL_ERROR_CODE.ENCRYPTION_PROVIDER_UNAVAILABLE });
    await result.catch((error: unknown) => {
      expect(String(error)).not.toContain("Dinner reimbursement");
      expect(String(error)).not.toContain("25 STRK");
    });
  });

  it("refuses encrypted sends when the participant encryption provider is unavailable", async () => {
    const { service } = makeSecureService();
    await createActiveChannel(service);

    await expect(
      service.sendEncryptedMemo({
        channelId: "ch_secure_01",
        sender: ALICE,
        contentType: "payment_memo",
        messageId: "msg_secure_02",
        plaintext: SECRET_MEMO,
      }),
    ).rejects.toMatchObject({ code: CHANNEL_ERROR_CODE.ENCRYPTION_PROVIDER_UNAVAILABLE });
  });
});
