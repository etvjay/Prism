# Base escrow implementation packet

**Status:** `REMEDIATED_LOCAL_NOT_DEPLOYED`
**Target:** Base Sepolia (`chainId 84532`) only. No deployment, funding, signing,
broadcast, provider call, mainnet action, or secret handling is authorized by this
packet.

## Review findings and remediation

- **M-01 — ERC-20 funding accepted accidental ETH:** inherited payable `fund`
  remains ABI-compatible for both variants, but `ERC20Escrow._fund` now explicitly
  requires `msg.value == 0`. `EthEscrow` retains exact `msg.value == amount` funding.
- **M-02 — ERC-20 payout could underpay recipient:** `ERC20Escrow._payout` now
  snapshots both escrow and recipient balances and requires exact requested deltas
  for both. A failed transfer or mismatch reverts atomically; terminal state and
  commitment consumption occur only after payout succeeds.
- **Token policy:** only standard ERC-20 behavior is supported. False/reverting,
  fee-on-transfer, rebasing, reflection, or other balance-changing semantics are
  rejected when observed by the exact funding/payout delta checks. There is no
  attempt to normalize, recover, or support nonstandard token economics.
- **Commitment uniqueness:** commitments are reserved at term creation, so the same
  commitment cannot be attached to multiple IDs in one escrow deployment.
- **Adversarial coverage:** local tests cover accidental ETH, exact ERC-20 claim and
  refund payout, fee rejection on funding and payout, payout failure terminal-state
  safety, token callback reentrancy, domain/verifying-contract/asset binding,
  duplicate commitments, lifecycle reads, and clean fixture setup without manual
  `setUp` duplication.

## Accepted v1 contract decisions

- `EthEscrow` and `ERC20Escrow` are separate immutable contracts. ERC-20 token
  address is immutable per deployment; ETH asset is `address(0)`.
- Terms creation and funding are separate. The payer signs a typed funding approval;
  a relayer may submit it. ETH requires exact `msg.value`; ERC-20 requires payer
  allowance and exact `transferFrom` amount with zero ETH.
- Claim is public execution authorized by the recipient's EIP-712 signature. The
  recipient signer is the payout recipient. Commitments are unique and consumed once.
- EIP-712 domain: name `Prism Base Escrow`, version `1`, chain ID, verifying
  contract. FundingApproval binds claimId, payer, refundDestination, asset, amount,
  expiry, commitment, nonce, action. ClaimAuthorization additionally binds recipient.
- Lifecycle: `Unfunded -> Funded -> Claimed|Refunded`. Claim is strictly before
  expiry; refund is at/after expiry and only the immutable refund destination may call it.
- No admin, upgrade, arbitrary call, beneficiary override, or backend-only terminal
  transition exists. State-changing paths remain protected by a reentrancy guard.

## Implementation and tests

- `foundry/escrow/src/BaseEscrow.sol` — remediation and immutable core.
- `foundry/escrow/test/BaseEscrow.t.sol` — adversarial regression suite (10 tests).

## Evidence ceiling and remaining gates

Local source/build/tests establish implementation evidence only (`X2` controlled-local
ceiling). This package is not audited, deployed, funded, signed, broadcast, or
observed on Base Sepolia. Remaining gates are independent security review; ABI and
backend-port review; authorized Base Sepolia deployment with bytecode/receipt
readback; independent provider reconciliation; and backend integration tests.
Existing local payment/gift routes and `PublicBaseSepoliaEscrowPort` remain the
backend boundary; this lane adds no signer, provider, or live adapter.
