# STRK20 Context — Research Foundry Handoff

**Status:** build constraint / verified ecosystem context  
**Date:** 2026-08-20  
**Project:** Prism

## Canonical product relationship

Prism is not being redefined as a generic STRK20 wallet or a cross-chain privacy bridge.

The current product relationship is:

```text
Prism ID
persistent identity / coordination rooted on Starknet
        │
        ├── native execution identities (Base, etc.)
        │
        └── STRK20
            first native private financial state + private Starknet execution path
```

## Current STRK20 integration route

For the first Prism build, prefer:

```text
Privacy Wallet API
+ WalletAccountV6 / starknet.js 10.4.0
+ app-specific privacy_invoke helper when private DeFi is required
```

Do **not** make direct key custody or a custom prover a prerequisite unless a concrete capability requires it.

Current starter-compatible packages:

```text
next                         ^16.0.8
react                        19.2.1
react-dom                    19.2.1
starknet                     10.4.0
@starknet-io/get-starknet-discovery        6.0.2
@starknet-io/get-starknet-wallet-standard  6.0.2
@starknet-io/types-js        0.10.3
zustand                      ^5.0.9
```

## Four supplied agent-skill routes

Install in the local coding environment:

```bash
npx skills add welttowelt/strk20-skills
```

Expected skills supplied by the sprint instructions:

1. `strk20-privacy` — pool model and integration-route selection.
2. `strk20-wallet-api` — private dapp flow through the user's privacy-enabled wallet.
3. `strk20-anonymizer-contracts` — Cairo `privacy_invoke` helper for private application/DeFi actions.
4. `strk20-privacy-sdk` — lower-level SDK route when holding/managing privacy keys directly.

When using a skill, prefer its bundled upstream reference over recalled behavior.

## Mainnet

```text
CHAIN_ID = SN_MAIN
STRK20 pool = 0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
```

Use an RPC endpoint from an environment variable.

Example:

```bash
STARKNET_RPC_URL=https://starknet-mainnet.g.alchemy.com/v2/$ALCHEMY_KEY
```

Never commit the key.

## Mainnet-first rule

The sprint is evaluated against real mainnet pool activity. Do a low-value STRK20 mainnet smoke test before allowing private-product development to depend on an unverified route.

Required final evidence includes at least three successful mainnet transactions touching the STRK20 pool and listed in `strk20.json`.

## Privacy truth table

### Shield / deposit

Public:

- depositing address;
- token;
- amount.

Do not claim shielding itself hides the deposit.

### Note-to-note private transfer

STRK20 is designed so parties and transferred amount are hidden inside the private pool flow, while necessary pool proof/nullifier/encrypted-note artifacts remain onchain.

### Anonymized DeFi / `privacy_invoke`

An anonymizer can hide the direct user link by executing through shared/private infrastructure, but public DeFi effects can reveal action amount and timing.

Allowed framing:

> private/anonymous execution identity where supported by STRK20

Do not claim all swap amounts/timing are hidden.

### Ordinary Base execution

An ordinary Base transaction remains public unless Prism later integrates a separate Base privacy mechanism.

## `privacy_invoke`

App-specific helper contracts expose the mandatory `privacy_invoke` entrypoint used by private application actions.

General model:

```text
STRK20 pool
    ↓
privacy_invoke helper
    ↓
real application action
    ↓
result credited according to STRK20 flow
```

The official ecosystem guidance notes that helper flows are atomic: if the helper/action reverts, the overall operation rolls back rather than intentionally stranding value outside the pool flow.

The starter kit's default echo helper is a demonstration no-op. Prism should replace it with a meaningful product action before claiming deep integration.

## Wallets

Current ecosystem references identify Ready as a live mainnet privacy wallet and note that dapp-facing support across wallets may vary. Verify actual Wallet API support during implementation rather than assuming every discovered Starknet wallet supports private dapp methods.

## Primary references

- Full STRK20 docs mirror: https://strk20-by-example.org/llms-full.txt
- STRK20: https://strk20.starknet.io/
- Build: https://strk20.starknet.io/build
- Starter kit: https://github.com/Akashneelesh/strk20-starter-kit
- Awesome STRK20: https://github.com/Akashneelesh/awesome-strk20
- Sprint: https://github.com/starkience/strk20-hackathon
- Ideas: https://github.com/starkience/strk20-hackathon/blob/main/IDEAS.md

## Prism-specific protected decisions

1. Starknet remains the canonical Prism identity root.
2. Prism ID is not equivalent to a Starknet address.
3. External venue accounts remain native execution identities.
4. STRK20 is core to Prism's Starknet private-finance surface, not the definition of Prism itself.
5. Prism does not become a solver network or bridge merely to abstract cross-chain value movement.
6. No private Base execution claim without a real Base privacy mechanism.
7. No unshipped private-subaccount infrastructure may become an MVP dependency.

## First evidence targets

```text
EVD-001  Reach STRK20 mainnet pool from a real wallet.
EVD-002  Read/show a real private balance.
EVD-003  Execute a real private transfer.
EVD-004  Execute one meaningful Prism privacy_invoke action.
EVD-005  Record qualifying transaction hashes in strk20.json.
```

**Research → Experiment → Build → Evidence.**
