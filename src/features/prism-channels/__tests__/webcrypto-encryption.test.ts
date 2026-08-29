import { describe, expect, it } from "vitest";
import { WebCryptoParticipantCommunicationEncryption } from "../adapters/webcrypto-encryption";
import type { ParticipantEncryptionKeyProvider } from "../adapters/webcrypto-encryption";
import type { ParticipantCommunicationEncryptionPort } from "../domain/ports";
import { ALICE, BOB, makeCommitment } from "../testing/fixtures";

const SENDER_COMMITMENT = makeCommitment(ALICE, "webcrypto-a");
const RECIPIENT_COMMITMENT = makeCommitment(BOB, "webcrypto-b");

async function makeCrypto(): Promise<{ encryption: ParticipantCommunicationEncryptionPort; key: CryptoKey }> {
  const key = await globalThis.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  ) as CryptoKey;
  const keys: ParticipantEncryptionKeyProvider = {
    getKey: async () => key,
  };
  return { encryption: new WebCryptoParticipantCommunicationEncryption({ keys }), key };
}

function input(overrides: Partial<Parameters<ParticipantCommunicationEncryptionPort["encrypt"]>[0]> = {}) {
  return {
    channelId: "ch_webcrypto_01",
    messageId: "msg_webcrypto_01",
    sender: ALICE,
    recipient: BOB,
    senderKeyCommitment: SENDER_COMMITMENT,
    recipientKeyCommitment: RECIPIENT_COMMITMENT,
    associatedData: "prism-channel-memo|v1|ch_webcrypto_01|msg_webcrypto_01|prism:ALICE01|prism:BOB02",
    plaintext: new TextEncoder().encode("private memo"),
    ...overrides,
  };
}

describe("participant-owned Web Crypto encryption adapter", () => {
  it("round-trips an authenticated memo with AES-GCM and returns opaque ciphertext", async () => {
    const { encryption } = await makeCrypto();
    const request = input();
    const envelope = await encryption.encrypt(request);

    expect(envelope.encryptionVersion).toBe(1);
    expect(envelope.ciphertext).toMatch(/^0x[0-9a-f]{56,}$/);
    expect(envelope.ciphertext).not.toContain("private memo");
    const plaintext = await encryption.decrypt({ ...request, ciphertext: envelope.ciphertext, encryptionVersion: envelope.encryptionVersion });
    expect(new TextDecoder().decode(plaintext)).toBe("private memo");
  });

  it("rejects ciphertext tampering through AES-GCM authentication", async () => {
    const { encryption } = await makeCrypto();
    const request = input();
    const envelope = await encryption.encrypt(request);
    const last = envelope.ciphertext.slice(-1).toLowerCase();
    const tampered = `${envelope.ciphertext.slice(0, -1)}${last === "0" ? "1" : "0"}` as `0x${string}`;

    await expect(encryption.decrypt({ ...request, ciphertext: tampered, encryptionVersion: envelope.encryptionVersion }))
      .rejects.toThrow();
  });

  it("rejects associated-data tampering such as a changed recipient", async () => {
    const { encryption } = await makeCrypto();
    const request = input();
    const envelope = await encryption.encrypt(request);
    const changedAssociatedData = request.associatedData.replace("prism:BOB02", "prism:ALICE01");

    await expect(encryption.decrypt({
      ...request,
      associatedData: changedAssociatedData,
      ciphertext: envelope.ciphertext,
      encryptionVersion: envelope.encryptionVersion,
    })).rejects.toThrow();
  });
});
