# M5 Local Vesu Integration / Recovery Boundary

**Base:** `aae06b864e431e65e5e03d87f4d863080f69f0fe`
**Route:** `PrismVesuLendingHelper` · `SN_SEPOLIA` · STRK → Vesu STRK vToken shares
**Scope:** local validation, wallet/API ports, receipt/RPC read contracts, operation/recovery, and adversarial tests only

## Verdict

```text
M5_LOCAL_BOUNDARY_READY_X2
BLOCKED_BY_EXTERNAL_PRIVACY_PROVIDER
```

The local boundary is implemented and tested as a controlled X2 surface. No
live privacy-pool transaction, wallet proof, open-note readback, or privacy
maturity observation was performed or claimed.

## First-party interfaces used

The implementation is limited to interfaces proven in the pinned repository
and installed packages:

- `contracts/prism_vesu_lending_helper/src/lib.cairo` —
  `privacy_invoke(in_token, out_token, in_amount:u128, note_id)` and
  `OpenNoteDeposit { note_id, token, amount:u128 }`.
- `@starknet-io/types-js` `0.10.3` — exact `STRK20_ACTION` union,
  `STRK20_CALL_AND_PROOF`, `OPEN` amount, and `${openNoteIds[0]}` placeholder.
- `starknet` `10.4.0` / `WalletAccountV6` —
  `strk20PrepareInvoke`, `strk20InvokeTransaction`, `executeWithProof`, and
  read-only provider transaction/receipt shapes.
- Starknet JSON-RPC — `starknet_getTransactionReceipt`,
  `starknet_getTransactionByHash`, `starknet_call`, and
  `starknet_blockNumber` request/response shapes.
- Existing STRK20 domain receipt rules — pool-event origin is the attribution
  source; transaction sender is retained only as ignored metadata.

No Vesu event decoder was invented. A typed Vesu observation is an optional
injected port and is accepted only when it explicitly supplies
`contractAddress`, `receiver`, `assets`, and (optionally) `shares`.

## Local contracts closed

- **Address/config validation:** nonzero configured addresses, Starknet field
  address range `<2^251`, distinct STRK/vToken, SN_SEPOLIA-only route, valid
  amount bounds, and nonnegative finite polling settings.
- **Exact actions/calldata:** exactly `[transfer OPEN to self, invoke helper]`;
  helper calldata is exactly `[STRK, VTOKEN, amount:u128, "${openNoteIds[0]}"]`.
  Wallet-owned placeholder resolution is not simulated by Prism.
- **Receipt validation:** strict hash/block/event/felt shape validation;
  unknown provider labels stay `UNKNOWN`; malformed facts fail closed. Privacy
  confirmation also requires concrete pool-event evidence; a detached
  `poolEventFound` flag or event-less receipt cannot confirm an action.
- **Pool-event attribution:** only a successful event whose origin numerically
  matches the pinned privacy pool is attributed to the route. `sender` is never
  used as user identity. The M5 route-specific depositor key layout remains
  unclaimed unless an external proven decoder supplies it.
- **Operation/recovery:** the external wallet call is fenced before it starts;
  an ambiguous provider failure cannot reopen the proof or rebroadcast, and a
  later run on the same local runner polls the recorded hash only. `RECEIVED`,
  `PENDING`, and `UNKNOWN` remain poll states; timeout becomes
  `requires_attention`; no hash is invented. Success requires accepted
  finality, a block, and a concrete event from the pinned pool.
- **Maturity state:** an explicit adapter observation is required for
  `maturing → privately_available`; its confirmation block must match the
  successful receipt. The runner does not derive maturity from a receipt block
  or treat the approximate ten-block research note as a protocol oracle.
- **Conservation:** explicit note/share observations must be positive and
  cross-linked to the Vesu observation and each other; zero or contradictory
  values remain X2.
- **Independent reads:** the public RPC reader now supports raw transaction
  calldata and strict u256 balance decoding. X3 independent-read promotion
  additionally requires an explicit distinct source identity; injected doubles
  remain X2.

## Evidence ceiling

| Predicate | Local status |
|---|---|
| helper ABI / u256 token surfaces | implemented and covered by the existing 16 Cairo fixture tests |
| exact Wallet API action shape | implemented and adversarially tested |
| receipt polling/recovery | implemented and adversarially tested |
| pool event origin attribution | implemented and adversarially tested |
| raw helper calldata read | implemented as optional Starknet transaction read contract; not observed live here |
| typed Vesu Deposit observation | optional typed port only; no decoder or live observation here |
| open-note token/amount readback | not available on pinned `WalletAccountV6` adapter; remains false |
| maturity observation | explicit port only; no live observation here |
| independent second RPC read | shape tested; no live second endpoint configured here |
| upstream `ok/pool/mine` validator | not run against a live M5 transaction |
| complete M5 X3 | **not proven** |

## Exact external blocker

No real `WalletAccountV6` + SNIP-36 prover/session is attached in this
execution environment. Consequently the following remain unobserved:

```text
wallet authorization and real proof generation
pool withdraw → helper invocation
pool open-note credit
Vesu Deposit receiver/assets readback
wallet-owned open-note readback
real maturity wait and consented balance observation
independent live receipt/readback
upstream validator ok/pool/mine=true
```

The required closeout result is therefore exactly:

```text
BLOCKED_BY_EXTERNAL_PRIVACY_PROVIDER
```

This document does not promote any evidence ledger row, deployment, receipt,
privacy claim, or `strk20.json` entry.

## Optional shadow-account observation

The supplied `shadow-accounts_overview.pdf` is incorporated only as a
provider-capability observation: a privacy-pool/anonymizer may create
disposable Starknet execution accounts for private DeFi actions such as Vesu or
Endur. The typed `observeShadowAccountCapability()` hook is optional and
metadata-only. It is not a STRK20 note, memo, claim, receipt, binding, or M5
route; it carries no account/key/proof/private-balance material and no
unlinkability claim. Its absence or failure cannot block the normal Wallet API
route, and it is not included in the X3 completion predicate.

## Verification commands

Focused local verification was run with the M5 Vitest files and the pinned
Cairo helper suite. The observed command output is recorded in the worker
closeout summary; all M5 local tests are X2 fixtures/doubles, not live
privacy evidence.

Forbidden scope was not used: no deploy, broadcast, key/viewing-key handling,
frontend edit, or `strk20.json` edit.
