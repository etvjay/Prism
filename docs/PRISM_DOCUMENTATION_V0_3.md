# Prism Documentation v0.3
## One Prism ID. One home across chains.

**Status:** Canonical product / protocol / sprint architecture reference  
**Date:** 2026-08-20  
**Project:** Prism  
**Repository:** `etvjay/Prism`  
**Sprint:** STRK20 Private Sprint  
**Supersedes:** prior Prism documentation drafts where this document is more specific  
**Methodology:** Foundry → Profile → Project → Implementation → Evidence

---

# 0. Executive Definition

> **Prism is a Starknet-native identity, financial coordination, and private relationship protocol that gives a person one persistent Prism ID across chain-specific accounts, social identities, private financial state, and communication channels.**

The user experiences one coherent home.

Underneath that home:

- Starknet anchors Prism identity and continuity state;
- Base and other blockchains remain native execution venues;
- X, Telegram, email, phone, and other external identifiers are verified social principals, not canonical identity roots;
- STRK20 provides Prism's first private financial state and private Starknet execution surface;
- Prism resolution maps a person or Prism ID to the correct capability for a specific purpose;
- PrismClaim enables payments to people who have not onboarded yet;
- PrismChannel provides a private relationship and communication layer between Prism identities;
- Prism does not pretend that one signature, one address, one chain, or one privacy system controls everything.

Primary product line:

> **One Prism ID. One home across chains.**

Technical line:

> **Persistent identity on Starknet. Native execution everywhere else.**

Privacy rule:

> **Private where the underlying system can prove privacy; never by marketing fiction.**

Canonical invariant:

> **Identity is persistent. Execution is venue-specific. Authority connects them.**

The expanded Prism thesis is:

> **A person should have one durable digital home even when their money, accounts, social identities, relationships, communication, and execution live across different networks.**

---

# 1. What “Home” Means

“Home” is not a wallet dashboard.

It is the persistent place where Prism represents what belongs to a person and how other people or applications may interact with them.

```text
Prism ID
   ↓
Your Home
   ├── Identity
   ├── Accounts
   ├── Balances & positions
   ├── Social identities
   ├── Private payments
   ├── Private channels
   ├── Connections / authority
   └── Activity / receipts
```

A Prism Home answers:

```text
Who am I?
What accounts are currently mine?
Where can someone pay me?
How should I receive privately?
Which public identifiers refer to me?
What private relationships do I have?
What authority have I granted?
What happened?
What is still pending?
What is actually private?
```

The system should make this feel simple without flattening the underlying trust, privacy, or execution boundaries.

---

# 2. Product Thesis

Blockchain products usually expose infrastructure as identity.

A person becomes:

```text
0x7a...
0x94...
starknet:0x...
solana:...
another wallet
another chain
another signing flow
```

Social systems have the opposite problem: they provide human-readable identities but do not provide durable financial authority or user-controlled resolution.

Prism separates those concerns.

```text
Person
  ↓
PrismIdentity
  ↓
Authorities + Principals + Execution Identities
  ↓
Purpose-specific resolution
```

Prism does not ask:

> “What is your wallet address?”

It should increasingly answer:

> “Who are you trying to interact with, and what is the correct authorized route for this purpose?”

---

# 3. Product Boundaries

Prism **is**:

- a persistent identity layer;
- a user-controlled resolution layer;
- a financial home;
- a private-payment surface through STRK20;
- a social-principal binding layer;
- a private relationship/channel layer;
- an authority-coordination protocol;
- a future continuity layer for rotation, delegation, guardianship, inheritance, and agents.

Prism is **not**:

- an ENS clone;
- a username-to-address database;
- a bridge;
- a solver network;
- a universal balance abstraction;
- a privacy wallet clone;
- an MPC signer that silently owns every chain account;
- a messaging app whose core value is chat;
- a social network;
- a custom-ZK requirement for every action;
- a claim that every chain becomes private.

Prism may integrate systems from those categories when they serve a Prism capability.

---

# 4. Naming

```text
Prism        = product + protocol
PrismZK      = privacy/proof architecture
PrismFlashZK = experimental predecessor
```

Canonical sentence:

> **Prism is the system. PrismZK is how Prism can prove things privately. PrismFlashZK was an experiment that tested an earlier version of those ideas.**

PrismFlashZK demonstrated useful primitives including:

- nullifiers;
- payload commitments;
- browser-side proving;
- verification-before-execution;
- VM-independent intent reasoning.

Its previous implementation choices are not mandatory for Prism.

In particular, Prism does not require:

- a Soroban clearinghouse;
- a trusted proof attestor;
- a solver network;
- universal custom ZK;
- a custom liquidity registry.

---

# 5. Identity Model

## 5.1 PrismIdentity

A Prism ID is a persistent protocol identity.

Example:

```text
prism:P7F21
```

A Prism ID is not an address.

```text
PrismID != Starknet address
PrismID != Base address
PrismID != Telegram username
PrismID != X username
PrismID != email
```

Those things may bind to the Prism ID.

The Prism ID persists when any of them changes.

---

## 5.2 Identity, Controller, Execution Identity

These are separate concepts.

```text
identity ≠ controller ≠ execution identity
```

### Identity

The durable Prism object.

### Controller

The authority currently allowed to mutate protected Prism state.

### Execution identity

A venue-native account that performs actions on a specific network.

Example:

```text
Prism ID      prism:P7F21
Controller    Starknet account A
Base account  0x83A...
```

Controller rotation should not require replacing the Prism ID.

Base-account replacement should not require replacing the Prism ID.

---

## 5.3 Social Principal

A social identity is modeled as an `ExternalPrincipal`.

```text
ExternalPrincipal {
  platform
  subject_id
  current_handle
  prism_id
  verification
  visibility
  verified_at
  revoked_at
}
```

The canonical key is the platform's stable subject/user identifier where available.

```text
subject_id ≠ username
```

Example:

```text
platform       telegram
subject_id     1234123412341234
current_handle @alice
prism_id       prism:P7F21
```

If Alice changes her Telegram handle, the binding remains valid.

The current handle is presentation and discovery metadata.

---

# 6. Starknet as Canonical Root

For Prism v0:

> **Starknet owns canonical Prism identity state.**

This is structural, not decorative hackathon integration.

Starknet is the canonical authority for:

```text
PrismIdentity
accepted bindings
binding revocation
controller state
resolution-critical state
```

The backend may:

- index;
- cache;
- aggregate;
- verify external proofs;
- prepare operations;
- enrich data.

The backend must not quietly become the canonical owner of Prism identity.

---

# 7. Authority Map

| Object / State | Canonical authority |
|---|---|
| PrismIdentity | Starknet Prism registry |
| Prism controller | Starknet Prism registry |
| Accepted venue binding | Starknet Prism registry |
| Binding revocation | Starknet Prism registry |
| Base ownership proof | externally verified proof |
| Canonical acceptance of Base proof | Starknet Prism registry |
| X / Telegram verification | external platform auth proof + Prism acceptance policy |
| Current social username | external platform |
| Prism resolution policy | Prism canonical state |
| Public Base balance | Base |
| Public Starknet balance | Starknet |
| STRK20 private economic state | STRK20 privacy pool / supported wallet route |
| Portfolio aggregate | derived Prism representation |
| Activity feed | derived / reconciled |
| Communication ciphertext | PrismChannel storage layer |
| Communication key authority | Prism user/device key hierarchy |
| Sprint transaction eligibility | upstream STRK20 hub validator |

Rule:

> **Derived data may be useful, but derived data does not become authority merely because Prism displays it.**

---

# 8. Resolution as a Core Primitive

Traditional name resolution asks:

```text
name → address
```

Prism resolution is richer:

```text
identity + purpose + venue + privacy policy
→ authorized capability
```

Conceptual interface:

```text
resolve(
  identifier,
  purpose,
  venue?,
  privacy?
)
```

Examples:

```text
resolve(
  "prism:P7F21",
  purpose = BASE_EXECUTION
)

→ active Base execution identity
```

```text
resolve(
  "@alice",
  platform = TELEGRAM,
  purpose = PRIVATE_PAYMENT
)

→ verified ExternalPrincipal
→ PrismIdentity
→ STRK20 private receive capability
```

```text
resolve(
  "@alice",
  platform = X,
  purpose = COMMUNICATION
)

→ verified ExternalPrincipal
→ PrismIdentity
→ PrismChannel capability
```

The resolver must never return revoked state as active.

---

# 9. Resolvable Does Not Mean Publicly Enumerable

This is a critical privacy property.

A social principal may be resolvable for a specific interaction without creating a public downloadable graph of:

```text
Telegram user ↔ Prism ID
X account ↔ Prism ID
email ↔ Prism ID
wallets ↔ Prism ID
```

Canonical principle:

> **Resolvable does not imply publicly enumerable.**

Future representations may use:

- private backend indexes;
- commitments;
- salted hashes;
- selective proofs;
- authenticated lookup;
- capability tokens;
- PrismZK proofs.

For the sprint, implementation should choose the smallest mechanism consistent with this invariant and avoid publishing unnecessary social-linkage metadata on-chain.

---

# 10. Social Identity Integration

Initial target surfaces:

```text
Telegram
X
```

Future:

```text
email
phone
Discord
GitHub
Farcaster
other verified identifiers
```

The product should treat social systems as external identity/discovery surfaces, not identity roots.

## 10.1 Binding flow

```text
User has Prism ID
→ Connect Telegram/X
→ external provider authenticates user
→ obtain stable external subject ID
→ verify proof/session
→ bind ExternalPrincipal to Prism ID
→ store current display handle
→ publish only the minimum state required
```

## 10.2 Rotation

If the username changes:

```text
same subject_id
→ update display handle
→ Prism binding remains
```

If the external account itself is revoked or transferred:

```text
reverification / revocation policy
→ update or revoke principal binding
```

A stale username must not redirect financial authority to a new social-account owner.

---

# 11. Username-Addressed Payments

The human-facing payment primitive is:

> **Pay the person, not the wallet address.**

Example:

```text
Send
To: @alice
Platform: Telegram
Amount: 25 USDC
Privacy: Private
```

Internally:

```text
@alice
  ↓
platform lookup
  ↓
stable social subject
  ↓
verified ExternalPrincipal
  ↓
PrismIdentity
  ↓
payment resolution policy
  ↓
STRK20 private receive path
```

The sender does not need to understand:

- recipient wallet addresses;
- STRK20 viewing keys;
- pool internals;
- chain-specific note mechanics.

The product still must communicate relevant public/private/fee/pending behavior.

---

# 12. Registered Recipient Flow

```text
Sender enters @alice
→ Prism resolves social principal
→ Prism resolves Alice's Prism ID
→ Prism checks private receive capability
→ wallet requests private transfer
→ STRK20 executes
→ Prism creates receipt
→ optional PrismChannel memo
```

User-facing result:

```text
Sent privately to @alice
```

Expanded receipt may show:

```text
Recipient: @alice
Resolved via: Telegram
Prism ID: hidden / user-controlled disclosure
Network: Starknet
Privacy: private note transfer
Status: confirmed
```

The product should not expose underlying addresses unless the user requests technical detail.

---

# 13. Unregistered Recipient Flow — PrismClaim

A username may identify a real person who has not created Prism yet.

This should not force the sender back to a wallet address.

Introduce:

## `PrismClaim`

A Prism-owned claim / onboarding settlement primitive.

Conceptually:

```text
PrismClaim {
  claim_id
  external_principal_commitment
  asset
  amount
  expiry
  sender_policy
  status
}
```

Flow:

```text
Sender enters @alice
→ Alice has no Prism ID
→ Prism verifies external principal exists
→ sender creates private claim
→ Alice receives claim invitation
→ Alice onboards
→ proves control of external principal
→ creates/links Prism ID
→ claims private funds
```

Expiry path:

```text
claim expires
→ sender refund path
```

This is strongly aligned with the official “payments by identifier, not address” direction while remaining a Prism-native expression of persistent identity.

---

# 14. Why PrismClaim Matters to the Sprint

Prism intends to deploy project contracts.

The current STRK20 sprint validator requires every final transaction listed in `strk20.json.transactions` to:

```text
exist on SN_MAIN
AND succeed
AND contain a STRK20 pool event
AND, once Prism declares contracts,
    involve at least one declared Prism contract
```

Therefore an ordinary shield or ordinary private transfer may be excellent engineering evidence but fail the final project-owned-contract eligibility check.

A meaningful PrismClaim lifecycle could potentially provide final evidence such as:

```text
Tx A
create private social payment claim through Prism contract

Tx B
claim private payment through Prism contract

Tx C
refund / second real claim lifecycle through Prism contract
```

This is a stronger product fit than manufacturing unrelated DeFi transactions only to satisfy evidence rules.

The exact Cairo design must be validated against STRK20 helper semantics before it becomes canonical implementation.

---

# 15. Private Communication — PrismChannel

Prism should not become “another messaging app.”

The protocol primitive should instead be:

## `PrismChannel`

> **A private relationship channel between Prism identities.**

A PrismChannel may carry:

```text
encrypted message
payment memo
payment request
claim invitation
invoice
settlement proposal
authorization request
receipt
future delegation request
future recovery request
```

A communication relationship becomes another capability of the persistent Prism identity.

```text
PrismIdentity A
      │
      └── PrismChannel
               │
               └── PrismIdentity B
```

---

# 16. PrismChannel Data Model

Conceptual:

```text
PrismChannel {
  channel_id
  participants
  channel_key_commitments
  created_at
  status
  policy
}
```

Message:

```text
ChannelMessage {
  message_id
  channel_id
  ciphertext
  content_type
  created_at
  reply_to?
  payment_ref?
  claim_ref?
  receipt_ref?
}
```

The system should avoid putting plaintext:

```text
sender
recipient
message
social handle
payment memo
```

on a public chain.

---

# 17. Communication Key Separation

Prism communication keys should be compartmentalized.

```text
communication key ≠ Starknet account key
communication key ≠ Base account key
communication key ≠ STRK20 viewing key
```

This matters because the current STRK20 normal-dapp rule is:

> **The dapp must never touch the user's STRK20 viewing key.**

Therefore Prism must not implement messaging by extracting wallet private viewing material into application code.

Initial PrismChannel should have its own communication key hierarchy.

Future PrismZK may prove relationships such as:

```text
this communication key belongs to the controller of Prism ID P
```

without publicly exposing unnecessary identity links.

---

# 18. Communication Storage

Possible implementation layers:

```text
encrypted payload onchain
encrypted payload offchain + onchain commitment
content-addressed encrypted object + authenticated channel index
```

Selection should optimize for:

- privacy;
- persistence;
- metadata leakage;
- cost;
- discovery;
- recovery;
- device synchronization;
- sprint feasibility.

RFP-01 is useful evidence that encrypted persistent channels and private-transfer memos fit STRK20's intended application surface, but Prism should implement only the parts compatible with the current Wallet API and key boundaries.

---

# 19. Payment + Communication Convergence

A major Prism product insight is that payment and communication should share identity context.

Instead of:

```text
chat app
+
wallet
+
payment link
+
block explorer
```

Prism can present:

```text
Alice
────────────────────────

@alice · Telegram verified

Dinner from yesterday.

[ 25 USDC request ]

Pay privately

────────────────────────
Payment confirmed
Private receipt
```

The relationship is primary.

The transaction is an object inside the relationship.

This does not make chat the product.

It makes Prism a home for digital relationships that can carry financial authority.

---

# 20. STRK20 Role

STRK20 is Prism's first private financial environment.

Normal user route:

```text
Prism dapp
→ get-starknet 6.0.3
→ starknet.js 10.4.0 / WalletAccountV6
→ Privacy Wallet API 0.10.3
→ privacy-enabled wallet
→ STRK20 pool
```

The wallet owns:

```text
registration
viewing key
notes
proof generation
supported private operations
```

Prism owns:

```text
product intent
capability detection
operation UX
identity resolution
social resolution
receipts
privacy labels
project contracts
```

---

# 21. STRK20 Privacy Truth

## Shield

Public:

```text
depositor
token
amount
timing
```

Do not market the deposit itself as private.

## Private note-to-note transfer

Protected in the supported flow:

```text
sender
recipient
amount
token type
spent-note relation
```

Required protocol artifacts remain public.

## Open note

An open note may hide ownership while exposing the amount.

Never infer:

```text
note == hidden amount
```

## Private DeFi / application action

May hide the direct user identity behind the public action.

Potentially visible:

```text
amount
timing
protocol
action
open-note amount
```

Do not claim “invisible swap” without evidence.

## Withdrawal

Public:

```text
destination
amount
timing
```

The link to the original private history may remain hidden subject to correlation.

## Base

Ordinary Base execution remains public.

---

# 22. STRK20 Operational Truth

## Shield is two transactions

Normal shield UX includes:

```text
1. ERC-20 approval
2. pool deposit
```

The interface should present one goal with truthful substeps.

## Note maturity

Fresh notes generally require roughly ten blocks before later spending.

Product states should include something like:

```text
shielding
→ confirmed
→ maturing
→ privately available
```

## Pool fees

Read the current fee from the pool.

Never hard-code historical fee values.

Fee affects:

```text
MAX
minimum useful amount
batching
previews
```

## Relayers

Private transaction sender may be a shared relayer.

Never use transaction sender as a user-activity identity field.

## Screening

Deposit screening is protocol-enforced.

Self-hosted proving does not bypass screening.

## Capability detection

Use supported Wallet API/spec version checks.

Do not use a private balance read merely to detect support.

---

# 23. Shadow Accounts

Current route-specific truth:

```text
Privacy SDK:
  release-candidate Shadow Account support exists

Wallet API:
  equivalent normal-dapp capability is not currently exposed
```

Therefore:

> **Shadow Accounts are not a Prism sprint dependency.**

This is a product/scope decision, not a claim that the SDK mechanism does not exist.

Prism's explicit identity-binding model remains sufficient for the decisive MVP proof.

---

# 24. Private Application Contract Strategy

Prism should not write Cairo merely because the sprint rewards anonymizer depth.

A project-owned STRK20 action must be:

```text
meaningful to Prism
small enough to review
privacy-honest
pool-integrated
capable of generating real evidence
```

Current strongest candidate:

```text
PrismClaim
```

because it expresses:

```text
human identifier
→ unresolved recipient
→ private value
→ onboarding
→ persistent Prism identity
→ claim
```

Alternative candidate:

```text
private capital allocation
```

potentially using a current Vesu reference.

The first mechanism that produces a stronger Prism product proof with lower contract risk should win.

---

# 25. First-Party Private Routes

Before building a custom anonymizer for an existing protocol:

```text
check protocol docs
→ check SDK
→ check official private integration
→ then inspect StarkWare reference
→ only then write Prism Cairo
```

A first-party route reduces:

- audit burden;
- maintenance;
- contract risk;
- implementation time.

However, first-party integration and sprint project-owned-contract evidence are separate concerns.

---

# 26. Base Integration

Base proves that Prism identity exists above a single chain.

A Base action must still use Base-valid authority.

```text
Prism identity = one
Execution identities = many
User authorization experience = coherent
Native signatures = per venue
```

For MVP:

```text
connect Base account
→ create ownership challenge
→ Base wallet signs
→ verifier validates signature
→ Starknet accepts binding
→ resolver returns active Base destination
```

Revocation:

```text
revoke Base binding
→ resolution no longer returns it
→ Prism ID persists
```

This remains the decisive chainless-identity proof.

---

# 27. Base Ownership Proof

Conceptual challenge:

```text
PrismBind {
  prism_id
  venue
  account
  nonce
  expiry
  domain
}
```

Security requirements:

```text
domain-bound
nonce-bound
expiry-bound
account-bound
Prism-ID-bound
single-use or replay-resistant
```

Tests:

```text
real owner succeeds
wrong signer fails
modified address fails
modified Prism ID fails
expired proof fails
replay fails
```

Canonical acceptance occurs on Starknet.

---

# 28. Domain Objects

Current canonical minimum:

```text
PrismIdentity
Controller
ExecutionIdentity
ExternalPrincipal
Binding
Resolution
ResolutionPolicy
Portfolio
PrivateBalance
PrismClaim
PrismChannel
ChannelMessage
Operation
Receipt
EvidenceRecord
```

Deferred:

```text
Guardian
Successor
Delegation
AgentAuthority
RecoveryPolicy
InheritancePolicy
SelectiveDisclosureProof
PrivateBindingProof
```

---

# 29. Canonical Invariants

## INV-PRISM-001
A Prism ID is not equivalent to any bound execution address.

## INV-PRISM-002
Revoking one binding does not destroy the Prism ID.

## INV-PRISM-003
No external execution account becomes canonical without control evidence.

## INV-PRISM-004
The resolver never returns revoked state as active.

## INV-PRISM-005
Common identity does not require common keys.

## INV-PRISM-006
A Base action uses Base-valid authorization.

## INV-PRISM-007
A Starknet action uses Starknet-valid authorization.

## INV-PRISM-008
A social handle is not the stable identity key where a platform stable subject exists.

## INV-PRISM-009
A social binding must not silently transfer when a username is reassigned.

## INV-PRISM-010
Resolvable social identity does not imply public enumerability.

## INV-PRISM-011
Prism application code never requests or persists a user's STRK20 viewing key.

## INV-PRISM-012
Prism communication keys remain separate from STRK20 viewing keys and venue execution keys.

## INV-PRISM-013
No cross-chain value movement is claimed without a real movement route.

## INV-PRISM-014
No privacy property is claimed beyond the specific underlying mechanism.

## INV-PRISM-015
Submitted is not completed.

## INV-PRISM-016
Final sprint hashes must satisfy current upstream pool + project-contract validation when contracts are declared.

---

# 30. System Architecture

```text
                         USER
                          │
                  Prism application
                          │
       ┌──────────────────┼───────────────────┐
       │                  │                   │
       ▼                  ▼                   ▼
 Identity / Resolver   Social Adapter      Private Layer
       │                  │                   │
       │            X / Telegram              │
       │                                      │
       ▼                                      ▼
 Starknet Prism                           STRK20 Wallet
 Contracts / State                        API / Pool
       │                                      │
       │                                      ▼
       │                                PrismClaim /
       │                                Prism helper
       │
       ├───────────────┐
       │               │
       ▼               ▼
   Base RPC        Portfolio adapters
```

Communication:

```text
PrismIdentity
    │
    ▼
PrismChannel
    │
encrypted messages / payment refs / claims
    │
storage / discovery layer
```

---

# 31. Suggested Contract Split

## `PrismIdentityRegistry`

Owns:

```text
identity creation
controller state
bindings
revocations
resolution-critical state
```

## `PrismClaim`

Potential sprint contract.

Owns:

```text
claim creation
external-principal commitment
expiry
claim authorization
refund lifecycle
pool-integrated settlement
```

## `PrismChannelRegistry` or helper

Only if justified.

Potentially owns:

```text
channel commitment
message commitment / encrypted payload pointer
channel status
```

Do not force all communication content on-chain merely because a contract exists.

Contract boundaries should follow authority and evidence, not aesthetics.

---

# 32. Backend Modules

Suggested modular-monolith boundaries:

```text
identity/
controllers/
bindings/
resolver/
principals/
social/
claims/
channels/
portfolio/
privacy/
operations/
receipts/
evidence/
```

Adapters:

```text
starknet/
base/
telegram/
x/
strk20/
storage/
indexer/
```

The backend prepares and derives.

Starknet remains canonical for Prism protocol state.

---

# 33. API Surface

Domain-first public API:

```http
POST /v1/identity
GET  /v1/identity/:prism_id

POST /v1/identity/:prism_id/bindings
POST /v1/identity/:prism_id/bindings/:id/revoke

GET  /v1/resolve/:identifier

POST /v1/principals/verify
GET  /v1/principals/:platform/:handle

GET  /v1/portfolio/:prism_id

POST /v1/payments/prepare
POST /v1/payments/submit

POST /v1/claims
POST /v1/claims/:id/claim
POST /v1/claims/:id/refund

POST /v1/channels
GET  /v1/channels/:id
POST /v1/channels/:id/messages

GET  /v1/operations/:id
GET  /v1/receipts/:id
```

Do not leak chain implementation into default API vocabulary.

---

# 34. SDK Vocabulary

Desired:

```ts
prism.identities.create()
prism.identities.resolve()

prism.bindings.create()
prism.bindings.revoke()

prism.principals.verifyTelegram()
prism.principals.verifyX()

prism.payments.sendPrivate()
prism.claims.create()
prism.claims.claim()

prism.channels.open()
prism.channels.send()

prism.private.balance()
```

Avoid forcing normal Prism developers to reason in:

```text
felt252
calldata
class hash
raw invoke versions
note discovery
wallet-standard internals
```

Low-level Starknet escape hatches can exist separately.

---

# 35. Operation Lifecycle

Every irreversible or chain-dependent operation must have an explicit lifecycle.

Canonical general model:

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

Possible failures:

```text
failed_retryable
failed_terminal
reverted
expired
cancelled
requires_attention
```

A timeout after submission does not prove failure.

---

# 36. Claim Lifecycle

Suggested:

```text
created
→ awaiting_sender_authorization
→ funded
→ recipient_unregistered
→ invitation_sent
→ recipient_verified
→ claimable
→ claiming
→ claimed
```

Alternative branch:

```text
funded
→ expired
→ refund_available
→ refunding
→ refunded
```

The exact STRK20-compatible state machine must follow the selected contract mechanics.

---

# 37. Channel Lifecycle

Suggested:

```text
proposed
→ accepted
→ active
→ muted
→ archived
→ revoked
```

For anonymous inbound requests:

```text
request_received
→ accepted | rejected
```

A communication channel should not implicitly grant payment, account, or execution authority.

---

# 38. Frontend Canon

Primary navigation remains:

```text
Home
Activity
Connections
Profile
```

Send and Receive remain primary actions rather than permanent nav destinations.

A lightweight relationship/message entry point may become part of Home or Activity once PrismChannel is proven useful.

Do not redesign the navigation around “Chat” prematurely.

---

# 39. Home Surface

The Home should communicate:

```text
PRISM
P7F21

Total
$8,420.31

Private
$2,418.20

[ Send ] [ Receive ]

Accounts
Starknet
Base

Identities
Telegram @alice ✓
X @alice_xyz ✓

Recent
Private payment to @bob
Payment request from @sam
Base binding updated
```

The architecture should be discoverable later.

The first two seconds should communicate:

> **This is my financial and digital home.**

---

# 40. Send Experience

Recipient input accepts:

```text
Prism ID
Telegram username
X username
future email/phone
native address as advanced fallback
```

Example:

```text
Send to
@alice

Resolved
Telegram · verified

25 USDC

Private on Starknet
Estimated pool fee: ...

[ Send privately ]
```

If unregistered:

```text
@alice does not have Prism yet.

Create a private claim?
Funds can be reclaimed after expiry.

[ Create claim ]
```

---

# 41. Receive Experience

Receive should answer:

```text
How do I want to be addressed?
Where should this payment land?
Should it be private?
```

Possible receive identities:

```text
prism:P7F21
@alice on Telegram
@alice_xyz on X
QR
claim link
```

Do not equate “shareable identifier” with “public wallet address.”

---

# 42. Connections Experience

Connections includes:

```text
Accounts
  Starknet
  Base

Social
  Telegram
  X

Future
  email
  phone
  devices
  guardians
  agents
```

Each connection shows:

```text
verified
pending
revoked
reverification_required
```

The user should understand which connection is:

```text
identity
execution
discovery
communication
```

without needing protocol jargon.

---

# 43. Activity and Receipts

Activity is relationship-aware.

Instead of:

```text
0x8a1... called 0x04...
```

prefer:

```text
Sent privately to @alice
25 USDC
Confirmed
```

Technical receipt can disclose:

```text
network
transaction hash
block
pool involvement
Prism contract involvement
public metadata
privacy property
```

when expanded.

---

# 44. Private Communication Experience

Do not overbuild a general messenger.

Start from valuable financial interactions:

```text
payment memo
payment request
claim invite
receipt
invoice
settlement note
```

Then allow plain encrypted messages around those interactions if the channel model supports it.

This makes the communication layer product-native.

---

# 45. RFP Alignment

Prism is not “implementing 12 RFPs.”

The 12 RFPs validate several reusable Prism primitives.

## Strongest overlap

### RFP-01 — Encrypted private messaging
Supports PrismChannel, payment memos, private negotiation.

### RFP-02 — Anonymous whistleblowing
Validates anonymous channel + proof-of-authorship / selective-disclosure research.

### RFP-05 — Private OTC
Validates external social discovery followed by private relationship and settlement.

### RFP-09 — Cross-chain privacy hub
Useful boundary and infrastructure reference; Prism must not collapse into a bridge product.

### RFP-10 — Privacy wallet
Validates shielded receive/balance UX but Prism remains broader than a privacy wallet.

### RFP-11 — Private payroll
Future human-identity-addressed payouts.

### RFP-12 — Private subscriptions
Future social identity → recurring private payment / entitlement.

## Additional idea alignment

`IDEA-09 — Payments by identifier, not address` is directly relevant to X / Telegram / email / phone resolution.

The key difference is that Prism makes the identifier resolve through a persistent user-controlled identity rather than making the identifier itself the identity.

---

# 46. Product Differentiation

Prism should not be described as:

```text
cross-chain wallet
social wallet
private wallet
address book
payment app
messenger
```

Those are surfaces.

The deeper primitive is:

> **Persistent, user-controlled digital authority that can be addressed through human identities and resolved into the correct native execution or private relationship capability.**

This produces:

```text
chainless identity
socially addressable payments
private receive
private relationships
native multi-chain execution
future delegation
future continuity
```

---

# 47. Continuity

Long-term, Prism is a continuity protocol.

A Prism ID may survive:

```text
wallet loss
account rotation
chain migration
social username changes
device replacement
incapacity
death
```

Future capabilities:

```text
guardians
successors
recovery
delayed transfer
beneficiary policies
delegated agents
bounded authorities
```

These are not sprint requirements.

The MVP must preserve architectural space for them.

---

# 48. Authentication vs Authority

Product authentication does not equal protocol authority.

```text
Google / email / passkey / device auth
≠
Starknet controller authority
≠
Base transaction authority
≠
STRK20 private wallet authority
≠
social principal verification
```

The UX may unify them into a coherent session.

The system model must keep them distinct.

---

# 49. Security Boundaries

Never commit or request:

```text
private keys
seed phrases
viewing keys
RPC secrets
OAuth client secrets
Telegram bot secrets
X application secrets
```

Use environment configuration.

Social OAuth tokens must be scoped minimally and protected.

Payment resolution must never trust a handle string without verified platform identity.

Rebinding a social principal is a high-risk operation.

---

# 50. Social-Principal Threat Model

Important threats:

```text
username reassignment
compromised social account
stale cached profile
OAuth token theft
binding replay
fake platform adapter
lookalike usernames
Unicode/confusable names
unauthorized rebind
public graph enumeration
```

Mitigations include:

```text
stable platform subject IDs
fresh verification
binding nonce
expiry
platform domain separation
canonical normalization
revocation
rate limits
reverification for sensitive changes
```

---

# 51. Privacy Threat Model

Separate:

```text
identity privacy
transaction privacy
relationship privacy
amount privacy
timing privacy
communication-content privacy
communication-metadata privacy
cross-chain linkage
social-linkage privacy
```

No feature may inherit privacy claims from another category automatically.

Example:

```text
private STRK20 transfer
does not imply
private Telegram ↔ Prism binding
```

---

# 52. Mainnet Evidence Strategy

G0:

```text
small real STRK20 pool action
→ proves live reachability
```

This may remain preparatory evidence.

Final sprint evidence, once Prism contracts are declared:

```text
≥3 SN_MAIN transactions
each:
  SUCCEEDED
  STRK20 pool event
  declared Prism contract involvement
```

Potential PrismClaim evidence set:

```text
Tx A — create/fund private claim
Tx B — claim
Tx C — refund or second genuine lifecycle action
```

Only use this if the contract genuinely satisfies STRK20 helper semantics and product truth.

---

# 53. Evidence Record

For each final transaction:

```yaml
evidence_id:
claim:
network: SN_MAIN
transaction_hash:
block:
execution_status:
pool_event:
prism_contracts_involved:
operation:
build_commit:
public_metadata:
privacy_claim_supported:
privacy_claim_not_made:
demo_step:
strk20_json_included:
```

A hash proves an execution fact.

It does not prove every privacy property.

---

# 54. Sprint Requirements

Final project must have:

```text
public repository
open-source license
public live demo
3-minute demo video
root strk20.json
≥3 qualifying SN_MAIN pool transactions
declared contract addresses where applicable
```

Judging:

```text
30% STRK20 integration depth
30% working mainnet product
25% innovation
15% documentation/open source
```

Prism should optimize for product-native evidence, not checklist theater.

---

# 55. MVP — Canonical Must Build

## Identity
- create Prism ID on Starknet;
- read identity;
- maintain identity independently of bindings.

## Base connection
- connect Base;
- prove account control;
- bind;
- resolve;
- revoke;
- reject replay / wrong signer.

## Social principal
- implement one real social provider first;
- use stable external subject ID;
- bind to Prism ID;
- resolve current handle;
- handle username changes safely.

Telegram is a strong initial candidate because the username/payment/channel story is direct and the platform identity model exposes a stable user subject.

## STRK20
- capability detection;
- real shield;
- real private balance;
- private transfer;
- mainnet evidence.

## PrismClaim
- architecture spike immediately;
- build if STRK20 compatibility and contract complexity remain favorable.

## Product
- Home;
- Connections;
- Send;
- Receive;
- Activity/receipt.

---

# 56. MVP — Strong Optional

- second social provider, likely X;
- PrismChannel payment memo;
- claim invitation delivery through Telegram;
- simple encrypted relationship thread;
- one private capital allocation action;
- Dust Recovery preview;
- payment request;
- QR resolution.

---

# 57. Deferred

Do not let these block the sprint:

```text
private Base
Solana execution
full messaging client
voice/video communication
custom PrismZK
private social-binding proof system
inheritance
guardians
full delegated agents
universal bridge
solver network
private subaccount dependency
all social platforms
all DeFi
production-grade generalized custody
```

---

# 58. Recommended Vertical Slices

## Slice A — Identity

```text
Create Prism ID
→ read it
→ persists
```

## Slice B — Base binding

```text
Connect Base
→ prove control
→ bind
→ resolve
→ revoke
→ Prism ID persists
```

## Slice C — Social identity

```text
Connect Telegram
→ verify subject
→ bind @handle
→ resolve @handle → Prism ID
→ rename handle
→ binding remains
```

## Slice D — Private money

```text
Connect Ready
→ capability check
→ shield
→ maturing
→ private balance
→ private send
```

## Slice E — Social private send

```text
enter @alice
→ resolve
→ private transfer
→ receipt
```

## Slice F — Claim

```text
enter unregistered @bob
→ create claim
→ invite
→ onboard
→ claim
```

## Slice G — Communication

```text
open PrismChannel
→ send payment memo
→ recipient decrypts
→ payment receipt binds to message
```

---

# 59. Demo Narrative

A powerful three-minute narrative:

```text
1. I have one Prism ID.

2. My Starknet and Base accounts are connected,
   but neither one is my identity.

3. My Telegram identity is connected too.

4. Someone sends money to @mytelegram,
   not to a wallet address.

5. Prism resolves me privately
   and the money lands in my STRK20 private balance.

6. The payment includes a private memo
   inside our Prism relationship.

7. I revoke my Base account.

8. My Prism ID, Telegram identity,
   private balance, and relationship remain.
```

If PrismClaim is ready:

```text
9. Send privately to someone who does not have Prism.
10. They onboard and claim it.
```

That demonstrates a coherent system rather than a bag of features.

---

# 60. Frontend Quality Standard

The interface must remain:

```text
premium
quiet
institutional-grade
human
globally comprehensible
```

Avoid:

```text
hackathon dashboard
chain-logo overload
neon gradients
protocol-first jargon
fake transactions
fake balances
chat-app imitation
AI-generated visual clutter
```

Visual hierarchy:

```text
Identity
→ total state
→ private state
→ actions
→ people / accounts
→ activity
→ evidence
```

---

# 61. Repository Operating Structure

```text
foundry/
  reusable reasoning system

profiles/
  Starknet / STRK20 constraints

projects/prism/
  canonical project truth
  decisions
  assumptions
  contradictions
  evidence
  audit

src/
  product implementation

contracts/
  Starknet/Cairo implementation

strk20.json
  sprint submission evidence
```

Precedence:

```text
Canonical Product Truth
→ Foundry rules
→ verified ecosystem profiles
→ Prism decisions
→ implementation
→ runtime evidence
```

The hackathon ecosystem may constrain implementation.

It may not redefine Prism's identity primitive.

---

# 62. Current Decision Set

Canonical:

```text
Starknet is Prism's identity root.
Prism ID is not a Starknet address.
Identity, controller, and execution identities are separate.
Base remains native execution.
Starknet + Base are enough for decisive cross-chain MVP proof.
STRK20 is Prism's first private financial surface.
Wallet API is the default consumer STRK20 route.
Privacy claims are observer/action-specific.
Shadow Accounts are not an MVP dependency.
Final sprint hashes must satisfy pool + own-contract validation.
First-party private routes are checked before custom Cairo.
Wallet capability detection follows least privilege.
Social usernames are aliases, not canonical identity keys.
Resolvable social identity does not imply public enumerability.
Communication keys are independent from financial/execution keys.
```

---

# 63. Product Evolution

Previous Prism framing:

```text
persistent identity
→ chain accounts
→ portfolio
→ send / receive
```

Current Prism framing:

```text
persistent identity
      │
      ├── chain accounts
      ├── social principals
      ├── financial state
      ├── private resolution
      ├── private claims
      └── private relationships
```

The product has not changed its core primitive.

It has revealed more consequences of that primitive.

---

# 64. Canonical Product Sentence

Use:

> **Prism gives you one persistent ID and one home for your accounts, money, social identities, private payments, and relationships across networks. Starknet anchors who you are; each chain still executes natively; STRK20 provides private financial state; and Prism resolves the right capability without forcing people to manage the underlying fragmentation.**

Shorter:

> **One Prism ID. One home across chains.**

Technical:

> **Prism separates persistent identity from venue-specific execution and external social identity, then connects them through verifiable, revocable, purpose-specific authority and resolution.**

---

# 65. Canonical “Home” Definition

When someone asks:

> “One home for what?”

Answer:

> **Your identity, accounts, money, social identities, private payments, relationships, and communication—across the networks where they actually live.**

Not everything is stored in one place.

Not everything uses one key.

Not everything is private.

But it all resolves through one persistent user-controlled identity.

That is Prism.

---

# 66. Immediate Build Priorities

Do not add more methodology before these produce evidence.

```text
1. G0 STRK20 mainnet reachability
2. wallet + privacy capability vertical slice
3. PrismIdentityRegistry
4. Base binding / resolve / revoke
5. Telegram ExternalPrincipal spike
6. private balance + transfer
7. PrismClaim architecture spike
8. choose Prism-owned STRK20 action
9. generate qualifying mainnet receipts
10. unify Home / Activity / Connections
11. add minimal PrismChannel payment memo if core is stable
12. demo + evidence hardening
```

Parallel rule:

> **No backend primitive without a visible UI state, and no UI state without a real implementation path shortly behind it.**

---

# 67. Release Truth

Prism is successful when a user can understand this without an architecture lecture:

```text
This is me.
These are my accounts.
These are the identities people know me by.
This is my money.
This part is private.
Send to me by my name.
Talk to me privately.
If I change wallets, I am still me.
```

And an auditor can independently understand:

```text
what state is canonical
who has authority
what each transaction proves
what each privacy mechanism hides
what remains visible
what can be revoked
what can be rotated
what evidence exists
```

Those two views must describe the same system.

---

# 68. Governing Principle

> **Prism is the persistent home. Networks are execution venues. Social apps are identity surfaces. STRK20 is private financial infrastructure. Authority and resolution connect them.**

And:

> **Research → Experiment → Build → Evidence.**

Build only what can become evidence before the deadline.
