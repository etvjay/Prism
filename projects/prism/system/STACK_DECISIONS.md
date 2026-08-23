# Prism Stack Decisions — PRISM-7 / PRISM-8
## System Foundry Package v0.1 (authority: System Foundry; status: proposed)

Each decision records what/why/reopen. Pins follow the repo's existing pins and RESEARCH gate A5 (pins are deliberate; `next`-tag upgrades require freshness re-check, never silent).

---

## SD-001 — Contract: Cairo + Scarb + Starknet Foundry (snforge)

```yaml
decision_id: DEC-SYS-SD-001
decision: Smallest Scarb crate for PrismIdentityRegistry; snforge tests; separate from the Next.js app tree
reason: canonical Starknet toolchain; matches RESEARCH gate V7.1 and PRODUCT gate §4
alternatives_rejected: [entangling contract code in the Next.js app, TypeScript-only "contract simulation"]
reopen_if: toolchain version conflict with pinned starknet.js 10.4.0 deployment path
status: proposed-canonical-input
```

## SD-002 — Deployment posture: immutable, no proxy

```yaml
decision_id: DEC-SYS-SD-002
decision: no upgradeability/proxy complexity in sprint scope
reason: CANONICAL_STATE non-goals + minimalism rule; upgrade paths add authority surface with zero evidenced need
consequences: bugs require redeploy + re-bind; acceptable at v0 data volumes
reopen_if: evidenced constraint appears (never convenience)
```

## SD-003 — Backend shape: modular monolith

```yaml
decision_id: DEC-SYS-SD-003
decision: single backend service, layered domain/application/ports/adapters per SYSTEM_FOUNDRY §13; docs v0.3 §32 module names respected as internal boundaries
reason: PRISM-7/8 off-chain surface is one challenge service + indexer + resolver; service separation is unjustified
constraint: domain layer imports no web framework / RPC SDK / DB driver
```

## SD-004 — Base verification: viem-style unified ladder — DECISION_REQUIRED dependency

```yaml
decision_id: DEC-SYS-SD-004
decision: backend verifier implements EOA ecrecover → EIP-1271 isValidSignature → ERC-6492 unwrap via a unified verify library (viem-class), covering all three signature classes
reason: S3/S4 corroboration (RESEARCH gate C17); naive ecrecover-only silently rejects ERC-4337 Base Accounts (C14/U1)
depends_on: DEC-PRISM-SYS-001 (ACCEPTED — Option A) — this is the verifying half of that mechanism
```

## SD-005 — Challenge format: SIWE/EIP-712-class typed challenge

```yaml
decision_id: DEC-SYS-SD-005
decision: challenge is a typed structured message carrying {domain, venue, execution_account, prism_id, nonce, expiry}; digest = keccak256 over canonical serialization
reason: tamper-evidence per INV-SYS-011; wallet-native signing UX; S4 SIWE checklist parity
note: exact wire format (SIWE vs EIP-712) is an implementation detail within this envelope
```

## SD-006 — Environment scoping

```yaml
decision_id: DEC-SYS-SD-006
decision: default dev/runtime environment SN_SEPOLIA (+ Base Sepolia); SN_MAIN only behind Jason-approved release gate; all addresses/env config environment-scoped; STARKNET_RPC_URL never hard-coded
reason: CON-PRISM-012 resolution; STARKNET_SYSTEM_PROFILE network rules
```

## SD-007 — No new dependencies without recorded justification

```yaml
decision_id: DEC-SYS-SD-007
decision: any package added to support PRISM-7/8 is recorded here or in the implementation PR with version pin + reason; `next`-tagged pins re-run freshness check at each phase start (A5)
reason: C7 drift risk; sprint hygiene gates
```

---

Stack summary:

```text
contracts   Scarb + snforge, immutable deploy, separate crate
backend     modular monolith (Node/TS aligning with existing app), ports/adapters
verify      unified ladder library (EOA/1271/6492)
chain access  STARKNET_RPC_URL env-scoped adapter; Base RPC adapter
storage     durable op rows + nonce store (any ACID store; choice left to implementation)
frontend    existing Next.js app; consumes operations/errors only (out of spec scope)
```
