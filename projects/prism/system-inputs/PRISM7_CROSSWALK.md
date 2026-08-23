# PRISM-7 Implementation Crosswalk — PrismIdentityRegistry

Implementation run: 2026-08-22 · worker: Hermes `stealth/ox-alpha` · branch `agent/prism-7-registry`
Contract path: `contracts/prism_identity_registry/` (separate Scarb crate; not entangled with the Next.js app)

Toolchain observed (exact):
- `scarb 2.20.0 (f6832b048 2026-07-23)` · cairo 2.20.0 · sierra 1.9.3
- `snforge 0.63.0` (pins scarb 2.20.0 per its `.tool-versions`)
- deps: `starknet = "2.20.0"`, dev-deps `snforge_std = "0.63.0"`, `assert_macros = "2.20.0"`

---

## 1. Operation crosswalk (CONTRACT_SPEC.md / operations.yaml)

| Spec op | Implemented as | Conformance notes |
|---|---|---|
| OP-7-01 create_identity | `IPrismIdentityRegistry::create_identity() -> felt252` | caller becomes controller (`get_caller_address()`); id allocated by registry counter starting at 1 — callers cannot choose an id, so the duplicate/colliding creation path does not exist (uniqueness by construction). Reads/writes only `id_counter` + `identities[new_id]`. Emits EVT-PRISM-IDENTITY-CREATED. No metadata beyond controller + block (INV-SYS-008). No pause mechanism (minimalism rule). |
| OP-7-02 get_identity | `get_identity(prism_id) -> Option<Identity>` | public view; deterministic repeat reads; returns `None` (NOT_FOUND flag) instead of reverting for unknown ids — ERR-010 mapped as view-return flag per spec (`revert_codes: []`). |
| OP-8-01/02/03 bind/resolve/revoke | **NOT implemented** | PRISM-8 scope; hard ordering honored. Storage shape reserved in source documentation (`bindings`, `consumed_digests` keys named in comments on the storage struct) without implementing operations or adding dead storage. |

## 2. Event crosswalk (EVENT_CATALOGUE.md / events.yaml)

| Spec event | Implemented as | Conformance notes |
|---|---|---|
| EVT-PRISM-IDENTITY-CREATED | `PrismIdentityCreated` (struct inside contract `Event` enum; `#[key] prism_id`) | past-tense name matches; payload exactly `{prism_id, controller}`; schema v1; replay/idempotent by event_key (prism_id once ever — counter guarantees). TEST-7-3-1 reconstructs identity state from captured receipts alone and matches canonical reads. |

## 3. Error crosswalk (ERROR_CATALOGUE.md / errors.yaml)

| Code | Surface in this slice |
|---|---|
| ERR-010 identity_not_found_read | `get_identity` returns `Option::None` for unknown id (view flag, revert-free) — asserted by test. |
| ERR-004 not_controller | Structural in PRISM-7: the only mutating entrypoint is `create_identity` under the documented creation rule; there is no entrypoint through which a non-controller can mutate an existing identity. Adversarial probe (`set_controller` invocation from outside) reverts with entrypoint-not-found — asserted by TEST-7-2-3. The ERR-004 *revert code itself* first becomes reachable at OP-8-01/03 (PRISM-8), where `assert_controller` style checks will use it explicitly. |
| ERR-003 internal allocation collision | Treated as unreachable panic per OP-7-01 spec; counter construction makes it unreachable. Not asserted by a test (spec says treated as unreachable). |
| All other codes | Out of slice (PRISM-8 / backend layers). |

## 4. Invariant coverage

| Invariant | Enforcement here | Test |
|---|---|---|
| INV-SYS-001 (PrismID ≠ address/controller) | counter-derived felt252 ids starting at 1; id type ≠ ContractAddress type | TEST-7-2-1, TEST-7-2-4 |
| INV-SYS-002 (controller-only mutation) | creation rule is the only write path; no other muting entrypoint exists | TEST-7-2-1 (creation rule), TEST-7-2-3 (adversarial probe) |
| INV-SYS-006 analogue at P7 scope | identities immutable once written; no deletion/mutation entrypoint | test_identity_survives_unrelated_state_growth |
| INV-SYS-008 (registry minimalism) | storage = {id_counter, identities{id,controller,block,version}, schema_version}; event payload 2 fields | source review (TEST-7-5-1 checklist below) |
| INV-SYS-012 (no value movement) | no token approvals, no transfer entrypoints | source review (below) |

TEST-7-5-1 source-diff checklist (A7-5): [x] no social/handle fields · [x] no viewing keys/balances/portfolio/linkage metadata · [x] no token transfer entrypoints · [x] no bridge/solver surface · [x] no upgradeability/proxy (SD-002).

## 5. Test → acceptance mapping (TEST_ARCHITECTURE §2)

| Test ID (file: tests/test_prism7.cairo) | Acceptance criterion |
|---|---|
| test_7_2_1_authorized_create_succeeds_and_read_is_deterministic | A7-1, A7-2 positive + determinism |
| test_7_2_2_duplicate_creation_impossible_ids_never_collide | A7 uniqueness/replay-duplicate negative |
| test_7_2_3_unauthorized_identity_mutation_fails | A7-3 unauthorized mutation negative |
| test_7_2_4_boundary_identity_key_type_distinct_from_addresses | boundary, INV-SYS-001 |
| test_7_3_1_events_reconstruct_identity_state | A7-4 event emission + reconstruction from receipts |
| test_err010_unknown_id_read_returns_not_found_flag | ERR-010 read-path negative |
| test_identity_survives_unrelated_state_growth | future-compatible storage boundary / parent preservation analogue |

Observed results (clean checkout: `scarb clean && scarb build && snforge test`):

```
Tests: 7 passed, 0 failed, 0 ignored, 0 filtered out
```

TDD record: tests were written and observed FAILING (missing contract module) before
implementation existed; implementation was then written minimally to green.

## 6. Evidence maturity statement

All evidence above is LOCAL (devnet-free snforge runner): **X2 ceiling at most**.
No deployment, class hash, network receipt, or live create/read observation was
performed or claimed. EVD-PRISM-004 remains X0 pending SN_SEPOLIA observation.
EVIDENCE_LEDGER intentionally NOT updated by this commit (no observed-result
envelope for X3+; local results recorded here and in commit message only).

## 7. Assumptions & deviations recorded

1. `create_identity()` takes no controller argument: OP-7-01 yaml writes
   `identities[new_prism_id] = {controller=caller}` and AUTHORITY_MATRIX §2 says
   caller becomes controller, so the controller IS the tx sender. Tests prank the
   caller to simulate distinct accounts.
2. Cairo plugin requires the event struct be reachable via the contract's `Event`
   enum; the emitted onchain name remains `PrismIdentityCreated` (variant name).
   The contract module is declared `pub` so integration tests can reference the
   typed event for assertion.
3. PRISM-8 storage reservation kept as source documentation rather than declared
   dead storage maps — declaring unused maps adds no information and would risk
   silent layout drift before DEC-PRISM-SYS-001 sign-off shapes Binding fields.
4. `schema_version` storage field added (layout generation marker); not specified
   in OBJ-PRISM-001 persisted_fields but read-only and metadata-free — flagged for
   owner review rather than silently dropped.
5. Zero-address guard: OP-7-01 has no invalid-input revert code (caller is implicit),
   so no zero-input rejection exists at creation; the packet's "invalid/zero identity
   input fails if required by the system spec" clause resolves to NOT required for
   PRISM-7 (no caller-supplied identity input exists).

## 8. Remaining risks

- DEC-PRISM-SYS-001 unresolved: PRISM-8 binding ops will reshape storage; if the
  decision lands differently, the reservation notes here get superseded (no code
  rework needed since nothing was implemented).
- snforge 0.63.0/scarb 2.20.0 pins are current-toolchain, not repo-pinned; SD-007
  requires recording them (done above and in commit message).
- No fuzz/property tier (T3) yet — counter monotonicity is unit-tested, not fuzzed;
  low risk given counter construction, revisit at PRISM-8 replay tests.
