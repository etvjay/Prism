# Base escrow lifecycle assessment

**Status:** `BLOCKED_BY_OWNER_SPECIFICATION`
**Scope:** local Base Sepolia (`chainId 84532`) escrow/payment lifecycle only
**Assessment target:** `prism-v0-backend` at `9b4d3877219fab1d16ff0bb6b92a2a065dc6a9e3`

## Decision

No Base escrow adapter or EVM contract is implemented in this lane. Foundry 1.7.1
is now available locally, but the repository
has no reviewed escrow contract, exact deployed Base address, or escrow ABI that
could make a real `create → fund → claim / expire → refund` lifecycle safe to
implement. Adding Solidity, guessed calldata,
an address, a deployment, or a signing/broadcast path would invent contract
truth and violate the payment boundary.

The existing payment and claim code remains a local X2 boundary:

- `src/features/prism-payments/domain/payment-request.ts` owns explicit payer
  approval, terms binding, expiry/cancellation, receipt matching, and the
  `submitted`/`processing`/`confirmed` distinction.
- `src/features/prism-payments/domain/claimable-gift.ts` owns immutable sender
  refund destination, expiry, recipient binding, claim receipt checks, and
  terminal claim/refund states.
- `src/features/prism-payments/application/claimable-gift-service.ts` reserves
  nullifiers before claim submission and uses only the narrow
  `PublicBaseSepoliaEscrowPort`.
- `src/features/prism-payments/application/http-runtime.ts` injects an
  unavailable escrow implementation. Missing durable runtime dependencies fail
  closed as `ERR-062`; missing claim verification fails as `ERR-063`.
- `projects/prism/PRISM_V0_PAYMENT_CLAIM_BACKEND.md` is consistent with this
  status and explicitly says no escrow, signing, funding, broadcast, or live
  receipt is implied.

## Exact inspection evidence

- `package.json` pins `viem 2.55.19`, but viem is used for existing identity,
  session-permission, and channel utilities. No escrow ABI/address or escrow
  client is present.
- `contracts/` contains only Cairo/Scarb crates for identity registry,
  allocation, and Vesu lending helper. `foundry/` contains documentation only.
- `command -v scarb` and `command -v snforge` resolve to installed Starknet
  tooling. `forge --version` resolves to Foundry 1.7.1. Tool availability does not
  resolve the absent reviewed ABI/specification.
- `git ls-files` contains no `.sol`, `foundry.toml`, or `hardhat.config.*`.
- `ops/target-network/manifest.yaml` defines Base Sepolia `84532` as the
  accepted testnet venue, but contains no escrow contract address or ABI.
- `src/features/prism-payments/domain/ports.ts` defines the reviewed narrow
  port shape, but no production implementation exists. The only runtime
  implementation is the fail-closed `unavailable` port in `http-runtime.ts`.
- Existing ERC-7715/7710 code in
  `src/features/prism-authority/adapters/base-sepolia-erc7715.ts` is a wallet
  permission boundary. Its `redeemDelegations` ABI is not an escrow ABI and it
  has no escrow target address, so it cannot be reused as one.
- `strk20.json` was not modified and remains outside this lane. No RPC, wallet,
  private key, deployment, funding, signing, or broadcast was performed.

## Local verification

| Check | Result |
|---|---|
| Payment/claim focused Vitest | **42 passed**, 0 failed, 6 files |
| Full Vitest suite (`npm test`) | **1283 passed**, **38 skipped**, 0 failed, 130 files |
| TypeScript (`npm run typecheck`) | **PASS** |
| Next build (`npm run build`) | **PASS**, routes generated successfully |
| Cairo identity V2 (`scarb build && snforge test`) | **40 passed**, 0 failed |
| Cairo Vesu helper (`scarb build && snforge test`) | **16 passed**, 0 failed |

The first attempted test command included unsupported Vitest option
`--runInBand`; it failed in argument parsing, not in product tests. The
canonical `npm test` command above passed.

## Exact unblock inputs

A future implementation may start only after all of these are supplied and
reviewed:

1. An immutable or explicitly governed escrow contract specification covering
   sender, asset, amount, expiry, nullifier/claim identity, claim recipient,
   and sender-only refund authority.
2. The exact deployed Base Sepolia contract address, with chain ID `84532`.
3. The exact ABI, including event shapes and read methods needed to independently
   observe funding, claim, expiry, and refund receipts.
4. A supported, pinned EVM toolchain and provider/client boundary, plus a
   reviewed signer or wallet authority path. This lane must not create or hold
   signing authority.
5. Tests against the reviewed ABI/address that preserve the existing approval,
   receipt, expiry, nullifier, redaction, and no-live-claim invariants.

Until then, the correct state is `BLOCKED_BY_OWNER_SPECIFICATION`, not a partial
or simulated escrow implementation.
