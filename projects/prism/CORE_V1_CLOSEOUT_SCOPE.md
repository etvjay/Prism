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

## STRK20 remains in the Prism repository and roadmap

STRK20 is a first-class Prism product track and the next major expansion of the system. Core v1 narrows the current release gate so identity and governed control can be closed without pretending the privacy route is finished. It does not remove STRK20 from the repository, product narrative, architecture, or roadmap.

STRK20 remains hard-gated on:

```text
Wallet API/prover authorization
→ STRK20 pool action
→ accepted receipt
→ private-state readback
→ conservation / failure-recovery evidence
→ independent verification
```

Until those facts exist, the implementation and integration remain visible as in-repository work with an honest evidence status, not as an absent feature.


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
