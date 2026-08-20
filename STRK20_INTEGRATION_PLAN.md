# Prism — STRK20 Integration Plan
## v0.1 · 2026-08-20

**Status:** Ready for explicit implementation approval; implementation evidence pending  
**Route:** Privacy Wallet API for user flows + Prism-owned pool-integrated application contract for meaningful private action and final sprint evidence

> This file is the plan boundary required by the current `starkience/strk20-agent-skills` integration skill. STRK20 app-code execution starts only after explicit approval of this plan. Prism's broader non-STRK20 work remains governed by the Foundry control plane.

---

# 1. Integration problem

Current repository reality:

- Prism has a Next.js 16 / React 19 / TypeScript frontend shell, but no wallet connection is wired yet.
- The app currently communicates the product thesis but does not execute STRK20 actions.
- Prism needs real private Starknet financial state without ever handling a user's viewing key.
- The sprint requires at least three successful SN_MAIN hashes that touch the STRK20 pool.
- Once Prism declares contracts, the current hub validator requires **every submitted hash** to also involve declared Prism code.
- A generic private swap is not automatically a good Prism contract idea because first-party private routes such as AVNU already exist; the Prism-owned contract should express a Prism-native product action.

---

# 2. Current repo snapshot

## Frontend

```text
src/app/layout.tsx
src/app/page.tsx
src/app/globals.css
```

Current `page.tsx` is product-positioning only.

## Current package pins

```text
Next.js                                   ^16.0.8
React                                     19.2.1
starknet.js                               10.4.0
get-starknet discovery                    6.0.3
get-starknet wallet standard              6.0.3
@starknet-io/types-js                     0.10.3
zustand                                   ^5.0.9
```

## Contracts

No Prism Cairo contract tree is currently evidenced in the repository.

## Evidence

```text
strk20.json exists
transactions = []
contracts = []
```

No qualifying SN_MAIN receipt has yet been earned.

---

# 3. Selected route

## User-facing STRK20 actions

```text
Prism dapp
→ get-starknet
→ WalletAccountV6 / starknet.js
→ Privacy Wallet API
→ privacy-enabled wallet
→ STRK20 pool
```

The wallet owns:

```text
registration
viewing key
private notes
proof generation
supported STRK20 execution
```

Prism owns:

```text
capability detection
product state
user intent
transaction lifecycle UX
privacy truth labels
receipts/evidence
application-specific Cairo contracts
```

## Direct SDK

Not required for the normal consumer path.

Use only for controlled development/testing or a later Prism-owned-key service where the authority model explicitly permits it.

## Shadow Accounts

Not an MVP dependency. The SDK route has release-candidate Shadow Account support; the wallet-mediated route Prism uses does not currently expose equivalent functionality.

---

# 4. Privacy constraints

## Shield

Public:

```text
depositor
token
amount
timing
```

Do not call the deposit itself anonymous/private.

## Private transfer

Protected in the supported note-to-note flow:

```text
sender
recipient
amount
token type
```

## Private application / DeFi action

Expected protected property:

```text
direct user identity behind public action
```

Potentially visible:

```text
amount
timing
target application/protocol
open-note amount
```

## Base

Base remains public in v0.

---

# 5. UX constraints from current upstream implementation

## Capability detection

Use a wallet/spec version query. Do not read balances merely to feature-detect STRK20 support.

## Shield is two transactions

```text
1. ERC-20 approval
2. pool deposit
```

The UI must label both steps.

## Note maturity

Fresh notes normally require roughly ten blocks before later spending.

Represent:

```text
Shielding
→ Confirmed
→ Maturing
→ Private balance available
```

Do not falsely show immediately spendable private capital.

## Composition tradeoff

A deposit and transfer can be composed for UX, but the public deposit leg creates strong depositor/amount correlation with the private action.

Default Prism behavior should favor:

```text
shield first
→ maturity
→ private action later
```

unless the user deliberately accepts the correlation tradeoff.

## Pool fee

Read `get_fee_amount`; do not hard-code.

Fee-aware UX must affect:

```text
MAX
minimum useful amounts
previews
batching
```

## Relayers

Do not infer user activity from transaction sender. Use canonical pool/application events and operation records.

---

# 6. Phase plan

## Phase 0 — Research recanonicalization ✅ done 2026-08-20

Completed:

- current sprint rules re-read;
- current hub transaction validator inspected;
- current Starkience agent skill read;
- current Privacy SDK changelog read;
- starter kit / Awesome STRK20 refreshed;
- get-starknet pin updated to 6.0.3;
- privacy and evidence profiles recanonicalized.

## Phase 1 — Wallet connection + capability state

Build:

```text
src/features/wallet/
src/features/privacy/
```

or equivalent repo-native modules.

Requirements:

- discover/connect Starknet wallet with get-starknet 6.0.3;
- construct supported WalletAccountV6 path using the current starknet.js guide;
- detect Wallet API capability through version query;
- never use balance read as feature detection;
- supported state;
- unsupported-wallet state;
- disconnected state;
- explicit `SN_MAIN` / environment state.

Frontend proof:

```text
Connect wallet
→ Privacy available / unsupported
```

Headless gate:

```text
npm install
npm run typecheck
npm run build
```

Manual gate:

- Ready extension connects;
- non-private wallet degrades without throwing;
- no balance-consent prompt appears just from capability detection.

## Phase 2 — Shield + private balance

Build:

- token selection for the minimal sprint asset;
- fee read;
- two-step approval/deposit operation lifecycle;
- real private-balance read through deliberate wallet consent;
- note-maturity state;
- receipt/explorer state.

Frontend states:

```text
Ready
→ Approve token
→ Deposit submitted
→ Deposit confirmed
→ Note maturing
→ Private balance available
```

Manual gate:

- small real test amount;
- public deposit metadata documented;
- fee correctly handled;
- balance survives refresh/reconnect as supported by wallet behavior.

## Phase 3 — Private transfer

Build:

- recipient validation/registration-compatible flow;
- amount + fee preview;
- private transfer request;
- explicit submitted/confirming/complete lifecycle;
- activity receipt without using tx sender as user identity.

Privacy test:

- transaction should not publicly expose ordinary sender/recipient/amount transfer metadata;
- document exactly what remains visible.

## Phase 4 — Prism identity vertical slice

In parallel with STRK20 frontend work, implement the smallest `PrismIdentityRegistry`:

```text
create_identity
read identity
bind execution identity
revoke binding
resolve active binding
```

Required proof:

```text
create P
→ bind Base B
→ resolve(P, BASE) = B
→ revoke B
→ resolution fails
→ P persists
```

This contract expresses Prism's core product but does not by itself satisfy STRK20 transaction evidence.

## Phase 5 — Prism-owned STRK20 application contract

Do not begin from “we need an anonymizer.” Begin from a Prism-native outcome.

Mechanism criteria:

```text
meaningful to Prism Home / private capital coordination
uses STRK20 pool correctly
has a real lifecycle, not echo/no-op
small enough to review/test within sprint
can generate ≥3 genuine pool transactions involving Prism code
has honest privacy properties
```

First candidate to spike:

> **Private capital allocation from the Prism Home**, using a small Prism-owned anonymizer derived from the closest current public reference (for example, the Vesu lending anonymizer if current Vesu integration remains valid).

Candidate lifecycle:

```text
allocate private capital
→ show resulting private/open state
→ unwind allocation
→ show private capital returned
```

Before committing to this candidate:

1. inspect the current reference Cairo package;
2. verify target protocol deployment/API;
3. check whether it already has a maintained first-party STRK20 route;
4. compare complexity against another Prism-native helper action;
5. choose the smallest action that strengthens the product rather than merely satisfying scoring.

Cairo ownership:

```text
Prism writes/reviews/tests/audits/deploys the contract.
The STRK20 agent skill does not generate production Cairo.
```

Required tests:

- success path;
- invalid caller/context path;
- token/amount bounds;
- revert → atomic rollback;
- correct return to pool;
- emitted evidence/event semantics;
- no unintended authority bypass.

## Phase 6 — Final SN_MAIN evidence

### G0 smoke test

First run a low-value live pool action. Record it in `projects/prism/EVIDENCE_LEDGER.md`.

G0 closes reachability risk even if the hash will not be submitted.

### Final scoring hashes

After Prism contracts are declared, select only hashes that satisfy:

```text
SUCCEEDED
AND receipt has event from canonical STRK20 pool
AND transaction involves a declared Prism contract
```

Target:

```text
Tx A — real Prism private application action
Tx B — real reverse/second lifecycle action through Prism helper
Tx C — another meaningful pool action through Prism helper
```

Run the same logic as the upstream hub before writing any hash to `strk20.json`.

## Phase 7 — Product integration

Unify:

```text
Prism ID
public venue balances
Private Balance
Send
Receive
Connections
Activity / receipts
```

The Home surface must communicate financial state before architecture.

No fake balances or fictional transactions in the final demo path.

## Phase 8 — Release

Required:

```text
public demo
3-minute video
README build/run instructions
contract addresses
≥3 validated final hashes
complete strk20.json
privacy wording audit
no secrets committed
```

---

# 7. Evidence plan

Track claims in:

```text
projects/prism/EVIDENCE_LEDGER.md
projects/prism/AUDIT.md
profiles/STARKNET_MAINNET_EVIDENCE_PROFILE.md
```

For each mainnet candidate:

```yaml
network: SN_MAIN
hash:
status:
pool_event: true|false
prism_contract_involved: true|false
operation:
build_commit:
public_metadata:
privacy_claim_supported:
limitations:
strk20_json_included: false
```

Only set `strk20_json_included: true` after final validator-equivalent verification.

---

# 8. Current blockers requiring human wallet action

The code and contract implementation can proceed without secret material.

The following cannot be truthfully completed without a funded privacy-enabled wallet and user authorization:

```text
G0 SN_MAIN transaction
real shield
real private balance consent/read
real private transfer
final mainnet evidence actions
```

No private key or viewing key should ever be pasted into the repository or chat workflow.

---

# 9. Next step after approval

```text
Phase 1 wallet/capability vertical slice
+
Phase 4 minimal PrismIdentityRegistry scaffold
```

Then perform G0 as soon as the user-controlled wallet is ready, without waiting for the entire product.
