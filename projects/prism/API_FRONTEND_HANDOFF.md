# Prism API → frontend handoff

**Scope:** backend transport contract for the current Prism identity/binding/resolution and pause surface. The routes are mounted under `/api/v1` in Next. No wallet, contract, deployment, or mainnet behavior is implied by this document.

## 1. Common transport rules

### Request headers

| Header | Meaning |
|---|---|
| `X-Request-Id` | Optional caller trace id; echoed as `x-request-id`. |
| `X-Correlation-Id` | Optional workflow trace id; echoed as `x-correlation-id`. |
| `Idempotency-Key` | Required for identity create, bind, revoke, and intent create. Body fallback is accepted by those routes where noted. Same key + same fingerprint is a benign replay; a changed fingerprint is `ERR-023`/409. |
| `If-Match` | Optional quoted integer version, e.g. `"3"`; parsed as the expected CAS version. `X-Expected-Version` and `expected-version` are accepted aliases. |
| `Content-Type: application/json` | Required for POST bodies. |

Commands authenticate an **app session**, supplied either as `session`/`appSession` in the JSON body or through `X-Session-Id`, `X-Session-User`, `X-Session-Issued-At`, and optional `X-Session-Expires-At`. The test-only `Authorization: Bearer <sessionId>:<userId>` form is also recognized.

An app session is not a controller signature, Base ownership proof, wallet authority, or settlement authority. Request fields such as `controllerAddress`, `approver`, and `authorityActor` are untrusted claims until the dedicated canonical/authority port accepts them.

### Success and error envelopes

Most routes return:

```json
{
  "ok": true,
  "data": {},
  "operation": { "operationId": "op-…", "state": "submitted", "version": 3 },
  "watermark": 123,
  "requestId": "req-…"
}
```

`operation` and `watermark` are omitted when not applicable. Mutations use HTTP 200 with the operation/pause lifecycle state; `submitted` is never `completed`.

Errors return:

```json
{
  "ok": false,
  "error": {
    "code": "ERR-023",
    "name": "stale_state_conflict",
    "category": "stale_state",
    "retryable": "re_read",
    "userAction": "refresh",
    "httpStatusHint": 409,
    "detail": "safe_machine_discriminator"
  },
  "requestId": "req-…"
}
```

Error details are transport-redacted: provider URLs/output, connection strings, credentials/tokens, ciphertext, private/viewing keys, proof-sized hex values, and stacks do not cross this boundary. `x-error-code` is set on errors.

## 2. Endpoint contract

### Identity and challenge flow

| Method and path | Purpose / request shape | Response shape, audience, and lifecycle | Auth / freshness / unavailable |
|---|---|---|---|
| `POST /api/v1/challenge/issue` | Issue a Base ownership challenge. Body: `{ prismId, venue="BASE", executionAccount, ttlSeconds? , session? }`. | `data`: `{ challengeId, digest, messageToSign, issuedAt, expiresAt, domain, venue, executionAccount, prismId, nonce, chainId, schemaVersion }`. The challenge is issued, not a binding. | App session required. Base ownership is proven only by the later signature. `ERR-010`/404 unknown identity, `ERR-005`/422 malformed account, `ERR-013`/410 after expiry. |
| `POST /api/v1/challenge/verify` | Body: `{ challengeId, presented, signature, session? }`; `presented` must echo the server-issued fields exactly. | `data`: `{ status: "verified", signatureClass: "EOA"|"EIP1271"|"ERC6492", digest, verifiedAt }`. Verification is not canonical binding. | App session + cryptographic verification. Nonce is single-use: `ERR-006`/409. Altered fields `ERR-012`/400; expired proof `ERR-013`/410; invalid signer `ERR-003`/401. |
| `POST /api/v1/identity` | Create a Prism identity operation. Body: `{ controllerAddress, kind?="create_identity", session? }`; `Idempotency-Key` required (body fallback `idempotencyKey`). | `data`: `{ operationId, state, prismId? }`; `operation`: same id/version. `prismId` is absent/null until canonical chain confirmation/readback. | App session required. `controllerAddress` is Starknet execution authority, not the session user. Development/test doubles are blocked by the factory guard unless using an explicit isolated test factory: `ERR-021`/503. |
| `GET /api/v1/identity/{prismId}` | Canonical identity read. No body. | `data`: `{ prismId, controller, exists: true, watermark }`; `x-prism-watermark` and `ETag` carry `createdAtBlock`. | Public. `ERR-010`/404 unknown. The controller is canonical registry data; no binding status is inferred. |

### Controller discovery

| Method and path | Purpose / request shape | Response shape and states | Auth / freshness / unavailable |
|---|---|---|---|
| `GET /api/v1/identities/by-controller?controller=0x…` | Discover identities owned by a controller. Query `controller` is required and normalized case-insensitively. | `{ ok, state, candidates, watermark, source, requestId }`; each candidate is exactly `{ prismId, status, watermark }`. `status` is always `UNKNOWN` in this slice because canonical `getIdentity` exposes no lifecycle status. | Public. `NONE`, `FOUND`, and `MULTIPLE` are HTTP 200. `FOUND`/`MULTIPLE` require a candidate from the explicit canonical/dev enumeration or scope-bound public event projection **and** a matching canonical `getIdentity` readback. A projection row alone is insufficient. `watermark` is the projection/canonical read watermark; `x-prism-watermark`/`ETag` are emitted when non-null. |
|| | | `source` is `scoped_public_event_projection+canonical_starknet_read` when projection fallback is used, or `canonical_by_controller+canonical_starknet_read` for the explicit dev/test canonical double. | Empty configured/dev projection is normal `200 NONE`. Invalid query: `UNKNOWN`/422 `CONTROLLER_INVALID` (input failure). Actual canonical/projection failure: `UNKNOWN`/502 `CONTROLLER_LOOKUP_UNKNOWN`. Missing/unavailable by-controller reader or projection: `UNAVAILABLE`/503 `CONTROLLER_LOOKUP_UNAVAILABLE` or `STORE_UNAVAILABLE`. No `ACTIVE`/`SUSPENDED` status is fabricated. |

### Alias and continuity

|| Method and path | Purpose / request shape | Response shape, state semantics, and authority |
|---|---|---|
|| `GET /api/v1/aliases/{provider}/{value}` | Public read. Path parameters are decoded/trimmed; no body or app session. | HTTP 200 with `data`: `{ status, state, alias, subject, externalAddress, canonicalValue, association, prismId, associationEvidence, detail }`. Provider `RESOLVED`, `NOT_FOUND`, `UNAVAILABLE`, `INVALID_RESPONSE`, and `BLOCKED_BY_INTERFACE_EVIDENCE` remain typed data states. A Prism ID is returned only with `association.evidence:"explicit_prism_association"`; alias text is never parsed into an ID. Malformed path is `ALIAS_INVALID_REQUEST`/422; initialization failure is `ERR-021`/503. |
|| `GET /api/v1/resolution/{identifier}/continuity` | Public read plus scoped snapshot comparison. Query: optional `venue` (defaults `BASE`), `purpose` (defaults `default`), and `provider`/`aliasProvider`; a `prism:<id>` path value is a Prism ID, otherwise use `provider:value` or an explicit provider. | HTTP 200 with `data`: `{ status, continuityStatus, state, evidenceStatus, blocked, prismId, alias, associationEvidence, externalSubject, executionAccount, destination, providerStatus, previous, current, diff, risks, watermark, freshness, freshnessStatus, source, detail }`. `FRESH`, `STALE`, `UNKNOWN`, `UNAVAILABLE`, `NOT_FOUND`, and `NO_ACTIVE_DESTINATION` remain distinct. Snapshots/risk details are allow-listed; risks do not authorize Pause. Invalid input is 422; unavailable initialization/dependencies are 503. |

### Binding lifecycle and disclosure

| Method and path | Purpose / request shape | Response shape, audience, and lifecycle | Auth / freshness / unavailable |
|---|---|---|---|
| `GET /api/v1/identity/{prismId}/bindings` | Public binding list. Optional selectors: `audience=public`, `visibility=PUBLIC`, `lifecycle=PERSISTENT`. Other disclosure/lifecycle selectors are rejected, not coerced. | `data`: array of `{ bindingId, prismId, visibility:"PUBLIC", status:"ACTIVE", version, endpoint, historicalPublic:true, publiclyExposedAt, createdAt, updatedAt }`. `endpoint` is public by design. | Public. Only ACTIVE/PUBLIC rows are returned; PRIVATE/SELECTIVE data never enters this projection. `SELECTIVE_UNSUPPORTED`/501, non-public audience `PRIVATE_AUDIENCE_REQUIRED`/403, non-persistent lifecycle `LIFECYCLE_UNSUPPORTED`/501, store failure `STORE_UNAVAILABLE`/503. No projection watermark is currently available on this disclosure store. |
| `GET /api/v1/identity/{prismId}/bindings/private` | Owner/private list. No body. | `data`: array of owner-facing PRIVATE `BindingView` objects with a recovered `endpoint`; ciphertext/protection envelope is never returned. | App session required, then injected owner-authorization and key-management protection are authoritative. No public fallback. `OWNER_AUTHORIZATION_REQUIRED`/401, `OWNER_NOT_AUTHORIZED`/403, `BLOCKED_BY_KEY_MANAGEMENT`/503, or `STORE_UNAVAILABLE`/503. |
| `POST /api/v1/identity/{prismId}/bindings` | Bind a Base execution identity. Body requires `{ venue="BASE", executionAccount, proofDigest, challengeId, chainId, expiresAt, controllerAddress, session? }`; `Idempotency-Key` is required (body fallback accepted). `visibility` is PUBLIC-only and `lifecycle` is PERSISTENT-only. | `data`: `{ operationId, state }`; `operation`: `{ operationId, state, version }`. Successful submission is `submitted`, not `completed`; canonical ACTIVE appears only after chain confirmation/reconciliation. | App session + server-issued VERIFIED proof reference + controller authority. The session user is never substituted for `controllerAddress`. `ERR-004` wrong controller; `ERR-007` consumed digest; `ERR-008` active conflict; `ERR-021` dependency; `ERR-023` stale/idempotency. SELECTIVE/non-persistent requests are explicitly rejected. |
| `POST /api/v1/identity/{prismId}/bindings/{bindingId}/revoke` | Revoke a canonical binding. Body requires `{ venue="BASE", executionAccount, controllerAddress, session? }`; `Idempotency-Key` required (body fallback accepted). The current SDK uses the encoded execution account as `{bindingId}`; the body remains authoritative for the canonical revoke target. | `data`: `{ operationId, state }`; operation remains `submitted` until reconciliation. Revoke of an already REVOKED canonical binding is a benign 200 existing-fact response. | App session + canonical controller authority. `ERR-002` identity, `ERR-004` controller, `ERR-009` missing binding, `ERR-011` already revoked. The deployed V1/V2 read ABI has no verified `get_binding` view; a live reader therefore fails closed with `ERR-021` until typed status/projection evidence is wired. |

### Resolution and operation readback

| Method and path | Purpose / request shape | Response shape, audience, and freshness | Auth / unavailable |
|---|---|---|---|
| `GET /api/v1/resolve/{identifier}?venue=BASE[&allowStale=true]` | Resolve a Prism identifier and venue to the active execution account. `allowStale=true` is an explicit caller opt-in only. | `data`: `{ prismId, venue, executionAccount: string|null, exists: boolean, watermark, authoritativeSource, staleRefused }`. Here `exists` means an active destination exists, not merely that the identity exists. Sources: `registry_canonical`, `indexer_projection`, or `stale_refused`. `x-prism-watermark`, `ETag`, `x-prism-watermark-k: 5`, and `x-prism-authoritative-source` are emitted; stale refusal also emits `x-prism-stale-refused: 1`. | Public. Canonical identity existence is checked before the watermarked read (`ERR-010`/404). Canonical registry is preferred. A scope-bound projection is used only when canonical resolve fails and its watermark is fresh within K=5 confirmed blocks. ACTIVE with unknown/stale freshness is refused as `executionAccount:null`; `NO_ACTIVE_DESTINATION` is safe to serve. Projection/provider failure is `ERR-021`/503 or stale refusal `ERR-023`/409. |
| `GET /api/v1/operations/{operationId}` | Read a durable operation by id. No body. | Public operation projection: `{ id, kind, state, version, createdAt, updatedAt, authoritativeSource, txHash, errorCode, errorDetail, attempts, submissionAttempted, correlationId, reconciliationWatermark }`. Internal `idempotencyKey`, `requestFingerprint`, and `reconciliationMetadata` are intentionally omitted. `ETag` is the operation version. | Public read in the current route. `submitted`, `processing`, `confirming`, `confirmed`, `indexed`, `reconciled`, `completed`, `failed_retryable`, `failed_terminal`, `reverted`, `expired`, `cancelled`, and `requires_attention` remain distinct. `ERR-002`/404 unknown; `ERR-021`/503 store. |
| `GET /api/v1/receipts/{receiptId}` | Read the receipt projection for an operation/receipt id. No body. | `data`: `{ receiptId, operationId, kind, state, txHash, createdAt, updatedAt, watermark, errorCode, errorDetail, correlationId }`; `ETag` is operation version when present and watermark is exposed as `x-prism-watermark` when present. Error detail is redacted. | Public read in the current route. Receipt is observational and does not bypass operation reconciliation. `ERR-002`/404 unknown, `ERR-021`/503 store. A receipt with `state:"submitted"` is not completion evidence. |

### Connected portfolio

| Method and path | Purpose / request shape | Response shape, source, freshness, and privacy boundary |
|---|---|---|
| `GET /api/v1/portfolio/{prismId}` | Public read. Optional `X-Privacy-Wallet-Consent: granted|denied|required` and opaque `X-Privacy-Wallet-Session-Ref` request private STRK20 projection. | `data` always carries explicit `BASE`, `STARKNET`, and `STRK20` branches. Each branch has typed `state` (`loading`, `empty`, `observed`, `stale`, `unavailable`, `partial`, `unknown`), `authoritativeSource`, `observedAt`, `freshness`, `coverage`, and `assetUnitCompatibility`. Base/Starknet accounts come only from explicit binding/resolution authority; no address/alias/graph inference. STRK20 is never read without granted wallet consent. `total` is null or a fresh valuation-backed amount; partial totals are labeled `coverage:"partial"` and list excluded assets. |

### STRK20 actions and privacy receipts

|| Method and path | Purpose / request shape | Response shape, lifecycle, and privacy boundary |
|---|---|---|
|| `POST /api/v1/strk20/actions` | Authenticated app session via body `session`/`appSession` or session headers. Body requires `actionId` and `kind` (`shield`, `private_transfer`, or `application`); optional `operation` is `create`, `prepare`, `submit`, or `observe_receipt`, with wallet/session and typed action fields. `Idempotency-Key` is preferred; body `idempotencyKey` is accepted. | HTTP 200 with JSON-safe `Strk20ActionData`. `create` is a local record/fence; `prepare`, `submit`, and `observe_receipt` advance explicit lifecycle steps through injected wallet/provider ports. `submitted`, `processing`, `receipt-confirmed`, `reverted`, `unknown`, `unavailable`, and `requires-attention` remain distinct. Provider capability, registration, fee, consent, proof status, submission-attempt fence, and receipt state are separate fields. `STRK20-*` errors are stable; `ERR-021`/503 means factory initialization failure. |
|| `GET /api/v1/strk20/actions/{actionId}` | JSON-safe action read; no body. | HTTP 200 with the same `Strk20ActionData` allow-list. `proof.call` is always `null`; no raw proof, calldata, notes, keys, or provider response is returned. Unknown action is a typed not-found/stale error; absent wallet/provider service remains an explicit unavailable state. |
|| `GET /api/v1/privacy/receipts/{receiptId}` | Read the derived policy-filtered projection for an action/receipt id; no body. | HTTP 200 with `{ receiptId, actionId, mechanism, observationStatus, evidenceSource, protectedProperties, publicProperties, limitations, transactionHash?, blockNumber? }`. `observationStatus` is `UNOBSERVED`, `PENDING`, `OBSERVED`, or `UNAVAILABLE`; `OBSERVED` requires a matching successful final receipt and pinned STRK20 pool event. This is not the generic `/api/v1/receipts/{receiptId}` operation projection and never returns viewing keys, notes, private balances, sender attribution, raw proofs, calldata, or provider diagnostics. |

The STRK20 action and privacy-receipt routes are locally mounted and tested,
but the default factory has no wallet/provider lifecycle source; provider-backed
and live receipt evidence therefore remains explicitly unavailable/open. A local
HTTP 200 or submitted hash is not a completed privacy action.

### Intent and pause workflow

| Method and path | Purpose / request shape | Response shape and lifecycle | Auth / CAS / unavailable |
|---|---|---|---|
| `POST /api/v1/intents` | Create an ExecutionIntent and deterministic plan. Body: `{ prismId, purpose="payment", venue?, executionAccount?, amount?, asset?, recipientPrismId?, recipientAddress?, session? }`; `Idempotency-Key` required (body fallback accepted). | `data`: `{ intentId, prismId, purpose, venue, executionAccount, amount, asset, recipientPrismId, recipientAddress, planHash, createdAt, idempotencyKey, correlationId }`. | App session required. Recipient mismatch/invalid plan is rejected. `ERR-023`/409 on idempotency conflict; `ERR-100`/422 invalid intent; `ERR-021`/503 store/dependency. |
| `POST /api/v1/intents/{intentId}/pause` | Materialize the current intent plan as a pause. Body may contain `session`; intent id is the path. | `data`: `{ pauseId, intentId, planHash, state:"PAUSED", version, reasonCodes, riskLevel, expiresAt, lastVerifiedAt, requiredApprovalCount, approvalScopeHash, settlementOperationId, correlationId }`. | App session required. `ERR-105`/410 expired intent, `ERR-109`/404 missing intent, `ERR-112`/409 duplicate active pause, `ERR-021`/503 store. |
| `GET /api/v1/pauses/{pauseId}` | Read pause state. No body. | Same pause data shape as above. `ETag: "{version}"`. | Public in the current route; do not treat visibility as authority. `ERR-002`/404 missing pause, `ERR-021`/503 store. |
| `POST /api/v1/pauses/{pauseId}/verify` | Run server-side verification. Body: `{ planHash?, policyVersion?, session? }`. Client-supplied `sources` is rejected; facts come from the configured verification provider. | Updated pause. States: `RELEASE_READY`, `ESCALATED`, `EXPIRED`, or blocking/error. `ETag` is pause version. | App session required, but verification authority is the server provider. Missing/unknown checks fail closed (`ERR-116`); plan/policy mismatch is `ERR-102`/`ERR-103`; source input is `ERR-121`/422. |
| `POST /api/v1/pauses/{pauseId}/approve` | Approve/confirm an escalated pause. Body: `{ planHash?, approvalScopeHash?, approver?, approverAddress?, session? }`. `approver*` is an untrusted claim; the server authority resolver decides. | Updated pause, usually `RELEASE_READY` only when current checks permit; otherwise remains `ESCALATED`. `ETag` is pause version. | App session required. No wallet/controller authority is inferred from the session or claim. `ERR-123` authority unconfigured, `ERR-125` denied, `ERR-104` scope mismatch, `ERR-115` replay, `ERR-116` unknown blocking. |
| `POST /api/v1/pauses/{pauseId}/release` | Release an exactly verified/approved pause. Body: `{ planHash?, approvalScopeHash?, settlementOperationId?, expectedVersion?, session? }`; `If-Match`/`X-Expected-Version` also accepted. | Updated pause with `state:"RELEASED"` and a future `settlementOperationId`. The linked operation is never reported completed by this endpoint. `ETag` is pause version. | App session + configured authority resolver. CAS is required against the current pause version. Plan and approval-scope hashes are immutable bindings. `ERR-111` stale version, `ERR-117` not ready, `ERR-113` expired, `ERR-123`/`ERR-125` authority, `ERR-021` dependency. |
| `POST /api/v1/pauses/{pauseId}/cancel` | Cancel a non-terminal pause. Body: `{ expectedVersion?, reason?, authorityActor?, session? }`; headers may carry expected version. `authorityActor` is an untrusted claim. | Updated pause with `state:"CANCELLED"`; `ETag` is pause version. | App session + server authority resolver; CAS required. `ERR-111` stale version, `ERR-118` not allowed, `ERR-123`/`ERR-125` authority. |
| `POST /api/v1/pauses/{pauseId}/escalate` | Escalate a pause with the server policy reason. Body may contain `session`. | Updated pause with `state:"ESCALATED"`; `ETag` is pause version. | App session required. `ERR-119` illegal escalation, `ERR-021` store. |

## 3. Frontend state and source rules

- Treat operation states as a state machine, not as optimistic success. In particular, `submitted` means a transaction hash/operation was persisted and submitted; it is not canonical completion.
- Treat `RELEASED` as a pause decision plus a future settlement-operation link, not settlement completion.
- For by-controller discovery, render `status: "UNKNOWN"` as unknown. Do not map it to ACTIVE or SUSPENDED.
- For resolve, render `staleRefused: true` / `authoritativeSource: "stale_refused"` as a fail-closed no-destination state, with a refresh/retry affordance rather than claiming the binding is revoked.
- Use `ETag`/`If-Match` for pause CAS and re-read after `ERR-023`/`ERR-111`. Preserve request and correlation ids in support diagnostics.
- Public binding lists may contain only PUBLIC/ACTIVE endpoint data. Private lists are session + owner-authorized and return recovered owner views; never log or persist a ciphertext/protection envelope in frontend state.

## 4. Deliberately unavailable or out of scope

1. There is no `GET /api/v1/intents/{intentId}` route in this surface; intent creation and pause materialization are the available intent operations.
2. The live V1/V2 registry read ABI has no by-controller view and no verified binding-status view. Production discovery therefore requires the factory's scoped public event projection; revoke status otherwise fails closed.
3. Production startup fails closed without Postgres and a valid Starknet RPC + registry address + network + explicit ABI version. Canonical SN_SEPOLIA V2 address/network/start-block/class-hash gates are strict. No production memory fallback is valid.
4. Private binding creation/read/publication remains blocked until owner authorization and encryption-at-rest/key-ownership/recovery evidence are supplied by real providers.
5. No endpoint grants a controller or settlement authority from a wallet address alone, an app session, or a request claim. No live broadcast, deployment, mainnet, or evidence-promotion contract is exposed here.
