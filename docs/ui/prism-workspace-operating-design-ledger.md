# Prism workspace operating design ledger

## Accepted direction

- Reuse the public landing's light satin shell, graphite typography, rounded geometry, and quiet monochrome hierarchy.
- Do not create a second marketing or hero section before the product.
- Use Overview, Activity, Connections, and Profile as the only product navigation.
- Expose messaging through verified relationships and Connections, not a generic Chat destination.
- Keep Send, Receive, Approval, and Connect as actions, not navigation.
- Keep the Home attention-first and evidence-aware.
- Keep engineering/privacy test harnesses outside the product Home.

## Motion decisions

- Desktop rail rests at 86px and expands to 238px on hover or keyboard focus.
- The shell owns sidebar geometry so content and navigation remain one spatial system.
- Rail uses the fluid 420ms curve. View changes use a 620ms soft settle.
- Hover lift is limited to actions and cards. No ambient loops or fake live-data motion.
- Base states remain visible for headless capture.
- Reduced motion collapses animations and transitions to 0.01ms.

## Truth decisions

- Unconnected is explicit.
- Starknet is named as canonical root but marked not read.
- Private state is marked consent required and wallet-owned.
- No balances, identities, messages, requests, operations, or receipts are populated.
- Approval copy states that the request cannot move funds.
- Activity states that submitted is not complete.

## Deferred surfaces

- Real relationship/channel list.
- Invitation acceptance.
- Encrypted message composer and read view.
- Structured payment, claim, approval, and receipt cards.
- Connected profile and binding controls.
