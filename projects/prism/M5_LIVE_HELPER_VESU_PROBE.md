# M5 Live Helper→Vesu Compatibility Probe

**Status:** Observed SN_SEPOLIA testnet evidence; not full M5 acceptance  
**Date:** 2026-08-23  
**Evidence maturity:** X3 for the narrow helper→real-Vesu-token leg; X2 for the complete STRK20 pool route

## Purpose

This probe was run after 0x Alpha identified and blocked the generic helper's u128 ERC-20 surface against real u256 STRK/vToken contracts. It uses the pinned u256-compatible `PrismVesuLendingHelper` class and a separate probe instance whose pinned caller is the deployed Starknet test account. It deliberately does **not** claim a privacy-pool transaction.

## Contracts and configuration

```text
chain: SN_SEPOLIA
account / probe caller:
0x047c0f8b01b9c7c75c669dc549bc305a0f2d796808117339a1c87730162b131c

pinned helper class:
0x00ee923c2e4401b0f8090aa15d1948c79f5ba5a45a519903a64a3a4abac244e6

production-candidate helper pinned to STRK20 pool:
0x07f3dd9a08c50fb6403a8621d8a7d9ccf5f7161f338fb36b515ed629e5490adf

probe helper pinned to account caller:
0x03a0628245ca39f6bf118bedfa53643cf54795024d26574491ff1957581e1cb7

underlying STRK:
0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d

Vesu STRK vToken:
0x7152ae40c6bcbe7ff84b08a76527becb380bf7b2e782c0f5c8de9de049f8fff
```

## Receipts

```text
probe deployment:
0x02bbeb653db64ac5e560c56eba52b19de37d94befdb53c6d5d39d9a998c881f9
Accepted on L2 / Succeeded
block 13945547

fund probe with 1 STRK:
0x070df324dd988f1a84bc28125084340602407b3ebe41e45bdc7e64a86c384e11
Accepted on L2 / Succeeded
block 13945571

helper → Vesu deposit probe:
0x050d928adbc8cf0b0c6dee1fced73587bb15e87fc15ff277d9d3d2492688db3f
Accepted on L2 / Succeeded
block 13945591
actual fee 1124971032630706848 FRI
events 10

pull measured shares from probe helper:
0x078ac19fc863aa4d64e60c3c882817a823dd5387d5f6bb2623f7a6ae2fb215b1
Accepted on L2 / Succeeded
block 13945631
actual fee 66046964846763056 FRI
events 3
```

## Readback and conservation

Before the pull-back transaction:

```text
probe helper STRK balance: 0
probe helper vToken balance: 1000000000000000000
account vToken balance: 0
```

After the pull-back transaction:

```text
probe helper vToken balance: 0
account vToken balance: 1000000000000000000
```

The probe therefore observed:

```text
real u256 STRK approve/deposit path: succeeded
real Vesu vToken u256 share measurement: succeeded
checked u256→u128 output conversion: succeeded for 1e18
account-scoped output approval/pull: succeeded
no helper output stranded after pull
```

## Boundary

This evidence does **not** prove:

```text
STRK20 private note creation
STRK20 Wallet API support
SNIP-36 proof generation
pool withdraw → helper invocation
pool OpenNoteDeposit credit
pool-level atomic rollback
upstream submission validator mine=true
```

The probe helper was pinned to the account caller rather than the privacy pool so the account could invoke it directly. The production-candidate helper remains pinned to the real SN_SEPOLIA privacy pool and has not yet been invoked by that pool.

## Next M5 gate

Obtain a real STRK20-capable Wallet API/prover path, then execute the exact private-DeFi action:

```text
transfer STRK amount OPEN to self
invoke production-candidate helper with
[STRK, STRK_VTOKEN, amount, ${openNoteIds[0]}]
```

Only that transaction can establish the remaining M5 pool evidence predicates.
