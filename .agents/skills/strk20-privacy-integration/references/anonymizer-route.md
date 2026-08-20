# Route: Anonymizer contracts (DeFi protocols) — buildable now (reference examples public)

App-specific helper contracts that make private DeFi flows work. If the privacy goal involves protocol actions — lend, stake, LP, vault deposit/withdraw, escrow — the Wallet API alone is not enough. **DeFi almost always needs both**: the Privacy Wallet API (to reach the user's wallet) *and* an app-specific anonymizer contract (to do the protocol action). Never present private DeFi as zero-code pool composability.

## Before you build one: check whether the protocol already ships a private path

Writing an anonymizer is the most expensive route in this skill — it is Cairo the
team owns, audits, deploys and maintains. Spend twenty minutes checking whether
someone has already done that work before committing to it.

The privacy stack is moving quickly and protocols are shipping first-party private
integrations. AVNU, for example, ships **private swaps** end to end
(`@avnu/avnu-sdk >= 4.2.0`, https://docs.avnu.fi/docs/privacy): their executor is
deployed, their SDK composes the `privacy_invoke` flow, and the user's wallet does
the proving — so a dapp that needs "swap privately" needs **no Cairo at all**.

Check in this order:
1. The protocol's own docs for a privacy section. If they publish `llms.txt`,
   fetch that first — it indexes every page and beats crawling the site.
2. Their SDK's exports for privacy-shaped names (`private`, `shielded`, `strk20`).
3. The reference packages in the SDK monorepo — where you land if nothing exists.

If a first-party integration exists, plan on it: the team skips the contract, the
audit and the deployment, and inherits maintenance from the protocol. Only fall
through to writing your own when the action genuinely has no private path, and say
so explicitly in the plan so the team understands why they are taking on a
contract.

## The model

The pool calls the anonymizer contract **atomically** as part of the user's transaction, through one mandatory entrypoint: **`privacy_invoke`**. The flow:

1. The pool withdraws the input tokens to the anonymizer.
2. The anonymizer performs the protocol action (swap, lend, vault deposit, …).
3. It returns the output tokens, which the pool credits back to the user as private notes.

If anything reverts, the entire operation rolls back — funds return to the pool, no tokens stranded. One external invoke per private transaction, executed as the final step.

**What this hides**: the user's address behind the DeFi action. **What may stay public**: the amounts and the app activity itself. Say so in the plan.

## Ownership — non-negotiable

StarkWare ships *reference examples*. The app team owns its production anonymizer contract end to end: review, audit, deployment, and maintenance. Every Branch B plan must include an audit step before mainnet, owned by the team.

## Status and references

Reference examples are **public** in the Privacy SDK monorepo (open-sourced Jul 8, 2026): https://github.com/starkware-libs/starknet-privacy — official resource. Verified package paths:

- `packages/ekubo_swap_anonymizer` — **single-hop DEX swap** anonymizer (Ekubo), full-swap-only.
- `packages/vesu_lending_anonymizer` — **ERC-4626/SNIP-22-style vault** anonymizer (Vesu lending, deposit/withdraw) — intentionally lean; treat it as a skeleton to adapt, not a drop-in template.

A third public first-party pair lives outside the monorepo, in the **Privacy Bridge** (https://github.com/starkware-libs/privacy-bridge, Apache 2.0), under `packages/bridge-anonymizers`:

- `OutboundAnonymizer` — pool → Circle CCTP burn, the way value leaves the pool for an EVM chain.
- `InboundAnonymizer` — CCTP → pool. The reference for the **`privacy_compute` / `ComputeAndInvoke`** shape rather than plain `privacy_invoke`: the pool derives a commitment from the authenticated signer, then calls `privacy_invoke_with_computation`, which checks the attested message's hookData against it, mints, and hands the USDC to the pool as a fresh open note — mint and claim atomic, in one transaction. Read this one when a helper needs to bind an external attestation to a note without ever revealing a secret onchain.

The bridge is early (0.1.x) and moving; treat both as reading material, and the same ownership rule applies to anything a team derives from them.

SDK quickstart (for the dev/test path below): https://github.com/starkware-libs/starknet-privacy/blob/main/sdk/README.md

## The build sequence (map onto the plan's phases)

1. **Ship the Wallet API basics first** (`references/wallet-api-route.md`): shield/transfer/unshield/swap need no anonymizer and get users into the pool.
2. **Design the anonymizer on paper**: for each protocol action, specify input token(s) → action → output token(s) in the withdraw→act→re-shield shape; note approvals needed and failure/rollback behavior. Map each action to a function in their existing Cairo contracts (name the files from the scan).
3. **Study the reference example nearest their use case** (paths above) and adapt it to their protocol action — the anonymizer is a normal Cairo contract, so the team's existing Scarb + Starknet Foundry setup (snforge tests, sncast deploy) is exactly what they'll use.
4. **Develop and test via the SDK-direct path on testnet** — in dev the *team* controls the account and keys, so the SDK is appropriate there. **Production user flows still go through the Privacy Wallet API** — end users never expose viewing keys.
5. **Test atomicity**: action succeeds → outputs credited as private notes; action reverts → clean rollback.
6. **Audit** (owner, budget, timing — line this up early), deploy, then wire the dapp's Wallet-API flow to trigger the anonymizer.
