# DECISION PROPOSAL (DRAFT — NOT CANON) — DEC-PRISM-SYS-004: Field-bounded proof digest representation for Starknet felt252

> **Status: PROPOSED.** This file is derived documentation only. It does not
> amend `projects/prism/system/*` canon and does not touch any accepted
> decision record (`DEC-PRISM-001..018`, `DEC-PRISM-SYS-001..003`). Owner
> acceptance is required before any of the text below enters
> `projects/prism/DECISIONS.md` or the System layer.

## Subject

`proof_digest = keccak256(canonical challenge bytes)` (OBJ-PRISM-005,
INV-SYS-011, DEC-PRISM-SYS-001 Option A) is a full 256-bit value.
`PrismIdentityRegistry.bind_execution_identity` accepts
`proof_digest: felt252` (`contracts/prism_identity_registry/src/lib.cairo`,
OP-8-01). A real digest — `0x95aee8cf18d7533b8cf6c782bcdf9987915df4a08a6d8c2c14bc4989af5e370f`
— was rejected by sncast as out-of-range before broadcast (observed parent
failure at HEAD 43dc02a→9816f7c line).

felt252 range: `[0, 2^251 + 17·2^192 + 1)`. A uniform keccak256 output exceeds
even 2^250 with probability ~1 − 2⁻⁵; the interface as written can accept
essentially no real digest.

## Proposed mapping (named: field-bounded digest representation)

    felt_digest(d) = d                    if d < 2^250   (pass-through)
    felt_digest(d) = d & (2^250 − 1)      otherwise      ("starknet-masked")

This mirrors the ecosystem convention Starknet itself uses for `starknetKeccak`
(keccak output masked to 250 bits), so it follows existing canon rather than
inventing a scheme.

Applied at exactly ONE choke point:
`src/features/prism-operations/adapters/starknet-submit.ts` calldata assembly.
The full 256-bit digest remains canonical in: challenge response, persisted
challenge/proof records, application replay pre-check (`isDigestConsumed`),
evidence envelopes. Nothing is rewritten, truncated, or "repaired" in any
runbook.

## Security analysis

- Tamper evidence (INV-SYS-011) unchanged: verifier recomputes and compares the
  FULL digest over canonical serialized bytes.
- Replay (INV-SYS-004): onchain `consumed_digests` keys the felt value. A
  felt-space collision between two distinct digests manifests as ERR-007
  (fail-closed rejection), never as a second consumption of an unused proof.
  The residual is therefore availability-flavored only, not integrity.
- Collision residual: masking discards the top 6 bits, so two distinct
  challenges collide in felt space only if their keccak outputs differ solely
  above bit 249 — a ~2⁻⁶ event per adversarial pair ON TOP of keccak256
  second-preimage resistance over distinct serialized bytes (fixed key order,
  INV-SYS-011). Probability per legitimate pair: negligible.
- Determinism/replay of bind tx: same challenge → same full digest → same felt;
  re-submission after nonce failure reproduces identical calldata.

## Options considered

1. **ACCEPTED — field-bounded mask at the boundary** (above). Smallest explicit
   change; no contract redeploy; no canon mutation; follows starknetKeccak
   precedent.
2. REJECTED — truncate/modulo in the runbook or repair the specific value by
   hand: silent loss, non-auditable, explicitly forbidden by task constraints
   and by evidence discipline.
3. REJECTED — change the registry parameter to `u256` / ByteArray: requires
   contract redeploy, mutates CONTRACT_SPEC OP-8-01 canon (owner-gated),
   larger attack/calldata surface for zero security gain.
4. REJECTED — derive the onchain value differently (e.g. Pedersen/poseidon hash
   or `starknet_keccak` of the challenge): changes OBJ-PRISM-005 semantics
   (keccak256 is DEC-PRISM-SYS-001-anchored), breaks every persisted record and
   cross-chain audit correlation keyed to the EVM-side keccak digest.
5. DEFERRED-BLOCKED alternative — declare M3 blocked pending owner canon change:
   available but unnecessary given option 1 preserves all invariants without
   touching System Foundry truth.

## What owner acceptance would require (append-only)

```yaml
decision_id: DEC-PRISM-SYS-004        # next free id after SYS-003
layer: System/Data-Representation
status: <ACCEPTED | REJECTED>
subject: field-bounded (250-bit masked) proof_digest representation for felt252 calldata
decided_by: Jason
decided_at: <date>
companion_work:
  - amend DOMAIN_MODEL.md OBJ-PRISM-005 note with the named mapping (EXTEND-class)
  - amend CONTRACT_SPEC.md OP-8-01 with calldata representation note
  - add TEST_ARCHITECTURE.md row for felt-boundary tests (in/out-of-range/collision)
```

No artifact in this worktree fills this template. Until accepted, the mapping
ships as implementation with this proposal attached; if rejected, the registry
interface must change first (option 3) and M3 remains blocked by interface.

---

# ADDENDUM — M3-X2 second boundary: prismId `prism:<decimal>` → felt252

> **Status: PROPOSED (companion to SYS-004).** Same scope guard: derived doc only,
> not canon until owner accepts as `DEC-PRISM-SYS-005` (or as an amendment to
> `DOMAIN_MODEL.md` PrismId representation note).

## Subject

`StarknetSubmitAdapter.submitBind` previously placed the application Prism ID
verbatim (`prism:1`) into `bind_execution_identity` calldata. The registry
expects `prism_id: felt252` (`0x1`). `prism:1` is not a felt and is rejected by
the sequencer/gateway as a type error. The offchain canonical form remains
`prism:<decimal registry id>`; only the Starknet boundary needs the hex felt.

## Proposed mapping (named: `prismIdToRegistryFelt`)

```
registry_felt("prism:<decimal>") = 0x hex(decimal)   if decimal ∈ [1, FELT_PRIME)
                                   and no leading zeros, no sign, digits-only
                                 else → ERR-002 (malformed) or ERR-023 (overflow)
```

Applied at exactly the same choke point: `StarknetSubmitAdapter.submitBind`
(position 0) and `submitRevoke` (position 0). No base36, hash, or silent repair.
Offchain IDs (`prism:1` strings in DB, operation fingerprints, challenge records)
are unchanged; only the calldata carries `0x1`. Malformed inputs such as
`prism:P1`, `prism:001`, `prism:-1`, `prism:abc`, overflow `≥ FELT_PRIME` are
rejected with stable `ERR-002`/`ERR-023` rather than coerced.

A companion fix was applied to the digest precheck boundary
(`PrismApplicationService.bind` now does `isDigestConsumed(toFieldBoundedDigest
(digest).felt)`), so the offchain replay check keys the same felt as the
onchain `consumed_digests` map.

## What owner acceptance would require (append-only)

```yaml
decision_id: DEC-PRISM-SYS-005        # next free id after SYS-004
layer: System/Data-Representation
status: <ACCEPTED | REJECTED>
subject: prismId felt252 boundary — canonical prism:<decimal> ↔ 0x hex felt
decided_by: Jason
decided_at: <date>
companion_work:
  - amend DOMAIN_MODEL.md PrismId note with named mapping and leading-zeros policy (EXTEND)
  - amend CONTRACT_SPEC.md OP-7-01/8-01 with felt representation note
  - add TEST_ARCHITECTURE.md row for prismId boundary tests (prism:1, leading zeros, malformed/overflow, calldata position)
```

Until accepted, this mapping ships as implementation with this addendum attached.
If rejected, the alternative is to change the registry interface or the
application's canonical ID serialization first, and M3 remains blocked by
interface pending owner/system decision.
