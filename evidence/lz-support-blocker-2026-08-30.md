# LayerZero bilateral support blocker, 2026-08-30

Verdict: `LZ_BILATERAL_BLOCKED_EXACTLY`

Scope: bounded, read-only follow-up. No resend, execution, configuration,
deployment, Hyperlane action, or mainnet access was performed.

## Public packet identities

| Direction | Source transaction | GUID | Scan lookup result |
|---|---|---|---|
| SN Sepolia -> Base Sepolia | `0x04037219fe841d333f3b2093c136b0a3ca3fc40efca84739b8e3f6c605420405` | `0x6d1be34defe7d8e0b7db0741b09345f7328ab8a49b9ad4e538f1dc7b5e07862` | Testnet Scan API returned HTTP 404 for both tx and GUID lookups |
| Base Sepolia -> SN Sepolia | `0x465eedb5823292a499a272a6d70d1ab5507940f01cce1d5cf0e941284d56eb13` | `0xa6f36eae55d7be072596081f6a560ca03da87a05bdf2c5ba177f63d44aa50ca2` | Testnet Scan API returned one record for both tx and GUID |

Source URLs are redacted to host/path form only: LayerZero testnet Scan API
`scan-testnet.layerzero-api.com/v1/messages/{tx|guid}/<value>`. No RPC URL,
credential, signer, or secret is recorded.

## Current Scan observation, Base -> Starknet

Observed at `2026-08-30T09:47Z` from the official LayerZero testnet Scan API:

- Pathway: `srcEid=40245`, `dstEid=40500`, `base-sepolia -> starknet-testnet`.
- Sender: Base OApp `0x288744da67f795e75ed66ee451f8e4acefbda23d`.
- Receiver: Starknet OApp `0x078d2e4dcb564a4a1f7dd51d0ebdb9879f6175856b510bc101544e4b2479db9f`.
- Nonce: `1`; source status `SUCCEEDED`; source block `46155123`.
- Required DVN: LayerZero Labs, `0x06d1be34defe7d8e0b7db0741b09345f7328ab8a49b9ad4e538f1dc7b5e07862`, status `SUCCEEDED`.
- DVN verification tx: `0x3b3c5a9113c7f671df999640f543a2534b1789dd6c4da61a0c2b31edc736612`.
- Sealer/committer status: `WAITING`, with no sealer tx returned.
- Destination status: `WAITING`, with no destination tx, execution envelope,
  `lzReceive` result, destination event, or application-state readback.
- Overall Scan status: `INFLIGHT`, message `Ready for committer to commit verification`.
- Scan config reports ULN `V302`, inbound confirmations `2`, one required DVN,
  no optional DVNs, and the Base send library
  `0xC1868e054425D378095A003EcbA3823a5D0135C9`.

The GUID lookup returned the same record and statuses, so this is not a
single-lookup parsing artifact.

## SN -> Base observation

The same official testnet Scan endpoints returned HTTP 404 for the supplied
source tx and GUID. Therefore no current Scan lifecycle record, DVN status,
committer/sealer status, destination status, or official execution envelope
is available for this direction. The prior corrected-packet evidence remains
source/config evidence only and is not promoted to delivery evidence.

## Official infrastructure and route support

The official LayerZero metadata deployment registry was read without secrets.
It currently lists both testnet deployments as active and identifies:

- Base Sepolia, chain ID `84532`, EID `40245`, Endpoint V2
  `0x6edce65403992e310a62460808c4b910d972f10f`, SendUln302
  `0xc1868e054425d378095a003ecba3823a5d0135c9`, ReceiveUln302
  `0x12523de19dc41c91f7d2093e0cfbb76b17012c8d`, Executor
  `0x8a3d588d9f6ac041476b094f97ff94ec30169d3d`.
- Starknet testnet, EID `40500`, Endpoint V2
  `0x0316d70a6e0445a58c486215fac8ead48d3db985acde27efca9130da4c675878`,
  Send/Receive Uln302
  `0x0706572d6f7b938c813a20dc1b0328b83de939066e25bd0fbe14c270077f769d`,
  Executor
  `0x068ffdaca6533001344f377beaf1137360168604b227df3e8cf735fe06da47a9`.
- The registry lists exactly one Starknet testnet DVN, LayerZero Labs at
  `0x06d1be34defe7d8e0b7db0741b09345f7328ab8a49b9ad4e538f1dc7b5e07862`.
  Base Sepolia lists LayerZero Labs at
  `0xe1a12515f9ab2764b887bf60b923ca494ebbb2d6`, matching the Scan pathway
  outbound config.

Official sources, redacted to stable public paths:
`docs.layerzero.network/v2/deployments/deployed-contracts`,
`docs.layerzero.network/v2/deployments/chains/base-sepolia`, and
`metadata.layerzero-api.com/v1/metadata/deployments`.
The official deployment registry establishes chain infrastructure, not this
specific OApp's peer/configuration or message delivery.

## Endpoint, peer, and configuration readbacks

The existing corrected-packet report
`evidence/lz-bilateral-blocked-2026-08-29.md` records live Starknet readbacks:

- Starknet OApp endpoint is the official Starknet testnet Endpoint above;
  `get_eid=40500`; peer(40245) was zero; counters were zero at that read.
- Starknet ULN302 send config readback: confirmations `1`, required DVN
  LayerZero Labs, no optional DVNs. Receive config: confirmations `2`, same
  required DVN, no optional DVNs. Executor max message size `10000` and the
  official Starknet Executor were read back.
- Base OApp endpoint, owner/delegate were correct; peer(40500) was zero and
  counters were zero at that read. Base Endpoint returned the official send
  and active receive libraries, and its library configs contained LayerZero
  Labs DVN and official Executor.
- The report records the exact failed Starknet peer dry-run at the ABI
  serialization boundary (`Failed to deserialize param #2`) and that no peer
  transaction was accepted. This follow-up did not retry it.

These are configuration/readback facts, not evidence that peers were later
set or that either message was delivered.

## Independent-provider attempt and X3 gate

The official Scan API record and official metadata registry independently
agree on the EIDs, endpoint/library identities, and LayerZero Labs DVN. Two
public Base Sepolia RPC hosts were also probed for chain ID and Endpoint code,
but both returned HTTP 403 from this environment, so no new RPC receipt or
contract-state claim is made from that attempt. No destination Starknet RPC
credential was loaded or exposed.

| X3 field | SN -> Base | Base -> SN |
|---|---|---|
| source receipt/status | not newly available in Scan, supplied tx unresolved there | Scan source `SUCCEEDED` |
| GUID/nonce | supplied GUID, not indexed | GUID supplied, nonce `1` |
| DVN verification | unobserved | observed `SUCCEEDED` |
| committer/sealer | unobserved | `WAITING`, no tx |
| executor/destination tx | unobserved | unobserved |
| destination event/state | unobserved | unobserved |
| second-provider destination read | unobserved | unobserved |
| replay rejection | not attempted | not attempted |

No official execution envelope becomes available while sealer is `WAITING`
and destination is `WAITING`. Since every X3 field is not observed in either
direction, the exact fail-closed verdict remains:

`LZ_BILATERAL_BLOCKED_EXACTLY`

## Support handoff request

Please investigate the two public packet identities above. For the Base ->
Starknet packet, the source is finalized and the required LayerZero Labs DVN
has verified, but the committer/sealer remains `WAITING` and no destination
execution transaction or envelope is exposed. For SN -> Base, Scan returns
404 for both supplied identifiers. Confirm whether the SN -> Base packet is
indexed/recognized and whether the Base -> Starknet pathway requires a
committer intervention or has a testnet infrastructure incident. No resend or
manual execution was attempted.
