# Registry V2 Security Review

**Review scope:** local V2 exact-u256 design at the current working tree. No deployment, broadcast, secret handling, or V1 mutation.

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

### Open, expected gates

- V2 has no class hash, address, declaration receipt, deployment receipt, or live identity evidence yet.
- The V2 adapter is not a live submission path until a V2 address and user-controlled signer are provisioned.
- The existing `DEC-PRISM-SYS-004/005` proposals remain derived decision text until canonical acceptance is recorded.
- V1 masked digest records cannot be reconstructed into exact full digests; V1 remains legacy evidence.
- V2 event catalogue/evidence must be updated with the actual V2 deployment/class hash after deployment.

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

`REGISTRY_V2_REVIEW_CLEAR_DESIGN`

This is a local design/build clearance only. It is not live deployment or M3 evidence.
