# Standard Starknet Dev Stack — detection map and privacy implications

STRK20 integration lands inside a normal Starknet project. Use this map to recognize the stack during the repo scan (Step 1) and to know what each detected tool means for the privacy route. General reference: https://docs.starknet.io/ (tools index: https://docs.starknet.io/learn/cheatsheets/tools).

## Detection checklist

| Look for | Tool | What it tells you |
|---|---|---|
| `package.json` → `starknet` | **starknet.js** — the canonical JS/TS SDK | The dapp's transaction layer. Note the version: STRK20 needs **v10.4.0+** (`WalletAccountV6`). |
| `package.json` → `@starknet-io/get-starknet*` | **get-starknet** — wallet discovery/connection bridge | The connection layer. STRK20 needs **v6.0.3** (npm `next` tag). |
| `package.json` → `@starknet-react/core`, `starknet-react` | **Starknet React** — React hooks over starknet.js | Connection + tx flows live in hooks/providers. Plug-in point is the provider/account layer; check which starknet.js version it pins and whether it surfaces a `WalletAccountV6`-compatible account. |
| `package.json` → `starknetkit` | **Starknetkit** — wallet connection kit (built on starknet.js) | Same as above: the kit owns connection; verify it can hand the app a v6-style wallet account before assuming the recipe drops in. |
| `package.json` → `starkzap` / `starkzap-native` | **Starkzap** — high-level TS SDK suite (wallets, tokens, DeFi: staking, swaps, lending, bridging) | A convenience layer above starknet.js. As of this writing its docs do **not** list STRK20 support — the STRK20 route still goes through starknet.js `WalletAccountV6` alongside it. Check current Starkzap docs (https://docs.starknet.io/build/starkzap/overview) before planning around it. |
| `Scarb.toml`, `.cairo` files | **Cairo + Scarb** — contract language + build toolchain/package manager | The team ships its own contracts → possible anonymizer-contract route (Branch B). Inspect contracts for DeFi shapes: ERC-4626/SNIP-22 vaults, lending, AMM/swap, staking, escrow. |
| `snfoundry.toml`, `snforge_std` dep, `tests/` with Cairo tests | **Starknet Foundry** (snforge test runner, sncast CLI) | Their contract test/deploy toolchain. Anonymizer contract work uses exactly this: Scarb build, snforge tests, sncast declare/deploy. |
| `starkli` scripts, deploy shell scripts | **Starkli** — CLI for queries/transactions | Alternative deploy tooling; same implication as sncast. |
| Devnet configs, `starknet-devnet`, `starknet-devnet-js`, `katana` | **Local devnets** | Their local test loop. Flag in the plan: STRK20 end-to-end flows need the pool, a privacy-enabled wallet, and proving — plan wallet-flow testing against the Ready extension + the wallet test dapp on a public network, not pure local devnet; check the (now public) SDK monorepo for current local-testing tooling before promising a devnet loop. |
| `requirements.txt` / `pyproject.toml` → `starknet_py` | **starknet.py** — Python SDK | A backend that signs/manages accounts in Python. Wallet-API support in Python is expected to follow the JS path; today the supported dapp path is starknet.js. A Python backend holding its own keys is an SDK-route (Branch A) candidate — but the Privacy SDK is TypeScript, so plan a Node (≥ 24) service around it or track Python support. |
| `Cargo.toml` → `starknet` crate | **starknet-rs** — Rust SDK | Same implication as starknet.py: backend-managed accounts → Branch A candidate. |
| Other SDKs: `starknet.go`, `starknet-jvm`, `starknet.swift`, `starknet.dart` | Multi-language SDKs | Note them in the snapshot; STRK20 client support outside JS is not available today — route user-facing privacy through the JS/wallet path. |
| `dojo` deps, Dojo config | **Dojo** — provable games/autonomous worlds framework | Still a Starknet app; user-facing privacy goes through the wallet route. Flag that game-specific flows need case-by-case thought. |
| Scaffold-Stark project structure | **Scaffold Stark** — dapp scaffold | Standard dapp; the scaffold's wallet-connection module is the plug-in point. |
| `chipi-sdk`, `cavos`, Dynamic SDK, Privy, Cartridge | **Embedded-wallet / AA infra** — social login, invisible wallets, gasless | These manage keys for the user. None are privacy-enabled today — the STRK20 wallet scope is Ready (extension, current) and Xverse (in progress); Braavos and Privy are likewise not prepared for STRK20. An embedded-wallet product that wants STRK20 is closer to the wallet/SDK route (Branch A — SDK now public) than the dapp route. |
| OpenZeppelin Cairo contracts (`openzeppelin` in Scarb.toml) | **OZ Cairo** | Standard contract components; no direct privacy implication, but confirms Cairo competence for Branch B. |

Also worth noting in the snapshot if seen: Walnut (tx debugging), Cairo Profiler/Lint, VS Code Cairo extension, contract verification setup — they don't change the route but tell you the team's maturity, which calibrates how much hand-holding the plan needs.

## How the stack maps to the integration

- **Frontend with get-starknet/starknet-react/starknetkit** → Branch C (Wallet API via starknet.js). Plug-in points: the wallet-connect module (upgrade to get-starknet v6.0.3 explicit versions) and the transaction layer (starknet.js v10.4.0 `WalletAccountV6`).
- **Own Cairo contracts doing DeFi** → Branch B on top of Branch C. Their existing Scarb/Foundry toolchain is reused for the anonymizer contract.
- **Backend holding keys (Python/Rust/Node services)** → Branch A candidate (Privacy SDK — public, TypeScript, Node ≥ 24). Ask whether it can store a viewing key safely before recommending.
- **Embedded-wallet/AA products** → closest to Branch A; the SDK repo is public, so this route is open to teams that own their accounts and keys.
- **Nothing Starknet-related found** → ask; the Starknet part may live in a different repo, or the team may be pre-code (then the plan is a greenfield recommendation: standard stack — Scarb + Starknet Foundry for contracts, starknet.js + get-starknet for the dapp — with the privacy pieces pinned per `references/links.md`).

## Version compatibility warnings to put in plans

- get-starknet **v6.x lives on the npm `next` tag** — `npm install` without an explicit version gets the older major. Always pin: `@starknet-io/get-starknet-discovery@6.0.3`, `@starknet-io/get-starknet-wallet-standard@6.0.3`, `@starknet-io/types-js@0.10.3`.
- If the repo pins an older starknet.js (v5/v6/v7-era), upgrading to v10.4.0 is a real migration step — call it out as its own task, not a footnote.
- Wrapper libraries (starknet-react, starknetkit, Starkzap) may lag starknet.js v10.4.0; verify their current compatibility on npm before promising a drop-in.
