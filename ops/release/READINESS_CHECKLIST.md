# Release Readiness Checklist — Prism Bundle 3T (Pre-Deployment Gate)

**Purpose:** Explicit hard gate before any Starknet/Base deployment or evidence promotion.  
**Authority:** `SYSTEM_FOUNDRY.md`, `CONTRACT_SPEC.md`, `AUTHORITY_MATRIX.md`, `RESEARCH_BACKEND_GATE.md`, `AUDIT.md §13`, `EVIDENCE_LEDGER.md`, `CHAINID_V2_DECISION_PACKET.md:SD-008`, `DECISIONS.md`, `TEST_ARCHITECTURE.md`, Notion SC-04/05/06/10/21 (proposed).  
**Maturity:** This checklist is **X2 preparatory** — it does not claim `X3+` evidence until independent reads exist.  
**Scope:** No deployment is executed by this checklist; it only records blockers and owner gates.

---

## 0. Invariant: PROPOSED ≠ ACCEPTED

```text
PROPOSED + UNDECIDED => deployment MUST be refused
ACCEPTED + mirrored append-only DECISIONS.md records => testnet path may proceed
```

Current state:

```text
DEC-PRISM-SYS-003: ACCEPTED (chainId-v2)
DEC-PRISM-OPS-001: ACCEPTED (testnet = SN_SEPOLIA + Base Sepolia 84532)
SN_MAIN: RELEASE_GATED_PROPOSED
```

Acceptance removes only the owner-decision blocker. Dry-run, funded-account,
account deployment, live receipts, independent reads, and evidence promotion
remain separate gates.

---

## 1. ChainId Decision Gate — SD-008 / DEC-PRISM-SYS-003

| Check | Required | Current | Blocks |
|---|---|---|---|
| `DEC-PRISM-SYS-003` (chainId-v2) recorded append-only in `projects/prism/DECISIONS.md` with `ACCEPT` or `REJECT` + companion `disposition_chainId_v2` | Owner Jason | **ACCEPTED** (`e612c4a`) | No longer blocks policy wiring; live evidence still required |
| If `ACCEPT`: `system/STACK_DECISIONS.md:SD-005` envelope adds `chain_id` as first ordered field, `system/INVARIANTS.md:INV-SYS-011` adds `chain_id` to tamper-evidence, `OBJ-PRISM-005` persisted_fields amended, `CHALLENGE_SCHEMA_VERSION=2` | Implements `e8886af` as fast-forward | **ACCEPTED / X2 local** | Live cross-network fixture remains required for X3 |
| If `REJECT`: rejection rationale + residual-risk owner + revisit trigger recorded | same DEC | — | Window stays open, explicitly documented |
| Harness asserts `chainId target mismatch → ERR-012 altered_fields:chain_id` | `src/features/evidence/__tests__/envelope-and-gates.test.ts` | **PASS (offline)** | — |
| Envelope `inputs.chainId` vs `target_manifest.chain_id` mismatch is a promotion blocker | `src/features/evidence/evidence-envelope.ts:validate` | **ENFORCED** | Wrong-network proof cannot be promoted |

**Gate result:** `PASS — OWNER DECISION CLOSED`; companion spec, funded-account, deployment, and evidence gates remain separate.

---

## 2. Target-Network Decision Gate — SD-006 / DEC-PRISM-OPS-001 / CON-PRISM-012

| Check | Required | Current | Blocks |
|---|---|---|---|
| Default environment accepted: `SN_SEPOLIA + Base Sepolia (84532)` | `ops/target-network/manifest.yaml:environments.testnet` `ACCEPTED` | **ACCEPTED** | Live deployment/evidence still gated |
| Release-gated proposal recorded: `SN_MAIN + Base Mainnet (8453, pool 0x0403…812a)` | `ops/target-network/manifest.yaml:environments.mainnet` `RELEASE_GATED_PROPOSED` | **RELEASE-GATED** | `SN_MAIN` evidence, G0, final hashes (`ok=pool=mine`) |
| `owner_decision.status == ACCEPTED` with `decision_id=DEC-PRISM-OPS-001`, `decided_by=Jason`, `selected_environment`, `disposition_chainId_v2`, `signature` mirroring `DECISIONS.md` append-only | Owner Jason | **ACCEPTED** | Does not itself deploy |
| `node ops/target-network/validate.mjs` validates the accepted mirror | Offline static validator | **PASS — accepted mirror verified** | Invalid mirror must block |
| `strk20.json` never written from testnet logic | `ops/evidence/validate.mjs` + envelope builder | **ENFORCED (empty `{transactions:[], contracts:[]}`)`** | Hub `mine` check per `INV-PRISM-016` belongs to Phase 5 helper |

**Gate result:** `PASS — OWNER DECISION CLOSED`; funded accounts, deployment, live receipts, and independent reads remain open.

---

## 3. Funded Accounts Gate — G8 Hygiene

| Check | Required | Current | Blocks |
|---|---|---|---|
| Secret-free templates pass `node ops/starknet/validate.mjs` | No `0x` 64-hex secret, no hard-coded `alchemy.com/v2/<key>`, every profile references `*_RPC_URL` env var, no active `sncast.toml` committed | **PASS** | Deployment |
| Env contract outside repo: `STARKNET_RPC_URL` / `BASE_RPC_URL` (selected by `PRISM_TARGET_ENV`), `BASE_CHAIN_ID=84532` (testnet) declared in `ops/target-network/manifest.yaml` + `ops/starknet/provider.example.toml` | Shell / `.env` excluded by `.gitignore` | **NOT_PROVIDED (expected offline)** | Live `sncast declare/deploy`, `get_identity` second read |
| Funded SN_SEPOLIA deployer account + faucet plan (address/keystore referenced by env var, never committed) | `ops/starknet/accounts.json.example` + `sncast.toml.example` | **FUNDED — 3005 STRK read back; account not deployed** | Account deployment / registry declare/deploy |
| Funded Base Sepolia EOA for ladder fixtures (EOA → 1271 → 6492) | E2E procedure `DECISIVE_SEQUENCE_PROCEDURE.md §2` | **OPEN — EOA created but not funded** | Real Base proof against live RPC |
| Dry-run deployment command check passes without RPC: `sncast declare --dry-run` syntax validated via `node ops/starknet/dry-run-check.mjs` (offline) | New in Bundle 3T Deploy | **PASS when --dry-run present** | Prevents accidental live broadcast |
| `.env.example` stays placeholder (`YOUR_ALCHEMY_KEY`), `.gitignore` excludes `.env`, `snfoundry.toml` has only commented placeholder profiles | Verified by validator | **PASS** | Secret leak |

**Gate result:** `PARTIAL` — Starknet deployer funded; Base EOA funding and RPC/account deployment remain open.

---

## 4. Independent-Reads Gate — Evidence Maturity

| Check | Required | Current | Blocks |
|---|---|---|---|
| Envelope includes `deployment`: `network SN_SEPOLIA/SN_MAIN`, `address Hex`, `class_hash Hex`, `deploy_tx Hex`, `block_number finite>0`, `status SUCCEEDED` | `src/features/evidence/evidence-envelope.ts` builder | **ENFORCED — missing → blocker** | Promotion to X3+ |
| Envelope includes `transactions[].block` present, `status SUCCEEDED` only, `hash Hex` | Same validator | **ENFORCED — null/UNKNOWN/REVERTED → blocker** | Indexing/reconciliation |
| Envelope includes `independent_verification`: `explorer_url` OR `rpc_second_read {block,status,address_match}` + `verified_at` | `validateEvidenceEnvelope` | **ENFORCED — absent → blocker, downgrade to X2** | Ledger promotion (`EVD-PRISM-004..007` X0→X3) |
| Envelope includes `limitations: string[]` non-empty (what is NOT evidenced) | Same validator | **ENFORCED — empty → error+blocker, X0** | Audit truthfulness (`RESEARCH_BACKEND_GATE §7`) |
| Envelope includes `build: {commit_sha, spec_versions:{scarb,snforge,starknet,…}}` | Same validator | **ENFORCED — missing → error** | Build traceability |
| Deterministic `canonicalStringify` + `envelopeHash` stable | Same module | **ENFORCED (tests: deterministic)`** | Audit correlation |
| No envelope path may be `strk20.json`; no procedure may contain `write strk20.json` without `do not write` wording | `assertNoStrk20JsonWrite` + validator | **ENFORCED (throws/blocks)** | `G8` / `INV-PRISM-016` / `G7` hub `ok=pool=mine` |
| `node ops/evidence/validate.mjs --self-test` passes: valid fixture promotable, missing-field blocked, `strk20.json` write blocked | Offline validator | **PASS** | — |
| Live independent re-read (second RPC + Voyager explorer URL) recorded per deploy/tx before `EVIDENCE_LEDGER.md` update | Procedure `DECISIVE_SEQUENCE_PROCEDURE.md §2` | **NOT_EVIDENCED (offline)** | Ledger rows `EVD-PRISM-004..007` remain `NOT_IMPLEMENTED / X0` |

**Gate result:** `FAIL` — offline fixtures are `X2` with `NOT PROMOTABLE` (independent read absent by design); live read is provider-dependent.

---

## 5. Decisive-Sequence Readiness Gate — FT-001 / SC-04/05/06/10/21 / T9/T11/T12

| Required fixture (offline, TEST DOUBLE labeled, X2 ceiling) | Test | System artifact | Gate |
|---|---|---|---|
| success tail: `create P → read P → Base proof EOA → controller bind (submitted≠completed) → resolve=B (ACTIVE) → revoke → resolve=NO_ACTIVE_DESTINATION → P persists` | `src/features/evidence/__tests__/decisive-sequence.test.ts` + harness `src/features/evidence/decisive-sequence-harness.ts` | `CANONICAL_STATE §10`, `SM-PRISM-002`, `OP-8-01/02`, `ERR-004/007`, `INV-SYS-002/003/004/006/007` | SC-04/05/06 |
| wrong signer: unrelated Base signer cannot bind another account → `ERR-004` | same harness (`wrong signer`) + `src/application/__tests__/app-boundary.test.ts` | `INV-SYS-002`, `FT-002` | SC-10 sibling |
| replay: expired/consumed nonce/digest fails → `ERR-006 / ERR-007`, never double-consumed | same harness (`replay nonce/digest`) + `app-boundary.test.ts` | `INV-SYS-004/010`, `FT-003` | SC-10/11 |
| revoke: resolver never returns revoked binding as active; idempotent second revoke is benign `ERR-011` | same harness (`revoke`) + `resolve-service.test.ts` | `INV-SYS-006/007`, `FT-004` | SC-05 |
| stale/dependency: `isStaleProjection(watermark, confirmedBlock, K)` / `WatermarkedResolveService` refuses stale ACTIVE, `observeChain throws → dependencyFailure:true` fail-closed, no state change | same harness (`stale` / `dependency`) + `poll-worker-divergence.test.ts`, `resolve-service.test.ts` | `AUTHORITY_MATRIX §4`, `STATE_MACHINES.md:SM-PRISM-003`, `INV-SYS-005/007` | SC-04/06 |
| retry/recovery: `failed_retryable → retry to submitted`, `recoverNonTerminalOperations` sweep resumes from durable `txHash+version`, `computedBackoffMs` bounds, `requires_attention` escalation | same harness (`retry/recovery`) + `reconciliation-worker.test.ts`, `poll-worker-divergence.test.ts` | `SM-PRISM-003`, `T12` | SC-06/21 |
| chainId hardening: `base.chain_id` mismatch → `ERR-012 altered_fields:chain_id` | `envelope-and-gates.test.ts: chainId` | `SD-008`, `INV-SYS-011` | SC-21 |
| `submitted ≠ completed` at every chain-touching step | `decisive-sequence-harness.ts` + `app-boundary.test.ts: INV-SYS-005` | `INV-SYS-005 / INV-PRISM-015`, `SM-PRISM-003` | SC-06 |
| No `strk20.json` writes via harness | Builder guard + `envelope-and-gates.test.ts:cannot write strk20.json` | `G8`, `EVIDENCE_LEDGER Mainnet Receipt Rule` | SC-21 |

**Offline result (this bundle):** `X2 — fixture, TEST DOUBLE, NOT PROMOTABLE` (missing `independent_verification`). Live variant (next packet, owner-approved V8.5) replaces InMemory ports with real `RpcProvider` + funded wallets, records per-step envelopes with `deployment+transactions+independent reads`, promotes to `X3` (testnet).

---

## 6. Aggregate Verdict (this bundle)

```
chainId decision (DEC-PRISM-SYS-003) ....... ACCEPTED — testnet/mainnet binding recorded
target-network decision (DEC-PRISM-OPS-001) ACCEPTED for testnet; mainnet release-gated
funded accounts ........................... PARTIAL — testnet funding only; mainnet not provided
independent reads ......................... BLOCKED — offline fixtures X2 only
decisive-sequence harness ................. PASS — offline fixtures green at X2, 8+ cases exercised
static validators ......................... PASS — target-network ✓, starknet templates ✓, evidence guards ✓
suite ..................................... PASS — npm test ~251 passed | 14 skipped; typecheck ✓; build ✓
deployment ................................ NOT_EXECUTED — no RPC, no sncast broadcast, no strk20.json writes
```

**Overall:** `PASS_WITH_LIMITATIONS — LOCAL BUILD EVIDENCE EARNED, RUNTIME/MAINNET EVIDENCE OPEN` (`AUDIT.md §18` verdict preserved).  
`EVD-PRISM-004..007` remain `NOT_IMPLEMENTED / X0`; G0/G1/G2/G3 remain `NOT_IMPLEMENTED` until live `V7.5/V8.5` observes per ledger template.  
No frontend, contract behavior, `strk20.json`, Linear/Notion, credentials, or push was touched.

---

## 7. How to close each gate (owner/operator steps)

1. **Confirm the accepted testnet decision remains mirrored:** `DEC-PRISM-SYS-003` and `DEC-PRISM-OPS-001` are already recorded and validated; no new decision is needed for this preparation step.
2. **Select the exact mainnet scope:** obtain an append-only owner decision for `SN_MAIN + Base Mainnet`, explicitly naming Core v1 and its required contract identities. This remains open.
3. **Close the funding gate:** provision funded mainnet signers outside the repo (`STARKNET_RPC_URL`, `BASE_RPC_URL`, and protected signer references), then independently read funding receipts. Never place secret values in the packet or repository.
4. **Close the deployment gate:** run live `sncast declare/deploy` with `--dry-run` first, then only after explicit broadcast authorization. Capture network, address, class hash, transaction, block, status, and constructor data in the evidence envelope, never `strk20.json`.
5. **Close the independent-read gate:** perform a second RPC/explorer read for every deployment and operation, then run `node ops/evidence/validate.mjs <envelope.json> --require-independent-read`.
6. **Close the Core v1 operation gate:** run the live identity and Base bind/resolve/revoke sequence with real providers, receipts, recovery behavior, and independent reads. STRK20 remains a visible but separately gated future expansion.

Each step re-runs `npm test && npm run typecheck && npm run build && node ops/*/validate.mjs` before any commit.

---

## 8. Mainnet release gate — fail closed

`MAINNET_READY` is a statement about observed SN_MAIN evidence, not a planned
configuration. Run the offline validator against an operator-produced,
secret-free JSON packet:

```bash
node ops/release/validate-mainnet.mjs --self-test
node ops/release/validate-mainnet.mjs /path/to/mainnet-release-packet.json
```

The packet is rejected unless it contains **exact** (non-placeholder) values
for all of the following:

- `release_status: MAINNET_READY`, `environment: SN_MAIN`, Base chain ID `8453`,
  and an `owner_decision` with accepted status, decision ID, owner, timestamp,
  and signature/reference;
- `release_track: core_v1` or `release_track: strk20_submission`, selected
  explicitly rather than inferred from the presence of optional fields;
- `required_contract_identities`, an explicit list matching the accepted release
  scope. The current Core v1 proposal requires `PrismIdentityRegistry` only;
  deferred Vesu, LayerZero, and Channel tracks must not be silently included;
- `mainnet_figures`: SN_MAIN, Base `8453`, canonical pool address, pool-event
  transaction/block, exactly three final submission transaction hashes, and an
  independently observed `hub_validator` of `ok=true`, `pool=true`, `mine=true`;
- every required contract's address, class hash, deployment block,
  constructor calldata, accepted deployment receipt, and independent provider
  read proving address/class-hash match;
- observed wallet and prover providers, wallet address, proof identifier,
  receipt transaction hash, and verification timestamp.

Missing figures, inferred addresses, absent receipts, a single-provider result,
missing wallet/prover evidence, or an unaccepted owner decision leaves the
result `NOT MAINNET_READY`. The validator never writes `strk20.json` or any
ledger. It is intentionally offline; operator evidence remains subject to
independent review and the LayerZero bilateral blocker remains unchanged.

## 9. External gates still open

This repository contains no mainnet figures or receipts. Remaining gates are
owner acceptance of the mainnet release/manifest, frozen contract set and
configuration, funded signer/wallet evidence, SN_MAIN deployments and
independent reads, the three final submissions plus upstream validator
readback, and the LayerZero/provider gates applicable to the selected release
scope. The optional M5 Vesu lending experiment is not a prerequisite for
Prism's core identity, private-transfer, or governed-request product path.
Testnet ledger rows and `evidence/lz-support-blocker-2026-08-30.md` are not
modified by this tooling.

---

## 10. Exact readiness matrix (this baseline)

| Gate | Required evidence | Current | Ceiling |
|---|---|---|---|
| Software / validator | strict packet fields, exact 32-byte values, three distinct hashes, environment contract, self-test | **PASS** | X2 tooling |
| Owner decision | accepted mainnet decision mirrored in packet and decision ledger | **OPEN** | not promotable |
| Signer / funding | protected references plus independently read funding receipts for Starknet, Base, wallet, prover | **OPEN** | not promotable |
| Contract figures | exact address/class hash/block/calldata for every required contract | **OPEN (null in manifest)** | not promotable |
| Deployment receipts | accepted receipt for every contract and final operation | **OPEN** | not promotable |
| Independent reads | second provider/explorer read for every receipt and contract identity | **OPEN** | not promotable |
| Core privacy route | wallet authorization, private transfer, consented private-state readback | **OPEN / external** | not promotable |
| Optional M5 Vesu composition | only if private lending is included in the release scope: pool/helper action, note readback, conservation | **OPTIONAL / OPEN** | does not gate core Prism |
| Final submissions | exactly three **distinct** SN_MAIN hashes; each `ok=true,pool=true,mine=true` | **OPEN** | not promotable |
| Artifact safety | no deployment/broadcast, no secrets, no `strk20.json` mutation | **PASS** | — |
| **Overall** | all rows above plus authorized deployment | **NOT MAINNET_READY** | X2 preparation |

The validator is intentionally stricter than the documentation: shortened display hashes,
reused submission hashes, missing independent reads, missing wallet/prover receipts, or a
missing environment contract fail closed. No figure is supplied here; the first valid
packet may substitute only independently observed values.

## 11. External gates still required

1. Owner accepts and mirrors the mainnet release decision and exact scope.
2. Operator supplies protected signer/funding references and independently reads public funding receipts.
3. Operator freezes the contract set, ABI/schema/compiler versions, and exact mainnet figures.
4. Authorized operator performs dry-run then live SN_MAIN/Base Mainnet deployment; no broadcast is authorized by this repository change.
5. Independent providers re-read every deployment/operation receipt, address, class hash, block, and status.
6. Wallet/prover provider completes the selected core privacy route, including accepted private-transfer evidence and independent readback; optional M5 Vesu evidence is required only if private lending is part of the approved release scope.
7. Three distinct final submissions pass current hub validation (`ok`, `pool`, `mine`) and are independently rechecked.
8. Audit/owner review promotes only the matching evidence-ledger rows; `strk20.json` remains untouched until separately authorized.
9. Optional M5 Vesu and LayerZero gates close independently when those capabilities are included in the approved release scope; this packet does not waive them.

*Governing principle: Research → Experiment → Build → Evidence. No ledger row moves without observed results.*
