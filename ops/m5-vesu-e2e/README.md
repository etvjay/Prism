# M5 Vesu E2E Runner — Ops

**Route:** `PrismVesuLendingHelper` · SN_SEPOLIA · STRK → Vesu STRK vToken shares
**Status:** `M5_E2E_RUNNER_READY_X2` (local), `M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE` without wallet/prover; complete closeout `BLOCKED_BY_EXTERNAL_PRIVACY_PROVIDER`

## Purpose

Provider-injected runner that executes the exact canonical M5 flow without ever synthesizing a proof:

```
capability check
→ fee/registration preflight (live get_fee_amount, distinct screening states)
→ simulate/prepared invoke (empty proof, calldata shape verified)
→ exact STRK20 actions [transfer OPEN, invoke helper [STRK, VTOKEN, u128, openNoteId]]
→ wallet-side SNIP-36 proof submission boundary
→ terminal receipt polling/recovery (`RECEIVED`/`PENDING`/`UNKNOWN` are not completion; one-submission fence)
→ independent public RPC readback (receipt + raw transaction calldata; explicit second source for X3)
→ pinned pool-event origin attribution (never transaction sender)
→ public no-strand read (helper STRK==0, vToken==0; not full note conservation)
→ optional explicit Vesu/note/maturity/conservation ports (never inferred)
→ upstream validator invocation when configured
```

All failure states are distinct: `NOT_REGISTERED` (or registration unknown), `SCREENING_REJECTED` vs `UNAVAILABLE`, `MATURITY_PENDING`, `ZERO_OUT_AMOUNT`, `HELPER_REVERT` → `POOL_ROLLBACK` atomic, `VALIDATOR_MINE_FALSE`, `UNKNOWN_RECEIPT`, invalid simulation proof, and malformed pinned configuration.

## Files

- `src/features/prism-strk20/m5/constants.ts` — pinned addresses (STRK, vToken, pool, helper)
- `src/features/prism-strk20/m5/ports.ts` — injected ports (no viewing keys)
- `src/features/prism-strk20/m5/runner.ts` — domain runner (pure, injectable)
- `src/features/prism-strk20/m5/validation.ts` — exact calldata, receipt, pool-origin, and typed-observation validation
- `src/features/prism-strk20/m5/operation.ts` — one-submission operation/recovery fence
- `src/features/prism-strk20/m5/maturity.ts` — explicit maturity-state contract
- `src/features/prism-strk20/m5/rpc.ts` — public/read-only RPC reader
- `src/features/prism-strk20/m5/validator.ts` — upstream validator when `STRK20_VALIDATOR_PATH/URL` set
- `src/features/prism-strk20/m5/wallet-adapter.ts` — `WalletAccountV6` → `M5Provider` (current types: starknet 10.4.0, get-starknet 6.0.3, types-js 0.10.3)
- `src/features/prism-strk20/m5/__tests__/runner.test.ts` — 31 X2 adversarial tests
- `src/features/prism-strk20/m5/__tests__/validation.test.ts` — 6 validation/attribution tests
- `src/features/prism-strk20/m5/__tests__/operation.test.ts` — 4 operation/recovery tests
- `src/features/prism-strk20/m5/__tests__/maturity.test.ts` — 3 maturity-state tests
- `src/features/prism-strk20/m5/__tests__/rpc.test.ts` — 5 X2 JSON-RPC shape/readback tests
- `ops/m5-vesu-e2e/harness.mjs` — CLI harness (offline → BLOCKED, never fabricates hash)

## Boundaries

- Exact calldata: `[STRK, VTOKEN, amount:u128, "${openNoteIds[0]}"]`; amount checked `<= MAX_U128`, zero rejected; malformed/zero pinned addresses fail closed
- u256 real-token surfaces: `balance_of/approve/transfer_from` are u256; helper measures `balance_before/after` delta as u256 → checked `try_into u128` (high limb non-zero → `OUT_OVERFLOW` revert, never truncates)
- Note denomination: `out_token == VTOKEN` and `OpenNoteDeposit.token == VTOKEN`, amount is **shares** not assets (requires `convert_to_assets` at read time)
- Privacy: hides direct user linkage only; amount/timing/target/open-note amount remain public (per header truth statement)
- Viewing keys / seed phrases / private state never touched (guarded by `assertNoViewingKey`)
- Receipt events alone do not prove helper calldata, typed Vesu `Deposit`, open-note amount, maturity, or full conservation. Those predicates remain false until an external provider/session supplies explicit evidence.

## Usage

```bash
# X2 self-test (no wallet, no RPC, no proof)
node ops/m5-vesu-e2e/harness.mjs --self-test
npm test -- src/features/prism-strk20/m5/__tests__/runner.test.ts

# Offline harness (always BLOCKED — no fabricated hash)
node ops/m5-vesu-e2e/harness.mjs
# → M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE

# Live (requires browser-injected WalletAccountV6 + SNIP-36 prover)
# In dapp:
import { M5VesuRunner } from "@/features/prism-strk20/m5/runner";
import { WalletV6M5Adapter } from "@/features/prism-strk20/m5/wallet-adapter";
const runner = new M5VesuRunner({ inAmount: 1000000000000000000n, independentRpc, validator });
const result = await runner.run(adapter); // never fabricates hash on BLOCKED
```

## Live predicates (observed via public RPC only — no wallet)

- `helper class_hash 0x00ee923c… at 0x07f3dd9a…` → observed on `starknet-sepolia-rpc.publicnode.com` (block latest)
- `deployment tx 0x02bbeb65… @13945547 SUCCEEDED` → observed independently, `class_hash` matches source `Scarb.toml` starknet 2.20.0 build
- Pool helper→Vesu leg (probe `0x050d928… @13945591`) → events observed via same public RPC; not full pool route

Full pool route predicates remain **not observed** until a real Wallet API transaction is submitted (requires funded wallet + prover), then independently read back with the missing calldata/Vesu/note/maturity evidence surfaces.

## Env

- `M5_RPC_URL`, `M5_RPC_URL_2` — public SN_SEPOLIA RPC URLs (independent readback; `M5_RPC_URL_2` required for X3)
- `STRK20_VALIDATOR_PATH` or `STRK20_VALIDATOR_URL` — upstream hub validator (actual `ok/pool/mine`, local reimplementation insufficient)
- `NEXT_PUBLIC_STARKNET_NETWORK=SN_SEPOLIA` — must match wallet chainId

## Verdict mapping

- No wallet/prover → `M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE` (closeout status `BLOCKED_BY_EXTERNAL_PRIVACY_PROVIDER`), no hash
- Runner green, no live pool tx → `M5_E2E_RUNNER_READY_X2`
- Live pool tx + receipt SUCCEEDED + pool event + raw helper calldata + typed Vesu Deposit + wallet open-note readback + maturity + conservation + independent RPC + validator `ok/pool/mine=true` → `M5_E2E_SUCCESS_X3`
- Any `mine=false`, stranded balance, or invented ABI → reopen M5 per closeout protocol stop criteria

## Exact blocker in the current environment

No WalletAccountV6/privacy prover session is attached, so wallet authorization,
SNIP-36 proof generation, pool deposit, open-note readback, and maturity cannot
be observed. The narrow real helper→Vesu probe is recorded separately and is
not a pool-invoked privacy proof. `strk20.json` remains unchanged.
