# Registry V2 Contract Status

```text
source: implemented locally
build: verified locally
snforge: 40 passed
class hash: 0x4349a331b4339c1f20ccdb745e2d60a194f8da64cb789bb70bf60463f42dd8d
registry address: 0x06f77be5c7bdfef252dd322481b4430a587b781df4f79d3b344808d125ec530d
registry deployment block: 14015842
fresh prism:1 transaction: 0x72c6651c52d1f8b90419da04d0dd27b6b5515e40d68b57504f00ef509696dc0
M3 bind transaction: 0x65f654fa67b080cbd3789cabe8779377a640d2f79d2818385636196157ba974 (block 14017479)
M3 revoke transaction: 0x5068e6d21e6df05f0a6e1a9a170422bfcdbfc81b9bcb7c6a4939b8dfb0f2a42 (block 14017549)
live status: deployed/readback and direct M3 bind/resolve/revoke observed; durable projection observation remains open
```

This crate is a separate immutable V2 from `prism_identity_registry` V1. It changes only the proof-digest boundary from `felt252` to exact `u256` and retains the controller, venue, binding, revoke, resolve, and canonical event invariants. It adds no proxy, upgrade, admin, import, or migration authority.
