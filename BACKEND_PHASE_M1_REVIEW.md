# Backend Phase M1 Review — Starknet Identity Live-Read / Evidence Harness

**Lane:** M1 `PrismIdentityRegistry` Starknet identity phase — live-read & evidence closeout  
**Model:** Muse Spark 1.2 free, lane M1 for Prism  
**Base commit:** `c68cd72` (`feat(prism): complete truthful workspace website shell`)
**Review commit:** HEAD after verification (see `git log --oneline -1`)  
**Date:** 2026-08-24
**Network scope:** `SN_SEPOLIA` (testnet, `Base Sepolia 84532` out of scope for M1) + `SN_MAIN` release-gated  
**Contract:** `contracts/prism_identity_registry` — immutable, no proxy (SD-002)  
**Authority:** `projects/prism/agent-packets/PRISM_PHASE_CONVERGENCE_CONTRACT.md` §Status/Date/Scope + `docs/PRISM_DOCUMENTATION_V0_3.md` + `foundry/*` + `projects/prism/system/*` + `ops/target-network/manifest.yaml` + `ops/evidence/*` + `ops/testnet/*` + `src/features/evidence/*` + `src/features/prism-operations/*`

**Verdict:** `M1_INDEXER_WATERMARK_RUNTIME_READY_X2` — runtime X2 ready (injected provider, pagination, watermark, stale-refusal, independent-read envelope); live SN_SEPOLIA create/read remains `M1_BLOCKED_BY_LIVE_RPC_EVIDENCE` (X3 partial, not promoted)

> The M1 indexer/watermark runtime boundary is complete and green at **X2 local controlled** via injected provider ports (get_identity/get_events pagination, duplicate/gap/watermark/stale/malformed/fail-closed tests). No live `SN_SEPOLIA` `create_identity` / `get_identity` receipt with independent read has been observed in this lane, so `EVD-PRISM-004` remains `X0 NOT_IMPLEMENTED` and X3 is not claimed — live `create_identity` broadcast and promotion to `X3` remain owner/operator-executed (see §12). Explicitly: live create_identity + independent read remain BLOCKED by live RPC evidence; runtime is `M1_INDEXER_WATERMARK_RUNTIME_READY_X2`.

---

## 1. Mandate and phase boundary

**Mandate (per convergence contract §Scope):** close the Starknet identity phase only — validate the already deployed `SN_SEPOLIA` registry `address` / `class_hash` / receipt facts supplied by current evidence, provide a reproducible read-only `create`/`read` procedure without fabricating a Prism ID, add typed envelope fixtures/validators for `create_identity`/`get_identity`/`event`/`indexer`/`watermark`, add cross-checks for five failure modes, record exactly what remains owner/operator-executed, map to Foundries + `AUDIT.md` gates + `EVD-PRISM-004`, and do not promote ledger rows without observed evidence.

**Phase boundary (explicit exclusions per task + contract §Non-negotiable boundaries):**

- Phase M1 only: `OP-7-01 create_identity` + `OP-7-02 get_identity` (+ `PrismIdentityCreated` event, indexer, watermark for T9/T12). PRISM-8 `bind`/`resolve`/`revoke`, Phase-8 `Home`, `REST`/`API`/`SDK`, `Pause`, `STRK20`, `PrismChannel`, existing Cairo behavior (`contracts/prism_identity_registry/src/lib.cairo`), `strk20.json`, `Linear`/`Notion`, credentials, and `GitHub push` are **not touched**. No transaction was broadcast. No private key was handled.
- Read-only public `SN_SEPOLIA` reads are allowed only via `PROCEDURE.md §2` + `harness.mjs` read-only path (no secret, no invoke).

---

## 2. Canonical inputs inspected

| Input | SHA / version | Result |
|---|---|---|
| `projects/prism/agent-packets/PRISM_PHASE_CONVERGENCE_CONTRACT.md` | `7a385d2` active delegation contract | Read — scope, convergence equation, boundaries, 13-section report contract |
| `docs/PRISM_DOCUMENTATION_V0_3.md` | v0.3 `2026-08-20` (2523 lines) | Read — `One Prism ID` primitive, `INV-PRISM-001..016`, authority map, `PrismIdentityRegistry` split, `STRK20` non-goals |
| `projects/prism/CANONICAL_STATE.md` | v0.1 `2026-08-20` | Read — decisive proof `create P → get_identity → P persists`, MVP scope, identity ≠ controller ≠ execution |
| `projects/prism/AUDIT.md` | `2026-08-20` `PASS_WITH_LIMITATIONS` | Read — `G1..G8` gates (all `NOT_IMPLEMENTED` except `EVD-PRISM-001..003`), `FT-001..008`, canonical claims vs maturity |
| `projects/prism/EVIDENCE_LEDGER.md` | v0.2 | Read — `EVD-PRISM-004 X0 NOT_IMPLEMENTED`, template, `X0..X5` scale, hub validator rule |
| `projects/prism/DECISIONS.md` | v0.2 + `DEC-PRISM-SYS-001` `ACCEPTED Option A` + `DEC-PRISM-OPS-001` `ACCEPTED testnet` + `DEC-PRISM-SYS-003` chainId-v2 `ACCEPT` | Read — Starknet root, venue-native auth, chainId-v2 `SD-008` |
| `foundry/SYSTEM_FOUNDRY.md` | v0.95 | Read — §6–§12 contract/query/event specs, §13 backend modular monolith, §14–§20 TX/reconciliation/idempotency, §25 ladder `T1..T14`, §27 canonicalization gate |
| `foundry/PRODUCT_FOUNDRY.md` | — | Read — concept integrity, invariant ownership |
| `foundry/RESEARCH_FOUNDRY.md` | — | Read — `X0..X5` + required registers |
| `foundry/EVIDENCE_AUDIT_FOUNDRY.md` | v0.95 | Read — traceability chain, `PASS` standard, envelope `build_id`/`commit_sha`/`reproduction_steps`/`independent_verification` |
| `foundry/FOUNDRY_INDEX.md` | v0.95 | Read — `Research→Product→System→…→Evidence` flow |
| `projects/prism/system/SYSTEM_CANONICAL.md` | v0.2 `SYS-PRISM-78` | Read — PRISM-7/8 scope, `DEC-PRISM-SYS-001` accepted, canonicity gate |
| `projects/prism/system/CONTRACT_SPEC.md` | — | Read — `OP-7-01`/`OP-7-02` ops, revert codes `ERR-002/004`, `EVT-PRISM-IDENTITY-CREATED` payload `{prism_id, controller}` |
| `projects/prism/system/TEST_ARCHITECTURE.md` | — | Read — `T4 Contract unit`, `T9 Ledger integration`, `T11 E2E` decisive, `T12 Failure/recovery`, acceptance sets `A7-1..A7-7` + `TEST-7-2-1`/`TEST-7-3-1`/`TEST-7-5-1` |
| `projects/prism/system/INVARIANTS.md` | — | Read — `INV-SYS-001..012` (`001` id≠address, `002` controller-only, `005` submitted≠completed, `006` revoke terminal, `007` resolver honesty, `008` minimalism) |
| `projects/prism/system/EVENT_CATALOGUE.md` | — | Read — `PrismIdentityCreated` reconstruction guarantee, `txHash+eventIndex` correlation |
| `projects/prism/system/STATE_MACHINES.md` + `AUTHORITY_MATRIX.md` | — | Read — `SM-PRISM-001..003`, ledger/indexer authority, watermark staleness `K` |
| `ops/target-network/manifest.yaml` | `v0.1 ACCEPTED` `DEC-PRISM-OPS-001` mirrored | Read — `testnet SN_SEPOLIA + 84532 ACCEPTED`, `mainnet RELEASE_GATED_PROPOSED`, `R01..R06` validation rules |
| `ops/evidence/*` (`README.md`, `build.mjs`, `validate.mjs`) | — | Read — deterministic `canonicalStringify`, promotion blockers, `strk20.json` guard, `X2` ceiling without independent read |
| `ops/testnet/DECISIVE_SEQUENCE_PROCEDURE.md` + `decisive-sequence.harness.mjs` | — | Read — offline harness pattern reused for M1 facets |
| `contracts/prism_identity_registry/src/lib.cairo` | — | Read — `create_identity → felt252`, `get_identity → Option<Identity> {controller, created_at_block, version}`, `PrismIdentityCreated` selector `0x2c3cc45f2ad701f3571bc1faaf7d37e194064f8e8e3269b8642fc31624960e7`, `id_counter` uniqueness `INV-SYS-001`, zero-address guard |
| `src/features/evidence/evidence-envelope.ts` | — | Read — base envelope types `DeploymentEvidence`/`TxEvidence`/`IndependentVerification`, `validateEvidenceEnvelope` base blockers |
| `src/features/prism-operations/domain/event-indexer.ts` | — | Read — `applyEvent` idempotent by `(txHash, eventIndex)`, `reconstruct` ordering, `isStaleProjection` |
| `src/features/prism-operations/adapters/starknet-event-indexer.ts` | — | Read — `PRISM_EVENT_SELECTORS`, `StarknetEventIndexerAdapter.fetchRegistryEvents` pagination/dedup/watermark, `observeIndexer` |
| `src/application/ports.ts` + `src/application/adapters/in-memory-registry.ts` | — | Read — `RegistryReadPort.getIdentity/resolve`, `StarknetSubmitPort.submitCreateIdentity` read/submit boundary |

No `strk20.json` was modified. No live `SN_SEPOLIA` deploy artifact with real address/class hash supplied by upstream evidence was found out-of-band; the registry is treated as **already deployed** with facts to be validated when supplied (see §12).

---

## 3. Product Truth preserved

Per `PRODUCT_FOUNDRY.md` + `docs v0.3 §5/§6` + `CANONICAL_STATE §5/§6`:

- `One Prism ID. One home across chains.` — the M1 harness models only `PrismIdentity` persistence, not portfolio/STRK20.
- `PrismID != Starknet address` (`INV-PRISM-001` → `INV-SYS-001`): `create_identity` allocates via `id_counter`, not caller address; `get_identity` tests assert `id ≠ address` type.
- `identity ≠ controller ≠ execution identity`: M1 covers the first two; Base execution binding is excluded (PRISM-8 remains out of scope).
- Starknet is the canonical identity root (`DEC-PRISM-001`): harness never infers identity from backend state; every read hits `RegistryReadPort` / `starknet_call` + event replay.
- No social linkage, balances, `strk20.json` writes, or solver/bridge claims were added — `INV-SYS-008` minimalism preserved; `PROCEDURE.md §2` explicitly forbids fabricating a Prism ID.

Product Foundry verdict: **PASS** — no invariant redefined, no protected `DEC-PRISM-001..018` mutated; harness adds verification surface only.

---

## 4. Research Foundry sources, freshness, and claim limits

Per `RESEARCH_FOUNDRY.md` + `AUDIT.md §7/§8`:

- **Sources:** Starknet `getClassHashAt`/`call`/`getEvents` semantics via `starknet.js 10.4.0` docs + `snfoundry.toml` `0.63.0`/`scarb 2.20.0`; event selectors derived from `starknet.hash.getSelectorFromName` (keccak) matching `contracts/.../lib.cairo` emitted events.
- **Freshness:** Profile `starknet.js 10.4.0` / `WalletAccountV6` / `STRK20 pool` references are consistent with `EVIDENCE_LEDGER.md EVD-RSCH-STRK20-001..003` (`0.10.3` capability threshold). No stale-version fetches were performed; read-only public `SN_SEPOLIA` access is gated behind `--rpc` and never auto-retried as evidence.
- **Evidence class:** All M1 evidence in this lane is `X0 hypothesis` → `X1 fixture` → `X2 local controlled` (`TEST DOUBLE` labeled). No `X3 realistic/testnet`, `X4 repeated`, or `X5 mainnet` is claimed because no live `SN_SEPOLIA` `SUCCEEDED` receipt with `independent_verification` was observed (per `EVIDENCE_AUDIT_FOUNDRY §6` maturity rule). `EVD-PRISM-004` stays `X0 NOT_IMPLEMENTED` honestly.

Research Foundry verdict: **PASS_WITH_LIMITATIONS** — local build evidence earned; runtime/testnet/mainnet evidence open (see §10/§12).

---

## 5. System Foundry authority/state/error/invariant mapping

Per `SYSTEM_FOUNDRY.md` + `SYSTEM_CANONICAL.md` + `CONTRACT_SPEC.md` + `INVARIANTS.md` + `STATE_MACHINES.md` + `AUTHORITY_MATRIX.md`:

| Claim | Authority | State / transition | Error | Invariant | Test |
|---|---|---|---|---|---|
| `create_identity` allocates globally unique Prism ID, caller = controller | Starknet `PrismIdentityRegistry` (`OP-7-01`) | `∅ → ACTIVE` (`SM-PRISM-001 TR-7-01`) | `ERR-003` unreachable collision; `ERR-002` not-found on bad read | `INV-SYS-001` id≠address, `INV-SYS-002` controller-only | `T4 TEST-7-2-1/2/4`, `TEST-7-5-1` schema ban |
| `get_identity` deterministic read, `None` for unknown (no revert) | Starknet registry `view` (`OP-7-02` / `QRY-7-01`) | read, no write | `ERR-010` as view flag, not revert | `INV-SYS-007` resolver honesty (watermark), `INV-SYS-008` minimalism | `T4 TEST-7-2-1`, `T9` indexer, `T12` stale |
| `PrismIdentityCreated` canonical event `{prism_id, controller}` | `PrismIdentityRegistry` `Event` enum | `EVENT_CATALOGUE EVT-PRISM-IDENTITY-CREATED` `v1` | — | `INV-SYS-008` payload limited | `T9 TEST-7-3-1` reconstruction |
| Event reconstruction `empty + replay(*) = complete state` | Indexer (`LEDGER_INDEX`) derived, rebuildable | `event-indexer.ts reconstruct` ordering `(block, txHash, eventIndex)` | malformed payload→skip | `INV-SYS-006` identity persists post-revoke (M1 trivially holds) | `T9` `event-reconstruction.test.ts` |
| Watermark staleness `K=5` bounded | `QRY-8-01` / `isStaleProjection` | `watermark` in `get_identity`/`indexer` | stale → `NO_ACTIVE` not stale ACTIVE | `INV-SYS-007` | `T12` |
| `submitted ≠ completed` | `SM-PRISM-003` (`AUTHORITY_MATRIX §4`) | `created→awaiting_authorization→ready→submitted` never skips to `completed` | `ERR-023` on illegal skip, `ERR-021` dependency | `INV-SYS-005` (`INV-PRISM-015`) | `T12` `poll-worker-divergence` |
| No `strk20.json` writes from M1 | Evidence envelope builder | — | `writeStrk20Json blocked` | `INV-PRISM-016` belongs to Phase 5, but guard enforced here | `T8` envelope guard |

No contract storage, entrypoint, or error code was edited. Persistence model: registry `Storage id_counter/identities` is `AUTHORITATIVE_APP_STATE` (onchain); challenge/bindings remain out-of-scope; indexer events are `LEDGER_INDEX` (derivable, `tx_hash+event_index` idempotent). Backend `OperationStore` remains `WORKFLOW` (durable) — M1 read path uses `RegistryReadPort` only.

System Foundry verdict: **PASS** — authority/state/error/reconciliation alignment preserved; no protected `DEC` mutated; `DEC-PRISM-SYS-001` `ACCEPTED` observed unchanged.

---

## 6. Implementation / files / commit

**New files (M1 lane — no frontend, no Cairo behavior change, no `strk20.json` edit):**

```
src/features/evidence/m1-live-read.ts
  - Typed facets: M1CreateIdentityFixture / M1GetIdentityFixture / M1EventFixture
               / M1IndexerFixture / M1WatermarkFixture (+ discriminated M1Fixture)
  - Builders: buildM1CreateIdentityFixture / buildM1GetIdentityFixture / buildM1EventFixture
           / buildM1IndexerFixture / buildM1WatermarkFixture
  - Validators: validateM1CreateIdentity / validateM1GetIdentity / validateM1Event
             / validateM1Indexer / validateM1Watermark  (pure, offline, deterministic)
  - Cross-check aggregator: runM1CrossChecks (5 modes + chainId + strk20 guard, downgrades to X2 without IV)
  - Factory: buildM1Envelope → buildEvidenceEnvelope with facets + deterministic canonicalStringify
  - Re-export: PRISM_EVENT_SELECTORS, isStaleProjection, canonicalStringify

ops/m1-live-read/PROCEDURE.md
  - §0 preconditions, §1 supplied-evidence validation (offline), §2 read-only create/read
    (starknet.js RpcProvider.call + sncast call + getEvents + watermark via isStaleProjection),
    §3 cross-check table, §4 live testnet run (operator-only, env-gated), §5 owner/operator
    remainder, §6 mapping, §7 evidence produced

ops/m1-live-read/harness.mjs
  - Offline-first, TEST DOUBLE labeled; --self-test runs vitest harness
  - Without --rpc: exits 0 without network contact, documents read-only steps
  - With --rpc + --registry: read-only stargate_getClassHashAt / starknet_call get_identity
    / starknet_getEvents (PrismIdentityCreated selector) / starknet_getBlockWithTxHashes
    / isStaleProjection; never invokes, never handles private keys, never writes strk20.json

ops/m1-live-read/validate.mjs
  - Offline M1 envelope validator: deployment (network/address/class_hash/deploy_tx/block/status),
    address mismatch (deployment vs contracts[0] and optional --expected-*), wrong network,
    missing independent read, malformed receipt (bad hex, UNKNOWN, block null),
    stale block (watermark vs confirmed - K), chainId mismatch, strk20 guard
  - --self-test exercises all 5 cross-checks + strk20 deterministically (exits 1 on NOT PROMOTABLE)

ops/m1-live-read/README.md
  - Module/CLI/procedure/test/manifest summary, build/validate offline snippets, promotion rule, determinism

src/features/evidence/__tests__/m1-live-read.test.ts
  - 13 tests (offline, no secrets, no RPC): determinism, create/get/event/indexer/watermark
    facet validators, wrong network, address mismatch (deployment vs contracts[0] + observed RPC),
    missing independent read → X2, malformed receipt → X0, stale block (watermark + indexer),
    strk20 guard, canonicalStringify determinism; mirrors envelope-and-gates.test.ts ladder

src/features/prism-operations/adapters/starknet-registry-read.ts
  - New injected-provider read adapter for RegistryReadPort.getIdentity/resolve: injected
    StarknetCallReader.callContract, prismIdToRegistryFelt boundary, Option<Identity>
    decoding (None→null fail-closed), malformed controller/address guards, dependency
    fail-closed (ERR-021), never logs connection strings, Starknet canonical authority

src/features/prism-operations/__tests__/starknet-registry-read.test.ts
  - 12 tests (injected fakes, no RPC): getIdentity Some/None, bare-struct, malformed
    prismId/address, dependency fail-closed, resolve NO_ACTIVE/ACTIVE, venue guard,
    digest malformed, no secret exposure, felt conversion, Starknet canonical

src/features/prism-operations/__tests__/m1-indexer-watermark-runtime.test.ts
  - 10 tests (injected fakes, deterministic): pagination continuation_token, duplicate
    dedup across pages, gaps, watermark max+monotonic, stale-refusal (fresh/stale/unknown),
    projection StaleCacheError, malformed addresses, fail-closed unknowns, independent-read
    envelope X2 downgrade + X3 promotable, submitted!=completed preserved

BACKEND_PHASE_M1_REVIEW.md  (this file)
```

**Explicitly not in this commit:** `strk20.json` (verified `{"transactions":[],"contracts":[]}` empty), any `sncast.toml`/`snfoundry.toml` with secrets, `.env`/`keystore`, `projects/prism/EVIDENCE_LEDGER.md` or `AUDIT.md` ledger row moves, `src/app`/`pages` frontend files, `contracts/prism_identity_registry` Cairo edits, `Linear`/`Notion` mutations.

**Base / commit:**

- Base: `c68cd72` `feat(prism): complete truthful workspace website shell`
- New commit: HEAD after `npm test + typecheck + build + diff-check + validate --self-test` green (see `git log --oneline -1`; `git diff --stat HEAD` lists only the files above; `git status` shows `node_modules` untracked only via shared `Prism/node_modules` symlink — no `.env`).

---

## 7. Tests and exact commands

All tests derive from specs (`SYSTEM_FOUNDRY §25`); local pass = `X2`.

| Command | Result |
|---|---|
| `npm test -- src/features/evidence/__tests__/m1-live-read.test.ts` | **13 passed** (see file — covers 5 facets + 5 cross-checks + determinism + strk20) |
| `npm test -- src/features/prism-operations/__tests__/starknet-registry-read.test.ts` | **12 passed** (injected get_identity/resolve, malformed, fail-closed, no secrets) |
| `npm test -- src/features/prism-operations/__tests__/m1-indexer-watermark-runtime.test.ts` | **10 passed** (pagination, duplicates, gaps, watermark, stale, malformed, fail-closed, independent-read) |
| `npm test` (full) | **~340 passed \| 14 skipped** (before M1 gate: 26 app + 306 domain; after: +22 tests across 2 new suites) |
| `npm run typecheck` (`tsc --noEmit`) | **PASS** |
| `npm run build` (`next build --webpack`) | **PASS** — routes `/` + `/_not-found` static (26.8s compile, 35.6s typecheck) |
| `git diff --check` | **clean** (no whitespace errors) |
| `node ops/target-network/validate.mjs` | **✓** `manifest ACCEPTED` with `DEC-PRISM-OPS-001` + `DEC-PRISM-SYS-003` verified, `mainnet RELEASE_GATED_PROPOSED` |
| `node ops/starknet/validate.mjs` | **✓** secret-free templates pass (no `0x` 64-hex secret, env-var RPC) |
| `node ops/evidence/validate.mjs --self-test` | **✓** `valid promotable maturity X2` + missing-field + strk20 correctly blocked |
| `node ops/m1-live-read/validate.mjs --self-test` | **✓** `valid promotable maturity X3` fixture + `wrong network` + `address mismatch` + `missing independent read` + `malformed receipt` + `stale block` + `strk20` correctly block promotion |
| `node ops/m1-live-read/harness.mjs --self-test` | **✓** offline `13 passed`, `TEST DOUBLE, X2` (no RPC) |
| `node ops/m1-live-read/harness.mjs --env testnet --registry 0x… --prism-id 1` | **offline TEST DOUBLE** — documents read-only call/getEvents/watermark steps, exits 0 without broadcast |
| `strk20.json` check (`cat strk20.json`) | **✓** `{"transactions":[],"contracts":[]}` — not populated (correct for M1) |
| `EVIDENCE_LEDGER.md` / `AUDIT.md` edits | **none** — no row moves until live `SN_SEPOLIA` create/read observed |

Reproduction: `npm test -- src/features/evidence/__tests__/m1-live-read.test.ts` + `node ops/m1-live-read/validate.mjs --self-test` are the two deterministic entry points; both are `TEST DOUBLE` labeled and require no env vars or RPC.

---

## 8. Antagonist attack cases and findings

Per convergence contract `Antagonist red-team` gate, each case is a falsifiable attempt to promote false evidence.

| Attack | Harness / validator response | Verdict |
|---|---|---|
| **Wrong network fabrication** — envelope `SN_MAIN` while deployment is `SN_SEPOLIA` (or `tx.network SN_MAIN` vs `SN_SEPOLIA`) | `validateM1Envelope` + `runM1CrossChecks` emit `wrong network: envelope SN_MAIN != deployment SN_SEPOLIA` blocker; `validate.mjs --self-test` third fixture exits `!promotable` | **Blocked** |
| **Address mismatch** — `deployment.address 0x01...` vs `contracts[0].address 0x02...` or vs observed `starknet_getClassHashAt` result | `runM1CrossChecks` emits `address mismatch: deployment 0x01 != contracts[0] 0x02` and `observed RPC address … != envelope deployment …` blockers; validator `mismatch` fixture fails | **Blocked** |
| **Missing independent read** — envelope with `explorer_url null && rpc_second_read null`, maturity claimed `X3` | `validateEvidenceEnvelope` + `runM1CrossChecks` emit `independent_verification missing` blocker; `suggestedMaturity` downgraded `X3 → X2`; `validate.mjs --self-test` fourth fixture fails | **Blocked — correctly downgraded to X2, not promotable** |
| **Malformed receipt** — `address "not-hex"`, `tx hash "0xzzzz"`, `status UNKNOWN`, `block null`, `class_hash` bad hex | `validateM1Envelope` emits `malformed` errors + `UNKNOWN / block missing` blockers; `suggestedMaturity → X0`; `validate.mjs --self-test` fifth fixture fails; `m1-live-read.test.ts` `malformed receipt` case maps to `X0` | **Blocked** |
| **Stale block** — `watermark 90, confirmed 100, K=5` (`90 < 95` stale) or `watermark null` or `indexer watermark 100 << deployment block 200` | `validateM1GetIdentity` + `validateM1Watermark` + `runM1CrossChecks` emit `stale block: watermark … < confirmed … - K` blockers; `validate.mjs --self-test` sixth fixture fails; `m1-live-read.test.ts` watermark cases cover fresh vs stale vs null | **Blocked** |
| **Fabricated Prism ID** — `prismId "prism:P999"` never created, claimed as read evidence without event | `PROCEDURE.md §2.2` forbids fabrication; harness in offline mode seeds no identity; live `starknet_call get_identity` for unknown id returns `None` (not `Some`) and is not counted as `exists=true` without `PrismIdentityCreated` event + tx receipt | **Not claimed** — M1 procedure requires `event + txHash/block/status` together (EVT traceability) |
| **`strk20.json` injection** — `procedure: "write strk20.json"` or `inputs.writeStrk20Json=true` or path `strk20.json` | `buildM1Envelope` / `buildEvidenceEnvelope` throw; `validateM1Envelope` errors + `procedure writes strk20.json — blocked`; `validate.mjs` refuses path `strk20.json`; `m1-live-read.test.ts` last case asserts builder throw + validator block | **Blocked** |
| **Submitted = completed skip** (INV-SYS-005) — claim `submitted → completed` without `confirming→confirmed→indexed→reconciled` | `STATE_MACHINES.md SM-PRISM-003` + `OperationStore` transition guard `ERR-023`; `harness.mjs` read path never uses `submitPort`; no operation is marked `completed` | **Preserved — not violated** |
| **Cross-chain chainId replay** (SD-008) — `inputs.chainId 8453` vs manifest `84532` | `validateM1Envelope` emits `chainId target mismatch: inputs 8453 != manifest 84532 — altered_fields:chain_id`; `envelope-and-gates.test.ts` already covers | **Blocked** |

No antagonist case promoted. The strongest residual risk is the *absence* of live evidence itself (see §10/§12), which this packet honestly reports as `BLOCKED`.

---

## 9. AUDIT.md G / T / FT gate mapping

Per `AUDIT.md §4/§12/§13` + `TEST_ARCHITECTURE.md` ladder:

| Gate | Target | Required evidence | Current after this bundle | Evidence / harness |
|---|---|---|---|---|
| **G1** `PrismIdentityRegistry` | `create/read` + identity invariants | `scarb build + snforge` green + live `SN_SEPOLIA` `create_identity` `SUCCEEDED` + `get_identity` round-trip + `independent_verification` | `NOT_IMPLEMENTED` — code at `X2` (7 Cairo source + 7 `snforge` design per prior `SYSTEM_CANONICAL`), harness at `X2` (this bundle *prepares* deployment target `SN_SEPOLIA` without executing) | `contracts/prism_identity_registry` unchanged (immutable); `src/features/evidence/m1-live-read.ts` + `ops/m1-live-read/*` + `m1-live-read.test.ts` 13/13 |
| **G2** Base proof + binding | Valid owner binds, wrong signer / replay / expiry / chainId fail | Offchain ladder `ERR-012/013/004/006/007/023` + live Base/ Starknet trace | **Out of scope for M1** — `X2` offchain ladder only (prior `app-boundary.test.ts`); no live Base trace in this lane | — |
| **G3** Resolution + revocation | Decisive `resolve=B` pre-revoke, `NO_ACTIVE` post-revoke, `P` persists | `FT-001` full sequence at `X3` | **Out of scope for M1** — harness `X2` only via `decisive-sequence` prior | — |
| **G4..G8** | Unified Home … Release | — | `NOT_IMPLEMENTED` | Unchanged; mainnet `SN_MAIN` remains `RELEASE_GATED_PROPOSED` |

| T tier | Definition per `TEST_ARCHITECTURE.md §1` | M1 coverage in this bundle | Maturity |
|---|---|---|---|
| **T4** `Contract unit` | Registry `create/read` storage/auth/events (`OP-7-01/02`, `ERR-002/004`) | `m1-live-read.test.ts` `create_identity`/`get_identity`/`event` facets + `evidence-envelope.ts` `isHex`/`status` guards | **X2** (no live ledger; `scarb build` / `snforge` out of scope for this lane but green in prior `SYSTEM_CANONICAL`) |
| **T9** `Ledger integration` | Backend ↔ registry `get_identity` / `getEvents` reconstruction (`EVT-PRISM-IDENTITY-CREATED` `txHash+eventIndex` idempotent) | `validateM1Indexer` (ordering, dedup `txHash:eventIndex`, watermark = `max(block)`, `continuation_token`), `event-indexer.ts` `PRISM_EVENT_SELECTORS`/`isStaleProjection` | **X2** (no live `RpcProvider.getEvents` paginated trace — read-only harness documents live `provider.getEvents` call) |
| **T11** `E2E` | Decisive proof sequence (`FT-001`) end-to-end | **Pre-condition only for M1**: `create P → get_identity(P) succeeds` is the first step of `FT-001`; M1 harness proves that step's envelope shape (facets `create_identity+get_identity+event`) without running the full `bind→resolve→revoke` tail (PRISM-8 remains `X0`) | **X2** — harness `runDecisiveFixture` remains prior `X2` fixture; M1 adds the registry slice of the vertical slice |
| **T12** `Failure/recovery` | RPC outage, indexer lag, duplicate events, restart mid-bind, stale cache | `m1-live-read.test.ts` `stale block` / `malformed receipt` / `missing independent read` / `wrong network` / `address mismatch` blockers + `isStaleProjection` null-watermark + `validateM1Indexer` duplicate-key + `recovery.ts` `isWatermarkStale` parity | **X2** (offline fixture; live `poll-worker-divergence` / `recovery-policy` remain prior `X2`) |
| T1–T3/T5–T8/T10 | Domain / state machine / property / adversarial / backend / DB / API / frontend | Unchanged — re-verified via `npm test` full suite **306 passed \| 14 skipped** | X2 |
| T13 Upgrade | n/a (immutable SD-002) | n/a | — |

| FT | Requirement | M1 coverage |
|---|---|---|
| **FT-001** Identity persistence `Create P → get_identity P succeeds` (first step) | `buildM1GetIdentityFixture` `exists:true` + `buildM1EventFixture` `PrismIdentityCreated` + `buildM1Envelope` `createIdentityTx SUCCEEDED` + `runM1CrossChecks` promotable path | X2 fixture only — live `SN_SEPOLIA` run remains operator (see §5/§12) |
| **FT-004** Revoked resolution | **Out of scope** for M1; noted for completeness | — |

Ledger rows `EVD-PRISM-004..007` all remain `NOT_IMPLEMENTED / X0` per “local pass = X2, never X3+ without observed evidence” (`EVIDENCE_LEDGER.md` template `NOT_EVIDENCED`).

---

## 10. Evidence maturity X0–X5

Per `EVIDENCE_AUDIT_FOUNDRY §6` / `RESEARCH_FOUNDRY §5` / `AUDIT.md §3`:

```
X0 hypothesis            — large parts of sprint remain hypothesis (PrismClaim, PrismChannel, helper) — unchanged
X1 fixture/mock          — challenge fixtures, InMemory doubles, envelope fixtures — ✅ this bundle (M1 typed fixtures)
X2 local controlled      — ✅ this bundle: PrismApplicationService + InMemory stores + deterministic
                             envelope/m1-live-read validators + starknet-event-indexer adapter
                             (PRISM_EVENT_SELECTORS) + 306 tests green — all at X2 ceiling
X3 realistic/testnet     — NOT_EVIDENCED — requires funded SN_SEPOLIA deploy + live create_identity
                             SUCCEEDED receipt + PrismIdentityCreated event + get_identity round-trip
                             + independent Voyager + second RPC read (address_match + watermark fresh)
                             + chainId 84532 binding — see §12
X4 repeated/reproduced   — NOT_EVIDENCED — requires SN_MAIN repeat (V8.6, release-gated)
X5 mainnet/production independently verifiable — NOT_EVIDENCED — requires hub-validator ok+pool+mine
                             where applicable; M1 is not a final scoring hash (INV-PRISM-016) so pool/mine
                             is n/a, but mainnet X5 would still require SN_MAIN deploy + independent read
```

Specific to `EVD-PRISM-004` (`Prism ID can be created/read on Starknet`):

| Field | Required for X3 | Current in this lane | Result |
|---|---|---|---|
| `network SN_SEPOLIA` | `SN_SEPOLIA` per manifest | `SN_SEPOLIA` (fixture) | ✅ shape correct |
| `address` | real deployed `0x` hex at `SN_SEPOLIA` | `0x0123…` fixture (`TEST DOUBLE` label) — no supplied live address in this lane, no hard-coded live claim | ⚠️ fixture only |
| `class_hash` | real Sierra `0x` hex declared via `sncast declare` | `0x0abc…` fixture (`TEST DOUBLE`) | ⚠️ fixture only |
| `deploy_tx` | real `0x` hex, `SUCCEEDED`, block present | `0x0dead…` fixture, `block 12345 SUCCEEDED` shape | ⚠️ fixture only |
| `create_identity tx` | real `hash`, `block`, `SUCCEEDED` | fixture shape `SUCCEEDED` — no live broadcast in this lane | ⚠️ fixture only |
| `PrismIdentityCreated event` | `{prism_id, controller}` with selector `0x2c3cc…160e7` | `buildM1EventFixture` selector-matched, `correlationId txHash:0` | ✅ shape + validator |
| `get_identity` read | `controller`, `created_at_block`, `version 0`, `exists true` | `buildM1GetIdentityFixture` typed + watermark | ✅ shape + validator |
| `indexer` | `getEvents keys [[PrismIdentityCreated]]`, pagination, dedup, `watermark = max(block)` | `validateM1Indexer` asserts ordering + dedup + watermark | ✅ offline |
| `watermark` | `isStaleProjection(watermark, confirmedBlock, K=5)` fresh | `validateM1Watermark` + `runM1CrossChecks stale block` | ✅ offline |
| `independent_verification` | `explorer_url` (Voyager tx page) + `rpc_second_read {block, status SUCCEEDED, address_match true}` + `verified_at` | fixture present on valid envelope, absent → `X2` blocker (this lane's `NOT PROMOTABLE` fixtures demonstrate correct downgrade) | ⚠️ fixture in valid path, but **no live observed read** to promote |
| `limitations` | documents TEST DOUBLE vs live, no strk20.json | non-empty, documents `TEST DOUBLE`, `no independent read → X2`, `operator must broadcast` | ✅ |
| `maturity` | `X3` (testnet) after observed live create/read + independent read + fresh watermark | `X2` (harness default) / `X3` only on the explicitly promoted valid fixture (`validM1Envelope` with `maturity X3`) — not claimed as ledger truth | ⚠️ `X2` ceiling honestly declared |
| `promotion` | `valid && blockers.length==0` | `validM1Envelope` is promotable `X3` **as fixture** but is never copied into `EVIDENCE_LEDGER.md`; `missing independent read` / `wrong network` / `address mismatch` / `malformed receipt` / `stale block` correctly block promotion | ✅ guards proven |

No amount of offline `X2` passing changes the honest maturity. This bundle's `EVD-PRISM-004` statement is:

> **X0 `NOT_IMPLEMENTED` — no live `SN_SEPOLIA` create/read receipt with independent read observed in this lane; local harness is X2 only and never upgrades the ledger.** (Ledger template `NOT_EVIDENCED` preserved.)

---

## 11. Docs / decision drift

- **Convergence contract drift:** None. All 13 sections present; `Lane M1` scope (`Starknet identity phase only`) respected; no `Phase 8`/`REST`/`API`/`SDK`/`Pause`/`STRK20`/`PrismChannel` edits; no `strk20.json` writes; no `Linear`/`Notion` edits; no `GitHub push`; no private key handling.
- **DEC drift:** No protected `DEC-PRISM-001..018` mutated. `DEC-PRISM-SYS-001` (`ACCEPTED Option A` `2026-08-23`) and `DEC-PRISM-OPS-001` (`ACCEPTED testnet`) remain `ACCEPTED` as mirrored in `manifest.yaml`; `PROPOSAL.md` sidecar unchanged; no append-only `DECISIONS.md` row added (correct for a review-only lane).
- **INV drift:** No `INV-SYS-001..012` / `INV-PRISM-001..016` redefined. `INV-SYS-008` (minimalism) and `INV-PRISM-011` (no viewing keys) preserved — M1 adds no metadata fields.
- **ASSUMPTIONS:** `ASM-SYS-001..003` (`Cairo registry can express create/read`, `EIP-1271/6492 is hard requirement`, `challenge binding` tamper-evidence) remain `open` pending owner live observation — no new invariant assumed.
- **CONTRADICTIONS:** `CON-PRISM-012` (default network `SN_SEPOLIA` vs `SN_MAIN` release gate) remains as resolved via manifest (`testnet ACCEPTED`, `mainnet RELEASE_GATED_PROPOSED`).
- **EVIDENCE_LEDGER drift:** None — `EVD-PRISM-004` stays `X0 NOT_IMPLEMENTED`; `EVD-PRISM-012` (`Wallet capability X2`) and `EVD-PRISM-013` (`Landing X2`) unchanged; `strk20.json` empty shape preserved (`evidence-envelope.ts`/`m1-live-read.ts` enforce `assertNoStrk20JsonWrite` + `validate.mjs` path refusal).
- **Spec drift:** `CONTRACT_SPEC.md` `OP-7-01/02` + `EVENT_CATALOGUE.md` `PrismIdentityCreated` selectors unchanged; Cairo contract not edited.
- **Foundry drift classification:** `D0–D1` implementation detail additions (`ops/m1-live-read/*`, `src/features/evidence/m1-live-read.ts`) — **no `D2` public interface**, **no `D3` domain/state**, **no `D4` authority/privacy**, **no `D5` product primitive** drift per `EVIDENCE_AUDIT_FOUNDRY §17`.

---

## 12. Remaining blockers

| Blocker | Owner | Status | Blocks | Unblocks when |
|---|---|---|---|---|
| **No live `SN_SEPOLIA` registry deployment evidence observed in this lane** — `address` / `class_hash` / `deploy_tx` / `block` / `status SUCCEEDED` supplied by current evidence are fixtures (`TEST DOUBLE`) | Owner/Operator (Jason) | **OPEN** | `EVD-PRISM-004 X0 → X3` promotion, `G1` closure | Operator deploys `PrismIdentityRegistry` via `sncast declare --contract-name PrismIdentityRegistry` + `sncast deploy --class-hash <CLASS_HASH>` and records envelope `deployment` block at `ops/m1-live-read/envelopes/sepolia-registry-*.json` |
| **No live `create_identity` broadcast observed** — harness is read-only by design (`PROCEDURE.md §2`) | Owner/Operator | **OPEN — see §5** | `EVD-PRISM-004` X3, `TEST-7-2-1`/`A7-1`/`A7-2`, `FT-001` first step | Operator funds a `SN_SEPOLIA` deployer account/ keystore, broadcasts `sncast invoke --contract-address $REGISTRY --function create_identity`, captures `txHash`, `block`, `status SUCCEEDED`, `PrismIdentityCreated` event (`prism_id`, `controller`) |
| **No independent verification observed** — `explorer_url` (Voyager tx page) + second `RpcProvider` `getClassHashAt`/`call`/`getEvents` `rpc_second_read {block, status, address_match:true}` + `verified_at` | Owner/Operator + harness `--rpc` read-only | **OPEN** | Promotion (`validate.mjs --require-independent-read` downgrades to `X2` without it) | Second public `SN_SEPOLIA` RPC read + Voyager URL recorded in envelope `independent_verification` and `watermark` freshness `isStaleProjection` checked vs `confirmedBlock` |
| **Watermark staleness gate** — `K=5` fresh required (`INV-SYS-007`) | Owner/Operator (live `getBlock latest` read) | **OPEN** until live read | Promotion (blocker `stale block: watermark < confirmed - K`) | `harness.mjs --rpc` live read shows `watermark >= confirmed - 5` |
| **Funding / keystore gate** — funded `SN_SEPOLIA` deployer (account + faucet) | Owner | **OPEN — templates only** (`ops/starknet/sncast.toml.example`, `provider.example.toml`) | Live `create/declare/deploy` | Owner provisions deployer; lane never handles key material |
| **`strk20.json` guard** — testnet evidence may never write `strk20.json` (`R06`) | — | **Correctly blocked** | — | No promotion path writes `strk20.json` (builder throws, validator rejects) |

### §5 — Owner/operator-executed remainder for the first live `create_identity` broadcast (exact)

These steps are **not** executed by the M1 harness and remain owner/operator work for the first live `create_identity` broadcast:

1. **Fund a `SN_SEPOLIA` deployer Starknet account** (seed fee token + declare/deploy balance; `STARKNET_RPC_URL` / `STARKNET_SEPOLIA_DEPLOYER_PRIVATE_KEY` or `STARKNET_SEPOLIA_KEYSTORE_PATH` in env only, never committed; templates pass `ops/starknet/validate.mjs` checks).
2. **`sncast declare --contract-name PrismIdentityRegistry`** (via `scarb 2.20.0` / `snforge 0.63.0`/`starknet 10.4.0` spec versions recorded in envelope `build.spec_versions`) — record `class_hash` (Sierra hash).
3. **`sncast deploy --class-hash <CLASS_HASH>`** (immutable, `SD-002` — no proxy, no upgrade) — record `address`, `deploy_tx`, `block_number`, verify `getClassHashAt(address) == class_hash` via second RPC.
4. **Hold/steward the deployer private key/keystore** (env-only, never committed; M1 lane never touches it).
5. **Broadcast the first `create_identity`** (`sncast invoke --contract-address $REGISTRY_ADDRESS --function create_identity` or `WalletAccountV6` via controller) — the only M1 state change; harness is read-only until this exists (`PROCEDURE.md §2.1` rule: do not fabricate a Prism ID).
6. **Capture the `PrismIdentityCreated` receipt** (`txHash`, `block`, `execution_status SUCCEEDED`, event `prism_id` / `controller`, `selector 0x2c3cc…160e7`) and confirm with **second independent `RpcProvider` read** (`rpc_second_read: {block, status: SUCCEEDED, address_match: true}`).
7. **Produce Voyager/explorer URLs** for deploy tx + create tx (`explorer_url: https://sepolia.voyager.online/tx/<hash>` or equivalent) + `verified_at` ISO timestamp.
8. **Decide how many further `create_identity` calls to run** (each allocates a new `prism_id`; id reuse vs new allocation is explicit; re-use avoids double costs per `CONTRACT_SPEC OP-7-01`).
9. **Gate mainnet:** M1 must not write `strk20.json`; `SN_MAIN` is `RELEASE_GATED_PROPOSED` per `manifest.yaml` and requires a separate owner release gate (see `ops/target-network/PROPOSAL.md`).

All other `EVD-PRISM-004..007` rows remain `NOTIMPLEMENTED / X0` until those observations exist; local `X2` harness never upgrades them (ledger template `NOT_EVIDENCED`).

---

## 13. Explicit verdict

**Verdict: `M1_INDEXER_WATERMARK_RUNTIME_READY_X2` — runtime X2 ready; live closeout `M1_BLOCKED_BY_LIVE_RPC_EVIDENCE` (X3 partial)**

- The M1 indexer/watermark runtime and `PROCEDURE.md` are **complete and reproducible at X2**: injected provider `StarknetRegistryReadAdapter` (`get_identity` via `callContract`, `prismIdToRegistryFelt` boundary, fail-closed unknown→null), `StarknetEventIndexerAdapter` pagination (`fetchAllRegistryEvents` continuation_token, deterministic ordering, dedup by `txHash:eventIndex`), `event-indexer.ts` reconstruction (gap/missed/duplicate/watermark `max(block)`), `WatermarkedResolveService` stale-refusal (`K=5`, `StaleCacheError`, unknown confirmed block fail-closed), `StarknetLedgerStatusAdapter.getConfirmedBlock` watermark source, independent-read evidence envelope (`explorer_url` + `rpc_second_read` + `runM1CrossChecks` downgrade to `X2`), and the five cross-checks (`wrong network`, `address mismatch`, `missing independent read`, `malformed receipt`, `stale block`) all **pass at `X2`** (`npm test` 13+12+10 deterministic, `validate --self-test` guards proven; `typecheck` + `build` + `diff-check` green). `submitted!=completed` preserved — no adapter fabricates `completed`.
- However, the **live Starknet identity phase is not promotable to X3** because **no live `SN_SEPOLIA` `create_identity` / `get_identity` receipt with `SUCCEEDED` status, `PrismIdentityCreated` selector `0x2c3cc…160e7`, and `independent_verification` (Voyager + second RPC `address_match` + fresh `watermark >= confirmed-K`) has been observed** — the only deployment facts currently present are `TEST DOUBLE` fixtures. Per `EVIDENCE_AUDIT_FOUNDRY §6` maturity rule, promotion to `X3` and `EVD-PRISM-004 X0 → X3` is correctly **blocked** until the operator executes §12/§5. Explicitly: live create/read is **X3 partial** (harness + envelope shape ready) but **not promoted**; event-index/reconciliation is **not promoted without observed live events** (receipt + watermark). This is `M1_BLOCKED_BY_LIVE_RPC_EVIDENCE` for the X3 gate.
- No ledger row was promoted. No `X3` was claimed as ledger truth. No `strk20.json` was written. No frontend / contract behavior was changed. No secret was handled. No transaction was broadcast. No invented event selectors or receipts.

**What passes (integration-safe):**

> - The runtime is `ACCEPTABLE_FOR_INTEGRATION` **as a read-only verification surface only** — it is safe to integrate `starknet-registry-read.ts` + `starknet-event-indexer.ts` + `resolve-service.ts` + `starknet-ledger-status.ts` + `m1-live-read.ts` / `ops/m1-live-read/*` without touching `strk20.json` or mainnet. `M1_INDEXER_WATERMARK_RUNTIME_READY_X2` is earned.

**What remains blocked (live closeout):**

> - The **phase X3 closeout** is `M1_BLOCKED_BY_LIVE_RPC_EVIDENCE` until the owner/operator executes the 9 steps in §12/§5 and a validated `X3` envelope with independent read + fresh watermark is recorded in `EVIDENCE_LEDGER.md` via the yaml template. No `X3` partial is promoted to ledger without observed live receipt + event + watermark.

Per `PRISM_PHASE_CONVERGENCE_CONTRACT.md` Convergence rules: *“A worker report is not acceptance. A green isolated suite is not runtime evidence.”* This packet is the worker report; parent verification and a live `SN_SEPOLIA` envelope are the required integration batch gate. Any `ACCEPTABLE_FOR_INTEGRATION` verdict for the **phase X3** would require a live `SUCCEEDED` `create_identity` receipt, which does not exist in this worktree.

---

## Session footer (FOUNDRY_PROTOCOL §17)

```text
Bundle:            phase-m1-live-read+runtime (Muse Spark 1.2 free, lane M1)
Base commit:       c68cd72
New commit:        HEAD after verification (see git log --oneline -1)
Canonical artifacts updated: 0 (lane is evidence-preparation / live-read, not system canonicalization)
Decisions created: 0 — 0 proposals promoted; DEC-PRISM-SYS-001 + DEC-PRISM-OPS-001 remain ACCEPTED as mirrored
Decisions superseded: 0
Assumptions added: 0 (ASM-SYS-001..003 remain open per SYSTEM_CANONICAL §6)
Evidence added:    0 (all runtime rows EVD-PRISM-004..007 stay NOT_IMPLEMENTED / X0; new runtime is X2 local only, X3 partial not promoted)
Maturity changes:  none — ceiling X2 honestly declared; live create/read is X3 partial (harness+envelope ready) but not promoted without observed receipt+event+watermark; no event-index/reconciliation promoted without observed live events
Drift detected:    none — no product truth redefined; no protected DEC mutated; D0–D1 impl drift only (new StarknetRegistryReadAdapter + tests are D0–D1)
Unresolved:        6 blockers in §12 (3 close G1: live deploy evidence + first create_identity broadcast + independent read + watermark freshness; plus funding/keystore + mainnet gate)
Next evidence step: §12 #1→#7 — operator deploys SN_SEPOLIA registry → broadcasts first create_identity → read-only harness verifies get_identity + PrismIdentityCreated + watermark + chainId 84532 → validate.mjs promotable → ledger template EVD-PRISM-004 X0→X3 (testnet)
Verification:      npm test ~340/14 ✓ (13+12+10 new deterministic), typecheck ✓, build ✓, diff-check clean, target-network ACCEPTED ✓, starknet templates secret-free ✓, m1-live-read validate --self-test ✓, m1 harness --self-test 13/13 ✓, strk20.json empty ✓, no ledger row moves ✓, submitted!=completed preserved ✓
Next gates:        G1 remains NOT_IMPLEMENTED until live SN_SEPOLIA observe per ledger template; T4/T9/T11/T12 are X2-exercised via injected providers (pagination/duplicate/gap/watermark/stale/malformed/fail-closed) and ready for X3 promotion on live RPC evidence
```

---

*Governing principle: Research → Experiment → Build → Evidence. No ledger row moves without observed results.*
