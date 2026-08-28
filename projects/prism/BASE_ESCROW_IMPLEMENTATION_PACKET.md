# Base escrow implementation packet

**Status:** `BLOCKED_BY_CONTRACT_TOOLCHAIN`

**Assessment commit:** `4eee0be88fc95db2efc44d146f344c9c2ee5fdc3`

**Target:** Base Sepolia (`chainId 84532`) only. No deployment, funding, signing,
broadcast, provider call, mainnet action, or secret handling is authorized by this
packet.

## 1. Decision and evidence boundary

Prism's canonical product state defines Base as an ordinary public execution venue
and a Base account as an external execution-identity proof. The canonical payment
and claim slice defines local request/gift aggregates and narrow effect ports, but it
does **not** define a reviewed Base escrow contract, ABI, deployed address, event
selectors, custody model, proof verifier, or trust model. Therefore this workstream
cannot honestly implement Solidity, an EVM adapter, or contract tests against a real
interface.

The correct deliverable is this packet plus the existing blocked report, not a
simulated contract or guessed calldata. Local aggregate behavior is not ledger
settlement evidence.

Evidence levels remain separate:

- `X2`: source-level/domain tests and local controlled adapters only;
- `X3`: Base Sepolia receipt/event/readback evidence, including an independent read;
- no X4/X5 or mainnet claim is possible from this workstream.

## 2. Existing architecture inspected

The existing boundary is intentionally narrow:

- `src/features/prism-payments/domain/payment-request.ts` owns payer approval,
  immutable terms, expiry/cancellation, receipt matching, and the distinction
  between `submitted`, `processing`, `confirmed`, `unknown`, and terminal failures.
- `src/features/prism-payments/domain/claimable-gift.ts` owns the claimable-gift
  state machine, immutable sender/refund destination, expiry, recipient binding,
  nullifier matching, claim receipt checks, and terminal claim/refund states.
- `src/features/prism-payments/domain/ports.ts` exposes
  `PublicBaseSepoliaEscrowPort` with only create, claim, refund, funding observation;
  it deliberately has no arbitrary call, beneficiary override, admin withdrawal,
  upgrade, or generic execute method.
- `src/features/prism-payments/application/claimable-gift-service.ts` reserves a
  nullifier before claim submission.
- `src/features/prism-payments/application/http-runtime.ts` uses fail-closed
  unavailable implementations when live escrow/runtime dependencies are absent.
- `projects/prism/PRISM_V0_PAYMENT_CLAIM_BACKEND.md` explicitly states that these
  routes do not imply escrow, signing, funding, broadcast, or a live receipt.
- `ops/target-network/manifest.yaml` accepts Base Sepolia `84532`, but contains no
  escrow address or ABI.

No tracked Solidity source, `foundry.toml`, Hardhat configuration, escrow ABI, or
contract address was found. Existing `viem` usage is for other identity,
permission, and utility boundaries; it is not an escrow implementation.

## 3. Required reviewed contract specification (unblock gate)

Before writing an adapter or contract test, a reviewer must supply and accept a
versioned specification that answers every item below. Names and encodings remain
placeholders until the canonical specification supplies them.

### Economic object and authority

1. Exact asset model: native ETH, one explicitly identified ERC-20, or a separately
   reviewed multi-asset design. Native and token paths must not be silently merged.
2. Exact amount semantics and decimals; zero amount behavior; fee behavior; and
   whether fee-on-transfer/rebasing/non-standard ERC-20s are rejected.
3. The sender/refund principal, recipient authority, and whether the contract is
   immutable or governed/upgradable. If governed, enumerate every privileged
   transition and timelock/emergency assumption.
4. Whether creation is one transaction or create-then-fund, and the unique
   correlation key connecting the off-chain claim ID to on-chain state.
5. Exact claim authorization model: public proof verifier, recipient signature,
   nullifier commitment, or another reviewed mechanism. A backend boolean is not
   sufficient ledger authority.

### State and terminality

The reviewed spec must define a one-way lifecycle equivalent in coverage to:

```text
absent -> created/unfunded -> funded -> claimable -> claimed
                                  |       |
                                  v       v
                               expired -> refunded
```

The actual contract states may differ, but it must explicitly define:

- which transition makes funds custodially locked;
- whether expiry is timestamp- or block-based and the boundary (`>=` versus `>`);
- whether an unfunded record can expire/cancel and whether that leaves storage;
- whether claim is allowed before/after expiry at the exact boundary;
- whether expiry is an explicit call or a predicate checked by refund;
- terminal-state behavior and idempotency/revert behavior for duplicate actions;
- what happens if a provider reports a transaction as pending or unknown.

The off-chain aggregate must not be promoted to `claimed`, `refunded`, or
`confirmed` from HTTP success or a submitted hash alone.

### Events and reads

The reviewed ABI must define canonical event names, indexed fields, data fields,
argument types/order, and emission points for at least:

- escrow created (claim correlation, sender/refund destination, asset, amount,
  expiry, commitment);
- funding accepted (exact amount/asset and transaction correlation);
- claim accepted (claim correlation, recipient, nullifier identity);
- expiry recognized;
- refund accepted (sender/refund destination and amount);
- failure/invalid-attempt observability if the contract emits it.

It must also define read methods sufficient to independently check, for one claim:
existence, immutable terms, current state, funded amount, commitment/nullifier
consumption, recipient (where public by design), refund destination, and the
contract's native asset/token balance. Event logs cannot substitute for current
state reads.

### Security invariants

The specification and implementation review must prove:

- **Replay:** a claim authorization/nullifier is consumed exactly once, is bound to
  the claim and exact terms, and cannot be reused for another claim, recipient,
  chain, contract, or asset. Duplicate create keys cannot create two liabilities.
- **Race safety:** claim versus expiry/refund has one canonical winner; duplicate
  funding and duplicate refund cannot double-account; off-chain CAS/version fences
  cannot cause a second broadcast after an ambiguous provider result.
- **Reentrancy:** all state marking and nullifier consumption precede external ETH/
  token transfer; a reentrant receiver cannot claim/refund twice or alter the
  destination. Use a reviewed pull-payment/transfer pattern, not an invented
  assumption about receiver behavior.
- **Refund:** no caller-supplied beneficiary; refund goes only to the immutable
  sender/refund destination; refund is unavailable before expiry and after claim;
  failed delivery is represented without falsely marking funds paid.
- **Expiry:** expiry cannot strand funds; expiry cannot make a claimed escrow
  refundable; timestamp/block manipulation tolerance and finality policy are
  documented.
- **Asset accounting:** exact-value transfer checks are enforced; token return
  values and fee-on-transfer behavior are handled by an explicit reviewed policy.
- **Authority:** no arbitrary call, arbitrary recipient, unrestricted admin sweep,
  hidden upgrade path, or backend-only success transition.

## 4. Smallest future implementation shape

Once the reviewed ABI/address/toolchain exist, implement only:

1. a pinned read-only Base Sepolia client for chain ID and exact contract address;
2. an adapter implementing the existing `PublicBaseSepoliaEscrowPort` only;
3. strict encoding/decoding against the supplied ABI (no handcrafted selectors);
4. receipt/event/read reconciliation that keeps `submitted`, `pending`, `unknown`,
   `reverted`, and terminal success distinct;
5. local contract tests against the reviewed implementation plus adapter tests for
   malformed receipts, wrong chain, wrong contract, duplicate observations, and
   ambiguous submission.

Do not expand the port into a generic EVM executor. Do not add signing authority to
this repository. A future wallet/provider boundary must be injected and must be
owned by the user or an explicitly reviewed custody component.

## 5. Adversarial test matrix required before X2 contract acceptance

The future suite must include, at minimum:

| Case | Required assertion |
|---|---|
| create exact terms | Stored sender, immutable refund destination, asset, amount, expiry, claim key, and commitment match input |
| duplicate create | Same key is idempotent only if exact terms match; otherwise rejected; no second liability |
| wrong chain/address | Adapter fails closed before submission or read promotion |
| wrong funding asset/amount/sender | Funding is rejected or remains non-funded; no local `funded` promotion |
| funding replay | Same transaction/event cannot credit twice |
| claim before claimable/funding | Rejected and state unchanged |
| claim after expiry boundary | Rejected; no recipient payout |
| valid claim | Nullifier consumed once; exact recipient paid; terminal state emitted/read |
| altered claim terms | Rejected: claim ID, commitment, recipient, asset, amount, expiry, or domain mismatch |
| nullifier replay/cross-claim replay | Rejected globally and state/payout unchanged |
| claim vs expiry/refund race | At most one terminal outcome; loser cannot transfer funds |
| refund before expiry | Rejected |
| refund by non-sender | Rejected even with a beneficiary argument or valid-looking proof |
| refund after claim | Rejected |
| refund replay | Rejected; exactly one payout |
| reentrant recipient/sender | No double claim/refund and no state corruption |
| token transfer anomaly | Explicit policy for false return, fee-on-transfer, revert, and non-standard token |
| provider pending/unknown/reverted | Local state remains non-terminal/attention/reverted as appropriate; no guessed retry |
| restart/reconciliation | Exact tx hash is polled; duplicate events are idempotent; no blind rebroadcast |

## 6. Exact future Base Sepolia readback predicates (X3)

A future run may claim `X3` only if every predicate below is captured in a
machine-readable evidence envelope and independently re-read from a distinct
provider/source. Values must come from the reviewed ABI/spec; no placeholder
selector or address may be filled by inference.

For a fresh `claimId`, with reviewed `ESCROW_ADDRESS`, `ASSET`, `SENDER`, `AMOUNT`,
`EXPIRY`, and `COMMITMENT`:

1. `eth_chainId == 84532` on the submission provider and independent provider.
2. `eth_getCode(ESCROW_ADDRESS)` is non-empty on both providers and the address
   equals the reviewed address byte-for-byte after canonical hex normalization.
3. Create/fund receipt has the expected transaction hash, `status == 1`, non-null
   block number, and the reviewed funding event whose decoded claim key and exact
   terms equal the requested values.
4. A fresh contract read at the receipt's canonical block returns the same claim
   key, sender/refund destination, asset, amount, expiry, commitment, and funded
   state; the independent provider returns the same values.
5. A valid claim receipt has `status == 1`, a non-null block, and exactly one
   reviewed claim event for the key. The post-claim read returns the reviewed
   claimed terminal state, the exact recipient, and consumed nullifier/claim
   authorization state.
6. A second claim attempt using the same authorization produces a reverted receipt
   or a deterministic preflight rejection, and a post-attempt read proves no second
   payout/state transition occurred.
7. For an expired unclaimed fresh escrow, the expiry/refund receipt has
   `status == 1`, a non-null block, exactly one reviewed refund event, and a
   post-refund read proves the terminal refunded state and immutable sender as the
   only destination. A second refund attempt proves no second payout.
8. Claim and expiry/refund race evidence records both transaction hashes and their
   receipt outcomes; exactly one terminal transition is reflected by the canonical
   read. A reverted loser must not be presented as a successful payout.
9. Native/token balance deltas, where the reviewed spec makes them observable, are
   reconciled against the exact amount and any explicitly specified fee. No sender
   attribution or privacy property is inferred from a transaction sender alone.
10. The envelope records the contract address, ABI/spec version, chain ID, tx hash,
    receipt block, decoded event identity, canonical read block, independent source,
    and limitations. Missing any field means `NOT_PROMOTABLE`, not partial X3.

These predicates prove only the reviewed escrow lifecycle and its ledger evidence;
they do not prove Prism identity continuity, privacy, Base account ownership, or
mainnet readiness.

## 7. Toolchain readiness report

- Disk check at assessment time: root filesystem `/dev/root`, `29G` total,
  `28G` used, `528M` available (`99%`).
- `forge`, `anvil`, `cast`, `solc`, and `hardhat`: not installed/resolvable.
- `scarb` and `snforge`: installed, but they are Starknet tooling and do not make
  an EVM escrow toolchain available.
- Repository dependencies include pinned `viem 2.55.19`, which is usable for a
  future client adapter but is not a Solidity compiler, local EVM, or reviewed
  contract interface.
- Existing `/home/ubuntu/.foundry` occupies about `446M`; no install was attempted.
  With only about `528M` free, installing Foundry or disposable EVM artifacts is
  unsafe and outside this lane's needs.

**Readiness:** `NOT_READY_FOR_CONTRACT_IMPLEMENTATION`. The safe next prerequisite
is a reviewed contract spec/ABI/address and an explicitly approved, space-safe
pinned toolchain plan. No toolchain installation should occur until disk is
remediated and cleanup is explicitly scoped.

## 8. Current verification record

Run at the assessment commit:

- `npm test -- --reporter=dot` → **1288 passed, 38 skipped, 0 failed**;
  130 files passed and 6 skipped.
- `npm run typecheck` → **PASS**.
- Static inventory confirms no tracked Solidity source, escrow ABI, or address.

The existing `projects/prism/BASE_ESCROW_BLOCKED_REPORT.md` remains the concise
blocker record. This packet adds the missing lifecycle, event, race, replay,
reentrancy, refund, expiry, and exact future readback requirements without claiming
that any of them are implemented or observed.
