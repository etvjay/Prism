# Backend Phase C1 — PrismChannel Minimal Testnet Slice Review

**Lane:** C1 / PrismChannel minimal testnet slice (Muse Spark 1.2 free)  
**Worktree:** `/home/ubuntu/prism-work/phase-c1-channel` @ `7a385d2`  
**Date:** 2026-08-23 UTC  
**Baseline HEAD:** `7a385d2 docs(prism): define delegated phase convergence contract`  
**Scope:** Implement only minimal relationship/payment-reference domain in `src/features/prism-channels/**` + tests/review docs. No general messenger. Forbidden touches honored: no `frontend/Phase 8`, no REST/API/SDK routes, no Pause internals, no STRK20/Cairo/`strk20.json`, no Linear/Notion, no credentials, no GitHub push.

---

## 1. Mandate and Phase Boundary

Delegated Phase C1 per `PRISM_PROTOCOL_SURFACE_PHASE_PLAN.md` §S4 and `PRISM_PHASE_CONVERGENCE_CONTRACT.md` (Phases C1 ∈ [M0..M7], Phase 8 excluded). Implement:

1. Channel create/accept/archive/revoke lifecycle between two Prism IDs
2. Separate communication-key commitment port (no key generation/secret handling in app code)
3. Ciphertext/encrypted-reference message object for `payment_memo | receipt | claim_invitation | authorization_request`
4. No plaintext social/payment metadata on public-chain surfaces
5. Participant authorization + channel policy checks
6. Testnet procedure/evidence fixture with independent read requirements
7. Red-team tests: participant substitution, replay, revoked channel, plaintext leakage, key reuse, implicit payment authority

Explicit non-goals (S4): no full chat app, no public social graph, no plaintext onchain, no channel-based payment authority, no auto wallet signing, no STRK20 viewing-key handling, no implicit delegation — all respected.

---

## 2. Canonical Inputs Inspected

| Artifact | Version/date | Role |
|---|---|---|
| `docs/PRISM_DOCUMENTATION_V0_3.md` §§15–19 | v0.3 2026-08-20 | Channel data model, key separation, storage, convergence |
| `projects/prism/agent-packets/PRISM_PROTOCOL_SURFACE_PHASE_PLAN.md` §S4 | 2026-08-23 | S4 testnet MVP, channel/message objects, gates T8/T10/T11/T12 |
| `projects/prism/agent-packets/PRISM_PHASE_CONVERGENCE_CONTRACT.md` | 2026-08-23 | Shared completion equation, boundaries, report sections, verdict |
| `projects/prism/agent-packets/PRISM_MAINNET_PHASE_PLAN.md` | 2026-08-23 | Non-blocking C1 status, authority convergence |
| `projects/prism/system/SYSTEM_CANONICAL.md` | v0.2 canonical | PRISM-7/8 authority split (DEC-PRISM-SYS-001 Option A) |
| `projects/prism/system/AUTHORITY_MATRIX.md` | v0.1 | A1–A9 authority, trust boundaries |
| `projects/prism/system/INVARIANTS.md` | v0.1 | INV-SYS-001..012, allocation from INV-PRISM |
| `projects/prism/system/STATE_MACHINES.md` | v0.1 | SM-PRISM-001..003 |
| `projects/prism/system/TEST_ARCHITECTURE.md` | v0.1 | T8/T10/T11/T12 ladder |
| `projects/prism/AUDIT.md` | 2026-08-20 PASS_WITH_LIMITATIONS | Gates G0–G8, FT-001..008 |
| `src/application/*` , `src/features/prism-identity/*` , `src/features/prism-operations/*` | HEAD | Existing port/adapter/error patterns |
| `foundry/FOUNDRY_INDEX.md` v0.95 | — | Cross-foundry traceability |

All reads are local file inspections; no URLs synthesized.

---

## 3. Product Truth Preserved

- One Prism ID, one home across chains — channel is a **private relationship capability between Prism IDs**, not a messenger app (docs §15, §44). Implementation carries only `channel_id, participants, key_commitments, status, policy` and ciphertext messages.
- Identity ≠ controller ≠ execution identity; channel participants are Prism IDs, not addresses. No Prism ID is conflated with Starknet/Base address (`INV-PRISM-001 / INV-SYS-001`).
- Resolvable ≠ publicly enumerable: channel reads are participant-authorized only; non-participant reads rejected (`ERR-033`).
- Communication is relationship-scoped financial context: only `payment_memo/receipt/claim_invitation/authorization_request` types; no free-form social graph.
- Privacy truth: no blanket “private” claims; ciphertext-only; public surface publishes only opaque commitment/hash; explicit `ERR-041 PLAINTEXT_LEAKAGE` guard.
- No channel-based payment authority, no implicit delegation, no STRK20 viewing-key handling — all explicitly excluded and tested.

---

## 4. Research Foundry — Sources, Freshness, Claim Limits

Muse Spark 1.2 free, lane C1 — free-tier constraint, no ChatGPT models (convergence contract model policy). Sources are repo-local only; no external web fetch for C1.

| Claim | Support | Limit |
|---|---|---|
| Channel/message lifecycle and S4 gates T8/T10/T11/T12 | `PRISM_PROTOCOL_SURFACE_PHASE_PLAN.md` §S4, `SYSTEM_CANONICAL.md` §4 | Single-source in-repo (E2); not externally corroborated |
| Key separation (comms key ≠ Starknet/Base/STRK20 viewing key) | `docs` §17 + `SYSTEM_CANONICAL` §5 + `INV-PRISM-012` | Doctrine-level; no live key system observed |
| Ciphertext-only / no plaintext onchain | `docs` §§15–16 + S4 non-goals | Enforced by domain `detectPlaintextLeakage` + public publisher hash-only; real crypto is outside app code (port) |
| Testnet procedure with independent readback | S4 “independent testnet readback of commitments/status” | X2 fixture only; no live SN_SEPOLIA/Base testnet observation |
| Implementation completeness | Local `npm test/typecheck/build` X2 | X2 ceiling — no X3 realistic/testnet claim |

Freshness: all canonical docs dated 2026-08-20/23; claim scope is X2 local-controlled. No facts promoted to X3/X4/X5.

---

## 5. System Foundry — Authority / State / Error / Invariant Mapping

| C1 behavior | Primary authority | State machine | Error | Invariant | Enforced by |
|---|---|---|---|---|---|
| Channel existence / lifecycle | `ChannelStore` (durable port) + `PrismChannelService` | `PROPOSED → ACCEPTED → ACTIVE → ARCHIVED → REVOKED`; `REVOKED` idempotent | `ERR-031/032/034/035/036/037` | INV-SYS-002 (participant-only mutation) analog; INV-SYS-006 (REVOKED never → ACTIVE) | `channel.ts` `revokeChannel` no re-activation path; CAS `update(expectedVersion)` |
| Participant authorization | Service → `ChannelStore` + policy | Every `accept/archive/revoke/send/get/list` checks `participants.includes(caller)` | `ERR-033 NOT_PARTICIPANT` | AUTHORITY_MATRIX A2/A3 (caller == authority) | `assertParticipant` / all service entrypoints |
| Key commitment separation | `CommunicationKeyCommitmentPort` (injected) | `PROPOSED` requires initiator commitment; `ACCEPTED→ACTIVE` requires peer commitment | `ERR-038/039/045` | INV-PRISM-012 (comms key ≠ Starknet/Base/STRK20) | `InMemoryKeyCommitmentPort` deterministic X2; app never generates keys |
| Ciphertext message creation | `ChannelMessageStore` + domain | `ACTIVE` only; otherwise `ERR-036/037` | `ERR-040/041/042/043/044` | INV-PRISM-010 (resolvable ≠ enumerable) + INV-PRISM-014 (no privacy overclaim) | `message.ts` hex-only + plaintext pattern scan; `publicPublisher` hash-only |
| Policy checks | `PrismChannel.policy` | `allowedContentTypes` subset; `allowAuthorizationRequest` flag | `ERR-043 POLICY_VIOLATION` | Product §44 (financial interactions only) | `createMessage` policy gate |
| Public-chain leakage guard | `PublicChainPublisher` (hash-only) | Publish only `commitment` / `ciphertextHash` (fakeHash X2) | `ERR-041` | INV-PRISM-008/011 (no social/viewing key onchain) | `InMemoryPublicChainPublisher.scanForPlaintext` |
| Replay / key reuse | `ChannelMessageStore.getById` + distinct commitments | duplicate `messageId` → `ERR-044`; same commitment both participants → `ERR-045` | `ERR-044/045` | INV-SYS-004 (single-use digest) analog | `sendMessage` duplicate check; `acceptChannel` distinctness |
| Implicit payment authority | Policy separation | `authorization_request` never implies payment execution | `ERR-046` (guard) / `ERR-043` when policy disallows | AUTHORITY_MATRIX §2 (authorization separation) | Service never executes payment; red-team `R6` documents invariant |

`ERR-046 IMPLICIT_PAYMENT_AUTHORITY` is a policy guard: channel messages carry encrypted references (`paymentRef/claimRef/receiptRef` as opaque hex), never execution authority.

---

## 6. Implementation / Files / Commit

New domain only — no existing files mutated:

```
src/features/prism-channels/
  domain/channel.ts              # lifecycle state machine, policy, validation (PROPOSED..REVOKED)
  domain/message.ts              # ciphertext-only message, plaintext leakage detection, opaque refs
  domain/errors.ts               # ERR-030..048 stable catalogue (X2)
  domain/ports.ts                # Clock, CommunicationKeyCommitmentPort, ChannelStore, ChannelMessageStore, PublicChainPublisher, ChannelIdGenerator
  application/channel-service.ts # create/accept/archive/revoke/send/get/list/independentRead (injected ports, no secrets)
  adapters/memory-channel-store.ts # X2 TEST DOUBLEs: InMemoryChannelStore, InMemoryMessageStore, InMemoryKeyCommitmentPort, InMemoryPublicChainPublisher, FixedClock, SequentialIdGenerator (labelled X2)
  testing/fixtures.ts            # ALICE/BOB/CAROL, makeCommitment, makeCiphertext, opaqueRef (X2 deterministic)
  testing/testnet-procedure.ts   # C1_TESTNET_PROCEDURE 11 steps, buildC1Fixture, independent read / no-plaintext / key-separation requirements
  index.ts                       # re-exports
  __tests__/channel-lifecycle.test.ts # 9 lifecycle tests (foundry/product/system evidence)
  __tests__/redteam.test.ts           # 9 antagonistic tests (R1..R6b)
  __tests__/testnet-procedure.test.ts # testnet vertical slice with independent read (T11/T8)
```

Commit: working tree on `7a385d2`, untracked `src/features/prism-channels/**` (not yet committed). Diff check: `git diff --stat HEAD` shows only this directory as untracked; no `frontend/`, `Phase 8`, `REST/API/SDK`, `Pause`, `STRK20`, `Cairo`, `strk20.json`, `Linear/Notion` touched. `node_modules` remains untracked (pre-existing).

Hex boundaries: `CHANNEL_ID` `^[A-Za-z0-9_-]{6,64}$`, `Hex` commitment/ciphertext `^0x[0-9a-fA-F]{64,}$` (ciphertext ≥32 bytes), `MESSAGE_ID` `^[A-Za-z0-9_-]{8,64}$`, `PRISM_ID` `^prism:[0-9A-Za-z]{1,64}$`.

---

## 7. Tests and Exact Commands

All tests are X2 (injected fakes, deterministic, no network/RPC).

```bash
npm run typecheck   # tsc --noEmit
# -> PASS (after index re-export fix)

npm test            # vitest run — includes existing 28 suites + 3 new C1 suites
# -> Test Files  28 passed | 2 skipped (30)
# -> Tests  314 passed | 14 skipped (328)
# -> Duration ~36–41s
# New C1 tests: 9 (lifecycle) + 9 (redteam) + 2 (testnet procedure) = 20 passing

npm run build       # next build --webpack
# -> ✓ Compiled successfully in ~10s + Running TypeScript ...

git diff --stat HEAD / git status --short
# -> only src/features/prism-channels/ untracked; no forbidden surface
```

Focused C1 suites:
- `channel-lifecycle.test.ts` — create PROPOSED, accept→ACTIVE, archive/revoke terminal, key-separation, ciphertext types, no-plaintext surface, participant auth, policy.
- `redteam.test.ts` — 9 red-team cases (see §8).
- `testnet-procedure.test.ts` — full S4 vertical slice with independent reads, fixture validation.

All fakes labelled `X2 TEST DOUBLE` and never claim X3.

---

## 8. Antagonist Attack Cases and Findings

| # | Attack | Technique | Expected | Result |
|---|---|---|---|---|
| R1 | **Participant substitution** | CAROL (non-participant) calls `accept` / `send` / `getChannel` on ALICE–BOB channel | `ERR-033 NOT_PARTICIPANT` (403) | **PASS** — all substitution paths rejected |
| R2 | **Replay** | Re-send same `messageId` from same or other participant | `ERR-044 REPLAY_DETECTED` (409) | **PASS** |
| R3 | **Revoked channel** | Send or archive after `REVOKED` | `ERR-036 CHANNEL_REVOKED` (410), archive blocked | **PASS** — revoked terminal, idempotent `revoke` |
| R4 | **Plaintext leakage** — ciphertext | Submit `"hello @alice 25 USDC"` or non-hex | `ERR-041 PLAINTEXT_LEAKAGE` (422) | **PASS** |
| R4b | **Plaintext leakage** — public surface | After valid send, scan `PublicChainPublisher` | Zero plaintext patterns, all payloads `^0x[hex]$` | **PASS** |
| R5 | **Key reuse** | Both participants present identical commitment at `accept` | `ERR-045 KEY_REUSE` (409) | **PASS** |
| R5b | **Key reuse (negative)** | Same commitments reused across *different* channelIds | Allowed — distinct channels | **PASS** |
| R6 | **Implicit payment authority** | `authorization_request` channel message | Stored as reference only; no execution side-effect; policy can disallow | **PASS** — plus `ERR-043` when `allowAuthorizationRequest=false` |
| R6b | **Implicit authority (memo)** | `payment_memo` with `paymentRef` opaque hex | One message stored, zero payment ledger side-effect | **PASS** |

Additional coverage in lifecycle tests: initiator cannot accept own channel, proposal cannot be archived, policy-disallowed `claim_invitation` rejected, archived channel blocks sends.

---

## 9. AUDIT.md / T / FT Gate Mapping

Per `projects/prism/AUDIT.md` and `projects/prism/system/TEST_ARCHITECTURE.md`:

| Gate | Criterion | C1 mapping | Status |
|---|---|---|---|
| **T8 API contract** | Error shapes, idempotency, watermark/policies | `ERR-030..048` catalogue; `ERR-044` replay idempotency; policy + watermark via `independentRead({watermark})` + `version` CAS | **X2 PASS** — no REST route added per boundary (service-layer contract only) |
| **T10 Product operation state** | State labels derive from canonical state only | Channel `version` + `status` drives UI; service never derives from stale cache | **X2 PASS** — frontend untouched per contract |
| **T11 Channel/payment memo vertical slice** | `create → accept → encrypted memo/receipt → independent read → revoke/archive` | `testnet-procedure.test.ts` 11-step S4 sequence + `buildC1Fixture` | **X2 PASS** — X3 requires durable Postgres + real commitment publish |
| **T12 Revocation/restart/key-boundary** | Revocation terminal, restart recovery, key boundary | `R3` revoked terminal + idempotent; `R5` key reuse; `INV-PRISM-012` separation via port; no secret handling | **X2 PASS** |
| **FT-001 Identity persistence** | — | Out of C1 scope (PRISM-7/8) | Not evaluated |
| **FT-004 Revoked resolution** | Resolver never returns revoked as active | Analog: revoked channel never allows messages; independent read returns `REVOKED` | **X2 PASS (channel analog)** |
| **C1/S4 Product Gate** | Minimal PrismChannel testnet slice accepted | All S4 MVP items evidenced X2 + red-team | **X2 ACCEPTABLE** |
| G0–G8 | Mainnet gates | G0/G4–G8 remain `NOT_IMPLEMENTED`; ledger `EVD-PRISM-004..007` remain X0 — no ledger movement without live observation | Preserved |

C1 is explicitly **non-blocking for first mainnet** unless the release claim promises PrismChannel (per `PRISM_MAINNET_PHASE_PLAN`). Current mainnet gates therefore remain unchanged.

---

## 10. Evidence Maturity X0–X5

| Artifact | Maturity | Basis |
|---|---|---|
| PrismChannel domain + service | **X2** | Local controlled, deterministic, injected fakes/ports, no chain |
| Channel/Message storage + key commitments + public publisher | **X2 TEST DOUBLE** | `InMemory*` adapters, `deterministicCommitment`, `fakeHash` — labelled |
| Ciphertext + no-plaintext invariant | **X2** | Pattern/hex check + `scanForPlaintext` — real E2EE not yet wired |
| Lifecycle + policy + authorization | **X2** | Pure domain + service tests, CAS version |
| Testnet procedure + independent read | **X2** | `C1_TESTNET_PROCEDURE` + `independentRead` via second read on same store instance — real X3 needs durable store + second RPC/explorer node |
| Any SN_MAIN/SN_SEPOLIA live channel commitment/status | **X0** | No deployment, no `strk20.json`, no explorer URL |

Promotion to **X3** requires: durable `ChannelStore`/`MessageStore` (e.g., Postgres), real `CommunicationKeyCommitmentPort` (device/provider commitments), real `PublicChainPublisher` (hash on Starknet or content-addressed storage), and **independent read** via separate process/RPC with `explorer_url` + `rpc_second_read` per `evidence-envelope.ts` validator.

---

## 11. Docs / Decision Drift

- No Product Truth mutated. No `SYSTEM_CANONICAL.md` or YAML companions mutated. C1 adds a new domain `OBJ-PRISM-CHANNEL` + `OBJ-CHANNEL-MESSAGE` conceptually but does not claim they are canonical system artifacts — they are projected from `docs` §§15–19 and S4 and require a future System Foundry canonization if C1 is accepted.
- `DEC-PRISM-SYS-001` (Option A, ACCEPTED) and `DEC-PRISM-SYS-002` (proposed) are acknowledged and unaffected.
- Drift classification: **D0 — no drift**. Implementation is additive under existing `src/features/**` modular monolith.

Outstanding doc action if C1 is integrated: add `projects/prism/system/PRISM_CHANNEL_ADDENDUM.md` or extend `DOMAIN_MODEL.md` with channel objects for System Foundry review — not done in this lane to keep worktree scoped to `src/features/prism-channels/**`.

---

## 12. Remaining Blockers

- **X3 promotion**: durable stores + real commitment publisher + independent live readback not yet wired — honest X2 only.
- **Real cryptography**: `makeCiphertext`/`opaqueRef` are opaque hex fixtures; real encrypted payload path (device key hierarchy, discovery/sync, recovery) is deferred per `docs` §18.
- **REST/SDK/MCP exposure**: Phase S1–S3 remain `NOT_IMPLEMENTED`; intentional per C1 isolation — C1 service is transport-neutral.
- **No Strknet onchain channel registry**: S4 does not require Cairo; offchain `ChannelStore` is the minimal testnet answer. Onchain commitment registry is a future decision.
- **Parent verification**: integration happens only in a parent-controlled worktree per convergence contract — this lane has not merged.

---

## 13. Explicit Verdict

**ACCEPTABLE_FOR_INTEGRATION (X2)** — with X3 blockers noted above.

- All required S4 MVP steps implemented via injected ports; test doubles are clearly labelled X2.
- Foundry alignment: Product (§§15–19) preserved, System invariants (INV-PRISM-001/002/012, INV-SYS-002/006 analog) mapped, Research claims capped at X2, Antagonist 9 cases green, AUDIT T8/T10/T11/T12 X2.
- No forbidden surface touched. No secret/viewing-key handling. No `strk20.json` mutation. No frontend/Phase 8 change. `typecheck`, `build`, and `npm test` (314/314) green.

Integration note: parent should run the full combined gate after integration batch and require a follow-on System Foundry addendum before promoting any C1 ledger row.

---

## 14. Requirement Traceability (C1/S4)

| C1 brief requirement | Implementation | Test | Maturity |
|---|---|---|---|
| 1. channel create/accept/archive/revoke between two Prism IDs | `channel.ts` + `channel-service.ts` | `channel-lifecycle.test.ts` 5 tests, `testnet-procedure` steps 1–4,9–11 | X2 |
| 2. separate communication-key commitment port (no key gen) | `ports.ts` `CommunicationKeyCommitmentPort` + `InMemoryKeyCommitmentPort` | `keysep` test, `R5/R5b` | X2 |
| 3. ciphertext/encrypted-reference message for 4 content types | `message.ts` + `opaqueRef` | `msgtypes` test (4 types), refs hex check | X2 |
| 4. no plaintext on public surfaces | `detectPlaintextLeakage` + `PublicChainPublisher` hash-only | `noplain`, `R4/R4b` | X2 |
| 5. participant authorization + channel policy | `assertParticipant` + `policy.allowedContentTypes` | `authz`, `policy` | X2 |
| 6. testnet procedure/evidence fixture with independent reads | `testnet-procedure.ts` 11 steps + `buildC1Fixture` | `testnet-procedure.test.ts` | X2 |
| 7. red-team 6 attack families | `redteam.test.ts` R1–R6b (9 cases) | All green | X2 |
| Product Foundry | §§15–19 preserved | Lifecycle + policy tests | X2 |
| System Foundry | Authority/state/error/invariant mapping (§5 table) | All | X2 |
| Research Foundry | Sources/freshness/limits (§4) | X2 ceiling | X2 |
| Antagonist | R1–R6b | §8 table | 9/9 |
| AUDIT T8/T10/T11/T12 | §9 table | Lifecycle + redteam + procedure | X2 |
| C1/S4 | S4 MVP + non-goals respected | Full suite | X2 |

---

*Session footer (FOUNDRY_PROTOCOL §17):*
```text
Canonical artifacts updated: none (read-only; new code is additive in src/features/prism-channels/** — no canonical markdown moved)
Decisions created: 0
Decisions superseded: 0
Assumptions added: 0 (relies on INV-PRISM-012 / INV-SYS-006 analog; no new assumption registered)
Contradictions added: 0
Evidence added: X2 test doubles + 20 new tests; no X3/X5 promotion
Drift detected: D0 (none)
Next step: parent-controlled worktree integration; optional System Foundry addendum for channel domain canonization
```
