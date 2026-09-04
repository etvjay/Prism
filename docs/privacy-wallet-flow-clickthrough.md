# Privacy Wallet Flow — Human Click-Through (demo only)

Evidence ceiling: X2 local controlled implementation. No live receipt is claimed.
Flag: `?demo=privacy` (aliases `privacy-style`, `session`). Without the flag,
the landing and workspace render exactly as before.

## Open it

```bash
npm run dev
# visit http://localhost:3000/?demo=privacy
# scroll to the workspace preview → Overview → "Privacy wallet flow" tile
```

## Script

1. **Wallet connect + SessionUiState** — In the Overview session tile, click each
   mock wallet: capable → `Ready` (`Wallet ready. supportedWalletApi, supportedSpecs, strk20.`);
   legacy → `Unsupported` blocked terminal; no-versions → `Capability unknown`
   skeleton + blocked copy; other-network → `Wrong network` blocked terminal.
   State text comes from `strings.ts` `statusLine()`; the machine is the existing
   `sessionReducer` + `selectSessionSnapshot` — no new state machine was invented.
2. **Capability group** — Connections tile shows the three slots
   `supportedWalletApi / supportedSpecs / strk20` with glyphs OK / ! / ?.
   Threshold: any declared version ≥ 0.10.3. Detection reads declared version
   constants only — never a balance probe.
3. **Shield intent** — Pick STRK/USDC, enter an amount (positive, ≤ 18 decimals),
   note the mock fee-quote display. Click `Review & sign`: the consent
   interstitial shows the binding (tokens + session address + timestamp).
   `Grant` continues; `Deny` stops with `Connection consent was not granted.`
   (CONSENT_DENIED) and keeps the session in `consent-required`.
4. **Two-hash receipt slots** — After grant, `Request shield (mock)` fills the
   approval hash and shield hash slots. Empty until submit: `— pending —`.
5. **Receipt / activity tail** — Toggle confirmed / pending / reverted. Confirmed
   shows `SUCCEEDED · ACCEPTED_ON_L2 · block 12355 · pool 0x0403…812a ·
   mature at 12365`. Pending is blockless and pool-absent; submitted is never
   shown as complete.

## What this does NOT do (remains for a separately authorized step)

- No live wallet connection (Ready/Xverse), no SN_SEPOLIA broadcast, no real
  `strk20.json` entry — all hashes, fees, and blocks are declared mock constants.
- No viewing-key, note, or proof material exists anywhere in the flow; guards
  (`assertNoViewingKey`, `assertNoSecretMaterial`) fail closed.
- Real-wallet click-through on SN_SEPOLIA (connect → capability observe →
  consent → shield → mature ~10 blocks → receipt readback across two RPC
  sources) is human work outside this change.

## Verify

```bash
npm run typecheck
npx vitest run src/features/privacy-flow/__tests__/privacy-flow.test.ts
npm run build
git diff --stat HEAD -- strk20.json   # must be empty
```
