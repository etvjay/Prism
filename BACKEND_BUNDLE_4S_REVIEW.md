# BACKEND_BUNDLE_4S_REVIEW — prism_allocation_helper (canonical ABI correction)

**Verdict: IMPLEMENTABLE_WITH_TESTS**

## Scope

Bundle 4S-Retry in isolated worktree `agent/backend-bundle-4s-retry`. The
previous run left an untracked `contracts/prism_allocation_helper/` crate whose
suite was red (6 passed / 7 failed, mostly ENTRYPOINT_NOT_FOUND) and whose
entrypoint deviated from canon. This bundle corrected it.

## Canonical reference (first-party)

- starknet-privacy @ `66e3caae`
  - `packages/privacy/src/test_contracts/mock_swap_executor.cairo`
  - `packages/privacy/src/objects.cairo`

Canonical ABI implemented exactly:

```cairo
fn privacy_invoke(
  ref self: T,
  in_token: ContractAddress,
  out_token: ContractAddress,
  in_amount: u128,
  note_id: felt252,
) -> Span<OpenNoteDeposit>;
```

`OpenNoteDeposit { note_id: felt252, token: ContractAddress, amount: u128 }`
(field order canonical). The helper uses `IERC20Dispatcher`, measures the
output **balance delta** as authoritative, approves `get_caller_address()`
(the privacy pool), and returns the span. It is the canonical swap /
external-action executor shape.

## What was removed from the previous attempt (overclaim cleanup)

- `AllocationOperation` enum (Allocate/Unwind) — invented; not in canon. Deleted.
- `u256` entrypoint parameter (`assets`) — replaced with canonical `in_amount: u128`.
- Unwind direction / ERC-20 transfer entrypoints to users — out of canonical
  scope; deleted.
- `debug_mocks_alone` debug test — deleted (its useful coverage now lives in
  real regression tests).
- Dual custom token/vault trait sets with mismatched selectors (root cause of
  ENTRYPOINT_NOT_FOUND) — replaced with one shared `IERC20` interface used by
  both the contract dispatchers and every mock implementation, so selector
  sets match exactly by construction. Suite re-run from a clean `target/`.

The smallest meaningful Prism action is preserved: the external application
target may be a vault/router (`IExternalApp::deposit`); the entrypoint name,
parameter list, and return shape remain exactly canonical.

## Fixture labeling

`OpenNoteDeposit`, `IERC20`, `IExternalApp`, and all test mocks are labeled
**X2 TEST FIXTURE** in source comments. The production contract contains no
storage, no events, no constructor logic beyond the empty layout.

## Adversarial coverage (11 tests, all green)

| Requirement | Test |
|---|---|
| success measured delta | `allocate_success_credits_open_note_with_measured_delta` |
| zero in/out token | `zero_in_token_reverts`, `zero_out_token_reverts` |
| zero amount | `zero_amount_reverts` |
| equal tokens | `equal_tokens_revert` |
| insufficient balance rollback | `insufficient_balance_rolls_back_whole_operation` |
| action failure rollback (FT-006) | `failing_action_aborts_whole_operation_ft006` |
| caller-only approval boundary | `only_calling_pool_can_pull_output_authorization_boundary`, `foreign_principal_cannot_pull_output` |
| stateless repeated invocation | `repeated_invocations_are_stateless_replay_safety` |
| nonzero note amount/token | covered by success tests (amount == delta, token == out_token asserted against deployed addresses) |
| no storage/events/privacy overclaim | structural: empty `Storage{}`, zero `#[event]`, no emit sites; statelessness asserted at runtime |

## Authority limits

Permissionless + stateless, mirroring the reference: the helper trusts only
measured balance deltas and approves whoever called it. No admin key, no fee
logic, no proxy. A malicious "application target" cannot steal more than the
exact approved input allowance; output approval is scoped to the exact
measured delta for the calling pool only.

## Privacy limits (explicit)

This helper hides ONLY the direct user identity behind the allocation action.
It does NOT hide: amounts, timing, the target application address, or the
open-note amount (open notes are public by design). No viewing keys, no note
ownership reads, no nullifier semantics. Any claim of amount/timing privacy
for this component would be an overclaim and none is made here.

## Verification evidence (run locally in this worktree)

```
$ scarb build      → Finished `dev` profile target(s)
$ snforge test     → Tests: 11 passed, 0 failed, 0 ignored, 0 filtered out
```

Run from a clean `target/` after the selector-matching fix. No unverified
dependency or ABI was required to reach green; therefore the verdict is not
BLOCKED_BY_INTERFACE_EVIDENCE.

## Not touched

Prism identity contracts, frontend, ops files, strk20.json, deployment config,
Linear, Notion, credentials, GitHub.
