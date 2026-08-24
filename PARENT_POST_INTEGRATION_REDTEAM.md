# Parent Post-Integration Red-Team — HEAD d4d2f2a

**Scope:** Post-integration hardening audit after M1/M2/M4/M7/C1 integration + Pause REST rigorous fix (d4d2f2a). Review-only, no source mutation, no deploy/broadcast, no secret inspection, no frontend/Phase 8 / strk20.json mutation.
**HEAD:** `d4d2f2a853063eef4344bbfcdb1471d9dcf75e7f` — `fix(pause): wire REST through rigorous P0-P4 domain guards`
**Parent checkpoint:** `7a385d2`
**Date:** 2026-08-24
**Model:** Muse Spark 1.2 free via OpenCode (no ChatGPT/Codex)
**Verdict:** `PARENT_CONVERGENCE_CLEAR_WITH_OPEN_RUNTIME_GATES`

---

## 0. Method

- Read `PRISM_PARENT_CLOSEOUT_GOAL.md`, `PRISM_PHASE_CONVERGENCE_CONTRACT.md`, `DECISIONS.md`, `PRISM_MAINNET_PHASE_PLAN.md`, `AUDIT.md`, `EVIDENCE_LEDGER.md`, all integrated reviews `BACKEND_PHASE_M1/M2/M4/M7/C1`, `BACKEND_PHASE_M5_E2E_REDTEAM.md`, `BACKEND_PHASE_M5_VESU_HELPER_REVIEW.md`, `M5_LIVE_HELPER_VESU_PROBE.md`, `SYSTEM_FOUNDRY.md`, `CONTRACT_SPEC.md`, actual diffs `7a385d2..d4d2f2a` and `7a385d2..HEAD`.
- Ran read-only checks: `npm test` (448 passed | 14 skipped), `npm run typecheck` (PASS), `npm run build` (PASS, 18 routes), `git diff --check` (clean), static searches for authority/ciphertext/secret drift, file existence checks for forbidden surfaces, `strk20.json` shape, `src/app/page.tsx` diff.
- Never executed live RPC, never wrote `strk20.json`, never touched `Linear/Notion`, never inspected secrets.

---

## 1. Inputs inspected (canonical)

| Artifact | Version | Role |
|---|---|---|
| `projects/prism/agent-packets/PRISM_PARENT_CLOSEOUT_GOAL.md` | 2026-08-23 | Lane goals, X2/X3 vocabulary, non-negotiables |
| `projects/prism/agent-packets/PRISM_PHASE_CONVERGENCE_CONTRACT.md` | 2026-08-23 | Shared completion equation, boundaries, 13-section report contract |
| `projects/prism/DECISIONS.md` | v0.2 + DEC-PRISM-SYS-001 Option A + DEC-PRISM-OPS-001 testnet + DEC-PRISM-SYS-003 chainId-v2 + DEC-PRISM-M5-001 Vesu | Starknet root, venue-native auth, testnet manifest |
| `projects/prism/agent-packets/PRISM_MAINNET_PHASE_PLAN.md` | 2026-08-23 | M0-M9 bands, M7 placement before settlement, C1 non-blocking |
| `projects/prism/AUDIT.md` | 2026-08-20 PASS_WITH_LIMITATIONS | Gates G0-G8, FT-001..008, X0-X5 |
| `projects/prism/EVIDENCE_LEDGER.md` | v0.2 | EVD-PRISM-004..007 remain X0, EVD-PRISM-012/013 X2 |
| `foundry/SYSTEM_FOUNDRY.md` v0.95, `CONTRACT_SPEC.md`, `STATE_MACHINES.md`, `INVARIANTS.md`, `AUTHORITY_MATRIX.md` | 2026-08-20 | Canonical authority/state/error |
| `BACKEND_PHASE_M1_REVIEW.md` | 2026-08-23 BLOCKED live | M1 X2 harness, 5 cross-checks |
| `BACKEND_PHASE_M2_REVIEW.md` | 2026-08-24 ACCEPTABLE_FOR_INTEGRATION X2 | REST/SDK/MCP contract, 12 antagonists |
| `BACKEND_PHASE_M4_REVIEW.md` | 2026-08-24 ACCEPTABLE_FOR_INTEGRATION X2 | Wallet API 12-state, privacy guards |
| `BACKEND_PHASE_M7_REVIEW.md` | 2026-08-24 ACCEPTABLE_FOR_INTEGRATION X2 | Pause P0-P4 domain foundation |
| `BACKEND_PHASE_C1_REVIEW.md` | 2026-08-23 ACCEPTABLE_FOR_INTEGRATION X2 | Channel ciphertext, key separation |
| `BACKEND_PHASE_M5_E2E_REDTEAM.md` | d1779b6 Hermès Alpha BLOCKED | H1 u128 vs u256 blocker |
| `BACKEND_PHASE_M5_VESU_HELPER_REVIEW.md` | 2026-08-23 READY_FOR_DEPLOYMENT_REVIEW | Pinned u256 Vesu helper, 16 tests |
| `M5_LIVE_HELPER_VESU_PROBE.md` | 2026-08-23 X3 narrow | Probe helper + Vesu deposit succeeds, pool path still open |

No URL synthesized.

---

## 2. Read-only verification results

| Check | Command | Result | Evidence |
|---|---|---|---|
| tests | `npm test` (after `npm ci` 174 packages) | **PASS** `43 passed \| 2 skipped (45)` `448 passed \| 14 skipped (462)` 30.27s | includes `pause-rest-wiring.test.ts` 9/9, `m2-transport.test.ts` 19/19, M4 49/49, C1 20/20, Pause domain 6 suites |
| typecheck | `npm run typecheck` | **PASS** 0 errors | previous missing `vitest/config` resolved after `npm ci` |
| build | `npm run build` | **PASS** `✓ Compiled 24.1s` + `8.9s TS` 18 routes (`/` + 16 `/api/v1/*` + `/_not-found`) | `docs/api/openapi.yaml` 377 lines consistent |
| diff check | `git diff --check` | **clean** | no whitespace errors |
| secrets | `grep viewing.?key / privateKey` | only docs + guard code, no committed secret | `src/features/prism-strk20/domain/privacy-guard.ts:7-8` forbidden patterns enforced, `ops/starknet/accounts.json.example:2` secret-free template |
| strk20 | `cat strk20.json` | `{"transactions":[],"contracts":[],"demo_video":"","demo_url":""}` | correct for X2 — no premature hash |
| frontend | `git diff 7a385d2..HEAD -- src/app/page.tsx` | **zero diff** | Phase 8 exclusion honored |
| Phase 8 isolation | `git diff 7a385d2..HEAD --stat` shows only `src/app/api/v1/pauses/*`, `src/application/pause-port.ts`, `__tests__` | no `src/app/page.tsx`, `src/features/wallet/WalletConnectionPanel.tsx` mutation | parent gate preserved |

---

## 3. REST / SDK / MCP authority audit

### 3.1 REST authority — PRESERVED, now rigorous
- `src/app/api/v1/pauses/[pauseId]/verify/route.ts:1-13` now imports `PauseError` and forwards `planHash/policyVersion/sources` to `factory.pauseService.verifyPause` — previously `verifyPause(decoded)` with no binding. Current path is `verifyPause(decoded, {planHash, policyVersion, sources})` at `src/application/pause-port.ts:285-333` with `ERR-102 plan_hash_mismatch` + `ERR-103 policy_version_mismatch` pre-checks.
- `src/app/api/v1/pauses/[pauseId]/release/route.ts:12-15` extracts `planHash/approvalScopeHash/settlementOperationId` and calls `releasePause(decoded, expectedVersion, {planHash, approvalScopeHash, settlementOperationId})` at `src/application/pause-port.ts:335-371` — enforces `computeApprovalScopeHash` + `ERR-104` + `ERR-111 CAS` + `RELEASED settlementOperationId-only`.
- `src/app/api/v1/pauses/[pauseId]/approve/route.ts:12-16` similarly threads `planHash/approvalScopeHash` to `approvePause` with `ERR-102/104`.
- `src/app/api/v1/pauses/[pauseId]/cancel/route.ts:9` and `escalate/route.ts:9` add `PauseError` branch returning `e.httpStatusHint` + `toExternalShape()` without leaking stacks — prior path only mapped `AppError`.
- All 5 routes retain `requireSession` (`CON-PRISM-006`: app session ≠ controller authority) and `parseHeaders` `If-Match` CAS propagation. No route mints `txHash`; `settlementOperationId` is `op_future_*` synthetic at `src/application/pause-port.ts:352`.

### 3.2 SDK boundary — PRESERVED, minor incomplete wiring (open gate, not deception)
- `src/sdk/client.ts:1-4` vocabulary comment + `src/sdk/client.ts:123-127` `resolve`/`get` go via REST only — `grep -r starknet src/sdk` returns only comment hits, no `starknet.js` import, no `felt/calldata` escape (`grep -r felt src/sdk` only vocabulary note).
- `src/sdk/mcp-boundary.ts:85` blocks `bypass_pause/mark_completed/read_viewing_key/sign_with_user_key`; `createMcpAdapter:83-117` delegates to same `PrismClient` instance, no second policy path.
- **Open gap (not blocking convergence, recorded as runtime gate):** `src/sdk/client.ts:238-272` `pauses.verify/release/approve` currently send only `{session, expectedVersion}` — they do not yet thread `planHash/approvalScopeHash/settlementOperationId` through to REST. Server accepts missing hashes (falls back to stored) so SDK path remains functional at X2, but pre-release SDK hardening (phase M2 §12 item 7) must add header/body forwarding to fully exercise new guards via SDK. No authority bypass, but incomplete end-to-end coverage.

### 3.3 MCP thin boundary — PASS
- `src/sdk/mcp-boundary.ts:19-75` 10 tools all vocabulary-typed; `prism_create_channel / prism_send_channel_memo` correctly return `testnet_scope_only` `ERR-023` without second authority. Authority trace in M2 §5 preserved.

---

## 4. Pause RELEASED vs COMPLETED / hash / CAS / UNKNOWN audit

**Premise:** Per `PRISM_MAINNET_PHASE_PLAN.md:42-48` Pause delays settlement, never reverses finality; per `PRISM_PAUSE_PHASE_PLAN.md` promise.

| Property | Implementation | Line | Finding |
|---|---|---|---|
| RELEASED ≠ COMPLETED | `src/features/prism-pause/domain/pause.ts:5` comment, `pause.ts:48` `settlementOperationId` only after RELEASED, `pause.ts:267-274` `release` returns `RELEASED` with link, no broadcast | **PASS** — `src/application/pause-port.ts:351` explicit, `src/features/prism-pause/__tests__/pause-lifecycle.test.ts:40-48` asserts `op.state != completed` |
| plan_hash immutable binding | `src/features/prism-pause/domain/execution-plan.ts:40-110` canonical JSON SHA-256, `src/features/prism-pause/domain/pause.ts:66-69` `computeApprovalScopeHash`, `src/application/pause-port.ts:290-291,342-344,406-408` pre-check `plan_hash_mismatch ERR-102` | **PASS** — `src/application/__tests__/pause-rest-wiring.test.ts:11-19` wrong hash → ERR-102 |
| approval_scope_hash exact plan/decision | `src/features/prism-pause/domain/pause.ts:66-69` + `pause.ts:234-237,260-263` + `src/application/pause-port.ts:346-348,409-411` `ERR-104` | **PASS** — `pause-rest-wiring.test.ts:21-33` wrong scope → ERR-104, correct scope releases |
| CAS / stale_version | `src/features/prism-pause/domain/pause.ts:153-154` `assertVersion`, `src/features/prism-pause/domain/errors.ts:50` `ERR-111 stale_version 409`, `src/application/pause-port.ts:360-361,378,407` pass `expectedVersion` | **PASS** — `pause-rest-wiring.test.ts:38-72` stale → ERR-111, correct version succeeds; `m2-transport.test.ts:172-178` updated to `ERR-023|ERR-111` |
| UNKNOWN fail-closed | `src/features/prism-pause/domain/checks.ts:1-60` `hasBlockingFailure`, `src/features/prism-pause/domain/pause.ts:184-188,265` `CHECK_UNKNOWN_BLOCKING ERR-116`, `src/application/pause-port.ts:308-310` `unknownSources()` when `intent/requestedAsset` contains `unknown` | **PASS** — `pause-rest-wiring.test.ts:42-51` unknown → ESCALATED UNKNOWN, release blocked `ERR-116/RELEASE_NOT_READY`; prior auto-promote fake eliminated |
| Expiry / terminal guards | `src/features/prism-pause/domain/pause.ts:104-111` `ALLOWED` table, `pause.ts:280-293` `expire`, `pause.ts:277-285` `cancel` blocks RELEASED/EXPIRED, `pause.ts:277-283` `already_has_settlement_operation` | **PASS** |

No hash conflated with settlement. No `RELEASED → COMPLETED` conflation remains.

---

## 5. M4 privacy / state audit

- **12-state machine:** `src/features/prism-strk20/domain/strk20-state.ts:9-107` `STRK20_STATES` exactly `capability_unknown, mismatch, registration_required, approval_pending, shielding, confirmed, maturing, privately_available, transfer_pending, transfer_confirmed, rejected, dependency_failure` with `MATURITY_BLOCKS=10` guard at `strk20-state.ts:157-174` (`currentBlock < maturityTargetBlock` → `MATURITY_PENDING STRK20-010`). No new state introduced in integration.
- **Least privilege capability:** `src/features/prism-strk20/domain/wallet-capability.ts:7-40` + `src/features/prism-strk20/adapters/injected-wallet.ts:12-60` `supportsStrk20` via `supportedWalletApi/supportedSpecs >=0.10.3` only; integration test `strk20-flow-integration.test.ts:18-42` asserts `calls.balances==0` on `observeCapability`. Balance read is consent-gated at `strk20-state.ts:169-174` + `injected-wallet.ts:71-88` `requireConsent:true`.
- **Viewing-key boundary:** `src/features/prism-strk20/domain/privacy-guard.ts:14-44` `assertNoViewingKey` on every adapter entry (`injected-wallet.ts:22,44,58`); `src/features/prism-strk20/domain/errors.ts:15` `STRK20-015 viewing_key_forbidden 400`. `grep starknet-privacy src/features/prism-strk20` zero hits.
- **Fee honesty:** `src/features/prism-strk20/domain/fee-policy.ts:12-34` `assertFeeUnchanged` + `computeMaxSpendable` reserve fee; `strk20-state.ts:178-182` `fee_changed` blocks `shielding/transfer_pending`.
- **Screening distinct:** `src/features/prism-strk20/adapters/injected-wallet.ts:82-96` maps `screening: rejected` → `STRK20-006` vs `screening_unavailable` → `STRK20-013`; state `rejected` requires `rejectionReason` at `strk20-state.ts:185-191`.
- **Relayer non-attribution:** `src/features/prism-strk20/domain/receipt.ts:22-58` `buildShieldReceipt` ignores `senderAddress` (`senderIgnored`), `assertNotSenderAttribution` at `receipt.ts:72`; receipt truth at `privacy-guard.ts:94-98`.
- **Privacy copy guard:** `privacy-guard.ts:51-77` 8 overclaim patterns blocked, 5 allowed phrases only.
- **Status:** X2 contract-complete, X3 blocked pending live wallet/pool trace (wallet re-read, fee live, 10-block maturity wait, relayer receipt) — honestly labeled.

---

## 6. C1 ciphertext / key / payment boundaries

- **Channel lifecycle:** `src/features/prism-channels/domain/channel.ts:2-5,104-111,211` `PROPOSED→ACCEPTED→ACTIVE→ARCHIVED→REVOKED`, `REVOKED` idempotent, `RELEASED` no re-activation — matches `PRISM_PROTOCOL_SURFACE_PHASE_PLAN.md` §S4.
- **Key separation (INV-PRISM-012):** `src/features/prism-channels/domain/ports.ts:25-28` `CommunicationKeyCommitmentPort` injected, app never generates keys; `src/features/prism-channels/adapters/memory-channel-store.ts:59-78` deterministic hex vs secret; `channel.ts:148-151` `KEY_REUSE ERR-045` when both participants identical commitment.
- **Ciphertext-only / no plaintext onchain:** `src/features/prism-channels/domain/message.ts:22-58` `detectPlaintextLeakage` hex-only `^0x[0-9a-fA-F]{64,}$` + pattern scan for `@amount/USDC/memo`; `src/features/prism-channels/application/channel-service.ts:175-178` publishes only `fakeHash(ciphertext)` to `PublicChainPublisher`; red-team `R4/R4b` block at `channel-service.ts:121-134`.
- **No payment authority:** `src/features/prism-channels/application/channel-service.ts:4,178` `authorization_request` stored as reference only, never execution side-effect; policy `allowAuthorizationRequest` flag at `channel.ts:17-22`; `ERR-046` guard documented in review.
- **Participant authorization:** `channel.ts:209-211` `assertParticipant` on every `accept/archive/revoke/send/get/list`.
- **Status:** X2 TEST DOUBLEs labeled, X3 requires durable Postgres + real commitment publisher + independent read (`src/features/prism-channels/testing/testnet-procedure.ts:11 steps`).

---

## 7. M1 evidence promotion audit

- **Harness:** `src/features/evidence/m1-live-read.ts:29-183` 5 facets `create_identity/get_identity/event/indexer/watermark` with deterministic builders `buildM1*Fixture`; `ops/m1-live-read/harness.mjs:1-139` offline-first, `--rpc` read-only via `RpcProvider.call/getEvents/getClassHashAt` without invoke/key handling.
- **Validators + 5 cross-checks:** `m1-live-read.ts:200-376` `validateM1CreateIdentity/GetIdentity/Event/Indexer/Watermark` + `runM1CrossChecks` (wrong network, address mismatch, missing independent read, malformed receipt, stale block `K=5`). `ops/m1-live-read/validate.mjs:1-192` offline validator with `--self-test` 6 fixtures (`valid X3 + 5 blockers`).
- **Promotion gate:** `m1-live-read.ts:398-448` `buildM1Envelope` defaults `maturity X2 TEST DOUBLE`, only prompts to `X3` when `independentVerification` present and `promotion_blockers.length==0`; `EVIDENCE_LEDGER.md:13` `EVD-PRISM-004` remains `X0 NOT_IMPLEMENTED` — no ledger move without `explorer_url + rpc_second_read + fresh watermark`. Prior `BACKEND_PHASE_M1_REVIEW.md:10` explicitly states `BLOCKED — live create_identity + independent read remain BLOCKED`.
- **Finding:** No premature promotion; envelope shape correct; `isStaleProjection` reused at `m1-live-read.ts:181`.

---

## 8. M5 u256 / X2–X3 boundary

- **H1 fix verified:** `contracts/prism_vesu_lending_helper/src/lib.cairo:18-24` real-token `u256` surfaces `balance_of/approve/transfer_from/deposit assets→shares`; pool-facing `privacy_invoke(in_amount: u128) -> OpenNoteDeposit{amount: u128}` preserved. Measured delta at `lib.cairo:173-178` `balance_of before/after delta_u256` + `delta_u256.try_into().expect('OUT_OVERFLOW')` rejects high limb — never silent truncate. Generic `prism_allocation_helper` (u128 fixture) retained as regression baseline (11 tests) per `BACKEND_PHASE_M5_VESU_HELPER_REVIEW.md`.
- **Hardening:** `lib.cairo:119-133` constructor pins `privacy_pool/underlying/v_token`, `lib.cairo:145-153` caller+direction guards, `lib.cairo:182` approve only `pool_addr`. Storage pins immutable (no admin/setter/upgrade).
- **Test evidence:** `contracts/prism_vesu_lending_helper/tests/test_prism_vesu_lending_helper.cairo` 16 passed locally; `M5_LIVE_HELPER_VESU_PROBE.md:34-88` narrow X3: probe helper `0x03a0628...1cb7` deposit `1 STRK` → Vesu `0x7152ae...f8fff` delta `1e18` shares measured, `approve/pull` succeeds, zero strand. Production helper `0x07f3dd...0adf` pinned to `0x0254a6...2d91` (SN_SEPOLIA privacy pool) not yet pool-invoked — boundary honestly stated at `M5_LIVE_HELPER_VESU_PROBE.md:89-102` (no STRK20 note, no pool OpenNoteDeposit).
- **Remaining blocker:** Full `privacy_invoke` via STRK20 pool + open-note readback + upstream validator `ok/pool/mine` still requires Wallet API/prover path (producing decision `DEC-PRISM-M5-001` + `PRISM_MAINNET_PHASE_PLAN.md:287-325`). Maturity correctly capped at **X2 local + X3 narrow leg**, not full M5 X3.

---

## 9. Doc / review / decision drift

| Dimension | Check | Result |
|---|---|---|
| Convergence contract | `PRISM_PHASE_CONVERGENCE_CONTRACT.md:41` Phase 8 excluded, model policy Muse Spark only | honored — no ChatGPT, no Phase 8 file touched |
| Foundry → Profile → Project | `SYSTEM_FOUNDRY.md`, `PRODUCT_FOUNDRY.md`, `STRK20_PRIVACY_PROFILE.md` | no product truth mutated; `INV-SYS-001..012` / `INV-PRISM-001..016` preserved |
| Decisions | `DECISIONS.md:354-384` `DEC-PRISM-M5-001` Vesu route accepted for testnet only, `DEC-PRISM-SYS-001` Option A, `DEC-PRISM-OPS-001` testnet | none superseded silently; `git diff 7a385d2..HEAD -- projects/prism/DECISIONS.md` shows only appended `DEC-PRISM-M5-001` already present at `7a385d2` — no drift |
| SYSTEM canonical artifacts | `projects/prism/system/*.md` | `git diff 7a385d2..HEAD` shows **zero** edits to `SYSTEM_CANONICAL.md/DOMAIN_MODEL.md/STATE_MACHINES.md` — P0–P4 code lives in `src/features/prism-pause/**` awaiting Product/System canonicalization per `BACKEND_PHASE_M7_REVIEW.md:11` D0–D1 draft only |
| OpenAPI | `docs/api/openapi.yaml:308-377` pauses/intents routes present; error schema stable `ERR-*` | D1 additive contract, no authority drift |
| Reviews vs diffs | M2 review claimed 18 routes + `openapi.yaml`; diff `7a385d2..HEAD` shows exactly those 17 `/api/v1/*` + `openapi.yaml` + SDK/MCP; M4 review 12-state + 6 suites matches `src/features/prism-strk20/**` 1.1k lines; M7 P0–P4 6 suites + `pause.ts:16-111` state table matches `policy-engine.ts:36-230`; C1 3 suites + ciphertext guard matches `message.ts:22-58` | no inflated claim |
| AUDIT | `AUDIT.md:13` G0-G8 all `NOT_IMPLEMENTED` except EVD-012/013 X2 | reviews correctly map to G/T/FT as X2 only, no X3 inflation |

**One documentation gap (not deception, recorded as open gate):** M7 `SM-PAUSE-001` and M4 `SM-PRISM-M4` are proposed but not yet canonicalized into `state-machines.yaml` / `AUTHORITY_MATRIX.md` — correctly flagged as `D0–D1 draft` in reviews, pending P0 acceptance.

---

## 10. Forbidden Phase 8 / strk20.json / secret checks

| Prohibition | Check | Result |
|---|---|---|
| Phase 8 frontend | `git diff 7a385d2..HEAD -- src/app/page.tsx` empty; `grep -r Home src/app/api src/sdk` zero | PASS |
| `strk20.json` | `cat strk20.json` empty `transactions/contracts` | PASS — `m1-live-read.ts:398-448` `assertNoStrk20JsonWrite` enforced |
| Push / Linear/Notion | `git log --oneline -15` author `Ubuntu`, no `origin` push evidence; worktree clean | PASS |
| Secrets | `src/features/prism-strk20/adapters/injected-wallet.ts` provider-injected only; `ops/starknet/sncast.toml.example` env-var placeholders; no `0x` 64-hex secret in repo | PASS |
| Model policy | reviews state `Muse Spark 1.2 free` | PASS — `AGENTS.md:3` Next.js note respected, no Codex |

---

## 11. Evidence maturity ledger (honest truth)

| Lane | Claim | Target | Integrated | Honest ceiling | Blocker |
|---|---|---|---|---|---|
| M1 | Starknet identity live create/read | X3 | X2 harness | **X2** | live `SN_SEPOLIA` create_identity + `get_identity` round-trip + `PrismIdentityCreated` selector `0x2c3cc...160e7` + `rpc_second_read` + `watermark K=5` fresh (owner broadcast required, `ops/m1-live-read/PROCEDURE.md §2`) |
| M2 | REST/SDK contract | X2 | **X2 PASS** | X2 | Postgres wiring (`T7`) + `next start` live transport trace (`T8`) + Pause policy P3 + settlement adapter P5 remain open — not claimed |
| M3 | Base proof/bind/resolve/revoke | X3 | X2 via service fakes | X0 live | funded Base Sepolia EOA ladder (EIP-1271/ERC-6492) + controller-signed Starknet bind + independent reads |
| M4 | Wallet API consumer route | X3 | **X2** | X2 | live wallet `supportedWalletApi` re-read + `get_fee_amount` live + `maturing→privately_available` 10-block wait + relayer receipt |
| M5 | Helper via privacy pool | X3 pool + X5 mainnet | **X2 + narrow X3 leg** | X2 full | Wallet/prover path + `pool withdraw → helper deposit → open note credit` + `upstream validator mine=true` + conservation readback |
| M7 P0–P4 | Pause durable foundation | X2 | **X2** | X2 | P0 Product/System acceptance + P5 adapter + P6 REST vertical slice (SDK gaps) + P7 observability + P8 testnet evidence |
| C1 | Channel testnet slice | X3 | **X2** | X2 | durable store + real commitments + hash-only publisher + independent read |
| MCP S3 | Agent boundary | X2 | X2 thin adapter | X2 | agent outside authority → ESCALATED + plan mutation re-verify proof (if agents promised) |

No lane promoted to `TESTNET_COMPLETE_X3` or `MAINNET_READY` without receipts. `EVIDENCE_LEDGER.md` rows `EVD-PRISM-004..007` correctly remain `X0 NOT_IMPLEMENTED`.

---

## 12. Open runtime gates (explicit, not hidden)

1. **M1 live SEPOLIA identity:** funded deployer + `sncast declare/deploy` + `create_identity` broadcast + `PrismIdentityCreated` event + second RPC `getClassHashAt`/`call` + Voyager URL + `watermark >= confirmed -5`.
2. **M3 decisive sequence:** Base Sepolia challenge `chainId 84532` + valid/replay/expiry/altered cases + controller-bound Starknet tx + `resolve → revoke → NO_ACTIVE_DESTINATION` + `P` persists.
3. **M4 live STRK20:** Ready wallet + `shield/approve→deposit` two prompts + `screening rejected vs unavailable` + `maturing` 10-block + `strk20Balances` consent + `get_fee_amount` + relayer `keys[0]` attribution.
4. **M5 full pool route:** STRK amount `OPEN → production helper [STRK, vToken, amount, openNoteId]` via real Wallet API/prover, pool event + helper calldata + Vesu Deposit + `note_id/token==vToken/amount==shares` private readback.
5. **M7 P5–P8:** `RELEASED → operation row → Starknet/Base/STRK20 adapter → reconciled → completed` contract, product/API slice (SDK `planHash` wiring), operator bypass audit, `SN_SEPOLIA` Pause sequence with `intent→pause→verify→release→submit→reconcile` hashes.
6. **C1 + MCP + Postgres:** durable `ChannelStore` + real `CommunicationKeyCommitmentPort`, `PostgresPauseStore` live `pg` T7 promotion, `MCP` identical `operationId/state` proof if agents in promise.
7. **Mainnet release:** `DEC-PRISM-M5-001` does not authorize mainnet; `strk20.json` empty; hub validator `pool+mine` only after `SN_MAIN` hashes exist; `SN_MAIN` release gate (Band A vs B) still open per `PRISM_MAINNET_PHASE_PLAN.md:9-46`.

---

## 13. Conformance summary

| Question from brief | Answer |
|---|---|
| REST/SDK/MCP authority conflated? | No — REST via `AppSession` ≠ Starknet controller, SDK no `starknet.js`, MCP same-client delegation. |
| Pause `RELEASED` vs `COMPLETED`/hash/CAS/`UNKNOWN` conflated? | No — rigorous `RELEASED` future link, `plan_hash`/`approval_scope_hash`/`CAS`/`UNKNOWN` fail-closed all enforced at `d4d2f2a`. |
| M4 privacy/state honesty? | Yes — 12-state, viewing-key guard, least-privilege, maturity/fee/screening/relayer all fail-closed. |
| C1 ciphertext/key/payment boundaries? | Yes — hex-only ciphertext, hash-only public, distinct commitments, no payment authority. |
| M1 evidence promotion honest? | Yes — `X2` ceiling, `X3` requires independent read, ledger untouched. |
| M5 u256/X2–X3 boundary? | Yes — helper fixed to `u256`, narrow probe X3 proven, full pool X3 not claimed. |
| Doc/review/decision drift? | No — D0–D1 additive only, no canonical mutation, reviews align with diffs. |
| Forbidden Phase 8/strk20 changes? | None — frontend zero diff, `strk20.json` empty, no secrets, no push. |

---

## 14. Verdict

```text
PARENT_CONVERGENCE_CLEAR_WITH_OPEN_RUNTIME_GATES
```

All selected lane diffs (`m1-live-read` fbb98ce, `C1` 7010f00, `M7 P0–P4` 7d48acd, `M4` 8ee3831, `M2` 70c29d5, `Vesu helper` 533dfad, `Pause REST hardening` d4d2f2a) inspected; combined QA `npm test 448/462 | typecheck PASS | build PASS | diff --check clean` green; `strk20.json` empty; Phase 8 untouched; authority and privacy invariants preserved; X2/X3 boundaries visible; no worker-only implementation described as parent-complete.

Parent may integrate as-is. Live `X3` gates remain intentionally open per `M0 release decision` and must not be called complete without independent receipts as listed in §12.

*Next evidence step:* fund `SN_SEPOLIA` deployer → live `create_identity` + independent read → `EVD-PRISM-004 X0→X3` via `ops/m1-live-read/validate.mjs` promotable envelope, then repeat decisive Base bind sequence before M4/M5 live traces.

