# Prism workspace pre-repair QA

**Baseline:** `ed8e4a3`

## Failures being repaired

- The workspace begins with another promotional introduction instead of the product.
- The header repeats `Prism ID / Home` before any identity has been observed.
- The sidebar does not expose the relationship-and-authority model clearly.
- Home exposes engineering STRK20/Vesu test harnesses when `?demo=session` is present.
- Actions omit approval and connection.
- Messaging has no visible relationship entry point.
- Hover and view transitions are generic and do not preserve spatial continuity.
- Existing empty states explain backend concepts but do not present a usable dashboard hierarchy.

## Areas intentionally preserved

- Public landing hero.
- Entry transition.
- Identity context mesh.
- Wallet, STRK20, Pause, payments, channel, operation, and receipt implementations.
- Product truth and fail-closed copy boundaries.
