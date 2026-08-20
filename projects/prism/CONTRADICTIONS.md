# Prism — Contradiction Register
## v0.2

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

## CON-PRISM-003 — Private account layer vision vs earlier “subaccounts unshipped” status

**A**  
A future PrismZK design may privately bind multiple execution identities.

**B (original evidence)**  
Sprint-facing STRK20 material described sub-accounts as coming soon.

**Later evidence**  
The Privacy SDK release candidates shipped the SDK-side mechanism and renamed it to **shadow accounts** in `0.14.3-RC.5`, while the currently referenced normal-dapp Wallet API route still does not expose it.

**Resolution**  
The original MVP scope remains correct for a different reason: Prism's consumer route is wallet-mediated, so the SDK-only mechanism is not a safe sprint dependency. Use public verified bindings in v0.

**Status:** Resolved / evidence updated

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

---

## CON-PRISM-008 — First-party private routes vs project-owned-contract evidence

**A**  
Current STRK20 guidance correctly recommends checking for a first-party private protocol path before writing a custom anonymizer. A maintained first-party route reduces implementation and audit surface.

**B**  
The current sprint hub validator requires every final transaction hash to involve one of the project's own declared contracts whenever `strk20.json.contracts` is non-empty.

**Resolution**

```text
Use first-party private routes when they best serve the product.
Treat hackathon evidence eligibility as a separate constraint.
Do not assume a first-party executor can satisfy Prism's own-contract evidence requirement.
```

For the sprint evidence path, Prism should own at least one meaningful pool-integrated helper if it declares contracts and wants contract-backed qualifying receipts.

**Status:** Resolved for sprint architecture

---

## CON-PRISM-009 — G0 shield transaction vs final evidence eligibility

**A**  
The safest Day-0 test is a small ordinary shield/deposit through the wallet.

**B**  
After Prism declares project contracts, an ordinary shield that never references Prism code will fail the hub's `mine` check for a final submission transaction.

**Resolution**  
Keep the initial shield as engineering/mainnet reachability evidence, but do not automatically put it in final `strk20.json.transactions`. Generate final hashes through the Prism-owned pool-integrated helper.

**Status:** Resolved

---

## CON-PRISM-010 — Privacy UX simplicity vs two-step deposits and note maturity

**A**  
Shielding should feel like one understandable product action.

**B**  
The underlying flow requires ERC-20 approval plus the pool deposit, and freshly created notes generally require ~10 blocks before later spending.

**Resolution**  
Present one user goal with truthful sub-states:

```text
Preparing allowance
→ Shielding
→ Private balance pending/maturing
→ Available privately
```

Do not collapse the protocol lifecycle into false immediate completion.

**Status:** Resolved at Experience boundary; implementation pending

---

## CON-PRISM-011 — Shadow-account MVP exclusion vs current WalletAccountV6 documentation

**A — Existing canonical constraint**

The repository's canonical decisions and STRK20 profile exclude shadow accounts from the sprint MVP because the referenced normal-dapp Wallet API route was not exposed.

**B (new upstream evidence)**
The current Starknet.js Next WalletAccount guide now documents a `shadow_account_invoke` STRK20 action and lists `WalletAccountV6` shadow-account methods. The local STRK20 freshness check also reports that the old `packages/sub_account_anonymizer` path is gone and a `packages/shadow_account_anonymizer` path is present.

**Temporary resolution**
Do not expand Prism's MVP during the wallet-capability slice. Continue with the canonical ordinary Wallet API route, re-verify the exact pinned `starknet@10.4.0` and wallet-standard package behavior, and treat shadow accounts as a separately scoped option until the current upstream API is tested against the repository pins and the product need is demonstrated.

**Required evidence**

```text
verify pinned-package type/runtime support;
verify Ready-wallet behavior;
compare the current WalletAccountV6 API with the repository's pinned versions;
reopen DEC-PRISM-015 only if shadow accounts materially strengthen the decisive Prism proof.
```

**Sources**

- https://starknet-js.com/docs/next/guides/account/walletAccount
- `.agents/skills/strk20-privacy-integration/scripts/check_freshness.py --quick`

**Status:** Open

---

## CON-PRISM-012 — Mainnet-first sprint evidence vs testnet-first product development

**A — Existing sprint decision**

DEC-PRISM-012 and CON-PRISM-007 prioritize an early SN_MAIN pool-reachability smoke path because final sprint evidence must be earned on mainnet.

**B — Current product direction**

The application should begin on Starknet Sepolia and move to mainnet only after the frontend, wallet boundary, contracts, failure states, and security checks have been exercised without production-value risk.

**Smallest valid resolution**

```text
default development/runtime environment = SN_SEPOLIA
mainnet configuration = explicit release gate
qualifying sprint evidence = still earned on SN_MAIN after testnet acceptance
```

Testnet reduces financial exposure but does not prove mainnet STRK20 pool behavior, fees, wallet support, proving behavior, or final validator eligibility. A later, explicitly approved mainnet smoke phase remains required.

**Status:** Resolved at environment boundary; mainnet evidence pending
