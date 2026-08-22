# Prism Test Architecture — PRISM-7 / PRISM-8
## System Foundry Package v0.1 (authority: System Foundry; status: proposed)

Tests derive from these specifications, not from implementation convenience (SYSTEM_FOUNDRY §25). Maturity rule: local pass = X2; deployed + observed = X3+; mainnet + independent re-read = X4/X5 (EVIDENCE_LEDGER scale). A criterion counts as met only with observed evidence recorded in the ledger (PRODUCT_BACKEND_GATE §7).

---

# 1. Ladder mapping

| Tier | Scope | What it proves here |
|---|---|---|
| T1 Domain | challenge digest rules, field binding, TTL math | INV-SYS-011 |
| T2 State machine | all legal/illegal transitions of SM-PRISM-001/002/003 | invalid REVOKED→ACTIVE absent; VERIFIED≠ACTIVE |
| T3 Property | replay/monotonicity fuzz: no double-digest consumption under any interleaving | INV-SYS-004, INV-SYS-010 |
| T4 Contract unit | registry ops storage/auth/revert/events | OP-7-01..OP-8-03 specs |
| T5 Contract adversarial | wrong caller, duplicate create, replayed digest, front-run bind attempts | INV-SYS-002, ERR-004/007/008 |
| T6 Backend | challenge service, verifier ladder, op lifecycle | CMD-B-01/02, ERR codes |
| T7 DB integration | nonce store atomicity, op durability across restart | reconciliation table rows 6–7 |
| T8 API contract | error shapes, idempotency, watermark headers | ERROR_CATALOGUE completeness |
| T9 Ledger integration | backend ↔ registry event indexing | reconstruction guarantee |
| T10 Frontend integration | state labels derive from op states only | INV-SYS-005 |
| T11 E2E | decisive proof sequence (FT-001) end-to-end | CANONICAL_STATE §10 |
| T12 Failure/recovery | RPC outage, indexer lag, duplicate events, restart mid-bind | AUTHORITY_MATRIX §4 table |
| T13 Upgrade/migration | n/a this slice (immutable contract by decision) | — |
| T14 Performance | only if requirements justify; not sprint-critical | — |

---

# 2. PRISM-7 exact tests (acceptance set A7-x)

Positive:
- TEST-7-2-1 authorized actor creates identity exactly once; read returns identical controller/block on repeat (A7-1, A7-2).
- TEST-7-3-1 event stream of created identities reconstructs identity state from receipts alone (A7-4).

Negative:
- TEST-7-2-2 second `create_identity` for a colliding id path fails / ids never collide (uniqueness).
- TEST-7-2-3 non-controller mutation attempt rejected with ERR-004 (A7-3).

Boundary:
- TEST-7-2-4 identity key type ≠ address type; id counter rollover behavior defined (INV-SYS-001).
- TEST-7-5-1 storage/event schema diff review: no portfolio/social/metadata fields; no token transfer entrypoints (A7-5, INV-SYS-008/012).

Evidence gates: scarb build + snforge green on clean checkout w/ commit SHA (A7-6); EVD-PRISM-004 moves only after live-network create/read observation (A7-7).

---

# 3. PRISM-8 exact tests

Challenge service (TEST-8.1):
- TEST-8-1-1 challenge carries domain+venue+account+prism_id+nonce+expiry; digest stable over canonical serialization.
- TEST-8-1-2 single-use nonce: two concurrent verifications → exactly one VERIFIED.
- TEST-8-1-3 expired challenge verify fails ERR-013.

Verification ladder (TEST-8.2) — fixture corpus required for every row:
- TEST-8-2-1 valid EOA signature passes.
- TEST-8-2-2 valid EIP-1271 signature from deployed smart wallet passes.
- TEST-8-2-3 valid ERC-6492 wrapped signature from undeployed account passes.
- TEST-8-2-4 mutation matrix: alter prism_id / account / domain / venue / nonce / expiry each → ERR-012 (distinct reason recorded).
- TEST-8-2-5 wrong signer over intact message → ERR-003.
- TEST-8-2-6 replayed consumed proof → ERR-006 at service, ERR-007 at contract.
- TEST-8-2-7 replay variants × (domain, account, prism_id) all fail.

Binding acceptance (TEST-8.3):
- TEST-8-3-1 correct owner binds intended account (A8-1).
- TEST-8-3-2 unrelated signer cannot bind another's identity — FT-002 (A8-2).
- TEST-8-3-3 same digest submitted twice → second reverts ERR-007 even against fresh registry state (FT-003, A8-5).
- TEST-8-3-4 offchain VERIFIED without tx produces NO canonical change (A8-8, INV-SYS-003).

Resolve + revoke (TEST-8.4):
- TEST-8-4-1 resolve(P, BASE) returns active account pre-revocation (A8-6).
- TEST-8-4-2 after revoke: resolve = NO_ACTIVE_DESTINATION and P still readable — FT-001 + FT-004 combined (A8-7, decisive proof).
- TEST-8-4-3 revoked→active transition impossible via any exposed entrypoint.
- TEST-8-4-4 cache-disagreement: stale cache holding ACTIVE is overridden by canonical REVOKED within bound (INV-SYS-007, Q8.4).

Error crosswalk (TEST-8.5): spec-vs-test check that ERR-002..ERR-014 each appear in ≥1 test assertion (A8-9).

---

# 4. Decisive workflow (T11 / vertical slice)

```text
create P → issue challenge → Base wallet signs (ladder class recorded)
→ verified → controller signs bind → resolve(P,BASE)=B
→ revoke B → resolve = NO_ACTIVE_DESTINATION → get_identity(P) succeeds
```

Must be exercised including: success, rejected input (ERR-012), permission failure (ERR-004), stale-state conflict (ERR-023), dependency failure (ERR-021 + recovery), retry (idempotent paths), recovery (restart mid-op). Vertical-slice gate stays OPEN until run at implementation time.

---

# 5. Environment & maturity plan

```text
devnet (snforge):        T1–T5, T7            → X2 ceiling
SN_SEPOLIA + Base testnet: T9–T12 decisive seq  → X3
SN_MAIN (release-gated):  repeat decisive seq   → X4/X5 territory (V8.6, Jason-approved gate only)
```

Per CON-PRISM-012: default environment SN_SEPOLIA; mainnet is an explicit release gate. Registry ops alone do NOT satisfy hub own-contract evidence (INV-016 belongs to Phase 5) — keep expectations separate.
