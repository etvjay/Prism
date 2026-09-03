# M5 E2E Runner — Evidence & Gate Closure

**Date:** 2026-08-25
**Base:** `040b011` (scoped local M5 hardening; no root evidence mutation)
**Route:** `PrismVesuLendingHelper` · SN_SEPOLIA · `STRK (0x04718f5a…938d) → Vesu STRK vToken (0x07152ae4…f8fff)` · helper `0x07f3dd9a…90adf` pinned to pool `0x0254a6b2…0d91`
**Helper source:** `contracts/prism_vesu_lending_helper/src/lib.cairo:1-187` (canon `privacy_invoke(in_token, out_token, in_amount:u128, note_id) -> Span<OpenNoteDeposit>` preserved 1:1)
**Gate:** `M5_CLOSEOUT_PROTOCOL.md` + `BACKEND_PHASE_M5_E2E_REDTEAM.md` H1 fixed (u256 real-token surfaces, checked `u256→u128` via `try_into` never truncates)

**Snapshot note:** this is historical lane evidence from the stated date/base;
its local test totals are not current repository-wide totals. The full route remains
blocked as documented below.

## Runner

Provider-injected, no mock proof as evidence. Simulate `strk20PrepareInvoke(..., true)` returns empty `proof.data=""` and is never submitted.

```
src/features/prism-strk20/m5/constants.ts
src/features/prism-strk20/m5/ports.ts
src/features/prism-strk20/m5/runner.ts      — capability → fee/registration → exact simulation → actions [transfer OPEN, invoke [STRK,VTOKEN,u128,${openNoteIds[0]}]] → wallet proof boundary → operation/recovery fence → terminal-receipt polling → independent RPC receipt/calldata → pool origin attribution → public no-strand read → optional typed facts → validator gate
src/features/prism-strk20/m5/validation.ts   — exact calldata, receipt, pool-origin, and typed-observation validation
src/features/prism-strk20/m5/operation.ts    — one-submission recovery fence
src/features/prism-strk20/m5/maturity.ts     — explicit maturity state
src/features/prism-strk20/m5/rpc.ts         — fetch-based public RPC (no secrets)
src/features/prism-strk20/m5/validator.ts   — STRK20_VALIDATOR_PATH/URL when configured; null → X2
src/features/prism-strk20/m5/wallet-adapter.ts — WalletAccountV6 (starknet 10.4.0, get-starknet 6.0.3, types-js 0.10.3) → M5Provider
src/features/prism-strk20/m5/__tests__/runner.test.ts — 31 X2 adversarial tests
src/features/prism-strk20/m5/__tests__/validation.test.ts — 6 validation/attribution tests
src/features/prism-strk20/m5/__tests__/operation.test.ts — 4 operation/recovery tests
src/features/prism-strk20/m5/__tests__/maturity.test.ts — 3 maturity-state tests
src/features/prism-strk20/m5/__tests__/rpc.test.ts — 5 X2 JSON-RPC shape/readback tests
ops/m5-vesu-e2e/harness.mjs                 — CLI: --self-test / offline BLOCKED / --live (requires wallet)
ops/m5-vesu-e2e/README.md
```

## Local verification (X2)

```
contracts/prism_vesu_lending_helper: scarb build → ok (starknet 2.20.0)
contracts/prism_vesu_lending_helper: snforge test → 16 passed, 0 failed
contracts/prism_allocation_helper: snforge test → 11 passed, 0 failed (regression)
npm test -- src/features/prism-strk20/m5/__tests__/runner.test.ts → 31 passed, 0 failed
npm test -- src/features/prism-strk20/m5/__tests__/rpc.test.ts → 5 passed, 0 failed (entry_point_selector/transaction calldata/u256/readback shape)
npm test -- M5 validation/operation/maturity suites → 13 passed, 0 failed
npm test -- action/receipt/privacy focused tests → 52 passed, 0 failed
npm test (full) → 1030 passed, 1 skipped (100 files)
npm run typecheck → 0 errors
npm run build → compiled, static 7/7
git diff --check → 0
```

## Live predicates — observed via public/read-only RPC (no wallet, no secret)

Executed against `https://starknet-sepolia-rpc.publicnode.com` (read-only):

| Predicate | Expected | Observed |
|---|---|---|
| helper class hash at address | `0x00ee923c2e4401b0f8090aa15d1948c79f5ba5a45a519903a64a3a4abac244e6` | **observed** via `starknet_getClassHashAt` latest on `0x07f3dd9a…` → `0x00ee923…` matches repo `Scarb.lock` build |
| deployment receipt `0x02bbeb653db64ac5e560c56eba52b19de37d94befdb53c6d5d39d9a998c881f9` | SUCCEEDED, block, events, `class_hash` | **observed** `SUCCEEDED` `ACCEPTED_ON_L1` `block_number 13945547` via `starknet_getTransactionReceipt`; events include `Deployed` with same class hash |
| helper→Vesu probe `0x050d928adbc8cf0b0c6dee1fced73587bb15e87fc15ff277d9d3d2492688db3f` | SUCCEEDED | **observed in ledger** (prior run `M5_LIVE_HELPER_VESU_PROBE.md`) — not re-broadcast here |
| fee live read `get_fee_amount` | bigint ≥0 | **not attempted live** (requires pool call; exercised via X2 double `observeFee`) |
| independent second RPC path | distinct URL | **not configured** in this env → X2 ceiling |

No new deployment, no broadcast, no private state accessed.

## Local evidence ceiling and exact external blocker

The runner now fails closed instead of deriving live predicates from a thin
receipt fixture:

```text
ReceiptPort currently exposes receipt events and optional public ERC-20
balances only. It does not expose raw transaction calldata, a typed Vesu
Deposit/receiver/assets observation, wallet open-note readback, or a wallet/
protocol maturity observation.

Therefore a vToken-address event alone cannot prove helper calldata or a Vesu
deposit, zero helper balances cannot prove note conservation, and a receipt
block cannot prove note maturity. Those predicates remain false and cannot
promote X2 to X3 in the local runner.

WalletV6M5Adapter also returns registration=unknown (`null`) because the
pinned WalletAccountV6 surface has no proven read-only registration query; it
does not fabricate `true` or a block number.
```

The environment has no injected WalletAccountV6/privacy prover session. The
missing session prevents observing wallet authorization, SNIP-36 proof
generation, pool deposit, open-note readback, and maturity. This is the exact
closeout blocker: `BLOCKED_BY_EXTERNAL_PRIVACY_PROVIDER`.

## Live predicates — NOT observed (require wallet/prover)

These remain `not observed` until a real `WalletAccountV6.strk20InvokeTransaction([transfer OPEN, invoke helper])` is executed on SN_SEPOLIA:

```
P2  pool tx hash SUCCEEDED on SN_SEPOLIA
P3  STRK20 pool event in that tx
P4  helper 0x07f3dd9a… appears in pool tx calldata (INVOKE target) — numeric BigInt check
P5  Vesu vToken Deposit (receiver==helper, assets==in_amount) in same tx
P6  open-note/private readback via wallet (note_id, token==vToken, amount==shares delta, mature after ~10 blocks)
P7  conservation: in_amount == assets-in, note.amount == helper measured delta, helper end balances ==0
P8  independent second RPC re-read of P2–P7
P9  upstream validator ok/pool/mine=true (actual hub script, not local reimpl)
```

Without a STRK20-capable wallet/prover, the runner correctly returns:

```
{ verdict: "M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE", reason: "NO_WALLET" | "NO_PROVER", detail: "No WalletAccountV6 provider ... no fabricated hash" }
```

Verified by `harness.mjs` offline run → exit 2, no hash emitted, and by unit tests `no wallet/prover → BLOCKED` and `mock provider → BLOCKED`.

## Failure-state coverage (X2)

All eight required failure states are modeled distinctly in `runner.ts` + tests:

| State | Code | Test |
|---|---|---|
| not registered | `M5-003 NOT_REGISTERED` vs `M5-001` | capability/registration tests |
| screening rejected | `M5-004` | screening rejected |
| screening unavailable | `M5-005` | screening unavailable |
| maturity | `M5-006 MATURITY_PENDING` (10 blocks) | `maturity: <10 blocks not allowed` via `domain/strk20-state` |
| zero output | `M5-007 ZERO_OUT_AMOUNT` | zero-output probe |
| helper revert | `M5-008 HELPER_REVERT` | REVERTED receipt |
| pool rollback (atomic) | `M5-009 POOL_ROLLBACK` | REVERTED → atomic |
| validator mine=false | `M5-010 VALIDATOR_MINE_FALSE` | validator mock false |
| unknown receipt | `M5-011` | null after timeout; `RECEIVED` is polled until terminal |
| simulation/config validation | `M5-022`, `M5-023` | non-empty simulation proof, malformed/zero pinned address |
| + viewing key forbidden | `M5-015`, stranded `M5-020`, overflow `M5-017`, calldata mismatch `M5-018` | additional guards |

## Invariants preserved

- **Calldata:** `[STRK, VTOKEN, amount:u128 felt, "${openNoteIds[0]}"]` exact; verified by `calldataExact` predicate and `addressesEqual` (BigInt numeric, not string equality)
- **u256/u128:** input token surfaces `balance_of/approve/deposit` are `u256`; `delta_u256 >0` then `try_into().expect('OUT_OVERFLOW')` — high limb non-zero aborts, never truncates
- **Denomination:** intended helper output is `VTOKEN` shares, not assets; local calldata proves the requested output token, but actual open-note token/amount and `convert_to_assets` readback remain unobserved.
- **No strk20.json write:** runner and harness never touch `strk20.json`; ledger `transactions=[] contracts=[]` unchanged
- **No mock proof as evidence:** simulate proof `data="" output=[] proof_facts=[]` is enforced and never submitted; `_isMock` provider → `M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE`
- **No receipt overclaim:** helper calldata, Vesu deposit, note readback, maturity, and full conservation remain false until their explicit evidence surfaces exist.

## Verdict

In this environment (no injected WalletAccountV6, no prover, no note-readback session):

```
BLOCKED_BY_EXTERNAL_PRIVACY_PROVIDER
```

The runner is **ready** (`M5_E2E_RUNNER_READY_X2` observed via 31 X2 tests), while
the complete route is blocked by both the missing wallet/prover session and the
missing explicit calldata/Vesu/note/maturity evidence surfaces. The narrow
helper→Vesu probe remains separate evidence and does not close the pool route.

Do not promote merely because a wallet returns a transaction hash. X3 requires
`SUCCEEDED + pool event + raw helper calldata + typed Vesu Deposit
(receiver==helper, assets/shares) + wallet open-note readback + maturity
observation + conservation/no-strand + independent re-read + validator
ok/pool/mine=true`. A future external adapter must supply the missing facts.

## Commit

The scoped M5 commit records the local hardening only. `strk20.json` remains
unchanged (`transactions=[]`, `contracts=[]`); no live evidence is promoted.

## Next operator step (when wallet available)

```
NEXT_PUBLIC_STARKNET_RPC_URL=https://starknet-sepolia.g.alchemy.com/v2/...
M5_RPC_URL=https://starknet-sepolia-rpc.publicnode.com
M5_RPC_URL_2=https://starknet-sepolia.public.blastapi.io
STRK20_VALIDATOR_PATH=ops/evidence/validate.mjs  # or actual hub scripts/build-projects.mjs
# In browser, connect Ready/Xverse on SN_SEPOLIA, fund ≥ in_amount+fee, then invoke runner via dapp
```

Do not use `sncast` or raw account invoke — it cannot produce the SNIP-36 proof and is not an M5 substitute.

## Local boundary addendum — 2026-08-25

`M5_LOCAL_BOUNDARY_CLOSEOUT.md` records the incremental X2 closure after this
snapshot: strict first-party STRK20 action/calldata validation, Starknet field
address bounds, malformed receipt rejection, pinned pool-event origin
attribution (never transaction sender), raw `starknet_getTransactionByHash`
calldata read contract, strict u256 balance decoding, one-submission recovery
fence, timeout/unknown receipt attention state, and explicit maturity/open-note/
Vesu/conservation ports. These additions do not change the evidence ceiling.

A live wallet/prover session, live raw calldata, typed Vesu Deposit, note
readback, maturity, independent endpoint, and upstream validator result remain
**not observed**. The local closeout remains:

```text
M5_LOCAL_BOUNDARY_READY_X2
BLOCKED_BY_EXTERNAL_PRIVACY_PROVIDER
```
