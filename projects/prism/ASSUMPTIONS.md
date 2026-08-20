# Prism — Assumption Register
## v0.1

An assumption is not a fact. Each item should eventually become verified, rejected, or irrelevant.

---

## ASM-PRISM-001 — Starknet registry is sufficient to make the identity primitive legible

**Statement**  
A minimal onchain Prism identity registry plus proof-of-control binding, resolution, and revocation is sufficient to demonstrate that Prism is materially more than a name-to-address record.

**Risk:** High  
**Affected:** Product differentiation, demo

**Validation**

```text
create P
bind B1
resolve B1
revoke B1
resolve fails
P remains
bind B2
```

**Status:** Open

---

## ASM-PRISM-002 — Wallet API supports the required Prism private user flow

**Statement**  
The current Privacy Wallet API path can support Prism's shield/private-transfer/private-balance workflow without Prism directly handling viewing keys.

**Risk:** Critical  
**Validation:** Mainnet smoke test and wallet integration spike  
**Status:** Open

---

## ASM-PRISM-003 — Embedded/app authentication can coexist with privacy-wallet execution

**Statement**  
Prism can separate product authentication from the supported Starknet privacy-wallet action flow without confusing authority or degrading UX.

**Risk:** High

**Validation:** Implement one authenticated Prism session that requests a real wallet-mediated STRK20 action.

**Status:** Open

---

## ASM-PRISM-004 — A meaningful anonymizer action is feasible within sprint scope

**Statement**  
Prism can deploy and use a non-trivial `privacy_invoke` helper on mainnet before deadline.

**Risk:** Critical

**Validation:** Implement the smallest useful action early and test on SN_MAIN.

**Status:** Open

---

## ASM-PRISM-005 — Base proof-of-control can be safely verified offchain then canonically accepted on Starknet

**Statement**  
A signed Base challenge can prove account control strongly enough for v0 binding.

**Risk:** High

**Validation**
- valid owner binds;
- unrelated signer cannot bind;
- replayed/expired challenge fails;
- accepted binding becomes canonical only after Starknet state transition.

**Status:** Open

---

## ASM-PRISM-006 — Starknet + Base is enough to communicate chainless identity

**Statement**  
Two execution venues are sufficient for judges/users to understand that Prism identity is persistent above venue accounts.

**Risk:** Medium  
**Validation:** user/demo comprehension test  
**Status:** Open

---

## ASM-PRISM-007 — Real portfolio reads can remain simple enough for the sprint

**Statement**  
Direct or lightweight provider reads for Starknet and Base balances are sufficient for MVP; broad indexing is unnecessary.

**Risk:** Medium

**Validation:** compare UI values with independent RPC/explorer reads.

**Status:** Open

---

## ASM-PRISM-008 — STRK20 private balance can be represented reliably after refresh/reconnect

**Statement**  
The supported wallet/discovery path yields stable enough private-balance state for a product Home surface.

**Risk:** High

**Validation**

```text
shield
→ discover
→ refresh/reconnect
→ balance reconstructed correctly
```

**Status:** Open

---

## ASM-PRISM-009 — Dust Recovery is valuable but non-essential

**Statement**  
Showing economically viable recoverable balances increases product value but is not necessary to prove the core Prism primitive.

**Risk:** Low  
**Status:** Accepted as optional until core passes.
