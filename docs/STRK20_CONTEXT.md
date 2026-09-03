# STRK20 Context — Research Foundry Handoff

**Status:** verified ecosystem constraint / live build context  
**Date:** 2026-08-20  
**Project:** Prism

## Canonical product relationship

Prism is not a generic STRK20 wallet, bridge, or solver network.

```text
Prism ID
persistent identity / coordination rooted on Starknet
        │
        ├── native execution identities (Base, etc.)
        │
        └── STRK20
            first native private financial state + private Starknet execution path
```

STRK20 constrains Prism's private Starknet implementation; it does not redefine Prism's core identity primitive.

## Prism core privacy scope

Prism's core STRK20 use case is:

```text
Prism ID / native account continuity
→ private transfers
→ consent-gated private state
→ governed action and request coordination
```

STRK20 itself provides the private wallet, note, transfer, and execution primitives. Lending, Vesu, swaps, or another DeFi protocol are **application-specific compositions**, not requirements of STRK20 and not prerequisites for Prism's core identity, private-transfer, or request flows.

The Vesu `PrismVesuLendingHelper` route is retained as an optional M5 integration experiment and separate evidence lane. Its provider failure must not be treated as a blocker for the core Prism privacy product unless Prism explicitly chooses private lending as a release requirement.

## Current integration route

For Prism's user-facing dapp flow:

```text
get-starknet 6.0.3
→ starknet.js 10.4.0 / WalletAccountV6
→ Privacy Wallet API v0.10.3
→ privacy-enabled wallet
→ STRK20 pool
```

The dapp must never receive or persist the user's viewing key. The wallet owns keys, notes, proving, and registration.

Current explicit pins:

```text
next                                      ^16.0.8
react                                     19.2.1
react-dom                                 19.2.1
starknet                                  10.4.0
@starknet-io/get-starknet-discovery       6.0.3
@starknet-io/get-starknet-wallet-standard 6.0.3
@starknet-io/types-js                     0.10.3
zustand                                   ^5.0.9
```

Re-verify fast-moving pins before each integration phase rather than relying on this file indefinitely.

## Current agent skill

Install in the local coding environment:

```bash
npx skills add starkience/strk20-agent-skills
```

Current skill:

```text
strk20-privacy-integration
```

It scans the repository, selects an integration route, writes a repo-specific `STRK20_INTEGRATION_PLAN.md`, and executes app-code phases after approval.

Important boundary: the agent skill does **not** generate or edit production Cairo anonymizer contracts. Prism owns contract design, review, tests, audit, deployment, and maintenance.

## Integration route selection

### Normal dapp

Use the Privacy Wallet API through starknet.js.

### Protocol-specific private action

Use the Wallet API plus an app-specific anonymizer only when no suitable first-party private route already exists.

Before writing Cairo, check the target protocol's own private integration. AVNU, for example, currently provides a first-party private swap path, so a private swap alone does not justify a Prism swap anonymizer.

### Wallet/backend holding its own privacy keys

Use the direct Privacy SDK only when Prism deliberately owns accounts/keys and can secure the viewing-key/proving path.

This is not the default consumer-dapp route.

## Mainnet

```text
CHAIN_ID = SN_MAIN
STRK20 pool = 0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
```

Use a replaceable RPC URL from environment configuration. Never commit credentials.

## Mainnet-first rule

G0 is a low-value real mainnet pool smoke test. It proves reachability; it does not have to become one of the final three submission hashes.

The final submission evidence is stricter.

### Current hub validator rule

Every declared transaction must:

```text
exist on Starknet mainnet
→ have execution_status == SUCCEEDED
→ contain a STRK20-pool event
```

If `strk20.json.contracts` contains one or more Prism contracts, every listed qualifying transaction is additionally checked for involvement of at least one declared Prism address, either:

```text
an event emitted from a declared Prism contract
OR
a declared Prism address appearing in transaction calldata
```

Therefore, after Prism declares contracts, a plain shield/private-transfer hash that does not involve Prism code is not sufficient submission evidence.

## Wallet/API execution truths

### Capability detection

Feature-detect STRK20 support with wallet/spec version capability queries such as `supportedWalletApi` / `supportedSpecs`.

Do **not** call `strk20Balances([])` just to probe capability: balance reads can trigger user consent for data Prism does not need merely to detect support.

### Deposit is two transactions

A shield flow requires the ERC-20 approval to become visible before the private deposit can be proven.

Product UX must make the two approvals understandable rather than presenting the second prompt as a duplicate bug.

### Note maturity

Freshly created notes generally require roughly ten blocks before they can be spent in a later transaction.

A deposit and a private transfer can be composed into one transaction, but doing so changes the privacy properties because the public deposit leg becomes directly correlatable with the funded private action.

### Pool fees

Read the current fee from the pool (`get_fee_amount`). Do not hard-code historical fee observations.

Fee UX affects minimum useful amounts, batching, and `MAX` calculations.

### Relayers

Private transactions may be submitted by rotating/shared relayers. Transaction `sender` is therefore not reliable user attribution.

User activity must be attributed using the relevant STRK20 pool events/state.

### Address normalization

Starknet addresses may have different valid zero-padding. Compare address identity numerically (`BigInt(a) === BigInt(b)`) rather than raw string equality.

## Privacy truth table

### Shield / deposit

Public:

- depositing address;
- token;
- amount;
- timing.

The deposit is not private. What happens after shielding can be private.

### Note-to-note transfer

Private:

- sender;
- recipient;
- transfer amount;
- token type inside the private note flow.

Public proof/nullifier/encrypted-note artifacts still exist as required by the protocol.

### Open notes

An open note may carry its amount in plaintext because the value is determined by an onchain action. The owner can remain hidden while the amount is public.

Do not equate "note" with "amount hidden" in every route.

### Anonymized DeFi / `privacy_invoke`

The useful property is hiding the direct user identity behind the public protocol action.

Potentially public/correlatable:

- action amount;
- timing;
- target protocol/action.

Do not claim amount privacy for a public swap/lending action unless the exact route proves it.

### Composition leakage

Bundling a public deposit with the private transfer it funds publishes the depositor and amount in the same transaction context. The recipient may remain hidden, but sender/amount correlation is much stronger.

For stronger unlinkability, shield earlier and spend after note maturity.

### Withdrawal

Destination and amount are public. The protected property is the hidden relationship to the original deposit/private history, subject to timing/amount correlation.

### Ordinary Base execution

Ordinary Base execution remains public unless Prism integrates a separate Base privacy mechanism.

## Screening

Deposit screening is protocol-enforced. Self-hosting a prover does not bypass screening.

Prism must treat screening rejection and screening unavailability as distinct operational states where upstream APIs expose them.

## Shadow accounts / former sub-accounts

Current upstream status is split:

```text
Privacy SDK route:
  shipped in release-candidate form and renamed to Shadow Accounts in 0.14.3-RC.5

Wallet API route for normal dapps:
  not currently exposed
```

The SDK rename includes `SubAccount` → `ShadowAccount` and `build().subaccounts(...)` → `build().shadowAccounts(...)`.

Prism will not make shadow accounts an MVP dependency because the default consumer route remains wallet-mediated.

The supplied shadow-account overview is therefore retained only as an optional
provider observation: a privacy-pool/anonymizer may create disposable Starknet
execution accounts for private DeFi actions such as Vesu or Endur. This is not a
STRK20 note, memo, claim, receipt, binding, or evidence of unlinkability; no
shadow-account action is required by the normal Wallet API route.

## `privacy_invoke`

General model:

```text
STRK20 pool
    ↓ withdraw input to anonymizer
Prism-owned privacy_invoke contract
    ↓ meaningful application action
output returned
    ↓
STRK20 pool credits resulting private/open note
```

The pool/helper action is atomic under the supported route: a helper revert rolls back the operation. Prism must still test this with its own contract.

The starter kit's echo helper is only a wiring demonstration and is not sufficient product differentiation.

## Primary references

- Build: https://strk20.starknet.io/build
- Privacy SDK: https://github.com/starkware-libs/starknet-privacy
- Agent skill: https://github.com/starkience/strk20-agent-skills
- STRK20 docs mirror: https://strk20-by-example.org/llms-full.txt
- Starter kit: https://github.com/Akashneelesh/strk20-starter-kit
- Awesome STRK20: https://github.com/Akashneelesh/awesome-strk20
- Sprint: https://github.com/starkience/strk20-hackathon
- Ideas: https://github.com/starkience/strk20-hackathon/blob/main/IDEAS.md

## Prism-specific protected decisions

1. Starknet remains the canonical Prism identity root.
2. Prism ID is not equivalent to a Starknet address.
3. External venue accounts remain native execution identities.
4. STRK20 is Prism's private Starknet financial/execution surface, not Prism's product definition.
5. Prism does not become a solver network or bridge merely to abstract cross-chain movement.
6. No private Base claim without an actual Base privacy route.
7. Shadow-account infrastructure does not become a normal-dapp MVP dependency while the Wallet API route remains unavailable.
8. First-party private protocol routes should be preferred when they satisfy the product, but the sprint's own-contract evidence rule is evaluated separately.

## First evidence targets

```text
EVD-STRK20-001  Reach the live pool on SN_MAIN from a real supported wallet.
EVD-STRK20-002  Read/show a real private balance through an intentional wallet-consent flow.
EVD-STRK20-003  Execute and verify a real private transfer.
EVD-STRK20-004  Deploy and execute a meaningful Prism-owned pool-integrated action.
EVD-STRK20-005  Collect ≥3 final hashes that satisfy both pool and own-contract validation after contracts are declared.
```

**Research → Experiment → Build → Evidence.**
