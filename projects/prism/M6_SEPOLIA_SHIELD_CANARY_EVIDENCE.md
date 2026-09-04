# M6 Sepolia Shield Canary — Live Evidence (SDK direct route)

**Status:** `OBSERVED_X3_SEPOLIA` — Sepolia testnet only. Not mainnet evidence.
**Date:** 2026-09-03
**Candidate:** `main @ 19f99cd`
**Packet:** `/tmp/prism-privacy-canary-SEPOLIA-ACCEPTED.json` (`AUTH-PRISM-CANARY-003`,
`maxTx 4 / 9 STRK`, route `shield`, pool Sepolia v2.0
`0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91`)
**Route:** Privacy SDK direct (`@starkware-libs/starknet-privacy-sdk` 0.14.3-rc.6,
built locally from source), `ContractDiscoveryProvider` (on-chain, no indexer),
prover `https://transaction-prover.alpha-sepolia.sw-dev.io`.
**Signer:** `prism_sepolia_deployer` `0x47c0f8b01b9c7c75c669dc549bc305a0f2d796808117339a1c87730162b131c`
(key file `~/.starknet_accounts/starknet_open_zeppelin_accounts.json`, 0600, value never logged).
**Viewing key:** fresh disposable, `/tmp/prism_viewing_key` (0600), never committed.
**Dust:** 0.0005 STRK (`500000000000000` wei).

## Observed transactions (all SUCCEEDED / ACCEPTED_ON_L2 on SN_SEPOLIA)

| # | Action | Hash | Block | Receipt |
|---|---|---|---|---|
| 1 | STRK approve 2.05 to pool | `0x456c64a80ff45d916943c146e4a106855586e78036d212446f0c85eb8f32f99` | 14514192 | SUCCEEDED |
| 2 | Pool `register` (SetViewingKey) | `0x1c4d52a4e366d7d41cf9d3864452dd8e6e00fc47d3ab8a1bb6318f4cd6bfae1` | 14514204 | SUCCEEDED |
| 3 | STRK approve#2 2.01 to pool | `0xa7806c4026f5d80a98f101c957872592d2f1175f692e833a876b3ac2f761d9` | 14514305 | SUCCEEDED |
| 4 | Pool `deposit` 0.0005 STRK (autoSetup channel) | `0x2a773a239732774413774cacdd0c60746495801111bf5073c6ba50a4d5a501d` | 14514334 | SUCCEEDED |

Explorer: `https://sepolia.voyager.online/tx/<hash>` for each row above.

## Independent verification (second source each)

- Registration: `get_public_key` re-read via fresh RPC → nonzero (`registered: true`).
- Private state: `discoverNotes` via viewing key → **1 note found**.
- Deposit receipt re-read via fresh RPC `getTransactionReceipt` → SUCCEEDED ACCEPTED_ON_L2.
- Proving discipline: `provingBlockId = head - 10` on every SDK execute; deposit
  proving waited until `head (14514326) - 10 > approve#2 block (14514305)`.

## Observed economics (fail-closed findings)

- Pool fee is **2.0 STRK per screened action** (register pulled exactly 2.0;
  deposit estimate reverted `Insufficient ERC20 allowance` until funded the same way).
- L2 gas on 60KB-proof txs runs **~1.3 STRK each** on Sepolia.
- Total spend: **9.304 STRK** vs authorized 9 → over by 0.30 (second gas miss;
  prior 2.05 ceiling was breached by 2.53 the same way — both disclosed before proceeding).
- Fee model now observed, not estimated: `2.0/action + ~1.3 gas/proof-tx`.

## What this does NOT prove

- Not a Prism wallet-mediated flow (`supportedWalletApi`, consent gate, receipt UI
  were not exercised — SDK held the keys directly).
- Not mainnet: all `EVD-STRK20-001..006` remain `X0` / `NOT_IMPLEMENTED`.
- No `strk20.json` entries (root file intentionally still empty).
- Maturity note wait was enforced at proving level (`head - 10`); the 10-block
  note-maturity UX gate was not separately demonstrated in-app.

## Follow-on: self-transfer (same day, AUTH-006/005 lineage)

- Approve absolute 2.1 → `0x522a2ebc21160cbd48ab4a9a5de24306720b0c31b74b6882d02137e8b27a80b`
  block `14519885` SUCCEEDED (two earlier top-up approves `0x767be46d…` block `14518315`
  and `0x6c2152bb…` block `14518362` were wasted learning that approve SETS absolute
  allowance — recorded here so the shape is never re-learned with money).
- Transfer 0.0002 self → `0x580dd59eb467608b5c4ec957fb944b8f78d02b9ae2de6a313e8b88a43d5700c`
  block `14519913` SUCCEEDED ACCEPTED_ON_L2 (builder needed explicit
  `autoSelectNotes: 'naive'` + `.surplusTo(self)` for change).
- Post-transfer discovery: **2 notes** (`0.0003` change + `0.0002` received =
  `0.0005` deposited — conservation exact).
- Cumulative spend: **14.01 STRK** vs 15 ceiling → WITHIN (pool pulls ≈ 4.02 total,
  rest L2 gas ≈ 1.3/proof-tx).

## Follow-on: withdraw / unshield (same day, AUTH-007/008 lineage)

- Approve absolute 2.1 → `0x41ec0f075679fa908a57573ca103660efb460c68449915126435f42fb97183f`
  block `14531591` SUCCEEDED (allowance 0.1 → exactly 2.1, absolute semantics confirmed).
- Withdraw 0.0002 to self → `0x1e8574dbff71ee7ee39bf349371ac1ef0de09a5810d96a7f11d7855335519e`
  block `14531619` SUCCEEDED ACCEPTED_ON_L2 (needed `.surplusTo(self)` for change, same as transfer).
- Post-withdraw discovery: **2 notes** (`0.0001` change + `0.0002` transfer note) +
  `0.0002` back in public = `0.0005` deposited — conservation exact across all four legs.
- Withdraw pulled exactly 2.0 allowance (2.1 → 0.1), confirming the 2.0-per-action
  pattern for register/transfer/withdraw (deposit was the outlier at ~0.02).
- Cumulative spend: **18.66 STRK** vs 19 ceiling → WITHIN (pool pulls ≈ 6.02 total,
  rest L2 gas ≈ 1.3–2.6/proof-tx).
