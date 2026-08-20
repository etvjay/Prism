# Prism — Contradiction Register
## v0.1

Contradictions are surfaced rather than silently patched. Resolved contradictions remain recorded.

---

## CON-PRISM-001 — “One account” vs venue-native authorization

**A**  
Product experience should feel like one Prism Account.

**B**  
Base and Starknet require their own valid native transaction authorization.

**Severity:** Product/System

**Resolution**

```text
one Prism identity
many native execution identities
one coherent authorization experience
venue-native signatures underneath
```

**Status:** Resolved

---

## CON-PRISM-002 — Broad private-across-chains vision vs public Base execution

**A**  
Prism's long-term research direction includes private identity/authority relationships across venues.

**B**  
Ordinary Base transactions are public in the sprint MVP.

**Resolution**  
Claim only private Starknet financial state/actions through STRK20. Do not claim private Base execution.

**Status:** Resolved

---

## CON-PRISM-003 — Private account layer vision vs unshipped private subaccounts

**A**  
A future PrismZK design may privately bind multiple execution identities.

**B**  
Current STRK20 material states private subaccounts are not yet shipped / are coming soon.

**Resolution**  
Use public verified bindings in v0. Treat private binding as future research.

**Status:** Resolved

---

## CON-PRISM-004 — Dust Recovery vs Prism not being a bridge

**A**  
Prism may detect and recover fragmented balances.

**B**  
Cross-chain movement requires real bridge/intent/execution infrastructure.

**Resolution**  
Separate detection/preparation from execution. Never imply Prism itself moves cross-chain value without a real route.

**Status:** Resolved

---

## CON-PRISM-005 — Simple product UX vs chain-specific operational truth

**A**  
Users should not need to understand low-level chain mechanics.

**B**  
The product must not hide authorization, pending state, fees, public/private boundaries, or failure semantics.

**Resolution**  
Use progressive disclosure: outcome first, mechanism/evidence available on demand.

**Status:** Resolved

---

## CON-PRISM-006 — Product authentication vs wallet authority

**A**  
Prism may use email/passkey/social authentication for product access.

**B**  
STRK20 private actions and Base native actions require supported wallet/native authority.

**Temporary resolution**  
Authentication is explicitly distinct from execution authority.

**Required evidence**  
Complete one end-to-end authenticated session with real supported wallet execution.

**Status:** Open until integration proof

---

## CON-PRISM-007 — Mainnet-first evidence vs unfinished product

**A**  
Normal product development often builds abstractions before production deployment.

**B**  
The sprint explicitly requires qualifying SN_MAIN evidence and recommends proving pool access immediately.

**Resolution**  
Run a minimal real STRK20 mainnet smoke path early; product polish proceeds in parallel.

**Status:** Resolved
