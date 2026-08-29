# WP-3 Implementation Report — Durable OwnershipProofStore Adapter

Status: implemented and locally verified (maturity X2 per TEST_ARCHITECTURE ladder).
Scope: backend slice only. No frontend, deployment config, V8.3 bind/resolve/revoke,
DEC-PRISM-SYS-001, or chainId-proposal changes.

## What was built

`src/features/prism-identity/adapters/sqlite-ownership-proof-store.ts`

A real durable `OwnershipProofStore` adapter on Node's built-in `node:sqlite`
(`DatabaseSync`, verified available on the repo toolchain: Node v22.x with
experimental SQLite). No new dependency added; domain port unchanged.

Properties:
- Versioned table `ownership_challenges` (schema v1, tracked in
  `prism_store_meta.schema_version`; refuses newer-than-supported DBs).
- `challengeId` PRIMARY KEY enforces uniqueness; duplicates throw stable
  adapter error `duplicate_challenge_id`.
- `getById` returns owned copies; callers cannot mutate durable state.
- `consumeNonce`: single conditional
  `UPDATE ... WHERE challengeId = ? AND nonceState = 'UNUSED'` inside SQLite's
  write transaction — exactly one caller observes `consumed`; all others get
  `already_consumed` / `unknown`. INV-SYS-010 enforcement point (T7 tier).
- `transitionState`: current-state compare-and-set over `state`; patch keys are
  applied only when present, so evidence fields are never silently erased.
- Fail-closed policy: all driver/constraint failures surface as
  `SqliteOwnershipProofStoreError` with machine-readable codes
  (`store_open_failed`, `store_migrate_failed`, `duplicate_challenge_id`,
  `store_write_failed`, `store_read_failed`). Never swallowed into optimistic results.

## Deployment safety

Single-process: fully safe by construction.
Multi-instance: safe ONLY when every instance shares the SAME database file on
a POSIX local filesystem (SQLite locking + WAL). NOT safe across machines or on
NFS/SMB/network volumes; independent per-instance files give split-brain nonce
state. Multi-host horizontal scaling requires a server database.

## Tests (T7)

`src/features/prism-identity/__tests__/sqlite-ownership-proof-store.test.ts`
— 10 tests: duplicate challengeId rejection; owned-copy getById; concurrent
nonce race (exactly one winner of 8 interleaved callers); unknown for missing
challenge; guarded transition race (1 winner of 6); wrong-current-state CAS
rejection; close/reopen durability (signature class, verifiedAt, rejection,
expiry, nonce state preserved; replay still blocked after reopen); VERIFIED
evidence preservation + downgrade refusal; EXPIRED state/expiry preservation;
fail-closed open error.

## Verification run (local, this commit)

- Focused T7 suite: 10/10 pass.
- Full prism-identity suite: 9 files, 52/52 pass.
- `npm run typecheck`: clean.
- `npm run build`: clean.
- `git diff --check`: clean.

## Maturity & limits

Maturity: X2 (local pass only). NOT claimed: browser evidence, live-chain
evidence, deployed/multi-process observation (X3+ requires the EVIDENCE_LEDGER
process, out of scope here).

Remaining production limits:
- `node:sqlite` is experimental in current Node; API stability risk before upgrade.
- Single-file SQLite ceiling: no cross-host multi-instance safety (see above);
  WAL mode is set but checkpointing/backup ops are not automated here.
- No schema migration beyond version check (forward-migration tooling pending).
- Expiry is stored but not actively swept; EXPIRED transitions are written by
  the service at verification time, not by a background job.
