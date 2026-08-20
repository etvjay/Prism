# Starknet System Profile

**Profile type:** System Foundry specialization  
**Project:** Prism  
**Rule:** This profile constrains implementation; it may not redefine canonical Product Truth.

## Canonical Prism authority mapping

| Prism concept | Authoritative layer | Notes |
|---|---|---|
| Prism identity existence | Starknet `PrismIdentityRegistry` | Canonical protocol identity state |
| Prism controller | Starknet registry/account authorization | Mutable in future without changing Prism ID |
| Execution binding status | Starknet registry | Backend may cache/index, never override |
| Base ownership proof | Base signature verification + Prism binding command | Signature proves control; registry acceptance makes binding canonical |
| Portfolio | Derived offchain state | RPC/indexer reads; not identity authority |
| STRK20 private asset state | STRK20 pool + privacy wallet/protocol | Prism presents state, does not redefine it |
| Operation UX status | Prism operation/reconciliation model | Must map to actual chain lifecycle |

## Starknet role

Starknet is structurally important to Prism because it owns:

- persistent Prism identity state;
- binding/revocation lifecycle;
- programmable account/authority evolution;
- first native private-finance environment through STRK20.

Starknet is **not** merely one portfolio venue.

## Account model constraint

Starknet accounts are programmable contract accounts. Prism may later use that programmability for controller rotation, recovery, delegation, passkeys, sessions, and bounded authority.

MVP rule: do not implement future account-policy complexity until identity + binding + resolution + revocation are proven.

## Transaction truth

Never represent submission as completion.

Frontend/backend operation states must distinguish at least:

```text
awaiting_authorization
submitted
confirming
confirmed
indexed/reconciled where required
completed
failed/reverted
```

## Network

Mainnet chain identifier:

```text
SN_MAIN
```

All mainnet/testnet addresses and configuration must be environment-scoped.

## RPC

RPC providers are replaceable infrastructure adapters.

Do not hard-code credentials. Use:

```text
STARKNET_RPC_URL
```

## Contract design rule

`PrismIdentityRegistry` should remain small and canonical.

It may own:

```text
identity
controller
binding lifecycle
version/status
canonical events
```

It should not own:

```text
portfolio prices
DeFi indexing
bridge routing
solver logic
frontend metadata
```

## Required events

Prefer meaningful past-tense facts:

```text
PrismIdentityCreated
ExecutionIdentityBound
BindingRevoked
```

Avoid generic `RecordUpdated` events.

## Failure/reconciliation rule

Assume RPC, indexer, backend cache, and chain may temporarily disagree. Starknet canonical contract state wins for registry lifecycle. Prism must reconcile derived state rather than letting cache state redefine identity truth.

## Protected product boundary

This profile must never infer:

```text
Prism ID == Starknet account address
```

The correct relationship is:

```text
Prism ID = persistent identity
Starknet controller/account = current authority/execution identity
```
