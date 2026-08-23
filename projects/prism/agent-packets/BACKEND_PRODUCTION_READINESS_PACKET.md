# Backend Production Readiness Packet — PRISM-7 / PRISM-8

- **Type:** bounded decision-safe handoff (documentation only; no code changed by this packet)
- **Worktree/branch observed:** `backend-production` @ `agent/prism-backend-production`, HEAD `9a5c14e`, working tree clean
- **Date:** 2026-08-23
- **Authority basis:** `projects/prism/system/*` (md + yaml), `projects/prism/system-inputs/*.md`, `projects/prism/agent-packets/V8_1_V8_2_OFFCHAIN_REPORT.md`, `projects/prism/system-inputs/PRISM7_CROSSWALK.md`, control-plane registers (`DECISIONS.md` v0.2, `ASSUMPTIONS.md` v0.1, `AUDIT.md` 2026-08-20, `CANONICAL_STATE.md` v0.1, `EVIDENCE_LEDGER.md` v0.2), and direct git/test observation in this worktree
- **What this packet is NOT:** it decides nothing, implements nothing, and edits no canonical register. It does not choose DEC-PRISM-SYS-001 and does not implement V8.3 bind/resolve/revoke. Every claim below is labeled FACT (observed), SPEC (canonical/proposed specification), or **NOT_EVIDENCED**.

---

## 1. Current merged facts — PRISM-7 and PRISM-8 (X2 ceiling)

### 1.1 PRISM-7 — PrismIdentityRegistry (FACT)

Merged into this branch via `ec10947`, integrated through merge commit `75224d2`.

- Cairo crate at `contracts/prism_identity_registry/` (separate from the Next.js app, per SD-001): `src/lib.cairo` (155 lines) + `tests/test_prism7.cairo`.
- Implemented surface: OP-7-01 `create_identity()` (caller becomes controller; counter-derived felt252 id starting at 1; emits `PrismIdentityCreated {prism_id (keyed), controller}`) and OP-7-02 `get_identity(prism_id)` (public view; `Option::None` = ERR-010 view flag, revert-free). No binding ops — hard ordering honored; PRISM-8 storage shape reserved as comments only.
- Conformance crosswalk: `projects/prism/system-inputs/PRISM7_CROSSWALK.md`. Deviations recorded there: no controller argument on create (caller IS controller); `pub` contract module for typed event assertion; `schema_version` storage field added and flagged for owner review; zero-input guard resolved to NOT-required for PRISM-7.
- Re-observed in THIS worktree today: `snforge test` → **7 passed, 0 failed** under `scarb 2.20.0` / `snforge 0.63.0` (toolchain-current pins, not repo-pinned — SD-007 record obligation noted in crosswalk §8).
- Maturity: **X2 local-controlled maximum**. No deployment, class hash, network receipt, or live observation exists. EVD-PRISM-004 remains X0 in the ledger.

### 1.2 PRISM-8 — offchain ownership-proof slice V8.1–V8.2 (FACT)

Merged via `221106c`, integrated through the same merge commit `75224d2`. Report of record: `projects/prism/agent-packets/V8_1_V8_2_OFFCHAIN_REPORT.md`.

- Hexagonal module `src/features/prism-identity/`: domain (zero external imports) / application (`PrismChallengeService` with exactly `issueChallenge`, `submitProof`, `getChallenge`) / adapters (clock, in-memory store, viem crypto primitives, smart-wallet checker port).
- Challenge: canonical serialization `"PRISM-OWNERSHIP-CHALLENGE v1\n" + JSON` (fixed key order); `digest = challengeId = keccak256(canonical)`; SIWE-style human-readable signable message via EIP-191 `personal_sign`; TTL clamped to [30s, 600s] (spec ≤10 min).
- Submit ordering: faithful-echo digest comparison FIRST (all six field mutations → ERR-012) → expiry gate (nonce stays UNUSED on ERR-013) → CAS nonce consumption (consume-on-attempt; second submission fails ERR-006 even with valid signature) → verification ladder (EOA ecrecover → EIP-1271 checker port → ERC-6492 parse; structural classification; undetermined maps to ERR-021, never silent invalid).
- Pins (SD-007 recorded): `viem@2.55.19` runtime, `vitest@4.1.11` dev-only.
- Re-observed in THIS worktree today: `npx --no-install vitest run` → **8 files, 42 passed / 42** (~3.4 s).
- Structural scope enforcement: capability test asserts no service member name contains bind/canonical/resolve/revoke/accept/register; state machine has no CONSUMED-as-terminal or binding states; no chain transport imports.
- Maturity: **X2 local only**. The ERC-1271 checker in tests is a labeled deterministic TEST DOUBLE; no live Base behavior, fork test, or RPC trace exists.

### 1.3 Environment caveat observed in this worktree (FACT, honest)

`npm run typecheck` cannot be re-executed here: this worktree's `node_modules` is incomplete (`next` absent, `viem` type declarations absent, no `.bin`). The failure is environmental (TS2307 "Cannot find module 'next'"), not an observed code regression. The recorded PASS values for typecheck/build come from earlier sessions/worktrees (V8 report §4; EVD-PRISM-012/013). **NOT_EVIDENCED: a green typecheck/build re-run in this worktree.** A worker must restore a full install before treating build hygiene gates as verified here.

### 1.4 Register state (FACT)

All decisive runtime rows remain X0: EVD-PRISM-004..007 NOT_IMPLEMENTED; gates G1/G2/G3 NOT_IMPLEMENTED in `AUDIT.md`; DEC-PRISM-SYS-001 PROPOSED/unresolved; ASM-PRISM-001/005 open; ASM-SYS-001..003 registered in `SYSTEM_CANONICAL.md` §6 pending owner migration into `ASSUMPTIONS.md`. Local test passes are X2 and never upgrade ledger rows by themselves.

---

## 2. chainId hardening proposal `e8886af` and compatibility impact

### 2.1 What it is (FACT)

Commit `e8886af0d9ab9b1c9a4a76d4ccb0d127b9d22df4` ("security(prism-8): bind ownership challenges to chain id") is the tip of branch `agent/prism-8-chainid-hardening`, exactly one commit ahead of current HEAD (parent = `9a5c14e`). It is **not merged**. Diff: 15 files, +178/−28, all inside `src/features/prism-identity/`.

Changes:

- `CHALLENGE_SCHEMA_VERSION` 1 → **2**, canonical header `"PRISM-OWNERSHIP-CHALLENGE v1"` → **v2**.
- New required field `chainId` (EIP-155 id of the network the execution account lives on) in `OwnershipChallengeFields`; bound into the digest serialization (first ordered field `chain_id`) and into the signable message (new `Chain ID:` line).
- `isValidChainId` structural validation (positive safe integer); `ChallengeServicePolicy.defaultChainId` becomes mandatory server-side config; constructor throws `invariant_violation` if missing/invalid.
- `AlteredField` union gains `chain_id` → presented-vs-stored mismatch yields ERR-012 detail `altered_fields:chain_id`; structurally invalid chain id also fails tamper-evidence.
- `IssuedChallengeView` gains `chainId` (additive).
- Four new tests (46 total vs 42 on HEAD): invalid configured chain id rejected as wiring defect; signature minted over another chain's message → ERR-003; challenge id/digest bound to target chain (cross-network replay resistance); signable message differs when only the chain differs.
- Re-verified today in isolated extraction of `e8886af`: **8 files, 46 passed / 46**.

### 2.2 Compatibility impact (FACT + SPEC analysis)

| Impact area | Effect |
|---|---|
| Stored/in-flight challenges | Every schema-v1 challenge becomes unverifiable under v2 logic (digest and message change by construction). Acceptable today: the only store is the in-memory reference adapter and nothing is deployed or persisted. Any future persisted pre-v2 rows must be invalidated/expired at migration, not silently reinterpreted. |
| Fixture corpus | All signing fixtures regenerate; message bytes wallets sign are different. |
| Configuration surface | New mandatory wiring item `policy.defaultChainId`. Deployment config must carry the venue chain id per environment (SD-006 environment scoping applies). |
| API surface | Additive `chainId` on issued-challenge views; error details gain `altered_fields:chain_id`. |
| System-spec alignment | SD-005 envelope `{domain, venue, execution_account, prism_id, nonce, expiry}` and INV-SYS-011 tamper-evidence list do **not** yet include `chain_id` (checked in-repo). Accepting e8886af therefore requires an EXTEND-class amendment to the system artifacts (SD-005, INV-SYS-011 md+yaml, OBJ-PRISM-005 persisted_fields). This packet does not make that edit; it flags it as a required companion step to the owner's accept/amend decision. |
| Security posture | Closes a cross-network replay gap: a proof signed for one Base network can no longer be presented against a binding targeting another (e.g., testnet-signed proof reused at mainnet bind). Consistent with RESEARCH gate §10 freshness trigger "Base Account changes → re-verify A2 assumptions". |

**Decision required (owner):** merge `e8886af` (fast-forward onto the backend line) plus its spec-amendment companion — or supersede. This packet takes no side; it records that the slice is green at X2 and that deferral leaves the cross-network replay window open until V8.5.

---

## 3. Exact production OwnershipProofStore requirements (CAS / T7)

Source of truth: `src/features/prism-identity/domain/ports.ts`, `adapters/memory-ownership-proof-store.ts`, V8 report §9, AUTHORITY_MATRIX §4 rows 6–7, TEST_ARCHITECTURE T7.

A production adapter MUST satisfy the existing `OwnershipProofStore` port without weakening any semantics:

1. **Atomic compare-and-set nonce consumption (INV-SYS-010).** `consumeNonce(challengeId)` returns exactly one of `"consumed" | "already_consumed" | "unknown"`; across all concurrent/repeated callers, exactly one ever observes `"consumed"`. Implementation must be an ACID conditional write in the durable store — the in-memory adapter's single-process critical section is explicitly NOT sufficient (T7 tier).
2. **Optimistic guarded state transition.** `transitionState(challengeId, from, to, patch)` returns `false` unless current state equals `from` (no silent overwrite; SYSTEM_FOUNDRY §18 stale-conflict rule; conflicts surface as structured errors, never lost updates).
3. **Issued-record integrity.** `putIssued` rejects duplicate `challengeId` (`duplicate_challenge_id`) — surfaced defensively as ERR-021 per V8 report assumption 3; retries are an adapter concern.
4. **Durability across restart.** Records survive process restarts; startup sweep of non-terminal operations resumes polling from last recorded tx hash (AUTHORITY_MATRIX §4 row 5). Crash after verify before submit: VERIFIED records with no submitted tx expire gracefully; user retries with a fresh challenge once TTL passed (row 6).
5. **TTL sweeper.** Expiry sweep marks unused challenges EXPIRED (SM-PRISM-001 TR-P3; INV-SYS-010 secondary validation).
6. **Fail-closed rejection path.** If best-effort rejection marking fails after a failed verify, state remains ISSUED with consumed nonce — replays stay blocked by CAS; surfaced as defensive ERR-006, not data loss (V8 report §9.3).
7. **Classification metadata retained.** `verifiedSignatureClass` (EOA | EIP1271 | ERC6492) and `verifiedAt` persist with the record (INV-SYS-009 monitoring signal: sudden 100%-EOA distribution signals ladder bypass).

Required evidence when built (T7/T12): concurrency suite demonstrating one-VERIFIED-under-race against the real store; restart-mid-operation recovery run; both recorded with commit SHA per the evidence template.

**NOT_EVIDENCED:** no durable store adapter exists anywhere in the repo today; all nonce/CAS guarantees currently rest on the in-memory reference adapter.

---

## 4. Operation lifecycle & reconciliation requirements

Source: STATE_MACHINES.md SM-PRISM-003 (+ `state-machines.yaml`), CONTRACT_SPEC §4–§5, AUTHORITY_MATRIX §4–§5, ERROR_CATALOGUE, INVARIANTS INV-SYS-005/007.

Every chain-touching user action runs the canonical wrapper lifecycle:

```text
created → awaiting_authorization → ready → submitted → processing
        → confirming → confirmed → indexed → reconciled → completed
Failure branches: failed_retryable | failed_terminal | reverted | expired | cancelled | requires_attention
```

Binding requirements:

1. **Submitted ≠ completed everywhere (INV-SYS-005 / INV-PRISM-015).** Completion is gated on `reconciled`; no API/UI/receipt surface may represent submitted/confirming work as done. A timeout after submission proves nothing (ERR-022: honest "still processing", poll-only, never reported as on-chain failure).
2. **Authoritative source per state.** created…ready → backend op row; submitted/processing/confirming → Starknet RPC tx status; confirmed → execution_status SUCCEEDED at finality; indexed/reconciled → registry event observed AND matched to the operation; reverted → receipt revert code mapped to a catalogue entry.
3. **Durable operation row before broadcast; DB commit + chain confirmation are never one transaction.** Pattern: durable op row → broadcast → poll → reconcile. Recovery is honest op-state correction; no compensation paths exist because failed txs leave no partial state.
4. **Reconciliation rules (AUTHORITY_MATRIX §4)** — each divergence case needs detection, repair, operator visibility, user visibility, and an audit entry: submitted-but-unknown tx (re-poll by hash → failed_retryable after N misses); confirmed-but-unindexed (replay events from block range); missed/duplicate indexer events (idempotent re-index keyed `(tx_hash, event_index)`); stale cache showing ACTIVE for revoked binding (watermark comparison at serve time → serve NO_ACTIVE_DESTINATION); backend restart mid-operation; crash after verify before submit. Contract upgrade row: n/a — immutable deployment (SD-002). Rule of record: derived state is repaired toward canonical truth; never the reverse.
5. **Observability correlation chain (AUTHORITY_MATRIX §5):** `user_action_id → request_id → command_id → operation_id → db_tx_id → chain_tx_hash → event_id → reconciliation_id → served_state_version`. Minimum obligations: Operation resource created before submission; `chain_tx_hash` stored once broadcast; resolution responses carry their block watermark; errors carry stable ERR codes, never stack traces.
6. **Persistence classification (CONTRACT_SPEC §4):** challenge/nonces + operation rows = AUTHORITATIVE_APP_STATE (backend DB, but never authoritative for identity truth); indexer tables = LEDGER_INDEX (rebuildable); caches disposable; op event log append-only AUDIT; SM-PRISM-003 op state durable WORKFLOW.
7. **Concurrency:** sequencer ordering is authoritative for conflicting binds/revokes; the backend never resolves races itself.

**NOT_EVIDENCED:** none of SM-PRISM-003 exists in code. The merged slices contain no Operation resource, no reconciliation worker, no watermark serving path. This is the largest unbuilt production layer between the current X2 slices and any deployment.

---

## 5. PrismIdentity event/indexer reconstruction requirements

Source: EVENT_CATALOGUE.md (+ `events.yaml`), CONTRACT_SPEC §1, INV-SYS-006/007, TEST_ARCHITECTURE T9/A7-4.

1. **Three canonical events reconstruct everything:** `PrismIdentityCreated {prism_id, controller}`, `ExecutionIdentityBound {prism_id, venue, execution_account, proof_digest}`, `BindingRevoked {prism_id, venue, execution_account}`. Empty state + replay of these three alone = complete canonical identity/binding state (testable guarantee; TEST-7-3-1, gate A7-4). Only `PrismIdentityCreated` exists onchain today (PRISM-7 slice).
2. **Indexer obligations:** order by `(block_number, transaction_hash, event_index)`; idempotent upsert keyed `(tx_hash, event_index)`; identity projection carries ONLY canonical fields — must not enrich with social/linkage data (consumer responsibility clause); on `BindingRevoked`, resolution flips to NO_ACTIVE_DESTINATION while the identity projection MUST NOT be deleted or mutated (INV-SYS-006); on BIND/REVOKE events, invalidate resolution caches for `(prism_id, venue)`.
3. **Uniqueness/replay rules:** prism_id emitted once ever (counter construction); proof_digest once ever (INV-SYS-004); replays idempotent by event_key (+ digest check for binds).
4. **Serving rule (INV-SYS-007):** resolve() serves registry-canonical state or indexer state within bounded staleness (`confirmed_block − K`); every response carries its block watermark; entries below the confirmed watermark invalidate; stale-active is forbidden; cache/RPC disagreement resolves toward canonical Starknet state within the stated reconciliation window.
5. **Classification:** indexer tables are LEDGER_INDEX — derivable and rebuildable; backend operation logs are audit trails, never canonical events.

**NOT_EVIDENCED:** no indexer, projection table, reconstruction-at-API-level test, or watermark serving implementation exists. The snforge TEST-7-3-1 pass proves in-contract event capture only (X2), not a running indexer.

---

## 6. Deployment prerequisites (all currently unmet)

Ordered checklist a deployment worker must close before any live-network step:

1. **Environment/config scoping (SD-006):** target networks declared per environment — default SN_SEPOLIA (+ Base Sepolia); SN_MAIN only behind Jason-approved release gate; all addresses/env config environment-scoped; `STARKNET_RPC_URL` never hard-coded; observed network shown separately from configured target.
2. **Venue chain id configuration:** requires the e8886af disposition (§2) — `policy.defaultChainId` must be set per environment from the declared Base target network. **NOT_EVIDENCED: no target-network value is decided or recorded anywhere in-repo.**
3. **Deployment posture (SD-002):** immutable deploy, no proxy; bugs require redeploy + re-bind (accepted consequence). Contract upgrade reconciliation row is n/a.
4. **Toolchain pinning (SD-007/A5):** scarb 2.20.0 / snforge 0.63.0 are toolchain-current, not repo-pinned — record exact versions per phase start; re-run npm dist-tag freshness check before each phase; never opportunistically upgrade `next`-tagged pins.
5. **Build reproducibility (A7-6):** `scarb clean && scarb build && snforge test` green on clean checkout with commit SHA recorded; equivalent `tsc`/`next build` hygiene restored in this worktree first (see §1.3 incomplete-install caveat).
6. **Deployment mechanics:** `snfoundry.toml` currently contains ONLY commented placeholder profile lines — no network, account, RPC, or keystore configuration exists. A deployer account/funding path and sncast profile must be prepared WITHOUT committing secrets (G8: no committed secrets).
7. **Evidence obligations per deploy:** record network, contract address, class hash, deploy tx hash, block, status in `EVIDENCE_LEDGER.md` using the yaml template; EVD-PRISM-004 moves X0 → at most X3 after observed live create/read (A7-7); X4/X5 requires SN_MAIN + independent explorer/RPC re-read (V8.6 territory, release-gated).
8. **Expectation boundary (hub evidence):** declaring registry addresses later interacts with DEC-PRISM-016 own-contract rules, but registry operations alone do NOT satisfy hub own-contract final-hash evidence — that requires the Phase 5 helper. Keep the two evidence tracks separate; do not write `strk20.json` from Sepolia work.
9. **Prohibited during deploy work:** the full banned-claims list (SYSTEM_CANONICAL §8 / RESEARCH gate §7) — including any trustless/permissionless phrasing while DEC-PRISM-SYS-001 is unresolved.

---

## 7. Decision blockers (owner: Jason) — this packet chooses none

### 7.1 DEC-PRISM-SYS-001 — acceptance-trust mechanism (BLOCKING for V8.3+)

Status: PROPOSED in `SYSTEM_CANONICAL.md` §5; unresolved. The researched recommendation (backend verifies via EOA→1271→6492 ladder; user's Starknet controller signs the binding tx; registry enforces controller auth + onchain single-use digest consumption; canonical only at the Starknet transition) remains modeled as PROPOSED throughout the artifacts. Downstream placements that depend on it: OP-8-01 caller/authorization, authority row A4 split, INV-SYS-003/INV-SYS-004 enforcement points, ERR-004/ERR-007 semantics, SD-004. Flip cost is HIGH (registry authorization + replay protection + error catalogue rework). Until accepted: V8.3 bind acceptance, OP-8-01..03 implementation, and any "trustless"-adjacent language remain blocked/banned. **This packet does not select it.**

Non-blocking sibling: DEC-PRISM-SYS-002 (cross-ID account exclusivity not enforced; default allow-and-observe).

### 7.2 Target-network declaration (BLOCKING for deployment + chainId config)

No artifact records which specific networks constitute the deployment targets (Starknet side and Base side, per environment). Canon constrains but does not choose: CON-PRISM-012 / SD-006 default dev/runtime to SN_SEPOLIA + Base Sepolia; SN_MAIN behind explicit release gate; TEST_ARCHITECTURE §5 ladder (devnet → SN_SEPOLIA + Base testnet → SN_MAIN release-gated). The choice must be recorded as an owner decision/environment manifest before: (a) `policy.defaultChainId` can be wired (post-e8886af), (b) V7.5/V8.5 deployments, (c) any address appears in evidence. Related open register items that touch network/evidence decisions but are outside this packet: G0 mainnet reachability (NOT_IMPLEMENTED), strk20.json intentionally empty.

Also pending owner action (register hygiene, non-blocking): migrate ASM-SYS-001..003 into ASSUMPTIONS.md; accept/amend the STRENGTHEN-class EIP-1271/ERC-6492 requirement (already flagged in SYSTEM_CANONICAL §1); review PRISM-7 deviations flagged in the crosswalk (schema_version storage field).

---

## 8. Exact tests & evidence needed (to move anything upward)

Test IDs below are normative (TEST_ARCHITECTURE §2–§4); maturity scale per EVIDENCE_LEDGER. A criterion counts only with observed results recorded in the ledger at its declared maturity.

Already satisfied at X2 (FACT, re-observed): PRISM-7 suite TEST-7-2-1/-2/-3/-4, TEST-7-3-1, ERR-010 read-path, persistence analogue (7 tests); PRISM-8 suite TEST-8-1-1..-3, TEST-8-2-1..-5, mutation matrix, error crosswalk (42 tests; 46 with e8886af).

Still missing, by tier:

- **T3 property/fuzz:** double-digest-consumption impossibility under interleaving (INV-SYS-004/010). NOT_EVIDENCED (counter monotonicity unit-tested only).
- **T7 DB integration:** real-store CAS race suite (one VERIFIED max); operation-row durability across restart. NOT_EVIDENCED (no durable store exists).
- **T9 ledger integration:** backend ↔ registry event indexing; reconstruction guarantee exercised through the indexer, not just in-contract. NOT_EVIDENCED.
- **T12 failure/recovery:** RPC outage, indexer lag, duplicate events, restart mid-bind, cache-disagreement override (TEST-8-4-4). NOT_EVIDENCED.
- **T10/T11:** frontend lifecycle labeling from op states; full decisive sequence FT-001 with success + ERR-012 rejection + ERR-004 permission + ERR-023 stale conflict + ERR-021 dependency + retry + restart-mid-op. NOT_EVIDENCED.
- **TEST-8-2 fixture corpus against LIVE Base:** deployed EIP-1271 wallet + undeployed ERC-6492 fixtures (current 1271 checker is a local test double). NOT_EVIDENCED.
- **Remaining PRISM-8 acceptance tests requiring V8.3+/V8.4 code (blocked on DEC-PRISM-SYS-001):** TEST-8-3-1..-4 (bind acceptance incl. FT-002 wrong-signer, FT-003 replay ERR-007 at contract, VERIFIED-without-tx produces no canonical change), TEST-8-4-1..-4 (resolve/revoke incl. decisive tail and revoked→ACTIVE impossibility).
- **Live-network evidence envelopes:** V7.5 SN_SEPOLIA deploy receipt (network/address/class hash/deploy tx) → EVD-PRISM-004 ≤X3; V8.5 decisive sequence on SN_SEPOLIA + Base testnet with every tx hash + status recorded → EVD-PRISM-005/006/007 ≤X3; X4/X5 additionally requires SN_MAIN repeat behind the Jason-approved release gate (V8.6) and independent re-read. Each ledger update uses the yaml evidence template (commit SHA, spec_versions, procedure, transactions, claim_scope, limitations, independent_verification, observed_at) — never batch-retroactive.
- **Cross-cutting per phase:** pin-freshness re-check; tsc/build/diff green (blocked in this worktree until deps restored); privacy-copy lint against the ban list; EVIDENCE_LEDGER + AUDIT updated per milestone.

---

## 9. Ordered next worker packets

Dependency-ordered; each packet is bounded, ends with its own session footer, and may not expand scope. Owner decisions (D-items) gate the sequence.

1. **WP-0 (owner):** Decide DEC-PRISM-SYS-001 (accept recommended mechanism or amend via superseding decision) — unblocks WP-5. Also: declare target networks per environment (§7.2); dispose of e8886af (accept → triggers WP-1; reject/supersede → WP-1 collapses to spec-note only); optionally migrate ASM-SYS-001..003 and acknowledge STRENGTHEN class.
2. **WP-1 (code, unblocked now):** Land e8886af chainId hardening + its EXTEND-class spec companion (amend SD-005 envelope and INV-SYS-011 field list in `system/*` md+yaml to include chain_id, schema v2 note) IF accepted at WP-0. Regenerate fixtures; keep suite green (46-test baseline). Prohibited: no store swap, no chain calls.
3. **WP-2 (code, unblocked now):** Restore full dependency install in this worktree; re-establish typecheck/build/diff hygiene baseline and record it (closes the §1.3 NOT_EVIDENCED gap). Prohibited: no dependency upgrades beyond lockfile restoration (A5).
4. **WP-3 (code, unblocked now):** Production `OwnershipProofStore` adapter (§3 requirements) + TTL sweeper + T7 concurrency/restart suites against the real store. Prohibited: no semantic drift from the port contract; fail-closed behavior preserved.
5. **WP-4 (code, unblocked now):** SM-PRISM-003 Operation resource + reconciliation worker + observability chain fields (op rows, tx-hash correlation, watermarks, stable ERR mapping) per §4. Includes T12 harness cases for restart/staleness.
6. **WP-5 (code, gated on WP-0 DEC-PRISM-SYS-001 acceptance):** V8.3 binding acceptance: add OP-8-01 (+ consumed-digest map) to the registry lineage per the accepted mechanism; wire controller-signed bind flow; implement TEST-8-3-1..-4. Prohibited: starting before WP-0 lands.
7. **WP-6 (code, after WP-5):** V8.4 resolve + revoke: resolver honesty (INV-SYS-007), revoke idempotence (ERR-011 semantics), TEST-8-4-1..-4 including cache-disagreement override.
8. **WP-7 (ops, after WP-2/WP-4):** PRISM-7 deployment to the WP-0-declared Starknet testnet (SN_SEPOLIA default): sncast profile prep without secrets, deploy, record receipt envelope; observe live create/read → move EVD-PRISM-004 to X3 (A7-7). Update EVIDENCE_LEDGER + AUDIT gate statuses.
9. **WP-8 (e2e, after WP-5..WP-7):** V8.5 decisive sequence end-to-end on Starknet testnet + declared Base testnet, exercising success/rejection/permission/stale/dependency/retry/recovery branches; live-corpus ladder fixtures; record every tx hash → EVD-PRISM-005/006/007 ≤X3. This closes G2/G3 candidates at testnet depth.
10. **WP-9 (release-gated, owner approval required):** V8.6 SN_MAIN repeat + X4/X5 evidence; separate from STRK20 Phase 5 helper/hub-evidence track (never conflate).

Parallel-safe from the start: WP-2; WP-1/WP-3/WP-4 touch disjoint layers (challenge domain+spec vs store vs op lifecycle) but share files under `src/features/prism-identity/` — serialize merges, coordinate on `ports.ts` changes.

---

## 10. Explicitly NOT evidenced (consolidated)

- Any onchain deployment of the registry; no class hash, address, or tx hash exists. EVD-PRISM-004..007 all X0; G1/G2/G3 all NOT_IMPLEMENTED.
- Any live-network behavior of the verification ladder: deployed EIP-1271 wallets, undeployed ERC-6492 accounts, Base RPC honoring either standard. Local checker is a deterministic test double.
- Typecheck/build greenness IN THIS WORKTREE (incomplete node_modules; prior PASS values are from other sessions). Vitest/snforge greenness WAS re-observed here (42/42 and 7/7 respectively).
- e8886af beyond local X2: merged nowhere; its chainId requirement appears in no system spec artifact yet; no owner accept/amend recorded.
- Durable OwnershipProofStore, operation lifecycle machinery, reconciliation worker, indexer/projection layer, watermark serving: entirely unimplemented.
- Target networks (Starknet + Base, per environment) and therefore the venue chain id: undecided/unrecorded.
- DEC-PRISM-SYS-001 outcome and all downstream semantics contingent on it; DEC-PRISM-SYS-002 likewise open (non-blocking).
- ASM-SYS-001..003 remain open assumptions (pending migration into ASSUMPTIONS.md); ASM-PRISM-001/005 validation sequences unexecuted.
- Fuzz/property coverage (T3), T7/T9/T10/T11/T12 tiers, and every X3+ maturity claim in §8.
- G0 mainnet reachability and all sprint final-evidence rows (strk20.json empty by design; untouched by this packet).

Per prohibited-claims rules: nothing above may be summarized as "working", "production-ready", or "trustless" — the accurate statement is *two vertical slices implemented and locally verified at X2; zero runtime evidence; three owner decisions outstanding*.

---

## Session footer (FOUNDRY_PROTOCOL §17)

```text
Packet created: projects/prism/agent-packets/BACKEND_PRODUCTION_READINESS_PACKET.md (this file)
Canonical registers edited: none (DECISIONS/EVIDENCE_LEDGER/AUDIT/ASSUMPTIONS/CANONICAL_STATE untouched)
Source code edited: none — documentation-only packet; no cleanup commands run
Decisions created: 0 (DEC-PRISM-SYS-001 left PROPOSED, deliberately unchosen)
Assumptions added: 0   Evidence added: 0 (all rows unchanged; observations recorded here only)
Verification performed this session: vitest 42/42 (HEAD), 46/46 (e8886af extraction),
  snforge 7/7 (HEAD); typecheck/build blocked by incomplete node_modules (recorded honestly)
Unresolved questions: DEC-PRISM-SYS-001 (blocking V8.3+), target-network declaration,
  e8886af disposition, ASM-SYS migration (non-blocking)
Next evidence-producing step: WP-0 owner decisions, then WP-1/WP-2 in parallel
```
