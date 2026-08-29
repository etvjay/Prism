# Prism Identity Privacy / Blocked Decisions and Integration Gates

**Status:** Blocked-decision record; proposal only
**Base inspected:** `aae06b864e431e65e5e03d87f4d863080f69f0fe`
**Owner acceptance:** none by this lane
**Protected files intentionally unchanged:** `projects/prism/DECISIONS.md`, `projects/prism/EVIDENCE_LEDGER.md`, frontend files, `strk20.json`, secrets/deployment configuration

This document does not accept, amend, or supersede any decision. It records what must be decided or proven before the API/evidence integration can be mounted.

## A. Proposed decisions from the supplied specification

The following remain **PROPOSED / OPEN** exactly as supplied. They are not canonical project decisions until the owner records an append-only acceptance or supersession in the project decision ledger.

| Decision | Pending question | Why it blocks the integration | Required owner action |
|---|---|---|---|
| DEC-PRISM-019 | Are Starknet ID/ENS values external aliases only, never Prism identity roots? | Alias adapter and route must not infer `PrismId` from a provider name/subject. | Accept, reject, or supersede; preserve explicit association as the only alias→Prism link. |
| DEC-PRISM-020 | Are authority/control and disclosure/visibility independent? | Binding schemas, owner authorization, public projection, and session authority depend on separate dimensions. | Accept or amend the authority/disclosure invariant and its enforcement owner. |
| DEC-PRISM-021 | Must a private binding never publish endpoint plaintext? | Determines whether a private-binding route may exist at all and requires a real protection/key-management port. | Accept with required protection evidence, or narrow the product claim. |
| DEC-PRISM-022 | Is Privacy Mode only a product policy bundle over binding-level policies? | Prevents a global boolean from becoming the canonical privacy model. | Accept or specify a different policy hierarchy; do not wire UI state before this is settled. |
| DEC-PRISM-023 | Does PUBLIC→PRIVATE mean future unpublication plus historical warning, never erasure? | Public/private transition route and receipt copy must not claim historical unlinkability. | Accept the non-erasure semantics and warning language, or define the alternative truthfully. |
| DEC-PRISM-024 | Is a session grant bounded temporary authority, not an identity/account? | Prevents session keys from being returned or treated as Prism IDs, root keys, shadow accounts, or ownership. | Accept state machine/authority terminology and required wallet validation boundary. |
| DEC-PRISM-025 | Are STRK20 shadow accounts a separate execution mechanism, deferred from MVP? | Prevents accidental coupling of shadow-account support to the MVP route and avoids claiming wallet capability not proven at the pinned interface. | Accept the existing v0 deferral or explicitly reopen the scope with pinned-package/runtime evidence. |

The existing `DEC-PRISM-015` v0 shadow-account exclusion remains in force until explicitly reopened. No route in this handoff assumes shadow accounts exist.

## B. Non-decision blockers in the current implementation

### B1. Binding model mismatch

Two uncommitted models are present:

- `src/features/prism-bindings/domain/types.ts` supports `PUBLIC | SELECTIVE | PRIVATE` and separately models `PERSISTENT | SESSION | EPHEMERAL` lifecycle.
- `src/features/prism-identity/domain/binding-disclosure.ts` uses a discriminated `PUBLIC | PRIVATE` storage union and a protected endpoint envelope; it has no SELECTIVE storage representation.

The parent must choose a compatibility model before adding routes:

1. keep SELECTIVE as a policy-only view over a private storage record;
2. add a distinct SELECTIVE protected representation; or
3. explicitly defer SELECTIVE and constrain the public API to PUBLIC/PRIVATE.

Silently mapping SELECTIVE to PRIVATE or PUBLIC would violate the supplied specification.

### B2. Private storage protection is a port, not evidence

`PrivateBindingProtectionPort` requires proof of encryption at rest, key ownership, and recovery. A `ciphertext: string` type or an in-memory adapter is not that proof. Until an approved provider implements the port and a restart/recovery test passes:

- private-binding create/read routes remain `BLOCKED_BY_KEY_MANAGEMENT`;
- no private endpoint may be placed in a public registry, event, API response, log, or evidence envelope;
- ordinary localStorage must not be described as secure storage.

### B3. Owner authorization is unresolved at the application boundary

The current app session (`AppSession.userId`) and the Starknet controller/identity authority are intentionally distinct. There is no accepted mapping proving that a session user owns a Prism ID or private binding. The route must call an injected owner authorizer and fail closed when it is absent; it must not accept a client-provided `actorId`, controller, or requester string as ownership proof.

### B4. Alias provider evidence and data shape are incomplete

The provider-neutral alias files use `{ provider, value }` and return an external subject. The supplied spec also names namespace, chain ID, resolved address, and verification time. The parent must reconcile the wire shape without making the external subject a Prism ID.

`StarknetIdAliasProvider` currently returns `BLOCKED_BY_INTERFACE_EVIDENCE` when no injected `StarknetIdLookupPort` exists. Do not add a guessed RPC endpoint or claim `.stark` resolution from a fixture as live evidence.

### B5. Continuity application service and Pause mapping are missing

Resolution snapshot stores and risk-diff foundations are present in the active worktree, but tests reference a missing `src/features/prism-resolution/application/continuity-service.ts`. The service must:

- load the prior scoped snapshot;
- compare the current authoritative resolution;
- persist with version/CAS;
- return stable risk records and watermark/source;
- map blocking risks to the existing Pause policy path;
- preserve `NO_ACTIVE_DESTINATION` and stale-refusal semantics.

It must not mark a transfer reversible merely because a warning was shown.

### B6. Wallet session interfaces are not yet proven at the pinned route

The active wallet-session work adds state contracts and imports missing adapters/tests. Before mounting a session capability/grant route, resolve:

- missing Starknet/privacy wallet adapter modules;
- Base proof adapter interface drift;
- separation of app authentication, wallet authority, and session-grant authority;
- the exact pinned `WalletAccountV6`/Wallet API interface for session-capable accounts;
- explicit consent and receipt observation behavior.

A browser capability observation may gate UX but is not authorization. No route may accept viewing keys, private keys, seed phrases, wallet passwords, raw proofs, or notes.

### B7. Session grant transport cannot serialize the domain type directly

`src/features/prism-authority/domain/types.ts` currently uses `bigint` for token limits and usage. The REST/SDK boundary must use canonical non-negative decimal strings, with explicit range/duplicate checks. A generic JSON serializer must not coerce BigInt or silently round it.

Session grant routes also need:

- CREATED→ACTIVE transition rules;
- expiry/revocation/exhaustion terminal semantics;
- target contract/selector and token ceiling enforcement;
- owner authorization;
- no owner private key transfer to a delegate;
- no automatic shadow-account identity equivalence.

### B8. STRK20 action service and application route are incomplete

The existing M4 `Strk20State`, `Strk20ActionPort`, Wallet API adapter, receipt normalizer, and privacy guard are local X2 components. The active uncommitted M5 tests reference a missing `PrivacyActionService` and additional M5 modules. Until that service is implemented and verified:

- `/v1/strk20/actions` must not be mounted;
- no raw Starknet invoke can be promoted as a private action;
- an empty/simulated proof cannot be submitted;
- a submitted hash cannot be represented as completed;
- no live STRK20 privacy claim can be entered in `EVIDENCE_LEDGER.md` or `strk20.json`.

### B9. Privacy receipt output needs a transport redaction layer

The current STRK20 receipt/domain types contain fields such as `feePaid: bigint`, normalized events, sender metadata, and provider-bound values. A privacy receipt route must use a dedicated, JSON-safe projection:

- no BigInt values;
- no raw provider response, calldata, proof, notes, viewing key, or private key;
- no sender-as-user attribution for relayed private actions;
- `shield` has public depositor/token/amount/timing limitations;
- private transfer/invoke claims only the fields the observed mechanism supports;
- missing/pending/reverted receipts remain non-terminal or unavailable;
- `observed` requires an explicit provider receipt or canonical readback source.

### B10. API route ownership is already claimed by other lanes

The M2 REST/API/SDK lane owns `src/application/*`, `src/app/api/*`, SDK/OpenAPI/MCP surfaces. The M4/M5 lanes own the Wallet API and STRK20 action seams; M7 owns Pause. This lane therefore did not edit those files or add duplicate route handlers. Parent integration must serialize changes and rerun the full suite after merging each lane.

## C. Current contradictions and assumptions that remain relevant

### Contradictions

- `CON-PRISM-006` remains open: product authentication is distinct from wallet/native execution authority. A capability route cannot prove an action is authorized.
- `CON-PRISM-011` remains open: shadow-account SDK evidence does not prove the pinned consumer Wallet API route. Do not make shadow accounts sprint-critical without the specified re-verification.
- `CON-PRISM-012` is resolved at the environment boundary (SN_SEPOLIA default, mainnet release gate), but live testnet/mainnet evidence remains pending.
- Existing canonical system docs still describe the PRISM-7/8 binding as public-only; the supplied privacy specification is a proposed extension and must not silently rewrite that system truth.

### Assumptions

- ASM-PRISM-001: the registry + proof/bind/resolve/revoke slice demonstrates a persistent identity — still open in the evidence ledger.
- ASM-PRISM-002: the Wallet API supports the required private flow without Prism handling viewing keys — critical and still open.
- ASM-PRISM-003: embedded/app authentication can coexist with wallet-mediated privacy execution — still open.
- ASM-PRISM-005: Base proof can be verified offchain and accepted canonically on Starknet — local components exist, decisive live evidence remains open.

No assumption above should be converted into a route success response or maturity promotion.

## D. Required owner/integration sequence

1. Resolve DEC-PRISM-019..025 explicitly; do not infer acceptance from this packet or from uncommitted code.
2. Reconcile `prism-bindings`/`prism-disclosure` schemas, especially SELECTIVE and lifecycle.
3. Complete owner authorization and real protected-store readiness; add refusal tests first.
4. Complete alias provider interface evidence and explicit association port.
5. Complete continuity service, CAS/restart tests, and Pause risk mapping.
6. Complete pinned wallet/session adapters and prove no-secret state boundaries.
7. Complete STRK20 action service, receipt projection, and route/application ports using wallet-mediated proof only.
8. Add thin M2 handlers/Next routes/OpenAPI/SDK/MCP entries in the owning lane; preserve existing envelope and error catalogue.
9. Run focused route/port tests, then `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check` on a clean integrated worktree.
10. Produce evidence envelopes from actual observed operations; independently read back receipts; keep maturity at X2 until testnet evidence exists and never touch `strk20.json` for this work.

## E. Verdict

**BLOCKED — no code integration claim.** The contract is ready for parent integration, but owner decisions, active-lane reconciliation, missing application services/adapters, and evidence gates remain open. This record deliberately makes those blockers visible instead of accepting the proposed decisions or fabricating privacy/session/STRK20 state.
