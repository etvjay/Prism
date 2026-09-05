# Live-State Surface — Human Click-Through (demo only, read-only)

Evidence ceiling: X2 local controlled implementation. No live RPC value is
claimed by the preview — the default reader returns declared mocks; the
blocked reader path shows fallback copy everywhere.
Flag: `?demo=livestate` (aliases `live-state`, `live`). Without the flag the
landing and workspace render exactly as before. `?demo=privacy` does NOT
enable this surface.

Facts surfaced (read-only): prism:8 on SN_SEPOLIA registry V2
`0x06f77be5c7bdfef252dd322481b4430a587b781df4f79d3b344808d125ec530d`,
owner deployer `0x47c0f8b01b9c7c75c669dc549bc305a0f2d796808117339a1c87730162b131c`,
bound Base Sepolia EOA `0xCf3E2aFA1E8E92Af56b02fD6799EcDd77018De23` (EVD-PRISM-005/006 X3).

## Open it

```bash
npm run dev
# visit http://localhost:3000/?demo=livestate
# scroll to the workspace preview → Overview → "Live chain state (read-only)" tile
```

## Script

1. **No flag → nothing.** Visit `http://localhost:3000/` (no query): the
   workspace preview shows the default Overview with no live-state tile.
   Add `?demo=privacy`: still no live-state tile (separate flag).
2. **Pre-connect → idle fallback.** Visit `http://localhost:3000/?demo=livestate`:
   session tile shows `Disconnected`; public-state tile shows
   "Connect a demo wallet to load public chain state…"; private-balance tile
   shows the same idle fallback. Nothing has been read.
3. **Connect → capability → session.** In the session tile click each mock
   wallet: capable → `Ready`; legacy → `Unsupported` blocked terminal;
   no-versions → `Capability unknown`; other-network → `Wrong network`.
   Only `Ready` loads chain state; every other state keeps fallback copy.
4. **Public state (read-only).** After capable connect expect four `Live
   (read-only)` cards: Prism ID owner (`0x47c0f8…` + registry `0x06f77b…530d`),
   BASE binding (`Bound · 0xCf3E… (Base Sepolia)`), STRK balance
   (`1,250.00 STRK`), Base Sepolia ETH (`0.042 Base Sepolia ETH`).
5. **Private balance consent gate.** Before consent the slot shows
   "Private balance is consent-gated…" + `Review & sign consent`. Click it →
   interstitial binds tokens + session + timestamp. `Grant` reveals
   `420.00 STRK (shielded preview)`; `Deny` keeps the slot blocked with the
   consent-gated copy. Disconnect resets to idle fallback.
6. **Blocked path.** (Code preview: render `<LiveStateDemoSlot
   reader={createBlockedLiveStateReader()} />`.) Every live-dependent card
   shows `blocked` + "Live read is unavailable in this preview…" — no value
   claimed.

## What this does NOT do (remains for a separately authorized step)

- No broadcast, no signing, no spending, no commits — read-only port only.
- No live RPC call from the default preview path; a future RPC-backed
  `LiveStateReader` must stay behind the same typed port, read-only.
- No viewing-key, note, or proof material exists anywhere; guards
  (`assertNoViewingKey`, `assertNoSecretMaterial`) fail closed.
- Real-wallet readback against SN_SEPOLIA + Base Sepolia RPCs is human work
  outside this change.

## Verify

```bash
npm run typecheck
npx vitest run src/features/live-state/__tests__/live-state.test.ts
npm run build
git diff --stat HEAD -- strk20.json   # must be empty
```
