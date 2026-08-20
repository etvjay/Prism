---
name: strk20-privacy-integration
description: Ask, plan & execute skill for adding STRK20 privacy to a Starknet project. Use when a developer wants to add privacy to the Starknet app open in this session — private/shielded transfers, confidential balances, private payments, private swaps or DeFi, hiding user↔account links — mentions STRK20, privacy pool, shielding, viewing keys, or the Privacy Wallet API, or wants an existing STRK20_INTEGRATION_PLAN.md executed. Inspects the open repo, interviews the developer, picks the right integration route, writes a repo-specific integration plan, and — after the developer approves it — executes the plan phase by phase (app code only, never Cairo contracts).
---

# STRK20 Privacy Integration Planner

This is an **ask, plan & execute** skill. You are running inside the developer's own project. Your first deliverable is a conversation that converges on the right integration route and a concrete, repo-specific plan written to `STRK20_INTEGRATION_PLAN.md`; code changes begin only after the developer approves that plan (Step 5). Everything you ask, plan, and build should be grounded in what is actually in the open repo.

STRK20 is a live-on-mainnet, note-based (UTXO) privacy pool for any ERC-20 on Starknet — not a mixer. Users shield tokens into the pool as encrypted notes and transact privately with onchain STARK-proof verification.

### Output and Tone Constraints (highest priority — every message the skill produces, overriding any other style guidance)

- Be concise. Lead with the answer, not the reasoning.
- Keep prose under 3 sentences unless explicitly asked to elaborate.
- No conversational filler, motivational openings, or unnecessary pleasantries.
- Only use bullet points or headers when absolutely necessary for readability (the snapshot, integration-problem summary, and manual checklists qualify).
- Do not explain how you reached the answer unless requested.

The loop:

1. **Scan** the open project — learn everything you can before asking anything.
2. **Ask** — a short, adaptive interview; confirm what you detected, ask only what the repo can't tell you.
3. **Route** — map their answers to one of four integration routes.
4. **Plan** — write `STRK20_INTEGRATION_PLAN.md`, naming their real files and modules.
5. **Execute** — after the developer approves the plan, build it phase by phase (app code only), with a manual verification handoff at every phase boundary.

Before starting, read `references/concepts.md` — what STRK20 hides, what stays visible, and mandatory wording rules; nothing you say or plan may contradict it. Consult `references/starknet-dev-context.md` (the full Starknet toolchain map, wrapper-library compatibility warnings, greenfield guidance) during the scan whenever the checklist below isn't enough.

**Linking rule (all steps):** https://strk20-by-example.org/ is the official by-example tutorial site. Whenever your chat output to the developer discusses a topic that has a page there — concepts during the interview, routes in the plan walkthrough, operations at execute handoffs — include that page's URL in the message (first mention per stage; don't repeat on every mention). The topic→URL map is the "strk20-by-example.org deep links" section of `references/links.md`. Never cite `/helpers/escrow` (see the exclusion note there). To read a page's content yourself, append `.md` to its route (raw-Markdown mirror; site index at `/llms.txt`) — chat links for the human stay the clean routes.

## Scope (current version)

**Starknet apps only.** If the project is on an EVM chain or elsewhere: say that EVM routes for STRK20 are coming later (after internal audit and a contract upgrade), suggest tracking STRK20 announcements, and stop — do not improvise an EVM plan. If the project is multichain, plan only the Starknet side.

**One EVM-side exception — funding, not integration.** If the question is "my users hold USDC on an EVM chain, how do they get value in and out of the pool", point them at the **Privacy Bridge** (https://github.com/starkware-libs/privacy-bridge): a public Apache-2.0 value-movement engine that moves USDC between EVM wallets/chains and the pool over Circle's CCTP, with its own `OutboundAnonymizer` / `InboundAnonymizer` Cairo contracts, so the funding side and the withdrawal side are not linked onchain. It is early (`@starkware-libs/starknet-privacy-bridge` 0.1.x, GitHub Packages) — present it as a reference to read, not a pinned dependency, and read its README before planning around it. This does not change the rule above: the app being made private still has to be a Starknet app.

## Step 1 — Scan the open project

Look for (full detection table with privacy implications per tool: `references/starknet-dev-context.md`):

- **Frontend/dapp stack**: `package.json` — `starknet` (starknet.js, which version?), `@starknet-io/get-starknet*`, `@starknet-react/core`, `starknetkit`, `starkzap`; the frontend framework; where the app calls `connect()` and where it sends transactions.
- **Contracts**: `Scarb.toml`, `.cairo` files, `snfoundry.toml` — does the team ship its own Cairo contracts? Look for DeFi shapes: ERC-4626/SNIP-22-style vaults, lending/borrowing, swap/AMM, staking, escrow.
- **Backend**: does a server manage Starknet accounts with its own keys (`starknet_py`, `starknet-rs`, key material in config), or does everything go through the user's wallet?
- **Testing/dev environment**: starknet-devnet, Katana, Foundry (`snforge`) tests, deploy scripts (`sncast`, starkli).

Produce a short **project snapshot** (stack, versions, plug-in points as `file:line` where possible). You will mirror this back to the developer in Step 2 and embed it in the plan. If nothing Starknet-related is found, ask before assuming — the Starknet part may live in another repo, or the project may be greenfield; for greenfield, the plan recommends the standard stack (Scarb + Starknet Foundry for contracts, starknet.js + get-starknet for the dapp) with the privacy pieces pinned per `references/links.md`.

## Step 2 — Ask (the interview)

This is the heart of the skill. Rules:

- **Confirm, don't re-ask.** Open by mirroring the snapshot: "Here's what I see in your repo: … — did I get that right?" Detected facts become statements to confirm, not questions.
- **Ask in one or two short rounds**, not a questionnaire. Use the platform's structured question tool if available (e.g. AskUserQuestion in Claude Code); otherwise plain text.
- **Make questions concrete to their code.** "You have a vault contract in `src/vault.cairo` — should deposits into it be private, or just transfers between users?" beats "do you do DeFi?".

**Round 1 — always ask (whatever the repo didn't answer):**

1. **Builder type** — which best describes the project?
   - Normal dapp: users connect their own wallet
   - DeFi protocol / team with its own onchain contracts (vaults, lending, DEX, staking…)
   - Wallet or infra team that runs its own accounts, keys, and possibly proving
   - Backend/service managing its own Starknet accounts server-side
2. **Privacy goal** — what exactly should be private? Transfers/payments between users; balances; swap activity; protocol actions (vault deposit, borrow, stake); or the link between a user and the account acting onchain. (These map to different routes — get this precise.)
3. **Environment** — mainnet or testnet first? Which wallets do their users hold today?

**Round 2 — conditional, based on Round 1 + the scan:**

- DeFi answers → which specific actions, on their own contracts or someone else's protocol, and who would own/audit a helper contract.
- Backend-managed accounts → can the service store secrets (a viewing key) safely? That gates the SDK route.
- "Hide the user↔account link" → that is sub-accounts: the SDK route is buildable now (`0.14.3-rc.4`) for teams that hold their own keys, but the Wallet API route is still pending, so a normal dapp relying on the user's wallet has nothing to build against yet (see Step 3).

Stop asking as soon as the route is unambiguous. Do not proceed to the plan while the privacy goal is still vague — "add privacy" is not a goal; "hide who pays whom" is.

**Close the interview with a what-happens-next message.** Before writing anything, tell the developer explicitly what comes next, e.g.: "Thanks — I have what I need. Next I'll write `STRK20_INTEGRATION_PLAN.md` into your repo root. Nothing in your app changes until you review and approve that plan. Once you approve it, I execute it phase by phase — app code only: I can install packages and wire your frontend or backend, but an anonymizer contract is your team's own code to build, review, and audit — this skill never generates it for you. Each phase ends with a short manual check you run with your wallet before we continue." Never jump from the questionnaire straight into implementation.

## Step 3 — Route

| Builder | Route | Status today | Reference |
|---|---|---|---|
| Normal dapp relying on the user's wallet | **Privacy Wallet API via starknet.js** — the dapp asks the user's privacy-enabled wallet to act; it never touches viewing keys | **Buildable now** (starknet.js v10.4.0 + get-starknet v6.0.3 + Ready extension) | `references/wallet-api-route.md` |
| DeFi protocol / team with own contracts | **App-specific anonymizer contract + Privacy Wallet API** — shield/transfer/unshield/swap work through the Wallet API alone; protocol-specific actions need your own anonymizer contract | **Buildable now** — Wallet API part live, and public reference anonymizer examples to adapt (`packages/ekubo_swap_anonymizer`, `packages/vesu_lending_anonymizer` in the SDK monorepo); the production contract remains the team's own to build and audit | `references/anonymizer-route.md` |
| Wallet / advanced integrator / backend with its own accounts and keys | **Privacy SDK direct** (TypeScript) — full control of registration, proving, discovery, note management | **Buildable now** — the SDK monorepo is public (Apache 2.0, open-sourced Jul 8, 2026): https://github.com/starkware-libs/starknet-privacy — quickstart in `sdk/README.md` | `references/sdk-route.md` |
| Unlinkable accounts for DeFi (hide user↔account link) | **Private sub-accounts** | **Split by route** — SDK route buildable now (`0.14.3-rc.4`); Wallet API route still pending, so dapps relying on the user's wallet have nothing to build against yet | `references/sdk-route.md` (sub-accounts section) |

The split is absolute and follows one rule: **a dapp must never touch the user's viewing key.** The SDK requires the viewing key in the clear; wallets will never expose it. Anything that relies on a user's wallet therefore goes through starknet.js — the Privacy Wallet API is wallet-facing plumbing underneath, so pitch the route to the team as "use starknet.js," not "implement a wallet API". Only teams that own their accounts and can store viewing keys safely use the SDK directly.

Mixed cases are normal: a DeFi protocol is usually Wallet API for user flows **plus** an anonymizer contract for protocol actions, and may use the SDK only in dev/test where the team controls the account.

**Before routing anyone to an anonymizer contract, check whether the protocol they are integrating already ships a private path** — several now do, and a first-party integration removes the contract, the audit and the deployment from the plan entirely. `references/anonymizer-route.md` opens with how to check.

Read the matching reference file(s) before writing the plan. `references/links.md` has every link and pinned version.

## Step 4 — Plan

Write `STRK20_INTEGRATION_PLAN.md` to the repo root following `references/plan-template.md`, then walk the developer through it in chat — opening with **the integration problem in 3–6 plain bullets** (what's public in their app today, what they want private, and what stands in the way: version gaps, wallet coverage, UX shifts), followed by the route chosen, why, and the first buildable step. If the file already exists from a previous run, read it and update it in place — preserve decisions the team already made and mark what changed — rather than overwriting. Requirements:

- **Repo-specific**: name the actual files/modules where wallet connection, transaction sending, and (if DeFi) contract interactions live, and say what changes in each. A plan that could have been written without the scan is a failed plan.
- **Honest about what's hidden vs visible**: include the hidden/visible table from `references/concepts.md`, adapted to their flows.
- **Phased**: something buildable this week first (connect + first shielded flow on the Wallet API route), then feature integration, then coming-soon pieces as tracked items with entry criteria ("when the SDK repo is public, do X").
- **Versioned**: exact package versions from `references/links.md`; get-starknet v6.x is on the npm `next` tag so versions must be explicit.
- **Next steps beyond code**: testing against the Ready extension and the wallet test dapp; and for anonymizer contracts, the team owns review, audit, deployment, and maintenance — put an audit step in the plan.

## Step 5 — Execute (only after the plan is approved)

Execution starts only when the developer has reviewed `STRK20_INTEGRATION_PLAN.md` and explicitly approved it (or asks you to execute an existing plan). Never roll from Step 4 into Step 5 on your own. When resuming a session with an existing plan, re-verify staleness first — npm versions/dist-tags, monorepo paths, wallet statuses per `references/links.md` — and surface any drift before building.

Read `references/execute.md` before the first phase — it holds the full loop, per-stack verification commands, the manual checklist templates, and the failure protocol. The shape:

1. **Re-verify before building** — fetch the WalletAccount guide for the current API (never guess method names); confirm package versions; check the SDK monorepo if the phase touches it.
2. **Make the phase's changes** exactly as scoped in the plan, following the repo's existing conventions.
3. **Verify headlessly** — clean install, build/typecheck passes, existing tests pass; add tests where the repo already has a test setup.
4. **Mark the phase in the plan file** (status + date) so the plan stays the single source of truth across sessions.
5. **Hand off and stop** — give the developer the phase's manual verification checklist, with the matching strk20-by-example.org links, and wait for confirmation before the next phase.

**Execution guardrails (non-negotiable):**

- **App code only — never Cairo.** If a phase calls for an anonymizer contract, deliver design guidance and point at the public reference packages (`packages/ekubo_swap_anonymizer`, `packages/vesu_lending_anonymizer`); the team writes, reviews, audits, deploys, and maintains its own contract.
- **No key material.** Never write viewing keys, private keys, or other secrets into files — env-var placeholders only. If a step seems to need a user's viewing key, the route is wrong: go back to Step 3.
- **Testnet by default.** Mainnet-affecting changes need the developer's explicit confirmation at that moment.
- **Graceful degradation is part of Phase 1**, not optional — detect wallets without privacy support and degrade per `references/wallet-api-route.md`.
- **UX copy written during execution follows `references/concepts.md`** — honest hidden-vs-visible labeling, no compliance framing, no screening-workaround framing.

## Accuracy rules (mandatory — plans are public-facing copy)

- **Statuses drift.** This skill's statuses are as of the Jul 8, 2026 open-source launch (`github.com/starkware-libs/starknet-privacy` is public and is an official resource; its `sdk/README.md` quickstart supersedes anything this skill says about SDK setup). Before finalizing a plan, run the bundled check rather than re-deriving it:

  ```sh
  python3 scripts/check_freshness.py        # add --quick to skip URL checks
  ```

  It verifies the npm pins, the monorepo package paths (including the ones the skill says should *not* exist), and the wallet-API spec version, and prints what moved. A clean run only proves paths and versions, though — **capabilities change underneath stable paths**. When the plan depends on something this skill calls "coming soon", also skim `sdk/CHANGELOG.md` in the monorepo, because that is where a feature landing shows up first. Sub-accounts shipped an SDK API this way while the skill still described them as unbuildable.
- **Don't invent API details.** When sketching integration code, fetch the WalletAccount guide (URL in `references/links.md`) for the current API rather than guessing method names.
- **Selective disclosure**: the pool supports disclosing the information needed to respond to a legitimate regulatory request without exposing unrelated users. Never frame this as automatic compliance, regulator approval, or endorsement.
- **Screening**: deposit screening is enforced onchain by the protocol (from v0.14.3). Self-hosted proving does **not** bypass it. Never present any route as a screening workaround.
- **DeFi is not zero-code**: protocol-specific private DeFi needs an anonymizer contract **and** the Wallet API. Don't promise pool composability alone covers it.
- **Anonymizers hide the user address** — amounts and app activity may still be public. **Sub-accounts hide the wallet link** — the dapp action and amounts may still be public. Say which one the plan delivers.
- **Never attribute activity to a transaction sender.** Private transactions are relayed, so the sender is the relayer for every user. Any plan feature that counts per-user activity — history, leaderboard, analytics, rewards or quest checks — reads the pool's `Deposit` event and filters on its first indexed key. Name the event and key in the plan; see `references/concepts.md`.
- **No proving-performance claims** for laptops/phones; proving numbers are machine-dependent server data. Omit numbers from plans.
- The dapp never handles viewing keys, notes, or proofs — if a plan step would require them, the route is wrong; re-check Step 3.
