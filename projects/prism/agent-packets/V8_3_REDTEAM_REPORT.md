# Lane C Contract/Security Red-Team Report — PrismIdentityRegistry V8.3

- **Lane:** backend lane C (contract + security red team)
- **Worktree:** `backend-0x-closeout` @ `agent/backend-0x-closeout`, baseline `b9018ab` (derived from verified `4e7682d`)
- **Date:** 2026-08-23
- **Evidence level: X2 throughout.** All findings and test results below are local snforge/vitest-level facts. No deployment, testnet/mainnet transaction, indexer run, or live Base verification exists or is claimed. Live/deployment claims remain X0; contract/spec/test evidence is X2.

---

## 1. Scope and method

Adversarial review of the full V8.3 diff (`b9018ab` vs `4e7682d`) plus the
complete System artifact set, followed by property/adversarial tests written at
the Cairo layer (`contracts/prism_identity_registry/tests/test_redteam.cairo`,
12 new tests) against the attack classes named in the lane brief:

guard ordering · atomicity · digest consumption · active destination pointer ·
event reconstruction · stale-pointer races · duplicate/replay · controller
abuse · zero/boundary values · no-reactivation.

## 2. Verification performed (exact)

```text
scarb clean && scarb build   → OK (scarb 2.20.0 / cairo 2.20.0)
snforge test                 → Tests: 38 passed, 0 failed
                               (26 baseline: 19 V8.3 + 7 PRISM-7 regression;
                                12 new red-team/property tests)
```

Static/spec checks: cross-read of all `projects/prism/system/*.md|yaml` against
`src/lib.cairo`; guard-order trace; storage-key analysis; event-replay
reconstruction check; grep sweep for stale PROPOSED/DECISION_REQUIRED drift.
No frontend file, operation/API file, deployment config, strk20.json, register
(DECISIONS/AUDIT/EVIDENCE_LEDGER/CANONICAL_STATE), credential, or remote ref
was touched.

## 3. Findings

Severity scale: CRITICAL (blocks deployment) / HIGH / MEDIUM / LOW / NOTE.

### RT-01 — MEDIUM — Multi-ACTIVE shadow binding via last-bind-wins pointer
**Attack:** controller binds account A on (P, BASE) [ACTIVE], then binds
account B on the same pair (no cross-account exclusivity in this slice; only
the identical triple is blocked by ERR-008). The pointer now names B. Revoking
B yields NoActiveDestination even though A's binding is still ACTIVE in
storage — A is a live canonical fact that resolve() cannot reach, and event
reconstruction alone would show two ACTIVE bindings where resolution shows one
or none.
**Verified by:** `rt_multi_active_last_bind_wins_and_shadow_active_unresolvable`
(observed behavior pinned, not endorsed).
**Spec status:** the old CONTRACT_SPEC OP-8-02 text ("deterministic
first-by-binding-order … list variant") described behavior that does not exist
in code — corrected this session to record actual last-bind-wins semantics.
**Disposition:** genuinely requires the owner decision DEC-PRISM-SYS-002
(cross-ID/account exclusivity). Options: (a) accept allow-and-observe with an
indexer-side multiplicity alarm; (b) EXTEND-class contract change blocking new
binds while any ACTIVE binding exists for the (prism_id, venue) pair. Not
chosen here. Not deployment-blocking IF (a) is consciously chosen and recorded.

### RT-02 — VERIFIED-SOUND — Guard ordering & atomicity
Order is existence → controller → venue → zero-account → duplicate-active →
digest-consumed, all before any write; bind/revoke are single-tx atomic by
sequencer ordering. Property tests prove failed binds consume nothing:
`rt_duplicate_active_still_reverts_before_digest_write`,
`rt_digest_single_use_survives_failed_interleavings`. No partial-state path
exists. Matches CONTRACT_SPEC §5 and INV-SYS-003/004.

### RT-03 — VERIFIED-SOUND — Digest single-use is global and total
Consumed once ever across keys, identities, and boundary values including the
zero digest (`rt_zero_digest_is_legal_and_single_use`,
`rt_zero_digest_second_use_reverts`). Map never cleared. FT-003 / INV-SYS-004 /
TEST-8-3-3 satisfied at T3/T5 depth.

### RT-04 — VERIFIED-SOUND — No stale-pointer survival, no reactivation
Revoke clears the active_destinations pointer iff it still names the revoked
account; rebind re-points it; revoke→rebind→revoke cycles stay coherent
(`rt_revoke_rebind_revoke_pointer_cycle_is_coherent`). REVOKED is terminal —
no entrypoint writes `active:true` except bind-with-fresh-digest creating a
NEW instance (INV-SYS-006). Idempotent-revoke fast path sits behind the same
controller gate, so it cannot be abused as a foreign-principal oracle
(`rt_foreign_principal_cannot_revoke_even_idempotent_path`).

### RT-05 — LOW — Revoke path has no venue validation
`revoke_binding` validates existence + controller but not the venue constant;
an unsupported venue simply keys to a non-existent binding → ERR-009. Safe by
storage keying (cannot touch another venue's binding);
`rt_revoke_under_wrong_venue_finds_no_binding`. Cosmetic asymmetry vs bind's
ERR-001 check; note for the error-code histogram only.

### RT-06 — HIGH (pre-deployment gate) — Cross-network replay window (chainId)
Without chainId binding in the challenge envelope, a proof signed against one
Base network can be presented at a bind targeting another; onchain defenses
(controller sig + fresh digest) cannot see it. Full assessment, options,
compatibility facts, and the decision-record template:
`projects/prism/agent-packets/CHAINID_V2_DECISION_PACKET.md`.
**Red-team position: ACCEPT e8886af + spec companion as a hard pre-deployment
security gate (G2/G3 prerequisite). NOT canonicalized — no owner decision
record exists; SD-008 remains open everywhere by design.**

### RT-07 — NOTE — Trusted-verifier trust concentration
Under accepted Option A, onchain trust reduces to (fresh digest + controller
signature); every cryptographic guarantee of Base ownership lives in the
offchain ladder (X2-offchain only, EIP-1271 checker is a test double). This is
the documented cost of DEC-PRISM-SYS-001, correctly stated in the artifacts —
recorded here so no future reader mistakes X2 local passes for live-ladder
evidence. No "trustless" claim is permitted anywhere.

### RT-08 — NOTE — Controller abuse surface is honest
The controller can bind arbitrary accounts (including ones it does not control
on Base) because the registry never sees proofs — only digests. That is the
accepted model (backend gates proof validity; controller authority is absolute
over its identity, matching INV-SYS-002). Consequence worth stating: a phished
controller is total compromise of that identity's binding state. Acceptable for
v0; belongs in the security narrative, not in code changes.

## 4. Event reconstruction audit

Replaying `PrismIdentityCreated*`, `ExecutionIdentityBound*`, `BindingRevoked*`
in chain order reproduces identities exactly (controller/blocks/version
immutable through binding lifecycles —
`test_prism_id_persists_through_binding_lifecycle`). Binding reconstruction is
exact EXCEPT under RT-01 multiplicity: two ACTIVE binds on one (prism_id,
venue) reconstruct as two ACTIVE rows while resolve() exposes at most one.
EVENT_CATALOGUE's reconstruction guarantee therefore holds at the row level and
is resolution-divergent only inside the unresolved DEC-PRISM-SYS-002 surface.
Indexer obligations in the readiness packet §5 remain the correct mitigation
point (multiplicity observable at index time).

## 5. Error/event/state spec-vs-implementation audit

| Catalogue entry | Implementation | Verdict |
|---|---|---|
| ERR-001..005, 007..009 | exact panic felt252s, guard order per spec | MATCH |
| ERR-010 | Option::None view flag, revert-free | MATCH |
| ERR-011 | benign idempotent success, no duplicate event | MATCH |
| EVT-* payloads | exactly {catalogue fields}, keyed per schema v1 | MATCH |
| SM-PRISM-002 | ACTIVE↔REVOKED single-path, terminal REVOKED | MATCH |
| OP-8-02 uniqueness clause | spec said first-by-order + list variant; code is last-bind-wins, no list variant | FIXED this session |

Drift sweep result after fixes: the only remaining PROPOSED /
DECISION_REQUIRED markers are DEC-PRISM-SYS-002 (correctly unresolved),
SD-008/e8886af chainId disposition (correctly unresolved pending owner), and
PRODUCT_BACKEND_GATE's own DRAFT header (input document, out of scope).

## 6. Gate / requirement mapping

| Requirement | Status at this report |
|---|---|
| AUDIT G1 (registry create/read + invariants) | contract+tests green at X2; gate remains NOT_IMPLEMENTED until live observation (X0 runtime) |
| AUDIT G2 (ownership proof + binding) | offchain slice 42/42 + onchain bind acceptance at X2; BLOCKED pre-deploy on RT-06 chainId decision + target-network declaration; runtime X0 |
| AUDIT G3 (resolution + revocation) | decisive tail implemented and X2-tested incl. FT-001/FT-004 onchain halves; runtime X0 |
| T3 property | NEW coverage this session (digest-totality, no-consume-on-revert, id-collision-freedom) |
| T4 contract unit | 26-test baseline preserved byte-for-byte green |
| T5 adversarial | NEW coverage this session (foreign-principal bind/revoke incl. idempotent path, multi-ACTIVE characterization) |
| T6/T7/T9–T12 | NOT_EVIDENCED (unchanged; offchain store/op/indexer layers unbuilt) |
| Product Foundry truth | no protected decision mutated; DEC-PRISM-001..018 intact |
| System Foundry authority/state/error/reconciliation | audited §5; three drift items fixed; nothing silently canonicalized |
| Research Foundry evidence limits | everything herein ≤X2; ledger rows untouched |
| Notion SC-04 (state truth) | resolve honesty verified onchain (INV-SYS-007 sentinel paths) — X2 |
| Notion SC-05 (revocation finality) | no-reactivation proven at T3/T5 — X2 |
| Notion SC-06 (event reconstruction) | holds at row level; RT-01 divergence recorded — X2 |
| Notion SC-20/21 (authority separation, controller-only mutation) | INV-SYS-002 adversarially confirmed — X2 |
| Notion SC-22 (replay protection) | digest totality + nonce CAS documented; service layer X2, contract layer X2 |

## 7. Unresolved decisions (owner: Jason)

1. **DEC-PRISM-SYS-002** — cross-ID/account exclusivity (pre-existing, unchanged).
   RT-01 gives it a concrete resolution-divergence consequence; recommend
   deciding before deployment, not after.
2. **SD-008 / e8886af chainId-v2 disposition** — decision packet provided
   (`CHAINID_V2_DECISION_PACKET.md`) with recommendation ACCEPT-as-gate;
   explicitly NOT canonicalized here.
3. **Target-network declaration** (readiness packet §7.2) — prerequisite for
   wiring `defaultChainId` if e8886af is accepted.

## 8. Evidence ceiling statement

Everything in this report is **X2: locally controlled verification**. No
contract is deployed anywhere; no class hash, address, or tx hash exists;
EVD-PRISM-004..007 remain X0; gates G1/G2/G3 remain NOT_IMPLEMENTED in
AUDIT.md; strk20.json is untouched and empty by design. There is **no
deployment claim** of any kind in this worktree or report.

## Session footer

```text
Model: ox-alpha (Hermes 0x Alpha) — lane C
Baseline: b9018ab (V8.3, from verified 4e7682d)
Verification: scarb clean && scarb build && snforge test → 38 passed / 0 failed
New tests: contracts/prism_identity_registry/tests/test_redteam.cairo (12)
Spec fixes: CONTRACT_SPEC.md (OP-8-01 digest-placement comment; OP-8-02
  uniqueness clause), STACK_DECISIONS.md (stale SD-004 header)
Packets added: V8_3_REDTEAM_REPORT.md (this file), CHAINID_V2_DECISION_PACKET.md
Registers edited: none. Frontend/ops/deploy/strk20.json: untouched. No push, no deploy.
```
