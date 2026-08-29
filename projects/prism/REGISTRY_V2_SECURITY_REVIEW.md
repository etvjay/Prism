# Registry V2 Security Review

**Review scope:** local V2 exact-u256 design and canonical testnet runtime configuration. Public SN_SEPOLIA deployment/readback facts are recorded below; no mainnet deployment, broadcast, secret handling, or V1 mutation.

## Findings

### Clear

- V2 is a separate immutable Cairo crate; V1 source and deployed address remain untouched.
- V2 has no proxy, `replace_class_syscall`, admin upgrade, owner import, or unrestricted migration entrypoint.
- `proof_digest: u256` and `consumed_digests: Map<u256, bool>` compile under the pinned Cairo/Starknet toolchain.
- V2 replay tests cover zero digest, same-key replay, cross-identity replay, failed interleavings, and a high-limb distinction test.
- V2 TypeScript calldata uses exact low/high u128 limbs and does not invoke the V1 250-bit mask.
- V2 event decoding is explicitly versioned; V2 `ExecutionIdentityBound` low/high event data reconstructs the original 256-bit digest.
- Short-form Starknet transaction hashes are canonicalized before event persistence.
- V1/V2 selection is explicit through `STARKNET_REGISTRY_VERSION`; no silent ABI routing is introduced.
- Fresh-instance cutover is explicit: V1 records are not silently imported and both registries must not be treated as simultaneous canonical authorities.

### Supplied live testnet facts

```text
registry address: 0x06f77be5c7bdfef252dd322481b4430a587b781df4f79d3b344808d125ec530d
class hash:       0x4349a331b4339c1f20ccdb745e2d60a194f8da64cb789bb70bf60463f42dd8d
deployment block: 14015842
fresh prism:1 tx: 0x72c6651c52d1f8b90419da04d0dd27b6b5515e40d68b57504f00ef509696dc0
M3 bind tx/block: 0x65f654fa67b080cbd3789cabe8779377a640d2f79d2818385636196157ba974 / 14017479
M3 revoke tx/block: 0x5068e6d21e6df05f0a6e1a9a170422bfcdbfc81b9bcb7c6a4939b8dfb0f2a42 / 14017549
```

These public facts support the direct V2 identity/M3 observation only. Durable projection has not been run/read here.

### Open, expected gates

- Durable V2 indexer/projection has not been observed; this review records the configuration and direct testnet facts only.
- The V2 submit adapter remains a versioned boundary; no private key or live signer is wired by this change.
- The accepted `DEC-PRISM-SYS-004/005` records and supplied testnet facts do not constitute repeated/restart projection evidence.
- V1 masked digest records cannot be reconstructed into exact full digests; V1 remains legacy evidence.
- The canonical runtime must retain the V2 address/version/network/start-block gate and reject ambiguity.

## Required cutover refusal conditions

Abort canonical cutover if:

```text
V2 class hash/address mismatch
u256 limb order differs between Cairo and TypeScript
V2 event readback does not reconstruct the full digest
V1/V2 registry identity becomes ambiguous
unexpected upgrade/import/admin surface appears
independent RPC reads disagree
```

## Verdict

`REGISTRY_V2_CANONICAL_RUNTIME_CONFIGURED_PROJECTION_OPEN`

This is a local configuration/build clearance plus supplied direct SN_SEPOLIA identity/M3 facts. It is not durable projection, repeated/restart, or mainnet evidence.
