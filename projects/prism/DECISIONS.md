# Prism — Decision Ledger
## v0.2

Decisions are append-only records. Superseding a decision creates a new record; history is not rewritten.

---

## DEC-PRISM-001 — Starknet is the canonical identity root

**Layer:** Product/System  
**Status:** Canonical

**Decision**  
Prism identity and continuity state are canonically anchored on Starknet for v0.

**Why**
- gives Prism a single verifiable identity root;
- makes Starknet structurally important rather than decorative;
- aligns the identity root with STRK20's private financial surface.

**Rejected alternatives**
- backend-only identity registry;
- Base as canonical root;
- MPC/universal-signing account as the product primitive.

**Consequences**
- Prism identity contract is economically/semantically important;
- backend mirrors/indexes state but does not become canonical authority.

**Reopen if**
- Starknet cannot provide required persistence/authority semantics;
- verified ecosystem constraints make the model infeasible.

---

## DEC-PRISM-002 — Prism ID is not a Starknet address

**Layer:** Product  
**Status:** Canonical

**Decision**  
`PrismID != Starknet account address`.

**Why**  
The product primitive is persistent identity above replaceable execution identities.

**Consequence**  
Controller/account rotation must not require replacing the Prism ID.

---

## DEC-PRISM-003 — Identity, controller, and execution identity remain separate concepts

**Layer:** Product/System  
**Status:** Canonical

```text
identity ≠ controller ≠ execution account
```

This separation permits future rotation, delegation, recovery, and continuity without changing the core identifier.

---

## DEC-PRISM-004 — External chains remain native execution venues

**Layer:** Product/System  
**Status:** Canonical

Base actions require Base-valid authorization/signatures. Prism coordinates identity and destination resolution; it does not pretend Starknet authorization is automatically valid on EVM.

**Rejected alternative:** universal backend/MPC signer controlling every venue as an MVP foundation.

---

## DEC-PRISM-005 — MVP venues are Starknet + Base

**Layer:** Product/Scope  
**Status:** Canonical for sprint MVP

Two venues are sufficient to prove persistent cross-venue identity. A third chain adds implementation surface without materially strengthening the decisive proof.

**Deferred:** Solana and other venues.

---

## DEC-PRISM-006 — STRK20 is the first private financial surface, not the definition of Prism

**Layer:** Product/Privacy  
**Status:** Canonical

STRK20 provides real private Starknet financial state and private application execution for Prism v0.

Ordinary Base activity remains public unless a separate privacy mechanism is integrated.

---

## DEC-PRISM-007 — Use Privacy Wallet API first for normal dapp flows

**Layer:** System/Mechanism  
**Status:** Accepted

Prefer current Wallet API / `WalletAccountV6` integration for user-mediated STRK20 actions; use Privacy SDK only when Prism deliberately needs direct key/note management.

**Reopen if:** the required Prism workflow cannot be expressed through the supported wallet path.

---

## DEC-PRISM-008 — Meaningful private application action must use a real anonymizer/helper path

**Layer:** System/Hackathon  
**Status:** Accepted

Do not count a starter echo/no-op helper as sufficient integration depth. Prism should route at least one meaningful application action through the supported `privacy_invoke` mechanism.

---

## DEC-PRISM-009 — No private sub-account dependency in MVP

**Layer:** System/Scope  
**Status:** Superseded by DEC-PRISM-015

At the time of this decision, current sprint-facing material described private subaccounts as not yet shipped / coming soon. The scope conclusion remains correct, but later SDK evidence makes the mechanism status more precise.

---

## DEC-PRISM-010 — Prism is not a bridge or solver network

**Layer:** Product  
**Status:** Canonical

Cross-chain value movement requires a real execution provider/bridge/intent route. Prism may integrate such systems later but does not build its own solver network for the sprint.

---

## DEC-PRISM-011 — Frontend and backend are built as vertical slices

**Layer:** Delivery  
**Status:** Accepted

> No backend primitive without a visible UI state, and no UI state without a real implementation path shortly behind it.

The hackathon requires both protocol proof and product proof.

---

## DEC-PRISM-012 — Mainnet-first STRK20 evidence

**Layer:** Delivery/Evidence  
**Status:** Accepted

Prove STRK20 mainnet reachability before deepening private-feature implementation.

---

## DEC-PRISM-013 — Privacy claims are observer- and action-specific

**Layer:** Product/Experience/Security  
**Status:** Canonical

No blanket statement such as "all Prism transactions are private" is allowed.

Authority: `profiles/STRK20_PRIVACY_PROFILE.md` plus runtime evidence.

---

## DEC-PRISM-014 — Foundry → Profile → Project separation

**Layer:** Methodology  
**Status:** Canonical

```text
Foundry = reusable reasoning method
Profile = verified ecosystem constraints
Project = Prism-specific truth and implementation
```

Profiles constrain but do not redefine upstream Product truth.

---

## DEC-PRISM-015 — Shadow accounts exist SDK-side but remain outside sprint MVP

**Layer:** System/Scope  
**Status:** Canonical for v0  
**Supersedes:** DEC-PRISM-009 mechanism-status wording

**Decision**  
Do not depend on STRK20 shadow accounts for the Prism sprint MVP.

**Current evidence**
- Sprint-facing Build/Ideas material still presents the normal builder-facing sub-account concept as coming soon.
- The Privacy SDK changelog shows the SDK-side API shipped in release-candidate form and was renamed from sub-accounts to **shadow accounts** in `0.14.3-RC.5`.
- The currently referenced Wallet API route for a normal user-controlled dapp does not expose the same capability.

**Reason**  
Prism's default route is wallet-mediated. A lower-level SDK capability that requires a different authority/key model is not sufficient reason to make the feature sprint-critical.

**Consequence**  
Use explicit verified bindings for the decisive MVP. Revisit shadow accounts after the core identity/binding/resolution proof is complete or when the wallet-facing route ships.

---

## DEC-PRISM-016 — Final sprint hashes must satisfy the hub's own-contract rule

**Layer:** Evidence/Hackathon  
**Status:** Canonical for sprint

**Decision**  
If Prism lists any deployed addresses in `strk20.json.contracts`, every transaction selected for `strk20.json.transactions` must both:

```text
1. succeed and touch the STRK20 pool
2. involve at least one declared Prism contract
```

Current upstream validation detects project involvement through a declared contract's receipt event or the declared address appearing in transaction calldata.

**Consequence**  
A plain preparatory shield/private transfer that never references Prism code is valid engineering evidence but is not a final submission candidate after contracts are declared.

**Implementation effect**  
Design a meaningful Prism-owned pool-integrated helper/anonymizer early enough to generate at least three genuine qualifying transactions through it.

---

## DEC-PRISM-017 — Check first-party private routes before writing an anonymizer

**Layer:** System/Delivery  
**Status:** Accepted

**Decision**  
Before implementing custom Cairo for an existing protocol action, verify whether the protocol already ships a maintained STRK20/private route.

**Reason**  
A first-party route can remove unnecessary contract, audit, deployment, and maintenance surface.

**Constraint**  
The sprint's own-contract evidence requirement is evaluated separately. A first-party integration is not automatically a valid final evidence strategy if Prism also declares project contracts.

---

## DEC-PRISM-018 — STRK20 capability detection follows least privilege

**Layer:** Interface/Privacy  
**Status:** Canonical

Use Wallet API/spec capability-version checks for feature detection. Do not invoke balance-reading methods merely to discover whether a wallet supports STRK20.

Balance reads are requested only when Prism intentionally presents the user's private balance and the resulting wallet consent is part of the designed flow.
