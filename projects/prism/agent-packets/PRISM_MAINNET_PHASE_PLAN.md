# Prism — Whole-Product Phases to Mainnet

**Status:** Proposed release and implementation phase plan  
**Date:** 2026-08-23  
**Authority:** Product Truth → System Foundry → Research Foundry → Evidence/Audit  
**Maturity rule:** local implementation = X2; observed SN_SEPOLIA/Base testnet = X3; repeated independently verified mainnet = X4/X5

## Executive answer

Prism should not be treated as one monolithic mainnet gate. There are three meaningful release bands:

```text
Band A — Identity MVP mainnet
  persistent Prism ID + native Base binding + truthful Home/operation surface

Band B — Pause-enabled Prism mainnet
  Band A + Prism Pause as a pre-settlement control boundary

Band C — Full Prism vision after the first release
  social principals, claims, portfolio, continuity/delegation,
  and broader private financial capabilities

Explicit scope for the current release:

```text
PrismChannel is included in the testnet path as the minimal S4 relationship/
payment-memo slice. It is not a full messenger and is not a mainnet blocker
unless the mainnet release explicitly promises PrismChannel.
```

**Band B** is now the selected release contract: Prism Pause is part of the mainnet promise and all promised M0–M7 work, owner-led Phase 8 surfaces, and M8 testnet evidence must pass before M9.
**Band A** is not the selected release rule.
**Band C** remains deferred and is not a prerequisite for the selected mainnet release.

---

## Product Truth that every band preserves

```text
One Prism ID. One home across chains.
Starknet anchors identity and continuity state.
Connected chains execute natively.
Base authority remains Base-valid.
STRK20 is private only where the underlying route proves privacy.
The backend verifies/prepares but never becomes canonical identity authority.
Submitted is not completed.
Pause delays settlement; it never reverses finality.
```

---

# Phase M0 — Product, System, and release contract

**Purpose:** lock what “mainnet Prism” means before more code is added.

### Work

- accept the bounded mainnet band: Identity MVP or Pause-enabled MVP;
- register the selected decisive workflows;
- align Product Truth, System Foundry, Research Foundry, Audit, and evidence ledger;
- define what is explicitly deferred;
- freeze privacy language and authority boundaries;
- define the exact mainnet claims allowed in README, UI, demo, and video.

### Required decisions

```text
Which release band is being shipped?
Is Prism Pause a mainnet requirement or a post-mainnet enhancement?
Which social provider is MVP (Telegram is the current strongest candidate)?
Is PrismClaim the selected project-owned STRK20 action, or is another helper selected?
Which contracts will be declared in strk20.json.contracts?
```

### Exit gate

```text
one accepted Product/System release contract
no unresolved contradiction in the selected MVP path
all deferred features explicitly labeled
```

**Current state:** Band B is accepted in `DEC-PRISM-M0-001`; detailed Pause P0 decisions and the remaining M0–M7/runtime/evidence gates remain open.

---

# Phase M1 — Starknet identity root

**Purpose:** prove that Prism identity exists canonically on Starknet.

### Work

```text
account deployed
registry declared
registry deployed
create_identity live
get_identity live
PrismIdentityCreated indexed
independent readback
```

### Required guarantees

```text
Prism ID != Starknet account address
controller is recorded correctly
identity survives unrelated state growth
identity remains after binding revocation
registry is immutable/no-proxy as decided
```

### Evidence

```text
registry address
class hash
deploy receipt/block/status
create tx receipt/block/status
created Prism ID
get_identity second read
indexed event + watermark
```

**Current state:** account and registry deployment are observed on SN_SEPOLIA; live `create_identity` and independent `get_identity` readback are now observed at X3 in `M1_LIVE_IDENTITY_EVIDENCE.md`. Event indexing/watermark reconciliation and the M3 cross-chain sequence remain open.

**Exit maturity:** X3 testnet identity evidence.

---

# Phase M2 — Backend authority, proof, and operation runtime

**Purpose:** turn the local backend foundation into a real service boundary.

### Work

- real HTTP/API runtime over the transport-neutral handlers;
- real `STARKNET_RPC_URL` and registry-address configuration;
- real Account/provider wiring without committed secrets;
- Base proof ladder: EOA → EIP-1271 → ERC-6492;
- durable PostgreSQL challenge/operation/event stores;
- real indexer pagination and gap scans;
- reconciliation worker startup/metrics/recovery;
- watermarked resolve responses;
- stable errors and correlation chain.

### Required operation truth

```text
operation row before broadcast
submitted != completed
unknown status remains unknown
reverted remains reverted
indexer lag is visible
stale ACTIVE is never served
restart resumes from durable tx hash/version
```

### Exit gate

```text
T7 DB integration
T8 API contract
T9 ledger/indexer integration
T10 operation-state UI contract
T12 failure/recovery
real runtime smoke test on testnet
```

**Current state:** REST/API, SDK, MCP, environment-gated Postgres wiring, and HTTP smoke are parent-integrated at X2; live ledger/indexer/reconciliation and testnet smoke remain open.

---

# Phase M3 — Base connection and decisive identity proof

**Purpose:** prove Prism is more than a Starknet name-to-address registry.

### Work

```text
connect Base EOA
issue chainId-v2 challenge
Base wallet signs
backend verifies EOA/1271/6492 class
controller signs Starknet bind
registry consumes digest
resolve(P, BASE) = B
revoke B
resolve(P, BASE) = NO_ACTIVE_DESTINATION
get_identity(P) still succeeds
```

### Required adversarial cases

```text
wrong signer
altered recipient
altered Prism ID
altered domain/venue/chainId
expired challenge
nonce replay
digest replay
wrong Starknet controller
duplicate active destination
stale indexer/cache
```

### Exit evidence

```text
all operation IDs
Base proof signature class
bind/revoke tx hashes
receipt/status/block for each
independent registry reads
reconciliation watermark
failure/retry results
```

**Current state:** wallets funded and Starknet infrastructure deployed; M3 digest and Prism ID boundary fixes are X2-tested, but the live Base proof/bind/resolve/revoke sequence remains open.

**Exit maturity:** X3 testnet decisive identity evidence.

---

# Phase M4 — STRK20 consumer privacy route

**Purpose:** deliver Prism’s first real private financial surface through the supported wallet route.

The official STRK20 route separates:

```text
Wallet API = normal dapp route
Privacy SDK = advanced controlled-key route
Anonymizer = app-specific privacy_invoke route
```

Prism’s normal dapp must not receive or persist viewing keys.

### Work

```text
wallet capability detection
wallet/network compatibility
pool registration state
shield: approve → deposit
screening result states
note maturity state
private balance with intentional consent
private note-to-note transfer
pool fee read
private receipt/reconciliation
privacy wording audit
```

### Required UX states

```text
capability unknown
wallet mismatch
registration required
approval pending
shielding
confirmed
maturing
private balance available
private transfer pending
private transfer confirmed
screening rejected
```

### Exit gate

```text
real supported wallet route
real pool interaction
no viewing-key handling by Prism
private balance consent is intentional
maturity is represented honestly
privacy claim is action-specific
```

**Current state:** provider-injected Wallet API consumer route is integration-ready at X2 with a 12-state machine and privacy guards; no live funded-wallet STRK20 trace has been observed.

---

# Phase M5 — Prism-owned STRK20 action / PrismClaim decision

**Purpose:** satisfy both product depth and the own-contract evidence rule without inventing a scoring-only transaction.

### Decision fork

```text
Option A — PrismClaim
  human identifier → unresolved recipient → private claim → onboarding → claim/refund

Option B — Prism-owned application helper
  privacy_invoke → meaningful application action → open-note result
```

The current `PrismAllocationHelper` is a canonical ABI-shaped local helper, but it is not yet a live pool integration. PrismClaim is the stronger product-native candidate in the canonical documentation because it connects human identity, onboarding, private value, and persistent identity.

### Work

- inspect first-party private routes before custom Cairo;
- select one action and record the decision;
- implement minimal contract/storage/events/errors;
- prove authorization, replay, atomic rollback, value conservation;
- deploy to SN_SEPOLIA first;
- run testnet helper/claim sequence;
- audit privacy and metadata leakage;
- deploy to SN_MAIN only after testnet acceptance.

### Exit evidence

```text
contract address/class hash
pool invocation receipt
successful result
rollback/revert evidence
privacy boundary record
declared Prism contract involvement
```

**Current state:** `PrismVesuLendingHelper` is u256-hardened, deployed to SN_SEPOLIA, and has a narrow real helper→Vesu X3 probe; the complete STRK20 pool-invoked transaction and private-note readback remain open. PrismClaim is preserved as a future re-entry route.

---

# Phase M6 — Product Home and vertical surfaces

**Purpose:** make the protocol legible as Prism rather than as infrastructure.

### Required product surfaces

```text
Home
Connections
Send
Receive
Activity / receipts
Profile
```

### Home must show truthful state

```text
Prism ID
connected accounts
public balances where available
private state only after wallet consent
pending/paused/settled operations
identity/social connections
privacy labels
```

### Send/Receive must support

```text
Prism ID recipient
native address advanced fallback
verified social identifier when implemented
public/private route distinction
fee and maturity disclosure
pending/confirmed/reverted states
```

### Connections must support

```text
Starknet controller
Base execution identity
social principal(s) when implemented
verified/pending/revoked states
network mismatch
reverification
```

### Exit gate

```text
no fake balances
no fake activity
no fake integrations
operation labels derive from Operation state
wallet authority and app authentication remain distinct
responsive/accessibility/reduced-motion QA passes
```

**Current state:** public landing exists; authenticated Home, Connections, Send, Receive, Activity, and Profile remain owner-led and are intentionally excluded from delegation. The current “Enter Prism” action is a preview only.

---

# Phase M7 — Prism Pause pre-settlement gate

**Purpose:** place Prism Pause between authorization and any real STRK20/Send settlement path. It is not a post-mainnet add-on when Pause is part of Prism’s mainnet promise.

**Placement:** begin after M2/M3 identity and authority foundations are stable; complete P0–P4 before M4/M6 release-capable user actions; complete P5–P8 before M8 testnet acceptance.

Required subphases:

```text
P0 Product/System acceptance
P1 Intent + normalized execution plan
P2 Durable Pause persistence/lifecycle
P3 Verification + policy engine
P4 Release / Cancel / Escalate / Approval
P5 Settlement adapter integration
P6 Product/API vertical slice
P7 Security/red-team/observability
P8 Testnet Pause evidence
```

**Mainnet requirement:** if Pause is included in the product promise, all P0–P8 must pass before M9. Pause must govern at least one consequential user action; it must never claim post-finality rollback.

**Current state:** Pause P0–P7 foundations are parent-integrated at X2; detailed P0 canonicalization, live settlement adapters, Postgres/runtime evidence, and P8 testnet evidence remain open and block Band B M9.

**PrismChannel boundary:** minimal C1/S4 PrismChannel domain slice is integration-ready at X2 for the testnet path; it remains non-blocking for first mainnet unless explicitly promised. No Phase 8 messaging surface is delegated.

---

# Phase M8 — Full testnet rehearsal and evidence acceptance

**Purpose:** replace local plausibility with realistic observed evidence.

### Required rehearsal

```text
SN_SEPOLIA registry
Base Sepolia EOA
create/read identity
Base proof/bind
resolve/revoke
REST/API runtime
SDK client path
MCP adapter path when agents/Pause are enabled
Prism Pause path when promised
minimal PrismChannel S4 slice: channel + encrypted payment memo/receipt reference + revoke
STRK20 wallet route
selected helper/claim action
operation/reconciliation worker
independent RPC/explorer reads
failure/retry/recovery cases
```

### Evidence package

```text
network
contract address
class hash
deploy tx
operation txs
block numbers
execution status
events
watermarks
independent second reads
commit/spec versions
limitations
```

### Exit gate

```text
EVD-PRISM-004..007 promoted only from observed facts
X3 testnet maturity
no unresolved critical security gap
no fake receipt/balance/privacy claim
```

**Current state:** account/registry infrastructure evidence exists; decisive workflow and STRK20 evidence remain open.

---

# Phase M9 — Mainnet release and submission

**Purpose:** release the bounded Prism product and earn mainnet evidence.

### Preconditions

```text
M0–M6 accepted
S1 REST/API accepted
S2 SDK accepted
S3 MCP accepted when agents/Pause are in the product promise
S4 PrismChannel testnet slice accepted
M8 testnet rehearsal accepted
M7 Pause P0–P8 accepted if Pause is in the product promise
SN_MAIN release decision
funded mainnet operational wallets
current pool fee/readiness
privacy wording audit
public demo route
```

### Mainnet work

```text
G0 pool reachability
SN_MAIN contract deployment
STRK20 Wallet API action
Prism-owned helper/Claim action
three qualifying pool transactions
own-contract involvement if contracts are declared
independent validator checks
public demo
3-minute video
README/reproducibility package
final strk20.json
```

### Qualifying hash rule

Every final hash must:

```text
exist on SN_MAIN
succeed
touch the STRK20 pool
involve a declared Prism contract when Prism contracts are listed
```

A registry deployment alone does not satisfy STRK20 submission evidence.

---

# Future Phase C1 — PrismChannel (non-blocking)

PrismChannel is a **private relationship channel between Prism identities**, not a general-purpose messaging app.

It can carry Prism-native relationship objects such as:

```text
payment memo
payment request
claim invitation
invoice
settlement proposal
authorization request
receipt
```

### What it is

```text
PrismIdentity A
      │
      └── PrismChannel
               │
               └── PrismIdentity B
```

A conceptual channel contains:

```text
channel_id
participants
channel key commitments
created_at
status
policy
```

Messages should use ciphertext or encrypted payload references, not plaintext identity/payment metadata on a public chain.

### What it is not

```text
not the Prism identity root
not a wallet
not a payment authority
not a replacement for STRK20
not a guarantee of private metadata
not required for the first mainnet release
```

Communication keys must remain separate from Starknet account keys, Base keys, and STRK20 viewing keys.

### Status

```text
Product concept: retained
Current implementation: none
Mainnet blocker: no
Future trigger: after core identity, payment, Pause, and receipt flows are stable
```

---

# What can be deferred after first mainnet

These should not block a bounded first release unless they are explicitly included in its promise:

```text
second social provider
advanced claim variants
multiple claim/refund policies
guardians
successors
delegation
agent authority expansion
recovery/inheritance
private Base
all-chain privacy
universal portfolio indexing
all DeFi adapters
```

They require their own Product/System phases and should not be implied by the first mainnet deployment.

---

# Current phase status

```text
M0  Product/release contract       partially governed; needs release-band decision
M1  Starknet identity root          infrastructure deployed; live identity workflow open
M2  Backend runtime                 X2 implementation; live service/reconciliation open
S1  REST/API runtime                handlers exist; real service open
S2  SDK                             not implemented
S3  MCP adapter                     not implemented; conditional on agent/Pause promise
M3  Base decisive proof             wallets funded; live bind sequence open
M7  Prism Pause                     proposed plan only; before M4/M6 settlement actions
M4  STRK20 consumer route           capability scaffold only
M5  Prism-owned action/Claim        helper X2; live route not deployed
M6  Home/product surfaces           landing only; app surfaces open
C1  PrismChannel testnet slice      included in M8; not implemented
M8  Testnet rehearsal               open
M9  Mainnet release                 blocked
```

## Bottom-line release equation

```text
Product Truth
+ identity root
+ live Base binding
+ STRK20 wallet action
+ selected product-owned action
+ Home/product surfaces
+ Pause if promised
+ testnet evidence
+ independent reads
+ mainnet pool/own-contract evidence
+ demo/submission package
= Prism mainnet release
```

The current system has the identity/backend foundation and testnet registry infrastructure, but it is not yet through M3–M8. The next highest-value vertical slice is:

```text
live create/read Prism ID
→ live Base bind/resolve/revoke
→ wire the resulting Operation state into Home/Activity
```
