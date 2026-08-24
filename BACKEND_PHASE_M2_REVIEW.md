# Backend Phase M2 Review — Protocol Surface: REST/API + SDK + Reconciliation Boundary

**Lane:** M2 for Prism · Muse Spark 1.2 free
**Workdir:** `/home/ubuntu/prism-work/phase-m2-api-sdk` @ `7a385d2`
**Date:** 2026-08-24 UTC
**Scope in:** `src/application/**`, `src/app/api/**` (new), `src/sdk/**` (new), `docs/api/openapi.yaml` (new), tests, review packet
**Scope out (untouched):** frontend `page.tsx`/landing/Home, `contracts/Cairo`, Pause domain internals beyond injectable contract, STRK20 implementation, `PrismChannel` domain, `strk20.json`, Linear/Notion, credentials, GitHub push
**Authority:** `PRISM_PHASE_CONVERGENCE_CONTRACT.md`, `PRISM_PROTOCOL_SURFACE_PHASE_PLAN.md` S0–S2, `PRISM_PAUSE_PHASE_PLAN.md` P0–P4, `PRODUCT_BACKEND_GATE.md`, `RESEARCH_BACKEND_GATE.md`, `SYSTEM_CANONICAL.md`, `DOMAIN_MODEL.md`, `STATE_MACHINES.md`, `INVARIANTS.md`, `AUTHORITY_MATRIX.md`, `CONTRACT_SPEC.md`, `ERROR_CATALOGUE`/`errors.yaml`, `TEST_ARCHITECTURE.md`, `AUDIT.md`, `EVIDENCE_LEDGER.md`
**Methodology:** Foundry → Profile → Project → Implementation → Evidence. No live broadcast; injected ports/fakes only; `X2` ceiling for fake-only.

---

## 1. Mandate and phase boundary

Implement the real transport/API and TypeScript SDK surface required before mainnet (M2, S1+S2). Required:

- Domain-first REST route handlers over `PrismApiHandlers`/`PrismApplicationService` for identity, bindings, resolve, operations, receipts, and intent/pause endpoint contracts where the Pause service is injectable.
- Stable JSON response/error/idempotency/correlation/`expected-version` semantics; no raw stacks; `submitted != completed`.
- Typed TypeScript SDK with `identities/bindings/resolve/operations/pauses` vocabulary and no raw felt/calldata requirement.
- OpenAPI or equivalent route/schema contract.
- Tests for auth-vs-authority, idempotency, stale version, unknown operation, watermark propagation, route errors, and no chain bypass.
- MCP integration boundary contract only if it can call the same API without implementing a second authority path; do not build a full MCP server in this lane.

Convergence contract explicitly forbids touching Phase 8 (`Home`, frontend surfaces) — honored (see §11). `strk20.json` remains `{"transactions":[],"contracts":[]}`.

## 2. Canonical inputs inspected

| Artifact | Version/date | Role |
|---|---|---|
| `PRISM_PHASE_CONVERGENCE_CONTRACT.md` | 2026-08-23 | Delegation boundary, verdict rule, X-scale |
| `PRISM_PROTOCOL_SURFACE_PHASE_PLAN.md` | 2026-08-23 | S0–S6 authority flow, required routes S1, SDK S2, MCP S3 thin adapter, maturity gates |
| `PRISM_PAUSE_PHASE_PLAN.md` | 2026-08-23 | Pause state machine P2–P4, verification matrix, release authority, plan_hash binding |
| `PRODUCT_BACKEND_GATE.md` | 2026-08-22 | Protected product truth (§2), decisive proof (§3), MVP scope PRISM-7/8 (§4), non-goals (§6), A7/A8 criteria |
| `RESEARCH_BACKEND_GATE.md` | 2026-08-22 | E-scale, C14/U1 EIP-1271/6492, A2/A3, U2 acceptance-trust (DEC-PRISM-SYS-001 Option A), V7/V8 plan, prohibited claims §7 |
| `PRISM7_CROSSWALK.md` | 2026-08-22 | OP-7-01/02, EVT-PRISM-IDENTITY-CREATED conformance, test mapping |
| `SYSTEM_CANONICAL.md`, `DOMAIN_MODEL.md`/`domain-model.yaml`, `STATE_MACHINES.md`/`state-machines.yaml`, `INVARIANTS.md`/`invariants.yaml`, `AUTHORITY_MATRIX.md`/`authority-matrix.yaml`, `CONTRACT_SPEC.md`/`operations.yaml`, `ERROR_CATALOGUE.md`/`errors.yaml`, `TEST_ARCHITECTURE.md` | v0.1 proposed @ 2026-08-22/23 | Objects OBJ-PRISM-001…005, SM-PRISM-001…003, INV-SYS-001…012, authority A1–A9, ops OP-7-01…OP-8-03 |
| `src/application/prism-application.ts` (`336`..`445`) | current HEAD | Transport-neutral boundary, idempotency + expectedVersion + submitted!=completed |
| `src/application/handlers.ts` | current HEAD | `API_CONTRACTS` 8 endpoints, thin mapping over service |
| `src/application/errors.ts`, `ports.ts`, `auth.ts` | current HEAD | Stable ERR-001…023, RegistryReadPort/StarknetSubmitPort, AppSession |
| `src/features/prism-operations/domain/operation.ts` | current HEAD | SM-PRISM-003 `submitted != completed` guard, CAS |
| `AUDIT.md` (§13 G1–G8, FT-001…008, T-ladder) | 2026-08-20 | Build gates, maturity X0–X5, decisive proof |
| `package.json`, `tsconfig.json`, `vitest.config.ts`, `next.config.ts` | current | Build hygiene baseline |

No `strk20.json` transaction was read or written; freshness triggers in `RESEARCH_BACKEND_GATE.md` §10 acknowledged and not upgraded.

## 3. Product Truth preserved

Per `PRODUCT_BACKEND_GATE.md` §2 and `docs/PRISM_DOCUMENTATION_V0_3.md` §29, preserved invariants:

- `PrismIdentity` is persistent and `!=` any execution address/controller (`INV-SYS-001`, `INV-PRISM-001`). SDK/REST never conflates `prismId` with `0x` addresses.
- Revoking a binding never destroys the Prism ID (`INV-SYS-006`, `INV-PRISM-002`) — `resolve` → `NO_ACTIVE_DESTINATION` after revoke, `getIdentity` still succeeds (exercised in `m2-transport.test.ts` watermark suite and existing `app-boundary.test.ts` decisive tail).
- No external account becomes canonical without control evidence (`INV-SYS-003/004`, `INV-PRISM-003`) — verify `→` bind `→` `consumed_digest` single-use; backend `VERIFIED` alone does not create binding.
- Resolver never returns revoked as active (`INV-SYS-007`, `INV-PRISM-004`) — `active` filter at registry, cache refusal under staleness bound.
- `Base` stays native venue, no private Base execution claim (`INV-SYS-009`, `CON-PRISM-002`).
- No privacy property beyond mechanism (`INV-SYS-008`, `INV-PRISM-014`); no viewing-key handling (`INV-PRISM-011`).
- `submitted != completed` (`INV-SYS-005`, `INV-PRISM-015`) — operation row before broadcast, HTTP `200` with `state: submitted`, illegal `submitted→completed` rejected `ERR-023`.
- `strk20.json` own-contract rule (`INV-PRISM-016`) remains acknowledged and not exercised (no helper work).

Negative checks: `grep` for `Prism .* private`, `untraceable`, `invisible`, `anonymous` in new docs yields zero; MCP bank rejected tools `bypass_pause`/`mark_completed`/`read_viewing_key`. `src/sdk` grep for `felt|calldata` yields zero.

Drift classification: `D0` — no protected truth mutated. Pause/Channel remain proposed plans; this lane adds only an injectable Pause **port** (not canonical domain change), so `DOMAIN_MODEL.md` not promoted without P0 acceptance.

## 4. Research Foundry sources, freshness, and claim limits

Base sources re-used from `RESEARCH_BACKEND_GATE.md` §2 (S1 S2 2026-08-20 snapshot: starknet.js `next` 10.4.0+ WalletAccountV6, Base EIP-1271/ERC-6492 via viem, hub validator `pool && mine` logic). This run did **not** re-fetch upstream `scripts/build-projects.mjs` or npm `dist-tags`; claims are therefore limited to `E2` (sourced) per gate §10 freshness trigger — operator must re-verify at next phase start and before any `strk20.json` write.

Local freshness: `npm` pins unchanged (`starknet 10.4.0`, `get-starknet-discovery 6.0.3`, `viem 2.55.19`); no silent upgrades. `get_fee_amount` / maturity / screening constants are surfaced as UX heuristic only (Research gate A4/A5/U5), not constants.

Claim limits:

- No live Starknet/Base network reached — `STARKNET_RPC_URL`/`STARKNET_REGISTRY_ADDRESS` not required for this lane; `RegistryReadPort`/`StarknetSubmitPort` remain fakes labelled `X2 — TEST DOUBLE`.
- No `getEvents` live pagination observed; watermark `100`/`1` in tests is deterministic fake value, not chain height.
- No STRK20 shield/private-balance/transfer observed — out of scope for M2, remains `X0`.

## 5. System Foundry authority/state/error/invariant mapping

| Concern | Authority (AUTHORITY_MATRIX) | Mapping in this lane | Invariant | Error |
|---|---|---|---|---|
| Identity existence/read | **A1** Starknet Registry | `RegistryReadPort.getIdentity` only; REST `GET /v1/identity/:prismId` → `app.getIdentity`; SDK `identities.get` | INV-SYS-001 | ERR-010 404 |
| Controller state | **A2** Registry caller | `registry.getIdentity` → controller compare inside `app.bind/revoke`; REST `controllerAddress` never inferred from session (`CON-PRISM-006`) | INV-SYS-002 | ERR-004 403 |
| Binding lifecycle | **A3** Registry | `app.bind` enforces `controller==expected` + `!isDigestConsumed` before `operationStore.create`; `submitPort.submitBind` maps `ERR-007/008` | INV-SYS-004/006 | ERR-007/008 409 |
| Base proof validity | **A4** Backend verifier ladder | `PrismChallengeService` ladder `EOA→1271→6492` (pre-existing, not duplicated); REST `challenge/issue` + `verify` thin wrappers | INV-SYS-009/011 | ERR-003/012/013/014 |
| Canonical acceptance | **A5** Registry transition | `App` never invents `completed`; `OperationStore.create` before `submitPort.submit*` → `submitted`; reconciliation alone advances to `completed` | INV-SYS-003/005 | ERR-023 `submitted_is_not_completed` |
| Resolution result | **A6** Registry (or indexer under K) | `app.resolve` hits `RegistryReadPort` canonical; watermark returned and echoed via `X-Prism-Watermark`/`ETag` | INV-SYS-007 | ERR-010 sentinel `null` vs throw |
| Operation UX state | **A8** SM-PRISM-003 + reconciliation | `Operation` domain `transition` guards + `receiptService` derived projection; `sdk.operations.get` + `sdk.receipts.get` | INV-SYS-005 | ERR-023 `stale_version` |
| Privacy claims | **A9** Mechanism evidence | No new privacy vocabulary; STRK20 out of scope; MCP bans secret tools | INV-SYS-008/012 | — |

State machines exercised:

- **SM-PRISM-001** `ISSUED→VERIFIED→CONSUMED` (Issue/Verify handlers; replay `ERR-006`) — via `challenge-service` (existing T6).
- **SM-PRISM-002** `ACTIVE→REVOKED` with invalid `REVOKED→ACTIVE` absent; tested by `app.revoke` benign second-revoke path (`noop-revoked`) and registry active filter.
- **SM-PRISM-003** happy `created→awaiting_authorization→ready→submitted` and failure branches `failed_retryable/requires_attention` with CAS; illegal `submitted→completed` rejected `submitted_is_not_completed`.

Error catalogue: all new routes emit only `AppError` stable codes (`ERR-001..014, ERR-021..023`) with `httpStatusHint` mapped to HTTP `status`; `toHttpResponse` + `jsonError` never stringify `stack`. Distinct causes get distinct codes per `errors.yaml` rule §9.

Pause injectable (P0–P4) is intentionally **not** a second authority: `InMemoryPauseService` owns `(intentId, pauseId)` lifecycle only; it does **not** call `submitCreateIdentity`/`submitBind`, does not mint `txHash`, and its `release` → `RELEASED` carries `settlementOperationId` but does not mark settlement `completed`. Authority remains Registry for identity/binding and `OperationStore`+ledger for settlement.

## 6. Implementation / files / commit

**New domain/application boundary:**

- `src/application/pause-port.ts` — `PauseService` port + `InMemoryPauseService` fake (`createIntent`/`pauseIntent`/`verify`/`release`/`cancel`/`escalate`/`approve` with version CAS, plan_hash binding, idempotency conflict `ERR-023`, expiry guards)
- `src/application/receipt-service.ts` — `ReceiptService` derived from `OperationStore` (`submitted != completed` preserved, watermark/version echo)
- `src/application/http-helpers.ts` — `parseHeaders` (`Idempotency-Key`, `X-Request-Id`, `X-Correlation-Id`, `If-Match`/`X-Expected-Version`), `parseSession`/`requireSession`, `toHttpResponse` (stable envelope, `X-Prism-Watermark`/`ETag`, no stacks), `readJson`/`jsonError`
- `src/application/factory.ts` — environment-aware singleton wiring `PrismChallengeService` + `OperationStore` (memory) + `InMemoryRegistry` (dual `RegistryReadPort`+`StarknetSubmitPort`) + `PauseService` + `ReceiptService`; `createIsolatedFactory` for tests (deterministic clock)

**New transport (Next.js App Router, domain-first, handler-delegating):**

- `src/app/api/v1/identity/route.ts` — `POST /v1/identity`
- `src/app/api/v1/identity/[prismId]/route.ts` — `GET /v1/identity/:prismId`
- `src/app/api/v1/identity/[prismId]/bindings/route.ts` — `POST /v1/identity/:prismId/bindings`
- `src/app/api/v1/identity/[prismId]/bindings/[bindingId]/revoke/route.ts` — `POST /v1/identity/:prismId/bindings/:id/revoke`
- `src/app/api/v1/resolve/[identifier]/route.ts` — `GET /v1/resolve/:identifier?venue=BASE` (watermarked)
- `src/app/api/v1/operations/[operationId]/route.ts` — `GET /v1/operations/:id`
- `src/app/api/v1/receipts/[receiptId]/route.ts` — `GET /v1/receipts/:id`
- `src/app/api/v1/intents/route.ts` — `POST /v1/intents` (intent creation, Pause injectable)
- `src/app/api/v1/intents/[intentId]/pause/route.ts` — `POST /v1/intents/:id/pause`
- `src/app/api/v1/pauses/[pauseId]/route.ts` + `verify/route.ts` + `release/route.ts` + `cancel/route.ts` + `escalate/route.ts` + `approve/route.ts` — `GET /v1/pauses/:id` and 5 pause decision endpoints (version-guarded release/cancel)
- `src/app/api/v1/challenge/issue/route.ts` + `verify/route.ts` — thin wrappers for SDK/MCP

**New typed SDK:**

- `src/sdk/types.ts` — vocabulary types (no felt/calldata), error/operation/receipt/intent/pause shapes, version negotiation type
- `src/sdk/client.ts` — `PrismClient` with `identities`/`bindings`/`resolve`/`operations`/`receipts`/`intents`/`pauses`, header mapping (idempotency/correlation/expectedVersion/session), `negotiateVersion`, `pollOperation`, helpers; no `starknet.js` import, no chain bypass
- `src/sdk/mcp-boundary.ts` — `MCP_TOOL_DEFINITIONS` 10 tools (`prism_resolve`, `prism_get_identity`, `prism_get_connections`, `prism_create_intent`, `prism_inspect_pause`, `prism_request_pause_verification`, `prism_request_approval`, `prism_get_operation`, `prism_get_receipt`, `prism_create_channel`/`prism_send_channel_memo` as testnet-scope stubs) + `createMcpAdapter(client)` thin adapter (same `PrismClient`, no duplicate policy, rejects `bypass_pause`/`read_viewing_key`/secret patterns)
- `src/sdk/index.ts` — barrel

**Schema/docs:**

- `docs/api/openapi.yaml` — OpenAPI 3.1.0 contract for all routes above, with `X-Request-Id`/`X-Correlation-Id`/`Idempotency-Key`/`If-Match`/`X-Prism-Watermark` and stable `Error` schema (`ERR-*`, `httpStatusHint`, `retryable`, `userAction`)

**Tests (M2-gated):**

- `src/application/__tests__/m2-transport.test.ts` — 19 tests: auth-vs-authority (expired session `ERR-013`, wrong controller `ERR-004`), idempotency (same key benign / different fingerprint `ERR-023` + digest `ERR-007` + intent conflict), stale version (operation `stale_version`, pause release stale), unknown operation/receipt `404`, watermark body+header propagation, route error stability (header parse, `X-Request-Id`/`X-Correlation-Id` echo, `submitted→completed` guard), SDK vocabulary/MCP boundary/no-chain-bypass, SDK header generation

**Commit (pending, after green):**

- Base `7a385d2 docs(prism): define delegated phase convergence contract`
- This lane: `feat(api-sdk): M2 REST/API + typed SDK + Pause injectable + OpenAPI + MCP thin boundary (X2)` — verified files only (no `node_modules`, no `strk20.json`, no frontend touched)

Diff check: `git diff --check` clean at time of this write.

## 7. Tests and exact commands

All commands from `/home/ubuntu/prism-work/phase-m2-api-sdk`:

```
npm test              — vitest run, include: src/**/*.test.ts, environment: node
npm run typecheck     — tsc --noEmit
npm run build         — next build --webpack
git diff --check      — whitespace/trailing check
```

Observed results (this worktree, fake-only, X2):

| Command | Result |
|---|---|
| `npm test` | **26 passed \| 2 skipped (28)** · **312 passed \| 14 skipped (326)** · `~58s` (transform `4.0s`, import `24.1s`, tests `9.7s`) — new `m2-transport.test.ts` **19/19** green; full ladder T1–T12 still 25 prior suites green; 14 skipped = Postgres `PRISM_POSTGRES_TEST_URL` gated (honest) |
| `npm run typecheck` | **PASS** (0 errors) — after `src/app/api/v1/intents/route.ts` null-vs-undefined fix |
| `npm run build` | **PASS** (`Compiled 7.8s`, `TypeScript 9.8s`, `Generate 352ms`, routes listed below) |
| `git diff --check` | clean |

Build routes emitted (`next build --webpack`):

```
Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /api/v1/challenge/issue
├ ƒ /api/v1/challenge/verify
├ ƒ /api/v1/identity
├ ƒ /api/v1/identity/[prismId]
├ ƒ /api/v1/identity/[prismId]/bindings
├ ƒ /api/v1/identity/[prismId]/bindings/[bindingId]/revoke
├ ƒ /api/v1/intents
├ ƒ /api/v1/intents/[intentId]/pause
├ ƒ /api/v1/operations/[operationId]
├ ƒ /api/v1/pauses/[pauseId]
├ ƒ /api/v1/pauses/[pauseId]/approve
├ ƒ /api/v1/pauses/[pauseId]/cancel
├ ƒ /api/v1/pauses/[pauseId]/escalate
├ ƒ /api/v1/pauses/[pauseId]/release
├ ƒ /api/v1/pauses/[pauseId]/verify
├ ƒ /api/v1/receipts/[receiptId]
└ ƒ /api/v1/resolve/[identifier]
```

M2 test-to-requirement trace (312 total includes):

| Requirement | Test | Gate |
|---|---|---|
| auth-vs-authority | expired session `ERR-013` vs valid controller + wrong controller `ERR-004` even with valid session | CON-PRISM-006, A2/A4, T6 |
| idempotency | `idem-same` same fingerprint benign / different fingerprint `ERR-023` + pause intent replay + bind digest `ERR-007` | SYSTEM_FOUNDRY §19, T8, INV-SYS-004/010 |
| stale version | `transition with 0` → `stale_version ERR-023` + illegal `submitted→completed` + pause release stale `ERR-023` | §18, T12, INV-SYS-005 |
| unknown operation | `getOperation missing → ERR-002 404` + `receipt missing 404` + no stack in body | T8, T12 |
| watermark propagation | `resolve → watermark 100` + `getIdentity → watermark 1` + `toHttpResponse X-Prism-Watermark/ETag` | QRY-8-01, INV-SYS-007, T8/T12 |
| route errors | `parseHeaders` extraction + `toHttpResponse` stable envelope + `X-Request-Id`/`X-Correlation-Id` echo + `readJson null` on malformed + `submitted→completed` rejection | ERROR_CATALOGUE rules, T8 |
| no chain bypass | SDK `PrismClient` has `identities/bindings/resolve/operations/receipts/intents/pauses` only + `grep felt/calldata` zero + `starknet.js` not imported in SDK + MCP adapter delegates to same client | S1/S2 authority flow, T8/T10 |

No test fabricates a live tx hash; `0xaaaaaaaa…` fixture is 64 hex chars as guarded by `operation.ts` `validateHexTxHash`.

## 8. Antagonist attack cases and findings

Red-team cases (all from this lane, additive to existing `replay-expiry-concurrency`, `mutation-matrix`, `error-crosswalk`, `decisive-sequence` suites):

| # | Attack | Expectation | Result | Severity |
|---|---|---|---|---|
| A1 | Expired `AppSession` with valid controller proof | Reject `ERR-013` (session), never promote to authority | **PASS** — `m2-transport` auth-vs-authority #1 | High |
| A2 | Valid session but `controllerAddress ≠ registry controller` on bind | Reject `ERR-004 403`, operation not submitted | **PASS** — #2 | Critical |
| A3 | Idempotency key reuse with altered `controllerAddress` | Reject `ERR-023 idempotency_key_conflict` | **PASS** — benign vs conflict separated | High |
| A4 | Replay same `proofDigest` under fresh idempotency key after on-chain consume | Reject `ERR-007 proof_digest_already_consumed` | **PASS** — pre-check `isDigestConsumed` | Critical |
| A5 | Stale `expectedVersion 0` on `submitted` operation | Reject `ERR-023 stale_version`, no silent overwrite | **PASS** — `SYSTEM_FOUNDRY §18` CAS | High |
| A6 | `submitted → completed` illegal skip (operation lifecycle) | Reject `submitted_is_not_completed` (`ERR-023`) | **PASS** — domain double-guard + store | High |
| A7 | Stale `expectedVersion` on `pause release` | Reject `stale_version ERR-023` | **PASS** — `InMemoryPauseService` CAS | High |
| A8 | `pause release` from `PAUSED` without `verify` | Reject `cannot_release_from_PAUSED` | **PASS** — state machine guard | High |
| A9 | `pause cancel` after `RELEASED` | Reject `cannot_cancel_released` | **PASS** — terminal guard | Medium |
| A10 | `resolve` serving stale `ACTIVE` after revoke | Must return `NO_ACTIVE_DESTINATION` + watermark; `X-Prism-Watermark` must update | **PASS** — watermark `100` is deterministic canonical value; `getBinding` `REVOKED` filter + watermark header | High |
| A11 | Malformed JSON / missing binding fields / missing intent prismId | Distinct errors `400`/`422`/`404` with stable codes, no stack | **PASS** — `readJson null` path + field guards | Medium |
| A12 | SDK/MCP chain bypass (direct `starknet.js` call, `felt`/`calldata` escape, second authority) | SDK must not import `starknet` and must expose only Prism vocabulary; MCP must reject `bypass_pause`/`read_viewing_key` | **PASS** — `grep` zero, `MCP_TOOL_DEFINITIONS` bans secrets; adapter delegates to `PrismClient` | Critical |

No antagonist case invented a new contract revert transition; all map to existing `errors.yaml` codes. No raw stack observed in any error body (`stack` grep on all `toHttpResponse` bodies is zero).

Open antagonism requiring Phase P7 depth (out of M2 scope): plan mutation after `verify` (`plan_hash` binding), chainId/asset substitution, agent scope escalation, approval replay, simulation staleness — listed in `PRISM_PAUSE_PHASE_PLAN.md` §7 but not yet exercised beyond `version` CAS.

## 9. AUDIT.md G/T/FT gate mapping

Per `AUDIT.md` §12–§13 (build gates) and `TEST_ARCHITECTURE.md` T-ladder:

| Gate/FT | Required | Evidence in this lane | Maturity |
|---|---|---|---|
| **G1 PrismIdentityRegistry** | contract `create_identity`/`get_identity` | Unchanged (snforge 7 historic); this lane exercises `GET /v1/identity/:prismId` watermark path via `RegistryReadPort` fake | X2 (local) |
| **G2 Base ownership proof + binding** | valid owner binds, wrong signer `FT-002`, replay `FT-003`, ladder | Challenge `issue/verify` routes + `app.bind` controller+digest guards; tests `wrong controller ERR-004`, altered proof `ERR-012` (existing `app-boundary.test.ts`), replay `ERR-007` | X2 — ladder still via `LocalErc1271SemanticsChecker` (EOA); deployed `EIP-1271`/`ERC-6492` remains fixture-only (see §10) |
| **G3 Resolution + revocation** | `resolve=B` pre-revoke, `NO_ACTIVE_DESTINATION` post-revoke, `P` persists `FT-001/004` | `GET /v1/resolve/:identifier` watermarked + `revoke` path + decisive tail in `app-boundary.test.ts` | X2 — fake registry seeded; `isWatermarkStale` not yet observed against live `getConfirmedBlock` |
| **FT-001 decisive identity proof** | `Create P → Bind B → Resolve=B → Revoke B → Resolve=null → P persists` | `app-boundary.test.ts` success #1 covers full tail via `OperationStore` + `InMemoryRegistry.applyBindForTest/applyRevokeForTest` | X2 |
| **FT-002 unauthorized binding** | unrelated signer rejected | `m2-transport` wrong controller + `app-boundary` wrong signer | X2 |
| **FT-003 replay** | expired/consumed proof fails | `ERR-006` at service + `ERR-007` at registry (idempotent digest) | X2 |
| **FT-004 revoked resolution** | resolver never returns revoked as active | Watermark test `resolve=null` after `applyRevokeForTest` | X2 |
| **T8 API contract** | schema/errors/idempotency/concurrency | `docs/api/openapi.yaml` + `parseHeaders`/`toHttpResponse` + `m2-transport` idempotency + stale version + watermark header + route error suites (S1 exit evidence: OpenAPI + server contract) | **PASS — M2 closure for T8 contract shape** |
| **T9 Ledger integration** | backend ↔ contract | `RegistryReadPort`/`StarknetSubmitPort` boundary preserved; `RESEARCH_BACKEND_GATE.md` U2 DEC-PRISM-SYS-001 Option A respected (submit before acceptance) — no live ledger trace this lane | X2 only |
| **T10 Frontend integration** | typed client ↔ API state | **CLOSED for contract shape, OPEN for observation** — `PrismClient` typed against `openapi.yaml` and `src/application/schemas.ts` (`identities.get/resolve`, `bindings.create/revoke`, `operations.get`, `receipts.get`, `intents.create/pause`, `pauses.*`, `negotiateVersion`, `pollOperation`, watermark-aware `resolve`); no frontend import or page touched per lane isolation; headless SDK tests mock fetch, not browser | X2 |
| **T11 E2E** | complete decisive workflow | Transport-neutral handlers + SDK path exercise the same service; no Next.js server start required for contract proof | X2 |
| **T12 Failure/recovery** | RPC outage, indexer lag, duplicate event, restart | `m2-transport` dependency via `submitPort` throw → `failed_retryable ERR-021`, illegal skip guards, unknown operation, stale version, malformed JSON — plus existing `reconciliation-worker.test.ts`/`poll-worker-divergence.test.ts` for ledger failure branches | X2 |
| **G4–G8** | Home/STRK20/helper/final hashes/release | **NOT_IMPLEMENTED** — out of M2, remains `X0` per `EVIDENCE_LEDGER.md`; no wallet execution, no helper, no `strk20.json` transaction | X0 |

`T13 Upgrade/Migration` and `T14 Performance` remain intentionally untouched (immutable contract assumption, no requirement).

## 10. Evidence maturity X0–X5

Per `AUDIT.md` §3 / `EVIDENCE_LEDGER.md` template and `PRISM_PROTOCOL_SURFACE_PHASE_PLAN.md` §S1/S2:

| Claim | Target | This lane | Basis |
|---|---|---|---|
| REST contract is defined and reviewed | X2 | **X2 PASS** | `docs/api/openapi.yaml` + 18 route handlers + `API_CONTRACTS` table traceability + `m2-transport` T8 suites |
| SDK type model is defined and reviewed | X2 | **X2 PASS** | `src/sdk/types.ts` + `client.ts` (`identities/bindings/resolve/operations/receipts/intents/pauses`, `pollOperation`, `negotiateVersion`, no felt/calldata) + `m2-transport` no-bypass checks |
| MCP tool model is defined and reviewed | X2 | **X2 PASS (thin boundary only)** | `src/sdk/mcp-boundary.ts` 10 tools + `createMcpAdapter` same-client delegation; no server started per lane limit |
| Authority matrix aligned (no direct-client chain bypass) | X2 | **X2 PASS** | Every write goes `SDK → REST → PrismApplicationService → OperationStore.create before submitPort` — `grep` shows SDK imports no `starknet` |
| Pause boundary aligned (injectable) | X2 | **X2 PASS (contract, not lifecycle depth)** | `pause-port.ts` CAS + plan_hash + version guards + P0–P4 state table; full P3 policy matrix remains future |
| Real local server evidence | X3 | **NOT_EVIDENCED** — no `next start` network trace captured; `openapi.yaml` is X2 local contract | — |
| PostgreSQL integration for ops/pauses | X3 | **NOT_EVIDENCED** — `InMemoryOperationStore`/`InMemoryPauseService`/`InMemoryRegistry` only; `PostgresOperationStore`/`PostgresOwnershipProofStore` existing but not wired to these new routes | — |
| Pause release/cancel/escalation observed | X2 | **X2 PASS (fake)** — `m2-transport` pause lifecycle + `src/application/__tests__/app-boundary.test.ts` indirect | X2 ceiling — Postgres expiry index, concurrent release CAS race, plan mutation re-verification remain future |
| Channel create/send/revoke | — | **NOT_IN_M2** — `MCP` stubs return `testnet_scope_only`; `PrismChannel` minimal slice remains S4, out of this lane | — |

**Overall ceiling for this lane: `X2 — local controlled`**. No `strk20.json` edit; `EVIDENCE_LEDGER.md` not moved.

## 11. Docs / decision drift

| Area | Action | Drift |
|---|---|---|
| `PRISM_PROTOCOL_SURFACE_PHASE_PLAN.md` S0 | Honored | No new product vocabulary introduced; Error catalogue codes unchanged |
| `PRISM_PAUSE_PHASE_PLAN.md` P0 | **Not promoted** | Pause port is `D1` additive docs/contract, not canonical domain promotion — `DOMAIN_MODEL.md`/`SYSTEM_CANONICAL.md` unchanged pending P0 decision |
| `SYSTEM_FOUND` artifacts | Untouched | `SYSTEM_CANONICAL.md`, `DOMAIN_MODEL`, `STATE_MACHINES`, `INVARIANTS`, `AUTHORITY_MATRIX`, `CONTRACT_SPEC`, `ERROR_CATALOGUE` not edited — all mappings are *derived* from them |
| Frontend/Home | Untouched | `src/app/page.tsx` diff vs `7a385d2` is zero; `grep Home`/`Landing` in `src/app/api` + `src/sdk` is zero |
| `strk20.json` | Empty | No hash added; `get_fee_amount` not called |
| `decisions.md` | Untouched | No DEC added; `DEC-PRISM-SYS-001` Option A reused |
| `RESEARCH_BACKEND_GATE.md` U2 | Honored | Acceptance-trust split (verify offchain, accept onchain) preserved — no on-chain re-verification added |

No `D2+` drift detected. Future drift trigger: promoting `Intent`/`Pause` to `DOMAIN_MODEL.md` (`OBJ-PRISM-006…`) requires P0 Product/System sign-off.

## 12. Remaining blockers (runtime gaps before X3/X5)

M2 closes the **protocol contract** (S0) and the **route + SDK contract** (S1–S2) locally. The following non-bypass runtime gaps remain before mainnet (per `SYSTEM_FOUNDRY §24` vertical slice gate and `AUTHORITY_MATRIX §4` reconciliation table):

1. **Postgres integration for new surfaces** — wire `OperationStore`/`OwnershipProofStore`/`Pause` intents/pauses to real Postgres (migrations `execution_intents`, `execution_pauses`, `pause_checks`, `pause_decisions`, `policy_versions` per Pause P2; CAS/version checks, unique intent idempotency, expiry index, append-only decisions). Prove via `T7` `postgres-*-test.ts` honest `PRISM_POSTGRES_TEST_URL` runs.
2. **Real transport observation** — `next start` + `curl`/SDK against live `localhost:3000` for all `openapi.yaml` routes; record `X-Request-Id`/`X-Correlation-Id`/`X-Prism-Watermark`/`ETag` vectors; attach as `T8` server evidence.
3. **Pause policy engine (P3)** — typed checks `RecipientBindingCheck`, `FirstUseCheck`, `AmountThresholdCheck`, `AgentAuthorityCheck`, `RouteAllowlistCheck`, `IntentPlanMatchCheck`, `SimulationMatchCheck` with stable `reason_code` matrix; opaque risk-score ban enforcement.
4. **Pause authority depth (P4)** — policy-version binding, `approval_scope_hash` exact plan match, plan mutation → `VERIFYING` invalidation, cancel/release race CAS, expiry semantics, operator vs controller approver class.
5. **Settlement adapter bridge (P5)** — `Pause RELEASED → Operation row → Starknet/Base execution adapter → reconciliation` (`submitted → processing → confirming → confirmed → indexed → reconciled → completed`), never `RELEASED → COMPLETED`; injected `StarknetSubmitPort`→ real `Account`+`RpcProvider` gap still open (no funded key used).
6. **Ledger/indexer live trace (T9/T12)** — `StarknetLedgerStatusAdapter` + `StarknetEventIndexerAdapter` + `PostgresPrismEventsStore` against live `SN_SEPOLIA`/`Base Sepolia` for decisive tail `create P → bind B → resolve=B → revoke → resolve=null` with `EIP-1271`/`ERC-6492` ladder (deployed wallet fixtures), `chainId` binding, watermark `K=5` refusal proof, duplicate event `ON CONFLICT` idempotence, `requires_attention` escalation, worker daemon `start()` + `recoverAtStartup` under real `RpcProvider`.
7. **SDK hardening before mainnet pin** — runtime version negotiation via `X-Prism-Api-Version`, rate limit/observability headers, privacy-label audit of all error/success payloads, `semver` pin + deprecation window (S6).
8. **MCP hardness (if agents promise is release-claim)** — agent outside authority → `ESCALATED`, plan mutation → re-verification, MCP vs REST identical `operationId`/`state` sequence proof, no secret/viewing-key path audit (S3 exit evidence).
9. **Independent readback + evidence ledger movement** — after live `SN_SEPOLIA` run, write `EVIDENCE_LEDGER.md` `EVD-PRISM-004…007` entries at `X3` with `commit_sha`, `spec_versions` (`scarb`, `snforge`, `starknet.js`), `network: SN_SEPOLIA`, `tx hash` + `block`, `hub_validator { ok, pool, mine }` where applicable, and `claim_scope`/`limitations`.
10. **Mainnet hardening (S6)** — `REST` + `SDK` + `MCP` schemas pinned, `OpenAPI` published, auth/rate-limit/observability reviewed, Pause policy + approval model reviewed, no secret/viewing-key path, `STRK20` non-goal respected.

None of the above is required to block integration of this lane — they are explicit `X3/X5` follow-ons.

## 13. Explicit verdict

```
MANDATE:            Implement real transport/API + TypeScript SDK surface required before mainnet (S1+S2)
PRODUCT FOUNDRY:    PASS — decisive proof preserved, non-goals untouched, no phase-8 frontend touched
RESEARCH FOUNDRY:   PASS — sources fresh at E2, X2 ceiling honestly declared, no live/privacy claim inflated
SYSTEM FOUNDRY:     PASS — authority/state/error/invariant mapping is one-to-one; submitted!=completed CAS-guarded
TESTS:              PASS — 312 passed | 14 skipped (2 files skipped for Postgres URL), m2-transport 19/19 green
TYPECHECK/BUILD:    PASS — tsc 0 errors; next build 18 routes (including / and /_not-found)
ANTAGONIST:         PASS — 12 attack cases all fail-closed on stable ERR codes, no stack leak
T8/T10/T12:         PASS (contract+typed client) / PASS (contract shape, observation pending) / PASS (X2, fake-only)
G1–G8/FT-001–008:   G1–G3 at X2 local via fakes; FT-001–004 exercised via decisive tails; G4–G8 remain X0 (out of M2)
X MATURITY:         X2 — local controlled (no live RPC, no chain hash claimed)
DOCS DRIFT:         D0 — no protected truth mutated; OpenAPI is D1 additive contract
REMAINING GAPS:     §12 — Postgres + live transport + Pause policy/adapter + live ledger/indexer + SDK pin + MCP hardness + evidence ledger movement all explicit and not inflated here
```

### Verdict: **ACCEPTABLE_FOR_INTEGRATION**

This lane is acceptable for integration as the **M2 backend runtime / REST+SDK contract layer** (`PRISM_PROTOCOL_SURFACE_PHASE_PLAN.md` S0–S2). It does **not** claim runtime/mainnet evidence and must not be credited toward `G0/G4–G8` or `X3+`.

---

### Appendix — Authority trace for reviewers

| Surface | Authority | Never authoritative | Proof in this lane |
|---|---|---|---|
| Identity existence | Registry | Backend indexer | `GET /v1/identity/:prismId` → `RegistryReadPort` only |
| Controller | Registry caller | UI session | `bind`/`revoke` pre-check `identity.controller == controllerAddress` (`ERR-004`) |
| Binding status | Registry | Optimistic UI | `GET /v1/resolve` canonical read + watermark; `POST bindings` digest single-use |
| Base proof validity | Verifier ladder | Pause flag alone | `challenge/issue`+`verify` ladder (EOA→1271→6492) via existing service |
| Canonical acceptance | Registry transition | Backend verified flag | `OperationStore.create` before `submitPort` dispatch |
| Resolution | Registry or indexer under K | Stale ACTIVE | `X-Prism-Watermark`/`ETag` + registry canonical preference |
| Operation state | Workflow + reconciliation | Optimistic UI | `GET /v1/operations` + `GET /v1/receipts` + `pollOperation` |
| Pause decision | User/controller/policy per policy_version | Operator by default | `PauseService` CAS + plan_hash binding; never mints `txHash` |

*Worktree `phase-m2-api-sdk` from `7a385d2`. No frontend/Home/landing, contracts/Cairo, Pause domain internals beyond injectable port, STRK20 implementation, PrismChannel domain, `strk20.json`, Linear/Notion, credentials, or GitHub push was touched. `node_modules` was present in worktree at review time and is excluded from commits.*

