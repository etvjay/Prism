# Execute — the phase-by-phase build loop (Step 5)

You enter this file only after the developer has approved `STRK20_INTEGRATION_PLAN.md`. Execute one phase at a time; between phases the developer verifies manually — you cannot: shield/transfer/unshield need their privacy-enabled wallet and a funded account.

## The loop (every phase)

1. **Re-verify before building.**
   - Fetch the WalletAccount guide (URL in `references/links.md`) for the current API — never guess method names.
   - Check pins with the bundled script — `python3 scripts/check_freshness.py --quick` — rather than running `npm view` by hand; it covers every pin the skill names plus the monorepo paths, and tells you what moved.
   - If the phase touches the SDK or anonymizer examples: confirm the monorepo paths still exist (https://github.com/starkware-libs/starknet-privacy).
   - If anything drifted, update the plan's §4 Prerequisites first and tell the developer.
2. **Make the changes** exactly as scoped for this phase. Follow the repo's conventions: its package manager, module style, state management, error handling, and test layout. Don't refactor unrelated code.
3. **Verify headlessly** (per-stack table below). Everything must pass before handoff.
4. **Mark the phase in the plan** (conventions below) and record anything deferred or drifted under "Open items".
5. **Hand off and stop.** Post the phase's manual checklist with the matching strk20-by-example.org links (map in `references/links.md`), and wait for the developer's confirmation. Do not start the next phase without it.

## Headless verification per stack

Detect the package manager from the lockfile (`package-lock.json` → npm, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn) and use it consistently.

| Repo shape | Clean means |
|---|---|
| Vite / Next / CRA frontend | install exits 0 · typecheck passes (`tsc --noEmit` or the repo's script) · production build passes · existing test script passes |
| Plain TS/Node backend | install exits 0 · typecheck passes · the repo's test command passes |
| Monorepo | the above, scoped to the affected workspace(s) |

Add tests only where the repo already has a test setup — match its framework and file layout; never introduce a new test framework during an integration.

## Manual checklist templates

Hand over only the items the phase actually built; adapt names to their app.

**Wallet API route (Branch C):**

- [ ] Connect with the Ready extension — the app discovers it via get-starknet v6.
- [ ] Capability check: privacy actions appear with Ready and degrade gracefully with a non-privacy wallet.
- [ ] Testnet shield: deposit a small amount into the pool. (A screening decline is a protocol outcome to surface in UX, not an app bug.)
- [ ] Private transfer to a second registered account.
- [ ] Unshield back to a public balance.
- [ ] Cross-check anything odd against the wallet test dapp (URL in `references/links.md`).

**SDK route (Branch A):**

- [ ] No secrets in the diff: viewing key / private key only via env vars.
- [ ] Register a viewing key on testnet.
- [ ] Shield, then private transfer between the service's own accounts.
- [ ] Discovery/balance readback returns the expected notes.

## Failure protocol

- **Headless check fails** → fix within the phase; the handoff message only goes out clean.
- **External blocker** (wallet unavailable, screening decline, missing testnet funds, upstream API change) → record it in the plan under "Open items to re-verify at build time", stop, and hand back to the developer with what you found.
- **A step seems to need a user's viewing key in the dapp** → the route is wrong; stop and re-run Step 3 of `SKILL.md` — do not improvise.

## Plan-file conventions

- Phase done: append to the phase heading — `## 5. Phase 1 — first shielded flow ✅ done 2026-07-14`
- Phase blocked: `⛔ blocked <date>: <one-line reason>` on the heading; details under Open items.
- Version drift found during re-verify: update §4 Prerequisites and note the change under Open items.
