# Backend Phase M3 Review — proof_digest + prismId Representation Fix — HEAD b54787d follow-up

**Lane:** implementation/review only (Hermes 0x Alpha; no ChatGPT/Codex).
**Scope guard honored:** no secrets, no broadcast/deploy, no push, no
Linear/Notion, no frontend/Phase 8, no M8/M9, `strk20.json` untouched. No live
transactions were issued at any point.

---

## 1. Defects (exact sources)

| # | Location | Fact |
|---|---|---|
| D1 | `src/features/prism-identity/domain/challenge.ts:117-121` (`buildChallenge`) | `digest = crypto.keccak256Utf8(canonical)` → full **256-bit** hex; also `challengeId`/`challenge.digest`. |
| D2 | `src/application/prism-application.ts:207` (pre-fix) | bind accepts any `/^0x[0-9a-fA-F]{64}$/` — full 256-bit passes the gate. |
| D3 | `src/features/prism-operations/adapters/starknet-submit.ts:186-212` (pre-fix) | calldata placed `input.proofDigest` verbatim into position 4 (index 3). |
| D4 | `contracts/prism_identity_registry/src/lib.cairo:91,267` | `proof_digest: felt252` in OP-8-01 interface and impl. |
| D5 | `contracts/.../lib.cairo:204-206,290,316` | `consumed_digests: Map<felt252, bool>` keyed by that felt; ERR-007 single-use. |
| D6 | Canon: `projects/prism/system/DOMAIN_MODEL.md:113,147`, `INVARIANTS.md:62-71,189`, `CONTRACT_SPEC.md:65-95` | digest = keccak256(canonical challenge bytes), consumed once onchain (DEC-PRISM-SYS-001 Option A). |
| D7 | `src/features/prism-operations/adapters/starknet-submit.ts:207,243` (pre-X2-fix) | `calldata: [input.prismId, ...]` sent application Prism IDs such as `prism:1` verbatim. Registry expects `felt252 0x1`; `prism:1` is not a felt. Same for `revoke_binding`. |
| D8 | `contracts/prism_identity_registry/src/lib.cairo:65-92` | `prism_id: felt252` (counter-allocated, ids start at 1). felt252 range `[0, 2^251+17·2^192+1)`. |
| D9 | `src/application/prism-application.ts:216` (pre-X2-fix) | `isDigestConsumed(proofDigest)` used full 256-bit digest, not the felt that the registry keys. Same field-mapping inconsistency as D3→D5. |

Observed parent failure (digest): real digest `0x95aee8cf…5e370f` rejected by sncast as
out-of-range before broadcast. felt252 range `[0, 2^251+17·2^192+1)`; a uniform
keccak output is ≥ 2^250 with probability ~1 − 2⁻⁵, so essentially every real
digest fails D3→D4 as written.

Observed second defect (prismId): `prism:1` is the canonical offchain
`prism:<decimal>` form, but Starknet `felt252` expects `0x1`. Verbatim
`prism:1` in calldata is a type error (not a felt), will be rejected by the
sequencer/gateway before execution.

## 2. Options

**Rejected — silent truncation / modulo / hand repair of the runbook value.**
Forbidden by task constraints and by evidence discipline; lossy and unauditable.

**Rejected — base36/hash/silent repair of prismId (e.g. base36 decode of `P7F21`).**
Violates task constraint: reject nonnumeric/unrepresentable forms with stable
ERR-002/ERR-023 rather than silently base36/hash/repair. Inventing a new social
ID encoding is forbidden.

**Rejected — change registry to u256 or string:** mutates CONTRACT_SPEC OP-8-01 /
OP-7-01 canon (owner-gated), forces redeploy of an immutable contract, zero
security gain.

**Rejected — different onchain hash (Pedersen/Poseidon/starknet_keccak):**
changes OBJ-PRISM-005 semantics anchored in DEC-PRISM-SYS-001; orphans all
persisted records and cross-chain audit correlation keyed to the EVM keccak.

**Rejected — declare blocked without implementation:** unnecessary; canon-
preserving fixes exist.

**ACCEPTED — named field-bounded digest representation**, applied at exactly one
Starknet choke point, mirroring the ecosystem's own `starknetKeccak` 250-bit-mask
convention:

```
felt_digest(d) = d                  if d < 2^250   (pass-through)
felt_digest(d) = d & (2^250 − 1)    otherwise      ("starknet-masked")
```

**ACCEPTED — named explicit prismId boundary conversion `prismIdToRegistryFelt`:**

```
registry_felt(prismId) = hex(decimal)   if prismId == "prism:<decimal>" with
                                          decimal ∈ [1, FELT_PRIME), no leading
                                          zeros, no sign, digits only
                        else → throw ERR-002 (malformed/non-numeric/leading-zero/zero)
                             or ERR-023 (overflow ≥ FELT_PRIME)
```

Both mappings are pure functions applied only at the Starknet calldata boundary;
full 256-bit digest and canonical `prism:<decimal>` remain the offchain truth.

## 3. Implementation (exact lines)

New/updated module `src/features/prism-identity/domain/felt-digest.ts`:
- `FELT_PRIME` (L18), `DIGEST_MASK_250` (L26), `isFeltInRange` (L30),
  `toFieldBoundedDigest` (L52-77) — strict 64-hex gate, mask branch sets
  `bounded:true` and echoes `source`; malformed input throws explicitly,
  never silently repaired. `feltMatchesDigest` (L82).
- **NEW** `prismIdToRegistryFelt` (L~95-135): canonical `prism:<decimal>` →
  felt hex; validates prefix, non-empty decimal, digits-only, no leading zeros,
  positive, `< FELT_PRIME`; returns minimal `0x` hex (e.g. `prism:1` → `0x1`);
  malformed → `ERR-002`, overflow → `ERR-023`; never base36/hash/repair.

Starknet choke point wiring `src/features/prism-operations/adapters/
starknet-submit.ts`:
- L14 import both mappings; L188-225 `submitBind`: `toFieldBoundedDigest` for
  `feltDigest` (ERR-023 on malformed), `prismIdToRegistryFelt` for
  `registryPrismId` (ERR-002/ERR-023 per prefix/range), calldata
  `[registryPrismId, venue, executionAccount, feltDigest]` with exact positions
  0 and 3 as felts; L239-278 same prismId conversion for `submitRevoke` position 0.
  No silent truncation/repair.

Digest-consumed precheck boundary `src/application/prism-application.ts`:
- L15 import `toFieldBoundedDigest`; L216-221 convert `proofDigest` → `feltDigest`
  before `isDigestConsumed(feltDigest)`, so the offchain replay check keys the same
  felt as the onchain `consumed_digests` map. Malformed → ERR-023. Full digest
  remains in fingerprint/operation store.

In-memory test double parity `src/application/adapters/in-memory-registry.ts`:
- Internal helper `toFeltDigestHex` (same 250-bit mask) used for
  `isDigestConsumed`, `seedBinding`, `submitBind` check, `applyBindForTest` store,
  so that full-digest replay via felt collision is correctly rejected as ERR-007
  (fail-closed), mirroring the real registry.

Representation consistency (requirement met):
- Challenge response & persisted records: FULL digest unchanged
  (`challenge.ts:117-121`, stores under `src/features/prism-identity/adapters/`).
- Offchain product IDs: `prism:1` string unchanged in DB/operation fingerprint.
- Application replay pre-check: felt digest (`prism-application.ts:216`).
- Bind calldata + registry `consumed_digests`: same felt via the single choke point;
  prismId likewise `0x1` at position 0.
- Evidence/runbooks: nothing rewritten; parent failure value preserved verbatim
  here and in tests as the regression fixture.
- In-range digests (< 2^250): byte-identical end-to-end (test-pinned).

## 4. Security analysis

- **Tamper evidence (INV-SYS-011)** unchanged — verifier recomputes the FULL
  digest over canonical serialized bytes; masking happens after verification,
  at calldata assembly only.
- **Replay (INV-SYS-004)** fail-closed: onchain map keys the felt. A felt-space
  collision between two distinct challenges manifests as ERR-007 rejection, not
  a second consumption of an unconsumed proof. The precheck now keys the same
  felt, so offchain pre-rejection is consistent with onchain (availability-only
  residual, never double-spend). Residual is availability-flavored only.
- **PrismId integrity:** `prismIdToRegistryFelt` is deterministic and total on
  the canonical decimal domain; identical `prism:1` → `0x1` always, so replay/
  reconciliation reproduces identical calldata. Non-canonical inputs (e.g.
  `prism:P1`, `prism:001`, `prism:-1`) are rejected, not coerced, preventing
  type-confusion or hash-collision tricks.
- **Collision/domain boundary (digest):** masking discards top 6 bits; two distinct
  digests collide only if their keccak outputs differ solely above bit 249 — a
  ~2⁻⁶ per-pair event ON TOP of keccak256 second-preimage resistance over fixed-
  key-order serialized bytes. Pinned algebraically by test.
- **Determinism/replay:** pure functions; identical challenge → identical felt;
  identical prismId → identical felt; re-submission reproduces identical calldata.
- **No silent loss:** `bounded` flag + persisted full digest keep the mapping
  auditable; prismId offchain string is preserved, felt only at boundary.

## 5. Tests added/updated

- UPDATED `src/features/prism-identity/__tests__/felt-digest.test.ts`:
  - Original 8 digest tests (in-range pass-through, real parent-failure mapping,
    out-of-range masking, max-u256, malformed rejection, 64-vector determinism,
    collision algebra, round-trip).
  - **NEW** `prismIdToRegistryFelt` suite (7 tests): `prism:1` → `0x1` and
    `prism:42` → `0x2a`, leading-zeros policy (`prism:001`/`00` rejected),
    malformed/non-numeric/negative/empty/missing-prefix rejected with ERR-002
    (no base36/hash), overflow ≥ FELT_PRIME rejected with ERR-023, trimming
    and offchain-vs-felt separation.

- UPDATED `src/features/prism-operations/__tests__/starknet-submit.test.ts`:
  - Fixtures updated to canonical `prism:1` (old `prism:P1` was non-decimal and
    now correctly rejected).
  - Existing D3→D4 test preserved: out-of-range digest → masked felt at position 3
    and in-range unchanged.
  - **NEW** M3-X2 tests: `prism:1` → `0x1` at calldata[0] exact position,
    large decimal → hex, revoke calldata[0] felt, malformed/non-numeric/
    negative/leading-zeros → ERR-002 and overflow → ERR-023 (no silent repair),
    combined felt prismId + felt digest at exact positions 0 and 3.

- UPDATED `src/application/adapters/in-memory-registry.ts` to store/check felt
  digests, so `isDigestConsumed` via the precheck correctly rejects felt-space
  collisions (ERR-007).

- UPDATED `src/features/prism-operations/__tests__/bundle-2r-live-boundaries.test.ts`:
  prismId fixtures corrected to `prism:1`.

## 6. Verification (real execution)

- `npm test`: **469 passed, 14 skipped, 0 failed** (46 files) — +12 over 457 baseline from the two new boundaries.
- `npm run typecheck` (`tsc --noEmit`): clean.
- `npm run build` (Next.js 16.3.1 webpack): compiled successfully.
- `scarb build` (contracts/prism_identity_registry): success (registry contract untouched).
- `scarb test` (snforge): **38 passed, 0 failed** — replay/boundary suite still green (P5 zero-digest, ERR-007 across identities).
- No live transactions; sncast never invoked against a network this session.

## 7. Foundry/AUDIT mapping

- Canon NOT mutated: `projects/prism/system/*`, `projects/prism/DECISIONS.md`
  untouched. Derived proposals:
  `projects/prism/DECISION_PROPOSAL_DEC_PRISM_SYS_004_DIGEST_REPRESENTATION.md`
  (digest, draft DEC-PRISM-SYS-004) and prismId boundary documented here as
  potential DEC-PRISM-SYS-005 (explicit owner decision required if canon is to
  record the `prism:<decimal>` ↔ `felt252` mapping; until then implementation ships
  with this proposal attached).
- Evidence ledger: not modified (no live evidence produced); this review + tests
  are X2 local-only artifacts.
- Consistent with DEC-PRISM-SYS-001 Option A (backend verifies, controller signs,
  registry consumes) and INV-SYS-004/011 semantics. PrismId boundary closes the
  type error without mutating CONTRACT_SPEC OP-7-01/8-01 (both already felt252).

## 8. Verdict

Both boundaries are explicit, named, pure, and applied at the single Starknet
choke point each, with no silent repair and with stable ERR codes. Full digests
and `prism:<decimal>` remain canonical offchain; felt only at calldata/read
boundary. No new social ID encoding was invented.

**M3_DIGEST_AND_PRISM_ID_BOUNDARIES_FIXED_X2**
