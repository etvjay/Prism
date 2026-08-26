# Frontend Wallet Session Verification Surface

## Product job

Give a developer integrating STRK20 privacy a single, trustworthy surface that answers four questions in order: *is a wallet available, is it the right one, is the chain right, and what can it actually do for this app right now?* The surface replaces ad-hoc connection buttons, capability probes, and "ready / not ready" toasts with one panel that the workspace, the docs site, and the standalone prototype can all embed. Its job is to make the next step obvious, the failure mode legible, and the user's authority over their wallet non-negotiable.

## Protected truth and prohibited claims

- **Protected truth** — what may be shown only when the corresponding signal exists:
  - A wallet is connected **only** when the adapter has emitted a `connect` event and the most recent `getSession` call returned a non-null address.
  - A network is "correct" **only** when `chainId` from the adapter matches the chain the app is configured for (mainnet or sepolia, per `projects/prism/DECISIONS.md`).
  - A capability (e.g. `signTypedData`, `starknet_signMessage`, `watchAsset`) is supported **only** when the adapter returned `true` for that capability in the current session and the capability is not marked `unsupported` in the static fallback table in `src/features/prism-strk20/domain/wallet-capability.ts`.
  - A proof is "preparing" / "awaiting approval" / "submitted" / "confirmed" **only** when the privacy proof state machine has emitted that exact transition; UI never derives these labels from timers.
  - The user's address is shown as `0xAAAA…BBBB`; the full address is never the default render.
- **Prohibited claims** — labels the surface must never display:
  - "Anonymous", "Private", "Shielded", "Hidden" applied to the wallet panel itself. Privacy status belongs to the balance/transfer surface, not the connection surface.
  - "STRK20-ready" or "privacy-enabled" as a wallet attribute. Capability badges name the capability (`signTypedData`, `addToken`), not a product outcome.
  - "Connected securely" / "trusted" / "verified wallet" — connection is an event, not a security verdict.
  - Network name in the address line; chain is its own row, never mixed with identity.
  - "Balance" of any kind. This surface must not show balances, token holdings, or fiat value.
  - A specific wallet name unless the adapter explicitly identifies it (e.g. "Braavos", "Argent"). Generic "Starknet wallet" is allowed.
  - "Done" as a final state. Receipts are `confirmed` or `reverted`, not done.

## Information hierarchy

1. **Identity (primary)** — short address, truncated, with copy control and a subtle "view full" disclosure that never auto-expands.
2. **Network (secondary)** — chain name + chain id, with a switch action only when the app supports more than one chain.
3. **Capabilities (tertiary)** — three short badges for the capabilities the current task needs, each in one of: `supported`, `unsupported`, `unknown`. No other capabilities are listed; the list is scoped to what the active flow consumes.
4. **Action (primary CTA)** — exactly one button. The label is state-driven (see UI state model). A second control only appears as `Disconnect` once connected, and only in the panel header, not next to the CTA.
5. **Status (supportive)** — one line under the CTA, written as a present-tense verb phrase, never as a spinner-only promise.
6. **Receipt (conditional)** — appears only after a privacy operation enters `submitted`, with tx hash truncated and an explorer link. Never shown in the disconnected/connecting states.

## Visual direction compatible with the existing Prism workspace

Reuse the visual language already established in `PrismWorkspacePreview.tsx` and `PrismWorkspacePreview.module.css`:

- **Container** — a single card with the same corner radius (12px), border treatment (`1px solid var(--prism-panel-border, rgba(255,255,255,0.08))`), and surface tint as the surrounding workspace tiles. No new shadow; the existing ambient elevation is enough.
- **Density** — match the workspace preview's row height (~44px) and 16px internal padding. The panel must not feel heavier than the tiles around it.
- **Typography** — same scale as the preview: 12px uppercase tracking for section labels, 14px medium for primary text, 12px regular for status. The address uses a monospaced family already loaded by the workspace.
- **Color** — no status colors that conflict with the preview's status palette. Use a single accent for the CTA (`--prism-accent`), one neutral for `unknown`, one warn for `unsupported`/`wrong network`, and one positive for `confirmed`. These are the only four semantic colors this surface introduces.
- **Iconography** — none new. A small chevron for the "view full address" disclosure, a small external-link glyph for the explorer link. No wallet brand logos.
- **Motion** — same easing curve and ~160ms duration the preview uses for hover/focus transitions. No bouncing, no glow.

## Exact UI state model and labels

The panel has one state variable, `sessionState`, drawn from this closed set. Each state defines the CTA label, the status line, the capabilities row treatment, and whether the receipt row is visible. Verbs are present tense. Nouns match the privacy proof state machine where one exists.

| State | CTA label | Status line | Capabilities row | Receipt row | Header action |
|---|---|---|---|---|---|
| `disconnected` | `Connect wallet` | `No wallet connected.` | Hidden | Hidden | None |
| `discovering` | `Detecting…` (disabled) | `Looking for a Starknet wallet.` | Hidden | Hidden | None |
| `connecting` | `Connecting…` (disabled) | `Approve the connection in your wallet.` | Hidden | Hidden | None |
| `capability unknown` | `Connect wallet` | `Connected. Checking capabilities…` | Skeleton placeholders, three neutral pills | Hidden | `Disconnect` |
| `unsupported` | `Not supported` (disabled) | `This wallet does not expose the capabilities this app needs.` | All three badges in `unsupported` tone | Hidden | `Disconnect` |
| `wrong network` | `Switch to <chain>` | `Connected on <wrongChain>. This app runs on <rightChain>.` | Hidden | Hidden | `Disconnect` |
| `ready` | `Continue` | `Wallet ready. <capabilitySummary>.` | Three badges, mixed tones, only the needed capabilities | Hidden | `Disconnect` |
| `consent required` | `Review & sign` | `Sign the session consent to continue.` | Three badges, as in `ready` | Hidden | `Disconnect` |
| `proof preparing` | `Preparing proof…` (disabled) | `Building the zero-knowledge proof in your wallet.` | Three badges, as in `ready` | Hidden | `Disconnect` |
| `awaiting approval` | `Awaiting approval…` (disabled) | `Approve the proof submission in your wallet.` | Three badges, as in `ready` | Hidden | `Disconnect` |
| `submitted` | `View on explorer` (secondary) + `Continue` (primary) | `Proof submitted. Waiting for confirmation.` | Three badges, as in `ready` | Visible (hash + link) | `Disconnect` |
| `processing` | `Processing…` (disabled) | `Confirming on-chain.` | Three badges, as in `ready` | Visible (hash + link, `pending` tone) | `Disconnect` |
| `receipt confirmed` | `Continue` | `Confirmed in block <n>.` | Three badges, as in `ready` | Visible (hash + link, `confirmed` tone) | `Disconnect` |
| `reverted` | `Try again` | `Transaction reverted: <reasonIfKnown>.` | Three badges, as in `ready` | Visible (hash + link, `reverted` tone) | `Disconnect` |
| `unknown` | `Reconnect` | `Wallet state is unclear. Reconnect to refresh.` | Hidden | Hidden | `Disconnect` |

Rules that apply across all states:

- The CTA is always the first interactive element in tab order. `Disconnect` is the last.
- `awaiting approval` and `proof preparing` differ only in status text; the CTA is disabled in both and the panel must not auto-poll in a way that could cause layout shift.
- `submitted` shows two buttons side by side. On narrow viewports, the primary `Continue` stacks under the secondary `View on explorer`.
- The `capability unknown` skeleton uses three neutral pills of identical width; the row never animates shimmer (see reduced-motion).
- `unsupported` and `wrong network` are terminal-for-this-flow but not terminal-for-the-app: `Disconnect` is always available, and the user can re-trigger `discovering` by reopening the panel.
- The `unknown` state is the only state that may be entered from any other state; it represents "the adapter gave us a state we cannot classify" and the recovery is always `Reconnect`.

## Adapter-to-UI mapping

The session feature owns a thin adapter interface (see `src/features/wallet/session/`). The UI consumes a normalized `SessionSnapshot` and never reads the adapter directly. The mapping is:

- `adapter.on('connect', address)` → `sessionState = 'connecting'` while handshake is in flight, then `'capability unknown'` for the probe window, then `'ready'` (or `'consent required'` if the app has a consent step before `Continue` is enabled).
- `adapter.on('disconnect')` → `sessionState = 'disconnected'`. Any in-flight proof state is dropped; the receipt row is cleared.
- `adapter.on('accountsChanged')` → if the new address differs, return to `'capability unknown'`; if the new address is the same, no state change.
- `adapter.on('networkChanged')` → compare new `chainId` to configured chains; route to `'wrong network'` or `'ready'` accordingly. Never route to `'disconnected'` on a network change alone.
- `adapter.getCapabilities()` → populates the three badge slots. Missing entries are `unknown`, not `unsupported`; the static fallback in `wallet-capability.ts` is consulted only when the adapter returns `null` for the whole object, in which case each capability is `unknown` (not `unsupported`).
- `proofStateMachine` events (`preparing`, `awaiting-approval`, `submitted`, `processing`, `confirmed`, `reverted`) → drive the `'proof preparing'` … `'reverted'` rows directly. The UI does not interpret hashes or block numbers; it only formats what the state machine hands it.
- `adapter.errors` → mapped to a single recoverable banner that returns the panel to `'unknown'` rather than `'disconnected'`, unless the error is `user-rejected`, in which case the panel returns to `'ready'` (or to the pre-proof state if the rejection happened mid-proof).

## Component/file boundaries

Boundaries follow the existing `src/features/` layout; no new top-level packages.

- `src/features/wallet/session/` — owns the adapter abstraction, the `SessionSnapshot` type, the reducer that maps adapter events to `sessionState`, and a single React context (`SessionContext`). This directory is the only place that imports from any wallet SDK.
  - `session/adapter.ts` — interface `{ connect, disconnect, getSession, getCapabilities, on, off }`. No UI.
  - `session/reducer.ts` — pure function from `(state, adapterEvent) => state`. Exports the closed `SessionState` union.
  - `session/SessionProvider.tsx` — wires the adapter to the reducer, exposes `useSession()` and `useSessionState()`.
  - `session/selectors.ts` — derives the three "needed" capabilities for the current flow from `wallet-capability.ts` and the active flow config. The panel renders only what selectors return.
- `src/features/wallet/WalletConnectionPanel.tsx` — the single presentational surface. Receives `sessionState` and the three capability slots via context. Renders the card, the status line, the capability row, the CTA, the receipt row, and the `Disconnect` control. It does **not** call the adapter and does **not** know about specific flows; "needed capabilities" arrive pre-selected.
- `src/features/wallet/WalletConnectionPanel.module.css` — co-located styles, scoped via CSS modules to match `PrismWorkspacePreview.module.css` conventions.
- `src/features/landing/PrismWorkspacePreview.tsx` — embeds `WalletConnectionPanel` in the existing preview tile. The preview tile becomes a live demo of the connection surface, gated behind a `?demo=session` query so the default landing render is unchanged.
- `src/features/prism-strk20/domain/wallet-capability.ts` — unchanged in shape; the `unsupported` fallback table continues to list capabilities that are structurally impossible for a wallet to expose, not wallet brands.
- `projects/prism/DECISIONS.md` — receives a single new entry under "Frontend surfaces": "The connection/auth state lives in `src/features/wallet/session/` and is the only surface that may render the user's address."

The standalone prototype (any path under `apps/*` or `prototypes/*` that is not part of the main app) is allowed to import from `src/features/wallet/session/` but **not** from `src/features/wallet/WalletConnectionPanel.module.css`'s sibling styles; the prototype ships its own CSS so design changes here do not silently retarget the prototype.

## Interaction model

- **Mouse / pointer** — single click on the CTA. The CTA is full-width within the card. `Disconnect` is a text button in the panel header, right-aligned.
- **Keyboard** — `Tab` order: CTA → address copy button → "view full address" disclosure → network switch (if shown) → `Disconnect` → receipt row external link. `Enter` and `Space` activate the focused control. `Esc` collapses an expanded full-address disclosure. `Cmd/Ctrl+C` on a focused address copies the truncated form; a tooltip confirms.
- **Copy** — copying the address writes the full form to the clipboard, not the truncated form, even though the truncated form is what is rendered and announced. The tooltip reads "Copied" for 1.2s.
- **Disclosure** — "view full address" expands inline; the card grows vertically, never horizontally. The disclosure is closed by default and by any state transition out of `ready`/`consent required`/`submitted`/`processing`/`receipt confirmed`/`reverted`.
- **Receipt link** — opens the explorer in a new tab. The link's `rel` includes `noopener noreferrer`.
- **Disconnect** — always available once connected, always confirmed with a two-step pattern: first click reveals "Confirm disconnect" inline, second click within 3s commits. Auto-cancels on any other state change. This pattern is reused, not redefined, in the standalone prototype.
- **Errors** — recoverable errors surface a small banner above the status line with a `Dismiss` action. Unrecoverable errors (e.g. adapter threw on init) move the panel to `unknown` and the CTA becomes `Reconnect`.
- **No auto-connect** — the panel never calls `adapter.connect()` on mount. `discovering` only starts in response to a user gesture (the CTA click).

## Responsive behavior

- **≥ 720px** — single column, card max-width 420px, centered or left-aligned to match the surrounding preview tile grid.
- **480–719px** — card fills the available width up to 420px; the two-button row in `submitted` stacks with `Continue` under `View on explorer`.
- **< 480px** — card fills the viewport with 16px side gutters. The full-address disclosure is capped at 320px and truncates again with ellipsis; the underlying full address is still copied to clipboard. Capability badges wrap to a second line if needed; their order is fixed.
- **Landscape on small screens** — no special handling beyond the stacking rules; the card does not scroll-lock.
- **High-DPI** — all borders are 1px and use the same color token as the workspace preview; no shadow-based depth.

## Accessibility

- **Roles and landmarks** — the panel is `role="region"` with `aria-labelledby` pointing at the section label. The CTA is a `<button>`. The capability row is `role="list"` with each badge `role="listitem"`. The status line is `aria-live="polite"`. The receipt row is `aria-live="polite"` as well, so screen readers announce "Confirmed in block 12345" without a focus change.
- **Labels** — every state change updates the status line's text; the live region announces the new text. The CTA's accessible name is its visible label. `Disconnect` is always labeled `Disconnect`, never an icon-only button.
- **Focus** — visible focus ring uses the workspace's existing `--prism-focus` token (2px outline, 2px offset). Focus is never removed without a replacement. On state change, focus is preserved on the CTA unless the CTA itself is replaced; in that case focus moves to the new CTA.
- **Color independence** — every state is conveyed by text, not by color alone. The four semantic colors (accent, neutral, warn, positive) are paired with a leading glyph or text token (`OK`, `!`, `?`, `✓`) so the panel is legible in forced-colors mode.
- **Contrast** — all text meets WCAG AA against the panel surface in both light and dark themes; capability badges meet AA for their text-on-tone combinations.
- **Touch targets** — minimum 44×44px for the CTA and `Disconnect`. The full-address disclosure's hit area is at least 24px tall.
- **Motion** — see the reduced-motion section.
- **Language** — all visible strings are centralized in a single `strings.ts` for the panel; no string is composed inline. This keeps the eventual i18n pass mechanical and prevents accidental label drift.

## Reduced-motion behavior

When `prefers-reduced-motion: reduce` is set:

- The capability-row skeleton in `capability unknown` renders as three static neutral pills; no shimmer, no opacity pulse.
- The CTA's hover and focus transitions are removed; the pressed state is conveyed by a 1px inset border instead of a transform.
- The status line's transitions are instant.
- The full-address disclosure expands without a height animation; the card snaps to its new size.
- The receipt row's appearance in `submitted` is instant.
- The two-step `Disconnect` confirmation still uses its 3s timeout (timers are not motion), but the inline reveal is instant.
- Loading states (`discovering`, `connecting`, `proof preparing`, `awaiting approval`, `processing`) keep their text labels; they do not rely on a spinner animation, because a spinner is the only motion the prototype previously used and it is removed.

## Runtime QA and acceptance gates

A build is acceptable to ship this surface only when all of the following are true. The gates are written so they can be enforced by automated checks where possible, and by a single manual pass where not.

- **Closed state set** — the panel's `sessionState` value is a member of the 15-state list above. Any other value is a build error, asserted in `session/reducer.ts` via a discriminated union exhaustive check.
- **Truth gates**
  - The address is rendered only when the most recent `getSession` returned a non-null address. Asserted by a component test that mounts the panel in each of the 15 states and snapshots the rendered DOM.
  - The `Continue` CTA is enabled only in `ready`, `receipt confirmed`, and `reverted` (where it is labeled `Try again`). Asserted by a state-table test.
  - The `Switch to <chain>` CTA appears only in `wrong network`, and `<rightChain>` matches the value in `projects/prism/DECISIONS.md`.
  - Capability badges render only the three "needed" capabilities returned by `session/selectors.ts` for the active flow; no capability outside that set is ever shown. Asserted by a snapshot test per flow.
  - The receipt row renders only in `submitted`, `processing`, `receipt confirmed`, and `reverted`. The hash is truncated to `0xAAAA…BBBB`; the full hash is the link's `href` and the clipboard payload.
- **Prohibited-claim gates**
  - A grep gate over `src/features/wallet/` rejects the strings `Anonymous`, `Private`, `Shielded`, `Hidden`, `STRK20-ready`, `privacy-enabled`, `Connected securely`, `trusted`, `verified wallet`, `Balance`, and `Done` (case-insensitive, whole-word, with an allowlist for test fixtures that explicitly assert their absence).
  - A grep gate over `WalletConnectionPanel.tsx` rejects direct imports from any wallet SDK; the panel may only import from `src/features/wallet/session/`.
- **Visual gates**
  - Computed style of the panel container matches the preview tile's border, radius, and surface tokens to within a single token reference (no magic numbers in the CSS module).
  - In forced-colors mode, every state is still distinguishable by text or glyph (snapshot test with `forced-colors: active`).
  - At 360px viewport width, no horizontal scroll on the card; the receipt row's secondary button is on its own line.
- **Motion gates**
  - With `prefers-reduced-motion: reduce`, the panel has zero CSS transitions or animations applied (asserted by reading `getComputedStyle` and asserting `transition-duration: 0s` and `animation-name: none` on the panel and its descendants).
- **Adapter isolation**
  - A test mounts `SessionProvider` with a mock adapter and drives the panel through every state transition listed in "Adapter-to-UI mapping". The mock adapter asserts that the panel never invokes `connect()` without a prior user click.
- **Standalone prototype separation**
  - The prototype does not import any file under `src/features/wallet/WalletConnectionPanel.module.css` or its sibling; a CI grep gate enforces this.

## Implementation handoff

This packet is implementation-ready as a single design contract. Handoff to engineering proceeds in the order below; each step is independently reviewable and does not block the others from being read.

1. Land `src/features/wallet/session/` (adapter interface, reducer, provider, selectors, strings) with unit tests for the reducer's exhaustive state mapping. No UI.
2. Land `WalletConnectionPanel.tsx` and its CSS module as a pure presentational component, snapshot-tested against all 15 states in both motion modes.
3. Wire the panel into `PrismWorkspacePreview.tsx` behind the `?demo=session` query so the landing page is unchanged by default.
4. Apply the truth and prohibited-claim gates as CI checks (grep + component tests) before the surface is enabled by default in any other embedding.
5. Add the `DECISIONS.md` entry recording that `src/features/wallet/session/` is the only place that may render the user's address.
6. The standalone prototype keeps its own CSS and its own copy of the strings; it imports only the context and the reducer, never the panel module.

The surface is considered shipped when the gates above are green in CI, the panel is embedded in the workspace preview under `?demo=session`, and the prototype still builds and runs against the same `SessionProvider` without sharing styles.

END_DESIGN_PACKET