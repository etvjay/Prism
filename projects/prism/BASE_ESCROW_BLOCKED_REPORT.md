# Base escrow lifecycle assessment

**Status:** `LOCAL_IMPLEMENTATION_COMPLETE_NOT_DEPLOYED`
**Scope:** local Base Sepolia (`chainId 84532`) escrow lifecycle only.

Owner decisions are now accepted for a local v1 package. This report remains a
blocked deployment report: no address, bytecode receipt, signer, funding, RPC
readback, or mainnet evidence exists.

## Accepted v1 decisions

- Separate immutable `EthEscrow` and `ERC20Escrow` contracts; the ERC-20 token
  address is immutable per deployment and native ETH is represented by `address(0)`.
- Create terms and fund are separate operations. The payer signs an EIP-712
  `FundingApproval`; any relayer may submit it. For ERC-20 funding, the payer
  must have approved the escrow contract and `transferFrom` moves the exact amount.
  ETH funding requires exact `msg.value`.
- Claim is public execution authorized by the recipient's EIP-712
  `ClaimAuthorization`; the recipient is the signature signer and payout target.
- Domain is `Prism Base Escrow`, version `1`, with `chainId` and verifying contract.
  Fund and claim typed hashes bind claimId, payer, refund destination, asset,
  amount, expiry, commitment, recipient (claim), nonce, and action.
- Lifecycle is `Unfunded -> Funded -> Claimed|Refunded`; claim requires
  `block.timestamp < expiry`, refund requires `block.timestamp >= expiry` and
  caller equal to the immutable refund destination.
- No admin, upgrade, arbitrary call, beneficiary override, or backend terminal
  transition exists. State is marked before external payout; a reentrancy guard
  protects all state-changing paths.
- Zero values/addresses are rejected; duplicate IDs, terminal actions, consumed
  commitments, and consumed funding digests are rejected. ERC-20 funding and
  payout require exact balance deltas, rejecting fee-on-transfer/rebasing behavior,
  false returns, and reverted transfers.

## Local package

`foundry/escrow/src/BaseEscrow.sol` contains the self-contained implementation and
`foundry/escrow/test/BaseEscrow.t.sol` contains local signing, lifecycle, replay,
boundary, refund-authority, ETH accounting, and ERC-20 exactness/fee tests.

## Remaining gates

1. Independent security review of cryptographic encoding, signature handling,
   token edge cases, and gas/error behavior; this package is not audited.
2. Review and pin compiler/toolchain and ABI against the backend's
   `PublicBaseSepoliaEscrowPort`; no adapter was added in this lane.
3. Deploy separately with an authorized signer, record chain/address/bytecode and
   receipts, and independently read back state/events on Base Sepolia.
4. Add provider/reconciliation evidence and backend integration tests before any
   production use. No deployment, signing, funding, broadcast, or live evidence
   is claimed here.
