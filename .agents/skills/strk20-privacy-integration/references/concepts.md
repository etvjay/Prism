# STRK20 Concepts — what it is, what it hides, how to talk about it

Read this before interviewing the developer or writing a plan. It defines the mental model you explain to teams and the wording rules every plan must follow.

## The one-sentence pitch

Confidential transfers and private DeFi on any ERC-20, built on the wallets and liquidity Starknet already has — no bespoke privacy coin, no rebuilding cryptography.

## Mental model

- The STRK20 pool is **live on Starknet mainnet**. It is a **note-based (UTXO) pool, not a mixer**: shielding deposits an ERC-20 into the pool, where the balance is held as an encrypted note; private transfers spend existing notes and create new ones.
- **Onchain proof verification**: every private transaction carries a zero-knowledge (STARK) proof confirming the spent notes exist, belong to the spender, haven't been double-spent, and that value is conserved. Starknet verifies the proof in-protocol before updating pool state.
- **Registration first**: an account must register in the pool (set a viewing key) before it can hold or receive private balances; both sender and recipient must be registered before private transfers between them. **Wallets handle registration automatically on first use — dapps don't.**
- **Any ERC-20**: standard ERC-20s (stablecoins, STRK, strkBTC, …) enter the pool without changing the token contract. Users shield when they want privacy and unshield when transparency is required.
- **Shield / unshield vocabulary**: shield = deposit into the pool (public → private); unshield = withdraw (private → public). Use these words consistently in plans.

## Hidden vs visible — always be honest about this

Every plan must include a version of this table, adapted to the app's flows:

| Private (inside the pool) | Public (visible onchain) |
|---|---|
| Sender and receiver of a private transfer | Deposit and withdrawal amounts (the public ERC-20 legs) |
| Transfer amounts and token type | The fact that an address interacted with the pool |
| Which notes were spent | Timing of pool interactions |

A paymaster can decouple the submitting address from the transaction — see "The transaction sender is not the user" below for what that means when reading activity back off the chain. Additionally, per route:

- **Anonymizer contracts** hide the *user's address* in a DeFi action; the amounts and the app activity itself may still be public.
- **Private sub-accounts** (upcoming) hide the *public onchain link* between a user's main wallet and the account acting; the dapp action and amounts at the dapp may still be public.

Never let a plan imply more privacy than the route actually delivers.

## The transaction sender is not the user — attribute from the event

Private transactions reach the chain through a relayer, not the user's account.
That is the point: if the user submitted, the chain would name exactly who
called the pool. So the `sender` on a private transaction is the relayer's
account — the same one, for everybody, with a very high nonce.

Any code that answers "what did this user do" must therefore read the pool's
events, never the transaction envelope. The depositing account is the **first
indexed key (topic1) on the pool's `Deposit` event**; filter on that.

Two queries look right and are silently wrong:

- `transactions where sender == the user's wallet` → always empty.
- grouping activity by `sender` → every shield attributed to one address, so the
  data reads as if a single whale made every deposit.

Neither throws, so the team debugs the indexer, the block range and the RPC for
hours before questioning the field. On a transparent chain `sender` does mean
"the person"; here it structurally cannot.

This matters whenever a plan includes a leaderboard, a transaction history, an
analytics panel, a rewards or quest check, or anything else that counts
per-user activity. Say in the plan which event and which key the feature reads.

## Open notes carry public amounts

Most notes encrypt their amount. An **open note** does not: it exists for flows
where the amount is only known once a contract has run on-chain — a swap's output,
say — so it carries the filled amount in plaintext. The owner still stays hidden.

This changes what a flow leaks, and the choice is worth stating in a plan.
Crediting a DeFi output straight into the recipient's note is atomic and cheap,
but the amount they received is public. Landing it in the user's own note and then
sending an encrypted transfer costs an extra operation and hides the amount.

## Composition leaks: don't bundle a deposit with the transfer it funds

Deposits are public — the ERC-20 leg names the depositor. Bundling a deposit and a
private transfer into one transaction therefore publishes "this address put in X"
right alongside the transfer it paid for, and an observer correlates them
trivially. The recipient stays hidden; the sender and the amount do not.

Shielding as its own earlier transaction breaks that link, because the later
transfer carries no public leg at all. It costs an extra pool fee and a maturity
wait, and it is the difference between a flow that looks private and one that is.
A plan may still bundle them for UX reasons — but say plainly what that costs, so
the team is choosing rather than assuming.

## The golden rule

**A dapp must never touch the user's viewing key.** The Privacy SDK expects the viewing key (a secret) in the clear, and a wallet will never provide it. The wallet holds keys, runs the SDK internally, manages notes, and does the proving. The dapp only *asks* the wallet to act, via starknet.js. Everything in the route table follows from this rule. If a plan step would require the dapp to see keys, notes, balances-by-key, or proofs, the route is wrong.

Practical consequence for UX planning: a dapp cannot read a user's shielded balances itself (it has no viewing key). Design UI around actions the wallet performs, and verify against the current WalletAccount guide / Wallet API spec what state, if any, the wallet exposes to dapps.

**Least privilege — request only what the flow uses.** A dapp must invoke only the STRK20 actions its flow actually needs (e.g. `transfer`, `deposit`) and must **never read balances or probe keys just to feature-detect**. Balance/asset reads (`strk20Balances`) trigger a user consent prompt; using one to check "does this wallet support STRK20?" asks the user to share data the app has no reason to see. Detect capability with a version query (`supportedWalletApi`/`supportedSpecs`) instead. Only reach for `strk20Balances` when showing the user their own shielded balance is a deliberate, planned feature — and say so in the plan.

## Screening and compliance — mandatory wording

- **Protocol-enforced screening**: deposit screening is part of the pool flow. From protocol version v0.14.3, screening enforcement moves onchain, so deposits require screening approval regardless of prover route. **Self-hosted proving does not bypass deposit screening.** Never present any route, self-hosting included, as a screening workaround.
- **Selective disclosure**: the system is confidential by default and can disclose the information necessary to respond to a legitimate regulatory request without exposing unrelated users. Never frame this as automatic compliance, regulator approval, or regulator endorsement.
- **Builders still own**: app-level legal/compliance decisions, any use-case-specific KYC, and their own anonymizer contracts (review, audit, deployment, maintenance).

## Fees — set expectations

Current wallet flows sponsor gas fees but not pool fees; shielded-token fee payment and paymaster-based fee estimation are still being designed. Don't promise a specific fee UX in plans — flag it as an item to re-check at build time.

## Performance claims — don't make them

Proving performance figures floating around are machine-dependent engineering data from server-class hardware. Never quote proving times in plans, and never as laptop/phone numbers. If asked, say proving is handled by hosted services in wallet flows and is machine-dependent when self-hosted.
