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
  ChallengeState,
  NonceState,
  OwnershipProofStore,
  SignatureClass,
  StoredOwnershipChallenge,
} from "../domain/ports";
import type { Hex } from "../domain/hex";

/** Current schema version of the durable challenge table. */
export const OWNERSHIP_STORE_SCHEMA_VERSION = 1;

export type OwnershipStoreErrorCode =
  | "store_open_failed"
  | "store_migrate_failed"
  | "duplicate_challenge_id"
  | "store_write_failed"
  | "store_read_failed";

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
  "verifiedSignatureClass",
  "verifiedAt",
  "rejectionJson",
] as const;

interface Row {
  schemaVersion: number;
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
  verifiedSignatureClass: string | null;
  verifiedAt: number | null;
  rejectionJson: string | null;
}

function rowToRecord(row: Row): StoredOwnershipChallenge {
  const rejection =
    row.rejectionJson === null ? undefined : (JSON.parse(row.rejectionJson) as { code: string; detail?: string });
  return {
    schemaVersion: row.schemaVersion,
    challengeId: row.challengeId as Hex,
    nonce: row.nonce as Hex,
    domain: row.domain,
    venue: row.venue as StoredOwnershipChallenge["venue"],
    executionAccount: row.executionAccount as StoredOwnershipChallenge["executionAccount"],
    prismId: row.prismId as StoredOwnershipChallenge["prismId"],
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    digest: row.digest as Hex,
    state: row.state as ChallengeState,
    nonceState: row.nonceState as NonceState,
    ...(row.verifiedSignatureClass !== null
      ? { verifiedSignatureClass: row.verifiedSignatureClass as SignatureClass }
      : {}),
    ...(row.verifiedAt !== null ? { verifiedAt: row.verifiedAt } : {}),
    ...(rejection !== undefined ? { rejection } : {}),
  };
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
        schemaVersion INTEGER NOT NULL,
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
        verifiedSignatureClass TEXT,
        verifiedAt INTEGER,
        rejectionJson TEXT
      );
    `);
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
    }
  }

  async putIssued(record: StoredOwnershipChallenge): Promise<void> {
    try {
      this.db
        .prepare(
          `INSERT INTO ownership_challenges (${COLUMNS.join(", ")})
           VALUES (${COLUMNS.map((c) => `@${c}`).join(", ")})`,
        )
        .run({
          schemaVersion: record.schemaVersion,
          challengeId: record.challengeId,
          nonce: record.nonce,
          domain: record.domain,
          venue: record.venue,
          executionAccount: record.executionAccount,
          prismId: record.prismId,
          issuedAt: record.issuedAt,
          expiresAt: record.expiresAt,
          digest: record.digest,
          state: record.state,
          nonceState: record.nonceState,
          verifiedSignatureClass: record.verifiedSignatureClass ?? null,
          verifiedAt: record.verifiedAt ?? null,
          rejectionJson: record.rejection === undefined ? null : JSON.stringify(record.rejection),
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
        .get(challengeId) as Row | undefined;
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
    let changes: number | bigint;
    try {
      ({ changes } = this.db
        .prepare(
          "UPDATE ownership_challenges SET nonceState = 'CONSUMED' WHERE challengeId = ? AND nonceState = 'UNUSED'",
        )
        .run(challengeId));
    } catch (cause) {
      throw new SqliteOwnershipProofStoreError("store_write_failed", "consumeNonce failed", cause);
    }
    if (Number(changes) === 1) return "consumed";
    try {
      const row = this.db
        .prepare("SELECT nonceState FROM ownership_challenges WHERE challengeId = ?")
        .get(challengeId) as { nonceState: string } | undefined;
      if (row === undefined) return "unknown";
      return row.nonceState === "CONSUMED" ? "already_consumed" : "already_consumed";
    } catch (cause) {
      throw new SqliteOwnershipProofStoreError("store_read_failed", "consumeNonce lookup failed", cause);
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
    const sets: string[] = ["state = @to"];
    const params: Record<string, string | number> = { challengeId, from, to };
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
