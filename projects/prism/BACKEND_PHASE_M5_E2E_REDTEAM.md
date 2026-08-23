# BACKEND_PHASE_M5_E2E_REDTEAM

**Lane:** M5 E2E adversarial review (review-only)
**Base:** HEAD d1779b6, worktree `/home/ubuntu/prism-work/phase-m5-e2e-redteam`
**Model policy:** Hermes 0x Alpha only. No ChatGPT/Codex.
**Mode:** static/read-only checks + public RPC reads. No deployment, no broadcast, no secret access, no source modification, no strk20.json/frontend/Phase 8/Linear/Notion contact.

## Verdict

```text
M5_E2E_REDTEAM_BLOCKED
```

The composition is architecturally sound and the deployed helper class provably matches the repo source, but the helper's u128 ERC-20 fixture ABI is incompatible with the real SN_SEPOLIA token surface (u256 amounts). A live pool → helper → vToken route would fail at the first real-token call today. This is fixable in the helper without changing the canonical `privacy_invoke` shape.

---

## 0. Canonical inputs inspected

| Input | Status |
|---|---|
| `contracts/prism_allocation_helper/src/lib.cairo` | read in full |
| `contracts/prism_allocation_helper/tests/test_prism_helper.cairo` | read in full |
| `projects/prism/agent-packets/M5_CLOSEOUT_PROTOCOL.md` | read in full |
| `projects/prism/agent-packets/M5_CLAIM_HELPER_COMPOSITION_PROPOSAL.md` | read in full |
| `projects/prism/agent-packets/PRISM_PHASE_CONVERGENCE_CONTRACT.md` | read in full |
| `docs/STRK20_CONTEXT.md` | read in full |
| `projects/prism/AUDIT.md` (G6, FT-006, gates) | read |
| Live chain (read-only RPC, cartridge sepolia endpoint) | queried |

Live observations (all read-only, no secrets):

```text
Helper 0x0571c4d20e4623be0609d80fdf7f28add55c3dd2ddb9aa83cebdcbf7fdd2f969
  class_hash 0x046cda096c80c3f616a61db9789b7a37b81c0d10159a0f7af6853bdc0f6040af
  on-chain ABI == repo lib.cairo ABI exactly:
    privacy_invoke(in_token, out_token, in_amount: u128, note_id: felt252)
      -> Span<OpenNoteDeposit{note_id, token, amount}>
    empty event enum, no storage surface beyond default
Vesu Sepolia pool 0x06227c13…47b2093
  class 0x0317ce57b2de4a0c482f0eed58a635d100ac5b4801b38251607dcfa35a4128 (vesu::pool::Pool)
Vesu vToken 0x07152ae40c6bcbe7ff84b08a76527becb380bf7b2e782c0f5c8de9de049f8fff
  class 0x041b16e0ca0565a58d1379ffc3c7eab7459b382ba8f8208b3b87d18d2aed4f78
  implements vesu::v_token::IVToken (pool_contract, approve_pool) + full IERC4626 + OZ u256 ERC-20
```

The vToken is an **ERC-4626 vault**: `deposit(assets: u256, receiver: ContractAddress) -> u256`, pulling underlying from `get_caller_address()` via u256 `transfer_from`.

---

## 1. ABI and calldata compatibility audit (pool → helper → vToken deposit)

### 1a. Pool → helper: PROVEN COMPATIBLE

The deployed class hash resolves and its on-chain ABI is field-for-field identical to `lib.cairo`: same selector name `privacy_invoke`, same arg order/types `(ContractAddress, ContractAddress, u128, felt252)`, same return `Span<OpenNoteDeposit>` with member order `{note_id: felt252, token: ContractAddress, amount: u128}`. The canonical replicated shape claimed in the header comment is what is actually on-chain. Empty event enum confirms "no events" claim.

### 1b. Helper → vToken deposit: SHAPE MATCHES, AMOUNT WIDTH DOES NOT

`IExternalApp.deposit(u256 assets, ContractAddress receiver) -> u256` matches Vesu vToken `IERC4626::deposit` selector-name and arity exactly. Selector match is name-based on Starknet, so the call dispatches.

**BLOCKER H1 — u128 vs u256 ERC-20 surface.** The helper's `IERC20` fixture (`balance_of -> u128`, `approve(_, u128)`, `transfer_from(..., u128)`) is a u128-shaped replica of the starknet-privacy test fixture. The real tokens on this route (the STRK20 pool's withdrawn input token and the Vesu vToken share token) are standard Starknet ERC-20s returning/accepting **u256** (verified above: OZ u256 `balance_of/approve/transfer_from`). Consequences at execution time:

- `approve(spender, amount: u128)` serializes ONE felts where the real token expects TWO (u256 low/high). Calldata length mismatch → the real token either panics on deserialization or reads a garbage high limb. Either way the approve leg fails or mis-encodes.
- `balance_of(account) -> u128` deserializes only the FIRST felts of a two-felts u256 return. Even if it does not panic, it silently truncates: any vToken balance ≥ 2^128 (or a nonzero high limb) yields a wrong measured delta. Silent-wrong is worse than panic here because it feeds the authoritative measurement.
- `transfer_from` back to the pool (the pool-side pull) has the same width mismatch in reverse.

This is why the 11/11 local suite cannot see the problem: every mock token in `test_prism_helper.cairo` is deliberately u128-shaped ("matching the canonical IERC20Dispatcher usage"). Local green proves helper-vs-fixture logic, not helper-vs-real-token ABI. M5_CLOSEOUT_PROTOCOL already says test doubles alone are insufficient — this is the concrete instance.

### 1c. Route wiring: CORRECT DIRECTION

For the Vesu route the correct mapping is:

```text
in_token  = STRK (or whatever the pool withdraws; must equal vToken.asset())
out_token = vToken 0x07152ae4…f8fff   (both the app target AND the output/share token)
```

The helper approves `out_token` as spender of `in_token`, then calls `out_token.deposit(in_amount, receiver=self)`. Since the vToken is itself the puller (`msg.sender` of its internal `transfer_from` is the vToken), approving `out_token` and calling deposit ON `out_token` is internally consistent. Verified against the on-chain vToken interface: it exposes `approve_pool()` and standard u256 `transfer_from`, i.e., it pulls underlying from the direct caller — the helper. Direction is right.

Missing safety: the helper never asserts `vToken.asset() == in_token`. A mismatched pair fails safely (pull reverts atomically) but a pre-deposit readback check would give a clean error instead of a mid-flight revert. Recommended, not blocking.

---

## 2. Token direction / decimals / amount and u128↔u256 hazards

```text
H1  u128 ERC-20 fixture vs real u256 tokens        BLOCKER (see 1b)
H2  OpenNoteDeposit.amount is u128                 guarded: delta.try_into().expect('OUT_OVERFLOW') — a u256-measured delta ≥2^128 reverts atomically. Correct once measurement itself is fixed.
H3  Share rounding                                 vToken deposit mints preview_deposit(assets) rounded DOWN. Tiny in_amount can mint 0 shares → ZERO_OUT_AMOUNT revert (atomic, safe, but means minimum viable amount exists; must be documented, not discovered in production).
H4  Decimals                                       STRK is 18-decimals; vToken shares also 18. No decimal conversion exists anywhere in the helper — none is needed for this route, and none is performed. Note: note.amount is denominated in SHARES, not assets. The open note credits share units; conversion back to asset units requires convert_to_assets at read time. Must be stated in M5.1 spec so the pool/open-note accounting knows what unit the note carries.
H5  Fee-on-transfer/rebasing input                 If in_token taxed transfers, approve+pull of full in_amount would exceed received amount → atomic revert. Safe-by-revert; document as unsupported token class.
```

---

## 3. Authorization, caller scope, approvals, deltas, rollback, reentrancy

Verified in source (and the deployed class is byte-identical in ABI; logic identical per source):

- **Authorization model:** fully permissionless/stateless. Anyone may call `privacy_invoke` directly. Attack economics: a hostile caller must supply their own `in_amount` and chooses their own `in/out_token`; the measured-delta design means they can only damage themselves. No privileged path, no admin, no storage. Consistent with the reference authority statement in M5.1.
- **Caller scope of output approval:** `out_erc20.approve(pool_addr, delta)` where `pool_addr = get_caller_address()`. Scoped to the exact invoker, exact amount, single use in the normal flow (pool pulls exactly delta). Negative side tested (`foreign_principal_cannot_pull_output`). Correct.
- **Approval residue:** two residues possible. (a) If the app consumes LESS than approved (fee-on-transfer input), leftover allowance to `out_token` persists until next invocation overwrites it — bounded by `in_amount` of that invocation, harmless given permissionless overwrite semantics. (b) If the calling pool pulls less than delta, leftover allowance to the previous caller persists until the NEXT privacy_invoke overwrites it to the new caller's amount — note the stale approval is overwritten only when a new invocation happens; between invocations a prior caller retains pull rights on stranded output. Given the pool is trusted-first-party, acceptable; record in M5.1 "approval direction/residue" line.
- **Output delta authority:** bookends around the action, return value ignored. Correct pattern. Subtle point: any output tokens ALREADY stranded on the helper inflate the measured delta, and the excess comes out of stranded inventory — conservation versus the pool still holds (helper pays from its own balance). Dust-stranding is therefore self-healing across invocations rather than exploitable.
- **Zero-output guard:** `ZERO_OUT_AMOUNT` assert blocks crediting an empty open note (tested against NullApp). Combined with H3 rounding this is the correct behavior for dust deposits.
- **Rollback/atomicity:** all failure paths (missing input delivery, app revert, zero delta, overflow) revert inside `privacy_invoke`; under the supported pool route the whole pool operation rolls back (per STRK20_CONTEXT §privacy_invoke atomicity claim — still needs live confirmation, see §4). FT-006 tests cover the two principal cases locally.
- **Reentrancy:** no storage, no state; the external calls occur strictly after `balance_before` and before `balance_after`. A malicious `out_token` could reenter `privacy_invoke`, but nested invocation operates on fresh bookends and can only move the attacker's own funds; no cross-invocation state to corrupt. Sound for this trust model.
- **Token equality/zeros:** asserted up front with reference-style error codes. Matches catalogue style.

---

## 4. Proving / maturity / registration / fee / screening dependencies

From STRK20_CONTEXT + AUDIT, mapped onto the E2E run plan:

```text
Registration     sender wallet must be registered (viewing key set) before holding/receiving private balances; recipient likewise for open-note receipt.
Maturity         freshly created/opened notes need ~10 blocks before spending; the credited allocation note cannot be spent immediately. Evidence readback must account for maturing state.
Fees             pool fee MUST be read live (get_fee_amount equivalent) before choosing in_amount; do not hard-code. Fee reduces net input actually delivered to the helper — the helper's measured-delta design tolerates this (delta is what the app produced), but amount planning must not assume 1:1 pass-through of the user-facing amount.
Proving          proof generation stays wallet-side; helper lane never touches viewing keys or proving inputs.
Screening        deposit screening is protocol-enforced; a screened/blocked deposit is a distinct operational state and must be recorded distinctly from unavailability. Self-hosting a prover does not bypass it.
Validator        hub rule: tx exists, execution_status==SUCCEEDED, contains a pool event; once Prism contracts declared, additionally requires a declared Prism address in calldata or as event origin. A privacy_invoke through the helper satisfies the own-contract clause via helper address appearing in the pool's invoke calldata — VERIFY this on the actual receipt, not by assumption.
Atomicity claim  "helper revert rolls back whole pool op" is asserted by docs but NOT yet observed live on SN_SEPOLIA — this is precisely what M5.3 exists to prove.
```

---

## 5. Evidence predicates for success (M5.3/M5.4 envelope)

A qualifying live allocation must satisfy ALL of:

```text
P1  Deployment receipt: helper address + class hash 0x046cda09…6040af + deploy tx SUCCEEDED.
P2  Pool tx hash exists on SN_SEPOLIA with execution_status == SUCCEEDED (not just accepted).
P3  Tx trace/events contain a STRK20-pool-emitted event for the action (e.g., the pool's anonymized-invoke/note events).
P4  Own-contract involvement: helper 0x0571c4d2…2f969 appears in the pool tx calldata (as the INVOKE_SELECTOR target) — independently re-derived from raw calldata, BigInt-compared numerically per address-normalization rule.
P5  Application leg observable: Vesu vToken Deposit event (or ModifyPosition on the pool) inside the SAME tx, with receiver == helper address and assets == in_amount.
P6  Private/open-note readback: through the wallet API (never the dapp), the credited open note exists with note_id, token == vToken, amount == measured delta (SHARES units), visible only to the owner's viewing key; independent second read after ~10-block maturity window.
P7  Conservation: in_amount delivered to helper == vToken assets-in; note.amount == helper's measured vToken delta; helper end-state balances == 0 for both in_token and out_token (no strand).
P8  Independent read: all of P2–P7 re-read via a second RPC/explorer path; envelope stays X2 otherwise.
P9  Validator parity: run the ACTUAL upstream validator (ok/pool/mine) on the hash — a local ok/pool/mine reimplementation is explicitly insufficient per closeout protocol.
```

Negative predicates (must also be demonstrated or fixture-proven): app-target revert rollback, insufficient input rollback, zero-output revert, wrong-caller rejection, replayed invocation idempotence.

---

## 6. Kill criteria and smallest falsification test

Kill criteria (any one reopens/kills M5-helper-route):

```text
K1  Real-token calldata mismatch (H1) cannot be fixed without changing the canonical privacy_invoke shape.
K2  Pool refuses to credit a Span<OpenNoteDeposit> whose token is a non-input share token (i.e., pool enforces out_token ∈ supported set excluding vTokens).
K3  Helper revert does NOT roll back the pool operation live (atomicity assumption false).
K4  Upstream validator returns mine=false for the helper-involving tx after contracts declared.
K5  Funds strand on any observed failure path.
K6  Privacy claims drift beyond "direct user linkage hidden; amount/timing/target public."
K7  vToken share-denominated open notes cannot be reconciled by pool accounting (unit mismatch at credit time).
```

**Smallest falsification test (static, cheap, decisive for H1):**

Do NOT burn a pool transaction first. Instead, from any funded testnet account, execute a single direct invoke against the DEPLOYED helper replicating the pool's exact call:

```text
privacy_invoke(
  in_token  = <actual STRK sepolia address the pool withdraws>,
  out_token = 0x07152ae40c6bcbe7ff84b08a76527becb380bf7b2e782c0f5c8de9de049f8fff,
  in_amount = small (≥ dust floor so shares ≠ 0),
  note_id   = test value
)
```

after transferring that in_amount of STRK to the helper. Expected if H1 is real (it is, per ABI comparison): the tx REVERTS at the helper's `approve`/`balance_of` against the u256 token — proving the blocker with one cheap tx and zero pool involvement. Expected after the fix: SUCCESS with note.amount == measured share delta, verifiable via vToken `convert_to_assets` round-trip. This single test falsifies or clears the entire compatibility question before any pool integration spend.

---

## 7. Foundry and AUDIT mappings

**AUDIT.md**
- G6 (Prism-owned private application action): NOT_IMPLEMENTED remains correct. Helper deployed but unusable against the real target until H1 is fixed; even then G6 closes only on live pool evidence (P1–P9).
- FT-006 (Helper atomicity): locally covered (two rollback tests); live confirmation pending — correctly left open.
- FT-007 (Privacy copy): current copy in lib.cairo header is accurate and bounded ("does NOT hide amount, timing, target application, or open-note amount") — conforms; keep this wording in any UI.
- FT-008 / §11 own-contract strategy: helper-in-calldata should satisfy mine=true post-declaration; verify on real receipt (P4/P9), do not assume.

**System Foundry** (`projects/prism/system/`)
- Authority matrix / state machine / error & event catalogues contain NO helper entry yet (grep: zero hits for privacy_invoke/helper in system/*). M5.1/M5.5 gate requires these rows before acceptance: helper actor (permissionless adapter), error codes ZERO_IN_TOKEN…OUT_OVERFLOW into ERROR_CATALOGUE, no-event fact into EVENT_CATALOGUE, and a value-conservation invariant row (in_amount → shares delta → note.amount). Currently a documentation gap, not a code defect.

**Research Foundry**
- Source freshness: docs cite commit 66e3caae of starknet-privacy; the canonical ABI replication is confirmed consistent with starter-kit guidance ("the privacy_invoke shape stays the same"). STRK20_CONTEXT pins require re-verification each phase — noted, not drifted today.
- Claim bounds: helper hides direct user linkage only. Confirmed accurate against mechanism. No overclaim found.

**Product Foundry**
- Open per closeout protocol: the helper currently targets a generic ERC-4626 deposit; M5.0 decision DEC-PRISM-M5-001 naming "allocate into Vesu STRK market" as the selected Prism Home action must exist before implementation lane resumes. Not yet present in DECISIONS.md scope inspected.

## Claim classification

```text
PROVEN (observed, read-only):
  - Deployed helper class exists at 0x0571c4d2…2f969, class 0x046cda09…6040af,
    ABI identical to repo source incl. OpenNoteDeposit layout.
  - Vesu Sepolia pool and vToken exist with the interfaces shown; vToken is
    u256 ERC-4626 with deposit(assets, receiver)->shares.
  - Local 11-test suite covers the adversarial matrix listed in M5.2 against
    the u128 fixture world.

PLAUSIBLE (consistent, unproven):
  - Pool → helper atomic rollback under the real route (docs assert; unobserved).
  - Helper-in-calldata satisfying hub validator mine=true post-declaration.
  - Pool accepting a share-token (vToken) as open-note credit token.

BLOCKED:
  - Any live E2E run today: H1 u128/u256 mismatch makes the first real-token
    call fail. Fix helper token surface to u256 (balance_of/approve/
    transfer_from), keep privacy_invoke signature untouched, extend mocks with
    a u256 token, rerun snforge, then run the falsification test in §6.
```

No implementation was performed and no live evidence is claimed beyond the read-only RPC observations listed in §0.
