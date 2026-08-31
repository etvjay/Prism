# Prism Mainnet Preparation Handoff

**Status:** preparation only, not a deployment authorization
**Current track:** Core v1
**Repository:** Prism
**Evidence ceiling before live execution:** X2 local implementation

This handoff prepares the same Prism repository for a controlled mainnet decision. Core v1 is the current proposed release scope. STRK20 remains a first-class in-repository product expansion, with its own wallet, prover, privacy-state, pool, and submission evidence gates. Vesu, LayerZero, and PrismChannel remain visible future tracks and are not silently included in Core v1.

## Current proposed mainnet scope

```text
release_track: core_v1
environment: SN_MAIN + Base Mainnet
Starknet chain identity: SN_MAIN
Base chain ID: 8453
required contract identities:
  - PrismIdentityRegistry
```

The scope is still `PROPOSED` for mainnet. It does not authorize deployment, signing, broadcasting, or mutation of `strk20.json`.

## Protected inputs, never committed

Provide these only through the protected operator environment or secret manager. Do not paste values into chat, packets, logs, or repository files.

```text
PRISM_TARGET_ENV=mainnet
STARKNET_CHAIN_ID=SN_MAIN
BASE_CHAIN_ID=8453
STARKNET_RPC_URL=<protected SN_MAIN RPC URL>
BASE_RPC_URL=<protected Base Mainnet RPC URL>
STARKNET_MAINNET_KEYSTORE_PATH=<protected path>
BASE_MAINNET_SIGNER_PRIVATE_KEY=<protected reference or injected value>
```

The runtime must select the target environment explicitly. It must not fall back from `SN_MAIN` to `SN_SEPOLIA`, or from Base Mainnet to Base Sepolia.

## Before any live write

Run from a clean, frozen candidate:

```bash
git status --short --branch
git rev-parse HEAD
node ops/target-network/validate.mjs
node ops/starknet/validate.mjs
node ops/starknet/dry-run-check.mjs
node ops/release/validate-mainnet.mjs --self-test
npm run typecheck
npm test
npm run build
git diff --check
```

Then verify, without printing secrets:

```bash
printf 'target=%s\n' "$PRISM_TARGET_ENV"
printf 'starknet_chain=%s\n' "$STARKNET_CHAIN_ID"
printf 'base_chain=%s\n' "$BASE_CHAIN_ID"
test -n "$STARKNET_RPC_URL" && printf '%s\n' 'SN_MAIN RPC is set' || printf '%s\n' 'SN_MAIN RPC missing'
test -n "$BASE_RPC_URL" && printf '%s\n' 'Base Mainnet RPC is set' || printf '%s\n' 'Base Mainnet RPC missing'
```

Do not run a live command until the target values, owner decision, and signing scope match exactly.

## Required owner decision

Create and mirror an append-only mainnet decision that names:

```text
decision_id
status: ACCEPTED
decided_by
decided_at
signature or protected approval reference
selected_environment: SN_MAIN+Base Mainnet
approved_scope: Core v1
required_contract_identities: PrismIdentityRegistry
```

This decision is separate from the existing accepted testnet decision. A testnet acceptance cannot authorize a mainnet broadcast.

## Core v1 deployment order

1. Freeze the exact commit and verify the worktree is clean.
2. Confirm the accepted mainnet decision and explicit `core_v1` release track.
3. Confirm funded Starknet and Base Mainnet signers through public addresses and independent funding readbacks.
4. Run the supported `sncast` declaration/deployment dry-run with exact compiler, constructor, and profile inputs.
5. Obtain explicit authorization for the named live broadcast, including the exact network, contract, maximum transaction count, and spend limit.
6. Declare and deploy only `PrismIdentityRegistry` for the Core v1 scope.
7. Read back every deployment through the primary provider and a different provider or explorer:
   - address;
   - class hash or bytecode identity;
   - constructor and schema version;
   - deployment transaction;
   - block;
   - receipt status.
8. Execute the live Base ownership-proof and Starknet bind/resolve/revoke sequence only through a real provider-backed path. The existing offline harness and `m3-base-sequence.runner.mjs --live` preflight do not fabricate or substitute receipts.
9. Record each observed operation in an evidence envelope outside `strk20.json`.
10. Validate the packet with:

```bash
node ops/evidence/validate.mjs /path/to/core-v1-envelope.json --require-independent-read
node ops/release/validate-mainnet.mjs /path/to/core-v1-mainnet-packet.json
```

A Core v1 packet has no STRK20 submission transaction requirement. It must not claim the STRK20 sprint is satisfied.

## STRK20 submission track remains in this repository

A later `release_track: strk20_submission` packet must additionally prove:

```text
real supported Wallet API/prover session
→ real SN_MAIN STRK20 pool action
→ accepted receipt
→ private-state readback
→ conservation and failure/recovery evidence
→ independent verification
→ three distinct qualifying mainnet hashes
```

The three hashes must each be independently checked for successful execution and a STRK20 pool event. If contracts are declared, each final hash must also involve a declared Prism contract under the current hub validation logic. Do not copy Core v1 deployment receipts into `strk20.json`.

## Evidence packet locations

```text
ops/release/mainnet-release-packet.template.json
ops/release/SIGNER_FUNDING_PREFLIGHT.md
ops/evidence/envelopes/<observed-evidence>.json
projects/prism/EVIDENCE_LEDGER.md
strk20.json                         # submission artifact only, never a preparation log
```

Preparation artifacts must never contain private keys, RPC credentials, wallet exports, viewing keys, prover material, or connection strings with embedded secrets.

## Mandatory stop conditions

Stop without retrying when:

- the owner decision is missing, proposed, or targets the wrong environment;
- a provider or signer is unavailable or ambiguous;
- a contract address, class hash, constructor, or ABI is inferred rather than observed;
- a transaction is reverted, pending beyond the defined observation window, or has ambiguous delivery;
- the independent provider disagrees with the primary receipt;
- the operation would exceed the approved transaction count or spend limit;
- a testnet value appears in a mainnet packet;
- the only proof is a local fixture, dry-run, or worker report;
- a live result would require writing a secret or placeholder into the repository.

## Final release status meanings

```text
PREPARED_X2
  Local implementation and fail-closed preparation only.

TESTNET_PASS_X3
  Real testnet receipt plus independent readback for the named gate.

MAINNET_READY
  Exact accepted owner decision, required contract set, accepted deployments,
  independent reads, and all track-specific evidence are present.
```

No status above `PREPARED_X2` is valid until the corresponding receipts and independent reads exist.
