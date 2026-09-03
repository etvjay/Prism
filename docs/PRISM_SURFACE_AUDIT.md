# Prism Surface Audit

**Status:** Proposed product-surface map grounded in the current repository
**Scope:** Home, messaging/relationships, payments, identity, connections, activity, privacy, authority, and hidden system boundaries
**Evidence basis:** `src/features/**`, mounted Next routes, `README.md`, and `docs/PRISM_DOCUMENTATION_V0_3.md`

## Executive decision

Prism Home should not be a wallet dashboard and Prism messaging should not become a general chat app.

The product surface is one coherent relationship-and-authority workspace:

```text
Prism ID
  -> people and relationships
  -> purpose-specific destinations
  -> requests and messages
  -> approvals and execution
  -> receipts and reconciled activity
```

The user should experience one place where they can answer:

1. Who am I here?
2. Who am I dealing with?
3. What can I send, receive, or ask for?
4. What permission is required?
5. What is private, public, pending, or observed?
6. What actually happened?

Messaging belongs at the center of the relationship flow, not as an isolated chat destination.

## Current implementation reality

### Implemented or domain-ready

- Prism identity and controller model.
- Persistent Prism ID format and identity API routes.
- Execution-account bindings with visibility, lifecycle, status, public-exposure history, and revocation concepts.
- Provider-neutral alias resolution and continuity risk states.
- Base payment-request aggregate with viewed, approved, submitted, processing, confirmed, rejected, expired, reverted, cancelled, and unknown states.
- Base Sepolia claimable-gift lifecycle with funding, claim, expiry, and refund states.
- Private STRK20 state boundary with explicit wallet consent and provider-owned notes/viewing keys.
- Private transfer and shield/deposit test surfaces through the wallet/provider boundary.
- Durable operation and receipt lifecycle with reconciliation semantics.
- Pause / governed execution lifecycle: intent, verification, escalation, approval, release, cancellation, expiry, and settlement link.
- PrismChannel domain and service:
  - two Prism identity participants;
  - proposed -> accepted -> active -> archived/revoked lifecycle;
  - participant authorization;
  - separate communication-key commitments;
  - provider-owned encryption/decryption;
  - ciphertext-only storage;
  - encrypted payment, claim, and receipt references;
  - optional Starknet commitment anchoring boundary;
  - replay and key-reuse guards;
  - policy-controlled content types;
  - no implicit payment authority from a message.
- Thin SDK/MCP vocabulary for identity, resolution, portfolio, intent, Pause, operations, receipts, and testnet-only channel stubs.

### Mounted frontend reality

The current frontend visibly provides:

- Landing narrative.
- Preview Home shell.
- Home / Activity / Connections / Profile tab structure.
- Wallet connection and capability state.
- Core STRK20 shield/private-transfer test surface.
- Optional isolated Vesu/M5 test surface.
- Truthful empty states for Activity, Connections, and Profile.

The frontend does **not** yet provide a real:

- relationship list;
- channel inbox;
- channel creation/acceptance flow;
- encrypted message composer or decrypt/read view;
- payment request card inside a channel;
- claim invitation card;
- receipt card linked to a relationship;
- identity/address resolution composer;
- approval inbox or Pause decision view;
- connected portfolio view;
- binding/connection management view;
- profile/identity management view.

The channel domain exists, but the user-facing messaging plane is not yet integrated into the product shell.

## The correct information architecture

```text
Home
  identity summary
  what needs attention
  quick actions
  recent relationship activity

Activity
  all requests, actions, operations, receipts, and state transitions
  filters by relationship, type, venue, privacy, and status

Connections
  accounts, social principals, channels, applications, devices, authorities
  binding visibility, lifecycle, status, and revocation

Profile
  Prism ID, controller, disclosure policies, privacy preferences,
  communication-key/device recovery posture, and session controls

Relationship detail / messaging plane
  one relationship thread with identity context,
  structured financial objects, approvals, and receipts
```

Do not add `Chat` as a top-level nav item yet. A relationship entry point can be reached from Home, Activity, or Connections. A full inbox can become a later sub-surface once real channels are integrated and proven.

## Home: what should be surfaced

Home is the operational center, not a marketing explanation and not a raw portfolio screen.

### Primary band: identity context

Surface:

- Prism ID, when observed.
- Canonical root: Starknet.
- Current controller/session status.
- Connected wallet/provider and network, only when observed.
- One compact statement: `Your accounts stay native. Your identity stays coherent.`
- A clear state label: unconnected, connected, stale, blocked, or unknown.

Do not surface:

- fabricated identity existence;
- a wallet address as the Prism ID;
- an inferred social identity;
- a completed binding without proof and readback.

### Attention band: what requires the user's next decision

This should be the most useful Home block.

Surface only items that have an actual state:

- channel invitation awaiting acceptance;
- payment request awaiting review;
- claim invitation awaiting onboarding/claim;
- governed action awaiting verification or approval;
- wallet consent required for private balance/state;
- operation submitted but not reconciled;
- stale or revoked destination requiring attention;
- failed/rejected/expired item with a safe next step.

Every item needs:

```text
what it is
who it concerns
what decision is needed
what happens next
what has not happened yet
```

### Quick actions

Keep the verbs simple:

- **Send** - start a payment or private transfer.
- **Receive** - create/share a destination or payment request.
- **Ask for approval** - create a governed request before action.
- **Connect** - add an account, social principal, application, device, or relationship.

These are actions, not navigation destinations.

### Recent relationship activity

Show a short, relationship-aware list:

- `Payment request from Sam`
- `Private transfer to Alice - awaiting receipt`
- `Channel invitation from Bob`
- `Approval needed for treasury action`
- `Base account binding revoked`
- `Claim invitation expires in 2 days`

Do not show low-level calldata, selectors, class hashes, raw provider payloads, or an operation as completed merely because submission occurred.

### Private state

Surface the state machine, not fake numbers:

```text
Private balance
  Consent required
  Available after wallet readback
  Observed at <time> / source <provider> / freshness <state>
```

If a real consented balance is available, show the amount and freshness. If not, show the reason it is unavailable. Never expose notes, viewing keys, proofs, or provider-private material.

## Messaging plane: what it is

PrismChannel is a private relationship channel between two Prism identities. It is not a public social feed and not a general-purpose messenger.

The relationship is primary. Financial and authority objects are embedded in the relationship.

```text
Alice
  identity context + verified routes
  encrypted conversation
  payment request
  claim invitation
  approval request
  receipt
```

### Messaging plane entry points

The user should be able to enter a relationship from:

- Connections: open an active relationship.
- Home: open an invitation or pending request.
- Activity: open the related conversation from an event.
- Send/Receive: select an existing relationship or create a new one after resolution.

Do not expose an empty chat inbox as the first product experience. If there are no relationships, explain the next useful action: `Connect with someone` or `Send to a Prism ID or verified identity`.

### Relationship header

Every channel view should show:

- counterparty display identity, only at the disclosure level permitted;
- Prism ID status, if disclosed/observed;
- verified external principals such as Telegram/X, only when explicitly associated;
- channel status: invitation, active, archived, or revoked;
- privacy state: encrypted relationship;
- available capabilities: message, request payment, send, receive, approval, claim;
- a compact `Why can I trust this?` disclosure showing verification and freshness without exposing secrets.

Do not show a wallet address as the relationship identity by default.

### Channel lifecycle surface

Represent the real lifecycle in plain language:

```text
Invitation sent
Waiting for acceptance
Active
Archived
Revoked
```

Only `Active` permits new messages in the current domain implementation. Archived/revoked channels may retain readable history according to participant authorization, but cannot accept new messages.

### Message/object types to expose first

The domain currently permits:

- encrypted message;
- payment memo;
- payment request;
- claim invitation;
- invoice;
- settlement proposal;
- authorization request;
- receipt;
- future delegation request;
- future recovery request.

The first product surface should expose only the valuable, product-native subset:

1. Payment request
2. Claim invitation
3. Approval request
4. Receipt
5. Payment memo
6. Plain encrypted message around those objects

Invoice and settlement proposal can reuse the same structured-object card pattern later. Delegation and recovery remain future capability types until their authority UX is ready.

### Structured object card anatomy

Every object in a relationship should answer:

- What is this?
- Who initiated it?
- What does it ask me to do?
- What amount/asset/venue is involved, if applicable?
- Is it public or private?
- What permission is needed?
- What is the expiry?
- What state is it in?
- What evidence exists?
- What is the safe next action?

Example payment request card:

```text
Payment request
From: Alice
Amount: 25 USDC
Route: private on Starknet / public Base route if selected
Expires: in 2 days
Status: awaiting your review

[Review] [Reject]
```

The exact privacy/route language must come from observed capability and policy. Do not promise private settlement when only a public Base payment route is configured.

### Message composer

The composer should not be an unbounded social-chat box initially. Use a simple mode switch:

```text
Message | Request payment | Send | Ask for approval
```

The underlying channel service must:

- accept plaintext only at the participant encryption boundary;
- encrypt through the participant-owned provider;
- persist ciphertext and opaque references only;
- authenticate channel/message/participant commitments;
- reject malformed or plaintext-like ciphertext;
- prevent duplicate message IDs and replay;
- prevent non-participants from reading or sending;
- prevent authorization messages from granting payment authority.

The UI must never request or display communication private keys, STRK20 viewing keys, proofs, private notes, or raw ciphertext as if it were human-readable content.

### Approval request inside messaging

An approval request is a coordination object, not a payment and not a command.

Surface:

- requested action in human terms;
- initiator: user, agent, or service;
- recipient and resolved route;
- asset and amount;
- policy version / verification status in an expandable detail view;
- reason the action is paused;
- required approver count;
- expiry;
- buttons: `Approve`, `Reject`, `Ask for more information`, or `Keep paused`, according to actual state.

Never make an `authorization_request` message itself execute anything. Explicit approval and the separate wallet boundary remain mandatory.

## Send: what it should do

The Send flow should be a recipient-resolution flow, not an address form.

```text
Send
  -> enter Prism ID, verified alias, claim recipient, or advanced address
  -> resolve for purpose = payment
  -> show identity, route, freshness, and risks
  -> choose public/private route when genuinely available
  -> create payment/action request
  -> apply Pause/approval policy
  -> wallet authorization
  -> observe transaction
  -> reconcile receipt
  -> attach receipt to relationship and Activity
```

Plain-language states:

- `Who should receive this?`
- `Checking the recipient`
- `Recipient verified`
- `Destination changed - review required`
- `Approval required`
- `Wallet approval required`
- `Submitted - waiting for receipt`
- `Confirmed`
- `Could not confirm - do not retry blindly`

The resolver already models active, revoked, changed, stale, unavailable, unknown, and not-found conditions. Those risks must be visible before a send is allowed.

## Receive: what it should do

Receive is a controlled destination/request creation flow:

```text
Receive
  -> choose how to be addressed
  -> choose destination/venue and privacy policy
  -> create shareable identifier, request, or claim path
  -> share with the payer
  -> observe funding/receipt
```

Potential identity choices:

- Prism ID;
- verified social identity;
- payment request;
- QR/deep link;
- claim invitation for an unregistered person.

Do not equate a shareable identifier with a public wallet address.

The current Base payment/claim models support explicit request and claim lifecycles, including expiry and sender refund paths. Those should become structured Receive outcomes once a real frontend route is built.

## Activity: what should be surfaced

Activity is the evidence ledger for the user, not a chain explorer clone.

### Default rows

- relationship-aware title;
- object type;
- counterparty at permitted disclosure level;
- amount/asset only when the policy permits it;
- venue/network;
- plain-language state;
- last observed time;
- next safe action.

### Expandable technical details

Only on request:

- transaction hash;
- operation ID;
- block number;
- receipt status;
- pool involvement;
- declared Prism contract involvement;
- source and freshness;
- public metadata;
- privacy property actually evidenced.

The operation model explicitly distinguishes submitted, processing, confirming, indexed, reconciled, and completed. The UI must preserve that distinction.

## Connections: what should be surfaced

Connections is the trust and routing surface.

Group connections by role:

```text
Identity
  Prism ID / controller

Execution
  Starknet account
  Base account

Discovery
  Telegram
  X
  future email/phone

Communication
  active PrismChannel
  communication device/key commitment

Authority
  applications
  agents
  guardians / future
```

Each row should show:

- what the connection is for;
- verified, pending, revoked, or re-verification required;
- public/private/selective visibility, where supported;
- freshness and source;
- expiry, if any;
- revoke, rotate, or review action.

Important current limitation: the durable v0 binding store supports persistent PUBLIC/PRIVATE bindings. SELECTIVE/session/ephemeral states are domain concepts but deferred at the current REST boundary. The UI must not offer unsupported disclosure modes as if they work.

## Profile: what should be surfaced

Profile is control over the Prism identity, not a social profile page.

Surface:

- Prism ID and canonical Starknet root;
- controller/session state;
- connected accounts and bindings summary;
- disclosure policies and their purposes;
- communication-device/recovery status without exposing keys;
- wallet/provider sessions;
- privacy permissions and consent history;
- revoke/disconnect controls;
- exportable public identity material only, never secret material.

Do not surface:

- private keys;
- viewing keys;
- seed phrases;
- raw proofs;
- private notes;
- provider session tokens;
- credential-bearing URLs.

## What must remain hidden or secondary

Never surface in primary UX:

- felt252/calldata/class hashes/raw invoke versions;
- raw provider payloads or stack traces;
- ciphertext as readable message content;
- communication-key commitments as human identity;
- STRK20 viewing keys or note IDs;
- shadow-account internals;
- Vesu/M5 helper details in the core Prism Home;
- LayerZero/Hyperlane internals unless a technical evidence view is explicitly opened;
- a submitted transaction as confirmed;
- a local test result as live evidence;
- a predicted deployment as a deployed address;
- a stale or unknown resolution as a usable destination.

## Truth-state vocabulary

All surfaces should use one shared state vocabulary:

```text
Not connected
Awaiting wallet
Consent required
Checking
Verified
Pending
Needs approval
Submitted
Processing
Receipt observed
Reconciled
Confirmed
Rejected
Expired
Revoked
Stale
Unavailable
Unknown
```

Avoid vague green success states. A green indicator means the specific fact is observed, not that the whole product is live.

## Priority sequence

### P0: make the existing shell truthful and useful

1. Keep Home as the operational center.
2. Replace empty action language with Send / Receive / Ask for approval / Connect.
3. Add an `Attention` block driven by real state objects.
4. Make Activity distinguish pending, receipt observed, reconciled, and confirmed.
5. Make Connections show actual binding/session state, not generic empty copy.
6. Keep private state consent-gated and provider-owned.

### P1: integrate the relationship/messaging plane

1. Add a relationship list to Home or Connections.
2. Add channel invitation and acceptance.
3. Add relationship detail view.
4. Add encrypted message composer through the participant-owned encryption provider.
5. Add structured payment-request, claim-invitation, approval, and receipt cards.
6. Link every object to Activity and preserve the same lifecycle state.
7. Add explicit no-implicit-authority copy and controls.

### P2: deepen purpose-specific flows

1. Recipient resolution by Prism ID and verified aliases.
2. Registered private receive route.
3. Unregistered PrismClaim flow.
4. Connected portfolio with explicit branch, freshness, coverage, and consent indicators.
5. Disclosure-policy management.
6. Device/key recovery and communication-channel continuity.
7. Agent/delegation/recovery requests only after authority UX is mature.

## Scope guard

Do not branch into:

- a generic social messenger;
- public social feed mechanics;
- lending or Vesu as a core Home module;
- a bridge/solver interface;
- arbitrary DeFi protocol galleries;
- direct prover/indexer controls;
- custom private-key or viewing-key management;
- unsupported SELECTIVE/session/ephemeral binding UX;
- a separate Chat top-level nav before relationship workflows are proven.

## Acceptance test for the surface

A new user should be able to understand, without protocol jargon:

```text
This is my Prism identity.
These are the people and accounts connected to it.
This is what needs my attention.
I can send, receive, or ask for approval.
My private state is only shown after consent.
Messages are private relationship context, not automatic authority.
Activity shows what was actually observed.
```

If the interface cannot answer those questions, it is surfacing infrastructure rather than Prism.
