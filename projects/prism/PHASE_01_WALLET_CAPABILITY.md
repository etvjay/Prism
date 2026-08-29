# Prism Phase 1 — Wallet capability readiness

**Status:** Code complete; manual wallet gate pending  
**Date:** 2026-08-20  
**Build commit:** `6f6a138`  
**Linear:** [PRISM-5](https://linear.app/arcisdid/issue/PRISM-5/strk20-wallet-connection-and-capability-detection)

## Patch boundary

This phase hardens the user-mediated Starknet route only:

```text
get-starknet discovery
→ WalletAccountV6 / starknet.js 10.4.0
→ supported Wallet API/spec queries
→ explicit environment state
```

It does not implement shielding, private balances, transfers, contracts, or viewing-key access.

## Changes

- Added `src/features/wallet/walletState.ts` for version and network classification.
- Corrected the STRK20 capability threshold from `>=0.10.0` to `>=0.10.3`.
- Added explicit `SN_MAIN` / `SN_SEPOLIA` / `UNKNOWN` environment state.
- Added wrong-network UI state and expected-network configuration.
- Subscribed to Wallet Standard account/network changes and silently refreshes the WalletAccountV6 snapshot.
- Used Wallet Standard disconnect instead of clearing only local UI state.
- Kept capability detection free of `strk20Balances`, keys, notes, proofs, and seed phrases.

## Files

```text
.env.example
src/app/globals.css
src/features/wallet/WalletConnectionPanel.tsx
src/features/wallet/walletState.ts
STRK20_INTEGRATION_PLAN.md
```

## Verification

```text
./node_modules/.bin/tsc --noEmit   PASS
./node_modules/.bin/next build --webpack   PASS
git diff --check   PASS
```

`npm run typecheck` was not used as the final headless result because the shell encountered an environment-level network/approval disconnect before the command started; the repository-local TypeScript binary passed directly.

## Manual handoff

- [ ] Configure `NEXT_PUBLIC_STARKNET_RPC_URL` and `NEXT_PUBLIC_STARKNET_NETWORK=SN_MAIN`.
- [ ] Connect the Ready extension.
- [ ] Confirm the UI reports the observed chain and expected `SN_MAIN`.
- [ ] Confirm capability detection does not trigger a private-balance consent prompt.
- [ ] Confirm an unsupported wallet reports unsupported without exposing private actions.
- [ ] Switch account/network in the wallet and confirm Prism re-reads state.
- [ ] Disconnect and reconnect; confirm the UI does not retain stale authority state.

Wallet route references: [STRK20 Wallet API overview](https://strk20-by-example.org/starknet-wallet-api/overview), [starknet.js WalletAccountV6](https://strk20-by-example.org/starknet-wallet-api/starknet-js), [wallet test dapp](https://starknet-wallet-account.vercel.app/).

## Open limits

- No runtime wallet observation has been earned yet.
- G0 remains blocked on a user-controlled, funded, privacy-enabled wallet.
- The upstream `next` tags moved to get-starknet 6.0.4/6.0.5; re-verify before Phase 2 rather than silently upgrading this phase.
