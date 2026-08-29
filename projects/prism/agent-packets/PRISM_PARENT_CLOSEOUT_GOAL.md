# Parent Closeout Goal — M0–M7

**Owner:** Jason / parent Hermes session  
**Scope:** M0–M7 and C1/S4 only  
**Explicit exclusion:** Phase 8 Home/frontend/product surfaces remain owner-led  
**Model policy:** no ChatGPT/Codex workers; use Muse Spark free and Hermes 0x Alpha only

## Goal

Drive every delegated lane to its honest terminal state, integrate only verified work into the parent branch, run combined QA, reconcile Product/Research/System/AUDIT/Antagonist evidence, and leave no worker-only implementation described as parent-complete.

## Completion vocabulary

```text
LANE_COMPLETE_X2
  isolated implementation/review/tests are green and evidence is honest;
  parent integration may proceed.

PARENT_INTEGRATED_X2
  selected lane commit is in the parent branch and combined QA passes.

TESTNET_COMPLETE_X3
  required real SN_SEPOLIA/Base testnet operation, receipt, independent read,
  and evidence envelope are observed.

MAINNET_READY
  all applicable testnet gates and release decisions pass; never inferred from X2.

BLOCKED
  a required decision, environment, authority, wallet/prover, live receipt, or
  parent integration gate is unavailable.
```

## Lane goals

```text
M0  canonical Band A/B and Pause promise decision; deferred features explicit
M1  live create_identity → independent read → event/index/watermark evidence
M2  parent-integrated REST/API + SDK + MCP boundary; runtime gaps explicit
M3  live Base proof → Starknet bind → ACTIVE resolve → revoke → empty resolve
M4  parent-integrated Wallet API route; real wallet trace when capability exists
M5  pinned u256 Vesu helper + real pool-invoked private action + readback
M6  owner-led Phase 8; delegated workers must not touch it
M7  Pause P0–P4 integrated; P0/P5–P8 gates explicit before release promise
C1  PrismChannel minimal S4 testnet slice; X2 integration first, X3 later
```

## Non-negotiables

- No worker pushes GitHub or edits Linear/Notion.
- No worker touches Phase 8/frontend/Home.
- No worker changes `strk20.json`.
- No private keys, viewing keys, API keys, or connection strings in artifacts or prompts.
- No mock proof promoted to testnet evidence.
- No local green suite promoted to X3.
- No mainnet broadcast.
- Parent reviews every diff before cherry-pick.
- Parent runs combined tests/typecheck/build/diff check after integration.
- Post-integration 0x Alpha red-team is required before claiming convergence.

## Parent exit gate

```text
all selected lane diffs inspected
+ all allowed commits integrated or explicitly blocked
+ combined JS/Cairo/Postgres checks green
+ Foundry/AUDIT/Antagonist reconciliation complete
+ X2/X3 boundaries visible
+ M0 release decision recorded
+ no Phase 8 mutation
= parent closeout state reported honestly
```
