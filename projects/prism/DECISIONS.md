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

---

## DEC-PRISM-SYS-001 — Cross-chain proof acceptance trust model (Option A)

**Layer:** System
**Status:** Accepted (owner: Jason, 2026-08-23)
**Decision ID:** DEC-PRISM-SYS-001
**Selected option:** Option A

**Decision**
The backend verifies the Base ownership proof via the ladder EOA ecrecover → EIP-1271 isValidSignature → ERC-6492 unwrap. The user's Starknet controller signs the binding transaction. The Starknet registry enforces `caller == identity.controller`, consumes the proof digest exactly once onchain, and makes the binding canonical only at the Starknet state transition. The registry does NOT re-verify Base signatures onchain.

Base remains native/public execution; STRK20 privacy remains a separate Starknet wallet-mediated surface and is untouched by this decision.

**Rationale**
Keeps authority with keys the user controls; consistent with DEC-PRISM-001 (Starknet canonical identity root) and DEC-PRISM-004 (venue-native authorization); avoids heavy on-Starknet EVM signature verification, which is out of sprint scope. The binding is a Starknet state fact; a verified proof alone confers zero canonical effect (VERIFIED ≠ ACTIVE).

**Consequences**
- The backend is a TRUSTED VERIFIER for proof validity only (never for identity state). This is stated plainly and must never be marketed as trustless.
- Registry authorization model: bind/revoke caller MUST be the identity controller.
- Onchain replay protection: consumed-proof-digest map inside the registry; digest single-use forever.
- Canonicality attaches exclusively at the Starknet state transition.
- Changing this later is HIGH cost: it reworks registry authorization, replay protection, and the error catalogue.

**Rejected alternatives**
- On-Starknet verification of Base signatures: heavy, high sprint risk.
- Light-client / attestation route: out of scope.

**Reopen conditions**
- A supported wallet path cannot express controller-signed binding; or
- Evidence shows backend-verifier trust breaks a protected invariant (INV-PRISM-* / INV-SYS-*).

Superseding this decision requires a new append-only record; history is not rewritten.

---

## DEC-PRISM-SYS-003 — ChainId-v2 challenge hardening (SD-008)

**Layer:** System/Security  
**Status:** Accepted  
**Decision ID:** DEC-PRISM-SYS-003  
**Decided by:** Jason  
**Decided at:** 2026-08-23T18:27:26Z  
**Selected option:** Option 1 — ACCEPT

**Decision**  
Accept the chainId-v2 challenge hardening implemented by `e8886af` as a mandatory pre-deployment security gate. The Base `chain_id` is the first ordered field in the schema-v2 challenge envelope and signable message. The expected chain ID is environment-scoped and must be supplied by the accepted target-network manifest; there is no silent global fallback.

**Companion work accepted**
- amend SD-005 and its YAML companion to include `chain_id`;
- amend INV-SYS-011 tamper-evidence fields;
- update OBJ-PRISM-005 persisted fields;
- regenerate schema-v2 signing fixtures;
- retain cross-network mismatch coverage (`ERR-003`/`ERR-012`);
- invalidate legacy schema-v1 persisted challenges rather than reinterpret them.

**Rationale**  
Without chain binding, a proof minted for Base Sepolia could be replayed against a Base-mainnet-era bind if the backend or controller were compromised. The red-team assessment identifies this as a mandatory gate before the first multi-environment deployment.

**Evidence boundary**  
Acceptance is a local X2 security/spec decision. It is not live deployment, runtime, testnet, or mainnet evidence.

**Reopen conditions**  
Reopen if environment-scoped chain configuration cannot be enforced, if live fixtures reveal an incompatibility, or if a new trust-model decision supersedes Option A.

---

## DEC-PRISM-OPS-001 — Target-network acceptance for testnet closeout

**Layer:** System/Ops  
**Status:** Accepted  
**Decision ID:** DEC-PRISM-OPS-001  
**Decided by:** Jason  
**Decided at:** 2026-08-23T18:27:26Z  
**Selected option:** Option 1 — accept the testnet default and retain the mainnet release gate  
**Selected environment:** `testnet`  
**ChainId-v2 disposition:** `ACCEPT`

**Decision**  
Accept `SN_SEPOLIA` + Base Sepolia (`chain_id: 84532`) as the default environment for the next Prism deployment and decisive-workflow phase. Retain `SN_MAIN` + Base Mainnet (`chain_id: 8453`) as a separate explicit release-gated environment; this decision does not authorize mainnet activity.

**Consequences**
- testnet deployment preparation and the funded SN_SEPOLIA/Base Sepolia decisive workflow may proceed after the remaining operational readiness checks;
- every challenge must use the accepted environment's chain ID;
- testnet evidence remains X2 until live receipts and independent reads are recorded;
- testnet evidence may not write or promote `strk20.json`;
- mainnet remains blocked by its separate release gate, funding, and evidence requirements.

**Required remaining gates**
- funded Base Sepolia EOA proof ladder;
- funded/deployed Starknet account;
- dry-run and live deployment verification;
- independent RPC/explorer readback for every decisive receipt;
- no promotion of EVD-PRISM-004..007 until those observations exist.

**Evidence boundary**  
Acceptance is a target-network decision. It is not deployment evidence and does not promote maturity beyond X2.

**Reopen conditions**  
Reopen if SN_SEPOLIA/Base Sepolia becomes unavailable, chain IDs or protocol semantics change, or the decisive workflow requires a different environment.

---

## DEC-PRISM-M5-001 — Current STRK20 route selection

**Layer:** Product/System/Delivery
**Status:** Accepted for testnet implementation; live evidence pending
**Decision ID:** DEC-PRISM-M5-001
**Decided by:** Jason
**Decided at:** 2026-08-23
**Selected route:** `PrismVesuLendingHelper`

**Decision**

Use the pinned Prism-owned Vesu helper as the current M5/testnet route. The helper preserves the canonical `privacy_invoke` surface, pins the SN_SEPOLIA privacy pool, underlying token, and Vesu vToken, and uses u256-compatible real-token interfaces with checked output conversion.

PrismClaim remains a preserved future product-native route. It is not rejected or removed; its authority, attestation, custody, expiry, and privacy decisions remain a separate re-entry track and may replace the helper after ratification and verification.

**Current action**

```text
STRK → Vesu STRK vToken shares
```

The supported private action must be submitted through a STRK20-capable Wallet API or official Privacy SDK/prover path. A raw Starknet invoke is not equivalent to a private pool action.

**Evidence boundary**

This decision authorizes the testnet route only. It does not close M5, promote X2 to X3 for the full route, authorize mainnet, or modify `strk20.json`. M5 remains open until a successful pool-invoked transaction and independent readback prove the complete helper path.

**Reopen conditions**

Reopen if the pinned helper fails real pool ABI/atomicity tests, the pool rejects the Vesu share-token output, the upstream validator does not recognize Prism contract involvement, or a supported Wallet API/prover path is unavailable.

---

## DEC-PRISM-M0-001 — Band B Pause-enabled mainnet release rule

**Layer:** Product/System/Delivery
**Status:** Accepted
**Decision ID:** DEC-PRISM-M0-001
**Decided by:** Jason
**Decided at:** 2026-08-24
**Selected band:** `Band B — Pause-enabled Prism mainnet`

**Decision**

Prism will not enter mainnet until every feature promised in the bounded release is complete and testnet-proven. Prism Pause is part of the mainnet promise and therefore is a release gate, not a post-mainnet enhancement.

The pre-mainnet release contract is:

```text
M0–M7 implementation and Foundry/AUDIT closeout
+ owner-led Phase 8 product surfaces
+ M8 full SN_SEPOLIA/Base Sepolia rehearsal and evidence acceptance
→ M9 SN_MAIN deployment and submission
```

M8 and M9 are not started by this decision. PrismChannel remains a minimal testnet relationship slice, not a full messenger, unless a later decision explicitly promises it as a mainnet feature. Band C future capabilities remain deferred.

**Redeployment rule**

Freeze the complete mainnet contract/configuration set before final testnet rehearsal. Redeploy a clean final testnet release candidate when immutable contract or constructor changes require it, then deploy the same frozen source/class set to SN_MAIN once. Do not use repeated redeployment to postpone unresolved Product/System decisions.

**Reopen conditions**

Reopen if the bounded feature set expands, Pause cannot pass P0–P8, the full testnet rehearsal fails, or a promised feature lacks independent evidence.

---

## DEC-PRISM-SYS-004 — Registry V2 exact proof-digest representation

**Layer:** System/Data-Representation
**Status:** Accepted for Registry V2 cutover; V2 not deployed
**Decision ID:** DEC-PRISM-SYS-004
**Decided by:** Jason
**Decided at:** 2026-08-24

**Decision**

Registry V2 uses the full Keccak-256 proof digest as Cairo `u256`:

```text
proof_digest: u256
consumed_digests: Map<u256, bool>
```

The ABI serializes the exact value as low/high `u128` limbs. No masking, modulo, truncation, alternate hash, proxy, upgrade path, or import authority is introduced. Registry V1 remains deployed historical/legacy evidence and is not reinterpreted as V2.

**Consequences**

- V2 is a fresh immutable registry address with fresh identity state.
- V1 identities and felt-masked digest records are not automatically migrated.
- The full offchain digest and exact V2 onchain digest remain equal.
- V2 bind events carry the exact `u256` digest as low/high event data.
- V2 becomes canonical only after deployment, class-hash verification, fresh identity evidence, and independent reads.

**Evidence boundary**

This decision authorizes the V2 design and cutover direction. It is not a deployment receipt, live bind evidence, or M3 completion.

---

## DEC-PRISM-SYS-005 — Explicit Prism ID felt boundary

**Layer:** System/Data-Representation
**Status:** Accepted for V2 cutover
**Decision ID:** DEC-PRISM-SYS-005
**Decided by:** Jason
**Decided at:** 2026-08-24

**Decision**

The canonical offchain product identity remains `prism:<decimal>`. At the Starknet calldata boundary only, canonical decimal IDs map to minimal hexadecimal felts:

```text
prism:1  → 0x1
prism:42 → 0x2a
```

Malformed, signed, leading-zero, zero, non-decimal, and overflow values are rejected with stable errors. No base36 conversion, hashing, or silent repair is permitted.

**Evidence boundary**

This decision authorizes the explicit boundary conversion. It does not authorize deployment, signing, or live M3 evidence.

---

## DEC-PRISM-019 — External aliases are not Prism identity roots

**Layer:** Product/Identity
**Status:** Accepted
**Decided by:** Jason
**Decided at:** 2026-08-25

Starknet ID, ENS, and future naming providers are external alias/resolution systems. An alias is never equal to a Prism ID. An alias becomes associated with a Prism identity only through an explicit, verified association record.

---

## DEC-PRISM-020 — Authority and disclosure are independent

**Layer:** Product/Security
**Status:** Accepted
**Decided by:** Jason
**Decided at:** 2026-08-25

Control or authorization of an execution endpoint does not imply that the identity-to-endpoint relationship is publicly discoverable. Identity, endpoint, authority, delegation, and disclosure remain separate domain concepts.

---

## DEC-PRISM-021 — Private endpoints are never plaintext public state

**Layer:** Security/Privacy
**Status:** Accepted
**Decided by:** Jason
**Decided at:** 2026-08-25

A private endpoint must never be published in plaintext through Starknet state, public events, public projections, API responses, logs, or evidence. Private-binding creation/read remains blocked until encryption-at-rest, key ownership, and recovery are proven by an accepted protection provider. Ordinary browser localStorage is not secure storage.

This does not block wallet-owned STRK20 private execution, whose notes, viewing keys, and proofs remain wallet/provider-owned.

---

## DEC-PRISM-022 — Privacy Mode is a policy bundle

**Layer:** Product/Privacy
**Status:** Accepted
**Decided by:** Jason
**Decided at:** 2026-08-25

A global Privacy Mode may bundle user preferences, but binding-level disclosure policy remains canonical. v0 exposes PUBLIC and PRIVATE behavior only. SELECTIVE remains represented in the domain for forward compatibility but has no v0 route until requester authorization and disclosure capabilities are proven.

---

## DEC-PRISM-023 — Public-to-private does not erase history

**Layer:** Product/Privacy
**Status:** Accepted
**Decided by:** Jason
**Decided at:** 2026-08-25

PUBLIC → PRIVATE means future Prism unpublication plus a historical-public warning. It must never claim that a previously public association was never public or erase third-party blockchain/indexer history.

---

## DEC-PRISM-024 — Session grants are bounded authority, not identity

**Layer:** Security/Authority
**Status:** Accepted
**Decided by:** Jason
**Decided at:** 2026-08-25

A SessionGrant is temporary bounded authority. It is not a Prism identity, root ownership, persistent execution account, shadow account, or substitute for the owner/controller. Session scope, target, selector, token, call, expiry, revocation, and exhaustion constraints are mandatory. Real session-key enforcement remains outside v0 until a selected account implementation proves it.

---

## DEC-PRISM-025 — Shadow accounts remain deferred

**Layer:** Product/Execution
**Status:** Accepted as deferred
**Decided by:** Jason
**Decided at:** 2026-08-25

STRK20 shadow accounts remain a separate future execution mechanism and are not an MVP dependency. They must not be conflated with SessionGrant, session keys, ordinary accounts, or Prism identity. Reopening this scope requires pinned wallet/account interface evidence and a new decision.

---

## DEC-PRISM-M0-002 — Core v1 release-train split

**Layer:** Product/System/Delivery
**Status:** Accepted for Core v1 closeout; does not authorize mainnet
**Decision ID:** DEC-PRISM-M0-002
**Decided by:** Jason
**Decided at:** 2026-08-31

**Decision**

Prism is closed in separate release trains rather than requiring every planned feature to be mainnet-ready at once. The current Core v1 target is:

```text
Registry V2
+ Prism identity create/read
+ Base ownership proof and binding
+ resolve/revoke lifecycle
+ pause/governance control boundary
+ durable backend operation/reconciliation path
+ truthful Home and operation surfaces
```

**STRK20 remains a separate hard-gated release train.** It is not declared complete or mainnet-ready by Core v1. Its acceptance requires the real Wallet API/prover path, STRK20 pool action, privacy-state readback, receipt, conservation, and independent verification. It remains mandatory for any qualifying STRK20 Private Sprint submission.

**Deferred from Core v1**

```text
Vesu lending composition
LayerZero delivery
PrismChannel beyond the minimal relationship slice
shadow accounts
broader private financial capabilities
```

`DEC-PRISM-M0-001` remains historical evidence of the prior Band B scope and is superseded for this Core v1 closeout only. This decision does not authorize deployment, broadcast, `strk20.json` mutation, or promotion of X2 implementation into live evidence.

**Evidence boundary**

Core v1 is still only locally implemented until each promised surface has accepted testnet or mainnet receipts, independent reads, operational recovery evidence, and the applicable owner/release gates. Deferred tracks retain their own evidence ledgers and may not be represented as complete through Core v1 acceptance.
