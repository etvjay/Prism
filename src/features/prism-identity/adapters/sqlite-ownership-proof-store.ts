// Durable SQLite OwnershipProofStore adapter (port: OwnershipProofStore).
//
// T7 DB-integration tier implementation of INV-SYS-010 enforcement:
// - `consumeNonce` is a single conditional UPDATE ... WHERE nonceState = 'UNUSED'
//   executed inside SQLite's own write transaction, so exactly one caller
//   observes "consumed" even under interleaved async callers within a process,
//   and exactly one process wins when several processes share the same file.
// - `transitionState` is the same compare-and-set shape over `state`.
// - All records are stored in a versioned table; `getById` returns owned copies
//   so callers cannot mutate durable state in place.
//
// Deployment safety (explicit):
//   Single-process: fully safe by construction (SQLite serializes writers).
//   Multi-instance (several OS processes / replicas): safe ONLY when every
//   instance opens the SAME database file on a POSIX-compliant local
//   filesystem — SQLite file locking + WAL make the conditional writes atomic
//   cluster-wide around one file. It is NOT safe across machines without a
//   shared POSIX filesystem (NFS/SMB/network volumes are explicitly unsafe for
//   SQLite), and not safe as independent per-instance files. Horizontal
//   multi-host deployments require a server database; this adapter documents
//   that boundary rather than hiding it.
//
// Failure policy: fail closed. Construction/migration failures, constraint
// violations, and unexpected driver errors throw a stable
// SqliteOwnershipProofStoreError with a machine-readable `code`; they are never
// swallowed into optimistic-looking results.

import { DatabaseSync } from "node:sqlite";
import type {
  BindingClaimResult,
  ChallengeState,
  NonceState,
  OwnershipProofStore,
  SignatureClass,
  StoredOwnershipChallenge,
  VerifiedBindingClaim,
} from "../domain/ports";
import type { Hex } from "../domain/hex";
import { normalizeProofDigestIdentity } from "../domain/proof-digest";
import {
  assertStoredOwnershipChallenge,
  assertVerifiedEvidencePatch,
  hasVerifiedEvidence,
} from "../domain/ownership-challenge-validation";

/** Current schema version of the durable challenge table. */
export const OWNERSHIP_STORE_SCHEMA_VERSION = 3;

export type OwnershipStoreErrorCode =
  | "store_open_failed"
  | "store_migrate_failed"
  | "duplicate_challenge_id"
  | "store_write_failed"
  | "store_read_failed"
  | "invalid_record";

export class SqliteOwnershipProofStoreError extends Error {
  readonly code: OwnershipStoreErrorCode;
  constructor(code: OwnershipStoreErrorCode, message: string, cause?: unknown) {
    super(`[${code}] ${message}${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "SqliteOwnershipProofStoreError";
    this.code = code;
  }
}

const COLUMNS = [
  "schemaVersion",
  "chainId",
  "challengeId",
  "nonce",
  "domain",
  "venue",
  "executionAccount",
  "prismId",
  "issuedAt",
  "expiresAt",
  "digest",
  "state",
  "nonceState",
  "bindingUseState",
  "verifiedSignatureClass",
  "verifiedAt",
  "rejectionJson",
] as const;

interface Row {
  schemaVersion: number;
  chainId: number;
  challengeId: string;
  nonce: string;
  domain: string;
  venue: string;
  executionAccount: string;
  prismId: string;
  issuedAt: number;
  expiresAt: number;
  digest: string;
  state: string;
  nonceState: string;
  bindingUseState?: string | null;
  verifiedSignatureClass: string | null;
  verifiedAt: number | null;
  rejectionJson: string | null;
}

function rowToRecord(row: Row): StoredOwnershipChallenge {
  const rejection =
    row.rejectionJson === null ? undefined : (JSON.parse(row.rejectionJson) as { code: string; detail?: string });
  const record: StoredOwnershipChallenge = {
    schemaVersion: row.schemaVersion,
    chainId: row.chainId,
    challengeId: normalizeProofDigestIdentity(row.challengeId),
    nonce: row.nonce as Hex,
    domain: row.domain,
    venue: row.venue as StoredOwnershipChallenge["venue"],
    executionAccount: row.executionAccount.toLowerCase() as StoredOwnershipChallenge["executionAccount"],
    prismId: row.prismId as StoredOwnershipChallenge["prismId"],
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    digest: normalizeProofDigestIdentity(row.digest),
    state: row.state as ChallengeState,
    nonceState: row.nonceState as NonceState,
    ...(row.bindingUseState !== undefined && row.bindingUseState !== null
      ? { bindingUseState: row.bindingUseState as StoredOwnershipChallenge["bindingUseState"] }
      : {}),
    ...(row.verifiedSignatureClass !== null
      ? { verifiedSignatureClass: row.verifiedSignatureClass as SignatureClass }
      : {}),
    ...(row.verifiedAt !== null ? { verifiedAt: row.verifiedAt } : {}),
    ...(rejection !== undefined ? { rejection } : {}),
  };
  assertStoredOwnershipChallenge(record);
  return record;
}

export interface SqliteOwnershipProofStoreOptions {
  /** Path to the SQLite database file. A `:memory:` path is accepted for tests. */
  filePath: string;
}

export class SqliteOwnershipProofStore implements OwnershipProofStore {
  private readonly db: DatabaseSync;

  constructor(options: SqliteOwnershipProofStoreOptions) {
    let db: DatabaseSync;
    try {
      db = new DatabaseSync(options.filePath);
      db.exec("PRAGMA journal_mode = WAL;");
      db.exec("PRAGMA synchronous = FULL;");
    } catch (cause) {
      throw new SqliteOwnershipProofStoreError(
        "store_open_failed",
        `cannot open durable ownership store at ${options.filePath}`,
        cause,
      );
    }
    try {
      this.migrate(db);
    } catch (cause) {
      db.close();
      if (cause instanceof SqliteOwnershipProofStoreError) throw cause;
      throw new SqliteOwnershipProofStoreError("store_migrate_failed", "migration failed", cause);
    }
    this.db = db;
  }

  private migrate(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS prism_store_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ownership_challenges (
        schemaVersion INTEGER NOT NULL CHECK (schemaVersion = 2),
        chainId INTEGER NOT NULL CHECK (chainId > 0),
        challengeId TEXT PRIMARY KEY,
        nonce TEXT NOT NULL,
        domain TEXT NOT NULL,
        venue TEXT NOT NULL,
        executionAccount TEXT NOT NULL,
        prismId TEXT NOT NULL,
        issuedAt INTEGER NOT NULL,
        expiresAt INTEGER NOT NULL,
        digest TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('ISSUED','VERIFIED','REJECTED','EXPIRED')),
        nonceState TEXT NOT NULL CHECK (nonceState IN ('UNUSED','CONSUMED')),
        bindingUseState TEXT NOT NULL DEFAULT 'UNUSED' CHECK (bindingUseState IN ('UNUSED','CONSUMED')),
        verifiedSignatureClass TEXT,
        verifiedAt INTEGER,
        rejectionJson TEXT
      );
    `);
    const columns = db.prepare("PRAGMA table_info(ownership_challenges)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "chainId")) {
      db.exec("ALTER TABLE ownership_challenges ADD COLUMN chainId INTEGER");
    }
    if (!columns.some((column) => column.name === "bindingUseState")) {
      db.exec("ALTER TABLE ownership_challenges ADD COLUMN bindingUseState TEXT NOT NULL DEFAULT 'UNUSED'");
    }
    db.exec("UPDATE ownership_challenges SET bindingUseState = 'UNUSED' WHERE bindingUseState IS NULL");
    const invalidBindingUseState = db
      .prepare("SELECT COUNT(*) AS count FROM ownership_challenges WHERE bindingUseState NOT IN ('UNUSED','CONSUMED')")
      .get() as { count: number };
    if (invalidBindingUseState.count !== 0) {
      throw new SqliteOwnershipProofStoreError(
        "store_migrate_failed",
        "legacy challenge rows contain an invalid binding-use state",
      );
    }
    const incompatibleSchema = db
      .prepare("SELECT COUNT(*) AS count FROM ownership_challenges WHERE schemaVersion IS NULL OR schemaVersion <> 2")
      .get() as { count: number };
    if (incompatibleSchema.count !== 0) {
      throw new SqliteOwnershipProofStoreError(
        "store_migrate_failed",
        "legacy challenge rows are not schema-v2 and require explicit invalidation",
      );
    }
    const legacy = db
      .prepare("SELECT COUNT(*) AS count FROM ownership_challenges WHERE chainId IS NULL")
      .get() as { count: number };
    if (legacy.count !== 0) {
      throw new SqliteOwnershipProofStoreError(
        "store_migrate_failed",
        "legacy schema-v1 challenges require explicit invalidation before schema-v2 migration",
      );
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_ownership_challenges_chain_id ON ownership_challenges(chainId)");
    const meta = db
      .prepare("SELECT value FROM prism_store_meta WHERE key = 'schema_version'")
      .get() as { value: string } | undefined;
    if (meta === undefined) {
      db.prepare("INSERT INTO prism_store_meta (key, value) VALUES ('schema_version', ?)").run(
        String(OWNERSHIP_STORE_SCHEMA_VERSION),
      );
    } else if (Number(meta.value) > OWNERSHIP_STORE_SCHEMA_VERSION) {
      throw new SqliteOwnershipProofStoreError(
        "store_migrate_failed",
        `database schema_version ${meta.value} is newer than supported ${OWNERSHIP_STORE_SCHEMA_VERSION}`,
      );
    } else if (Number(meta.value) < OWNERSHIP_STORE_SCHEMA_VERSION) {
      db.prepare("UPDATE prism_store_meta SET value = ? WHERE key = 'schema_version'").run(
        String(OWNERSHIP_STORE_SCHEMA_VERSION),
      );
    }
  }

  async putIssued(record: StoredOwnershipChallenge): Promise<void> {
    let normalized: StoredOwnershipChallenge;
    try {
      assertStoredOwnershipChallenge(record);
      normalized = {
        ...record,
        challengeId: normalizeProofDigestIdentity(record.challengeId),
        digest: normalizeProofDigestIdentity(record.digest),
        executionAccount: record.executionAccount.toLowerCase() as StoredOwnershipChallenge["executionAccount"],
        bindingUseState: record.bindingUseState ?? "UNUSED",
      };
    } catch (cause) {
      throw new SqliteOwnershipProofStoreError(
        "invalid_record",
        cause instanceof Error ? cause.message : String(cause),
        cause,
      );
    }
    try {
      this.db
        .prepare(
          `INSERT INTO ownership_challenges (${COLUMNS.join(", ")})
           VALUES (${COLUMNS.map((c) => `@${c}`).join(", ")})`,
        )
        .run({
          schemaVersion: normalized.schemaVersion,
          chainId: normalized.chainId,
          challengeId: normalized.challengeId,
          nonce: normalized.nonce,
          domain: normalized.domain,
          venue: normalized.venue,
          executionAccount: normalized.executionAccount,
          prismId: normalized.prismId,
          issuedAt: normalized.issuedAt,
          expiresAt: normalized.expiresAt,
          digest: normalized.digest,
          state: normalized.state,
          nonceState: normalized.nonceState,
          bindingUseState: normalized.bindingUseState ?? "UNUSED",
          verifiedSignatureClass: normalized.verifiedSignatureClass ?? null,
          verifiedAt: normalized.verifiedAt ?? null,
          rejectionJson: normalized.rejection === undefined ? null : JSON.stringify(normalized.rejection),
        });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (/UNIQUE constraint failed.*challengeId/i.test(message)) {
        throw new SqliteOwnershipProofStoreError(
          "duplicate_challenge_id",
          `challenge ${record.challengeId} already exists`,
          cause,
        );
      }
      throw new SqliteOwnershipProofStoreError("store_write_failed", "putIssued failed", cause);
    }
  }

  async getById(challengeId: Hex): Promise<StoredOwnershipChallenge | undefined> {
    try {
      const row = this.db
        .prepare(`SELECT ${COLUMNS.join(", ")} FROM ownership_challenges WHERE challengeId = ?`)
        .get(normalizeProofDigestIdentity(challengeId)) as Row | undefined;
      return row === undefined ? undefined : rowToRecord(row);
    } catch (cause) {
      throw new SqliteOwnershipProofStoreError("store_read_failed", "getById failed", cause);
    }
  }

  // Atomic compare-and-set: one conditional UPDATE inside SQLite's write
  // transaction. `changes === 1` identifies the unique winner; no read-modify-
  // write window exists, so interleaving cannot produce two winners.
  async consumeNonce(
    challengeId: Hex,
  ): Promise<"consumed" | "already_consumed" | "unknown"> {
    const normalizedChallengeId = normalizeProofDigestIdentity(challengeId);
    let changes: number | bigint;
    try {
      ({ changes } = this.db
        .prepare(
          "UPDATE ownership_challenges SET nonceState = 'CONSUMED' WHERE challengeId = ? AND nonceState = 'UNUSED'",
        )
        .run(normalizedChallengeId));
    } catch (cause) {
      throw new SqliteOwnershipProofStoreError("store_write_failed", "consumeNonce failed", cause);
    }
    if (Number(changes) === 1) return "consumed";
    try {
      const row = this.db
        .prepare("SELECT nonceState FROM ownership_challenges WHERE challengeId = ?")
        .get(normalizedChallengeId) as { nonceState: string } | undefined;
      if (row === undefined) return "unknown";
      return row.nonceState === "CONSUMED" ? "already_consumed" : "already_consumed";
    } catch (cause) {
      throw new SqliteOwnershipProofStoreError("store_read_failed", "consumeNonce lookup failed", cause);
    }
  }

  async claimVerifiedBinding(input: VerifiedBindingClaim): Promise<BindingClaimResult> {
    const normalizedInput = {
      ...input,
      challengeId: normalizeProofDigestIdentity(input.challengeId),
      proofDigest: normalizeProofDigestIdentity(input.proofDigest),
      executionAccount: input.executionAccount.toLowerCase() as VerifiedBindingClaim["executionAccount"],
    };
    const current = await this.getById(normalizedInput.challengeId);
    const initial = classifyBindingClaim(current, normalizedInput);
    if (initial !== "claimable") return initial;

    let changes: number | bigint;
    try {
      ({ changes } = this.db
        .prepare(
          `UPDATE ownership_challenges
           SET bindingUseState = 'CONSUMED'
           WHERE challengeId = @challengeId
             AND state = 'VERIFIED'
             AND nonceState = 'CONSUMED'
             AND bindingUseState = 'UNUSED'
             AND verifiedSignatureClass IN ('EOA','EIP1271','ERC6492')
             AND verifiedAt IS NOT NULL
             AND prismId = @prismId
             AND venue = @venue
             AND executionAccount = @executionAccount
             AND chainId = @chainId
             AND expiresAt = @expiresAt
             AND expiresAt > @now
             AND digest = @proofDigest`,
        )
        .run(normalizedInput as unknown as Record<string, string | number>));
    } catch (cause) {
      throw new SqliteOwnershipProofStoreError("store_write_failed", "claimVerifiedBinding failed", cause);
    }
    if (Number(changes) === 1) return "claimed";

    // A competing caller may have won the CAS. Re-read to classify the
    // committed terminal state rather than guessing from a zero row count.
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
    if (to === "VERIFIED") {
      try {
        assertVerifiedEvidencePatch(patch);
      } catch (cause) {
        throw new SqliteOwnershipProofStoreError(
          "invalid_record",
          cause instanceof Error ? cause.message : String(cause),
          cause,
        );
      }
    }
    const sets: string[] = ["state = @to"];
    const params: Record<string, string | number> = { challengeId: normalizeProofDigestIdentity(challengeId), from, to };
    if ("verifiedSignatureClass" in patch) {
      sets.push("verifiedSignatureClass = @verifiedSignatureClass");
      params.verifiedSignatureClass = patch.verifiedSignatureClass ?? null as unknown as string;
    }
    if ("verifiedAt" in patch) {
      sets.push("verifiedAt = @verifiedAt");
      params.verifiedAt = patch.verifiedAt ?? null as unknown as number;
    }
    if ("rejection" in patch) {
      sets.push("rejectionJson = @rejectionJson");
      params.rejectionJson =
        patch.rejection === undefined ? (null as unknown as string) : JSON.stringify(patch.rejection);
    }
    let changes: number | bigint;
    try {
      ({ changes } = this.db
        .prepare(
          `UPDATE ownership_challenges SET ${sets.join(", ")} WHERE challengeId = @challengeId AND state = @from`,
        )
        .run(params));
    } catch (cause) {
      throw new SqliteOwnershipProofStoreError("store_write_failed", "transitionState failed", cause);
    }
    return Number(changes) === 1;
  }

  /** Close the underlying handle. Durable state survives close/reopen. */
  close(): void {
    try {
      this.db.close();
    } catch (cause) {
      throw new SqliteOwnershipProofStoreError("store_open_failed", "close failed", cause);
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
  const executionAccount = input.executionAccount.toLowerCase();
  if (
    record.challengeId !== challengeId ||
    record.digest !== proofDigest ||
    record.prismId !== input.prismId ||
    record.venue !== input.venue ||
    record.executionAccount !== executionAccount ||
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
