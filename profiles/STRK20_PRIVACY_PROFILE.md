# STRK20 Privacy Profile

**Profile type:** Research + Product + System + Experience specialization  
**Project:** Prism  
**Last research refresh:** 2026-08-20

## Canonical role

STRK20 is Prism's first native private financial environment on Starknet.

It must strengthen Prism's core product rather than redefine Prism into a generic privacy wallet, bridge, solver network, or privacy-only account product.

## Integration preference

For Prism's normal user-facing dapp flow:

```text
get-starknet 6.0.3
+ starknet.js 10.4.0 / WalletAccountV6
+ Privacy Wallet API 0.10.3
+ privacy-enabled wallet
+ STRK20 pool
```

The dapp asks the wallet to act. The wallet owns viewing-key, note, proving, and registration responsibilities.

Use a direct Privacy SDK route only where Prism deliberately controls its own account/key material, especially development/testing or advanced infrastructure paths.

Use a project-owned anonymizer only when a required application action has no maintained first-party private path. Before writing Cairo, check the target protocol's current docs/SDK for a shipped STRK20/private integration.

## Golden key boundary

> **A normal dapp must never touch the user's viewing key.**

Prism must never request, store, log, transmit, or derive user private keys, seed phrases, or viewing keys through application forms or ordinary dapp state.

Balance access through the wallet is permitted only as a deliberate feature. Do not call `strk20Balances` merely to feature-detect; capability detection must use supported Wallet API/spec version checks and disclose no user balance data.

## Registration

A pool account must be registered before it can hold or receive private notes. Wallet flows are expected to manage first-use registration rather than requiring Prism application code to obtain the viewing key.

## Privacy truth table

### Shielding / deposit

Public:

- depositor address;
- token;
- amount;
- timing of the pool interaction.

Product copy must not imply that shielding itself hides the deposit.

Deposits are screened as part of the protocol flow. Self-hosted proving is not a screening bypass.

### Private note-to-note transfer

Inside the private transfer path, sender, recipient, amount, token type, and spent-note relationships are not exposed as ordinary public transfer metadata.

Prism may call this a private transfer when the supported STRK20 route is actually used.

### Open notes

Open notes carry a public amount because they are used where an output amount is learned from public contract execution. Ownership can remain hidden while the credited amount is visible.

Prism must distinguish:

```text
encrypted private note amount
vs
open-note public amount with hidden owner
```

### Anonymized DeFi / application actions

The user's direct public address can be hidden behind a shared anonymizer/private execution route.

Public downstream execution may still reveal:

- action amount;
- action timing;
- protocol interaction;
- open-note output amount where applicable.

Therefore Prism must not claim amount/timing privacy for public DeFi execution unless a separate mechanism proves it.

### Unshield / withdrawal

Public:

- withdrawal destination;
- withdrawal amount;
- timing.

The origin deposit relationship can remain hidden. Do not present unshielding as globally invisible.

### Ordinary external-chain actions

STRK20 privacy does not automatically make Base or other venue execution private.

## Composition leakage

Do not casually bundle a public deposit with the private transfer it funds.

A combined deposit + transfer gives an observer a trivial correlation between:

```text
depositing address
public deposit amount
immediate private action timing
```

A prior shield followed later by a private transfer provides a stronger unlinkability story, at the cost of another operation, pool fee, and note-maturity wait.

If Prism chooses composition for UX, the privacy cost must be explicitly documented.

## Note maturity

New notes generally require approximately ten blocks before normal subsequent spending.

Prism UX must not assume a freshly shielded balance is immediately spendable. Present a real pending/maturing state or use an explicitly analyzed composition path.

## Deposit transaction UX

A shield/deposit is expected to involve two wallet prompts/transactions:

```text
1. ERC-20 approve
2. private deposit / pool action
```

The interface must explain both steps so the second prompt is not mistaken for a duplicate transaction bug.

## Pool fees

A flat pool fee applies per private operation and is material to UX.

Rules:

- read the current fee from the pool rather than hard-coding it;
- account for it when calculating `MAX`;
- avoid tiny actions where the fee makes the flow economically irrational;
- do not promise a fixed fee amount in product copy.

## Relayers and activity attribution

Private transactions may be submitted by rotating/shared relayers. Transaction `sender` is therefore not a reliable user-identity field.

User activity must be reconstructed from the appropriate STRK20 events/state, not by grouping private transactions by transaction sender.

## `privacy_invoke`

A Prism application-specific private action may use a project-owned Cairo anonymizer/helper exposing the supported privacy invocation interface.

General model:

```text
STRK20 pool
    ↓
Prism anonymizer
    ↓
real application/protocol action
    ↓
result credited according to STRK20 flow
```

The starter-kit echo helper is only a wiring demonstration.

Reference helper packages are learning/audit starting points, not production guarantees. Prism owns review, tests, deployment, and maintenance of any production helper it declares.

## First-party private routes

Before building a Prism anonymizer for an existing protocol, check whether that protocol already ships a maintained private route. A first-party route should generally be preferred because it removes unnecessary Prism contract/audit/maintenance surface.

Current research evidence identifies AVNU private swaps as one such first-party path; verify freshness again before implementation.

## Atomicity expectation

Reference anonymizer flows are atomic: if the application/helper action reverts, the transaction should roll back rather than intentionally strand funds outside the pool flow.

Prism must test this behavior against any Prism-owned helper.

## Shadow accounts / former sub-accounts

Upstream status is route-specific and fast-moving.

- The public STRK20 Build page still describes private sub-accounts as coming soon.
- The Privacy SDK changelog shows an SDK-side implementation landed and was subsequently renamed **shadow accounts** in `0.14.3-RC.5`.
- The normal dapp Wallet API route still does not expose the equivalent capability in the currently referenced Wallet API/types surface.

Therefore:

> **Shadow accounts remain outside the Prism sprint MVP.**

This is a scope decision, not a claim that the SDK mechanism does not exist.

## Mainnet pool

```text
0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
```

## Experience language

Preferred where evidenced:

```text
Private balance
Send privately
Private transfer
Private on Starknet with STRK20
Identity-private DeFi execution
```

Avoid without exact evidence:

```text
completely invisible
private everywhere
untraceable
all amounts hidden
zero metadata
anonymous amount
```

## Evidence requirements

A privacy claim is not proven by the UI or by a transaction hash alone.

For every demo-critical operation record:

```text
network
transaction hash
pool interaction
Prism contract involvement if declared
observed public metadata
claimed hidden metadata
build commit
receipt/status
failure/retry behavior
```

## Primary upstream constraints

This profile is grounded in:

- the official sprint Day-0 mainnet guide;
- `starkience/strk20-agent-skills` `strk20-privacy-integration` skill and references;
- `starkware-libs/starknet-privacy` SDK changelog;
- current Awesome STRK20 and starter-kit references;
- STRK20 Build documentation.

Statuses must be re-verified before implementation when the upstream skill explicitly marks them as moving.
