# Registry V2 Contract Status

```text
source: implemented locally
build: verified locally
snforge: 40 passed
class hash: NOT_DEPLOYED
registry address: NOT_DEPLOYED
declaration transaction: NOT_BROADCAST
deployment transaction: NOT_BROADCAST
```

This crate is a separate immutable V2 from `prism_identity_registry` V1. It changes only the proof-digest boundary from `felt252` to exact `u256` and retains the controller, venue, binding, revoke, resolve, and canonical event invariants. It adds no proxy, upgrade, admin, import, or migration authority.
