# Lane B / Lane C / STRK20-M5 boundary update

**Base:** `4eee0be88fc95db2efc44d146f344c9c2ee5fdc3`  
**Scope:** local, testnet-ready boundaries only. No signing, funding, broadcast, deployment, frontend, mainnet, or secrets.

## Lane B — Base Sepolia ERC-4337 + ERC-7715/7710

### Implemented locally

- `src/features/prism-authority/domain/erc4337-user-operation.ts` defines the exact packed ERC-4337 EntryPoint v0.7 UserOperation shape used by viem's `PackedUserOperation`:
  `sender`, `nonce`, `initCode`, `callData`, `accountGasLimits`, `preVerificationGas`, `gasFees`, `paymasterAndData`, and `signature`.
- The structural validator enforces EVM address format, non-negative bigint gas/nonce fields, hex fields, and 32-byte packed `accountGasLimits`/`gasFees`.
- `ERC4337_V07_READBACK_REQUIREMENTS` records the minimum independent observation set: user-operation hash, EntryPoint, sender, nonce, receipt transaction hash, receipt block number, and receipt success.
- Added focused tests proving v0.7 packed shape acceptance and rejection of v0.6-style unpacked gas fields/malformed packed fields.
- Exported the boundary through `src/features/prism-authority/domain/index.ts`.

### Existing ERC-7715/7710 enforcement verified

The existing adapter already fails closed unless the injected module explicitly attests all Prism constraints: target, selector, asset, per-call spend, aggregate spend, call count, expiry, revocation, replay, chain ID, and account binding. It validates capability readback, request/response count, chain/account/expiry binding, module permission/rule vocabulary, opaque context, and `redeemDelegations` calldata before account encoding.

The current bundler port intentionally accepts only `{sender, callData, chainId}` and returns only a user-operation hash. It is **not** a full live ERC-4337 submission/readback adapter; no signature, gas packing, EntryPoint address/version, bundler RPC, receipt, execution, or inclusion evidence is present. The new type/validator does not fabricate those missing facts.

## Lane C — Base Sepolia ↔ Starknet Sepolia

**Decision: `BLOCKED_BY_EXTERNAL_PROVIDER` — no local adapter added.**

The inspected first-party StarkWare `privacy-bridge` repository (`@starkware-libs/starknet-privacy-bridge` 0.1.22) describes EVM-wallet/chain ↔ Starknet privacy-pool flows over Circle CCTP, with `OutboundAnonymizer`/`InboundAnonymizer`; its documented concrete configuration/examples are Polygon-oriented. The repository does not expose a verified Base Sepolia ↔ Starknet Sepolia route, quote API, status API, or idempotency contract that this backend can safely call. Base's official ecosystem bridge documentation lists Base↔Ethereum/Superchain providers, not a Starknet Sepolia route.

Accordingly, no quote/status/idempotency/failure adapter was invented. A future Lane C implementation requires a provider that supplies, at minimum, explicit source/destination chain IDs, supported asset and route, quote expiry, request idempotency semantics, operation/status lookup, terminal failure taxonomy, and independently readable source/destination receipts. The existing payment/claim boundary remains fail-closed and is not a bridge.

## STRK20 / M5

The pinned local first-party interfaces were inspected directly:

- `starknet` 10.4.0 `WalletAccountV6`: `strk20PrepareInvoke(actions, simulate?)`, `strk20InvokeTransaction(actions)`, and `executeWithProof(calls, proof?)`.
- `@starknet-io/types-js` 0.10.3: `wallet_strk20PrepareInvoke` returns `STRK20_CALL_AND_PROOF`; simulation returns an empty proof and is explicitly non-submittable; `wallet_strk20InvokeTransaction` returns a transaction hash.
- The local adapter correctly rejects empty proofs for submission, rejects malformed call/proof shapes, never accepts viewing-key material, feature-detects via supported wallet API/spec queries, preserves registration unknown (`null`) when no proven read exists, and maps receipts/provider failures without leaking raw details.

No real WalletAccountV6/privacy-wallet session, SNIP-36 prover, pool action, open-note readback, maturity observation, or independent second RPC source is attached. M5 remains `M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE` / `BLOCKED_BY_EXTERNAL_PRIVACY_PROVIDER`; no status was promoted.

## Verification

- `npm test -- --run src/features/prism-authority/__tests__/erc4337-user-operation.test.ts src/features/prism-authority/__tests__/base-sepolia-erc7715.test.ts`: **20 passed, 0 failed**.
- `git diff --check`: **pass**.
- `npm run typecheck`: **blocked by pre-existing stale `.next/types` include errors** (missing generated route declaration files); no source diagnostic from the new boundary was reported after the focused tests passed.
- STRK20/M5 focused tests remain local fixtures/doubles only; no live evidence was generated.

This document records local implementation facts only; it is not live network evidence.
