# Prism Phase 0–7 Delegation Convergence Contract

**Status:** Active delegation contract  
**Date:** 2026-08-23  
**Scope:** Phase 0 through Phase 7 only  
**Explicit exclusion:** Phase 8 frontend/Home/product-surface implementation remains owner-led and untouched by these workers.  
**Model policy:** no ChatGPT models; use OpenCode Muse Spark 1.2 free and Hermes 0x Alpha only.

## Shared completion equation

```text
plan
+ implementation
+ required tests
+ Product Foundry QA
+ Research Foundry source/claim review
+ System Foundry authority/state/error/reconciliation alignment
+ Antagonist red-team
+ AUDIT.md gate mapping
+ evidence maturity assignment
+ documentation/reconciliation
+ independent parent verification
= accepted phase packet
```

A worker report is not acceptance. A green isolated suite is not runtime evidence.

## Phase scope

```text
M0 Product/System release contract
M1 Starknet identity root and live identity evidence
M2 Backend runtime + REST/API + SDK + reconciliation
M3 Base decisive proof and bind/resolve/revoke
M4 STRK20 consumer Wallet API route
M5 Prism-owned STRK20 action / PrismClaim decision and testnet readiness
M7 Prism Pause P0–P8 through testnet evidence
C1 PrismChannel minimal testnet slice
```

Phase 8 (`Home`, frontend surfaces, final product shell) is owner-led and must not be edited by delegated workers.

## Non-negotiable boundaries

Workers must not:

```text
touch frontend/Home/landing files
change Phase 8 scope
use ChatGPT models
handle or print private keys/viewing keys/passwords
push GitHub
edit Linear/Notion
write strk20.json
claim mainnet evidence
broadcast mainnet
silently accept an unresolved Product/System decision
```

Testnet broadcasts require an explicit worker-lane authorization and must produce receipt/readback artifacts; otherwise use injected readers/fakes and label X2.

## Required report sections

Every worker must produce a review packet containing:

```text
1. mandate and phase boundary
2. canonical inputs inspected
3. Product Truth preserved
4. Research Foundry sources, freshness, and claim limits
5. System Foundry authority/state/error/invariant mapping
6. implementation/files/commit
7. tests and exact commands
8. antagonist attack cases and findings
9. AUDIT.md G/T/FT gate mapping
10. evidence maturity X0–X5
11. docs/decision drift
12. remaining blockers
13. explicit verdict: ACCEPTABLE_FOR_INTEGRATION or BLOCKED
```

## Convergence rules

- All workers branch from the same parent checkpoint.
- Parallel lanes may not modify the same files unless the lane is explicitly a review-only lane.
- Integration happens only in a parent-controlled worktree.
- Parent reruns the full combined gate after every integration batch.
- Any failed gate cancels the corresponding phase item and creates a corrected item; it is not marked complete.
- Live receipts, deployment, hashes, or privacy claims must be independently read back before being reported as evidence.
- `strk20.json` remains empty until genuine qualifying SN_MAIN hashes exist.
