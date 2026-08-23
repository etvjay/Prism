# Prism Invariants — PRISM-7 / PRISM-8
## System Foundry Package v0.1 (authority: System Foundry; status: proposed)

Machine-readable companion: `invariants.yaml`. Format follows SYSTEM_FOUNDRY §9.

Upstream anchors: INV-PRISM-001…016 (docs v0.3 §29) are Product truth; the INV-SYS-* entries below allocate their system-level enforcement for this slice.

---

## INV-SYS-001 — Prism ID is not any execution address

```yaml
invariant_id: INV-SYS-001
statement: The registry's identity key is a PrismID that is structurally distinct from every bound execution account and from the controller address.
why: DEC-PRISM-002 / INV-PRISM-001 / STARKNET_SYSTEM_PROFILE protected boundary.
scope: OBJ-PRISM-001, OBJ-PRISM-003
authoritative_enforcement: registry id allocation (counter-derived), never an address-typed key
secondary_validations: [domain tests asserting id type ≠ address type]
violating_commands: []
tests: [TEST-7-2-1, TEST-7-2-4]
severity: critical
monitoring_signal: n/a (structural)
recovery_procedure: none — violation is a design break requiring REOPEN of DEC-PRISM-002
evidence_required: contract source review + T1/T4 tests
```

## INV-SYS-002 — Controller-only mutation

```yaml
invariant_id: INV-SYS-002
statement: Every state-mutating registry call (create is once-per-id; bind/revoke) executes with caller == identity.controller or the documented creation rule; no other principal can mutate protected state.
why: DEC-PRISM-003; docs v0.3 §7 authority map.
scope: all registry writes
authoritative_enforcement: Starknet contract caller checks
secondary_validations: [backend refuses to relay txs whose caller cannot be controller]
violating_commands: [CMD-8-01 on foreign identity, CMD-8-02 on foreign identity]
tests: [TEST-7-2-3, TEST-8-3-2]
severity: critical
monitoring_signal: alert on any reverted not-controller path in production traces
recovery_procedure: revert is the recovery; investigate if observed post-deploy
evidence_required: T5 adversarial suite
```

## INV-SYS-003 — Canonical only after Starknet transition

```yaml
invariant_id: INV-SYS-003
statement: A verified Base ownership proof confers zero canonical effect until the binding transaction reaches Starknet execution_status SUCCEEDED; VERIFIED ≠ ACTIVE.
why: ASM-PRISM-005 validation clause; DEC-PRISM-001 (Starknet root).
scope: CMD-B-02 → TR-8-01 boundary
authoritative_enforcement: registry state; backend never persists "binding" before tx confirmation
secondary_validations: [operation lifecycle SM-PRISM-003 gates UI states]
violating_commands: [any backend shortcut writing binding rows pre-confirmation]
tests: [TEST-8-3-4]
severity: critical
monitoring_signal: operation stuck in confirming beyond timeout escalates to requires_attention
recovery_procedure: reconciliation job re-reads chain status; operation corrected, never faked
evidence_required: T6/T9 tests + FT-001 run record
note: semantics assume DEC-PRISM-SYS-001 (ACCEPTED — Option A, 2026-08-23)
```

## INV-SYS-004 — Proof digest single-use

```yaml
invariant_id: INV-SYS-004
statement: Each accepted OwnershipProof's digest is consumed exactly once across all binds, ever; a second submission reverts regardless of registry state.
why: FT-003 replay test; RESEARCH gate Q8.2/A3.
scope: OBJ-PRISM-005, TR-8-01
authoritative_enforcement: onchain consumed-digest map inside registry (ACCEPTED Option A under DEC-PRISM-SYS-001); server nonce store as first line
secondary_validations: [challenge service rejects known-consumed digests pre-submission]
violating_commands: [CMD-8-01 with used digest]
tests: [TEST-8-2-6, TEST-8-2-7, TEST-8-3-3]
severity: critical
monitoring_signal: counter of replay attempts (ERR-007 occurrences)
recovery_procedure: revert; security review if replay observed from valid-looking proofs
evidence_required: fixture corpus with replayed × domain/account/prism-id variants (RESEARCH gate §9)
```

## INV-SYS-005 — Submitted ≠ completed

```yaml
invariant_id: INV-SYS-005
statement: No surface (API, UI, receipt) represents submitted/confirming work as complete.
why: INV-PRISM-015; STARKNET_SYSTEM_PROFILE transaction truth.
scope: SM-PRISM-003
authoritative_enforcement: operation state machine gates completion on reconciled
secondary_validations: [frontend derives labels from operation state only]
violating_commands: []
tests: [TEST-8-9-x lifecycle assertions]
severity: high
monitoring_signal: drift check D2 if UI shows completed early
recovery_procedure: fix projection; upstream review required (D2+)
evidence_required: T10 frontend integration test
```

## INV-SYS-006 — Revocation is terminal and preserves the parent identity

```yaml
invariant_id: INV-SYS-006
statement: REVOKED bindings never return to ACTIVE through any existing command, and revocation never destroys or mutates the parent PrismIdentity.
why: INV-PRISM-002/INV-PRISM-004; decisive proof tail (CANONICAL_STATE §10); EVD-PRISM-007.
scope: SM-PRISM-002
authoritative_enforcement: registry has no reactivation entrypoint
secondary_validations: [resolver filters status==ACTIVE only]
violating_commands: []   # absence of a command is the enforcement
tests: [TEST-8-4-2, TEST-8-4-3]
severity: critical
monitoring_signal: n/a
recovery_procedure: re-binding same account requires fresh proof as a NEW binding (by design)
evidence_required: FT-001 full sequence at X3+
```

## INV-SYS-007 — Resolver honesty under staleness

```yaml
invariant_id: INV-SYS-007
statement: resolve() returns NO_ACTIVE_DESTINATION for revoked/stale bindings even when caches/indexers still hold prior active state; cache/RPC disagreement resolves in favor of canonical Starknet state within the stated reconciliation window.
why: INV-PRISM-004; STARKNET_SYSTEM_PROFILE reconciliation rule; Q8.4.
scope: QRY-8-01
authoritative_enforcement: registry read (or indexer with bounded-staleness guarantee + re-check)
secondary_validations: [cache entries carry block watermark; entries below confirmed watermark are invalidated]
violating_commands: []
tests: [TEST-8-4-4 cache-disagreement test]
severity: critical
monitoring_signal: staleness metric (confirmed_block − served_block)
recovery_procedure: serve canonical-or-empty; never serve stale-active
evidence_required: T12 failure/recovery test
```

## INV-SYS-008 — Registry minimalism

```yaml
invariant_id: INV-SYS-008
statement: The registry stores no social handles, viewing keys, private balances, portfolio, or linkage metadata beyond (prism_id, venue, execution_account, status, blocks, proof_digest).
why: RESEARCH gate ban #10; INV-PRISM-008..011 adjacent privacy posture; PRISM-7 acceptance A7-5.
scope: OBJ-PRISM-001, OBJ-PRISM-003 storage layout
authoritative_enforcement: contract schema review gate (A7-5 diff review)
secondary_validations: [event payloads carry only binding fields]
violating_commands: []
tests: [TEST-7-5-1 source-diff review checklist]
severity: high
monitoring_signal: repo inspection per milestone
recovery_procedure: remove field before deploy; deployed additions are BREAK-class
evidence_required: recorded review in EVIDENCE_LEDGER
```

## INV-SYS-009 — Venue-native authorization

```yaml
invariant_id: INV-SYS-009
statement: Base proofs verify with Base-valid cryptographic rules (EOA ecrecover | EIP-1271 | ERC-6492 ladder); Starknet actions verify with Starknet signatures; neither substitutes the other.
why: DEC-PRISM-004; INV-PRISM-006/007; A2/U1.
scope: OBJ-PRISM-005 verification
authoritative_enforcement: backend verifier implements the full ladder; no ecrecover-only shortcut
secondary_validations: [fixture corpus covers all three signature classes]
violating_commands: [CMD-B-02 with wrong-class signature accepted]
tests: [TEST-8-2-1..TEST-8-2-5]
severity: critical
monitoring_signal: distribution of signature classes accepted (sudden 100% EOA would signal ladder bypass)
recovery_procedure: reject; fix verifier
evidence_required: TEST-8.2 fixture results table
note: STRENGTHEN-class addition flagged for owner acceptance (RESEARCH gate C14/U1)
```

## INV-SYS-010 — Nonce single-use at service boundary

```yaml
invariant_id: INV-SYS-010
statement: A challenge nonce is consumable by exactly one successful verification; concurrent verifications of one nonce yield one VERIFIED.
why: RESEARCH gate A3/S4 server-side nonce tracking.
scope: challenge service
authoritative_enforcement: atomic compare-and-set consume-on-verify
secondary_validations: [expiry sweep marks EXPIRED]
violating_commands: [CMD-B-02 double-verify]
tests: [TEST-8-1-2, TEST-8-1-3]
severity: high
monitoring_signal: duplicate-nonce attempt counter
recovery_procedure: second attempt rejected ERR-006
evidence_required: T6 unit suite
```

## INV-SYS-011 — Challenge domain/account/prism-id tamper-evidence

```yaml
invariant_id: INV-SYS-011
statement: Any alteration of domain, venue, account, prism_id, nonce, or expiry between issuance and verification fails verification with a distinct error code.
why: Q8.2 six-binding requirement; A8-3 field-mutation matrix.
scope: OBJ-PRISM-005
authoritative_enforcement: digest over canonical serialized challenge; verifier recomputes
secondary_validations: []
violating_commands: [CMD-B-02 with mutated fields]
tests: [TEST-8-2-4 mutation matrix]
severity: critical
monitoring_signal: rejection-reason histogram
recovery_procedure: reject; user restarts flow
evidence_required: fixture corpus
```

## INV-SYS-012 — No cross-chain value movement in this slice

```yaml
invariant_id: INV-SYS-012
statement: PRISM-7/8 operations move no tokens and imply no bridge/solver capability.
why: DEC-PRISM-010; CON-PRISM-004; INV-PRISM-013.
scope: entire slice
authoritative_enforcement: registry holds no token approvals; contract has no transfer entrypoints
secondary_validations: [source review asserts absence]
violating_commands: []
tests: [TEST-7-5-1 includes absence check]
severity: high
monitoring_signal: n/a
recovery_procedure: design break → upstream routing
evidence_required: review note
```

---

# Allocation summary

| Upstream invariant (Product) | Enforced here by |
|---|---|
| INV-PRISM-001 | INV-SYS-001 |
| INV-PRISM-002 | INV-SYS-006 |
| INV-PRISM-003 | INV-SYS-003 + INV-SYS-009 |
| INV-PRISM-004 | INV-SYS-006 + INV-SYS-007 |
| INV-PRISM-006/007 | INV-SYS-009 + INV-SYS-002 |
| INV-PRISM-008/009 | out of slice (no social principals modeled); storage ban via INV-SYS-008 |
| INV-PRISM-010 | INV-SYS-008 (minimal fields) |
| INV-PRISM-011 | n/a — registry never touches viewing keys (INV-SYS-008) |
| INV-PRISM-013 | INV-SYS-012 |
| INV-PRISM-014 | prohibited-claims list (SYSTEM_CANONICAL §8) |
| INV-PRISM-015 | INV-SYS-005 |
| INV-PRISM-016 | out of slice (STRK20 Phase 5 concern) |
