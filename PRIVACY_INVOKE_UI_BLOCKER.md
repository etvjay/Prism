# Privacy invoke UI closure blocker

**Status:** `BLOCKED_BY_EXTERNAL_PRIVACY_PROVIDER`
**Maturity ceiling:** `X2 + narrow X3 helper leg`. This change does not promote M5.

## Scope checked

- Route is hard-coded to `SN_SEPOLIA` and the existing production-candidate helper, STRK, vToken, and privacy pool constants.
- The UI is available at the existing session demo surface (`?demo=session`) and uses the existing provider-injected `M5VesuRunner`.
- No mainnet configuration or `strk20.json` was changed.

## Current local evidence

- `/home/ubuntu/.starknet_accounts/starknet_open_zeppelin_accounts.json` exists with mode `0600` and contains an `alpha-sepolia/prism_sepolia_deployer` account marked deployed. This is CLI account custody metadata, not a browser WalletAccountV6 or privacy prover session.
- `/home/ubuntu/.config/foundry/prism.env` exists with mode `0600`, but its safe variable inventory contains only `LINEAR_API_KEY` and `NOTION_API_KEY`. No wallet, RPC, prover, or privacy-session variables were present.
- No wallet-standard provider is available to the Node process. The browser UI can only obtain one after a user-controlled injected wallet is discovered and connected.
- No STRK20 prover/session adapter is available in protected local artifacts. The existing `WalletV6M5Adapter` intentionally does not fabricate registration, fee, proof, private-note, or maturity observations.

## Exact live blocker

A live `privacy_invoke` closure requires all of: a user-controlled browser `WalletAccountV6`, a real STRK20/SNIP-36 prover session, an authorized `SN_SEPOLIA` privacy route, a fee dry-run, one bounded submission, terminal receipt, and independent RPC readback including note/maturity/conservation predicates. The current environment supplies only a protected CLI account file and no injected wallet/prover/session, so no live operation was attempted and no receipt, balance, note, maturity, or success is claimed.

## Re-entry sequence

1. Connect a user-controlled WalletAccountV6 on `SN_SEPOLIA` through the existing session surface.
2. Confirm the wallet exposes the pinned STRK20 capability and a real prover.
3. Confirm exact fee dry-run and route preflight.
4. Obtain explicit authorization for one bounded test operation.
5. Record the wallet receipt and independently read the same transaction through the configured RPC path, then verify note/maturity/conservation and validator predicates.
