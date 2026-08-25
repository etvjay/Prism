# PrismIdentityRegistry V2 Migration Packet

**Status:** V2 DEPLOYED — CANONICAL RUNTIME CONFIGURED; DURABLE PROJECTION OBSERVATION OPEN
**Scope:** SN_SEPOLIA only; no mainnet deployment or mainnet broadcast performed by this packet.
**Deployment candidate:** `040b011`

## Decision

Prism should use a fresh immutable Registry V2 with an exact Cairo `u256` proof digest rather than the V1 felt252 masking boundary.

```text
V1: proof_digest: felt252
    consumed_digests: Map<felt252, bool>

V2: proof_digest: u256
    consumed_digests: Map<u256, bool>
```

Cairo `u256` is serialized as two u128 limbs, low then high. V2 performs no mask, modulo, truncation, or alternate hash derivation. The full Keccak-256 challenge digest remains the offchain canonical value and is also represented exactly in V2 calldata/onchain replay state.

## V1 legacy deployment

```text
registry address:
0x67b2f847d7805501c3db79474bdb33e7538825fa0f83aa3cd0083f02ee655c4

class hash:
0x3b21bf8012d99ce6381fc4ea21413e80b3bf5662480461a0ee0529bdaa0f998

deployment transaction:
0x03177381c267bd42e413ff8ed72a3111543cee16e85334fbbf3258897510214b

observed create transaction:
0x0457a43d908da21e8acd723ba94639d6009c123ec4c4d944175f2bbfa05e3a6f
```

V1 remains deployed and readable as historical/legacy evidence. It is not upgraded, proxied, or modified. Its felt-masked digest behavior must not be used for new canonical M3 bindings after V2 cutover.

## V2 deployment fields

```text
V2 class hash:          0x4349a331b4339c1f20ccdb745e2d60a194f8da64cb789bb70bf60463f42dd8d
V2 registry address:    0x06f77be5c7bdfef252dd322481b4430a587b781df4f79d3b344808d125ec530d
V2 declaration tx:      NOT_OBSERVED
V2 deployment tx:       NOT_OBSERVED
V2 deployment block:    14015842
V2 canonical identity:  prism:1 (fresh identity observed)
V2 identity tx:         0x72c6651c52d1f8b90419da04d0dd27b6b5515e40d68b57504f00ef509696dc0
M3 bind tx:             0x65f654fa67b080cbd3789cabe8779377a640d2f79d2818385636196157ba974
M3 bind block:          14017479
M3 revoke tx:           0x5068e6d21e6df05f0a6e1a9a170422bfcdbfc81b9bcb7c6a4939b8dfb0f2a42
M3 revoke block:        14017549
```

The public deployment block, V2 address/class hash, fresh `prism:1` transaction, and direct M3 bind/revoke transaction readbacks are recorded above. Declaration/deployment transaction hashes were not supplied here and remain `NOT_OBSERVED`. Durable indexer/projection observation remains open.

## Fresh-instance policy

V2 intentionally has:

```text
no proxy
no replace_class upgrade path
no admin/import entrypoint
no unrestricted identity migration
```

The recommended cutover is therefore:

```text
1. Declare/build V2.
2. Deploy V2 to SN_SEPOLIA with the user-controlled Starknet account.
3. Verify V2 class hash at the new address.
4. Create a fresh V2 identity.
5. Read it independently through two RPC paths.
6. Make V2 the canonical configured registry.
7. Run M3 against the fresh V2 identity.
8. Retain V1 as legacy evidence only.
```

The existing V1 `prism:1` identity is not automatically imported. Reusing the same offchain numeric ID is acceptable only after V1 is explicitly demoted to legacy and the V2 registry address is the sole canonical registry in configuration/evidence. Do not operate both registries as equal canonical authorities.

## Configuration cutover

Before V2 deployment, code may use:

```text
STARKNET_REGISTRY_VERSION=1
STARKNET_REGISTRY_ADDRESS=<V1 address>
```

After independently verified V2 deployment, the canonical testnet configuration is:

```text
STARKNET_CHAIN_ID=SN_SEPOLIA
NEXT_PUBLIC_STARKNET_NETWORK=SN_SEPOLIA
STARKNET_REGISTRY_VERSION=v2
STARKNET_REGISTRY_ADDRESS=0x06f77be5c7bdfef252dd322481b4430a587b781df4f79d3b344808d125ec530d
STARKNET_REGISTRY_CLASS_HASH=0x4349a331b4339c1f20ccdb745e2d60a194f8da64cb789bb70bf60463f42dd8d
PRISM_STARKNET_INDEXER_START_BLOCK=14015842
```

The V2 submit adapter must be selected explicitly. V1's felt-masked adapter must never silently route to V2. The M3 runner and application/factory paths require an explicit `registryVersion` for both dry-run and live execution; omission never defaults to V1. When the application factory receives an injected submit port, `submitPortRegistryVersion` must match `STARKNET_REGISTRY_VERSION`; missing/mismatched versions fail closed. Offline test fixtures may pass `submitPortRegistryVersion: "v1"` explicitly.

## Required V2 evidence gates

```text
[x] V2 class hash at V2 address matches declared artifact
[x] deployment receipt succeeded (deployment block 14015842 observed)
[x] fresh create_identity transaction succeeded (prism:1 tx recorded above)
[x] PrismIdentityCreated event/readback observed
[x] get_identity readback matches creation event
[x] independent readbacks match
[x] V2 high/low u256 calldata is exact and ordered low then high
[x] controller-signed bind succeeds (M3 bind tx recorded above)
[x] ExecutionIdentityBound event/readback observed
[x] resolve returns ACTIVE destination
[x] revoke succeeds (M3 revoke tx recorded above)
[x] resolve returns NO_ACTIVE_DESTINATION
[x] original identity remains readable after revoke
[ ] durable indexer/projection reads V2 events from V2 deployment block
```

No V2 maturity promotion is valid from source/build tests alone. The supplied testnet deployment/readback facts support the direct V2 identity/M3 claim; durable projection remains unobserved.

## Signer and funding requirements

The user must provision/operate:

```text
funded Starknet Sepolia account
account/provider capable of declaring/deploying/invoking
RPC endpoint (already supplied for read-only work)
fee funding for declaration, deployment, create, bind, and revoke
```

No seed phrase, private key, password, viewing key, or signing secret belongs in chat, git, memory, worker prompts, or evidence documents.

## Abort and rollback

Before V2 becomes canonical, abort if any of these occur:

```text
class hash mismatch
constructor/state mismatch
ABI limb order mismatch
identity event/read mismatch
second-RPC disagreement
unexpected admin/proxy/import surface
V1/V2 registry ambiguity
```

Because V2 is a fresh immutable address, rollback before canonical cutover is configuration-only: leave V1 canonical and mark V2 deployment abandoned. After canonical cutover, do not silently switch back; record a versioned decision and evidence state.

## Decision records

The accepted records are now appended to `projects/prism/DECISIONS.md`:

```text
DEC-PRISM-SYS-004 — Registry V2 exact u256 proof digest
DEC-PRISM-SYS-005 — explicit prism:<decimal> → felt252 boundary
```

The old masked-digest proposal is retained as superseded historical analysis. V2 deployment and direct live M3 evidence are observed on SN_SEPOLIA; canonical runtime configuration is implemented, while durable projection observation remains open.

## Submission/evidence boundaries

```text
No mainnet deployment
No mainnet spend
No strk20.json mutation
No fabricated V2 address/class hash/tx hash
Direct live V2 identity/M3 bind/resolve/revoke observations recorded on SN_SEPOLIA
No claim of durable live projection; no live projection run/read was performed here
```

**Verdict:** `REGISTRY_V2_CANONICAL_RUNTIME_CONFIGURED_PROJECTION_OBSERVATION_OPEN`
