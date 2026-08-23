# PRISM-8 — V8.1–V8.2 Offchain Slice Implementation Report

- **Packet**: `projects/prism/agent-packets/IMPLEMENTATION_PACKET.md`
- **Branch**: `agent/prism-8-ownership`
- **Worktree**: `/home/ubuntu/prism-work/backend-prism8`
- **Session date**: 2026-08-22
- **Status**: implemented, locally verified (X2 only — see Evidence Level)

---

## 1. Scope statement

This change implements **only** the constrained V8.1–V8.2 offchain proof slice:

| Packet item | Status |
|---|---|
| V8.1 challenge construction (canonical serialization, digest, TTL) | ✅ implemented |
| V8.1 single-use nonce + expiry semantics | ✅ implemented |
| V8.2 signature verification ladder (EOA / EIP-1271 / ERC-6492 abstraction + local fixtures) | ✅ implemented |
| Explicit error mapping (in-scope codes only) | ✅ implemented |
| Concurrency/replay negative coverage | ✅ implemented |

Explicitly **NOT** implemented (packet prohibitions):

- V8.3 binding acceptance / canonical bind (`bind_prism_id`)
- `resolve` / `revoke` paths
- Any Starknet mutation or contract call
- Any backend canonical-authority shortcut

`VERIFIED` in this slice means *offchain signature verified* only; it is
**non-canonical** by construction and enforced structurally (see §5).

## 2. Architecture

Hexagonal layout under `src/features/prism-identity/` honoring the SD-003
constraint that domain logic stays independent of web/RPC/DB adapters:

```
src/features/prism-identity/
├── domain/            # zero external imports
│   ├── hex.ts         # self-contained hex/byte utils
│   ├── errors.ts      # ERR catalogue mirror + PrismError + detail discriminators
│   ├── identifiers.ts # venue / EVM address / prism-id validation
│   ├── ports.ts       # Clock, ChallengeCrypto, SmartWalletSignatureChecker,
│   │                  # OwnershipProofStore (CAS nonce), state types
│   ├── challenge.ts   # canonical serialization, digest, TTL clamp, message render
│   ├── signature-class.ts   # structural classification incl. ERC-6492 parse/build
│   └── verification.ts      # faithful-echo check + ladder composition
├── application/
│   └── challenge-service.ts # issueChallenge / submitProof / getChallenge ONLY
├── adapters/          # the only layer allowed external SDKs
│   ├── clock.ts                 # systemClock / fixedClock / failingClock
│   ├── memory-ownership-proof-store.ts
│   ├── viem-crypto.ts           # keccak256, EIP-191 recovery, CSPRNG nonce
│   └── viem-smart-wallet-checker.ts
├── testing/fixtures.ts  # labeled deterministic doubles (provenance in §6)
└── __tests__/           # acceptance suite (§4)
```

Key decisions:

1. **Canonical form**: `"PRISM-OWNERSHIP-CHALLENGE v1\n" + JSON` with fixed key
   order (domain, execution_account, expires_at, issued_at, nonce,
   prism_id, schema_version, venue). `digest = keccak256(canonical)` and
   `challengeId === digest` — one value serves idempotency and integrity.
2. **Signable message**: SIWE-style human-readable rendering of the canonical
   fields, signed via EIP-191 `personal_sign`.
3. **TTL clamp**: requested TTL clamped to `[30s, 600s]` (spec ≤ 10 min).
4. **Submit ordering** (matches CMD-B-02's declared error surface):
   load → faithful-echo digest comparison FIRST → expiry gate → CAS nonce
   consumption → ladder → guarded state transition.
   - Digest-first ordering means all six field mutations yield ERR-012 even if
     a mutation would also fail structural validation.
   - Expiry before consumption keeps the nonce UNUSED when ERR-013 fires.
   - Consumption precedes verification (consume-on-attempt): a second
     submission fails ERR-006 **even with a valid signature**, per CMD-B-02
     irreversibility.
5. **Ladder classification** is structural only: 65-byte v∈{27,28,0,1} ⇒
   `eoa_candidate`; ERC-6492 magic-suffixed ⇒ parsed wrapper; anything else ⇒
   ERR-014 with detail `malformed_signature` | `unsupported_signature_class`.
   An EOA candidate whose recovery mismatches falls through to the EIP-1271
   port (deployed smart wallets may emit ECDSA-layout blobs). The checker port
   returns valid / invalid / undetermined; undetermined maps to ERR-021, never
   to silent invalid, and there is no ecrecover fallback inside it.

## 3. Error crosswalk (vs `projects/prism/system/errors.yaml`)

In-scope codes exercised end-to-end by
`__tests__/error-crosswalk.test.ts`, with stable shape assertions
(`name`/`category`/`retryable`/`userAction`/`httpStatusHint`):

| Code | Scenario in this slice | Test |
|---|---|---|
| ERR-001 | unsupported venue enum at issuance | issue-challenge |
| ERR-002 | malformed prism id at issuance (detail `malformed_prism_id`) | issue-challenge |
| ERR-003 | wrong signer over intact message; wrapper owner mismatch | eoa / smart-wallet tests |
| ERR-005 | zero address / malformed execution account | issue-challenge |
| ERR-006 | replayed or concurrent second attempt; lost state race | replay-expiry-concurrency |
| ERR-012 | altered echo (per-field detail `altered_fields:<name>`), unknown challenge (`unknown_challenge`) | mutation-matrix, eoa |
| ERR-013 | submitted at/after `expiresAt` (`ttl_exceeded`) | replay-expiry-concurrency |
| ERR-014 | malformed vs unsupported signature classes (distinct details, same code) | malformed-and-dependency-failures |
| ERR-021 | clock/store/checker dependency failures with `<dependency>:<reason>` details | issue-challenge, smart-wallet |

Out of scope by design (asserted absent from the module's error surface):
ERR-004, ERR-007, ERR-008, ERR-009, ERR-010, ERR-011, ERR-020, ERR-022,
ERR-023.

Documented catalogue gaps filled with explicit details (no silent invention):
unknown-challenge-id ⇒ ERR-012 `unknown_challenge`; malformed prism id ⇒
ERR-002 `malformed_prism_id`.

## 4. Verification commands and results

Run from the repo root on branch `agent/prism-8-ownership`:

| Command | Result |
|---|---|
| `npx vitest run` (aka `npm test`) | ✅ 8 files, **42 passed / 42**, ~3.4 s |
| `npm run typecheck` (`tsc --noEmit`) | ✅ clean, no output |
| `npm run build` (`next build --webpack`) | ✅ compiled + typecheck + static gen (routes unchanged: `/`, `/_not-found`) |

Coverage against TEST_ARCHITECTURE ids:

| Test id | Covered by |
|---|---|
| TEST-8-1-1 determinism/mutation sensitivity | serialization.test.ts |
| TEST-8-1-2 single-use nonce (+8-way concurrency, forged race) | replay-expiry-concurrency.test.ts |
| TEST-8-1-3 TTL boundary (accept −1 s, reject exactly at boundary) | replay-expiry-concurrency.test.ts |
| TEST-8-2-1 EOA class | submit-proof-eoa.test.ts |
| TEST-8-2-2 deployed EIP-1271 | submit-proof-smart-wallet.test.ts |
| TEST-8-2-3 undeployed ERC-6492 | submit-proof-smart-wallet.test.ts |
| TEST-8-2-4 echo-mutation matrix (6 fields) | mutation-matrix.test.ts |
| TEST-8-2-5 wrong signer | submit-proof-eoa.test.ts |
| Error/test crosswalk | error-crosswalk.test.ts |
| Malformed vs unsupported classes; dependency failures | malformed-and-dependency-failures.test.ts |

Bugs found and fixed during verification (kept for honesty): a missing `await`
on promise-returning recovery calls (adapter + fixture double) silently turned
valid recoveries into null/invalid; an ERC-6492 builder mis-accounting of the
mandatory 32-byte length word corrupted wrapper layouts (caught by round-trip
parse test); classifier now treats magic-suffixed-but-undecodable blobs as
`malformed_signature`.

## 5. Scope-boundary enforcement (structural)

- `PrismChallengeService` public surface is exactly `issueChallenge`,
  `submitProof`, `getChallenge`; a capability test asserts no prototype member
  name contains bind/canonical/resolve/revoke/accept/register.
- State machine excludes CONSUMED-as-terminal and any binding states; REJECTED
  is terminal.
- No file in the module imports Starknet or any chain transport; only
  `adapters/viem-*` import viem, used purely for crypto primitives.
- `PRISM_ID` format guard test reiterates INV-SYS-001 (prism ids are not
  addresses).

## 6. Fixture provenance and limitations (honest)

- All EOA keys are generated fresh at runtime via viem `generatePrivateKey`;
  nothing hard-coded, persisted, or logged.
- `LocalErc1271SemanticsChecker` is a labeled deterministic TEST DOUBLE
  implementing ERC-1271 accept/reject semantics locally (recover-to-registered-
  owner). It performs **no network calls** and does **not** prove live Base
  behavior.
- ERC-6492 wrappers are built with a parser-symmetric builder following the
  standard layout `abi.encode(address owner, bytes data, bytes signature) ||
  magicBytes(0x64926492…6492)`; layout confirmed against viem 2.55.19's own
  parse implementation in `node_modules`. Round-trip parse is tested.
- Local fixture pass ≠ live-chain compatibility. On live Base, ERC-6492 support
  depends on the validator contract and RPC honoring the standard; this slice
  only guarantees the offchain logic and its seams.

## 7. Evidence level

All results above are **local evidence level X2** (deterministic unit/integration
suite in-repo). No chain interaction, no fork test, no runtime trace was
produced, and none is claimed. Per LIVE_EXECUTION_CONTEXT.md, no fabricated
runtime evidence is included anywhere in this report.

## 8. Assumptions made

1. Unknown challenge id at submit maps to ERR-012 (`unknown_challenge`) since
   the catalogue lacks an explicit not-found code for this op.
2. Malformed prism id at issuance maps to ERR-002 with detail
   `malformed_prism_id` (catalogue gap).
3. RNG duplicate challenge id (fault-injected) surfaces as ERR-021
   `challenge_store_unavailable:duplicate_challenge_id` rather than retrying
   internally — retries are an adapter concern.
4. Deterministic RPC reverts from `verifyMessage` map to `{status:"invalid"}`;
   transport/outage errors map to `{status:"undetermined"}` ⇒ ERR-021.
5. Dependencies pinned exactly per SD-007: `viem@2.55.19` (runtime primitives),
   `vitest@4.1.11` (dev-only). Both were already present extraneously in
   `node_modules`; they are now explicit manifest entries.

## 9. Remaining risks / deferred work

1. Live EIP-1271/ERC-6492 behavior unverified (needs Base fork/live RPC pass —
   out of scope per packet).
2. The in-memory store is a reference adapter; production persistence must
   implement the same atomic `consumeNonce` CAS guarantee.
3. `markRejectedBestEffort` failure after a failed verify leaves state ISSUED
   with consumed nonce (fail-closed: replays still blocked by CAS); surfaced as
   a defensive ERR-006 path rather than data loss.
4. V8.3+ items (binding acceptance, resolve/revoke, onchain digest map) are
   intentionally absent; the packet's follow-up slices own them.

## 10. Prohibited claims self-check

- [x] No claim of contract changes or deployments.
- [x] No claim of live/Base/forknet verification.
- [x] No fabricated transaction hashes, block numbers, or runtime traces.
- [x] No edits to control-plane registers (DECISIONS.md, CANONICAL_STATE.md,
      EVIDENCE_LEDGER.md untouched).
- [x] No private keys committed; fixtures generate keys at runtime.

## Session footer

- Model: ox-alpha
- Date: 2026-08-22
- Branch: `agent/prism-8-ownership`
