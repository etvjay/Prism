# Prism Phase 8 Frontend Surface Contract

**Status:** Implemented locally; X2 runtime evidence
**Owner:** Jason / parent Hermes session
**Scope:** Public landing + truthful workspace preview
**Protected hero:** Satin Resolve remains the production hero and was not replaced.

## Surface boundary

The route `/` is a public product surface that transitions from the Prism identity narrative into a truthful workspace preview. It is not an authenticated Home, a live ledger, or a settlement console.

```text
public landing
→ workspace preview
→ wallet capability/connect state
→ future observed product state
```

The workspace exposes the canonical product navigation:

```text
Home
Activity
Connections
Profile
```

Send and Receive remain actions inside Home, not primary navigation destinations.

## Truth and non-goals

- No balances, receipts, identities, bindings, or completed operations are fabricated.
- `submitted`/preview state is not rendered as completed.
- Wallet capability detection uses declared Wallet API/spec support only.
- Viewing keys, private keys, notes, and proving material remain wallet-owned.
- Send/Receive buttons produce an honest preview notice and no chain transaction.
- Activity is empty until durable, independently reconciled operations exist.
- Connections are pending until control proof, canonical binding, and readback exist.
- Profile does not infer a Prism ID or authority from browser state.

## Implemented artifacts

- `src/features/landing/PrismLanding.tsx`
  - preserves Satin Resolve;
  - canonical Home/Activity/Connections/Profile navigation;
  - shared workspace-tab event/state ownership;
  - mobile menu and Escape behavior.
- `src/features/landing/PrismWorkspacePreview.tsx`
  - Home, Activity, Connections, Profile states;
  - Send/Receive truthful preview actions;
  - real `WalletConnectionPanel` integration.
- `src/features/landing/PrismWorkspacePreview.module.css`
  - responsive workspace shell;
  - desktop/tablet/mobile layout;
  - reduced-motion-safe transitions.

## Verification

```text
npm test                 502 passed, 14 skipped
npm run typecheck        PASS
npm run build            PASS

git diff --check         PASS
```

Browser runtime evidence from the production server on Chromium 151:

```text
desktop 1440×1000: workspace, wallet panel, nav, and tabs present
Activity: selects and renders “No observed activity yet.”
Connections: selects and renders canonical binding-pending state
Profile: selects and renders identity-preserving state
Send: renders preview-only status; no transaction sent
mobile 390×844: scrollWidth == clientWidth; no horizontal overflow
mobile menu: opens; Escape closes it
reduced motion: complete content; document.getAnimations() == 0
console/runtime errors: none observed
```

## Maturity and remaining gates

This is X2 local/runtime evidence. It does not prove:

- live wallet connection;
- live Prism identity read;
- live Base binding;
- durable backend data;
- live STRK20 private balance/action;
- Pause settlement;
- public production deployment.

The Ready X installation is present in the isolated test browser, but account creation is stopped at its password boundary; no secret was entered or retained.
