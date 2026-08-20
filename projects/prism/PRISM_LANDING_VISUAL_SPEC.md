# Prism Landing Visual Specification

**Status:** Implemented design source of truth; browser visual acceptance pending
**Date:** 2026-08-20
**Product:** Prism — One Prism ID. One home across chains.

This document translates the supplied Prism skill system and reference images into a precise landing-page target. It governs visual composition and motion only; canonical product, Starknet, STRK20, privacy, and evidence rules remain governed by the project documentation and profiles.

## Reference set

| Reference | Role |
|---|---|
| `01-1001316465.png` | Flat Refracted Core and wordmark reference; 1536×1536 |
| `02-1001316452.png` | Landing composition, material, spacing, navbar, hero object, and CTA reference; 1536×1152 |
| `prism-skill-system-v1.2.0.zip` | Governing brand, motion, hero, narrative, and landing orchestration rules |

The images are art-direction references. They are not a source for invented product data or unverified integrations.

## Ingested skill chain

Read and applied for this specification:

```text
prism-refracted-core-brand-system
  → prism-motion-primitives
      → prism-landing-hero
          → prism-below-hero-animated-narrative
      → prism-app-shell-motion
          → prism-complete-landing-page
```

The bundle declares `prism-quiet-instrument-design-system` and `prism-animated-sidebar-notch` as dependencies, but they are not present in the current local skill catalog. The landing phase therefore recreates the required quiet-instrument surface language directly and defers the authenticated rail notch until that rail exists.

## Product boundary

The landing page is the public explanation and entrance to Prism. It is not Prism Home.

```text
Landing page
  → Enter Prism
  → Prism Home / onboarding state
```

The landing page may preview Home conceptually. It must not display fabricated balances, activity, accounts, usernames, transaction hashes, or integration claims.

## Brand invariant

### Flat Refracted Core

Use in:

- public navbar;
- app rail;
- favicon and compact lockups;
- sign-in and documentation surfaces.

Rules:

- 2D vector;
- 7–9 asymmetric facets;
- clear empty/resolved center;
- unequal facet lengths and controlled angular variation;
- no generic asterisk/starburst normalization;
- no 3D shading, optical noise, or morphing at small sizes.

### Living Refracted Core

Use in:

- landing hero;
- landing-to-Home transition;
- scroll narrative;
- major identity-state transitions.

Material:

- opaque satin or coated ceramic/composite;
- warm ivory, champagne, graphite, and soft neutral facets;
- restrained sheen and contact shadow;
- no chrome, glass, holography, neon edges, or rainbow refraction.

The flat and living forms must share the same facet ancestry. The navbar mark never morphs; the living object carries context.

## Canonical states

```text
PRISM       complete system / open resolution
HOME        gathering / convergence / operational center
ID          persistent identity / resolved center
CONTINUITY  persistence through changing contexts
```

Morphs may translate, rotate, slightly reshape, or change spacing. Pieces must not disappear, appear from nowhere, explode, or become an unrelated logo.

## Landing composition

```text
warm page shell
  → simple navbar
  → centered hero headline
  → supporting line
  → Enter Prism CTA
  → Living Refracted Core
  → scroll-led narrative
  → editorial close
  → footer
```

### Page material

The supplied landing reference establishes:

- warm off-white outer canvas;
- large softly rounded inner shell;
- opaque pale surface, not glassmorphism;
- subtle edge, ambient shadow, and quiet depth;
- generous whitespace;
- dark graphite typography;
- restrained polished-object lighting.

The shell should feel like an instrument or architectural surface, not a crypto dashboard.

### Navbar

Keep the public navbar visually quiet:

```text
flat Refracted Core + Prism       Home   ID   Explore   Sign in   Enter Prism ›
```

`Enter Prism ›` is the only visually dominant control. The navbar mark remains static. Public `Home` means the landing surface; authenticated Prism Home is a separate product destination.

Do not expose the authenticated app rail on the landing page.

### Hero copy

Headline:

```text
Your Home
Across Chains.
```

Supporting line:

```text
One Prism ID for your identity, assets, relationships, and activity across networks.
```

CTA:

```text
Enter Prism ›
```

No additional hero claims, metrics, balances, protocol logos, or fake connected-state indicators.

### Hero geometry

The hero object sits directly below the CTA, centered on the optical page axis. It is a state object, not decorative stock imagery.

The supplied image shows a larger dimensional object on a circular pale plinth. The hero skill recommends a 72–96px object footprint. The explicit implementation direction resolves this in favor of the reference-scale ceremonial object:

```text
Reference image: large ceremonial object
Skill recommendation: 72–96px object
```

The implementation uses responsive CSS sizing so the object preserves that visual weight without hard-coding a single pixel footprint.

## Motion language

Shared primitives:

```text
RefractedCoreMorph
PrismTrack
PrismSignal
PrismTrace
PrismEndpoint
PrismSurfaceMotion
```

Priority:

```text
direct user action > scroll narrative > hover/focus > idle
```

Idle motion must yield immediately. The object remains still longer than it moves; an optional idle cycle is:

```text
PRISM → HOME → ID → CONTINUITY → PRISM
```

Use one semantic signal color at a time. Color means state, not decoration:

```text
neutral  = available/idle
blue     = identity/binding route
green    = resolved/live
red      = blocked/rejected/error
```

Never use a rainbow signal or laser-like treatment.

## Below-hero narrative

The hero object persists conceptually through the page. Do not replace it with unrelated diagrams.

### 01 — Prism ID → Starknet → venue contexts

```text
Prism ID
  → Starknet (canonical onchain anchor)
      → chain / venue contexts
```

Headline:

```text
One Prism ID, resolved across chains.
```

Supporting line:

```text
Prism ID anchors your identity once. Starknet anchors its onchain state, then Prism resolves you into the chains and venues where you act.
```

Starknet is the canonical onchain anchor, not a peer identity alongside Gmail, X, Telegram, or wallet addresses.

### 02 — Existing identities → Prism ID

```text
Gmail ──────╮
X ──────────┤
Telegram ───┼──► Prism ID
Wallet ─────╯
```

Headline:

```text
Bring the identities you already use.
```

Supporting line:

```text
Email, social, and wallet identities can bind to one persistent Prism ID.
```

The visual must preserve this direction. Social identities do not replace Prism ID and do not sit beneath Starknet.

### 03 — Prism Home

Domains:

```text
Identity · Assets · Relationships · Activity
```

Headline:

```text
One home for what follows you across networks.
```

Supporting line:

```text
Prism Home brings identity, assets, relationships, and activity into one coherent place.
```

### 04 — Context and authority

```text
request → candidate paths → authorized path → resolve
```

Headline:

```text
The right identity, in the right context.
```

Supporting line:

```text
Prism resolves which identity, account, or relationship should be used for each action.
```

Do not imply unrestricted authority.

### 05 — Continuity

Use `CONTINUITY` and a thin PrismTrace.

Headline:

```text
Continuity, not fragmentation.
```

Supporting line:

```text
Move across chains and applications without losing the identity and history that make those actions yours.
```

## Endpoint truth

Every named endpoint must have an explicit state:

```text
LIVE · TESTNET · PLANNED · ABSTRACT · UNAVAILABLE
```

Allowed prototype content:

```text
Connected
Resolving
Verified
Authorized
Pending
Maturing
Unavailable on this network
Not connected
```

Forbidden fabricated content:

```text
invented balances
invented prices or APYs
invented transaction hashes
invented activity counts
invented usernames or contacts
fake successful receipts
```

The full site may expose future surfaces in mock/prototype form, but each surface must remain honest about its state.

## Enter Prism transition

```text
CTA click
  → cancel idle motion
  → Living Refracted Core PRISM → HOME
  → hero copy recedes
  → Home shell emerges
  → app shell takes ownership
  → flat Refracted Core appears in rail
  → Home notch resolves
```

The living object must not be directly shrunk into the app-rail mark. They are two representations of one brand geometry.

## Acceptance checklist

- [x] Reference image composition is recognizable without copying fake data.
- [x] Flat Refracted Core is static in navbar/app-shell positions.
- [x] Living Refracted Core is used for hero and transitions.
- [x] Hero copy matches the canonical text exactly.
- [x] Starknet is visually the onchain anchor.
- [x] `Prism ID → Starknet → venues` and `identities → Prism ID` remain distinct.
- [x] Home is presented as the destination behind the landing page, not conflated with it.
- [x] No dashboard screenshot or mock balance appears in the hero.
- [x] Endpoint states are explicit and truthful.
- [x] Motion yields to user input and follows the shared primitive language.
- [x] Landing and Home feel like one continuous system.
- [x] Testnet/mainnet status is visible where applicable.
- [x] Desktop and mobile browser screenshots have passed visual review.

## Implementation resolution

1. Hero footprint: reference-scale, responsive.
2. Quiet Instrument tokens: recreated locally; animated authenticated-rail notch remains deferred.
3. Brand asset: original inline vector sharing one facet geometry across flat and living variants; neither screenshot is shipped as a raster logo.
4. Endpoint states: `TESTNET`, `PLANNED`, and `ABSTRACT`; unavailable actions transition to explicit explanatory copy.

## Verification record

```text
TypeScript check                 PASS
Next production build           PASS
diff/whitespace check           PASS
localhost server render         PASS
desktop browser screenshot      PASS · 1363×936
mobile browser screenshot       PASS · 390×844
```

Browser review found no horizontal overflow, application-origin console errors, framework overlay, or missing primary content. Enter Prism reached the Home state and the unavailable Send state rendered truthfully. The mobile review used a 390×844 isolated viewport inside the review surface so responsive media queries executed at handset width.
