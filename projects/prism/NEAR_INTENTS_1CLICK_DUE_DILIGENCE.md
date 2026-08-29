# NEAR Intents/1Click — Base Sepolia ↔ SN_SEPOLIA due diligence

**Status:** typed provider candidate implemented, requested testnet route **blocked/unavailable**
**Checked:** 2026-08-28 UTC
**Evidence ceiling:** X2 (local controlled implementation and injected fixtures only)
**Provider:** `near-intents-1click`
**Scope:** Base Sepolia (`chain_id: 84532`) ↔ `SN_SEPOLIA` only

## Decision boundary

The first-party 1Click quickstart explicitly states: **“There is no testnet version of NEAR Intents - use small amounts for test swaps.”**[2] The first-party chain-support page lists Base and Starknet as supported chains, but that is chain-level documentation and does not prove Base Sepolia, SN_SEPOLIA, or a route between those networks.[3]

Therefore this repository does **not** claim that the requested testnet route is available. The adapter's default capability assessment is `documented_general`, and quote/status calls return a typed `provider_unavailable` blocker without touching the transport. An injected `observed_testnet` capability assertion exists only to exercise the adapter with local fixtures; it is not live route evidence.

## What was observed

- The official 1Click API exposes a public `GET /v0/tokens` discovery endpoint; the asset-support documentation says the list is sourced live from that endpoint.[4] The read-only response retrieved during this review contained 187 token records across 35 blockchain labels, including `base` and `starknet`, but no `sepolia`, `testnet`, or `goerli` markers.[12]
- The observed Base records used production-style asset IDs such as `nep141:base-...omft.near`; the observed Starknet records used production-style IDs such as `1cs_v1:starknet:erc20:...`. Those records are useful asset evidence only; they do not establish testnet deployment or route liquidity.[12]
- The official bridge overview describes a POA bridge supporting Base and Starknet at the chain level.[10] It does not establish that the bridge or 1Click route accepts Base Sepolia and SN_SEPOLIA.
- No quote POST, deposit notification POST, transfer, signature, broadcast, or credentialed request was performed. No live quote/status response or native receipt was observed.

## Provider API facts and safe boundaries

The documented flow is: discover asset IDs, request a quote, transfer the origin asset to the returned deposit address, and optionally notify 1Click with the origin transaction hash.[5][8] Status is then polled using the deposit address and optional memo.[7]

The quote request uses smallest-unit integer strings, an explicit deadline, origin/destination asset IDs, recipient/refund addresses, and explicit origin-chain/destination-chain types.[6] `dry: true` validates parameters without generating a deposit address; the adapter still does not make a live call by default.[6]

The documented status values are `PENDING_DEPOSIT`, `KNOWN_DEPOSIT_TX`, `PROCESSING`, `SUCCESS`, `INCOMPLETE_DEPOSIT`, `REFUNDED`, and `FAILED`.[5][7] The adapter preserves the raw status and maps it as follows:

| Provider fact | Candidate lifecycle | Prism Operation projection | Safety boundary |
|---|---|---|---|
| quote request | `quote_requested` | none | no wallet authority; no transfer |
| validated quote | `quote_ready` | `ready` | quote signature, route, assets, recipient, refund address, and deadline are checked |
| `PENDING_DEPOSIT` | `pending_deposit` | `awaiting_authorization` | wait for the user's native wallet; no completion |
| `KNOWN_DEPOSIT_TX` | `submitted` | `submitted` | provider detection is not a native receipt |
| `PROCESSING` / `INCOMPLETE_DEPOSIT` | `processing` | `processing` | poll-only; no retry/broadcast |
| `SUCCESS` | provider `completed` | `confirmed` | independent destination-chain receipt is mandatory; Prism `completed` is never inferred |
| `FAILED` | `failed` | `failed_terminal` | new quote only; no automatic resubmission of a deposited route |
| `REFUNDED` | `refunded` | `failed_terminal` | independent origin-chain refund receipt is mandatory before claiming funds returned; new quote only |
| expired pending/incomplete quote | `expired` | `expired` | deadline expiry is not a claim that funds were refunded |
| unknown or stale status | `unknown` | `requires_attention` | poll-only; no failure or completion is inferred |

The API documents quote/status signatures as tamper evidence, including the deposit address; the adapter preserves the signature and rejects quote/status correlation mismatches before consuming terminal facts.[9] A provider `SUCCESS` response is not sufficient for Prism completion: the injected `NearIntentsReceiptReader` must independently observe the destination receipt and match network, transaction hash, recipient, asset ID, successful execution, and at least the quoted minimum output. A `REFUNDED` response similarly requires an independent origin receipt matching the refund recipient, asset, transaction, asset ID, and refunded amount.

The adapter never instantiates a wallet, signs an intent, broadcasts a transaction, or moves funds. Deposit notification requires an explicit `userApproved: true` flag and only submits a provider notification for a transaction already broadcast by the user's native wallet. A transport timeout after a deposit is represented as `provider_unavailable` with `pollOnly: true`; it never becomes a failed-onchain fact and never re-arms a second broadcast.

## Trust and custody disclosure

The 1Click overview says that the service may **temporarily transfer assets to a trusted swapping agent** that coordinates with market makers.[1] The market-maker documentation describes independent solvers/market makers, and the terms describe the API as routing and settlement infrastructure separate from the protocol and third-party components.[10][11]

Accordingly, the candidate exposes this disclosure on every quote/status result:

> The 1Click flow may temporarily transfer assets to a trusted swapping agent. Prism coordinates the provider flow; Prism is not the solver and does not receive authority to move user assets.

The adapter sets `nonCustodialClaimAllowed: false`. It does not relabel the route as non-custodial merely because Prism does not hold the user's keys. The technical temporary-transfer and solver/bridge trust assumptions remain explicit and require owner/security review before any product claim.

## Missing evidence / blockers

The following are not proven and block a Base Sepolia ↔ SN_SEPOLIA route claim:

1. First-party confirmation that 1Click has a **testnet environment** or accepts Base Sepolia and SN_SEPOLIA; current quickstart evidence says no testnet version.[2]
2. Exact supported **testnet asset IDs** for both directions, including decimals, token contracts, and any Starknet/Base bridge representation.[3][4][12]
3. An observed quote for each direction with a signed response, live deposit address, deadline, and route-specific liquidity.
4. An observed user-authorized origin deposit and provider status progression, with no credentials or funds handled by Prism.
5. Independent Base Sepolia and SN_SEPOLIA native receipt readers and a matched destination receipt for `SUCCESS`.
6. Independent origin-chain refund receipt evidence for `REFUNDED`, including partial-deposit/under-minimum and deadline behavior.
7. Timeout, retry, bridge, solver, liquidity, rate-limit, and operational failure evidence on the exact requested networks.
8. Owner/security/commercial review of API access, terms, supported bridge route, trusted swapping-agent exposure, fee policy, and end-user disclosures.[1][11]

Until those gates are separately observed and approved, this candidate remains **X2** and returns `PROVIDER_UNAVAILABLE` for the requested route in its default configuration.

## Implementation map

- `src/integrations/near-intents/adapter.ts` — typed transport, capability gate, quote validation, status mapping, stale/timeout handling, native receipt correlation, refund/readback policy, and trust disclosure.
- `src/integrations/near-intents/__tests__/adapter.test.ts` — strict boundary tests for unavailable/default behavior, malformed/expired quotes, wrong routes/assets, native-wallet approval, every documented status, stale/unknown/timeout, receipt mismatch, destination/refund readback, and custody disclosure.
- `src/integrations/near-intents/index.ts` and `src/integrations/index.ts` — explicit exports.

## Sources

[1] https://docs.near-intents.org/integration/distribution-channels/1click-api/about-1click-api
[2] https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/introduction
[3] https://docs.near-intents.org/resources/chain-support
[4] https://docs.near-intents.org/resources/asset-support
[5] https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request
[6] https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote
[7] https://docs.near-intents.org/api-reference/oneclick/check-swap-execution-status
[8] https://docs.near-intents.org/api-reference/oneclick/submit-deposit-transaction-hash
[9] https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature
[10] https://docs.near-intents.org/integration/bridging/overview
[11] https://docs.near-intents.org/security-compliance/terms-of-service
[12] https://1click.chaindefuser.com/v0/tokens
