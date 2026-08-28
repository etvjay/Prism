# Base escrow implementation packet

**Status:** `IMPLEMENTED_LOCAL_NOT_DEPLOYED`
**Target:** Base Sepolia (`chainId 84532`) only. No deployment, funding, signing,
broadcast, provider call, mainnet action, or secret handling is authorized by this
packet.

## Accepted v1 contract decisions

- `EthEscrow` and `ERC20Escrow` are separate immutable contracts. ERC-20 token
  address is immutable per deployment; ETH asset is `address(0)`.
- Terms creation and funding are separate. The payer signs a typed funding approval;
  a relayer may submit it. ETH requires exact `msg.value`; ERC-20 requires payer
  allowance and exact `transferFrom` amount.
- Claim is public execution authorized by the recipient's EIP-712 signature. The
  recipient signer is the payout recipient. Commitment is consumed once globally.
- EIP-712 domain: name `Prism Base Escrow`, version `1`, chain ID, verifying
  contract. FundingApproval binds claimId, payer, refundDestination, asset, amount,
  expiry, commitment, nonce, action. ClaimAuthorization additionally binds recipient.
  Actions are `keccak256("FUND")` and `keccak256("CLAIM")`.
- Lifecycle: `Unfunded -> Funded -> Claimed|Refunded`. Claim is strictly before
  expiry (`timestamp < expiry`); refund is at/after expiry (`timestamp >= expiry`)
  and only the immutable refund destination may call it.
- No admin, upgrade, arbitrary call, beneficiary override, or backend-only terminal
  transition exists. State is committed before external payout and all mutations are
  protected by a reentrancy guard. Duplicate IDs/actions and signature/commitment
  replays revert.
- ERC-20 false-return/revert and fee-on-transfer/rebasing behavior are rejected;
  funding and payout balance deltas must equal the requested amount.

## Implementation and tests

- `foundry/escrow/src/BaseEscrow.sol` — self-contained core, ETH variant, and
  immutable-token ERC-20 variant; canonical events and reconciliation reads.
- `foundry/escrow/test/BaseEscrow.t.sol` — local EIP-712 signing and tests for happy
  paths, wrong signatures/terms, replay, boundary/race behavior, refund authority,
  ETH accounting, exact ERC-20 funding, and fee-on-transfer rejection.

## Evidence ceiling and remaining gates

Local source/build/tests establish implementation evidence only. This package is not
audited, deployed, funded, signed, broadcast, or observed on Base Sepolia.
Remaining gates are independent security review; ABI/backend-port review; authorized
Base Sepolia deployment with bytecode/receipt readback; independent provider
reconciliation; and backend integration tests. Existing local payment/gift routes and
`PublicBaseSepoliaEscrowPort` remain the backend boundary; this lane adds no signer,
provider, or live adapter.
