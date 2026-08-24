# M1 Live Identity Evidence — SN_SEPOLIA

**Status:** Observed testnet evidence; partial M1 closeout  
**Evidence maturity:** X3 for live create/read; event indexing/watermark reconciliation remains open  
**Date:** 2026-08-24 UTC

## Deployment

```text
registry:
0x67b2f847d7805501c3db79474bdb33e7538825fa0f83aa3cd0083f02ee655c4

class hash:
0x3b21bf8012d99ce6381fc4ea21413e80b3bf5662480461a0ee0529bdaa0f998

account/controller:
0x047c0f8b01b9c7c75c669dc549bc305a0f2d796808117339a1c87730162b131c
```

The registry address is recorded in normalized Starknet form without a leading zero. The historical deployment transaction was `0x03177381c267bd42e413ff8ed72a3111543cee16e85334fbbf3258897510214b`, accepted on L1 at block `13935398`; its trace/state diff identifies the deployed registry address above.

## Live create/read

```text
create_identity tx:
0x0457a43d908da21e8acd723ba94639d6009c123ec4c4d944175f2bbfa05e3a6f

execution:
Accepted on L2 / Succeeded
block: 13960873
block hash:
0x06aeda43c13348df394700ea1eb33ce7900988707e054669388c2c2dae248332

Prism ID:
0x1

controller:
0x047c0f8b01b9c7c75c669dc549bc305a0f2d796808117339a1c87730162b131c

created_at_block:
13960873

identity version:
0
```

Trace event:

```text
selector:
0x2c3cc45f2ad701f3571bc1faaf7d37e194064f8e8e3269b8642fc31624960e7

keys:
[selector, 0x1]

data:
[controller]
```

## Independent read

`get_identity(0x1)` returned the same controller, creation block, and version through:

```text
1. sncast call against the SN_SEPOLIA provider
2. raw starknet_call against https://starknet-sepolia-rpc.publicnode.com
```

The second raw read returned:

```text
[0x0, 0x047c0f8b01b9c7c75c669dc549bc305a0f2d796808117339a1c87730162b131c,
 0xd506a9, 0x0]
```

`0xd506a9 = 13960873`.

The raw RPC also returned the registry class hash and confirmed the create transaction in block `13960873` using the normalized transaction hash.

## Remaining M1 gates

```text
event indexer projection/read watermark
fresh watermark policy envelope
full independent explorer + RPC evidence envelope
M3 Base proof/bind/resolve/revoke sequence
```

This artifact promotes only the observed create/read claim. It does not promote Base binding, STRK20, mainnet, or `strk20.json` evidence.
