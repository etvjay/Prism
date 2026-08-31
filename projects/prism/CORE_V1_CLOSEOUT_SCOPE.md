# Prism Core v1 Closeout Scope

**Status:** Accepted working scope for closeout; not a deployment authorization
**Decision:** `DEC-PRISM-M0-002`
**Date:** 2026-08-31
**Evidence ceiling at scope freeze:** X2 local implementation unless a gate records live receipts and independent reads

## Core v1 promised surface

1. Registry V2 as the canonical immutable identity registry.
2. Prism identity create/read lifecycle.
3. Base ownership proof and controller binding.
4. Resolve and revoke lifecycle with parent identity persistence.
5. Pause/governance control boundary with approval-scope and fail-closed checks.
6. Durable backend operation, event, checkpoint, and reconciliation path.
7. Truthful Home and operation surfaces for the Core v1 states.

## Separate hard-gated release train

STRK20 remains a first-class product track and is not declared complete by Core v1. Its own release gate requires:

```text
Wallet API/prover authorization
→ STRK20 pool action
→ accepted receipt
→ private-state readback
→ conservation / failure-recovery evidence
→ independent verification
```

A qualifying STRK20 Private Sprint submission additionally requires the official three successful mainnet STRK20-pool transactions and public demo/video requirements. `strk20.json` is populated only from independently observed facts.

## Deferred tracks

- Vesu lending composition.
- LayerZero delivery.
- PrismChannel beyond the minimal relationship slice.
- STRK20 shadow accounts.
- Broader private financial capabilities.

Deferred does not mean rejected. Each track retains its own decision, implementation, evidence, and release gate.

## Closeout rule

Core v1 local implementation is not mainnet readiness. The Core v1 release packet must still prove the applicable testnet/mainnet deployments, receipts, independent reads, production authentication, durable persistence and recovery, signer/deployment controls, security review, and owner acceptance. No deferred feature may be represented as complete through this scope.
