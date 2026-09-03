# Live Identity and Binding Closure Report

## Scope and safety

- Worktree: `/home/ubuntu/prism-hyperlane-identity-closure`, detached at `34f25b799909c50e18f9d772aad98696471082b5`.
- Testnet-only: SN_SEPOLIA and Base Sepolia (`84532`). No SN_MAIN/Base Mainnet calls, no `strk20.json` mutation, no product-code change, and no credential values recorded.
- Read-only audit used the protected RPC configuration internally without printing endpoint or signer values. The protected account file was verified present; its contents were not read into the report.

## Deployment and ABI audit

Manifest and V2 source agree on:

- Registry: `0x06f77be5c7bdfef252dd322481b4430a587b781df4f79d3b344808d125ec530d`
- Class hash: `0x4349a331b4339c1f20ccdb745e2d60a194f8da64cb789bb70bf60463f42dd8d`
- Deployment block: `14015842`
- Deployment transaction: `0x35c59151290b94f751c09f73e1b9391c6a5d7dfe4f3f76ede35a31826c3a175`
- Explicit registry version: `v2`; V2 uses exact `u256` proof digest, low limb then high limb.

Live class-hash reads from both configured Starknet provider paths matched the manifest/source class hash. The live class exposed five external entry points; the exact observed selector mapping by compiled function index was:

- `create_identity`: `0x3aa12a02f4ea70a37769291f1a8a445a3f62b671062bddbcc8610d84c5ea1f5`
- `get_identity`: `0x2c4943a27e820803a6ef49bb04b629950e2de615ab9ac0fb8baef037b168782`
- `bind_execution_identity`: `0x2384f28f205a5a900d8a738411b3fe6c1066d2f60bf67042367d49c440f5bb8`
- `resolve`: `0x2412dc2a4a0554946f855b8a477bb5d50aeb5d097ddd55c2f7b4dda077bf63a`
- `revoke_binding`: `0x3811a8688e3e024660045ab03b5535c36a191f43853b1c6b8bcfa27e4e84616`

Base RPC read returned chain ID `0x14a34` (`84532`).

## M1 live create/read evidence

Re-read of the recorded V2 identity transaction from both provider paths:

- Transaction: `0x72c6651c52d1f8b90419da04d0dd27b6b5515e40d68b57504f00ef509696dc0`
- Block: `14016570`
- Execution: `SUCCEEDED`; finality: `ACCEPTED_ON_L1`
- `PrismIdentityCreated` selector: `0x2c3cc45f2ad701f3571bc1faaf7d37e194064f8e8e3269b8642fc31624960e7`
- Event matched registry address, transaction hash, Prism ID `0x1`, and controller.
- `get_identity(0x1)` returned the same `Some(Identity)` encoding on both paths: tag `0x0`, controller, creation block `0xd5e03a` (`14016570`), version `0x0`.
- Event scan from deployment block found exactly one matching creation event. Primary scan watermark was `14277585`; independent scan watermark was `14277597`; both are fresh under `K=5` because the scan watermark equals the provider latest block.

M1 live create/read is independently re-observed at testnet evidence level (X3 claim scope); no new identity was created in this run.

## Direct V2 M3 state evidence re-read

Recorded transactions were independently read from the primary Starknet provider; their receipts and protocol events are consistent with V2 source ABI:

- Bind: `0x65f654fa67b080cbd3789cabe8779377a640d2f79d2818385636196157ba974`, block `14017479`, `SUCCEEDED`, `ACCEPTED_ON_L1`.
  - Event contains Prism ID `0x1`, venue `0x42415345` (`BASE`), execution account key `0xcf3e2afa1e8e92af56b02fd6799ecdd77018de23`, and exact digest limbs low `0xd9b72074a10098b953e8fbfd1fe8b20e`, high `0xb2fea30342b815252bd594185077ccfe`.
- Revoke: `0x5068e6d21e6df05f0a6e1a9a170422bfcdbfc81b9bcb7c6a4939b8dfb0f2a42`, block `14017549`, `SUCCEEDED`, `ACCEPTED_ON_L1`.
  - Event contains Prism ID `0x1`, venue `BASE`, and the same execution-account key.
- Historical `resolve(0x1, BASE)` at block `14017479` returned `[0x0, execution_account]` (`ActiveDestination`).
- Historical `resolve(0x1, BASE)` at block `14017549` returned `[0x1]` (`NoActiveDestination`).
- Current `resolve(0x1, BASE)` also returns `[0x1]`.

This directly re-observes the bind → active resolve → revoke → empty resolve tail and its identity persistence prerequisite. It does not by itself prove the offchain Base proof verifier ladder or adversarial rejection cases.

## Runner/preflight results

- `node ops/target-network/validate.mjs`: PASS; testnet accepted, mainnet release-gated.
- `node ops/starknet/validate.mjs`: PASS; templates secret-free.
- `node ops/starknet/dry-run-check.mjs`: PASS; dry-run gate intact.
- `node ops/m1-live-read/validate.mjs --self-test`: PASS (`valid=true`, `promotable=true`, `maturity=X3`).
- M3 live runner was invoked with explicit testnet, chain ID `84532`, V2 registry/version, public controller/registry/RPC configuration. It stopped before any broadcast with:
  - `M3_BLOCKED_BY_SIGNING_ENVIRONMENT`
  - missing Starknet controller/deployer signing provider and Base signing provider.
  - No receipt was fabricated.
- M3 offline self-test could not start in the fresh worktree because dependencies are not installed there (`Cannot find module 'vitest/config'`). This is an isolated-worktree tooling prerequisite, not live-chain evidence.

## Blockers / unobserved requirements

The requested new decisive broadcast sequence was **not** run because the protected Starknet account file is not accepted by the existing M3 runner as a live signing provider and no Base signer provider is present in the environment. Consequently, this run did not perform:

- fee dry-runs / nonce capture for new bind or revoke transactions;
- a new Base challenge signature and live EOA → EIP-1271 → ERC-6492 ladder;
- live replay, expiry, altered-field, wrong-controller rejection attempts;
- new bounded broadcasts or receipt waits;
- a fresh post-run explorer URL / independent transaction read for newly broadcast transactions;
- durable V2 projection/reconciliation or restart evidence.

The existing recorded V2 bind/revoke facts remain valid direct testnet observations, but current maturity is limited to X3 direct live identity/M3 state evidence, not X4 repeated/reproduced closure. Existing ledger rows EVD-PRISM-005..007 were not changed.

## Files

- Created: `IDENTITY_BINDING_CLOSURE_REPORT.md`.
- No product code, `strk20.json`, deployment metadata, or protected artifacts modified.
