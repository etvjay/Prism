# Prism Testnet Rehearsal Packet

**Status:** `PREPARATION — READ-ONLY DRY-RUN ONLY; NO DEPLOYMENT OR BROADCAST`
**Candidate baseline:** local `HEAD fbced69e20067f18d6b80ab8b8eb80711e99a51a` in `/home/ubuntu/prism-work/prism-v0-backend-remediation`
**Target:** `SN_SEPOLIA` + `BASE_SEPOLIA` (`Base chain_id 84532`)
**Harness:** `ops/testnet-rehearsal/dry-run.mjs`
**Machine inventory:** `ops/testnet-rehearsal/endpoint-inventory.json`
**Evidence ceiling:** **X2 for this packet**. No new external receipt, readback, deployment, wallet, or provider observation was performed. Existing repository records are not re-verified or promoted here.

This packet is an executable rehearsal contract for the separate backend and
frontend teams. It inventories the current dirty snapshot without adopting the
snapshot's unrelated changes. It does not change application behavior, frontend
files, contracts, `strk20.json`, `projects/prism/EVIDENCE_LEDGER.md`,
`projects/prism/DECISIONS.md`, Linear, or Notion.

---

## 1. Scope boundary and truth contract

### Included

- source/spec inventory of the current REST endpoints, including the newly
  mounted alias, continuity, STRK20, and privacy-receipt surfaces;
- exact dependency order, happy path, failure path, recovery path, and evidence
  gates for backend and frontend lanes;
- environment/provider/wallet/Postgres requirements with configuration **names
  only**;
- a dependency-free read-only harness that validates the accepted target,
  endpoint shapes, OpenAPI path presence, source route presence, and optional
  runtime configuration shape;
- local self-tests and a local commit containing only these rehearsal files.

### Explicitly excluded

- `src/**` and all application behavior;
- frontend implementation or browser QA;
- `contracts/**`, `strk20.json`, and any mainnet configuration;
- deployment, declaration, account deployment, funding, wallet creation,
  wallet signing, contract invocation, transaction broadcast, or provider RPC;
- evidence-ledger, decision-ledger, audit-register, Linear, or Notion writes;
- fabrication of a Prism ID, transaction hash, block, receipt, class hash,
  watermark, alias association, privacy note, or maturity result.

The worktree is intentionally dirty from other lanes. A future live rehearsal
must freeze a candidate commit and re-run the scope check before using any
endpoint or evidence packet.

---

## 2. Maturity vocabulary (never collapse these states)

| State | Meaning in this packet | What it does **not** prove |
|---|---|---|
| `specified` | Canonical/system material or a named readiness requirement defines the surface. | That a route exists. |
| `implemented` | A local source route/domain boundary exists in the inspected snapshot. | Correct transport, persistence, signing, deployment, or live behavior. |
| `integrated` | Local route wiring to the application boundary is present and the packet records its limits. | A live `next start` trace, durable runtime, or provider success. |
| `deployed` | A matching contract/runtime artifact exists on the selected network and is read back. | That its API or product flow is complete. |
| `observed` | A direct provider response, receipt, event, HTTP trace, or projection read was actually captured. | Repeatability or independent verification. |
| `repeated` | The required restart/replay/second-provider or second-read path was exercised. | Mainnet readiness by itself. |
| `promotable` | The complete evidence envelope passes its validator and its claim scope is eligible for the declared X level. | A local dry-run or test-double result. |

**Rule:** a local source/test/dry-run result is X2 at most. Testnet X3
requires the target network, receipt/status/block, matching event/read, and an
independent read. X4/X5 remains a separate release-gated mainnet/repetition
claim. A worker report or a successful command exit code is not external
evidence.

The per-endpoint booleans for all seven states are in
`endpoint-inventory.json`. `integrated` there means local code wiring only;
it is deliberately not a synonym for `deployed` or `observed`.

---

## 3. Environment matrix

### 3.1 Target and provider requirements

| Scope | Network / chain ID | Provider requirement for a future live run | Wallet/provider capability | Postgres / projection requirement | Config names only |
|---|---|---|---|---|---|
| Starknet identity and binding plane | `SN_SEPOLIA` | A primary read provider must support network identity, class-hash-at-address, block, transaction status/receipt, contract call, and event pagination. A distinct second source is required for independent readback. | User-controlled `WalletAccountV6` or equivalent Starknet account on `SN_SEPOLIA`; controller signature is required for bind/revoke. This packet never asks it to sign. | Fresh test schema; event store and checkpoint store; persist events before checkpoint CAS; dedupe by `(tx_hash,event_index)`; keep `scanWatermark` distinct from `eventWatermark`. | `STARKNET_CHAIN_ID`, `STARKNET_RPC_URL`, `STARKNET_SEPOLIA_RPC_URL`, `NEXT_PUBLIC_STARKNET_NETWORK`, `NEXT_PUBLIC_STARKNET_RPC_URL`, `STARKNET_REGISTRY_VERSION`, `STARKNET_REGISTRY_ADDRESS`, `STARKNET_REGISTRY_CLASS_HASH`, `PRISM_STARKNET_INDEXER_START_BLOCK` |
| Base ownership-proof plane | `BASE_SEPOLIA`, EIP-155 `84532` | A primary Base provider must support chain identity, transaction receipt/block, contract code/call for EIP-1271 fixtures, and any provider-native read required by the verification ladder. Independent read must use a distinct source identity. | User-controlled Base EOA personal-sign/EIP-191 path; deployed smart-account EIP-1271 `isValidSignature`; undeployed-account ERC-6492 wrapper. The backend verifies validity only and never holds the signer. | No Base event projection is assumed for the identity proof; any Base read used by a policy/continuity check must be recorded as a source-scoped observation. | `BASE_RPC_URL`, `BASE_CHAIN_ID` |
| Durable backend runtime | Same selected testnet pair | No provider call is made by the dry-run harness. Future runtime requires provider configuration before constructing real readers or submit adapters. | No signer environment is required by this packet. Signer names, if provisioned later, remain outside repo and are never read by this harness. | `PRISM_POSTGRES_TEST_URL` or `PRISM_POSTGRES_URL`; production/rehearsal mode must fail closed rather than silently use memory; migrations, CAS, restart recovery, and connection shutdown must be verified. | `PRISM_POSTGRES_TEST_URL`, `PRISM_POSTGRES_URL`, `PRISM_REQUIRE_POSTGRES`, `PRISM_RUNTIME_MODE`, `PRISM_DOMAIN` |
| STRK20/private action plane | Starknet wallet on `SN_SEPOLIA` for this rehearsal; no mainnet action | Wallet-injected provider plus a separate independent read source. Capability discovery must be by `supportedWalletApi`/`supportedSpecs`, not by a balance read. | Wallet API/spec capability at or above the project boundary (`>=0.10.3`); correct network; explicit consent; `strk20PrepareInvoke`; real proof path for submission; receipt observer; pool event, note, maturity, and validator facts for full M5. | Private notes/viewing keys remain wallet/provider-owned. No backend persistence of private material. | `STARKNET_CHAIN_ID`, `NEXT_PUBLIC_STARKNET_NETWORK`, `STARKNET_REGISTRY_VERSION`, `BASE_CHAIN_ID` only for cross-surface context; wallet capability is observed, not configured through a secret env name. |
| Mainnet (not this packet) | `SN_MAIN` + Base Mainnet `8453` | Separate owner release gate, separate provider/config namespace, separate evidence envelope, and independent reread. | No mainnet wallet or provider operation is authorized here. | Not applicable to this rehearsal. | Mainnet names must not be substituted into testnet names. |

The matrix intentionally omits all URL, address, key, account, password, and
keystore values. The accepted target decision removes only the target-decision
blocker; it does not authorize a broadcast or promote evidence.

### 3.2 Runtime configuration checks

`dry-run.mjs --check-config` reads only environment-variable presence and
shape. It never prints values and never opens a socket. The optional
`--require-config` form requires these non-secret groups before a future
provider-backed rehearsal:

1. `STARKNET_CHAIN_ID` or `NEXT_PUBLIC_STARKNET_NETWORK`;
2. `STARKNET_RPC_URL`, `STARKNET_SEPOLIA_RPC_URL`, or
   `NEXT_PUBLIC_STARKNET_RPC_URL`;
3. `STARKNET_REGISTRY_ADDRESS` or `PRISM_REGISTRY_ADDRESS`;
4. `STARKNET_REGISTRY_VERSION` and `STARKNET_REGISTRY_CLASS_HASH`;
5. `PRISM_STARKNET_INDEXER_START_BLOCK`;
6. `BASE_RPC_URL` and `BASE_CHAIN_ID`;
7. `PRISM_POSTGRES_TEST_URL` or `PRISM_POSTGRES_URL`.

Signer names such as `STARKNET_SEPOLIA_DEPLOYER_PRIVATE_KEY`,
`STARKNET_SEPOLIA_KEYSTORE_PATH`, and `BASE_SIGNER_PRIVATE_KEY` are not read
by this harness. A future operator handles them privately and separately.

---

## 4. Backend endpoint inventory

The complete machine-readable inventory is
`ops/testnet-rehearsal/endpoint-inventory.json`. It includes request body/query
requirements, response shapes/statuses, audience, authority, side effects,
source state, and the seven maturity booleans. The abbreviated map below is the
route-level handoff.

### 4.1 Present local routes (31 candidate method entries)

| ID | Method and path | Local source state | Local wiring/evidence boundary |
|---|---|---|---|
| `ID_CREATE` | `POST /v1/identity` | Tracked route present | Session + idempotency; operation before chain submission; submitted is not completed. |
| `ID_READ` | `GET /v1/identity/{prismId}` | Tracked route present | Public canonical/watermarked read; `ERR-010` for unknown. |
| `BY_CONTROLLER` | `GET /v1/identities/by-controller?controller={controller}` | Tracked route present in the integrated snapshot | Canonical/projection readback returns `NONE`, `FOUND`, `MULTIPLE`, `UNKNOWN`, or `UNAVAILABLE`; candidate status remains `UNKNOWN`, and the direct route is intentionally outside the protected OpenAPI file. |
| `CHALLENGE_ISSUE` | `POST /v1/challenge/issue` | Tracked route present | Requires session, identity/execution account; returns schema-v2 chain-bound challenge. |
| `CHALLENGE_VERIFY` | `POST /v1/challenge/verify` | Tracked route present | Requires exact presented echo and signature; returns `verified` only, never ACTIVE. |
| `PUBLIC_BINDINGS_LIST` | `GET /v1/identity/{prismId}/bindings?audience=public` | Tracked route present | Public ACTIVE rows only; rejects PRIVATE/SELECTIVE/non-persistent selectors. |
| `BIND` | `POST /v1/identity/{prismId}/bindings` | Tracked route present | Exact challenge reference/digest/chain ID/expiry/controller; operation returned before canonical transition. |
| `PRIVATE_BINDINGS_LIST` | `GET /v1/identity/{prismId}/bindings/private` | Tracked route present | Owner session plus owner authorization/protection; no public fallback; fail-closed until providers are proven. |
| `REVOKE` | `POST /v1/identity/{prismId}/bindings/{bindingId}/revoke` | Tracked route present | Controller-only operation; repeated revoke may return already-revoked fact; parent identity survives. |
| `RESOLVE` | `GET /v1/resolve/{identifier}?venue=BASE` | Tracked route present | Returns destination or `executionAccount:null` = `NO_ACTIVE_DESTINATION`, with watermark; stale ACTIVE cannot be served. |
| `OPERATION_READ` | `GET /v1/operations/{operationId}` | Tracked route present | Durable workflow read; operation state, tx hash, error, and reconciliation watermark. |
| `RECEIPT_READ` | `GET /v1/receipts/{receiptId}` | Tracked route present | Generic operation-derived receipt; not a STRK20 privacy receipt and not independent chain evidence. |
| `INTENT_CREATE` | `POST /v1/intents` | Tracked route present | Session + `prismId` + purpose + idempotency; creates intent/plan, not settlement. |
| `INTENT_PAUSE` | `POST /v1/intents/{intentId}/pause` | Tracked route present | Creates a `PAUSED` state bound to the intent plan; no chain write. |
| `PAUSE_READ` | `GET /v1/pauses/{pauseId}` | Tracked route present | Durable pause read with version/ETag. |
| `PAUSE_VERIFY` | `POST /v1/pauses/{pauseId}/verify` | Tracked route present | Server/provider-owned typed checks; client-supplied `sources` is forbidden; UNKNOWN blocks. |
| `PAUSE_RELEASE` | `POST /v1/pauses/{pauseId}/release` | Tracked route present | Exact plan/approval scope + authority + settlement operation link; RELEASED is not completed. |
| `PAUSE_CANCEL` | `POST /v1/pauses/{pauseId}/cancel` | Tracked route present | Version/authority guarded; cannot cancel RELEASED/EXPIRED. |
| `PAUSE_ESCALATE` | `POST /v1/pauses/{pauseId}/escalate` | Tracked route present | Moves eligible pause to ESCALATED with required approval count. |
| `PAUSE_APPROVE` | `POST /v1/pauses/{pauseId}/approve` | Tracked route present | Authority resolver and exact plan/approval scope; unknown/hard resolution blocks remain blocking. |

Common successful command responses are HTTP 200 envelopes with `operation`
or domain state. HTTP 200 does not mean the chain action completed. Common
headers are `X-Request-Id`, `X-Correlation-Id`, `Idempotency-Key`, `If-Match`,
`X-Session-Id`, and `X-Session-User`; read responses may carry
`X-Prism-Watermark` and `ETag`.

### 4.2 Newly mounted transport surfaces (11 method entries, including payment and gift routes)

| ID | Method and path | Integrated truth | Do not do |
|---|---|---|---|
| `ALIAS_LOOKUP` | `GET /v1/aliases/{provider}/{value}` | Tracked route present in the integrated snapshot; provider outcomes are typed in the 200 data projection. | Do not infer a Prism ID from alias text or simulate provider success/association. |
| `CONTINUITY` | `GET /v1/resolution/{identifier}/continuity` | Tracked route and transport schema present; snapshot/risk output is allow-listed and freshness is explicit. | Do not collapse FRESH, STALE, UNKNOWN, UNAVAILABLE, or NO_ACTIVE_DESTINATION. |
| `STRK20_ACTION_CREATE` | `POST /v1/strk20/actions` | Tracked wallet-mediated lifecycle route; create/prepare/submit/observe_receipt are explicit and provider material is rejected/redacted. | Do not treat a local provider double, HTTP 200, or submitted hash as privacy completion. |
| `STRK20_ACTION_READ` | `GET /v1/strk20/actions/{actionId}` | Tracked JSON-safe action projection route; proof/call material is status-only. | Do not expose proof, calldata, notes, keys, or provider responses. |
| `PRIVACY_RECEIPT_READ` | `GET /v1/privacy/receipts/{receiptId}` | Tracked derived policy-filtered receipt route; OBSERVED remains receipt/finality/pool-event gated. | Do not expose viewing keys, notes, private balances, sender attribution, or generic-operation data as privacy evidence. |
| `PAYMENT_REQUEST_CREATE` | `POST /v1/payments/requests` | Mounted local payment-request lifecycle create; public projection is redacted. | Do not infer payer, wallet, signing, funding, escrow, or settlement authority. |
| `PAYMENT_REQUEST_READ` | `GET /v1/payments/requests/{requestId}` | Mounted public-safe lifecycle read. | Do not collapse unknown/unavailable into completed or failed. |
| `PAYMENT_REQUEST_ACTION` | `POST /v1/payments/requests/{requestId}` | Explicit approve/submit transition; provider and domain gates remain authoritative. | HTTP 200/submitted is not settlement completion. |
| `GIFT_CREATE` | `POST /v1/gifts` | Mounted claimable-gift create; local aggregate only. | Base escrow remains blocked by the absent EVM toolchain; do not invent a contract. |
| `GIFT_READ` | `GET /v1/gifts/{claimId}` | Mounted public-safe claim lifecycle read. | Never expose proof, nullifier, or private recipient material. |
| `GIFT_ACTION` | `POST /v1/gifts/{claimId}` | Explicit fund/mark_claimable/claim/expire/refund transition with typed unavailable/unknown outcomes. | Do not treat actor/address claims as authority or claim local state as live receipt evidence. |

**Inventory findings after integration:**

1. `BY_CONTROLLER` is now tracked in the integrated backend snapshot and its
   focused route tests cover canonical readback, projection fallback, and
   distinct `NONE`/`UNKNOWN`/`UNAVAILABLE` outcomes. It remains outside the
   protected OpenAPI file and is a direct route rather than an application
   handler-table entry.
2. The revoke-path discrepancy is resolved: `API_CONTRACTS` and the actual
   Next route now use `/v1/identity/:prismId/bindings/:bindingId/revoke`, which
   corresponds to `/v1/identity/{prismId}/bindings/{bindingId}/revoke` on the
   wire. The `bindingId` path segment is preserved; request body fields remain
   authoritative for the canonical target.
3. Alias, continuity, STRK20 action, and privacy-receipt routes are mounted,
   wired through the canonical factory/handler/schema/port model, and covered
   by focused tests. Their inventory entries are integrated but not deployed
   or externally observed; OpenAPI and other protected contract files were not
   changed.
4. There is no `GET /v1/intents/{intentId}` route; the current intent handoff
   relies on the create response and the subsequent pause/operation reads.

---

## 5. Dependency order

The teams must not reorder these gates:

```text
R0 freeze candidate and record baseline
  → R1 verify accepted testnet target decision + chain-id disposition
  → R2 validate redacted runtime configuration names/shapes
  → R3 verify registry version/address/class-hash scope by read-only preflight
  → R4 provision fresh Postgres schema + durable projection/checkpoint path
  → R5 identity create operation + chain receipt/event/readback
  → R6 identity read + controller discovery (only after route acceptance)
  → R7 issue Base challenge
  → R8 Base wallet proof verification (EOA/1271/6492 class recorded)
  → R9 controller-authorized bind operation + receipt/event reconciliation
  → R10 public binding list + resolve ACTIVE + watermark
  → R11 controller-authorized revoke operation + receipt/event reconciliation
  → R12 resolve NO_ACTIVE_DESTINATION + identity persists + independent read
  → R13 operation/receipt/restart/unknown/revert recovery rehearsal
  → R14 alias association + continuity snapshot/risk route (mounted locally; external evidence remains open)
  → R15 STRK20 capability/consent/proof/pool/note/maturity route (mounted locally; wallet/provider evidence remains open)
  → R16 intent → Pause policy/authority → settlement operation route
  → R17 evidence envelope validation and owner review; no ledger write by this packet
```

`R5`, `R9`, and `R11` are future owner/operator wallet actions. They are
listed to define the rehearsal, but were not executed here. No step may skip
`R3` or `R4` by using an address, cache, in-memory double, or worker report as
canonical truth.

---

## 6. Read-only dry-run harness

### 6.1 What it validates

```bash
node ops/testnet-rehearsal/dry-run.mjs --environment testnet --self-test
```

The command is offline and validates:

- the target manifest is owner-accepted for `testnet`, with `SN_SEPOLIA`,
  Base chain ID `84532`, and explicit Registry V2 selection;
- the decision mirror contains the accepted target and chain-ID records;
- all 25 inventory entries are unique and cover every requested area;
- 25 source-present method entries point to existing local route files;
- 0 specified-only entries remain unmounted in this integrated snapshot;
- OpenAPI paths marked present are present in `docs/api/openapi.yaml`;
- every endpoint keeps all seven maturity fields and no endpoint is promotable;
- valid and invalid redacted configuration shapes fail/pass as expected;
- no live/deployment flag is accepted.

Optional shape/presence check:

```bash
node ops/testnet-rehearsal/dry-run.mjs --environment testnet --check-config
```

Future provider-backed preflight, still with no network I/O:

```bash
node ops/testnet-rehearsal/dry-run.mjs --environment testnet --require-config
```

`--require-config` does not require signer keys and does not authorize a
broadcast. It only blocks when non-secret runtime configuration names are
absent or malformed.

### 6.2 Hard side-effect boundary

The harness rejects `--deploy`, `--broadcast`, `--live`, `--invoke`, `--sign`,
`--fund`, wallet/mainnet flags, signer flags, and evidence/`strk20.json` write
flags. It imports no RPC/provider SDK, calls no `fetch`, reads no signer secret,
opens no socket, and writes no file. A successful result is exactly:

```text
PRISM_TESTNET_REHEARSAL_DRY_RUN_READY_X2
```

It is not a deployment, receipt, live API trace, testnet acceptance, or
promotable evidence.

---

## 7. Backend team rehearsal sequence

All steps below after `B0` are a **future owner/operator run**, not actions
performed by this packet. Replace every unobserved field with a real observed
value at run time; never copy a plausible value from a fixture.

### B0 — Freeze and preflight (no side effect)

**Preconditions**

- candidate commit is frozen and the dirty-snapshot exclusions are resolved;
- `DEC-PRISM-OPS-001` and chain-ID decision mirror are accepted;
- `SN_SEPOLIA` + `BASE_SEPOLIA/84532` is the only selected environment;
- harness self-test, target-network validator, Starknet secret-free validator,
  evidence-envelope self-test, typecheck, and focused backend tests pass;
- no signer secret, URL credential, viewing key, or private endpoint is in
  repository/log/output;
- fresh Postgres test schema is available for a provider-backed rehearsal, or
  the run is explicitly classified as local X2 only;
- no `strk20.json` or evidence-ledger write is in scope.

**Abort** on any dirty protected-file change, mainnet selection, missing
manifest decision mirror, config mismatch, or attempt to use a memory double as
live evidence.

### B1 — Read-only network and registry identity preflight

Read (do not deploy or invoke):

1. network identity and selected chain ID from the primary Starknet provider;
2. the configured Registry V2 address/version/class-hash scope;
3. deployment receipt/status/block supplied by an already accepted deployment
   record, if the rehearsal depends on a deployed registry;
4. the same public facts through an independent RPC or explorer source;
5. latest confirmed block and projection start/watermark context.

**Gate:** network and chain scope agree; class hash/address/version agree;
receipt is `SUCCEEDED` with a real block; independent read agrees. If any fact
is absent, this remains X2 preparation and stops before a user action.

### B2 — Create/read identity tail (operator-signed live step, not run here)

1. Submit `POST /v1/identity` with an authenticated app session,
   `Idempotency-Key`, controller address, request ID, and correlation ID.
2. Confirm the durable operation exists before any wallet submission. The first
   response may be `created`, `awaiting_authorization`, `ready`, or `submitted`;
   it must not be presented as completed.
3. Poll `GET /v1/operations/{operationId}`. Reconcile the real transaction
   status/receipt and `PrismIdentityCreated` event.
4. Only after reconciliation, read `GET /v1/identity/{prismId}` and compare
   controller/event/block/watermark. Read through the independent source.
5. If a fresh identity is not needed because an accepted live identity already
   exists, use its observed ID; never invent or reuse a fixture ID as live fact.

**Gate:** operation row, tx hash, receipt status, block, creation event,
identity read, watermark, and independent read all agree. This is the narrow
identity claim only; it does not prove bind/revoke, STRK20, or Pause.

### B3 — Challenge issue and Base proof

1. Confirm `GET /v1/identity/{prismId}` succeeds before issuing proof.
2. Issue `POST /v1/challenge/issue` for `venue=BASE`, the exact execution
   account, and the accepted Base chain ID.
3. Display to the user the exact domain, schema version, venue, chain ID,
   execution account, Prism ID, nonce, issuance, and expiry. Do not alter any
   field.
4. The user signs the returned message with the Base account. The backend does
   not receive or store the private key.
5. Submit `POST /v1/challenge/verify` with the server-issued challenge ID,
   exact presented fields, and signature.
6. Record `signatureClass` (`EOA`, `EIP1271`, or `ERC6492`) only when the
   provider/verifier actually reports it.

**Gate:** exact echo passes, signature class is known, nonce is consumed once,
and response is `VERIFIED`. `VERIFIED` has no canonical binding effect.

### B4 — Bind and reconcile (operator-signed live step, not run here)

1. Construct the bind request only from the verified challenge record: same
   Prism ID, Base venue, execution account, digest/challenge ID, chain ID,
   expiry, and controller address.
2. Require the Starknet controller account, not the app session or backend, to
   authorize the bind.
3. Submit `POST /v1/identity/{prismId}/bindings` with idempotency/correlation
   headers. Confirm the operation row exists before submission.
4. Poll `/v1/operations/{operationId}` until the provider reports receipt
   facts. Map `RECEIVED`/pending to processing, not success.
5. Confirm the receipt is `SUCCEEDED`, the block is present, and the
   `ExecutionIdentityBound` event matches the exact digest/account/Prism ID.
6. Persist the event before advancing the projection checkpoint. Read the
   binding through the independent source.

**Gate:** no `ACTIVE` claim before the receipt/event/reconciliation gate; no
`completed` state before indexed + reconciled.

### B5 — Resolve active and exercise public audience

1. Read `GET /v1/identity/{prismId}/bindings?audience=public`.
2. Read `GET /v1/resolve/{prismId}?venue=BASE`.
3. Require the returned destination to be the observed public Base account and
   capture its response watermark/ETag.
4. If the public list is empty, contradictory, or stale, stop; do not repair it
   from UI state or an operation row.
5. If using `GET /v1/identities/by-controller`, record its canonical/projection
   source, candidate status, and watermark; empty/unknown/unavailable outcomes
   must remain distinct.

### B6 — Revoke and decisive tail (operator-signed live step, not run here)

1. Submit `POST /v1/identity/{prismId}/bindings/{bindingId}/revoke` with the
   controller address, exact execution account/venue, session, and idempotency
   key.
2. Poll the operation and reconcile a real `BindingRevoked` event/receipt.
3. Read resolve again. It must return `executionAccount:null` with the
   `NO_ACTIVE_DESTINATION` interpretation; it must never return the revoked
   account as ACTIVE from a stale cache.
4. Read identity again. The parent Prism ID/controller must still exist.
5. Repeat resolve and identity through the independent source. Record the
   watermark and the source identity for both reads.

**Gate:** the decisive tail is `ACTIVE → REVOKED → NO_ACTIVE_DESTINATION`, with
identity persistence. Rebinding, if later tested, requires a fresh challenge
and new digest; a revoked binding is never silently reactivated.

### B7 — Projection, operation, receipt, and restart rehearsal

With a fresh Postgres schema and a real read provider:

1. start from the observed registry deployment block;
2. scan events with bounded pagination and global dedup;
3. persist events before CAS checkpoint update;
4. record `scanWatermark` (confirmed scanned head) separately from
   `eventWatermark` (newest matching event);
5. verify reconstructed identity/binding state and API watermark;
6. restart the worker with a non-terminal operation present;
7. resume polling from the durable tx hash without rebroadcast;
8. exercise duplicate events, provider outage, confirmed-but-unindexed, stale
   cache, and unknown receipt paths;
9. compare the result with a second read source.

**Gate:** T7/T9/T12 evidence is only earned from the real configured store and
provider. Skipped integration tests remain `SKIPPED`, not `PASS`.

### B8 — Alias/continuity, STRK20, and Pause lanes

- Alias/continuity cannot enter an HTTP happy path until the five missing
  transport surfaces have accepted schemas and route tests.
- STRK20 is a separate wallet/prover/pool evidence lane; do not use the
  identity receipt path as a substitute.
- Intent/Pause can be exercised locally at X2 with typed fake providers, but a
  testnet settlement claim requires a real adapter, receipt, reconciliation,
  and independent read. `RELEASED` remains distinct from operation completion.

---

## 8. Frontend team rehearsal sequence

The frontend lane consumes the backend contract; it does not redefine authority
or infer chain state. No frontend files are changed by this packet.

### F0 — Contract and session setup

- Use the exact paths and body/header shapes in the machine inventory.
- Keep the app session (`X-Session-Id`/`X-Session-User`) separate from the
  Starknet controller and Base proof authorities.
- Generate a request ID, correlation ID, and idempotency key for every mutating
  action; retain them for the Activity/receipt view.
- Display the selected network as `SN_SEPOLIA` + `BASE_SEPOLIA/84532`; never
  silently fall through to mainnet.
- Call the alias, continuity, STRK20 action, and privacy-receipt paths only with
  the exact mounted schemas and typed unavailable/deferred states; a mounted
  route still does not imply provider-backed or live evidence.

### F1 — Identity create/read UI

1. Discover any existing identity only through the integrated controller route;
   preserve `NONE`, `FOUND`, `MULTIPLE`, `UNKNOWN`, and `UNAVAILABLE` exactly and
   do not treat an empty result as proof of no identity.
2. Submit `POST /v1/identity` and render `created`,
   `awaiting_authorization`, `ready`, or `submitted` distinctly.
3. Poll `/v1/operations/{operationId}`. Do not show “created”/“complete” until
   the operation and canonical read agree.
4. Read `/v1/identity/{prismId}` and display only the response's canonical
   fields and watermark.

### F2 — Base proof and bind UI

1. Call `/v1/challenge/issue` only after identity read succeeds.
2. Show every signed field, especially Base chain ID, domain, expiry, account,
   Prism ID, and nonce.
3. On wallet rejection, show retry/new-proof state; do not mark verified.
4. On `/v1/challenge/verify`, label the result **Verified proof** rather than
   **Bound**.
5. Ask the Starknet controller wallet to authorize bind. A Base proof or app
   session cannot authorize the Starknet state transition.
6. Render `submitted`, `processing`, `confirming`, `confirmed`, `indexed`,
   `reconciled`, and `completed` as separate states from the operation resource.
7. Show ACTIVE binding only after a fresh resolve/read with a watermark.

### F3 — Resolve/revoke UI

1. Public Connections uses only the public binding list and resolve response.
2. Revoke requires controller authority and carries the same correlation chain.
3. After revoke, render `NO_ACTIVE_DESTINATION`; do not optimistically leave the
   old address active.
4. Keep the Prism ID visible/readable after revoke to demonstrate persistence.
5. If a response has stale-refused or unknown state, show a blocking refresh/
   processing message instead of choosing a destination from cached UI state.

### F4 — Private, alias, STRK20, intent, and Pause UI

- Private bindings require owner authorization and the protection provider;
  an absent provider is a typed blocked state, not an empty private list.
- Do not describe hidden UI as private state. PUBLIC → PRIVATE retains a
  historical-public warning.
- Aliases display as external provider evidence; no alias text becomes a Prism
  ID without explicit association.
- STRK20 capability is discovered from supported API/spec versions; consent,
  proving, submission, receipt, pool event, note/maturity, and privacy labels
  are separate UI states. No viewing key is requested or displayed.
- Intent/Pause UI keeps `intent`, `pause`, `approval`, `settlement operation`,
  and `receipt` identifiers separate. UNKNOWN policy checks block release.
- `RELEASED` is not `completed`; a release view must link to operation polling.

### F5 — Frontend evidence gate

The frontend team may report a local X2 contract/runtime result only after:

- all state labels are derived from returned operation/domain state;
- no optimistic completion or stale-active destination is shown;
- request/correlation/idempotency identifiers are traceable;
- wrong network, rejected wallet, altered proof, missing route, private
  authorization, and dependency states are visible and non-successful;
- browser evidence records route/status/body shape without secrets or private
  endpoint data;
- any real testnet claim includes the backend's receipt, block, watermark, and
  independent read identifiers. A browser screenshot alone is not X3.

---

## 9. Negative and recovery sequences

| Case | Exact trigger | Required result | Recovery / evidence rule |
|---|---|---|---|
| Missing app session | Mutating route without header/body session | HTTP 401 stable error; no canonical change | Re-authenticate; never use controller address as app auth. |
| Missing idempotency | Identity/intent create without key | HTTP 409/stale conflict | Retry with a new explicit key or the exact original key/fingerprint; do not guess. |
| Idempotency conflict | Same key with a different fingerprint | HTTP 409 `ERR-023` | Stop and compare request fields; no second broadcast. |
| Malformed JSON/body | Invalid JSON or missing required fields | HTTP 400/422 stable error | Correct the request; no wallet prompt. |
| Unknown identity | Challenge issue/read/bind against an unobserved ID | HTTP 404/`ERR-010` or typed identity error | Use a real observed ID; do not treat a fixture as live. |
| Altered challenge | Mutate domain, venue, account, Prism ID, chain ID, schema, nonce, or expiry | Verify rejects `ERR-012` with altered-field detail | Start a fresh challenge; do not reuse the attempted proof. |
| Wrong signer | Signature does not control the challenged Base account | Verify rejects `ERR-003` | Reconnect the correct user wallet and issue a new challenge. |
| Expired challenge | Verify at/after expiry | `ERR-013` | Issue a new challenge; no nonce resurrection. |
| Nonce replay | Submit proof twice | Second attempt `ERR-006` | New challenge only; record the first result and no double verification. |
| Digest replay | Re-submit a previously consumed bind digest | Contract-side `ERR-007` | Fresh Base proof/challenge; never alter digest representation. |
| Wrong controller | Bind/revoke with account other than identity controller | `ERR-004`; no canonical mutation | Ask the controller wallet to authorize; app session is not authority. |
| Duplicate active bind | Bind same active key/digest | `ERR-008`/conflict | Resolve current binding first; do not overwrite. |
| Missing/invalid registry scope | Network/version/address/class hash mismatch | Abort before wallet action | Re-read config and deployment facts; no address repair or V1/V2 fallback. |
| Provider unavailable before submit | RPC/store unavailable before operation or submit | `ERR-021`/dependency failure; no completed state | Restore dependency; retry only according to operation/idempotency rules. |
| Submitted but unknown | Tx hash exists but status/receipt is absent or provider disagrees | Remain `submitted`/processing, then `requires_attention`; never call reverted or completed | Re-poll by the exact tx hash; second provider read; operator attention after threshold. |
| Receipt reverted | Receipt execution status is `REVERTED` | Operation `reverted` with stable revert code | No success/readback promotion; start a new explicitly authorized attempt if policy permits. |
| Receipt missing block/status | Hash exists but block/status is null/unknown | Evidence blocker; no confirmation | Keep polling; malformed data is not repaired or fabricated. |
| Confirmed but unindexed | Receipt succeeded but canonical event not yet projected | `confirmed`, not `indexed/reconciled/completed` | Replay event range from durable checkpoint; persist before CAS advance. |
| Duplicate/missed event | Same `(tx_hash,event_index)` twice or event absent in projection | Idempotent dedup or reconciliation alert | Chain receipt is authority; rebuild projection; do not rewrite chain facts. |
| Stale active cache | Cache says ACTIVE after revoke or watermark is below confirmed-K | Refuse stale ACTIVE / return NO_ACTIVE or `ERR-023` per route | Canonical read, watermark comparison, cache invalidation; record K=5. |
| Postgres restart | Process dies with non-terminal op/checkpoint | Durable operation/checkpoint resumes; no blind rebroadcast | Re-poll exact hash, dedup events, compare restart result. |
| Alias unavailable/not associated | Provider returns unavailable/invalid/not found or no explicit association | Continuity result `BLOCKED`, typed risk | Do not resolve alias to Prism ID; retry provider/association only. |
| Continuity snapshot failure | Snapshot read/write/CAS fails | Blocking snapshot-unavailable risk | No destination claim or Pause release. |
| Private audience without owner | Missing session/authorization/protection | 401/403/503 fail-closed | Do not fall back to public or return plaintext endpoint. |
| STRK20 capability unknown | Missing/malformed supported API/spec response | Capability unknown/unsupported | Re-detect through capability methods; no balance read as feature detection. |
| STRK20 wrong network | Wallet environment is not SN_SEPOLIA | Network mismatch | User switches wallet network; no action. |
| STRK20 registration/consent | Registration or explicit balance/action consent missing/denied | Typed registration/consent state | User-controlled wallet action only; no server bypass. |
| STRK20 screening | Screening rejected or unavailable | Rejected is terminal for that deposit; unavailable is retryable | Do not re-label rejected as dependency failure; wait/back off for unavailable. |
| STRK20 fee changed | Quoted fee differs from observed fee | `FEE_CHANGED`; no submit | Re-quote; do not silently resubmit changed terms. |
| STRK20 empty proof | Simulated empty proof passed to submit | `PROOF_REQUIRED`; no submit | Simulation remains preparation only; obtain a real proof through wallet/provider. |
| STRK20 unknown receipt | Provider receipt is pending/unknown/hash-mismatched/no pool event | Poll/attention; never confirmed | Require matching hash, finality, block, pool event, and independent read. |
| STRK20 premature maturity | Current block below maturity target or consent missing | `MATURITY_PENDING`/consent state | Poll the wallet/provider; no private-available claim. |
| Pause client-supplied facts | Request includes verification `sources` | Invalid-state rejection | Provider-owned sources only; UNKNOWN blocks release. |
| Pause plan mutation | Plan hash or approval scope differs | 409 plan/scope mismatch | Re-read plan; reverify; never mutate the stored plan in place. |
| Pause stale version/race | `If-Match`/expected version loses CAS race | Stale-version conflict; one transition wins | Re-read exact pause; do not retry with a guessed version. |
| Pause authority failure | Missing/denied/unavailable resolver | Denied or dependency error | Preserve pause state; no operator/body claim bypass. |
| Pause expiry | Verify/approve/release after expiry | `EXPIRED`; no release | Start a new intent/pause where allowed; retain audit history. |
| Settlement operation reuse | Release attempts to reuse terminal operation | Operation-not-reusable | Create a new explicitly correlated operation only if policy permits; no completed shortcut. |

---

## 10. Operation, receipt, and status semantics

### 10.1 Generic Prism operation lifecycle

```text
created
  → awaiting_authorization
  → ready
  → submitted
  → processing
  → confirming
  → confirmed
  → indexed
  → reconciled
  → completed
```

Failure branches are `failed_retryable`, `failed_terminal`, `reverted`,
`expired`, `cancelled`, and `requires_attention`.

| Status | Authoritative source | Meaning | Allowed claim |
|---|---|---|---|
| `created` / `awaiting_authorization` / `ready` | durable backend operation row | Request exists and is awaiting an authorized submission. | No tx or canonical change. |
| `submitted` | operation row + provider submission fact | A submission boundary was crossed; tx hash must be retained when returned. | Submitted only, never completed. |
| `processing` | chain status/read provider | Provider has a pending/accepted observation but final receipt facts are incomplete. | Processing only. |
| `confirming` | chain status/read provider | Execution is moving through the finality/receipt confirmation path. | Confirming only. |
| `confirmed` / receipt-confirmed | real receipt with `SUCCEEDED`, finality, and block | Execution succeeded at the receipt boundary. | Not yet indexed/reconciled/completed. |
| `indexed` | canonical event observed by indexer | Expected event was persisted and associated with the operation. | Not yet reconciled/completed. |
| `reconciled` | receipt + event + operation correlation | Canonical facts and durable operation agree. | Receipt may now be issued; completion is the next legal step. |
| `completed` | reconciliation plus issued receipt | Application completion after all required reconciliation gates. | Only after indexed/reconciled; never from HTTP 200 or tx hash alone. |
| `reverted` | real receipt execution status | Chain executed a failure/revert. | Reverted with mapped error; no success promotion. |
| `unknown` / `requires_attention` | missing/contradictory provider read or timeout | The result is not known. | Poll/attention only; never infer failure or success. |

A `RECEIVED`, `PENDING`, or provider `UNKNOWN` result remains non-final. A
successful execution status without a block, matching event, or reconciliation
is also non-final. A timeout after submission is not proof of revert.

### 10.2 STRK20-specific state boundary

The local/provider boundary additionally distinguishes
`capability_unknown`, `mismatch`, `registration_required`,
`approval_pending`, `shielding`, `confirmed`, `maturing`,
`privately_available`, `proving`, `transfer_pending`,
`transfer_confirmed`, `rejected`, and `dependency_failure`.

For STRK20, `confirmed` requires a matching real receipt, accepted finality,
block, and pool event. `privately_available` additionally requires maturity and
explicit balance consent. A private-transfer receipt may hide sender,
recipient, amount, and token type; a shield receipt has its own public metadata.
The relayer sender is never user attribution.

---

## 11. Preconditions and hard abort conditions

### 11.1 Preconditions before a future live rehearsal

- [ ] Candidate commit frozen; unrelated dirty work is outside the candidate.
- [ ] Testnet target decision and chain-ID decision are accepted and mirrored.
- [ ] Explicit environment is `testnet`; no implicit environment default.
- [ ] Primary and independent provider identities are recorded privately by the
      operator; no keyed URL is in repo or chat.
- [ ] Registry version/address/class-hash/deployment block are read-only
      inputs from an accepted deployment record; V1 is not used as V2.
- [ ] Starknet controller wallet is user-controlled and on `SN_SEPOLIA`.
- [ ] Base proof wallet is user-controlled and on `BASE_SEPOLIA/84532`.
- [ ] Required wallet capability/consent/proof fixtures are actually present
      for the lane being run; no test double is labelled live.
- [ ] Fresh Postgres schema and migrations are ready for any T7/T9/T12 claim;
      production/rehearsal mode has no silent memory fallback.
- [ ] Operation row, tx-hash correlation, receipt fields, event, watermark,
      independent-read, and limitation fields have a recording owner.
- [ ] No private endpoint/plaintext key material will enter logs, payloads,
      evidence, or UI.
- [ ] No ledger, decision register, `strk20.json`, or mainnet change is part of
      the run authorization.

### 11.2 Immediate aborts (before the next side effect)

Abort and preserve the observed state if any one occurs:

- selected network is not `SN_SEPOLIA` + `BASE_SEPOLIA/84532`;
- `SN_MAIN`, Base Mainnet, or a mainnet config namespace is selected;
- manifest/decision mirror is missing, contradictory, or stale;
- Registry V1/V2 address, version, class hash, or ABI serialization is
  ambiguous or mismatched;
- a deployment/receipt/block/event/independent read is missing where the next
  gate requires it;
- RPC/provider answers conflict or expose an unknown status;
- Postgres is absent/unreachable for a gate that requires durability;
- operation row was not persisted before submission;
- an operation tries to skip `submitted`/`processing`/`confirming`/`indexed`/
  `reconciled` or equates `RELEASED` with completed;
- projection watermark is missing or stale (`watermark < confirmed_block - 5`)
  for a serve/promotion gate;
- a private endpoint appears on public path/log/event/evidence;
- signer key, seed, password, viewing key, or keyed URL appears in output;
- by-controller/alias/continuity/STRK20/privacy-receipt route is called before
  its transport contract is accepted;
- any step attempts to write `strk20.json`, an evidence ledger, or a decision
  register;
- a tool asks for a password or permission dialog; the operator must handle it
  privately outside this lane.

An abort is not a revert and is not a failure receipt. Record the exact blocker
and leave canonical state untouched.

---

## 12. Public/private audience and secret handling

### Public audience

Public reads may expose the Prism ID, public ACTIVE Base binding, public
chain/venue, public operation/receipt state allowed by product policy, and
watermark. Base binding linkage is public by v0 design. Public list and resolve
must never include PRIVATE or SELECTIVE rows, private endpoints, viewing keys,
private balances, or wallet notes.

### Owner/private audience

Private binding reads require an authenticated app session **and** a separate
owner-authorization decision **and** a proven protection/recovery provider.
Session identity is not proof of controller ownership. A private endpoint is
never plaintext public state, even if the UI hides it. A PUBLIC → PRIVATE change
means future unpublication plus a historical-public warning; it cannot erase
chain/indexer history.

### Alias and continuity audience

An external alias is provider evidence, not a Prism identity root. Only an
explicit association record may cross the alias → Prism boundary. Continuity
snapshots are scoped by Prism ID, venue, and purpose. Risks such as
`FIRST_TIME_RECIPIENT`, `ADDRESS_CHANGED`, `ALIAS_CHANGED`, `CHAIN_CHANGED`,
`BINDING_REVOKED`, `VISIBILITY_CHANGED`, and `NO_ACTIVE_DESTINATION` are typed
facts; do not replace them with an opaque score.

### Secret rules

- Configuration values live outside the repository; this packet names only
  variables.
- Never print, commit, transmit, or paste private keys, seed phrases,
  passwords, keystore contents, viewing keys, note secrets, or keyed RPC URLs.
- The harness does not read signer env vars, create wallets, call wallets, sign,
  fund, invoke, deploy, broadcast, or write evidence.
- Logs and evidence may contain public identifiers only when actually observed.
  Redact endpoint values and session linkage when not required for the claim.
- No localStorage/UI hiding is described as secure private storage.
- A test double, simulated provider, empty proof, synthetic receipt, or
  placeholder hash is always labelled X1/X2 and is never promoted.

---

## 13. Evidence recording contract

This packet defines field names; it intentionally supplies no live values. A
future operator records one evidence envelope per bounded claim and leaves a
field absent/null or the envelope unpromotable until the real observation
exists. Do not write these placeholders into `EVIDENCE_LEDGER.md`.

### Required public evidence fields

```text
evidence_id
claim_scope
environment
network
chain_id
registry_version
registry_address
registry_class_hash
deployment_tx_hash
deployment_block
tx_hash
block
execution_status
finality_status
event_name
event_index
watermark
confirmed_block
scan_watermark
event_watermark
source_id
independent_read
observed_at
build.commit_sha
build.spec_versions
procedure
limitations
audience
secret_handling
```

`independent_read` must identify a genuinely distinct source/method and record
whether the block/status/address or state matched. “The same provider returned
the same bytes twice” is not independent verification.

### Claim-specific minimums

| Claim | Minimum evidence before any X3 consideration |
|---|---|
| Identity create/read | Real `PrismIdentityCreated` receipt/event, tx hash, block, network, controller/read match, watermark, independent read. |
| Challenge/proof | Server-issued challenge fields, proof result/class, nonce single-use/rejection vectors; no private key or raw secret. This alone is still offchain proof evidence, not canonical binding. |
| Bind | Controller-authorized tx receipt, `ExecutionIdentityBound` event, exact digest/account/Prism ID, operation correlation, resolve ACTIVE read, watermark, independent read. |
| Revoke/decisive tail | Controller-authorized revoke receipt, `BindingRevoked` event, resolve `NO_ACTIVE_DESTINATION`, identity persistence, watermark, independent read. |
| Projection/reconciliation | Real Postgres schema, persisted events, checkpoint CAS, scan/event watermarks, restart/replay/duplicate behavior, operation correlation, independent provider read. |
| Alias/continuity | Accepted provider interface, explicit association, current/previous snapshots, typed diff/risk, scoped store version/CAS, independent provider/read. |
| STRK20/privacy | Capability, correct network, consent, real proof, matching tx receipt/block/status, pool event, helper calldata where required, note/maturity/readback/validator facts, independent read; privacy scope remains action-specific. |
| Pause/settlement | Intent/plan hash, typed checks, policy version, authority decision, approval scope, CAS versions, settlement operation, receipt/reconciliation, independent read. |

No field is invented to make a row pass. A missing field is an explicit
blocker/downgrade, not a `0x…` value.

---

## 14. Evidence gates and current disposition

| Gate | Owner | Required pass | Current disposition in this packet |
|---|---|---|---|
| `R0` scope freeze | both teams | Candidate and protected-file boundaries verified | **OPEN** — current worktree is dirty outside this lane; packet did not clean it. |
| `R1` target decision | backend/owner | Accepted testnet mirror, no mainnet selection | **PASS read-only** — harness validates accepted testnet target; this does not authorize broadcast. |
| `R2` config shape | backend | Names/shapes valid; values remain secret/outside repo | **PASS for offline validator**; actual provider config is not asserted by default. |
| `R3` registry scope | backend/operator | Readback of exact selected deployment/version/class hash | **OPEN** — no new provider read performed here. |
| `R4` durable projection | backend | Fresh Postgres + event/checkpoint/restart gates | **OPEN** — no new live projection run performed here. |
| `R5–R12` decisive identity/bind/revoke tail | backend + wallet owners | Real receipts/events/reads/watermarks/independent source | **OPEN / not executed by this packet**. |
| `R13` failure/recovery | backend | Unknown/revert/stale/duplicate/restart/retry traces | **X2 local contracts only; live/repeated OPEN**. |
| `R14` alias/continuity | backend | Mounted transport + provider/association/snapshot evidence | **X2 local route/schema/test evidence**; provider/association/live continuity evidence OPEN. |
| `R15` STRK20/privacy | backend + wallet/prover | Mounted transport + capability/proof/pool/note/maturity evidence | **X2 local route/schema/test evidence**; wallet/provider/receipt/pool-event evidence OPEN. |
| `R16` intent/Pause settlement | backend + frontend | Real adapter and operation reconciliation | **X2 local domain/route boundaries; live OPEN**. |
| `R17` evidence promotion | owner/audit | Complete validator-passing envelope + independent read | **OPEN** — this packet writes no ledger. |

---

## 15. Integration handoff

### Backend team

1. Keep `endpoint-inventory.json` as the route/source boundary for the
   integrated transports; update it only in the rehearsal lane or an explicitly
   accepted API change.
2. Keep the exact revoke path in every handoff: `/v1/identity/{prismId}/bindings/{bindingId}/revoke`.
   `API_CONTRACTS` now carries the matching `:bindingId` segment, and the
   by-controller route is tracked separately because it uses scoped projection
   discovery rather than the application handler class.
3. Consume the mounted alias/continuity/STRK20/privacy-receipt routes only with
   their typed schemas, stable errors, audience rules, and focused route tests;
   the protected OpenAPI/contract files remain unchanged in this integration.
4. Preserve exact operation semantics: durable row before submit, submitted ≠
   completed, receipt ≠ reconciliation, unknown ≠ reverted, and no memory
   fallback for a required runtime.
5. Run real Postgres/projection/restart tests only with a fresh test URL and
   record skipped tiers honestly.
6. Return an evidence packet with network, chain ID, tx hash, block, status,
   watermark, independent read, limitations, commit, and spec versions; do not
   edit the evidence ledger from this rehearsal commit.

### Frontend team

1. Consume only the mounted paths and exact response states in the inventory;
   keep absent surfaces visibly blocked/deferred.
2. Treat wallet/network/capability/consent/proof/operation/receipt states as
   distinct UI facts; never infer success from a click, hash, or HTTP 200.
3. Keep app session, Base proof signer, Starknet controller, and STRK20 wallet
   authority separate.
4. Never render private endpoints, viewing keys, notes, or private balances on
   public surfaces; never claim privacy from hidden UI.
5. For any browser/testnet trace, attach the backend correlation chain and
   observed receipt/readback fields. Browser output cannot replace independent
   chain evidence.
6. Report UI work separately from backend/deployment maturity; this packet does
   not authorize frontend changes or a public claim above X2.

### Owner/operator boundary

The next side-effect decision is separate and explicit: provision/operate
user-controlled testnet wallets and, if authorized, execute the exact
operator-signed deployment/identity/bind/revoke steps. This packet does not
authorize that action and contains no signer workflow capable of performing it.

---

## 16. Rehearsal closeout statement

```text
Specified:          yes — canonical/system requirements and route candidates inventoried
Implemented:        local source routes present for all 25 method entries
Integrated:         canonical factory/handler/schema/port wiring plus direct by-controller route reconciled and route-tested
Deployed:           not performed or asserted by this packet
Observed:           no new external receipt/readback/provider observation
Repeated:           no new restart/independent-read rehearsal
Promotable:         no; evidence ledger and strk20.json untouched
Evidence ceiling:   X2 local implementation/preparation
```

The honest result of this packet is a bounded, self-tested rehearsal contract,
not a testnet acceptance or deployment claim.
