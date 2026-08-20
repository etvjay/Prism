# Starknet Mainnet Evidence Profile

**Profile type:** Evidence & Audit Foundry specialization  
**Project:** Prism  
**Sprint:** STRK20 Private Sprint

## Purpose

Turn hackathon submission hashes into a real evidence ledger rather than a loose list of transactions.

## Required sprint evidence

Final `strk20.json` must contain at least three successful Starknet mainnet transaction hashes that touched the STRK20 pool.

Pool:

```text
0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
```

## Evidence record

For each qualifying action record:

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
prism_contracts: []
operation_type:
user_visible_flow:
public_metadata_observed: []
privacy_claims_supported: []
privacy_claims_not_made: []
reproduction_notes:
independent_links: []
strk20_json_included: true|false
```

## Suggested three-transaction proof set

1. A shield/deposit or other qualifying pool onboarding action.
2. A real private transfer/pool private action.
3. A meaningful Prism `privacy_invoke` application action through a deployed Prism helper contract if available.

Prefer evidence that demonstrates integration depth, not three nearly identical calls made only to satisfy transaction count.

## Privacy evidence rule

A transaction hash proves that an onchain operation occurred. It does not, by itself, prove every claimed privacy property.

For each privacy claim separately document:

```text
observer
hidden datum
visible datum
linkability assumptions
amount/timing leakage
```

## Build traceability

Every mainnet evidence item should map:

```text
Product claim
→ invariant/capability
→ implementation commit
→ deployed contract/version
→ transaction
→ event/result
→ demo step
```

## Regression rule

If contract, wallet integration, or privacy route materially changes after evidence is collected, mark affected evidence stale and re-run before final submission.

## Final release gate

```text
[ ] ≥3 qualifying hashes
[ ] all hashes SN_MAIN
[ ] all succeeded
[ ] all touch STRK20 pool
[ ] project contract involvement recorded where relevant
[ ] hashes included in strk20.json
[ ] contract addresses included
[ ] demo video mapped to real evidence
[ ] public demo works
[ ] privacy wording audited
```
