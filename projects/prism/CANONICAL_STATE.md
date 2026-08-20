# Prism — Canonical State
## Project Control Plane v0.1

**Status:** Canonical product/system handoff baseline  
**Date:** 2026-08-20  
**Repository:** `etvjay/Prism`  
**Sprint:** STRK20 Private Sprint

---

# 1. Canonical Product Definition

> **Prism is a Starknet-native identity and financial coordination protocol that gives a user one persistent Prism ID across multiple chain-specific execution accounts. Starknet anchors identity and continuity state; connected chains remain native execution venues; STRK20 provides Prism's first private financial state and private Starknet execution surface.**

Primary product line:

> **One Prism ID. One home across chains.**

Technical line:

> **Persistent identity on Starknet. Native execution everywhere else.**

Privacy rule:

> **Private where the underlying system can prove privacy; never by marketing fiction.**

---

# 2. Primary User

A person managing assets and activity across multiple blockchain venues who currently has to reason in terms of disconnected addresses, wallets, balances, and chain-specific actions.

---

# 3. Painful Moment

The user wants to receive, send, manage, or reason about their financial identity across chains but must manually decide:

- which address represents them;
- which account is current;
- which chain holds which assets;
- which account a counterparty should use;
- what happens after key/account rotation;
- which actions are actually private.

The fragmentation is both cognitive and operational.

---

# 4. Desired Outcome

The user experiences one persistent financial home while the system preserves native chain authority and accurately represents privacy, execution, and settlement boundaries.

---

# 5. Core Primitive

## `PrismIdentity`

A persistent Prism ID exists independently of any one execution address.

```text
Prism identity = persistent
Execution identities = replaceable
Native signatures = venue-specific
```

Canonical invariant:

> **Identity is persistent. Execution is venue-specific. Authority connects them.**

---

# 6. Canonical Root

**Starknet owns canonical Prism identity state.**

Starknet is not merely a sponsor integration or optional adapter in the sprint architecture. It is the canonical identity/verifiability root for Prism v0.

---

# 7. Execution Model

External chains remain native execution venues.

For v0:

```text
Starknet = identity root + private financial surface
Base     = external execution-identity proof
```

A Starknet signature does not become a Base transaction signature.

A Prism ID does not eliminate native chain validation.

---

# 8. Privacy Model

STRK20 provides Prism's first real private financial environment.

Current allowed model:

```text
Prism identity coordination
+
STRK20 private Starknet state/actions
+
ordinary public Base execution
```

Do not claim all-chain privacy.

Specific privacy semantics are constrained by `profiles/STRK20_PRIVACY_PROFILE.md`.

---

# 9. Canonical Domain Objects

Current minimum objects:

```text
PrismIdentity
ExecutionIdentity
Binding
Resolution
Portfolio
PrivateBalance
Operation
Receipt
```

Future objects such as Guardian, Successor, Delegation, or AgentAuthority are not MVP requirements.

---

# 10. Decisive Product Proof

```text
Create Prism ID P on Starknet
→ prove control of Base account B
→ bind B to P
→ resolve(P, BASE) = B
→ revoke B
→ resolve(P, BASE) = NO_ACTIVE_DESTINATION
→ P still exists
```

This is the smallest proof that Prism is not merely a name-to-address record.

The sprint adds a second decisive proof:

```text
Prism private balance
→ real STRK20 mainnet action
→ independently verifiable receipt
```

---

# 11. MVP Scope

## Must build

### Identity
- create Prism ID on Starknet;
- read Prism identity state.

### Connections
- connect Base;
- prove Base account control;
- bind Base account;
- revoke Base binding.

### Resolution
- resolve Prism ID to active Base destination;
- reject revoked bindings.

### Portfolio
- real Starknet balance;
- real Base balance;
- selected positions only if reliable.

### STRK20
- real private/shielded balance;
- at least one real shield/private transfer path;
- meaningful Prism private application action through supported STRK20 flow;
- qualifying mainnet evidence.

### Product
- Home;
- Connections;
- Send;
- Receive;
- Activity/receipt.

---

# 12. Explicit Non-Goals for v0

Do not build as sprint requirements:

- solver network;
- universal bridge;
- custom PrismZK proof system;
- private Base execution;
- live Solana integration;
- inheritance engine;
- guardian system;
- autonomous agent wallet;
- universal balance abstraction;
- all-token/all-DeFi portfolio indexing.

---

# 13. Product / Protocol / Research Naming

```text
Prism        = product + protocol
PrismZK      = future privacy/proof architecture
PrismFlashZK = prior experimental predecessor/evidence
```

Canonical sentence:

> **Prism is the system. PrismZK is how Prism can prove things privately. PrismFlashZK was an experiment that tested an earlier version of those ideas.**

PrismFlashZK implementation choices are not automatically inherited by Prism.

---

# 14. Frontend Canon

Primary navigation:

```text
Home
Activity
Connections
Profile
```

Send and Receive are actions, not primary navigation destinations.

Visual hierarchy:

```text
Prism identity
→ total financial state
→ private state
→ Send / Receive
→ connected accounts
→ positions
→ recoverable value where supported
```

The frontend must communicate "my financial home" before it communicates architecture.

---

# 15. Foundry Precedence

For Prism:

```text
Canonical Product Truth
        ↓
Generic Foundry rules
        ↓
Verified Starknet / STRK20 profiles
        ↓
Prism project decisions
        ↓
Implementation
        ↓
Runtime evidence
```

A profile may constrain implementation but cannot redefine Product truth.

---

# 16. Current Implementation Status

As of this version:

- public `etvjay/Prism` repository exists;
- sprint registration PR exists upstream;
- `strk20.json` exists at repository root;
- Next.js / React / Starknet wallet dependencies are scaffolded;
- Starknet / STRK20 ecosystem profiles exist;
- no Prism identity contract is yet evidenced as deployed;
- no Base binding flow is yet evidenced;
- no qualifying STRK20 mainnet transaction is yet recorded in `strk20.json`.

Implementation truth must be updated through `EVIDENCE_LEDGER.md` rather than inferred from planned architecture.

---

# 17. Next Evidence-Producing Step

**Gate G0: prove STRK20 mainnet reachability with a low-value real pool interaction, then record the receipt.**

In parallel, implement the smallest Prism identity contract/test path:

```text
create identity
→ read identity
→ bind
→ revoke
```

---

**Canonical rule:** Identity persists; venue accounts change; authority and privacy must remain explicit.
