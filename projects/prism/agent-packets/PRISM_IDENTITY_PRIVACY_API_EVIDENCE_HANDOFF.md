# Prism Identity Privacy / API + Evidence Integration Handoff

**Status:** Proposal-only integration handoff; no owner decision accepted
**Requested base:** `aae06b864e431e65e5e03d87f4d863080f69f0fe`
**Scope:** transport-neutral contract, route handoff, evidence boundary, and blockers
**This lane changed:** documentation only
**This lane did not:** edit frontend files, mount Next routes, edit `DECISIONS.md`/`EVIDENCE_LEDGER.md`, touch `strk20.json`, use secrets, call live RPC, deploy, push, open a PR, or accept DEC-PRISM-019..025

## 1. Executive outcome

The requested base already contains the M2 transport-neutral application envelope and the existing identity/binding/challenge/resolve/operation/receipt/Pause HTTP routes. It does **not** yet expose the privacy-spec additions as a parent-integrated API surface.

While this handoff was being prepared, the shared worktree acquired an active uncommitted implementation lane covering the same requested concepts:

- `src/features/prism-bindings/`
- `src/features/prism-disclosure/`
- `src/features/prism-authority/`
- `src/features/prism-resolution/`
- `src/integrations/identity-alias/`
- `src/integrations/starknet-id/`
- `src/features/wallet/session/`
- `src/features/prism-identity/domain/binding-disclosure.ts`
- uncommitted STRK20 M5 action/maturity files and tests

Those files are not this lane's work and are not yet a verified, integrated commit. Because they claim the same domain boundaries, adding duplicate schemas, ports, handlers, or routes here would violate the non-overlap rule. The safe deliverable is therefore this contract and the companion blocked-decisions record.

## 2. Baseline and evidence posture

### Requested base inspection

- Repository: `/home/ubuntu/prism-work/Prism`
- Initial `HEAD`: `aae06b864e431e65e5e03d87f4d863080f69f0fe`
- Initial branch: `supremacy817/prism-17-build-canonical-prism-landing-experience`
- Initial worktree had pre-existing untracked `.hermes/`, `.worktrees/`, and contract cache directories; they were not touched.
- Initial exact-base test run before the concurrent worktree edits: `npm test` → **80 passed, 1 skipped; 885 passed, 1 skipped**.
- Initial exact-base typecheck before the concurrent worktree edits: `npm run typecheck` → **PASS**.
- No clean exact-base build was run by this lane. Existing project records report prior build passes, but those are not new evidence from this handoff.

### Current shared-worktree caveat

The worktree is now dirty from the concurrent lane. A subsequent `npm run typecheck` is **OPEN/failed**, with representative failures including:

- `OwnershipProofStore` implementors missing the newly required `claimVerifiedBinding` method;
- missing `prism-authority`, `prism-resolution`, binding-disclosure, and wallet-session adapter/service modules referenced by newly present tests;
- STRK20 privacy action service test imports a missing `privacy-action-service` module;
- existing application tests reference payload/interface changes not yet reconciled.

These failures are not attributed to this documentation-only lane and must be resolved by the owning implementation lane before integration. No attempt was made to repair or revert another lane's files.

### Existing evidence register facts

`projects/prism/EVIDENCE_LEDGER.md` currently records:

- EVD-PRISM-012 wallet capability slice: **X2 PASS**; no live wallet/private-state proof.
- EVD-PRISM-013 truthful landing/workspace surface: **X2 PASS**; no live identity/binding/STRK20/Pause evidence.
- EVD-PRISM-005/006/007 Base control, active resolution, and revocation: **X0 / NOT_IMPLEMENTED** in the ledger, regardless of local fixtures.
- EVD-STRK20-001..006 private reachability, private balance/action, helper receipts, and validator evidence: **X0 / NOT_IMPLEMENTED**.

This handoff does not promote any row. Local type tests or a route descriptor cannot become testnet/mainnet evidence.

## 3. Existing API and application contract

### Mounted Next routes at the requested base

| Existing route | Current responsibility | Privacy-spec boundary |
|---|---|---|
| `POST /v1/identity` | Persist operation and submit identity creation | Existing chain-touching operation path; do not infer privacy state from a submitted operation. |
| `GET /v1/identity/:prismId` | Watermarked canonical identity read | Returns identity/controller only; no binding disclosure. |
| `POST /v1/identity/:prismId/bindings` | Base binding submission | Existing M2/M3-owned route; current payload is public Base binding-oriented and has no visibility/lifecycle contract. |
| `POST /v1/identity/:prismId/bindings/:bindingId/revoke` | Binding revoke | Existing route; revocation remains canonical only after chain observation. |
| `POST /v1/challenge/issue` | Ownership challenge | Wallet/base proof boundary; challenge is not a session grant and must not carry private-state material. |
| `POST /v1/challenge/verify` | Ownership proof verification | Verified proof is not an ACTIVE canonical binding. |
| `GET /v1/resolve/:identifier?venue=BASE` | Watermarked canonical destination resolve | Current response is `{ prismId, venue, executionAccount, exists, watermark }`; no alias namespace, requester, visibility, source, or continuity risks. |
| `GET /v1/operations/:operationId` | Durable operation read | Existing lifecycle is the source for submitted/confirmed/reconciled truth; do not synthesize STRK20 completion from a hash. |
| `GET /v1/receipts/:receiptId` | Operation-derived receipt | Generic operation receipt; privacy receipt needs a separate policy-filtered projection. |
| `/v1/intents` and `/v1/pauses/*` | Intent/Pause policy and settlement boundary | Resolution continuity risks must feed this path; a frontend warning is not a reversible settlement. |

No mounted route was found for private bindings, alias provider resolution, continuity assessment, wallet session capability, STRK20 action lifecycle, or privacy receipts.

### Existing transport-neutral application boundary

`src/application/schemas.ts` and `src/application/ports.ts` already establish the reusable envelope:

- `AppRequestHeaders`: request, idempotency, expected-version, and correlation identifiers;
- `AppCommandRequest` / `AppResponse`: transport-neutral request/session/payload and stable error shape;
- `RegistryReadPort`: canonical identity, resolve, binding status, digest consumption;
- `StarknetSubmitPort`: create/bind/revoke chain submission, with explicit test-double/live metadata;
- `src/application/handlers.ts`: thin handlers over `PrismApplicationService`;
- `src/application/http-helpers.ts`: stable HTTP mapping, request/correlation echo, watermark and ETag mapping.

The privacy additions should reuse these semantics rather than create a second envelope or authority path. They require new ports for private binding disclosure, external alias lookup/association, continuity snapshots, wallet capability/session observation, STRK20 action observation, and privacy-receipt projection. Those ports must remain free of Next/DB/RPC/wallet SDK imports.

## 4. Minimum integration contract

The following is the minimum parent-facing contract. It is intentionally a contract, not a claim that the routes are mounted.

### 4.1 Binding and disclosure

Use the active lane's discriminated storage boundary in `src/features/prism-identity/domain/binding-disclosure.ts` as the source to reconcile with `src/features/prism-bindings/domain/types.ts`:

- public stored binding: endpoint plaintext allowed, protected endpoint must be `null`;
- private stored binding: endpoint must be `null`, protected endpoint is an opaque provider envelope;
- `BindingDisclosureStore.listPublicForIdentity()` returns only ACTIVE public records;
- `PrivateBindingProtectionPort` must report proven encryption-at-rest, key ownership, and recovery before private binding operations;
- `BindingOwnerAuthorizationPort` is authoritative for owner operations; `actorId` must not be treated as proof of ownership;
- version/visibility/status compare-and-set is required for transitions;
- `historicalPublic`/`publiclyExposedAt` are monotonic facts; hiding a public row never erases chain/indexer history.

`src/features/prism-bindings/domain/types.ts` additionally models `SELECTIVE` visibility and separates `BindingLifecycle` from visibility. This is currently not reconciled with the disclosure storage union, which only accepts `PUBLIC | PRIVATE`. Do not silently collapse SELECTIVE into PRIVATE or PUBLIC.

The transport view must be audience-filtered before the route adapter sees it:

```ts
// Public view: only ACTIVE + PUBLIC + endpoint address disclosed.
GET /v1/identity/:prismId/bindings
→ BindingView[]

// Owner-only private creation; endpoint plaintext never enters a public response.
POST /v1/identity/:prismId/private-bindings
→ owner BindingView | typed BLOCKED/UNAVAILABLE

// Owner-only transition; PUBLIC requires explicit publication confirmation.
PATCH /v1/identity/:prismId/bindings/:bindingId/disclosure
→ BindingView + historical-public warning when applicable
```

A private relationship must disappear from the public list, not appear as a redacted `PRIVATE` marker that reveals the relationship exists. Owner/authorized views may include the endpoint only after the protection and authorization ports succeed. No route may accept or return viewing keys, private keys, seed phrases, wallet passwords, private notes, or encryption keys.

### 4.2 External alias and explicit association

Use the active provider-neutral contracts in:

- `src/integrations/identity-alias/types.ts`;
- `src/integrations/starknet-id/types.ts` and `adapter.ts`;
- `IdentityAliasProvider` for provider lookup;
- `IdentityAliasAssociationPort` for an explicit Prism association.

Minimum route:

```http
GET /v1/aliases/:provider/:value
```

Response must distinguish:

- `RESOLVED` / `NOT_FOUND` / `UNAVAILABLE` / `BLOCKED_BY_INTERFACE_EVIDENCE` / `INVALID_RESPONSE`;
- provider subject from Prism ID;
- explicit association from unassociated provider resolution.

The Starknet ID adapter currently fails closed without an injected `StarknetIdLookupPort`. It must not call an invented/default endpoint and must never map `victory.stark` to a Prism ID by string equality.

### 4.3 Resolution and continuity

Use the active snapshot model in `src/features/prism-resolution/domain/snapshot.ts` and risk vocabulary in `domain/risks.ts`:

- snapshot key is scoped by Prism ID, venue, and purpose;
- snapshot store is durable/CAS-versioned and clone-on-read;
- canonical registry state remains authoritative; snapshots are comparison baselines only;
- risks are typed (`ADDRESS_CHANGED`, `ALIAS_CHANGED`, `CHAIN_CHANGED`, `BINDING_REVOKED`, `VISIBILITY_CHANGED`, `NO_ACTIVE_DESTINATION`, and provider/snapshot-unavailable risks);
- provider failure or missing snapshot must remain `UNKNOWN`/blocked, not become an empty success.

Minimum route:

```http
GET /v1/resolution/:identifier/continuity?venue=BASE&purpose=SEND
```

Response needs `previous`, `current`, stable risk records, an explicit continuity status, and the canonical watermark/source where available. The missing `src/features/prism-resolution/application/continuity-service.ts` referenced by the active tests is the required application port/service seam. The route must feed the existing Pause intent/policy flow; it must not directly release or settle an action.

### 4.4 Wallet capability and session authority

Use the active wallet/session contracts in `src/features/wallet/session/types.ts` and `session-state.ts` as a stateful adapter boundary around the existing M4 `WalletStrk20ActionPort`:

- wallet capability is observed from declared API/spec/network data only;
- unknown capability and network mismatch are distinct from unsupported capability;
- consent is explicit and separate from capability;
- submitted is not receipt-confirmed;
- signatures/proofs are ephemeral adapter outputs, not session-state fields;
- session state must clear account, capability, consent, submission, receipt, and proof readiness on disconnect/account change.

Minimum capability read contract:

```http
GET /v1/wallet/session/capability
```

This is wallet-mediated, not a server trust claim. With no wallet-bound observation the route must return a typed `UNKNOWN`/`UNAVAILABLE` result. Client-submitted capability data may gate UX only; it must not authorize a chain action.

Session grants remain a separate authority object:

```http
POST   /v1/identity/:prismId/session-grants
GET    /v1/identity/:prismId/session-grants/:sessionId
DELETE /v1/identity/:prismId/session-grants/:sessionId
```

The active authority type uses `bigint` token limits internally. The application/transport adapter must encode limits as canonical decimal strings and reject raw BigInt JSON. It must never accept a root private key or treat a session key as a Prism identity, shadow account, or persistent execution account. No route should be mounted until a real wallet/account session interface is tested; the spec itself marks this adapter experimental/extension scope.

### 4.5 STRK20 action lifecycle

The existing M4 domain is the source of action truth:

- `src/features/prism-strk20/domain/strk20-state.ts` for flow state and receipt gates;
- `domain/strk20-action-port.ts` for action/capability/receipt normalization;
- `adapters/wallet-strk20-action-adapter.ts` for provider-injected Wallet API calls;
- `domain/privacy-guard.ts` for secret and privacy-copy guards.

The active uncommitted M5 tests expect a `PrivacyActionService`; that service is not yet present in the current shared worktree and must be completed by its owning lane.

Minimum route pair:

```http
POST /v1/strk20/actions
GET  /v1/strk20/actions/:actionId
```

The request contains Prism vocabulary only: action kind, Prism ID, idempotency/correlation data, and an opaque wallet-mediated session reference. It must not contain raw calldata, proof bytes, viewing keys, private notes, or seed material. The response is a transport-safe lifecycle view containing:

- action ID, kind, state, version, timestamps;
- capability/network status;
- operation/receipt references where independently observed;
- transaction hash only when returned by the wallet/provider;
- screening and stable error code;
- no amount/recipient/token fields for private actions unless a separate privacy review explicitly marks them public.

`confirmed`, `privately_available`, and `transfer_confirmed` require the existing receipt/finality/pool-event gates. A submitted hash alone is not completion evidence.

### 4.6 Privacy receipts

Minimum route:

```http
GET /v1/privacy/receipts/:receiptId
```

This is a derived, policy-filtered projection, not a second ledger. It must carry:

```ts
mechanism:
  NONE | PRISM_DISCLOSURE_CONTROL | STRK20_PRIVATE_TRANSFER |
  STRK20_PRIVATE_INVOKE
# shadow-account support is an optional provider observation, not a receipt mechanism
observationStatus: UNOBSERVED | PENDING | OBSERVED | UNAVAILABLE
evidenceSource: NONE | WALLET_DECLARED_API | PROVIDER_RECEIPT | CANONICAL_CHAIN_READBACK
protectedProperties: string[]
publicProperties: string[]
limitations: string[]
transactionHash?: string
blockNumber?: number
```

Rules:

- shield/deposit is not a private receipt merely because later notes may be private;
- private transfer can hide sender/recipient/amount/token relation only to the extent the underlying provider receipt supports that claim;
- proof artifacts, timing, funding, gas, and application-log correlation remain limitations;
- no receipt can claim historical unlinkability;
- a provider/readback failure is `PENDING`/`UNAVAILABLE`, never a fabricated `OBSERVED` receipt;
- generic operation receipts and privacy receipts remain separate types.

## 5. Route/application integration rules

The parent integration lane should add the above contract behind the existing M2 envelope, not by editing route files opportunistically:

1. Define application request/response types with decimal strings at the transport boundary.
2. Define ports for binding disclosure, alias resolution/association, continuity snapshots, wallet capability/session authority, STRK20 lifecycle, and privacy receipts.
3. Add thin handlers that call exactly one port/service and preserve stable `AppResponse` error semantics.
4. Mount Next routes only after the corresponding port has an adapter and a focused route test.
5. Reuse `requestId`, `correlationId`, `Idempotency-Key`, `If-Match`, watermarks, and ETags.
6. Keep all canonical identity state on the Starknet registry; private state remains in the protected store/provider boundary.
7. Keep Pause as the policy/settlement boundary. Resolution risk can require confirmation/block/escalation; it cannot directly settle.
8. Add OpenAPI/SDK/MCP entries only in the owning M2 API/SDK lane after the application contracts are accepted. MCP must call the same handlers and never gain secret access.

## 6. Required evidence before any maturity claim

| Gate | Required proof | Current disposition |
|---|---|---|
| Binding disclosure | Public/private/owner views, public list exclusion, CAS transition, historical warning, protection-port refusal | Active local files/tests are uncommitted and currently not typecheck-clean; **X0 for integrated API** |
| Alias resolution | Real provider interface evidence, explicit association, unavailable/invalid response tests | Adapter is blocked without injected lookup evidence; **X0** |
| Continuity | Snapshot restart/CAS, address/alias/chain/revocation/visibility risks, Pause mapping | Store/risk foundations exist; application service/route is missing; **X0** |
| Session authority | Pinned wallet/account interface, bounded grant state machine, decimal transport, revoke/expiry/exhaustion tests | Domain/session files are incomplete/uncommitted; wallet session evidence open; **X0** |
| STRK20 action | Wallet-declared capability, consent, real proof, provider receipt, finality, pool event, non-attribution, lifecycle route | Existing M4 is local X2; M5 action service/route and live evidence open; **X0 integrated / X2 component** |
| Privacy receipts | Derived receipt fixtures, pending/reverted refusal, mechanism-specific truth labels, no secret fields | Existing receipt/privacy guards are local X2; no privacy receipt route; **X0 integrated / X2 component** |
| Frontend contract | No frontend edits; surface remains honest until observed data exists | Phase 8 contract remains X2 and is preserved |

No X3+ claim is justified. No evidence in this packet is a live receipt, deployment, independent readback, or owner acceptance.

## 7. Integration verdict

**BLOCKED for code integration / ACCEPTABLE as a parent handoff.** The minimum contract is defined above, but the same domain seams are actively being implemented by another uncommitted lane and are not yet typecheck-clean. The parent should integrate that lane once its files, tests, application ports, and route ownership are reconciled, then add only the missing transport adapters and evidence gates described here.
