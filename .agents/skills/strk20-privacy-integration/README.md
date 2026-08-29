# strk20-privacy-integration

An ask, plan & execute agent skill (Claude Code / Codex-compatible) that kick-starts — and, once you approve the plan, builds — an STRK20 privacy integration for Starknet projects.

Drop it into the agent running in your project repo and ask it to "plan STRK20 privacy for this app." The skill:

1. **Scans your repo** — detects your Starknet stack (starknet.js, get-starknet, starknet-react, Scarb/Cairo contracts, Starknet Foundry, backend SDKs) and finds the plug-in points.
2. **Interviews you** — a short, adaptive set of questions (builder type, what exactly should be private, environment) instead of a generic questionnaire.
3. **Picks your route** — Privacy Wallet API via starknet.js (most dapps, buildable now), anonymizer contract + Wallet API (DeFi protocols, reference examples public), Privacy SDK direct (wallets/backends with their own keys, buildable now — the [SDK monorepo](https://github.com/starkware-libs/starknet-privacy) is open source), or private sub-accounts (SDK route ships on `0.14.3-rc.4`; Wallet API route still pending).
4. **Writes `STRK20_INTEGRATION_PLAN.md`** — phased, versioned, honest about what's hidden vs visible, naming your actual files.
5. **Executes on your approval** — builds the plan phase by phase (app code only; anonymizer contracts remain your team's own code to write and audit), with headless checks per phase and a short manual wallet check handed to you at every phase boundary. Chat output links the relevant https://strk20-by-example.org/ pages throughout.

Scope: **Starknet apps only** for now. On the roadmap for later versions: EVM wallet support, prediction-market-type (Polymarket-style) app flows, and frontend design guidance for privacy UX.

## Contents

- `SKILL.md` — the scan → ask → route → plan workflow and accuracy rules
- `references/concepts.md` — STRK20 mental model, hidden-vs-visible, wording rules
- `references/starknet-dev-context.md` — standard Starknet toolchain detection map
- `references/wallet-api-route.md` — the buildable-now dapp route
- `references/anonymizer-route.md` — the DeFi route
- `references/sdk-route.md` — the SDK route + sub-accounts
- `references/links.md` — all links and pinned versions
- `references/execute.md` — the Step 5 execution playbook (phase loop, verification, manual checklists, failure protocol)
- `references/plan-template.md` — the output plan template

Statuses baked into this skill are as of mid-July 2026, after the July 8, 2026 open-source launch of the [Privacy SDK monorepo](https://github.com/starkware-libs/starknet-privacy) ([quickstart](https://github.com/starkware-libs/starknet-privacy/blob/main/sdk/README.md)); the skill instructs the agent to re-verify fast-moving items (wallet readiness, package versions, repo paths) before finalizing a plan.
