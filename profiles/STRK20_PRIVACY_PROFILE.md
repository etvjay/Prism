# STRK20 Privacy Profile

**Profile type:** Research + Product + System + Experience specialization  
**Project:** Prism

## Canonical role

STRK20 is Prism's first native private financial environment on Starknet.

It must strengthen Prism's core product rather than redefine Prism into a generic privacy wallet, bridge, or solver network.

## Integration preference

For the MVP:

```text
Privacy Wallet API
+ WalletAccountV6 / starknet.js
+ privacy_invoke helper for app-specific private actions
```

Use the direct Privacy SDK only when a concrete requirement justifies managing privacy keys and proving directly.

## Privacy truth table

### Shielding / deposit

Public:

- depositor address;
- token;
- amount.

Product copy must not imply that the act of depositing into the pool is hidden.

### Private note-to-note transfer

The intended private property is that transfer parties and amount are not exposed as ordinary public transfer metadata.

Prism may call this a private transfer when using the supported STRK20 route.

### Anonymized DeFi

The direct user identity link can be hidden through the shared anonymizer/private execution route.

Public downstream DeFi may still reveal:

- action amount;
- action timing;
- protocol interaction.

Therefore Prism must not claim amount/timing privacy for a public swap unless a future mechanism proves it.

### Unshield / withdrawal

Public withdrawal legs can reveal destination and amount. Do not present unshielding as globally invisible.

### Ordinary external-chain actions

STRK20 privacy does not automatically make Base/Solana execution private.

## Viewing-key boundary

For the Wallet API route, the dapp should not receive or persist the user's private viewing material. Privacy-enabled wallet infrastructure owns the key/proving path according to the supported API.

Never request private keys, viewing keys, seed phrases, or wallet secrets in app forms or logs.

## `privacy_invoke`

Prism's application-specific private DeFi/action contract must expose the supported helper entrypoint and operate within the STRK20 pool flow.

The initial starter echo/no-op is only a wiring test.

Integration depth requires a meaningful product action.

## Atomicity expectation

Reference STRK20 helper flows are designed so the pool/helper/application action is atomic: if the helper reverts, the whole operation should roll back rather than silently strand funds.

Prism must still test this behavior against its own helper contract.

## Mainnet pool

```text
0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
```

## Experience language

Preferred:

```text
Private balance
Send privately
Use privately
Private on Starknet with STRK20
```

Avoid without exact evidence:

```text
completely invisible
private everywhere
untraceable
all amounts hidden
zero metadata
```

## Evidence requirements

A privacy claim is not proven by the UI.

For every demo-critical private operation record:

```text
network
transaction hash
pool interaction
helper contract if applicable
observed public metadata
claimed hidden metadata
build commit
receipt/status
```

## Current constraints

Private sub-account infrastructure described in sprint ideas must not become an MVP dependency unless current upstream documentation confirms it is shipped and usable.
