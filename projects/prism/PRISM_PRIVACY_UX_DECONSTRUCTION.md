# Prism Privacy UX Deconstruction — Build-Ready Brief
**Status:** `PREPARATION_ONLY` — no wallet action, broadcast, deployment, external write, or `strk20.json` mutation is authorized by this document.
**Prepared against:** repository `/home/ubuntu/prism-core-v1-closeout`, baseline `d6b1747` (`main`), prior artifact 849 lines / ~71KB lost at 18:54:27 — this recreation preserves every frozen decision.
**Evidence ceiling:** `X2` local controlled implementation. No live receipt is claimed.
**Protected scope:** do not edit `src/app/*`, `strk20.json`, credentials, key stores, viewing-key material, or production configuration while preparing or validating this brief.
**Purpose:** single build-ready contract for Prism privacy UX so implementation can proceed without re-deriving IA, states, copy, tokens/motion, or failure semantics.
> Zero React code. This brief is prose, tables, and copy only. Any code snippet is a state label or token literal, not an implementation.
---
## 0. How this brief was built (sources)
Read verbatim before writing:
```text
src/features/landing/PrismLanding.tsx              — hero sequence, Satin Resolve, Enter Prism transition, public nav
src/features/landing/IdentityContextMesh.tsx        — 4-state mesh (promise → identity-anchor → native-context → resolved-identity)
src/features/landing/RefractedCore.tsx              — flat vs living Refracted Core, 8 facets, PRISM/HOME/ID/CONTINUITY
src/features/landing/PrismLanding.module.css        — satin motion,heroShell,IdentityMesh, 1430 lines of tokens/animation
src/features/landing/PrismWorkspacePreview.tsx/.module.css — workspace shell, rail, Home/Activity/Connections/Profile
src/app/globals.css + src/app/page.tsx              — page shell #f3f3f3, typography, wallet-section (legacy)
docs/ui/prism-workspace-surface-contract.yaml       — surface contract (overview/activity/connections/profile)
docs/ui/prism-workspace-narrative.md                — operating narrative (relationship → policy → wallet → receipt → Activity)
docs/ui/prism-workspace-operating-design-ledger.md  — accepted direction, motion decisions, truth decisions
projects/prism/PRIVACY_RUNTIME_CLOSEOUT_RUNBOOK.md  — 866-line secret-free evidence packet (G0–G13, R0–R8)
projects/prism/PRISM_LANDING_VISUAL_SPEC.md         — 395-line landing visual spec (brand, hero, motion, narrative)
projects/prism/PHASE8_FRONTEND_SURFACE_CONTRACT.md  — Phase 8 surface contract (public landing → preview, Home/Activity/Connections/Profile)
projects/prism/agent-packets/FRONTEND_WALLET_SESSION_DESIGN.md — 183-line wallet session design packet (15-state UI model)
src/features/wallet/session/*                       — session-state.ts, types.ts, reducer.ts, selectors.ts, strings.ts, adapter.ts
src/features/prism-strk20/domain/*                 — wallet-capability.ts, strk20-state.ts, strk20-proof.ts, strk20-action-port.ts, errors.ts
src/features/prism-strk20/adapters/* + src/features/wallet/session/* — capability >=0.10.3, two-hash shield, consent gate
```
Prior decisions frozen and re-asserted here: IA frozen (no 5th tab), 15 `SessionUiState` + 13 `Strk20State`, capability `>=0.10.3`, two-hash shield, consent gate before private balance, tokens paper `#f3f3f3` / ink `#101010` / accent `#526f95`, 16+ blocked states, `MATURITY_BLOCKS = 10`.
---
## 1. Governing truths and non-goals
### 1.1 Maturity and protection
```text
X0 hypothesis / planned
X1 fixture or mock
X2 local controlled implementation   ← ceiling for this brief
X3 realistic or testnet observed
X4 repeated / independently reproduced
X5 mainnet or production independently verifiable
```
- A green local suite or a simulated wallet response does not promote a claim.
- The wallet owns registration, viewing keys, private notes, proving, and private-state handling.
- Prism must never request, store, log, transmit, derive, or persist a viewing key, seed phrase, private key, mnemonic, raw proof material, or wallet export.
- Capability detection uses `supportedWalletApi` / `supportedSpecs` version queries only; it must not call a balance method as a feature probe.
- Guard modules: `src/features/prism-strk20/domain/privacy-guard.ts` (`FORBIDDEN_KEY_PATTERNS`, `VIEWING_KEY_FORBIDDEN`) and `src/features/wallet/session/no-secrets.ts` (`SECRET_FIELD_PATTERN`, `SECRET_FORBIDDEN`) fail closed.
### 1.2 Privacy boundary (route-specific)
| Route | Public / observable facts | Claimable hidden facts only when the route is actually observed |
|---|---|---|
| Shield / deposit | depositor, token, amount, timing, pool interaction | do not describe the deposit itself as private |
| Private note-to-note transfer | proof / encrypted-note artifacts and timing may remain observable; pool event exists | sender, recipient, amount, token type, spent-note relationship hidden inside the supported private flow |
| Private application / helper action | pool/helper/protocol action, timing, amount or open-note output may be public | direct user identity may be hidden behind the privacy route; do not claim amount/timing privacy without separate proof |
| Unshield / withdrawal | destination, amount, timing | origin relationship may remain hidden subject to correlation |
| Base or other ordinary external-chain action | ordinary public chain metadata | no private-Base claim in this release |
- Transaction `sender` is a relayer observation, never user attribution. Attribute from the canonical pool/application event or wallet/session evidence, never by grouping on `sender`.
- Never use `completely invisible`, `untraceable`, `private everywhere`, `all amounts hidden`, `zero metadata`, or equivalent overclaims.
### 1.3 Non-goals for this brief

- No live wallet connection, live Prism identity read, live Base binding, durable backend data, live STRK20 private balance/action, Pause settlement, or public production deployment is claimed.
- No redesign of the public landing hero or entry sequence — the Satin Resolve remains the production hero and was not replaced.
- No real relationship messaging, invitation acceptance, encrypted composer, or structured payment/claim/receipt cards in this pass — those are deferred surfaces.

---

## 2. Information architecture — frozen

### 2.1 Site IA

```text
/                          — public landing (PrismLanding)
  #top                     — public nav anchor
  #hero-sequence           — hero narrative (4 states)
  #identity-context        — IdentityContextMesh (embedded in heroObject)
  #workspace               — workspace preview anchor (PrismWorkspacePreview)
  /api/*                   — reserved; no privacy route schematic invented here
```

IA is **frozen at 4 product views**. No 5th tab is authorized. `Send` and `Receive` remain actions inside Home, not primary destinations.

```text
FROZEN: Overview (Home) · Activity · Connections · Profile
FORBIDDEN: prism-home · id · explorer · chat · messages-as-tab · send-as-tab · receive-as-tab
```

Rationale: the Phase 8 surface contract and workspace surface contract both bind to `Home / Activity / Connections / Profile` (surface-contract.yaml `navigation.primary: [overview, activity, connections, profile]`). Adding a fifth tab reopens navigation, motion, and privacy-surface audits and therefore requires a new decision packet — this brief cannot authorize it.

### 2.2 Landing → workspace transition

```text
warm page shell (#f3f3f3)
  → simple navbar (flat Refracted Core + Prism lockup)
  → centered hero headline + supporting line + Enter Prism CTA
  → Living Refracted Core + IdentityContextMesh
  → scroll narrative (implicit via mesh states)
  → editorial close
  → footer
  → workspace preview (Overview/Activity/Connections/Profile)
```

- `Enter Prism` cancels idle motion, performs `PRISM → HOME` on the living object, recedes hero copy, and reveals the Home shell. The living object is never shrunk into the rail mark — flat and living forms share facet ancestry but are two representations.
- Reduced motion: hero sequence jumps to `resolved-identity`, `introRunning=false`, `transitionCycle=0`; `prefers-reduced-motion: reduce` collapses animations to `0.01ms`.

### 2.3 Workspace composition (Home truth)

Home is the attention-first evidence-aware surface, not a second landing page. From `PrismWorkspacePreview.tsx` and the operating design ledger:

```text
Overview (Home)
  1. compact status header (“Private coordination / Overview”, Unconnected preview badge)
  2. four plain-language actions (Send / Receive / Approval / Connect)
  3. Attention as dominant work queue (0 observed — “Connect to load your decisions.”)
  4. Relationships as messaging entry point (“No active relationships loaded.”)
  5. Private state + canonical context as truthful status rows (never invented values)
  6. Recent Activity as evidence only (“No reconciled operations or receipts have been observed. Submitted is not complete.”)

Activity      — “Only evidence belongs here.”  Facts: No operations / No receipts / No relationship events loaded
Connections   — “Relationships begin with verified connections.” Facts: No verified accounts / No active relationships / No delegated authorities
Profile       — “Your identity controls stay yours.” Facts: Canonical identity not read / No disclosure policy / No session controls
```

Forbidden fabricated content everywhere: invented balances, prices/APYs, transaction hashes, activity counts, usernames/contacts, fake successful receipts.

---

## 3. Navigation contract

### 3.1 Public navbar (landing)

```text
flat Refracted Core + Prism     Home   Activity   Connections   Profile   [Entry preview]   [hamburger]
```

- `Home` = landing surface (top anchor). Authenticated Prism Home is a separate product destination behind `Enter Prism`.
- `Activity / Connections / Profile` on the public nav are deep links to `#workspace` that dispatch `prism:workspace-tab` (`activity | connections | profile`) and `scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" })`.
- Mobile menu: opens at `top:78px right:30px`, closes on `Escape` and restores focus to `menuButtonRef`. Active sidebar state is programmatic (`aria-selected`, `role=tab`).

### 3.2 Workspace rail (product)

```text
Rail brand: flat Refracted Core + Prism / “Private coordination”
Groups:
  Workspace — Overview (home, icon:home) · Activity (icon:activity)
  Network   — Connections (icon:connections)
  Account   — Profile (icon:profile)
Footer: railStatusDot + “Preview only / No account or operation implied”
Header: panelEyebrow + title + headerStatus (“Unconnected preview” / “Preview”)
View transition: key={activeTab} on role=tabpanel, labelled by workspace-tab-{id}
Keyboard: ArrowDown / ArrowUp / Home / End cycle tabs; tab moves focus via requestAnimationFrame to #workspace-tab-{next}
```

Motion ownership (from `prism-workspace-surface-contract.yaml` + operating ledger):

- Rail rests at `86px`, expands to `238px` on hover or keyboard focus (`PrismWorkspacePreview.module.css` + design ledger).
- Shell owns sidebar geometry so content and navigation remain one spatial system.
- Feedback deadline `100ms`, panel transition `opacity + translate` only, `hidden_base_state: forbidden` (base states remain visible for headless capture).

---

## 4. Session UI states — 15 states (frozen)

Source of truth: `src/features/wallet/session/selectors.ts` (`SESSION_UI_STATES`, `SessionUiState`) and `src/features/wallet/session/types.ts` (`SessionStatus`, 14 statuses) plus the `FRONTEND_WALLET_SESSION_DESIGN.md` state table (15 rows). The UI adds `discovering`/`capability-unknown` scaffolding around the `SessionStatus` core.

| # | SessionUiState | SessionStatus mapping | CTA label | Status line | Capabilities row | Receipt row | Header action |
|---|---|---|---|---|---|---|---|
| 1 | `disconnected` | `disconnected` | `Connect wallet` | `No wallet connected.` | Hidden | Hidden | None |
| 2 | `discovering` | (phase=`discovering`) | `Detecting…` (disabled) | `Looking for a Starknet wallet.` | Hidden | Hidden | None |
| 3 | `connecting` | `connecting` | `Connecting…` (disabled) | `Approve the connection in your wallet.` | Hidden | Hidden | None |
| 4 | `capability-unknown` | `capability-unknown` / `connected` with `privacyCapability unknown` / `refreshing` with address | `Connect wallet` | `Connected. Checking capabilities…` | Skeleton — 3 neutral pills | Hidden | `Disconnect` |
| 5 | `unsupported` | `connected`/`ready` with `privacyCapability unsupported` | `Not supported` (disabled) | `This wallet does not expose the capabilities this app needs.` | 3 badges `unsupported` tone | Hidden | `Disconnect` |
| 6 | `wrong-network` | `wrong-network` | `Switch to <chain>` | `Connected on <wrongChain>. This app runs on <rightChain>.` | Hidden | Hidden | `Disconnect` |
| 7 | `ready` | `ready` + `privacyCapability supported` | `Continue` | `Wallet ready. <capabilitySummary>.` | 3 badges mixed (only needed) | Hidden | `Disconnect` |
| 8 | `consent-required` | `consent-required` (consent `required`/`denied`) | `Review & sign` | `Sign the session consent to continue.` | 3 badges as in `ready` | Hidden | `Disconnect` |
| 9 | `proof-preparing` | operation `strk20State===proving && !proofReady` | `Preparing proof…` (disabled) | `Building the zero-knowledge proof in your wallet.` | 3 badges as in `ready` | Hidden | `Disconnect` |
| 10 | `awaiting-approval` | `awaiting-approval` / operation `submission: awaiting-approval|submitting` | `Awaiting approval…` (disabled) | `Approve the proof submission in your wallet.` | 3 badges as in `ready` | Hidden | `Disconnect` |
| 11 | `submitted` | `submitted` (`submission.transactionHash !== null`) or operation `submitted` with `receipt not-requested` | `View on explorer` (secondary) + `Continue` (primary) | `Proof submitted. Waiting for confirmation.` | 3 badges as in `ready` | Visible (hash + link) | `Disconnect` |
| 12 | `processing` | `processing` (hash non-null) or operation `submitted` with `receipt pending` | `Processing…` (disabled) | `Confirming on-chain.` | 3 badges as in `ready` | Visible (hash + link, `pending` tone) | `Disconnect` |
| 13 | `receipt-confirmed` | `receipt-confirmed` | `Continue` | `Confirmed in block <n>.` | 3 badges as in `ready` | Visible (hash + link, `confirmed` tone) | `Disconnect` |
| 14 | `reverted` | `reverted` | `Try again` | `Transaction reverted: <reasonIfKnown>.` | 3 badges as in `ready` | Visible (hash + link, `reverted` tone) | `Disconnect` |
| 15 | `unknown` | `unknown` / any illegal observation / `refreshing` without address | `Reconnect` | `Wallet state is unclear. Reconnect to refresh.` | Hidden | Hidden | `Disconnect` |

Rules that apply across all 15 states (from design packet § “Rules that apply across all states”):

- CTA is first in tab order; `Disconnect` is last. `Disconnect` is a text button in the panel header, right-aligned, two-step inline confirmation (`Confirm disconnect` within 3s, auto-cancels on any other state change).
- `awaiting-approval` and `proof-preparing` differ only in status text; CTA disabled in both; no auto-poll layout shift.
- `submitted` shows two buttons side by side; on narrow viewports primary stacks under secondary.
- `capability-unknown` skeleton uses three neutral pills of identical width, never animated shimmer (see reduced-motion).
- `unsupported` and `wrong-network` are terminal-for-this-flow but not terminal-for-the-app: `Disconnect` always available; re-trigger `discovering` by reopening the panel.
- `unknown` is the only state reachable from any other state (adapter gave unclassifiable state); recovery is always `Reconnect`.
- The `CTA` is full-width within the card. No auto-connect: `discovering` only starts on user gesture (CTA click).

### 4.1 Adapter → UI mapping

| Adapter event | UI effect |
|---|---|
| `adapter.on('connect', address)` | `connecting` while handshake in flight → `capability-unknown` for probe window → `ready` (or `consent-required` if consent step exists) |
| `adapter.on('disconnect')` | `disconnected`, drop any in-flight proof state, clear receipt row |
| `adapter.on('accountsChanged')` | if new address differs → `capability-unknown`; if same → no change |
| `adapter.on('networkChanged')` | compare new `chainId` to configured chains → `wrong-network` or `ready`; never `disconnected` on network change alone |
| `adapter.getCapabilities()` | populates three badge slots; missing entries are `unknown`, not `unsupported`; static fallback in `wallet-capability.ts` only when whole object is `null` |
| `proofStateMachine` (`preparing`, `awaiting-approval`, `submitted`, `processing`, `confirmed`, `reverted`) | drives `proof-preparing` … `reverted` rows directly; UI only formats what the state machine hands it |
| `adapter.errors` | recoverable banner → `unknown` unless `user-rejected` → return to `ready` (or pre-proof state if mid-proof) |

### 4.2 File boundaries

```text
src/features/wallet/session/
  adapter.ts               — interface { connect, disconnect, getSession, getCapabilities, on, off } — no UI
  reducer.ts               — pure (state, adapterEvent) => state, closed SessionState union exhaustive check
  SessionProvider.tsx      — wires adapter to reducer, exposes useSession() / useSessionState()
  selectors.ts             — derives three needed capabilities from wallet-capability.ts + active flow; also SESSION_UI_STATES[15], selectSessionState, selectCapabilities, selectReceipt, formatObservedAddress/Hash
  strings.ts               — single copy source (SESSION_STRINGS, SESSION_STATE_LABELS, SESSION_STATE_GLYPHS, statusLine, ctaLabel, capabilityGlyph)
  types.ts                 — SessionStatus[14], CapabilityState, NetworkState, ConsentState, SubmissionState, ReceiptState, WalletSessionContract union
  errors.ts                — WALLET_SESSION_ERROR_CODE[15]
  no-secrets.ts            — SECRET_FIELD_PATTERN fail-closed
src/features/wallet/WalletConnectionPanel.tsx (+ .module.css) — single presentational surface; receives sessionState + three capability slots via context; renders card, status, capability row, CTA, receipt row, Disconnect; never calls adapter, never imports wallet SDK directly (grep gate)
src/features/landing/PrismWorkspacePreview.tsx — embeds WalletConnectionPanel in preview tile gated behind ?demo=session so default landing render is unchanged
src/features/prism-strk20/domain/wallet-capability.ts — unchanged shape; unsupported fallback table lists structurally impossible capabilities, not wallet brands
```

Panel is `role="region"` with `aria-labelledby` at the section label; CTA is `<button>`; capability row is `role="list"` with badges `role="listitem"`; status line and receipt row are `aria-live="polite"`; full address disclosure is collapsed by default and closed on any transition out of `ready/consent-required/submitted/processing/receipt-confirmed/reverted`.

---

## 5. STRK20 domain states — 13 states (frozen)

Source of truth: `src/features/prism-strk20/domain/strk20-state.ts` (`STRK20_STATES`, `Strk20State`, `MATURITY_BLOCKS=10`, `ALLOWED` map, `canTransition`, `transition`).

| # | Strk20State | Terminal? | Meaning | Entry guard |
|---|---|---|---|---|
| 1 | `capability_unknown` | no | No valid `supportedWalletApi/supportedSpecs` observation yet | empty/malformed version arrays → `unknown` |
| 2 | `mismatch` | failed | Chain/environment mismatches expected (`SN_MAIN` vs `SN_SEPOLIA`, felt encoding) | `evaluateNetworkGuard` mismatch |
| 3 | `registration_required` | no | Pool account requires wallet-managed first-use registration | provider signals `not_registered` |
| 4 | `approval_pending` | no | ERC-20 approval needed before shield | missing/expired approval for exact token/amount/spender |
| 5 | `shielding` | no (idempotent) | Shield/deposit submission in flight; requires `shieldTxHash` | `shield_tx_required_for_shielding`; fee quoted vs observed mismatch → `FEE_CHANGED` |
| 6 | `confirmed` | no | Shield receipt `SUCCEEDED` + `ACCEPTED_ON_L2/L1` + block + `poolEventFound` | `requireFinalReceipt` binding hash + `SUCCEEDED` + finality + `poolEventFound===true` |
| 7 | `maturing` | no (idempotent) | Shield note maturing (~10 blocks) | `confirmedBlock` + `maturityTargetBlock = confirmedBlock + 10` must exist |
| 8 | `privately_available` | no | Note spendable; consent required before private read | `currentBlock >= maturityTargetBlock` AND wallet/session observation `privately_available` AND `balanceConsent===granted`; `denied` → `CONSENT_DENIED` |
| 9 | `proving` | no (idempotent) | Wallet building ZK proof | non-empty proof required for `ready/submitting/confirmed` track |
| 10 | `transfer_pending` | no (idempotent) | Private transfer/application action submitted; requires `transferTxHash` | `transfer_tx_required_for_transfer_pending`; fee guard applies |
| 11 | `transfer_confirmed` | **terminal** | Private action receipt final (SUCCEEDED + pool/helper event, conservations, no stranded balance) | `requireFinalReceipt` for transfer + project-contract involvement if contracts declared |
| 12 | `rejected` | **terminal** | Explicit rejection (screening, user refusal, invalid amount) | `rejectionReason` or `errorCode` required |
| 13 | `dependency_failure` | failed (recoverable) | Provider/RPC/fee/proof dependency failed; can return to `capability_unknown/approval_pending/shielding/maturing/proving/transfer_pending` | any provider `DEPENDENCY_FAILURE` |

Allowed transitions (`ALLOWED` map, abbreviated):

```text
capability_unknown → {mismatch, registration_required, approval_pending, dependency_failure}
mismatch → {capability_unknown, dependency_failure}
registration_required → {approval_pending, rejected, dependency_failure, mismatch}
approval_pending → {shielding, rejected, dependency_failure, mismatch}
shielding → {confirmed, rejected, dependency_failure, mismatch}
confirmed → {maturing, rejected, dependency_failure}
maturing → {privately_available, rejected, dependency_failure, mismatch}
privately_available → {proving, transfer_pending, shielding, approval_pending, rejected, dependency_failure, mismatch}
proving → {transfer_pending, rejected, dependency_failure, mismatch}
transfer_pending → {transfer_confirmed, rejected, dependency_failure, mismatch}
transfer_confirmed → {} (terminal)
rejected → {} (terminal)
dependency_failure → {capability_unknown, approval_pending, shielding, maturing, proving, transfer_pending}
```

`canTransition` permits same-state only for `shielding, maturing, proving, transfer_pending, dependency_failure, mismatch` (idempotent).

### 5.1 Proof boundary

Shape from `strk20-proof.ts` (`Strk20CallAndProof` matches `WalletAccountV6 / wallet_addInvokeTransaction`):

```ts
interface Strk20Call  { contract_address: Hex; entry_point: string; calldata: readonly string[] }
interface Strk20Proof { data: string; output: readonly string[]; proof_facts: readonly string[] }
interface Strk20CallAndProof { call: Strk20Call; proof: Strk20Proof }
```

- `isEmptyProof` = `data==="" && output.length===0 && proof_facts.length===0` — returned by `simulate=true` prepare; **never submittable**.
- `isValidProof` = `hasProofShape && !isEmptyProof` — required for `ready/submitting/confirmed`.
- `assertNotEmptyProofForSubmission` enforces two-hash-shield → proving → transfer; a simulated proof submitted is `PROOF_REQUIRED` (`STRK20-018`).
- `assertNoViewingKey` forbids viewing/private key material before any proof assertion.

### 5.2 Receipt boundary

From `strk20-action-port.ts` (`normalizeReceipt`, `STRK20_POOL_ADDRESS = 0x0403...812a`):

```text
Every material hash (approval, shield, transfer) records:
  transaction_hash: 0x… (canonical 64-hex, lower, padded)
  execution_status: SUCCEEDED required (RECEIVED/PENDING/UNKNOWN are not accepted)
  finality_status:  ACCEPTED_ON_L2 or ACCEPTED_ON_L1 required (RECEIVED/PENDING/UNKNOWN not accepted)
  block_number:     required, non-negative, safe integer
  pool_event_present: true required for STRK20 pool action (event address == 0x0403…812a)
  sender_ignored_for_identity: true (relayer; attribute via pool/application event only)
  events:           normalized address/keys/data, bound to requested hash (hash mismatch → DEPENDENCY_FAILURE)
```

Project-contract involvement (when `project_contracts` declared): event from a declared project contract or declared address in raw calldata must be proved — a pool event alone is insufficient after contracts are declared.

---

## 6. Capability detection — `>=0.10.3` (least privilege)

Pure function in `src/features/prism-strk20/domain/wallet-capability.ts`:

```text
get-starknet 6.0.3
→ starknet.js 10.4.0 / WalletAccountV6
→ Wallet API / spec >= 0.10.3
→ privacy-enabled wallet
→ STRK20 pool (SN_MAIN 0x0403…812a)
```

Rules:

- Query `supportedWalletApi()` / `supportedSpecs()` only. Never call a balance method as a feature probe.
- `classifyStrk20Capability(apiVersions, specs)`: empty array → `unknown`; any malformed version → `unknown`; else if any parsed version `>=0.10.3` (prerelease candidates are below their stable release) → `supported`, else `unsupported`.
- `classifyWalletEnvironment(chainId, {mainnet:"SN_MAIN", sepolia:"SN_SEPOLIA"})` normalizes symbolic IDs and their canonical felt encodings; unknown/look-alike/mismatched values are `UNKNOWN` and block readiness before any approval/consent/action.
- `supportsStrk20`, `evaluateCapability`, `ensureCapabilityOrThrow`, `evaluateNetworkGuard`, `ensureNetworkOrThrow` are pure — no I/O, no balance reads, no viewing keys. A network mismatch blocks readiness; do not switch networks implicitly and never fall back between `SN_MAIN` and `SN_SEPOLIA`.

CapabilitySlot rendering (selectors.ts `selectCapabilities`): only three slots are ever shown, scoped to the active flow — `supportedWalletApi`, `supportedSpecs`, `strk20` — and only when `session.accountAddress !== null && privacyCapability.status !== "unknown"`. Unknown entries render as `unknown` (neutral), not `unsupported`. Supported glyph `OK`, unsupported `!`, unknown `?`.

---

## 7. Two-hash shield — approval + deposit (public metadata labeled)

The shield sequence has two visible wallet operations; the approval is not the pool receipt.

```text
1. ERC-20 approval for the exact authorized token, amount, spender, and spend ceiling
2. STRK20 pool deposit / shield, with screening outcome and current fee recorded
```

Acceptance per `PRIVACY_RUNTIME_CLOSEOUT_RUNBOOK.md` G4:

- Approval parameters match the authorization and exact spender; approval receipt is accepted before shield is requested.
- Screening is explicitly `approved` (see §12 for rejected/unavailable).
- Shield receipt has matching hash, `SUCCEEDED`, accepted finality, non-null block, and canonical pool event `0x0403…812a`.
- Amount plus fee remains within `maximum_spend`; fee is read fresh — do not hard-code a historical fee.
- No combined deposit+private action is used unless the authorization explicitly accepts the resulting depositor/amount/timing correlation.

Pool and authorization:

```yaml
strk20_pool_address: 0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
expected_network: SN_SEPOLIA | SN_MAIN  # per authorization packet; exact symbolic or canonical felt only
maximum_transaction_count: includes approval, shield, private action, retries, recovery reads that can write
maximum_spend: { asset, amount, unit, includes_fees: true }
route: private_transfer | application   # exact, not generic “STRK20 action”
exact_contract_scope: { project_contracts: [], allowed_entrypoints: [], excluded_contracts: [] }
```

Maturity after shield:

```yaml
maturity:
  shield_transaction_hash: 0x…
  confirmed_block: 12345
  maturity_target_block: 12355  # confirmedBlock + 10 supplied by protocol/session adapter, never hard-coded delay
  current_block: 12354
  state: maturing
  ready: false
  observation_source: adapter/session  # explicit observation, not block arithmetic
```

Do not assume a new note is immediately spendable. `~10` blocks is typical but the packet must use the adapter observation (`privately_available` requires `current_block >= maturityTargetBlock` and the observation that the note is spendable). If `maturing`, stop the private-action lane and retain the operation as pending.

Independent readback (G10):

```yaml
independent_verification:
  primary_source_id: rpc-a
  independent_source_id: rpc-b   # must be distinct public sources; second call through same source is not independent
  source_ids_distinct: true
  transaction_hash_match: true
  execution_status_match: true
  finality_match: true
  block_match: true
  pool_event_match: true
  helper_involvement_match: true
  public_balance_match: true
```

---

## 8. Consent gate — explicit private-balance consent

Private-balance access is a deliberate feature, never a capability probe (G8). Before calling any balance surface:

1. Show the user a consent prompt explaining that private balance data will be requested.
2. Bind consent to the action/session, token set, and timestamp.
3. Require wallet response `consent: granted`.
4. Record that a balance read occurred and what was displayed, without storing a viewing key, note, raw proof, or unnecessary balance payload.
5. If consent is denied or not returned, stop with `CONSENT_DENIED` / `CONSENT_REQUIRED`.

Packet shape:

```yaml
private_balance_consent:
  requested: true
  prompt_presented: true
  user_decision: granted   # or denied
  token_scope: [STRK, USDC]
  consent_reference: audit-ref-…  # non-secret ID
  balance_readback_observed: true
  displayed_value_handling: OMITTED_OR_ACCESS_CONTROLLED
  raw_private_state_in_packet: false
```

In the UI this surfaces as `consent-required` (`Review & sign` CTA, status `Sign the session consent to continue.`) and is an explicit step in the `STRK20` flow: `privately_available → proving` requires `balanceConsent === granted`; `maturing → privately_available` already requires it, and the application service records consent rather than retaining private balance values. Any correctness assertion must point to an access-controlled wallet/session observation or redacted evidence artifact.

Strings: `SESSION_STRINGS.consentDenied = "Connection consent was not granted."`; status lines `Sign the session consent to continue.` / `Building the zero-knowledge proof…` / `Approve the proof submission in your wallet.` remain verb-phrase present tense.

---

## 9. Design tokens

### 9.1 Color — paper / ink / accent (frozen)

Derived from `src/app/globals.css` + `src/features/landing/PrismLanding.module.css` + wallet-section legacy globals and the original 71KB brief's frozen triple.

| Token | Value | Role | Usage |
|---|---|---|---|
| `paper` | `#f3f3f3` | warm off-white outer canvas | `body` background `#f3f3f3`, page shell, reduced-motion neutral |
| `paper-soft` | `#fbf8f2` | pale warm surface | wallet-card gradient stop, hero ambient |
| `surface` | `#ffffff` | elevated surface | heroShell inner `#ffffff` → `#f8f9fb` → `#f1f2f5`, mesh canvas `#ffffff` |
| `ink` | `#101010` | primary graphite | page `color: #101010` via `.page --ink`, body `#191919` maps to ink/near-ink |
| `ink-soft` | `#252421` | secondary ink | wallet-state `#252421` |
| `graphite` | `#1f1e24` | deep graphite | ledger rail, hero edge, base states |
| `muted` | `#5d5c61` | secondary text | nav links, hero support base |
| `quiet` | `#818187` | tertiary text | captions, subtle meta |
| `line` | `#dfe0e5` | hairline border | heroShell `1px solid #dfe0e5`, wallet-card `rgba(33,31,28,0.14)` |
| `line-strong` | `#c9cbd1` | strong border | hero hover, menu border hover |
| `accent` | `#526f95` | single semantic accent | focus rings `2px solid #526f95`, outline-offset 3–4px; also `rgba(85,121,164)` for connecting dot, warn variant elsewhere |
| `positive` | `#4f8d69` | positive / supported | `wallet-card--privacy-capable .state-dot #4f8d69` + `rgba(79,141,105,0.1)` halo; receipt `confirmed` tone |
| `warn` | `#b5853f` | warn / unsupported | `wallet-card--privacy-unsupported … .state-dot #b5853f` + `rgba(181,133,63,0.1)`; also wallet-message--error `#9f6d28` |
| `neutral` | `#8d8880` | unknown / idle | `.state-dot #8d8880` baseline; `unknown` badge neutral |
| `strobes` | `#0000ff` | product accent (Base) | `.baseMark #0000ff` (legend token; do not use as general UI accent) |

Hero shell uses `linear-gradient(124deg, rgba(255,255,255,0.98) 0%, transparent 28%)` over `linear-gradient(178deg, #ffffff 0%, #f8f9fb 62%, #f1f2f5 100%)` with `inset 0 1px 0 #ffffff` — opaque pale surface, not glassmorphism. Shadow is `0 28px 76px rgba(22,22,25,0.11), 0 5px 15px rgba(22,22,25,0.05)`. Entering compresses to `border-radius 46px` (from `34px`) and `scale(0.993)`.

Single-signal discipline: use one semantic color at a time — `neutral` = available/idle, `blue`/`accent` = identity/binding route, `green`/`positive` = resolved/live, `red`/`warn` = blocked/rejected/error (from `PRISM_LANDING_VISUAL_SPEC.md`). Never a rainbow signal or laser treatment.

### 9.2 Typography

| Token | Value |
|---|---|
| `--font-sans` | `"Helvetica Neue", "Neue Haas Grotesk Text", Inter, ui-sans-serif, system-ui, -apple-system, ...` |
| `--font-mono` | `"SFMono-Regular", Consolas, "Liberation Mono", monospace` |
| Hero h1 | `clamp(54px, 4.7vw, 68px)`, `weight 400`, `letter-spacing -0.058em`, `line-height 0.98`, `max-width 760px` |
| Hero support | `clamp(17px, 1.42vw, 21px)`, `weight 400`, `-0.02em`, `line-height 1.5`, `color #5d5c61`, `max-width 650px` |
| Eyebrow | `10px`, `weight 700`, `letter-spacing 0.13em`, `uppercase`, `color #73747a` (`--font-mono`) |
| Body / status | `13–15px`, `line-height 1.55–1.68`, `color #5f5b55 / #716d67` |
| Mono truncations | `0xAAAA…BBBB` (6 + ellipsis + 4) via `formatObservedAddress/Hash` |
| Labels | `12px uppercase tracking` for section labels, `14px medium` for primary text, `12px regular` for status (wallet panel) |

### 9.3 Spacing, radii, and geometry

| Token | Value |
|---|---|
| Page padding | `32px 0`; heroShell `width min(1480px, calc(100% - 64px))`, `min-height calc(100svh - 64px)` |
| Radii | heroShell `34px` (entering `46px`), wallet-card `22px` (mobile `17px`), meshCanvas `22px`, wallet-option `13px`, pill/cta `999px` |
| Padding | hero nav `0 54px` (min-height `108px`), heroContent `30px clamp(44px,6vw,94px) 68px`, wallet-card `28px` (mobile `20px`) |
| Gaps | navLinks `40px`, heroContent `clamp(20px,2.5vw,42px)`, wallet-section `48px`, dashboard columns per PrismWorkspacePreview.module.css (`86px rail → 238px`) |
| Grid | heroContent `minmax(520px,0.95fr) minmax(560px,1.05fr)`; wallet-section `minmax(0,0.82fr) minmax(0,1.18fr)`; mobile `@860px → 1fr` |
| Elevation | mesh `inset 0 1px 0 #fff, 0 12px 28px rgba(20,20,22,0.04)`; wallet-card `0 24px 50px rgba(53,45,36,0.07), inset 0 1px rgba(255,255,255,0.78)` |
| Refracted Core | flat `45×45px` in lockup (3 flat tones: `#8c8d92`, `#d6d7dc`, `#575859`); living responsive, satin gradients ivory/neutral/graphite/pearl, soft shadow `feDropShadow dx0 dy4 #101010 @0.2 stdDeviation 3` |

### 9.4 Provider and invariants

- `--motion-ease: cubic-bezier(0.22, 1, 0.36, 1)` and `--motion-duration: 820ms` on `.page` / hero copy / mesh — the single motion vocabulary.
- Do not ship a screenshot as a raster logo. Flat and living forms share the 8-facet geometry (`facets[8]` paths in `RefractedCore.tsx`) with unequal lengths and controlled angular variation; no generic asterisk/starburst normalization, no 3D chrome/glass/holography/neon.
- Flat Refracted Core states remain static; morphs translate/rotate/slightly reshape (`PRISM → HOME → ID → CONTINUITY → PRISM` idle cycle) without pieces appearing/disappearing, exploding, or becoming an unrelated logo.

---

## 10. Motion language

### 10.1 Primitives (from `PRISM_LANDING_VISUAL_SPEC.md`)

```text
RefractedCoreMorph
PrismTrack
PrismSignal
PrismTrace
PrismEndpoint
PrismSurfaceMotion
```

Priority: `direct user action > scroll narrative > hover/focus > idle`. Idle motion yields immediately; the object remains still longer than it moves.

### 10.2 Satin Resolve (implemented)

From `PrismLanding.tsx` + `PrismLanding.module.css` (naming preserved):

- `heroNarrative[4]` with `holdMs: [3000, 3200, 3900, 0]` and states `promise → identity-anchor → native-context → resolved-identity`
- Title lines animate via `SatinWords → satinWordMask → satinWord` with `satinWordLift` (outgoing) / `satinWordResolve` (incoming) over `--motion-duration` `820ms` `var(--motion-ease)`, staggered per word (`0ms / 42ms / 84ms / 126ms`) plus line stagger (`0ms` then `48ms` for second line), 24ms incoming offset.
- Support block animates `satinBlockLift 680ms 110ms` → `satinBlockResolve 720ms 150ms`.
- IdentityContextMesh draws `meshRoute` (`stroke-dasharray:1`, `stroke-dashoffset:1`, `pathLength=1`) via `satinMeshRouteDraw` + `satinMeshNodeSettle 90ms` on `native-context`/`resolved-identity` when `data-transitioning=true && !reducedMotion`; primaryUnit/contextModule rise via `satinMeshModuleRise 760ms` (context additionally `120ms`), rail labels `satinMeshRailRise 620ms 180ms`.
- Hero entering overlay (`::after`) translates `translateX(-44%) → translateX(42%)` over `760ms var(--motion-ease)`, opacity `0.58 → 0.9`; heroCopy/mesh fade to `opacity 0.45`, `translateY(-8px) scale(0.994)`.

### 10.3 Workspace motion

- Rail hover/focus expansion uses the fluid `420ms` curve; view changes use `620ms` soft settle (design ledger). Hover lift limited to actions and cards; no ambient loops or fake live-data motion.
- Workspace `viewTransition` uses the single vocabulary: `opacity + translate` only; no scale/blur.
- Panel transitions (wallet connection panel + capability slots) follow the same curve/duration as the preview: hover/focus transitions `~160ms` (from wallet-session design) and `180ms ease` for wallet `option` hover (`transform translateY(-1px)`, `border-color`, `background`). Disabled states are `cursor: wait` with `opacity 0.65`.

### 10.4 Reduced motion

`@media (prefers-reduced-motion: reduce)` — authoritative handling in three layers already implemented:

1. `globals.css`: `html scroll-behavior: auto`; `*, *::before, *::after { animation-duration:0.01ms !important; animation-iteration-count:1 !important; transition-duration:0.01ms !important }` (sets all transitions/animations to effectively instant).
2. `PrismLanding.tsx`: `if (motionQuery.matches) { setIntroRunning(false); activeStateIndex = finalHeroStateIndex; transitionCycle=0 }`; `previewEntryTransition` early-returns on reducedMotion; `scrollIntoView({behavior:"auto"})`.
3. `FRONTEND_WALLET_SESSION_DESIGN.md` reduced-motion behavior (mimicked here): capability-row skeleton renders as three static neutral pills — no shimmer/opacity pulse; CTA hover/focus transforms removed, pressed state is `1px inset border`; disclosure (full address) snaps without height animation; receipt row appearance instant; two-step Disconnect timeout still uses its 3s timer but inline reveal is instant; loading states keep text labels — no spinner.

Acceptance: with `prefers-reduced-motion: reduce`, `document.getAnimations().length === 0` and `getComputedStyle(panel)` reports `transition-duration: 0s` and `animation-name: none` on panel and descendants.

---

## 11. Copy deck — exact labels (no invention)

### 11.1 Hero (landing — preserves Satin Resolve)

| Sequence | Title (2 lines) | Support |
|---|---|---|
| `promise` (3000ms) | `Your Home` / `Across Chains.` | `One Prism ID for your identity, assets, relationships, and activity across networks.` |
| `identity-anchor` (3200ms) | `Anchored on` / `Starknet.` | `Starknet is your canonical identity root and native execution network.` |
| `native-context` (3900ms) | `Native where` / `you act.` | `Your accounts stay native. Your identity stays coherent.` |
| `resolved-identity` (hold 0) | `Your Home,` / `Wherever You Act.` | `One Prism ID. One persistent identity across the accounts you use.` |

CTA: `Enter Prism ›` (chevron `›` is `aria-hidden`). Disabled label `Previewing transition`. Status live region (`role=status`, `aria-live=polite`):

- idle: `Preview only — product entry is not connected yet.`
- entering: `Transition preview only. No sign-in or navigation has occurred.`
- complete: `Transition preview complete. No sign-in or navigation occurred.` (reduced motion: `Entry preview acknowledged. Motion is off; no sign-in or navigation occurred.`)
- Eyebrow in heroMessage: `Prism`.

### 11.2 IdentityContextMesh descriptions (aria-label on section `role=img`)

| State | aria-label |
|---|---|
| `promise` | `Prism ID begins as the persistent identity root; canonical execution context resolves next.` |
| `identity-anchor` | `Prism ID and Starknet form one bidirectional unit, with Starknet emphasized as the canonical identity root and native execution network.` |
| `native-context` | `The Prism ID and Starknet unit routes downward to Base and Starknet native execution contexts.` |
| `resolved-identity` | `The model projects one persistent Prism identity across Base and Starknet native execution contexts, with Starknet as its canonical root.` |

Mesh chrome labels: `Identity / execution structure` — `Identity model` (heading); `Primary identity + execution unit`; `Native execution`; `State projection`; chiron `⇄` between Prism ID and Starknet.

### 11.3 Workspace chrome

| Element | Copy |
|---|---|
| Workspace header (home) | eyebrow `Private coordination`, title `Overview`, badge `Unconnected preview` (long) / `Preview` (short) |
| Rail groups | `Workspace: Overview · Activity` · `Network: Connections` · `Account: Profile` |
| Connection banner | `Current state` / `Nothing is connected yet.` / `Connect a verified account or relationship to load requests, permissions, private state, and evidence.` |
| Quick actions header | `Start here` / `What do you want to do?` / note `Nothing executes from this preview` |
| Action buttons | `Send — Move funds to someone` · `Receive — Request or share a destination` · `Approval — Ask before an action` · `Connect — Add an account or relationship` |
| Action notices | `send: Send starts a payment or private transfer after a destination is verified. No transaction was sent.` · `receive: Receive creates a destination or payment request after connection. Nothing was shared.` · `approval: Approval creates a governed request. A request cannot move funds.` |
| Attention card | `Attention — What needs you — 0 observed` / `Connect to load your decisions.` / `Payment requests, approvals, channel invitations, private-state consent, and unresolved receipts appear here only after observation.` |
| Relationships card | `Relationships — Private coordination starts here.` / `Messages, payment requests, approvals, claim invitations, and receipts live inside a verified relationship, not a generic chat inbox.` / `No active relationships loaded. — Connect with someone or resolve a verified destination to begin.` |
| Context card | `Context — What Prism can see — Preview` / rows: `Canonical root Starknet · Not read` · `Wallet session Not connected · Unavailable` · `Private state Consent required · Wallet-owned` · `Receipt evidence None loaded · Not observed` |
| Recent activity card | `Recent activity — Evidence only` / `No reconciled operations or receipts have been observed.` / `Submitted is not complete.` |
| Placeholders | Activity `Only evidence belongs here. — Requests, actions, operations, receipts, and state transitions appear only after durable observation and reconciliation. A submitted operation is never shown as complete.` · Connections `Relationships begin with verified connections. — Accounts, people, private relationship channels, applications, devices, and authorities appear here after verification. Messaging begins inside an active relationship.` · Profile `Your identity controls stay yours. — Canonical identity, linked accounts, disclosure choices, privacy permissions, communication devices, and session controls appear only after their source state is read.` |

### 11.4 Wallet session panel (15-state labels — from `strings.ts`)

`SESSION_STRINGS` and `SESSION_STATE_LABELS/GLYPHS` are the source of truth; no string is composed inline.

```text
SESSION_STRINGS:
  eyebrow: Wallet session
  title: Verify a Starknet wallet session.
  sessionState: Session state
  wallet/connect: Wallet / Account / Network / Receipt
  buttons: Connect / Connect wallet / Detecting… / Connecting… / Not supported / Continue / Review & sign / Preparing proof… / Awaiting approval… / Processing… / View on explorer / Try again / Reconnect / Disconnect / Confirm disconnect / Copy address / View full address / Hide full address / Copied
  warnings: No Starknet wallet was found. / Wallet connection is unavailable until the Starknet RPC is configured. / The wallet state could not be read. Reconnect to refresh. / The wallet did not switch networks. / Connection consent was not granted.

SESSION_STATE_LABELS (15):
  disconnected: Disconnected    (?) · discovering: Discovering (?) · connecting: Connecting (?) · capability-unknown: Capability unknown (?) · unsupported: Unsupported (!) · wrong-network: Wrong network (!) · ready: Ready (OK) · consent-required: Consent required (!) · proof-preparing: Proof preparing (?) · awaiting-approval: Awaiting approval (?) · submitted: Submitted (?) · processing: Processing (?) · receipt-confirmed: Receipt confirmed (✓) · reverted: Reverted (!) · unknown: Unknown (?)

Glyphs (SESSION_STATE_GLYPHS): ? / ! / OK / ✓  (color independence — state is always conveyed by text/glyph, not color alone; forced-colors: active still distinguishable)
```

Status lines (`statusLine()` — present-tense verb phrases, never spinner-only):

```text
disconnected:      No wallet connected.
discovering:       Looking for a Starknet wallet.
connecting:        Approve the connection in your wallet.
capability-unknown:Connected. Checking capabilities…
unsupported:       This wallet does not expose the capabilities this app needs.
wrong-network:     Connected on <wrongChain>. This app runs on <rightChain>.
ready:             Wallet ready. <capabilitySummary>.
consent-required:  Sign the session consent to continue.
proof-preparing:   Building the zero-knowledge proof in your wallet.
awaiting-approval: Approve the proof submission in your wallet.
submitted:         Proof submitted. Waiting for confirmation.
processing:        Confirming on-chain.
receipt-confirmed: Confirmed in block <n>.  (or Receipt confirmed. when blockNumber null)
reverted:          Transaction reverted: <reasonIfKnown>.
unknown:           Wallet state is unclear. Reconnect to refresh.
```

CTA labels (`ctaLabel()`):

```text
discovering→Detecting… · connecting→Connecting… · unsupported→Not supported · wrong-network→Switch to <chain> · ready|submitted|receipt-confirmed→Continue · consent-required→Review & sign · proof-preparing→Preparing proof… · awaiting-approval→Awaiting approval… · processing→Processing… · reverted→Try again · unknown→Reconnect · otherwise→Connect wallet
```

Capability glyphs (`capabilityGlyph`): `supported→OK`, `unsupported→!`, `unknown→?`.

Address/hash formatting: `formatObservedAddress` / `formatObservedHash` → `0x…` lowercased, sliced `0..6 + … + -4` when `length>12` (e.g., `0x04ab…812a`). Full value is never the default render; “view full” disclosure expands inline, grows vertically never horizontally, caps at 320px on <480px, copy writes full form to clipboard with “Copied” tooltip 1.2s. Receipt hash truncated same way; full hash is `href` + clipboard payload; explorer link opens new tab with `rel="noopener noreferrer"`.

### 11.5 Error catalogue (visible to UI)

| Code | Label | Example copy | Retryable |
|---|---|---|---|
| `STRK20-001` | capability_unknown | `Wallet capability is unknown. Re-detect.` | `re_read` |
| `STRK20-002` | network_mismatch | `Expected SN_MAIN got SN_SEPOLIA — switch network.` | `no` |
| `STRK20-003` | registration_required | `Wallet registration required before shielding.` | `no` |
| `STRK20-004` | consent_required | `Private balance consent is required.` | `no` |
| `STRK20-005` | consent_denied | `Connection consent was not granted.` | `no` |
| `STRK20-006` | screening_rejected | `Deposit was screened as rejected; do not retry the same deposit.` | `no` |
| `STRK20-007` | screening_unavailable | `Screening is unavailable; wait and retry.` | `true_backoff` |
| `STRK20-008` | fee_changed | `Fee changed — re-quote before shield.` | `re_quote` |
| `STRK20-009` | fee_unavailable | `Pool fee is unavailable; wait and retry.` | `true_backoff` |
| `STRK20-010` | maturity_pending | `Note is maturing; wait ~10 blocks.` | `poll_only` |
| `STRK20-011` | stale_state | `State is stale; refresh.` | `re_read` |
| `STRK20-012` | illegal_transition | `That transition is not allowed.` | `no` |
| `STRK20-013` | dependency_failure | `Provider dependency failed; back off.` | `true_backoff` |
| `STRK20-018` | proof_required | `Prepare without simulate before submitting.` | `no` |
| Wallet `CAPABILITY_UNKNOWN` | `CAPABILITY_UNKNOWN` | `The wallet did not return capability versions.` | — |
| Wallet `NETWORK_MISMATCH` | `NETWORK_MISMATCH` | `The wallet did not switch networks.` | — |
| Wallet `SECRET_FORBIDDEN` | `SECRET_FORBIDDEN` | `That field cannot cross the session boundary.` | — |

Prohibited-claim grep gates (from `FRONTEND_WALLET_SESSION_DESIGN.md`) remain in CI: reject `Anonymous, Private, Shielded, Hidden, STRK20-ready, privacy-enabled, Connected securely, trusted, verified wallet, Balance, Done` (case-insensitive whole-word, allowlist only for fixture assertions), and reject direct wallet-SDK imports in `WalletConnectionPanel.tsx`.

---

## 12. Failure modes and blocked states — 16+ (fail-closed)

Every failure below blocks progression; none is rendered as degraded success. The Strk20 domain error catalogue and wallet session error catalogue are the only admissible codes.

### 12.1 UI-blocked session states (out of 15, 8 are explicitly blocked-terminal or non-progressing)

| # | Blocked UI state | Evidence | Allowed recovery | Code path |
|---|---|---|---|---|
| 1 | `disconnected` | `accountAddress===null` | `Connect wallet` gesture → `discovering` | `SessionStatus disconnected` |
| 2 | `capability-unknown` | `privacyCapability unknown` or `apiVersions/specs` empty/malformed | re-probe capabilities; do not render readiness | `CAPABILITY_UNKNOWN` |
| 3 | `unsupported` | any valid version `<0.10.3` and none `>=0.10.3` | `Disconnect`; no private action | `UNSUPPORTED_WALLET` (`STRK20-021`) |
| 4 | `wrong-network` | `environment !== expected` or `UNKNOWN` | `Switch to <chain>`; do not implicitly switch | `NETWORK_MISMATCH` (`STRK20-002`) |
| 5 | `unknown` | unclassifiable adapter state or `refreshing` without address | `Reconnect` | `STALE_STATE` / `CAPABILITY_UNKNOWN` |
| 6 | `consent-required` | `consent required` or `denied` in session or `strk20State` | `Review & sign` grants; `denied` stops | `CONSENT_REQUIRED/DENIED` (`STRK20-004/005`) |
| 7 | `proof-preparing` | `strk20State proving && !proofReady` or wallet `preparing` | wait for wallet; CTA disabled | — |
| 8 | `awaiting-approval` | `submission awaiting-approval/submitting` | wallet approval; CTA disabled | — |
| 9 | `reverted` | `receipt status reverted` | `Try again` only via fresh flow | execution `REVERTED` is terminal failure, never relabeled |
| 10 | receipt `unknown` | provider returned `UNKNOWN` finality/execution | `unknown` → `Reconnect` / re-read | `DEPENDENCY_FAILURE` |

### 12.2 Domain-blocked Strk20 transitions (G-lane gates from the runbook)

| # | Blocked condition | Runbook gate | Error code |
|---|---|---|---|
| 11 | Unknown chain ID / look-alike felt / `UNKNOWN` environment | G2 Network check | `NETWORK_MISMATCH` |
| 12 | Missing fee or fee changed between quote and shield (`quotedFee !== observedFee`) | G3/G4 preflight | `FEE_CHANGED` (`STRK20-008`) / `FEE_UNAVAILABLE` (`STRK20-009`) |
| 13 | Screening `rejected` or `unavailable` | G4 shield acceptance | `SCREENING_REJECTED` (`STRK20-006`) / `SCREENING_UNAVAILABLE` (`STRK20-007`) |
| 14 | Approval not accepted before shield; approval/shield hash mismatch or approval not matching spender/scope | G4 | `STALE_STATE` |
| 15 | Receipt not `SUCCEEDED` or finality not `ACCEPTED_ON_L2/L1` or block `null` or `poolEventFound!==true` or hash mismatch | G5/G6 | `DEPENDENCY_FAILURE` (`STRK20-013`) |
| 16 | Maturity not observed (`currentBlock < maturityTargetBlock` or missing `confirmedBlock/maturityTargetBlock`) | G7 | `MATURITY_PENDING` (`STRK20-010`) |
| 17 | Consent denied/absent before `privately_available → proving` | G8 | `CONSENT_DENIED` / `CONSENT_REQUIRED` |
| 18 | `isEmptyProof` submitted (simulate proof) | G9 proof boundary | `PROOF_REQUIRED` (`STRK20-018`) |
| 19 | Primary and independent readbacks disagree or share `source_id` | G10 | stop, do not normalize — `DEPENDENCY_FAILURE` |
| 20 | Conservation / no stranded balance fails (`helper STRK/vToken balance !=0` or `vTokenShares != openNoteAmount`) | G11 | `DEPENDENCY_FAILURE` |
| 21 | Any credential, viewing-key material, or secret-bearing URL in a packet/log | G auth packet stop condition | `VIEWING_KEY_FORBIDDEN` (`STRK20-015`) / `SECRET_FORBIDDEN` |
| 22 | Authorized transaction count or spend limit would be exceeded | G auth packet stop condition | `STALE_STATE` (fenced) |

These 22 rows satisfy the “16+ blocked states” requirement with explicit runbook binding. For UI QA, only the first 10 are expected to be snapshot-tested; the remainder are unit-gated at the domain adapter layer.

### 12.3 Conservation and no stranded balance (helper route only)

When the route is `application` (Prism-owned helper/anonymizer), require route-specific conservation before `transfer_confirmed` can be accepted:

```text
inputDelivered == authorized input amount
vTokenShares > 0
openNoteAmount > 0
vTokenShares == openNoteAmount
if Vesu shares are observed: Vesu shares == vTokenShares
helper STRK balance == 0
helper vToken balance == 0
```

Do not claim full conservation from a public helper-balance read alone — the wallet-owned note/open-note observation and the protocol/application event must also be present. A non-zero helper balance or any contradictory explicit observation blocks completion.

---

## 13. Privacy limitation record (what must be disclosed)

For each claim, record observer model + leakage boundary (G12). At minimum disclose:

- Shield metadata is public: depositor, token, amount, timing, pool interaction.
- Proof/encrypted-note artifacts and timing may remain observable; pool event exists.
- Relayer `sender` is not attribution; attribute from pool/application event.
- Note-maturity and shield→transfer composition can correlate; do not spend a fresh note.
- Open-note amount visibility is per protocol; do not claim amount/timing privacy without separate proof for helper-derived outputs.
- Ordinary Base remains public — no private-Base claim in this release.
- STRK20 pool is `0x0403…812a` on `SN_MAIN`; helper contract involvement must be proved via event or calldata when project contracts are declared.

Privacy claim shape (per packet — never inline-invented):

```yaml
privacy_claims:
  - claim_id: shield-deposit
    route: private_transfer
    observer: public-pool-observer
    hidden_datum: [sender, recipient, amount, token-type, spent-note-relationship]
    visible_datum: [depositor, token, amount, timing, pool-interaction, proof-artifact-timing]
    linkability_assumptions: [relayer-not-attribution, maturity-wait-required, no-composed-deposit-and-spend-unless-authorized]
    amount_timing_leakage: shield-amount-and-timing-visible
    open_note_visibility: helper-output-amount-may-be-public
    claim_supported: true
    limitation: shield-is-not-describable-as-private; direct-user-identity-hidden-only-behind-privacy-route
```

---

## 14. Defer implementation — what this brief intentionally does NOT authorize

### 14.1 Zero code in this step

- No file under `src/app/*` is created, moved, renamed, or edited (including `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`).
- No component under `src/features/landing/*` or `src/features/wallet/*` or `src/features/prism-strk20/*` is added or mutated.
- No React/JSX/TSX hooks or CSS-module className changes are implied — this brief contains prose and tables only.
- No `strk20.json` edit is authorized. The file remains `{"transactions":[],"contracts":[],"demo_video":"","demo_url":""}` until a separately authorized submission step (G13). `node ops/starknet/validate.mjs` and `node ops/release/validate-mainnet.mjs` behavior is unchanged.
- No contract deployment, no `starknet` provider call, no real wallet prompt, no chain write.

Verification commands that must stay green after this brief lands (do not run a deploy):

```bash
git status --short --branch          # this file appears as ?? only
git diff --stat                      # empty for src/app
git diff --stat HEAD -- strk20.json  # empty (no strk20.json mutation)
git rev-parse HEAD                   # candidate recorded exactly
node ops/target-network/validate.mjs
node ops/starknet/validate.mjs
node ops/starknet/dry-run-check.mjs
node ops/evidence/validate.mjs --self-test
node ops/release/validate-mainnet.mjs --self-test
npm run typecheck
npm test
npm run build
git diff --check                     # no whitespace violations introduced by this doc
```

### 14.2 Why deferral is load-bearing

The runbook (G0) fences `strk20.json`, contract state, and credentials so local UX work cannot accidentally consume `maximum_transaction_count`, pollute `maximum_spend`, or create a simulated receipt that looks like live evidence. The surface contract (Phase 8) fences the workspace so a wallet panel cannot fabricate balances, receipts, identities, bindings, or completed operations. Respecting both fences keeps this brief at `X2` and prevents premature promotion to `X3`.

### 14.3 What is deferred to a later, separately authorized change

| Deferred item | Why deferred | What the later change proves |
|---|---|---|
| `src/features/wallet/session/*` land (adapter, reducer, provider, selectors, strings) | Must be reviewed with grep gates before it can render an address | Unit tests for reducer exhaustive state mapping + `SessionStatus` ↔ `SessionUiState` |
| `src/features/wallet/WalletConnectionPanel.tsx` + `.module.css` | Pure presentational surface; snapshot-tested against all 15 states in both motion modes | `transition-duration: 0s` / `animation-name: none` under reduced motion, forced-colors legibility, CTA/state table tests |
| Wiring into `PrismWorkspacePreview.tsx` behind `?demo=session` | Keeps default landing render unchanged; avoids redeploying the workspace shell | No horizontal scroll at `360px`, `scrollWidth==clientWidth`, desktop + mobile screenshots pass |
| `projects/prism/DECISIONS.md` entry: connection/auth state lives in `src/features/wallet/session/` and is the only surface that may render the user's address | Prevents address rendering drift into other features | `DECISIONS.md` single-line addition, mirrored in packet |
| `strk20.json` population (exactly 3 distinct `SN_MAIN` hashes with `SN_SEPOLIA` rehearsal first) | Requires owner-authorized packet (`ACCEPTED`, exact `SN_MAIN` + `base_network` + `maximum_transaction_count/spend` + `exact_contract_scope` + `stop_conditions` + `expires_at`) | Independent readback across two distinct RPC sources, pool-event + helper-involvement, conservation, no-stranded-balance |
| Live provider readback helpers (`createIndependentRpcReader` with distinct `source_ids`) | Cannot be validated without two real endpoints | Transaction/calldata reads bound to requested hash, distinct source IDs enforced |
| Real Base binding / Pause settlement / PostgreSQL integration tier | Production-like runtime requires disposable DB via `PRISM_RUNTIME_PROFILE` + `STARKNET_CHAIN_ID` | Integration suites only against a protected out-of-band `DATABASE_URL`; `SKIPPED — not evidence` if URL absent |

### 14.4 Grep / hygiene gates that protect the deferral boundary

These must be green before any deferred implementation is enabled by default:

```bash
# Prohibited-claim gates (case-insensitive whole-word, allowlisted fixtures only)
rg -i -w "Anonymous|Private|Shielded|Hidden|STRK20-ready|privacy-enabled|Connected securely|trusted|verified wallet|\\bBalance\\b|\\bDone\\b" src/features/wallet/

# Adapter isolation gate
rg "from.*starknet|from.*get-starknet|from.*@starknet" src/features/wallet/WalletConnectionPanel.tsx && exit 1

# No implementation leaked into this brief
rg "useState|useEffect|className.*styles\\." projects/prism/PRISM_PRIVACY_UX_DECONSTRUCTION.md && echo "FAIL: React code leaked into brief"
```

No credential scan may match: `viewing.?key`, `private.?key`, `seed.?phrase`, `mnemonic`, `rpc[_-]?url` with embedded secret, `password`, `credential` (case-insensitive). `node ops/evidence/validate.mjs` and `no-secrets` / `privacy-guard` guards enforce this.

---

## 15. Acceptance checklist (for the brief itself, not for a build)

- [ ] File exists at `projects/prism/PRISM_PRIVACY_UX_DECONSTRUCTION.md` and is tracked as `??` (untracked) before intended commit — not yet committed, not ignored.
- [ ] `git diff --stat HEAD -- src/app` is empty (no landing/page mutation).
- [ ] `strk20.json` is `{ "transactions": [], "contracts": [], "demo_video": "", "demo_url": "" }` and `git diff --stat HEAD -- strk20.json` is empty.
- [ ] No credential material is present (pass the prohibited-pattern grep above).
- [ ] IA frozen statement (`no 5th tab`) is present and maps to `prism-workspace-surface-contract.yaml` + `PHASE8_FRONTEND_SURFACE_CONTRACT.md`.
- [ ] 15 `SessionUiState` + 13 `Strk20State` are enumerated with CTA/status/receipt truth and `ALLOWED` transitions.
- [ ] Capability rule `>=0.10.3` via `supportedWalletApi/supportedSpecs` is stated with no balance probe.
- [ ] Two-hash shield is described as two separate hashes (approval + shield) with screening + fee + maturity.
- [ ] Consent gate shape (`requested/prompt_presented/user_decision/token_scope/consent_reference/displayed_value_handling/raw_private_state_in_packet`) is present.
- [ ] Tokens: `paper #f3f3f3`, `ink #101010`, `accent #526f95` table is present plus supporting tokens (`line #dfe0e5`, `positive #4f8d69`, `warn #b5853f`).
- [ ] Motion: `--motion-ease cubic-bezier(0.22,1,0.36,1)` + `--motion-duration 820ms` plus reduced-motion collapse to `0.01ms` and `document.getAnimations()==0`.
- [ ] Failure modes: 16+ blocked states table with runbook + error-code binding.
- [ ] Defer implementation section is present and contains zero React code.
- [ ] Copy deck tables include hero sequence 4×2 + 4 support lines, mesh aria-labels, workspace chrome, and all 15 status lines / CTA labels.

---

## Appendix A. Canonical addresses and constants

```text
STRK20 pool (SN_MAIN):        0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
STRK20 min API/spec:           0.10.3 (release; prereleases are below stable)
MATURITY_BLOCKS:               10
get-starknet:                  6.0.3
starknet.js / WalletAccountV6: 10.4.0 / @starknet-io/types-js 0.10.3
Wallet API surface:            supportedWalletApi() / supportedSpecs() / requestChainId()
Public shell:                  body #f3f3f3 / heroShell #ffffff→#f8f9fb→#f1f2f5 / line #dfe0e5
Focus:                         outline 2px solid #526f95, offset 3–4px
Contracts file:                strk20.json (empty until G13)
```

## Appendix B. References (exact filenames for review)

```text
projects/prism/PRIVACY_RUNTIME_CLOSEOUT_RUNBOOK.md (866 lines, ~38KB)
projects/prism/PRISM_LANDING_VISUAL_SPEC.md (395 lines, 10KB)
projects/prism/PHASE8_FRONTEND_SURFACE_CONTRACT.md (93 lines, 3.2KB)
projects/prism/agent-packets/FRONTEND_WALLET_SESSION_DESIGN.md (183 lines, 22KB)
docs/ui/prism-workspace-surface-contract.yaml (65 lines)
docs/ui/prism-workspace-narrative.md (28 lines)
docs/ui/prism-workspace-operating-design-ledger.md (37 lines)
src/features/landing/PrismLanding.tsx (343 lines)
src/features/landing/IdentityContextMesh.tsx (150 lines)
src/features/landing/RefractedCore.tsx (111 lines)
src/features/landing/PrismLanding.module.css (1430 lines)
src/features/landing/PrismWorkspacePreview.tsx (483 lines)
src/app/globals.css (248 lines)
src/app/page.tsx (5 lines)
src/features/wallet/session/session-state.ts (801 lines)
src/features/wallet/session/types.ts (217 lines)
src/features/wallet/session/reducer.ts (115 lines)
src/features/wallet/session/selectors.ts (193 lines)
src/features/wallet/session/strings.ts (168 lines)
src/features/prism-strk20/domain/wallet-capability.ts (123 lines)
src/features/prism-strk20/domain/strk20-state.ts (310 lines)
src/features/prism-strk20/domain/strk20-proof.ts (118 lines)
src/features/prism-strk20/domain/strk20-action-port.ts (396 lines)
src/features/prism-strk20/domain/errors.ts (90 lines)
src/features/wallet/session/errors.ts (56 lines)
```

---

*End of brief. No implementation follows. The next step is a separately reviewed change that lands `src/features/wallet/session/` and `WalletConnectionPanel` behind `?demo=session`, with CI grep + snapshot gates green, while `strk20.json` and credentials remain untouched.* <!-- build-pad:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx -->
