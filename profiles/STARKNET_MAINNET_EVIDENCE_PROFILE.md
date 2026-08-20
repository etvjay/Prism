# Starknet Mainnet Evidence Profile

**Profile type:** Evidence & Audit Foundry specialization  
**Project:** Prism  
**Sprint:** STRK20 Private Sprint  
**Last validator audit:** 2026-08-20

## Purpose

Turn hackathon submission hashes into a reproducible evidence set that matches the hub's actual validation logic.

## Canonical pool

```text
SN_MAIN
0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
```

## What the hub actually validates

For each transaction listed in root `strk20.json`, the current upstream `scripts/build-projects.mjs` checks:

```text
1. hash is a valid Starknet transaction hash
2. transaction exists on mainnet
3. execution_status == SUCCEEDED
4. receipt contains an event from the STRK20 pool
5. if the project declares one or more contracts, the transaction must also involve
   at least one declared project contract
```

Project-contract involvement is accepted when either:

- a receipt event originates from a declared project contract; or
- a declared project contract address appears in the transaction calldata.

Therefore:

> **Once Prism declares contracts, every final submission transaction must touch the STRK20 pool and involve at least one declared Prism contract.**

This is not merely a documentation preference; it is current hub-validator behavior.

## G0 vs final submission evidence

A simple shield/deposit is still the correct first mainnet smoke test because it proves wallet and pool reachability.

However, if it does not involve a declared Prism contract:

```text
G0 evidence         = valid engineering evidence
final strk20.json   = do not use that hash after contracts are declared
```

Keep those concepts separate.

## Prism evidence strategy

Prism intends to deploy contracts, including its identity registry and a project-owned STRK20 application helper/anonymizer.

The identity registry alone does not make an STRK20 transaction qualify because identity-registry operations do not inherently touch the privacy pool.

The final three qualifying receipts should therefore be generated through a Prism-owned STRK20 helper/anonymizer.

Preferred evidence shape:

```text
Preparatory G0
  small shield / pool reachability
  → ledger evidence only unless it also traverses Prism code

Final Tx A
  pool → Prism helper → meaningful private application action

Final Tx B
  pool → Prism helper → second real application action / reverse lifecycle

Final Tx C
  pool → Prism helper → another meaningful application action
```

Avoid three artificial copies of the same no-op purely for count.

## Current candidate: Prism private allocation / Vesu path

A strong product-aligned candidate is a small Prism-owned anonymizer derived from the public Vesu lending reference, surfaced to the user as private capital allocation from the Prism financial Home.

Potential evidence lifecycle:

```text
A. private allocation / deposit through Prism helper
B. private unwind / withdraw through Prism helper
C. second allocation or distinct supported helper action through Prism helper
```

This remains an implementation proposal until the Cairo reference and current Vesu integration are inspected and tested. Do not treat it as canonical merely because it fits the evidence requirement.

Before custom Cairo implementation, verify whether the target protocol already provides a first-party STRK20 private route. If a first-party route is used instead, separately re-evaluate how the sprint's own-contract validator will be satisfied.

## Evidence record

For every candidate receipt record:

```yaml
evidence_id: EVD-STRK20-...
claim:
build_commit:
environment: SN_MAIN
transaction_hash:
transaction_status:
block:
strk20_pool:
touches_pool: true|false
project_contract_required: true|false
project_contracts_involved: []
hub_validator:
  ok: true|false
  pool: true|false
  mine: true|false
operation_type:
user_visible_flow:
public_metadata_observed: []
privacy_claims_supported: []
privacy_claims_not_made: []
reproduction_notes:
independent_links: []
strk20_json_included: true|false
```

## Submission-contract rule

If `strk20.json.contracts` is non-empty, do not add a transaction to `strk20.json.transactions` until we have independently checked:

```text
receipt succeeded
pool event exists
own declared contract event OR address in calldata
```

## Privacy evidence rule

A transaction hash proves that an onchain operation occurred. It does not prove every privacy property.

For each privacy claim separately document:

```text
observer
hidden datum
visible datum
linkability assumptions
amount/timing leakage
open-note visibility if relevant
```

## Build traceability

Every final mainnet item maps:

```text
Product claim
→ invariant/capability
→ implementation commit
→ deployed contract/version
→ transaction
→ pool event
→ Prism-contract involvement
→ user-visible result
→ demo step
```

## Regression rule

If a declared contract, wallet integration, helper ABI, or privacy route materially changes after evidence is collected, mark affected evidence stale and re-run before submission.

## Final release gate

```text
[ ] ≥3 qualifying hashes
[ ] all hashes SN_MAIN
[ ] all succeeded
[ ] all contain STRK20 pool event
[ ] if contracts are declared, every hash involves ≥1 declared Prism contract
[ ] all selected hashes independently rechecked against current hub logic
[ ] hashes included in strk20.json
[ ] every deployed/required project address accurately listed in contracts
[ ] demo video maps claims to real evidence
[ ] public demo works
[ ] privacy wording audited
```
