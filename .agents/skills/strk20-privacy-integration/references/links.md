# Links & pinned versions

Single source of truth for the plan's Links section. Statuses as of the July 8, 2026 open-source launch of the Privacy SDK monorepo.

**Last re-verified 2026-07-29** (Privacy Bridge row added 2026-08-06) — every URL here resolves; the monorepo package paths still exist (and `packages/escrow` is still absent). Two things changed on re-verification: the get-starknet pins moved to 6.0.3, and the sub-account row is no longer uniformly "coming soon" — its SDK route ships as of `0.14.3-rc.4` while the Wallet API route is still pending. Re-run that check before finalizing a plan: the monorepo is under active development, so treat anything here older than a couple of weeks as unverified.

## Live now

| What | Where | Notes |
|---|---|---|
| STRK20 pool contract (mainnet, canonical) | https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a | The pool everything integrates with |
| Whitepaper | https://eprint.iacr.org/2026/474 | Protocol design |
| **Privacy SDK monorepo** (Apache 2.0, public) | https://github.com/starkware-libs/starknet-privacy | Open-sourced Jul 8, 2026. **Quickstart: https://github.com/starkware-libs/starknet-privacy/blob/main/sdk/README.md** — the repo's own README supersedes any expectations in this skill |
| Privacy SDK package | `@starkware-libs/starknet-privacy-sdk` | GitHub npm registry (not npmjs); **Node ≥ 24** required. Version `0.14.3-rc.4` in the monorepo as of 2026-07-27 |
| Privacy SDK signers subpath | `@starkware-libs/starknet-privacy-sdk/signers` | `Snip12CallSetSigner` + `Eip712CallSetSigner` — authorize pool invocations with legacy Starknet wallets or EVM (`Eth712Account`) wallets. SDK core stays signer-agnostic |
| **Privacy client package** (new) | `@starkware-libs/starknet-privacy-client` | v0.1.0, scaffolded Jul 2026: a `PrivacyWallet` seam over the wallet-type zoo plus an injectable Paymaster port with an **AvnuPaymaster** adapter. Early — check the monorepo before planning around it |
| **Privacy Bridge** (Apache 2.0, public) | https://github.com/starkware-libs/privacy-bridge | EVM ↔ pool value movement for USDC over Circle CCTP V2, so the funding and withdrawal sides stay unlinked onchain. Three parts: `packages/bridge-anonymizers` (`OutboundAnonymizer` + `InboundAnonymizer` Cairo contracts), `packages/bridge-core` (`@starkware-libs/starknet-privacy-bridge`, framework-agnostic TS engine + optional React hooks, GitHub Packages, 0.1.x), `apps/bridge` (demo). **Early — cite as a reference to read, not a pinned dependency**; its `CLAUDE.md` holds the architecture |
| Anonymizer reference examples | `packages/ekubo_swap_anonymizer`, `packages/vesu_lending_anonymizer` in the monorepo | Verified paths. Ekubo single-hop swap; Vesu lending deposit/withdraw. Skeletons to adapt, not drop-in templates — the team owns review + audit. (`packages/sub_account_anonymizer` also exists; the SDK route for sub-accounts is usable as of `0.14.3-rc.4`, but the Wallet API route is not — see coming soon) |
| starknet.js **v10.4.0** | https://github.com/starknet-io/starknet.js/releases/tag/v10.4.0 | Ships `WalletAccountV6` with STRK20 actions. STRK20-era releases are on the npm `next` tag (`latest` is still 10.0.x; `next` is 10.5.2 as of 2026-07-27) — later 10.5.x adds nothing STRK20-related, so pin ≥ 10.4.0 explicitly |
| WalletAccount guide (STRK20 with get-starknet v6) | https://starknet-js.com/docs/next/guides/account/walletAccount/#with-get-starknet-v6 | **Fetch this for the current API before writing code** |
| get-starknet **v6.0.3** | https://github.com/starknet-io/get-starknet | Install explicitly (npm `next` tag): `@starknet-io/get-starknet-discovery@6.0.3`, `@starknet-io/get-starknet-wallet-standard@6.0.3` |
| types-js **v0.10.3** | https://www.npmjs.com/package/@starknet-io/types-js/v/0.10.3 | Type definitions matching the Wallet API spec |
| Privacy Wallet API spec **v0.10.3** | https://github.com/starkware-libs/starknet-specs/releases/tag/v0.10.3 | Wallet-facing; dapps don't implement it. Latest stable — a v0.10.4-rc.0 exists but is a release candidate; capability checks should keep testing for >= 0.10.3 |
| **AVNU private swaps** (first-party) | https://docs.avnu.fi/docs/privacy | Shipped: `@avnu/avnu-sdk >= 4.2.0` exposes `executePrivateSwap` + `createStrk20WalletProver`; AVNU's executor is deployed and their paymaster relays. A dapp needing private swaps needs **no anonymizer contract of its own**. Requires a STRK20-capable wallet (wallet API >= 0.10.3) and the sell token already shielded |
| Wallet test dapp | https://starknet-wallet-account.vercel.app/ | Sanity-check wallet interactions |
| Prover Crate (open source) | https://github.com/starkware-libs/sequencer/tree/main/crates/starknet_transaction_prover | Self-hosted proving for advanced setups; subject to onchain screening like every route |
| Ready extension | — | Current privacy-enabled wallet to test against |
| Starknet docs | https://docs.starknet.io/ | General dev docs; tools index at https://docs.starknet.io/learn/cheatsheets/tools |

## Coming soon (verify before citing — check if already available)

| What | Expected | Check |
|---|---|---|
| Private sub-accounts — **Wallet API route only** | Re-checked 2026-07-27: the **SDK** now ships a sub-account API (`subaccounts(dappName).invoke`) in `0.14.3-rc.4`, so SDK-route teams can start — see `references/sdk-route.md`. What remains missing is the **Wallet API** call, so dapps relying on the user's wallet still cannot use them: neither `types-js@0.10.3` nor starknet.js exposes a sub-account method | Track announcements |
| Xverse dapp-facing Wallet API | In progress (as of mid-July 2026) | Re-check status |

## strk20-by-example.org deep links

https://strk20-by-example.org/ is the official by-example tutorial site. Whenever chat output to the developer discusses one of these topics, include the matching URL in the message (first mention per conversation stage; don't repeat on every mention). Routes verified against the site 2026-07-13, except the two Wallet API rows below (`private-defi`, `avnu-private-swaps`), added and confirmed via the site's build output 2026-07-29.

**Reading the site yourself:** routes are prerendered and return full HTML, but the `.md` mirrors are cleaner to parse. When *you* need a page's content, append `.md` to any route below (e.g. `https://strk20-by-example.org/starknet-wallet-api/starknet-js.md`) for the raw-Markdown mirror; `https://strk20-by-example.org/llms.txt` indexes all pages and `/llms-full.txt` is the whole site in one fetch. Links you drop in chat stay the clean routes — those are for the human.

| When you talk about… | Link |
|---|---|
| What STRK20 is / the pool model | https://strk20-by-example.org/what-is-strk20 |
| Notes, nullifiers, the UTXO model | https://strk20-by-example.org/notes-and-nullifiers |
| Viewing keys / encryption | https://strk20-by-example.org/viewing-keys |
| Channels & subchannels | https://strk20-by-example.org/channels-and-subchannels |
| Actions, phases, proofs | https://strk20-by-example.org/actions-and-proofs |
| Compliance, screening, selective disclosure | https://strk20-by-example.org/compliance |
| Builder-facing privacy overview | https://strk20-by-example.org/builder-privacy-overview |
| Wallet API route (Branch C) generally | https://strk20-by-example.org/starknet-wallet-api/overview |
| starknet.js wiring / `WalletAccountV6` | https://strk20-by-example.org/starknet-wallet-api/starknet-js |
| React apps / `useStrk20` hooks | https://strk20-by-example.org/starknet-wallet-api/starknet-start-hook |
| SDK route (Branch A) getting started | https://strk20-by-example.org/sdk/getting-started |
| SDK setup requirements | https://strk20-by-example.org/sdk/setup-requirements |
| SDK operations: register, deposit, transfer, withdraw, deposit-transfer-surplus, multi-op-batch, note-discovery, discovery-providers, proving-config | `https://strk20-by-example.org/sdk/<same-slug>` |
| Anonymizer anatomy / `privacy_invoke` (Branch B) | https://strk20-by-example.org/helpers/privacy-invoke |
| Swap anonymizer example | https://strk20-by-example.org/helpers/swap-helper |
| Lending/vault anonymizer example | https://strk20-by-example.org/helpers/vesu-lending-helper |
| Private DeFi through the Wallet API (open notes + invoke) | https://strk20-by-example.org/starknet-wallet-api/private-defi |
| Private swaps without an anonymizer (AVNU) | https://strk20-by-example.org/starknet-wallet-api/avnu-private-swaps |

**Caveat — `https://strk20-by-example.org/helpers/escrow`:** an unofficial worked example. The contract is not in the SDK monorepo and has no SDK helper functions. Cite it only as a pattern illustration, never as a shipped package.

## Support

- Cairo CoreStars Telegram: `@sncorestars`
