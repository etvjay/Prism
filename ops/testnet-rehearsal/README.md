# Prism Testnet Rehearsal Artifacts

This directory contains the backend-only rehearsal inventory and a read-only
preflight harness. It does not deploy contracts, create wallets, fund accounts,
sign messages, invoke contracts, broadcast transactions, contact an RPC/provider,
write an evidence ledger, or write `strk20.json`.

## Files

- `endpoint-inventory.json` — machine-readable source/spec inventory for the
  identity, proof, binding, resolution, alias, STRK20, operation, receipt,
  intent, and Pause surfaces.
- `dry-run.mjs` — dependency-free offline validator for the accepted testnet
  target, the inventory, the OpenAPI paths, source route presence, and the
  redacted runtime configuration shape.

## Commands

Run from the repository root (the script also resolves the root from its own
location):

```bash
node ops/testnet-rehearsal/dry-run.mjs --environment testnet --self-test
node ops/testnet-rehearsal/dry-run.mjs --environment testnet --check-config
node ops/testnet-rehearsal/dry-run.mjs --environment testnet --require-config
```

`--check-config` inspects only whether named environment variables are present
and whether their shapes are valid. It never prints a value. The optional
`--require-config` form requires the non-secret runtime groups needed for a
future provider-backed rehearsal, but still performs no network I/O.

The harness intentionally rejects `--deploy`, `--broadcast`, `--live`,
`--invoke`, `--sign`, `--fund`, mainnet flags, signer flags, and evidence or
`strk20.json` write flags. A successful result is **
`PRISM_TESTNET_REHEARSAL_DRY_RUN_READY_X2`**: it is preparation evidence only.

See `projects/prism/TESTNET_REHEARSAL_PACKET.md` for the operator boundary,
backend/frontend sequences, failure and recovery gates, evidence fields, and
integration handoff.
