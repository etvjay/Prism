// Durable PostgreSQL adapters for PrismChannel state and encrypted messages.
//
// These adapters persist only the encrypted envelope and opaque relationship
// references. Communication key material and plaintext stay in the injected
// participant provider. The anchor publisher is intentionally a separate
// boundary; this file never talks to Starknet.

import { Pool, type PoolConfig } from "pg";
import type { ChannelMessage } from "../domain/message";
import { assertValidMessageId, detectPlaintextLeakage } from "../domain/message";
import type { Hex, PrismChannel } from "../domain/channel";
import { assertValidChannelId, assertValidCommitment, assertValidPrismId } from "../domain/channel";
import { CHANNEL_ERROR_CODE, PrismChannelError } from "../domain/errors";
import type { ChannelMessageStore, ChannelStore } from "../domain/ports";

export const CHANNEL_STORE_SCHEMA_VERSION = 1;

export const CHANNEL_STORE_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS prism_channel_store_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prism_channels (
  schema_version INTEGER NOT NULL,
  channel_id TEXT PRIMARY KEY,
  participants_json TEXT NOT NULL,
  key_commitments_json TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PROPOSED','ACCEPTED','ACTIVE','ARCHIVED','REVOKED')),
  policy_json TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 0),
  created_by TEXT NOT NULL,
  accepted_at BIGINT,
  archived_at BIGINT,
  revoked_at BIGINT,
  revoked_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_prism_channels_participants
  ON prism_channels USING GIN ((participants_json::jsonb));
CREATE TABLE IF NOT EXISTS prism_channel_messages (
  schema_version INTEGER NOT NULL,
  message_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES prism_channels(channel_id),
  sender TEXT NOT NULL,
  ciphertext TEXT NOT NULL CHECK (ciphertext ~ '^0x[0-9a-fA-F]{56,}$'),
  content_type TEXT NOT NULL CHECK (content_type IN ('payment_memo','receipt','claim_invitation','authorization_request')),
  created_at BIGINT NOT NULL,
  reply_to TEXT,
  payment_ref TEXT,
  claim_ref TEXT,
  receipt_ref TEXT,
  encryption_version INTEGER NOT NULL CHECK (encryption_version > 0),
  sender_key_commitment TEXT NOT NULL CHECK (sender_key_commitment ~ '^0x[0-9a-fA-F]{64}$'),
  recipient_key_commitment TEXT NOT NULL CHECK (recipient_key_commitment ~ '^0x[0-9a-fA-F]{64}$'),
  version INTEGER NOT NULL CHECK (version >= 0),
  CHECK (payment_ref IS NULL OR payment_ref ~ '^0x[0-9a-fA-F]{32,}$'),
  CHECK (claim_ref IS NULL OR claim_ref ~ '^0x[0-9a-fA-F]{32,}$'),
  CHECK (receipt_ref IS NULL OR receipt_ref ~ '^0x[0-9a-fA-F]{32,}$')
);
CREATE INDEX IF NOT EXISTS idx_prism_channel_messages_channel
  ON prism_channel_messages(channel_id, created_at, message_id);
`;

type QueryResult<T> = { rows: T[]; rowCount: number | null };

export interface ChannelStoreDatabase {
  query<T = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
  end?(): Promise<void>;
}

export interface PostgresChannelStoreOptions extends Omit<Pick<PoolConfig, keyof PoolConfig>, "database"> {
  pool?: PoolConfig;
  database?: ChannelStoreDatabase;
  skipMigration?: boolean;
}

export type PostgresChannelStoreErrorCode =
  | "store_connect_failed"
  | "store_migrate_failed"
  | "duplicate_record"
  | "store_write_failed"
  | "store_read_failed"
  | "invalid_record";

export class PostgresChannelStoreError extends Error {
  readonly code: PostgresChannelStoreErrorCode;

  constructor(code: PostgresChannelStoreErrorCode, message: string, cause?: unknown) {
    super(`[${code}] ${message}${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "PostgresChannelStoreError";
    this.code = code;
  }
}

function mergePoolConfig(options: PostgresChannelStoreOptions): PoolConfig {
  const { pool, database: _database, skipMigration: _skipMigration, ...flat } = options;
  return { ...flat, ...(pool ?? {}) };
}

function databaseFor(options: PostgresChannelStoreOptions): { database: ChannelStoreDatabase; owned: boolean } {
  if (options.database) return { database: options.database, owned: false };
  return { database: new Pool(mergePoolConfig(options)) as unknown as ChannelStoreDatabase, owned: true };
}

function integer(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed)) throw new Error(`invalid_${field}`);
  return parsed;
}

function nullableInteger(value: unknown, field: string): number | null {
  return value === null || value === undefined ? null : integer(value, field);
}

function validateOpaqueReference(value: string | null | undefined, field: string): void {
  if (value !== undefined && value !== null && !/^0x[0-9a-fA-F]{32,}$/.test(value)) {
    throw new PrismChannelError(CHANNEL_ERROR_CODE.PLAINTEXT_LEAKAGE, `${field}_must_be_opaque_hex`);
  }
}

function validateEncryptedMessage(message: ChannelMessage): void {
  assertValidMessageId(message.messageId);
  assertValidChannelId(message.channelId);
  assertValidPrismId(message.sender);
  if (typeof message.ciphertext !== "string") {
    throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_ENCRYPTED_MEMO, "ciphertext_must_be_text");
  }
  detectPlaintextLeakage(message.ciphertext);
  validateOpaqueReference(message.paymentRef, "payment_ref");
  validateOpaqueReference(message.claimRef, "claim_ref");
  validateOpaqueReference(message.receiptRef, "receipt_ref");
  if (!Number.isSafeInteger(message.encryptionVersion) || (message.encryptionVersion as number) <= 0) {
    throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_ENCRYPTED_MEMO, "durable_message_requires_encryption_version");
  }
  if (typeof message.senderKeyCommitment !== "string" || typeof message.recipientKeyCommitment !== "string") {
    throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_ENCRYPTED_MEMO, "durable_message_commitments_required");
  }
  assertValidCommitment(message.senderKeyCommitment);
  assertValidCommitment(message.recipientKeyCommitment);
  if (!Number.isSafeInteger(message.createdAt)) throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_STATUS_TRANSITION, "invalid_created_at");
  if (!Number.isSafeInteger(message.version) || message.version < 0) throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_ENCRYPTED_MEMO, "message_version_invalid");
}

function messageValues(message: ChannelMessage): unknown[] {
  return [
    CHANNEL_STORE_SCHEMA_VERSION,
    message.messageId,
    message.channelId,
    message.sender,
    message.ciphertext,
    message.contentType,
    message.createdAt,
    message.replyTo ?? null,
    message.paymentRef ?? null,
    message.claimRef ?? null,
    message.receiptRef ?? null,
    message.encryptionVersion,
    message.senderKeyCommitment,
    message.recipientKeyCommitment,
    message.version,
  ];
}

type MessageRow = {
  schema_version: number | string;
  message_id: string;
  channel_id: string;
  sender: string;
  ciphertext: string;
  content_type: ChannelMessage["contentType"];
  created_at: number | string;
  reply_to: string | null;
  payment_ref: string | null;
  claim_ref: string | null;
  receipt_ref: string | null;
  encryption_version: number | string;
  sender_key_commitment: string;
  recipient_key_commitment: string;
  version: number | string;
};

function rowToMessage(row: MessageRow): ChannelMessage {
  if (integer(row.schema_version, "schema_version") !== CHANNEL_STORE_SCHEMA_VERSION) {
    throw new PostgresChannelStoreError("store_read_failed", "unsupported_message_schema_version");
  }
  const message: ChannelMessage = {
    messageId: row.message_id,
    channelId: row.channel_id,
    sender: row.sender,
    ciphertext: row.ciphertext as Hex,
    contentType: row.content_type,
    createdAt: integer(row.created_at, "created_at"),
    replyTo: row.reply_to,
    paymentRef: row.payment_ref as Hex | null,
    claimRef: row.claim_ref as Hex | null,
    receiptRef: row.receipt_ref as Hex | null,
    encryptionVersion: integer(row.encryption_version, "encryption_version"),
    senderKeyCommitment: row.sender_key_commitment as Hex,
    recipientKeyCommitment: row.recipient_key_commitment as Hex,
    version: integer(row.version, "version"),
  };
  validateEncryptedMessage(message);
  return message;
}

export class PostgresMessageStore implements ChannelMessageStore {
  private readonly database: ChannelStoreDatabase;
  private readonly owned: boolean;
  private closed = false;

  constructor(options: PostgresChannelStoreOptions) {
    const selected = databaseFor(options);
    this.database = selected.database;
    this.owned = selected.owned;
  }

  async migrate(): Promise<void> {
    this.assertOpen();
    try {
      await this.database.query(CHANNEL_STORE_MIGRATION_SQL);
      const meta = await this.database.query<{ value: string }>(
        "SELECT value FROM prism_channel_store_meta WHERE key = 'schema_version'",
      );
      if (!meta.rowCount || meta.rowCount === 0) {
        await this.database.query(
          "INSERT INTO prism_channel_store_meta (key, value) VALUES ('schema_version', $1)",
          [String(CHANNEL_STORE_SCHEMA_VERSION)],
        );
      } else {
        const current = integer(meta.rows[0].value, "schema_version");
        if (current > CHANNEL_STORE_SCHEMA_VERSION) {
          throw new PostgresChannelStoreError("store_migrate_failed", "channel schema is newer than this adapter");
        }
        if (current < CHANNEL_STORE_SCHEMA_VERSION) {
          await this.database.query(
            "UPDATE prism_channel_store_meta SET value = $1 WHERE key = 'schema_version'",
            [String(CHANNEL_STORE_SCHEMA_VERSION)],
          );
        }
      }
    } catch (cause) {
      if (cause instanceof PostgresChannelStoreError) throw cause;
      throw new PostgresChannelStoreError("store_migrate_failed", "channel migration failed", cause);
    }
  }

  static async create(options: PostgresChannelStoreOptions): Promise<PostgresMessageStore> {
    const store = new PostgresMessageStore(options);
    if (!options.skipMigration) await store.migrate();
    return store;
  }

  async put(message: ChannelMessage): Promise<void> {
    this.assertOpen();
    validateEncryptedMessage(message);
    try {
      const result = await this.database.query(
        "INSERT INTO prism_channel_messages (schema_version, message_id, channel_id, sender, ciphertext, content_type, created_at, reply_to, payment_ref, claim_ref, receipt_ref, encryption_version, sender_key_commitment, recipient_key_commitment, version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
        messageValues(message),
      );
      if (result.rowCount !== 1) throw new PostgresChannelStoreError("store_write_failed", "message insert did not write exactly one row");
    } catch (cause) {
      if (cause instanceof PrismChannelError || cause instanceof PostgresChannelStoreError) throw cause;
      if ((cause as { code?: string } | null)?.code === "23505") {
        throw new PrismChannelError(CHANNEL_ERROR_CODE.REPLAY_DETECTED, `duplicate_message_id:${message.messageId}`);
      }
      throw new PostgresChannelStoreError("store_write_failed", "message insert failed", cause);
    }
  }

  async getById(messageId: string): Promise<ChannelMessage | undefined> {
    this.assertOpen();
    try {
      const result = await this.database.query<MessageRow>(
        "SELECT schema_version, message_id, channel_id, sender, ciphertext, content_type, created_at, reply_to, payment_ref, claim_ref, receipt_ref, encryption_version, sender_key_commitment, recipient_key_commitment, version FROM prism_channel_messages WHERE message_id = $1",
        [messageId],
      );
      if (!result.rowCount || result.rowCount === 0) return undefined;
      return rowToMessage(result.rows[0]);
    } catch (cause) {
      if (cause instanceof PrismChannelError) throw cause;
      throw new PostgresChannelStoreError("store_read_failed", "message read failed", cause);
    }
  }

  async listByChannel(channelId: string): Promise<ChannelMessage[]> {
    this.assertOpen();
    try {
      const result = await this.database.query<MessageRow>(
        "SELECT schema_version, message_id, channel_id, sender, ciphertext, content_type, created_at, reply_to, payment_ref, claim_ref, receipt_ref, encryption_version, sender_key_commitment, recipient_key_commitment, version FROM prism_channel_messages WHERE channel_id = $1 ORDER BY created_at ASC, message_id ASC",
        [channelId],
      );
      return result.rows.map(rowToMessage);
    } catch (cause) {
      if (cause instanceof PrismChannelError) throw cause;
      throw new PostgresChannelStoreError("store_read_failed", "channel messages read failed", cause);
    }
  }

  async scanCiphertexts(): Promise<string[]> {
    this.assertOpen();
    try {
      const result = await this.database.query<{ ciphertext: string }>(
        "SELECT ciphertext FROM prism_channel_messages ORDER BY created_at ASC, message_id ASC",
      );
      return result.rows.map((row) => row.ciphertext);
    } catch (cause) {
      throw new PostgresChannelStoreError("store_read_failed", "ciphertext scan failed", cause);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.owned && this.database.end) {
      try {
        await this.database.end();
      } catch (cause) {
        throw new PostgresChannelStoreError("store_connect_failed", "message store close failed", cause);
      }
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new PostgresChannelStoreError("store_connect_failed", "message store is closed");
  }
}

type ChannelRow = {
  schema_version: number | string;
  channel_id: string;
  participants_json: string;
  key_commitments_json: string;
  created_at: number | string;
  status: PrismChannel["status"];
  policy_json: string;
  version: number | string;
  created_by: string;
  accepted_at: number | string | null;
  archived_at: number | string | null;
  revoked_at: number | string | null;
  revoked_by: string | null;
};

function validateChannel(channel: PrismChannel): void {
  assertValidChannelId(channel.channelId);
  if (channel.participants.length !== 2 || channel.participants[0] === channel.participants[1]) {
    throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_PARTICIPANTS, "channel_requires_two_distinct_participants");
  }
  channel.participants.forEach(assertValidPrismId);
  for (const participant of channel.participants) {
    const commitment = channel.keyCommitments[participant];
    if (commitment !== null) assertValidCommitment(commitment);
  }
  assertValidPrismId(channel.createdBy);
  if (!channel.participants.includes(channel.createdBy)) throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_PARTICIPANTS, "created_by_not_participant");
  if (!Number.isSafeInteger(channel.createdAt) || !Number.isSafeInteger(channel.version) || channel.version < 0) {
    throw new PrismChannelError(CHANNEL_ERROR_CODE.INVALID_STATUS_TRANSITION, "invalid_channel_timestamp_or_version");
  }
}

function channelValues(channel: PrismChannel): unknown[] {
  return [
    CHANNEL_STORE_SCHEMA_VERSION,
    channel.channelId,
    JSON.stringify(channel.participants),
    JSON.stringify(channel.keyCommitments),
    channel.createdAt,
    channel.status,
    JSON.stringify(channel.policy),
    channel.version,
    channel.createdBy,
    channel.acceptedAt ?? null,
    channel.archivedAt ?? null,
    channel.revokedAt ?? null,
    channel.revokedBy ?? null,
  ];
}

function parseJson<T>(value: string, field: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new PostgresChannelStoreError("store_read_failed", `corrupt_${field}`);
  }
}

function rowToChannel(row: ChannelRow): PrismChannel {
  const participants = parseJson<PrismChannel["participants"]>(row.participants_json, "participants");
  const keyCommitments = parseJson<PrismChannel["keyCommitments"]>(row.key_commitments_json, "key_commitments");
  const policy = parseJson<PrismChannel["policy"]>(row.policy_json, "policy");
  const channel: PrismChannel = {
    channelId: row.channel_id,
    participants,
    keyCommitments,
    createdAt: integer(row.created_at, "created_at"),
    status: row.status,
    policy,
    version: integer(row.version, "version"),
    createdBy: row.created_by,
    acceptedAt: nullableInteger(row.accepted_at, "accepted_at"),
    archivedAt: nullableInteger(row.archived_at, "archived_at"),
    revokedAt: nullableInteger(row.revoked_at, "revoked_at"),
    revokedBy: row.revoked_by,
  };
  validateChannel(channel);
  return channel;
}

export class PostgresChannelStore implements ChannelStore {
  private readonly database: ChannelStoreDatabase;
  private readonly owned: boolean;
  private closed = false;

  constructor(options: PostgresChannelStoreOptions) {
    const selected = databaseFor(options);
    this.database = selected.database;
    this.owned = selected.owned;
  }

  async migrate(): Promise<void> {
    this.assertOpen();
    try {
      await this.database.query(CHANNEL_STORE_MIGRATION_SQL);
      const meta = await this.database.query<{ value: string }>("SELECT value FROM prism_channel_store_meta WHERE key = 'schema_version'");
      if (!meta.rowCount || meta.rowCount === 0) {
        await this.database.query("INSERT INTO prism_channel_store_meta (key, value) VALUES ('schema_version', $1)", [String(CHANNEL_STORE_SCHEMA_VERSION)]);
      } else if (integer(meta.rows[0].value, "schema_version") > CHANNEL_STORE_SCHEMA_VERSION) {
        throw new PostgresChannelStoreError("store_migrate_failed", "channel schema is newer than this adapter");
      }
    } catch (cause) {
      if (cause instanceof PostgresChannelStoreError) throw cause;
      throw new PostgresChannelStoreError("store_migrate_failed", "channel migration failed", cause);
    }
  }

  static async create(options: PostgresChannelStoreOptions): Promise<PostgresChannelStore> {
    const store = new PostgresChannelStore(options);
    if (!options.skipMigration) await store.migrate();
    return store;
  }

  async put(channel: PrismChannel): Promise<void> {
    this.assertOpen();
    validateChannel(channel);
    try {
      const result = await this.database.query(
        "INSERT INTO prism_channels (schema_version, channel_id, participants_json, key_commitments_json, created_at, status, policy_json, version, created_by, accepted_at, archived_at, revoked_at, revoked_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
        channelValues(channel),
      );
      if (result.rowCount !== 1) throw new PostgresChannelStoreError("store_write_failed", "channel insert did not write exactly one row");
    } catch (cause) {
      if (cause instanceof PrismChannelError || cause instanceof PostgresChannelStoreError) throw cause;
      if ((cause as { code?: string } | null)?.code === "23505") throw new PostgresChannelStoreError("duplicate_record", `duplicate_channel:${channel.channelId}`, cause);
      throw new PostgresChannelStoreError("store_write_failed", "channel insert failed", cause);
    }
  }

  async getById(channelId: string): Promise<PrismChannel | undefined> {
    this.assertOpen();
    try {
      const result = await this.database.query<ChannelRow>(
        "SELECT schema_version, channel_id, participants_json, key_commitments_json, created_at, status, policy_json, version, created_by, accepted_at, archived_at, revoked_at, revoked_by FROM prism_channels WHERE channel_id = $1",
        [channelId],
      );
      if (!result.rowCount || result.rowCount === 0) return undefined;
      return rowToChannel(result.rows[0]);
    } catch (cause) {
      if (cause instanceof PrismChannelError || cause instanceof PostgresChannelStoreError) throw cause;
      throw new PostgresChannelStoreError("store_read_failed", "channel read failed", cause);
    }
  }

  async update(channelId: string, updater: (current: PrismChannel) => PrismChannel, expectedVersion: number): Promise<boolean> {
    this.assertOpen();
    const current = await this.getById(channelId);
    if (!current || current.version !== expectedVersion) return false;
    const next = updater(current);
    validateChannel(next);
    if (next.channelId !== channelId || next.version !== expectedVersion + 1) return false;
    try {
      const result = await this.database.query(
        "UPDATE prism_channels SET participants_json=$2, key_commitments_json=$3, created_at=$4, status=$5, policy_json=$6, version=$7, created_by=$8, accepted_at=$9, archived_at=$10, revoked_at=$11, revoked_by=$12 WHERE channel_id=$1 AND version=$13",
        [channelId, JSON.stringify(next.participants), JSON.stringify(next.keyCommitments), next.createdAt, next.status, JSON.stringify(next.policy), next.version, next.createdBy, next.acceptedAt ?? null, next.archivedAt ?? null, next.revokedAt ?? null, next.revokedBy ?? null, expectedVersion],
      );
      return result.rowCount === 1;
    } catch (cause) {
      throw new PostgresChannelStoreError("store_write_failed", "channel update failed", cause);
    }
  }

  async listByParticipant(prismId: string): Promise<PrismChannel[]> {
    this.assertOpen();
    assertValidPrismId(prismId);
    try {
      const result = await this.database.query<ChannelRow>(
        "SELECT schema_version, channel_id, participants_json, key_commitments_json, created_at, status, policy_json, version, created_by, accepted_at, archived_at, revoked_at, revoked_by FROM prism_channels WHERE participants_json::jsonb @> $1::jsonb ORDER BY created_at ASC, channel_id ASC",
        [JSON.stringify([prismId])],
      );
      return result.rows.map(rowToChannel);
    } catch (cause) {
      if (cause instanceof PrismChannelError || cause instanceof PostgresChannelStoreError) throw cause;
      throw new PostgresChannelStoreError("store_read_failed", "participant channel list failed", cause);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.owned && this.database.end) await this.database.end();
  }

  private assertOpen(): void {
    if (this.closed) throw new PostgresChannelStoreError("store_connect_failed", "channel store is closed");
  }
}
