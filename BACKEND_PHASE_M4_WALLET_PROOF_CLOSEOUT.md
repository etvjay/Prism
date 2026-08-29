# M4 Wallet / Proof Lane Closeout

**Baseline:** `040b011761065e080816cff1ee1d1d7f0b7a1c00`
**Scope:** local backend/runtime wallet action boundary, proof-shape validation, receipt-backed STRK20 flow transitions, and adversarial tests. No frontend, contract, deployment, broadcast, wallet secret, RPC credential, `strk20.json`, or remote mutation.

## Verdict

`BLOCKED_BY_EXTERNAL_WALLET`

The local M4 wallet/proof boundary is hardened and independently tested at **X2**. The lane cannot promote to X3 without a user-controlled Ready WalletAccountV6/provider session, a real STRK20 prover, funded SN_SEPOLIA execution, and independent receipt/readback evidence. No live wallet/proof/receipt result is claimed here.

## Authoritative interfaces checked

The pinned local packages were inspected rather than inferred:

- `@starknet-io/types-js` `0.10.3` wallet API declarations:
  - `wallet_supportedWalletApi` / `wallet_supportedSpecs` return version arrays;
  - `wallet_strk20PrepareInvoke({actions, simulate})` returns `STRK20_CALL_AND_PROOF`;
  - simulated proof is present but all three proof fields are empty;
  - prepared calls use `contract_address`, `entry_point`, and `calldata`;
  - `wallet_strk20InvokeTransaction({actions})` is the wallet-side proving/submission path;
  - `wallet_addInvokeTransaction({calls, proof})` is the prepared-call submission shape.
- pinned `starknet@10.4.0` `WalletAccountV6` declarations match the above, including `executeWithProof(calls, proof)`.
- Existing Base ownership proof code remains a separate authority path: `PrismChallengeService` uses the stored challenge, faithful-field check, single-use nonce, and EOA → EIP-1271 → ERC-6492 ladder. STRK20 SNIP-36 proof material is never conflated with the Base ownership signature.
- Existing Starknet operation reconciliation remains authoritative for generic chain operations: submission returns a hash only; the worker advances through RPC observation → indexed event → reconciliation before `completed`. The M4 action adapter does not manufacture a generic completed operation.

## Local changes

- Strict capability classification distinguishes `supported`, `unsupported`, and `unknown`; empty/malformed provider answers remain `STRK20-001 capability_unknown`, while a valid below-minimum version is `STRK20-021 unsupported_wallet`.
- Capability detection never probes private balances and validates provider response shapes before interpreting them.
- Action validation now covers the proven STRK20 action union, felt/address forms, and wallet-resolved calldata placeholders.
- Provider errors are mapped without echoing raw provider text; screening rejection is checked before generic user-refusal matching.
- `STRK20_CALL_AND_PROOF` and `executeWithProof` use the authoritative snake_case call fields. Prepared responses and proofs are shape-checked; malformed or simulated proofs cannot be submitted.
- Receipt normalization accepts Starknet camel/snake provider spellings, preserves `UNKNOWN`, canonicalizes valid short hashes, accepts `from_address` event fields, ignores reverted pool events, and rejects a returned hash that conflicts with the requested hash. It never rewrites a conflicting receipt identity.
- M4 flow confirmation is receipt-backed: `confirmed` and `transfer_confirmed` require a matching successful accepted receipt with a block and pool event. `RECEIVED`, `PENDING`, `UNKNOWN`, `REVERTED`, missing, mismatched, or event-less observations stay fail-closed and cannot become terminal state. `shielding`/`transfer_pending` remain submitted/pending states.
- Proof tracker transitions cannot reach `ready`, `submitting`, or `confirmed` without a validated non-empty proof.
- Privacy metadata traversal is cycle-safe; receipt builders do not treat reverted pool events as successful evidence.

## Verification

- Focused M4 wallet/proof/state suites: **8 files, 99 tests passed**
- Challenge/proof + Starknet ledger/reconciliation suites: **6 files, 51 tests passed**
- Full repository suite: **80 files passed, 1 skipped; 884 passed, 1 skipped**
- `npm run typecheck`: **PASS**
- `git diff --check`: **PASS** for the scoped lane

All tests use injected X2 doubles. No test output is live provider, prover, receipt, or network evidence.

## Exact external blockers

1. A user-controlled Ready wallet session must answer `supportedWalletApi`, `supportedSpecs`, and `requestChainId` on the intended network.
2. The wallet must be registered/funded and able to perform the two-step approval → shield flow; the pool fee and screening result must be read from the live protocol.
3. The wallet's SNIP-36 prover must produce a real non-empty proof or complete the wallet-side `strk20InvokeTransaction` path. Prism must not synthesize one.
4. A real shield/private-transfer transaction must be observed through the wallet/RPC and independently re-read by hash with execution status, finality, block, and pool event attribution.
5. The maturity wait must be observed on real block numbers (approximately ten blocks per current research, not a mainnet guarantee), followed by explicit wallet consent for private balance and a real private transfer.
6. Generic operation completion still requires the existing Starknet receipt/indexer/reconciliation path; a submitted hash or a single provider response is not completion.

Until those prerequisites are supplied by an authorized user wallet/session, the evidence ceiling is **X2 local controlled implementation**. No X3/X4/X5 promotion is justified.
