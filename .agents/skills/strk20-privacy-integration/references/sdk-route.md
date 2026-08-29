# Route: Privacy SDK direct (wallets & advanced integrators) — buildable now

The low-level route for teams that control their own account, prover, and viewing-key setup and want to interact with the pool directly instead of through a user's wallet.

**Who it's for**: wallets adding STRK20 support; backends that manage their own Starknet accounts *and can store the viewing key safely*; apps that want their own prover + account to send private transactions without a third-party wallet.

**Who it's not for**: normal end-user dapps. A dapp must never receive a user's viewing key — those integrate via the Wallet API route. If the interview reveals the "backend" actually acts on end-user funds with end-user consent through their wallets, that's the Wallet API route, not this one.

## What the SDK wraps

A TypeScript client (Apache 2.0) covering every step of working with STRK20 private notes:

- **Viewing key** registration
- **Channels and subchannels** (per-counterparty, per-token setup)
- **Proof generation** — builds the transaction sent to the prover, with a configurable proving backend (hosted service or self-hosted)
- **Proof submission** onchain to the pool contract
- **Discovery** — syncing notes/balances via an indexer (for holders of the viewing key)
- **Fluent builder** — composing multi-token, multi-action private transactions
- **History** — balance and transaction history for viewing-key holders

## Status and what to do today

**The SDK monorepo is public** (Apache 2.0, open-sourced Jul 8, 2026): https://github.com/starkware-libs/starknet-privacy — treat it as the official resource for this route. Start from the quickstart in **https://github.com/starkware-libs/starknet-privacy/blob/main/sdk/README.md** (don't restate it in the plan; link it — it supersedes anything this file says about setup). Package: `@starkware-libs/starknet-privacy-sdk` on the GitHub npm registry; **Node ≥ 24** required.

Also relevant:

- **Privacy Wallet API spec v0.10.3** — if the team is a wallet, this is the dapp-facing surface they'll eventually expose: https://github.com/starkware-libs/starknet-specs/releases/tag/v0.10.3
- **Prover Crate** (open source) — for teams planning self-hosted proving: https://github.com/starkware-libs/sequencer/tree/main/crates/starknet_transaction_prover
- **Whitepaper**: https://eprint.iacr.org/2026/474

Design questions the plan must still answer before the first line of SDK code: account and key-custody design (where the viewing key lives, who can read it), proving strategy (hosted service vs self-hosted — self-hosting is an infra commitment and is **still subject to onchain deposit screening**, never a workaround), and which flows to build first (register → shield → private transfer is the canonical first flow).

## Executing this route (Step 5)

At each phase handoff use the **SDK route** manual checklist in `references/execute.md` (env/key-custody check first — no secrets in the diff, ever). By-example pages to link: https://strk20-by-example.org/sdk/getting-started, https://strk20-by-example.org/sdk/setup-requirements, and the per-operation pages (`/sdk/register`, `/sdk/deposit`, `/sdk/transfer`, `/sdk/withdraw`, `/sdk/proving-config`, …) as each flow comes up.

## Sub-accounts (Branch D) — SDK ships, Wallet API pending

Private sub-accounts are the path for acting through real Starknet accounts with **no public onchain link** to the user's main wallet or to each other — buildable on the SDK today, with the Wallet API route still ahead (see Status below). Intended result: everyday DeFi — borrowing, staking, swapping — with the user↔account link hidden, while the dapp action and amounts may still be public.

Planned flow: wallet shields funds into the pool → a sub-account anonymizer creates and directs sub-accounts → each sub-account interacts with dapps like a normal account → funds return to the pool, shielded again.

**Status** (verified against the monorepo 2026-07-27 — this moved recently, re-check it):

- **SDK route: buildable, on a release candidate.** `@starkware-libs/starknet-privacy-sdk@0.14.3-rc.4` ships `transfers.build().subaccounts(dappName)` returning a `SubAccountsBuilder`, whose `invoke(nonce, { calls, collectPolicy })` queues a `ComputeAndInvoke` against the sub-account anonymizer. `SubAccountAnonymizerABI` is exported from the package entry point. It needs the new `subAccountAnonymizerAddress` field in the `createPrivateTransfers` config — calling `subaccounts(...)` without it throws. Note `identify()` and `deployed()` are declared but **not yet implemented**, and this is an RC: fine for a team that controls its own accounts and can track the API, not something to promise an end-user product on.
- **Wallet API route: still nothing.** Neither `@starknet-io/types-js@0.10.3` nor starknet.js exposes a sub-account method, so a dapp that relies on the user's wallet still cannot do this. The extra Wallet API call is still on the way.

The split matters when routing: a wallet/infra team on the SDK can start; a normal dapp cannot.

**What a plan does with Branch D**: depends which side of that split the team is on. A team already on the SDK route, holding its own keys, can prototype sub-accounts today against the RC — say plainly that it is an RC with unimplemented builder methods. A dapp on the Wallet API route still scopes and tracks: identify which flows want unlinkable accounts (private collateral positions, private staking), note them as candidates with an entry criterion ("when the Wallet API exposes sub-accounts"), and route everything buildable today through Branches A–C. Do not name specific partner protocols as launch examples.
