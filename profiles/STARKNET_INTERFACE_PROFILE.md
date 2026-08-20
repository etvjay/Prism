# Starknet Interface Profile

**Profile type:** Interface & Ecosystem Foundry specialization  
**Project:** Prism  
**Last research refresh:** 2026-08-20

## Goal

Expose Prism capabilities in Prism vocabulary while keeping Starknet mechanics behind explicit adapters unless an advanced low-level developer surface deliberately requires them.

## Canonical translation boundary

External Prism consumers should prefer:

```text
PrismID
Binding
Resolution
PrivateBalance
Operation
Receipt
```

over raw chain mechanics such as:

```text
felt252
calldata arrays
class hashes
raw RPC payloads
wallet-standard internals
note discovery implementation
```

## Capability examples

```text
prism.identity.create
prism.identity.read
prism.binding.create
prism.binding.revoke
prism.identity.resolve
prism.portfolio.read
prism.private.capabilities.read
prism.private.balance.read
prism.private.transfer.prepare
prism.private.invoke.prepare
```

These are canonical capabilities first; HTTP, SDK, MCP, wallet adapters, and frontend clients are projections.

## Wallet capability detection

For the normal STRK20 dapp route, detect privacy support through the wallet/spec capability surface (`supportedWalletApi` / supported specs).

Do **not** use `strk20Balances([])` as feature detection. A balance read is user-data access and may trigger consent; least privilege requires that Prism request it only when the product intentionally shows a private balance.

Expose the distinction explicitly:

```text
privacy capability available
≠
private balance disclosed to Prism
```

## Wallet support behavior

A discovered Starknet wallet is not automatically STRK20-capable.

The UI/API adapter must support:

```text
supported
unsupported
capability_unknown
consent_required
```

Unsupported wallets degrade gracefully rather than throwing generic failures or exposing private actions that cannot execute.

## Operation semantics

Never treat transaction submission as completion.

Minimum lifecycle:

```text
awaiting_authorization
→ submitted
→ confirming
→ confirmed
→ reconciled/completed
```

Wallet/paymaster/relayer transactions may be slow to appear through an RPC. `waitForTransaction` or equivalent waits must have a ceiling. A timeout means the operation remains `submitted/pending`; it does not prove failure.

## Multi-step shield semantics

A normal shield flow includes two wallet-visible transactions:

```text
approve
→ deposit
```

The interface must represent both steps as one user workflow without falsely collapsing them into one chain transaction.

## Note maturity state

Fresh notes may require roughly ten blocks before later spending. Prism should expose an appropriate domain state such as:

```text
private_balance_pending
private_balance_maturing
private_balance_available
```

Exact naming belongs to System/Experience canonicalization, but the interface must not imply immediate spendability when it is not true.

## Error translation

Do not expose raw Starknet/RPC/wallet exceptions directly.

Map them into stable domain errors while preserving a safe technical cause/reference for debugging.

Examples:

```text
wallet_capability_unavailable
wallet_consent_required
privacy_wallet_required
screening_rejected
screening_unavailable
note_not_mature
pool_fee_insufficient
transaction_submitted_unconfirmed
transaction_reverted
stale_binding
binding_revoked
rpc_unavailable
```

Screening rejection and screening infrastructure unavailability are different states and must not be collapsed where upstream APIs distinguish them.

## Relayer attribution

Private STRK20 transactions may be submitted by shared relayers. Transaction `sender` is therefore not a user-identity field.

Any API/activity surface answering “what did this user do?” must use canonical STRK20 event/state attribution rather than grouping by transaction sender.

## Address normalization

Starknet felts can be serialized with different zero padding. Address equality must use normalized/numeric identity semantics, not raw string equality.

The interface may preserve a canonical display form, but adapters must compare equivalent addresses correctly.

## Privacy boundary

Public APIs must never return viewing keys, private signing material, seed phrases, or hidden note material beyond what the canonical privacy integration explicitly permits.

Authentication, Prism authorization, wallet consent, privacy visibility, commercial entitlement, and economic authority remain separate concerns.

## Private balance semantics

A private-balance read is a deliberate product capability and may require wallet consent. Public interface contracts should communicate:

```text
value
asset
freshness
source = privacy wallet / supported route
consent state
```

without exposing the underlying viewing key or note registry.

## Open-note semantics

If a private application route produces an open note, the public interface must not label its amount as hidden. Model privacy attributes separately from the generic `PrivateBalance`/`Receipt` object where needed.

## Pool fee semantics

Do not hardcode a historical pool fee in interface contracts. Fee/preflight responses should carry the current observed fee and freshness/source so the frontend can calculate `MAX` and minimum sensible amounts correctly.

## Network configuration

Network should be explicit in developer environments and receipts.

```text
mainnet = SN_MAIN
```

Do not infer mainnet/testnet from an address alone when explicit environment data is available.

## Evidence-facing receipt

A sprint-critical receipt should be able to expose, without requiring raw RPC knowledge:

```text
network
transaction_hash
status
block
pool_involved
prism_contracts_involved
operation_type
privacy_properties
public_metadata
```

This is a domain representation of evidence, not an explorer replacement.

## Low-level escape hatch

A future advanced SDK may expose Starknet transaction/calldata details for expert consumers, but it must be clearly separated from the default Prism domain SDK and must not redefine public Prism vocabulary.

**Rule:** Chain mechanics may explain a Prism capability; they may not become the capability model by accident.
