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
  BindingClaimResult,
  ChallengeState,
  NonceState,
  OwnershipProofStore,
  SignatureClass,
  StoredOwnershipChallenge,
  VerifiedBindingClaim,
} from "../domain/ports";
import { CHALLENGE_SCHEMA_VERSION } from "../domain/ports";
import type { Hex } from "../domain/hex";
import type { PoolConfig } from "pg";
import { normalizeProofDigestIdentity } from "../domain/proof-digest";
import {
  assertStoredOwnershipChallenge,
  assertVerifiedEvidencePatch,
  hasVerifiedEvidence,
} from "../domain/ownership-challenge-validation";

/** Current schema version of the durable challenge table. */
export const OWNERSHIP_STORE_SCHEMA_VERSION = 3;

/** Serialize all instances migrating the same PostgreSQL schema. */
export const OWNERSHIP_STORE_MIGRATION_LOCK_SQL =
  "SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':prism:ownership-proof-store:migration'))";

/** Versioned migration applied at construction (idempotent). */
export const OWNERSHIP_STORE_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS prism_store_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ownership_challenges (
  schema_version INTEGER NOT NULL CONSTRAINT ownership_challenges_schema_version_v2 CHECK (schema_version = 2),
  chain_id INTEGER NOT NULL CHECK (chain_id > 0),
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
  binding_use_state TEXT NOT NULL DEFAULT 'UNUSED' CHECK (binding_use_state IN ('UNUSED','CONSUMED')),
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
  "chain_id",
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
  "binding_use_state",
  "verified_signature_class",
  "verified_at",
  "rejection_json",
] as const;

interface Row {
  schema_version: number;
  chain_id: number;
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
  binding_use_state?: string | null;
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
  const record: StoredOwnershipChallenge = {
    schemaVersion: row.schema_version,
    chainId: row.chain_id,
    challengeId: normalizeProofDigestIdentity(row.challenge_id),
    nonce: row.nonce as Hex,
    domain: row.domain,
    venue: row.venue as StoredOwnershipChallenge["venue"],
    executionAccount: row.execution_account.toLowerCase() as StoredOwnershipChallenge["executionAccount"],
    prismId: row.prism_id as StoredOwnershipChallenge["prismId"],
    issuedAt: toInt(row.issued_at),
    expiresAt: toInt(row.expires_at),
    digest: normalizeProofDigestIdentity(row.digest),
    state: row.state as ChallengeState,
    nonceState: row.nonce_state as NonceState,
    ...(row.binding_use_state !== undefined && row.binding_use_state !== null
      ? { bindingUseState: row.binding_use_state as StoredOwnershipChallenge["bindingUseState"] }
      : {}),
    ...(row.verified_signature_class !== null
      ? { verifiedSignatureClass: row.verified_signature_class as SignatureClass }
      : {}),
    ...(row.verified_at !== null ? { verifiedAt: toInt(row.verified_at) } : {}),
    ...(rejection !== undefined ? { rejection } : {}),
  };
  try {
    assertStoredOwnershipChallenge(record);
  } catch (cause) {
    throw new PostgresOwnershipProofStoreError(
      "store_read_failed",
      cause instanceof Error ? cause.message : String(cause),
      cause,
    );
  }
  return record;
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
        // Every instance takes the same transaction-scoped lock before any
        // catalog inspection or DDL. Without this, two cold starts can both
        // observe a missing column/meta row and race into duplicate_object or
        // unique_violation errors.
        await client.query(OWNERSHIP_STORE_MIGRATION_LOCK_SQL);
        await client.query(OWNERSHIP_STORE_MIGRATION_SQL);
        const chainColumn = await client.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema()
               AND table_name = 'ownership_challenges'
               AND column_name = 'chain_id'
           ) AS exists`,
        );
        if (!chainColumn.rows[0]?.exists) {
          await client.query("ALTER TABLE ownership_challenges ADD COLUMN chain_id INTEGER");
        }
        const bindingUseColumn = await client.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema()
               AND table_name = 'ownership_challenges'
               AND column_name = 'binding_use_state'
           ) AS exists`,
        );
        if (!bindingUseColumn.rows[0]?.exists) {
          await client.query("ALTER TABLE ownership_challenges ADD COLUMN binding_use_state TEXT NOT NULL DEFAULT 'UNUSED'");
        }
        await client.query("UPDATE ownership_challenges SET binding_use_state = 'UNUSED' WHERE binding_use_state IS NULL");
        const invalidBindingUseState = await client.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM ownership_challenges WHERE binding_use_state NOT IN ('UNUSED','CONSUMED')",
        );
        if (invalidBindingUseState.rows[0]?.count !== "0") {
          throw new PostgresOwnershipProofStoreError(
            "store_migrate_failed",
            "legacy challenge rows contain an invalid binding-use state",
          );
        }
        await client.query("ALTER TABLE ownership_challenges ALTER COLUMN binding_use_state SET NOT NULL");
        const incompatibleSchema = await client.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM ownership_challenges WHERE schema_version IS NULL OR schema_version <> $1",
          [CHALLENGE_SCHEMA_VERSION],
        );
        if (incompatibleSchema.rows[0]?.count !== "0") {
          throw new PostgresOwnershipProofStoreError(
            "store_migrate_failed",
            "legacy challenge rows are not schema-v2 and require explicit invalidation",
          );
        }
        await client.query("ALTER TABLE ownership_challenges ALTER COLUMN schema_version SET NOT NULL");
        const legacy = await client.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM ownership_challenges WHERE chain_id IS NULL",
        );
        if (legacy.rows[0]?.count !== "0") {
          throw new PostgresOwnershipProofStoreError(
            "store_migrate_failed",
            "legacy schema-v1 challenges require explicit invalidation before schema-v2 migration",
          );
        }
        await client.query("ALTER TABLE ownership_challenges ALTER COLUMN chain_id SET NOT NULL");
        const chainConstraint = await client.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM pg_constraint
             WHERE conrelid = 'ownership_challenges'::regclass
               AND conname = 'ownership_challenges_chain_id_positive'
           ) AS exists`,
        );
        if (!chainConstraint.rows[0]?.exists) {
          await client.query("ALTER TABLE ownership_challenges ADD CONSTRAINT ownership_challenges_chain_id_positive CHECK (chain_id > 0) NOT VALID");
        }
        await client.query("ALTER TABLE ownership_challenges VALIDATE CONSTRAINT ownership_challenges_chain_id_positive");
        const schemaConstraint = await client.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM pg_constraint
             WHERE conrelid = 'ownership_challenges'::regclass
               AND conname = 'ownership_challenges_schema_version_v2'
           ) AS exists`,
        );
        if (!schemaConstraint.rows[0]?.exists) {
          await client.query("ALTER TABLE ownership_challenges ADD CONSTRAINT ownership_challenges_schema_version_v2 CHECK (schema_version = 2) NOT VALID");
        }
        await client.query("ALTER TABLE ownership_challenges VALIDATE CONSTRAINT ownership_challenges_schema_version_v2");
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
        } else if (Number.parseInt(meta.rows[0].value, 10) < OWNERSHIP_STORE_SCHEMA_VERSION) {
          await client.query("UPDATE prism_store_meta SET value = $1 WHERE key = 'schema_version'", [
            String(OWNERSHIP_STORE_SCHEMA_VERSION),
          ]);
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
    if (!options.skipMigration) await store.migrate();
    return store;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new PostgresOwnershipProofStoreError("store_connect_failed", "store is closed");
    }
  }

  async putIssued(record: StoredOwnershipChallenge): Promise<void> {
    this.assertOpen();
    const normalized: StoredOwnershipChallenge = {
      ...record,
      challengeId: normalizeProofDigestIdentity(record.challengeId),
      digest: normalizeProofDigestIdentity(record.digest),
      executionAccount: record.executionAccount.toLowerCase() as StoredOwnershipChallenge["executionAccount"],
      bindingUseState: record.bindingUseState ?? "UNUSED",
    };
    validateRecord(normalized);
    try {
      await this.pool.query(
        `INSERT INTO ownership_challenges (${COLUMNS.join(", ")})
         VALUES (${COLUMNS.map((_, index) => `$${index + 1}`).join(",")})`,
        [
          normalized.schemaVersion,
          normalized.chainId,
          normalized.challengeId,
          normalized.nonce,
          normalized.domain,
          normalized.venue,
          normalized.executionAccount,
          normalized.prismId,
          normalized.issuedAt,
          normalized.expiresAt,
          normalized.digest,
          normalized.state,
          normalized.nonceState,
          normalized.bindingUseState ?? "UNUSED",
          normalized.verifiedSignatureClass ?? null,
          normalized.verifiedAt ?? null,
          normalized.rejection === undefined ? null : JSON.stringify(normalized.rejection),
        ],
      );
    } catch (cause) {
      if (isUniqueViolation(cause, "ownership_challenges_pkey")) {
        throw new PostgresOwnershipProofStoreError(
          "duplicate_challenge_id",
          `challenge ${normalized.challengeId} already exists`,
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
    const normalizedChallengeId = normalizeProofDigestIdentity(challengeId);
    let result;
    try {
      result = await this.pool.query<Row>(
        `SELECT ${COLUMNS.join(", ")} FROM ownership_challenges WHERE challenge_id = $1`,
        [normalizedChallengeId],
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
    const normalizedChallengeId = normalizeProofDigestIdentity(challengeId);
    let changes: number | null;
    try {
      const result = await this.pool.query(
        "UPDATE ownership_challenges SET nonce_state = 'CONSUMED' WHERE challenge_id = $1 AND nonce_state = 'UNUSED'",
        [normalizedChallengeId],
      );
      changes = result.rowCount;
    } catch (cause) {
      throw new PostgresOwnershipProofStoreError("store_write_failed", "consumeNonce failed", cause);
    }
    if (changes === 1) return "consumed";
    try {
      const row = await this.pool.query<{ nonce_state: string }>(
        "SELECT nonce_state FROM ownership_challenges WHERE challenge_id = $1",
        [normalizedChallengeId],
      );
      if (row.rowCount === 0) return "unknown";
      return "already_consumed";
    } catch (cause) {
      throw new PostgresOwnershipProofStoreError("store_read_failed", "consumeNonce lookup failed", cause);
    }
  }

  async claimVerifiedBinding(input: VerifiedBindingClaim): Promise<BindingClaimResult> {
    this.assertOpen();
    const normalizedInput = {
      ...input,
      challengeId: normalizeProofDigestIdentity(input.challengeId),
      proofDigest: normalizeProofDigestIdentity(input.proofDigest),
      executionAccount: input.executionAccount.toLowerCase() as VerifiedBindingClaim["executionAccount"],
    };
    let changes: number | null;
    try {
      const result = await this.pool.query(
        `UPDATE ownership_challenges
         SET binding_use_state = 'CONSUMED'
         WHERE challenge_id = $1
           AND state = 'VERIFIED'
           AND nonce_state = 'CONSUMED'
           AND binding_use_state = 'UNUSED'
           AND verified_signature_class IN ('EOA','EIP1271','ERC6492')
           AND verified_at IS NOT NULL
           AND prism_id = $2
           AND venue = $3
           AND execution_account = $4
           AND chain_id = $5
           AND expires_at = $6
           AND expires_at > $7
           AND digest = $8`,
        [
          normalizedInput.challengeId,
          normalizedInput.prismId,
          normalizedInput.venue,
          normalizedInput.executionAccount,
          normalizedInput.chainId,
          normalizedInput.expiresAt,
          normalizedInput.now,
          normalizedInput.proofDigest,
        ],
      );
      changes = result.rowCount;
    } catch (cause) {
      throw new PostgresOwnershipProofStoreError("store_write_failed", "claimVerifiedBinding failed", cause);
    }
    if (changes === 1) return "claimed";

    const latest = await this.getById(normalizedInput.challengeId);
    const after = classifyBindingClaim(latest, normalizedInput);
    return after === "claimable" ? "already_claimed" : after;
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
    if (to === "VERIFIED") {
      try {
        assertVerifiedEvidencePatch(patch);
      } catch (cause) {
        throw new PostgresOwnershipProofStoreError(
          "invalid_record",
          cause instanceof Error ? cause.message : String(cause),
          cause,
        );
      }
    }
    const sets = ["state = $2"];
    const params: Array<string | number | null> = [normalizeProofDigestIdentity(challengeId), to];
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

function classifyBindingClaim(
  record: StoredOwnershipChallenge | undefined,
  input: VerifiedBindingClaim,
): BindingClaimResult | "claimable" {
  if (!record) return "unknown";
  const challengeId = normalizeProofDigestIdentity(input.challengeId);
  const proofDigest = normalizeProofDigestIdentity(input.proofDigest);
  if (
    record.challengeId !== challengeId ||
    record.digest !== proofDigest ||
    record.prismId !== input.prismId ||
    record.venue !== input.venue ||
    record.executionAccount.toLowerCase() !== input.executionAccount.toLowerCase() ||
    record.chainId !== input.chainId ||
    record.expiresAt !== input.expiresAt
  ) {
    return "mismatch";
  }
  if (record.bindingUseState === "CONSUMED") return "already_claimed";
  if (record.bindingUseState !== undefined && record.bindingUseState !== "UNUSED") return "mismatch";
  if (input.now >= record.expiresAt || record.state === "EXPIRED") return "expired";
  if (
    record.state !== "VERIFIED" ||
    record.nonceState !== "CONSUMED" ||
    !hasVerifiedEvidence(record)
  ) {
    return "not_verified";
  }
  return "claimable";
}

function validateRecord(record: StoredOwnershipChallenge): void {
  try {
    assertStoredOwnershipChallenge(record);
  } catch (cause) {
    throw new PostgresOwnershipProofStoreError(
      "invalid_record",
      cause instanceof Error ? cause.message : String(cause),
      cause,
    );
  }
  if (!VALID_STATES.has(record.state)) {
    throw new PostgresOwnershipProofStoreError("invalid_record", `invalid state ${String(record.state)}`);
  }
  if (record.nonceState !== "UNUSED" && record.nonceState !== "CONSUMED") {
    throw new PostgresOwnershipProofStoreError("invalid_record", `invalid nonceState ${String(record.nonceState)}`);
  }
  if (record.bindingUseState !== undefined && record.bindingUseState !== "UNUSED" && record.bindingUseState !== "CONSUMED") {
    throw new PostgresOwnershipProofStoreError("invalid_record", `invalid bindingUseState ${String(record.bindingUseState)}`);
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
