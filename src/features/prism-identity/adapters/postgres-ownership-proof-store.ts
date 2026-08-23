// Durable PostgreSQL OwnershipProofStore adapter (port: OwnershipProofStore).
//
// Production persistence target for the T7 DB-integration tier. Implements
// INV-SYS-010 enforcement on a server-grade ACID store:
// - `consumeNonce` is one parameterized conditional UPDATE
//   (`SET nonce_state = 'CONSUMED' WHERE challenge_id = $1 AND nonce_state = 'UNUSED'`)
//   executed by PostgreSQL in its own implicit transaction. `rowCount === 1`
//   identifies the unique winner; no read-modify-write window exists, so
//   concurrent callers within a process and across instances/machines cannot
//   both observe "consumed".
// - `transitionState` is the same compare-and-set shape over `state`, writing
//   only patch keys actually present, so an absent patch never erases persisted
//   evidence fields.
//
// Transaction isolation & retry policy:
//   Every mutation is a SINGLE atomic statement; PostgreSQL executes each
//   statement atomically at READ COMMITTED, which is sufficient — the CAS is
//   the row lock itself, not a transaction boundary. No explicit BEGIN is used,
//   so there is nothing to retry on serialization failure from this adapter's
//   own writes. Multi-statement transactions are deliberately avoided here;
//   callers that compose several store calls must provide their own retry for
//   deadlock/serialization errors surfaced as codes
//   `store_write_failed`/`store_read_failed` (driver error code 40001/40P01 is
//   preserved on the cause). Statement timeouts and connection failures throw
//   fail-closed stable errors; they are never swallowed into optimistic results.
//
// Multi-instance deployment assumption:
//   All instances MUST point at the SAME PostgreSQL database (same host/cluster)
//   so row-level locking serializes nonce consumption cluster-wide. Unlike the
//   SQLite adapter, multi-host horizontal scaling IS supported with no shared
//   filesystem requirement.
//
// Failure policy: fail closed. Construction/migration failures, constraint
// violations, and unexpected driver errors throw a stable
// PostgresOwnershipProofStoreError with a machine-readable `code`.
//
// Secrets: credentials are supplied ONLY via caller-provided connection config
// or PG* environment variables read by `pg` itself; nothing is hardcoded and
// no secret value is ever written to disk or logs by this module.

import { Pool, type PoolClient } from "pg";
import type {
  ChallengeState,
  NonceState,
  OwnershipProofStore,
  SignatureClass,
  StoredOwnershipChallenge,
} from "../domain/ports";
import type { Hex } from "../domain/hex";
import type { PoolConfig } from "pg";

/** Current schema version of the durable challenge table. */
export const OWNERSHIP_STORE_SCHEMA_VERSION = 1;

/** Versioned migration applied at construction (idempotent). */
export const OWNERSHIP_STORE_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS prism_store_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ownership_challenges (
  schema_version INTEGER NOT NULL,
  challenge_id TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  domain TEXT NOT NULL,
  venue TEXT NOT NULL,
  execution_account TEXT NOT NULL,
  prism_id TEXT NOT NULL,
  issued_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  digest TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('ISSUED','VERIFIED','REJECTED','EXPIRED')),
  nonce_state TEXT NOT NULL CHECK (nonce_state IN ('UNUSED','CONSUMED')),
  verified_signature_class TEXT,
  verified_at BIGINT,
  rejection_json TEXT
);
`;

export type OwnershipStoreErrorCode =
  | "store_connect_failed"
  | "store_migrate_failed"
  | "duplicate_challenge_id"
  | "store_write_failed"
  | "store_read_failed"
  | "invalid_record";

export class PostgresOwnershipProofStoreError extends Error {
  readonly code: OwnershipStoreErrorCode;
  constructor(code: OwnershipStoreErrorCode, message: string, cause?: unknown) {
    super(`[${code}] ${message}${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "PostgresOwnershipProofStoreError";
    this.code = code;
  }
}

const COLUMNS = [
  "schema_version",
  "challenge_id",
  "nonce",
  "domain",
  "venue",
  "execution_account",
  "prism_id",
  "issued_at",
  "expires_at",
  "digest",
  "state",
  "nonce_state",
  "verified_signature_class",
  "verified_at",
  "rejection_json",
] as const;

interface Row {
  schema_version: number;
  challenge_id: string;
  nonce: string;
  domain: string;
  venue: string;
  execution_account: string;
  prism_id: string;
  issued_at: string | number;
  expires_at: string | number;
  digest: string;
  state: string;
  nonce_state: string;
  verified_signature_class: string | null;
  verified_at: string | number | null;
  rejection_json: string | null;
}

function toInt(value: string | number): number {
  const n = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(n)) throw new Error(`non-integer timestamp column value ${String(value)}`);
  return n;
}

function rowToRecord(row: Row): StoredOwnershipChallenge {
  let rejection: { code: string; detail?: string } | undefined;
  if (row.rejection_json !== null) {
    try {
      rejection = JSON.parse(row.rejection_json) as { code: string; detail?: string };
    } catch {
      throw new PostgresOwnershipProofStoreError(
        "store_read_failed",
        `corrupt rejection_json for challenge ${row.challenge_id}`,
      );
    }
  }
  return {
    schemaVersion: row.schema_version,
    challengeId: row.challenge_id as Hex,
    nonce: row.nonce as Hex,
    domain: row.domain,
    venue: row.venue as StoredOwnershipChallenge["venue"],
    executionAccount: row.execution_account as StoredOwnershipChallenge["executionAccount"],
    prismId: row.prism_id as StoredOwnershipChallenge["prismId"],
    issuedAt: toInt(row.issued_at),
    expiresAt: toInt(row.expires_at),
    digest: row.digest as Hex,
    state: row.state as ChallengeState,
    nonceState: row.nonce_state as NonceState,
    ...(row.verified_signature_class !== null
      ? { verifiedSignatureClass: row.verified_signature_class as SignatureClass }
      : {}),
    ...(row.verified_at !== null ? { verifiedAt: toInt(row.verified_at) } : {}),
    ...(rejection !== undefined ? { rejection } : {}),
  };
}

export interface PostgresOwnershipProofStoreOptions extends Pick<PoolConfig, keyof PoolConfig> {
  /** Explicit pool/connection options override any connectionString/env defaults. */
  pool?: PoolConfig;
  /**
   * When true, construction skips connecting until first use (pool is lazy);
   * migration still runs eagerly unless `skipMigration` is set. Default false:
   * construction verifies connectivity and migrates, failing fast.
   */
  skipMigration?: boolean;
}

function mergePoolConfig(options: PostgresOwnershipProofStoreOptions): PoolConfig {
  const { pool, skipMigration: _skip, ...flat } = options;
  return { ...flat, ...pool };
}

const VALID_STATES = new Set(["ISSUED", "VERIFIED", "REJECTED", "EXPIRED"]);

export class PostgresOwnershipProofStore implements OwnershipProofStore {
  private readonly pool: Pool;
  private readonly ownsPool: boolean;
  private closed = false;

  constructor(options: PostgresOwnershipProofStoreOptions) {
    // An externally supplied client/pool is not accepted; the store always owns
    // its Pool so lifecycle (close/end) stays unambiguous.
    this.pool = new Pool(mergePoolConfig(options));
    this.ownsPool = true;
  }

  /** Verify connectivity and apply the versioned migration (idempotent). */
  async migrate(): Promise<void> {
    this.assertOpen();
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
    } catch (cause) {
      throw new PostgresOwnershipProofStoreError("store_connect_failed", "cannot acquire connection", cause);
    }
    try {
      await client.query("BEGIN");
      try {
        await client.query(OWNERSHIP_STORE_MIGRATION_SQL);
        const meta = await client.query<{ value: string }>(
          "SELECT value FROM prism_store_meta WHERE key = 'schema_version' FOR UPDATE",
        );
        if (meta.rowCount === 0) {
          await client.query(
            "INSERT INTO prism_store_meta (key, value) VALUES ('schema_version', $1)",
            [String(OWNERSHIP_STORE_SCHEMA_VERSION)],
          );
        } else if (Number.parseInt(meta.rows[0].value, 10) > OWNERSHIP_STORE_SCHEMA_VERSION) {
          throw new PostgresOwnershipProofStoreError(
            "store_migrate_failed",
            `database schema_version ${meta.rows[0].value} is newer than supported ${OWNERSHIP_STORE_SCHEMA_VERSION}`,
          );
        }
        await client.query("COMMIT");
      } catch (inner) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw inner;
      }
    } catch (cause) {
      if (cause instanceof PostgresOwnershipProofStoreError) throw cause;
      throw new PostgresOwnershipProofStoreError("store_migrate_failed", "migration failed", cause);
    } finally {
      client.release();
    }
  }

  /** Factory that connects + migrates before returning (fail-fast startup). */
  static async create(options: PostgresOwnershipProofStoreOptions): Promise<PostgresOwnershipProofStore> {
    const store = new PostgresOwnershipProofStore(options);
    await store.migrate();
    return store;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new PostgresOwnershipProofStoreError("store_connect_failed", "store is closed");
    }
  }

  async putIssued(record: StoredOwnershipChallenge): Promise<void> {
    this.assertOpen();
    validateRecord(record);
    try {
      await this.pool.query(
        `INSERT INTO ownership_challenges (${COLUMNS.join(", ")})
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          record.schemaVersion,
          record.challengeId,
          record.nonce,
          record.domain,
          record.venue,
          record.executionAccount,
          record.prismId,
          record.issuedAt,
          record.expiresAt,
          record.digest,
          record.state,
          record.nonceState,
          record.verifiedSignatureClass ?? null,
          record.verifiedAt ?? null,
          record.rejection === undefined ? null : JSON.stringify(record.rejection),
        ],
      );
    } catch (cause) {
      if (isUniqueViolation(cause, "ownership_challenges_pkey")) {
        throw new PostgresOwnershipProofStoreError(
          "duplicate_challenge_id",
          `challenge ${record.challengeId} already exists`,
          cause,
        );
      }
      if (isCheckViolation(cause)) {
        throw new PostgresOwnershipProofStoreError("invalid_record", "putIssued rejected by schema constraints", cause);
      }
      throw new PostgresOwnershipProofStoreError("store_write_failed", "putIssued failed", cause);
    }
  }

  async getById(challengeId: Hex): Promise<StoredOwnershipChallenge | undefined> {
    this.assertOpen();
    let result;
    try {
      result = await this.pool.query<Row>(
        `SELECT ${COLUMNS.join(", ")} FROM ownership_challenges WHERE challenge_id = $1`,
        [challengeId],
      );
    } catch (cause) {
      throw new PostgresOwnershipProofStoreError("store_read_failed", "getById failed", cause);
    }
    return result.rowCount && result.rowCount > 0 ? rowToRecord(result.rows[0]) : undefined;
  }

  // Atomic compare-and-set: one conditional UPDATE in an implicit single-
  // statement transaction. rowCount === 1 identifies the unique winner under
  // concurrent and multi-instance contention (PostgreSQL row lock serializes
  // the two candidate updates; the loser re-evaluates WHERE against the
  // committed CONSUMED row and updates zero rows).
  async consumeNonce(
    challengeId: Hex,
  ): Promise<"consumed" | "already_consumed" | "unknown"> {
    this.assertOpen();
    let changes: number | null;
    try {
      const result = await this.pool.query(
        "UPDATE ownership_challenges SET nonce_state = 'CONSUMED' WHERE challenge_id = $1 AND nonce_state = 'UNUSED'",
        [challengeId],
      );
      changes = result.rowCount;
    } catch (cause) {
      throw new PostgresOwnershipProofStoreError("store_write_failed", "consumeNonce failed", cause);
    }
    if (changes === 1) return "consumed";
    try {
      const row = await this.pool.query<{ nonce_state: string }>(
        "SELECT nonce_state FROM ownership_challenges WHERE challenge_id = $1",
        [challengeId],
      );
      if (row.rowCount === 0) return "unknown";
      return "already_consumed";
    } catch (cause) {
      throw new PostgresOwnershipProofStoreError("store_read_failed", "consumeNonce lookup failed", cause);
    }
  }

  // Guarded transition: current-state compare-and-set over the same atomic
  // conditional-UPDATE shape. Only patch keys actually present are written, so
  // an absent patch never erases previously persisted evidence fields.
  async transitionState(
    challengeId: Hex,
    from: ChallengeState,
    to: ChallengeState,
    patch: Partial<Pick<StoredOwnershipChallenge, "verifiedSignatureClass" | "verifiedAt" | "rejection">>,
  ): Promise<boolean> {
    this.assertOpen();
    if (!VALID_STATES.has(from) || !VALID_STATES.has(to)) {
      throw new PostgresOwnershipProofStoreError("invalid_record", `invalid state in transition ${from} -> ${to}`);
    }
    const sets = ["state = $2"];
    const params: Array<string | number | null> = [challengeId, to];
    const push = (column: string, value: string | number | null) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    if ("verifiedSignatureClass" in patch) push("verified_signature_class", patch.verifiedSignatureClass ?? null);
    if ("verifiedAt" in patch) push("verified_at", patch.verifiedAt ?? null);
    if ("rejection" in patch) push("rejection_json", patch.rejection === undefined ? null : JSON.stringify(patch.rejection));
    params.push(from);
    const fromParam = `$${params.length}`;
    try {
      const result = await this.pool.query(
        `UPDATE ownership_challenges SET ${sets.join(", ")}
         WHERE challenge_id = $1 AND state = ${fromParam}`,
        params,
      );
      return result.rowCount === 1;
    } catch (cause) {
      if (isCheckViolation(cause)) {
        throw new PostgresOwnershipProofStoreError("invalid_record", "transitionState rejected by schema constraints", cause);
      }
      throw new PostgresOwnershipProofStoreError("store_write_failed", "transitionState failed", cause);
    }
  }

  /** Close the pool. Waits for idle clients; durable state survives restart. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.pool.end();
    } catch (cause) {
      throw new PostgresOwnershipProofStoreError("store_connect_failed", "close failed", cause);
    }
  }
}

function validateRecord(record: StoredOwnershipChallenge): void {
  if (!VALID_STATES.has(record.state)) {
    throw new PostgresOwnershipProofStoreError("invalid_record", `invalid state ${String(record.state)}`);
  }
  if (record.nonceState !== "UNUSED" && record.nonceState !== "CONSUMED") {
    throw new PostgresOwnershipProofStoreError("invalid_record", `invalid nonceState ${String(record.nonceState)}`);
  }
  if (!Number.isFinite(record.schemaVersion) || !Number.isFinite(record.issuedAt) || !Number.isFinite(record.expiresAt)) {
    throw new PostgresOwnershipProofStoreError("invalid_record", "non-finite numeric field");
  }
}

function isUniqueViolation(cause: unknown, constraint?: string): boolean {
  const err = cause as { code?: string; constraint?: string } | null;
  if (!err || err.code !== "23505") return false;
  return constraint === undefined || err.constraint === constraint;
}

function isCheckViolation(cause: unknown): boolean {
  return (cause as { code?: string } | null)?.code === "23514";
}
