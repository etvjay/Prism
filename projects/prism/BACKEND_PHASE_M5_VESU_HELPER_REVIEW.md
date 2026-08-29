# BACKEND_PHASE_M5_VESU_HELPER_REVIEW

**Lane:** M5 Vesu-pinned helper hardening  
**Status:** Proposed for parent integration/deployment review  
**Evidence ceiling:** X2 local helper implementation; narrow helper→real-Vesu probe is recorded separately; no live privacy-pool execution claimed
**Verdict:** `M5_VESU_HELPER_READY_FOR_DEPLOYMENT_REVIEW`

## Scope

Added a separate `contracts/prism_vesu_lending_helper/` crate. The existing generic `prism_allocation_helper` was not modified and remains a regression baseline only.

The new helper preserves the canonical STRK20 pool-facing ABI:

```cairo
privacy_invoke(
    in_token: ContractAddress,
    out_token: ContractAddress,
    in_amount: u128,
    note_id: felt252,
) -> Span<OpenNoteDeposit>
```

The real token surfaces use `u256` throughout. Only the pool-facing input and `OpenNoteDeposit.amount` remain `u128`, with explicit checked conversion of the measured output.

## Hardening implemented

```text
constructor pins privacy_pool, underlying_token, v_token
caller must equal pinned privacy_pool
in_token must equal pinned underlying_token
out_token must equal pinned v_token
vToken deposit uses u256 assets
underlying approve uses u256
vToken balance_of uses u256
vToken approve uses u256
measured u256 delta must be nonzero
u256 → u128 conversion rejects nonzero high limb
output approval is scoped to pinned privacy_pool
no admin/setter/upgrade/arbitrary target/call selector
no viewing key, proof, or user state
```

The measured vToken share delta is the authoritative output. The vToken `deposit` return value is ignored. The open note is denominated in vToken shares, not underlying assets.

## Red-team issue resolved

The prior deployed generic helper used a u128 ERC-20 fixture interface. The real SN_SEPOLIA STRK and Vesu vToken contracts expose standard u256 ERC-20 methods. The previous helper therefore remained blocked before any real-token invocation.

The new helper fixes this without changing `privacy_invoke` calldata shape. Silent truncation is structurally rejected.

## Test evidence

Pinned helper clean run:

```text
cd contracts/prism_vesu_lending_helper
scarb clean
scarb build
snforge test

16 passed, 0 failed, 0 ignored
```

Covered:

```text
happy path with measured u256 delta
wrong caller
wrong input token
wrong output token
zero input
zero measured output
vToken revert rollback
missing input rollback
approval scope
foreign output pull
foreign underlying pull
stateless repeated invocation
constructor zero/equal-token guards
u256 high-limb overflow rejection
exact u128 maximum boundary
balance/conservation checks
```

Existing generic helper regression:

```text
cd contracts/prism_allocation_helper
scarb clean
scarb build
snforge test

11 passed, 0 failed, 0 ignored
```

The pinned test fixture has four expected `deprecated_legacy_map` warnings only; there are no unused-import or unused-variable warnings after cleanup.

## Foundry and AUDIT mapping

**Product Foundry:** M5 action is bounded to private STRK allocation into a Vesu STRK market. The helper is an adapter, not a wallet, claim authority, or general router.

**Research Foundry:** canonical helper ABI and Vesu `deposit(u256, receiver) -> u256` shape are sourced from the official Starknet Privacy/Vesu documentation and the deployed Vesu vToken readback. Privacy claim remains narrow: direct user linkage is the intended hidden relation; amount, timing, target application, and open-note amount remain public.

**System Foundry:** pending parent canonicalization for helper authority/state/error/invariant rows. The contract itself has no lifecycle storage; authority is the pinned privacy pool. Value invariant: underlying delivered to helper → vToken shares measured → exact share amount approved for pool/open-note credit.

**Antagonist:** H1 u128/u256 mismatch fixed; overflow, caller substitution, token substitution, zero-output, approval scope, rollback, and repeated invocation covered locally. Live pool atomicity, pool open-note acceptance, and upstream validator parity remain open.

**AUDIT:** T4/T5 are satisfied at X2 for the new crate; G6, T9, T11, T12 remain open until a real Wallet API/prover-backed SN_SEPOLIA transaction is independently verified.

## Remaining live gate

Do not mark M5 accepted from this packet. The parent still must:

```text
resolve a STRK20-capable wallet/proving path
register or use a funded privacy account
create/mature a STRK note
execute the exact private-DeFi action
verify pool event + helper calldata + Vesu deposit
verify vToken open-note/private-balance readback
verify conservation and no stranded helper balance
run the upstream validator, not a local reimplementation
```

If the official Wallet API/prover is unavailable, the E2E runner must return `M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE`; it must not substitute a mock proof.

The current M5 receipt port exposes only receipt events and optional public
ERC-20 balances. It does not prove raw helper calldata, a typed Vesu Deposit
receiver/assets observation, wallet open-note readback, or note maturity. The
runner therefore keeps those predicates false and remains X2 even when a
fixture receipt contains pool/vToken-address events. The exact current blocker
is `BLOCKED_BY_EXTERNAL_PRIVACY_PROVIDER`: no injected WalletAccountV6/
SNIP-36 prover or consented note-readback session is available.

## Relevant live configuration observed separately

```text
SN_SEPOLIA privacy pool:
0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91

Vesu Sepolia pool:
0x06227c13372b8c7b7f38ad1cfe05b5cf515b4e5c596dd05fe8437ab9747b2093

Vesu PoolFactory:
0x03ac869e64b1164aaee7f3fd251f86581eab8bfbbd2abdf1e49c773282d4a092

Vesu STRK vToken:
0x7152ae40c6bcbe7ff84b08a76527becb380bf7b2e782c0f5c8de9de049f8fff
```

These are configuration inputs for deployment review, not M5 completion evidence.
