# LayerZero bilateral closure evidence

Verdict: `LZ_BILATERAL_BLOCKED_EXACTLY`

## Preflight

- Protected Starknet RPC document, account path, signer metadata, and modes passed `scripts/layerzero-preflight.py`.
- Starknet chain identity read as SN_SEPOLIA.
- Base RPC used: the user-authorized `https://sepolia.base.org`.
- No secrets are recorded here.

## Initial live readbacks

- Starknet OApp `0x023e8a1e62f40be3dcdc63a8a8ade4658bff5a27ed67ff62152563d210d7d73c`: endpoint `0x0316d70a6e0445a58c486215fac8ead48d3db985acde27efca9130da4c675878`; peer(40245)=zero; sent_count=0; received_count=0.
- Starknet Endpoint get_eid=40500.
- Starknet ULN302 `0x0706572d6f7b938c813a20dc1b0328b83de939066e25bd0fbe14c270077f769d` raw OApp executor/ULN send/ULN receive configs were unset (zero/empty).
- Starknet defaults: send confirmations=1 and required DVN `0x06d1be34defe7d8e0b7db0741b09345f7328ab8a49b9ad4e538f1dc7b5e07862`; receive confirmations=2 and the same required DVN; executor max_message_size=10000 and executor `0x068ffdaca6533001344f377beaf1137360168604b227df3e8cf735fe06da47a9`.
- Base OApp `0x288744da67f795e75ed66ee451f8e4acefbda23d`: endpoint correct; owner/delegate readback correct; peer(40500)=zero; sent_count=0; received_count=0.
- Base Endpoint already returned send library `0xc1868e054425d378095a003ecba3823a5d0135c9`, receive library `0x12523de19dc41c91f7d2093e0cfbb76b17012c8d` (active), and delegate equal to the owner. Base library configs already contained LayerZero Labs DVN and official Executor.

## Successful public effects, each read back before the next

1. Starknet Endpoint send-side Executor config transaction: `0x00d0d5a16e281b9aeb18418859564a64ca3fa3c570eea56b21f2ca8090033b38`. Readback on ULN302: max_message_size=10000, executor=`0x068ffdaca6533001344f377beaf1137360168604b227df3e8cf735fe06da47a9`.
2. Starknet Endpoint send-side ULN config transaction: `0x078189d55ae86d8c1dc95bf61f2022b2fc5bbd29418adf6579ee2e3b81961217`. Readback: confirmations=1, required DVN=`0x06d1be34defe7d8e0b7db0741b09345f7328ab8a49b9ad4e538f1dc7b5e07862`, no optional DVNs.
3. Starknet Endpoint receive-side ULN config transaction: `0x009a64fac286bb0ff8c09a27ab8a22751cce75c697d3eec2d5e76a66f317389e`. Readback: confirmations=2, required DVN=`0x06d1be34defe7d8e0b7db0741b09345f7328ab8a49b9ad4e538f1dc7b5e07862`, no optional DVNs.

No peer transaction was accepted. No Base configuration transaction was broadcast. No quote, send, DVN verification, Executor delivery, destination receipt/event/state, second-provider parity, or replay attempt occurred.

## Exact blocker

The final Starknet peer dry-run against the deployed OApp using the exact EVM peer value `0x288744da67f795e75ed66ee451f8e4acefbda23d` encoded as two u256 felts (`low`, `high=0`) failed before submission:

`Failed to deserialize param #2`

The same deployed `set_peer` ABI dry-run with minimal `Bytes32` value (`0x4050`, `0`) succeeded, proving the failure is value/serialization-boundary-specific and not a permission or fee failure. Per the operator contract, all dependent broadcasts stopped at this exact ABI boundary. The EVM peer representation cannot be guessed or normalized further.

## Local verification

- `forge test -q`: passed.
- `cd cairo && scarb build`: passed.
- `python3 scripts/validate.py`: `route/schema validation: PASS`.
- `python3 -m unittest discover -s scripts -p '*test*.py'`: 4 passed.
- `git diff --check`: passed.
