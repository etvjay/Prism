# Registry V2 Contract Status

```text
source: implemented locally
build: verified locally
snforge: 40 passed
class hash: 0x4349a331b4339c1f20ccdb745e2d60a194f8da64cb789bb70bf60463f42dd8d
registry address: 0x06f77be5c7bdfef252dd322481b4430a587b781df4f79d3b344808d125ec530d
declaration transaction: 0x3c985643617838bec5297fb7082934b508704a9797df533384f9113ebe082d2
deployment transaction: 0x35c59151290b94f751c09f73e1b9391c6a5d7dfe4f3f76ede35a31826c3a175
deployment block: 14015842
fresh identity transaction: 0x72c6651c52d1f8b90419da04d0dd27b6b5515e40d68b57504f00ef509696dc0
live status: deployed/readback observed; direct M3 bind/resolve/revoke observed; durable projection/canonical cutover remain open
```

This crate is a separate immutable V2 from `prism_identity_registry` V1. It changes only the proof-digest boundary from `felt252` to exact `u256` and retains the controller, venue, binding, revoke, resolve, and canonical event invariants. It adds no proxy, upgrade, admin, import, or migration authority.
