import { describe, expect, it } from "vitest";
import { PostgresMessageStore, CHANNEL_STORE_MIGRATION_SQL } from "../adapters/postgres-channel-store";
import type { ChannelMessage } from "../domain/message";
import { CHANNEL_ERROR_CODE } from "../domain/errors";
import { createMessage } from "../domain/message";
import { createChannel } from "../domain/channel";
import { ALICE, BOB, makeCommitment } from "../testing/fixtures";

class DurableMessageDatabase {
  readonly queries: Array<{ text: string; values: readonly unknown[] }> = [];
  private row: Record<string, unknown> | null = null;

  async query<T = Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
    this.queries.push({ text, values });
    if (text.includes("INSERT INTO prism_channel_messages")) {
      const [schemaVersion, messageId, channelId, sender, ciphertext, contentType, createdAt, replyTo, paymentRef, claimRef, receiptRef, encryptionVersion, senderKeyCommitment, recipientKeyCommitment, version] = values;
      this.row = { schema_version: schemaVersion, message_id: messageId, channel_id: channelId, sender, ciphertext, content_type: contentType, created_at: createdAt, reply_to: replyTo, payment_ref: paymentRef, claim_ref: claimRef, receipt_ref: receiptRef, encryption_version: encryptionVersion, sender_key_commitment: senderKeyCommitment, recipient_key_commitment: recipientKeyCommitment, version };
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("FROM prism_channel_messages")) {
      return { rows: this.row ? [this.row as T] : [], rowCount: this.row ? 1 : 0 };
    }
    if (text.includes("SELECT value FROM prism_channel_store_meta")) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 1 };
  }
}

const CHANNEL = createChannel({
  channelId: "ch_store_01",
  initiator: ALICE,
  peer: BOB,
  initiatorCommitment: makeCommitment(ALICE, "store-a"),
  now: 6_000_000,
});
const MESSAGE = createMessage({
  messageId: "msg_store_01",
  channel: { ...CHANNEL, status: "ACTIVE", keyCommitments: { ...CHANNEL.keyCommitments, [BOB]: makeCommitment(BOB, "store-b") } },
  sender: ALICE,
  ciphertext: `0x${"ef".repeat(48)}`,
  contentType: "payment_memo",
  createdAt: 6_000_001,
  paymentRef: `0x${"12".repeat(32)}`,
  encryptionVersion: 1,
  senderKeyCommitment: makeCommitment(ALICE, "store-a"),
  recipientKeyCommitment: makeCommitment(BOB, "store-b"),
});

describe("PrismChannel durable encrypted-ciphertext storage", () => {
  it("defines a durable message table with ciphertext and no plaintext column", () => {
    expect(CHANNEL_STORE_MIGRATION_SQL).toContain("prism_channel_messages");
    expect(CHANNEL_STORE_MIGRATION_SQL).toContain("ciphertext TEXT NOT NULL");
    expect(CHANNEL_STORE_MIGRATION_SQL).toContain("encryption_version");
    expect(CHANNEL_STORE_MIGRATION_SQL).not.toMatch(/plaintext\s+(TEXT|JSON|VARCHAR)/i);
  });

  it("recovers an authenticated encrypted message through a second store instance", async () => {
    const database = new DurableMessageDatabase();
    const writer = await PostgresMessageStore.create({ database });
    await writer.put(MESSAGE);
    const reader = await PostgresMessageStore.create({ database, skipMigration: true });
    await expect(reader.getById(MESSAGE.messageId)).resolves.toEqual(MESSAGE);
    const insert = database.queries.find((query) => query.text.includes("INSERT INTO prism_channel_messages"));
    expect(insert?.values).not.toContain("Dinner reimbursement");
    expect(insert?.values).not.toContain("25 STRK");
  });

  it("rejects an unencrypted message at the durable storage boundary", async () => {
    const database = new DurableMessageDatabase();
    const store = await PostgresMessageStore.create({ database });
    const unencrypted = { ...MESSAGE, messageId: "msg_store_02", encryptionVersion: null, senderKeyCommitment: null, recipientKeyCommitment: null } as ChannelMessage;
    await expect(store.put(unencrypted)).rejects.toMatchObject({ code: CHANNEL_ERROR_CODE.INVALID_ENCRYPTED_MEMO });
  });
});
