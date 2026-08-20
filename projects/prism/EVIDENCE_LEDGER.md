# Prism — Evidence Ledger
## v0.1

Evidence maturity:

```text
X0 hypothesis
X1 fixture/mock
X2 local controlled
X3 realistic/testnet
X4 repeated/reproduced
X5 mainnet/production independently verifiable
```

Only evidence matching the current implementation/spec version counts as current.

---

| Evidence ID | Claim | Target | Current | Status | Evidence / receipt | Limitation |
|---|---|---:|---:|---|---|---|
| EVD-PRISM-001 | Public Prism sprint repository exists with code | X5 | X5 | PASS | `https://github.com/etvjay/Prism` | proves repository/setup only |
| EVD-PRISM-002 | STRK20 sprint registration PR opened | X5 | X5 | PASS | `starkience/strk20-hackathon#136` | merge/acceptance is upstream-controlled |
| EVD-PRISM-003 | Root `strk20.json` exists with required shape | X5 | X5 | PASS | repository root | fields still intentionally empty |
| EVD-PRISM-004 | Prism ID can be created/read on Starknet | X5 | X0 | NOT_IMPLEMENTED | — | — |
| EVD-PRISM-005 | Base control proof prevents unauthorized binding | X4 | X0 | NOT_IMPLEMENTED | — | — |
| EVD-PRISM-006 | Active Base binding resolves from Prism ID | X4 | X0 | NOT_IMPLEMENTED | — | — |
| EVD-PRISM-007 | Revoked Base binding no longer resolves while Prism ID persists | X4 | X0 | NOT_IMPLEMENTED | — | decisive identity proof |
| EVD-PRISM-008 | Real Starknet balance displayed accurately | X4 | X0 | NOT_IMPLEMENTED | — | — |
| EVD-PRISM-009 | Real Base balance displayed accurately | X4 | X0 | NOT_IMPLEMENTED | — | — |
| EVD-STRK20-001 | Prism can reach STRK20 pool on SN_MAIN | X5 | X0 | NOT_IMPLEMENTED | — | first technical gate |
| EVD-STRK20-002 | Real shield/private balance can be reconstructed in product | X5 | X0 | NOT_IMPLEMENTED | — | — |
| EVD-STRK20-003 | Real private transfer succeeds on mainnet | X5 | X0 | NOT_IMPLEMENTED | — | qualifying sprint receipt candidate |
| EVD-STRK20-004 | Meaningful Prism `privacy_invoke` action succeeds on mainnet | X5 | X0 | NOT_IMPLEMENTED | — | strongest integration-depth receipt |
| EVD-STRK20-005 | At least three qualifying pool-touching mainnet tx hashes recorded | X5 | X0 | NOT_IMPLEMENTED | `strk20.json` empty | submission requirement |
| EVD-PRISM-010 | Public product demo works end-to-end | X5 | X0 | NOT_IMPLEMENTED | — | — |
| EVD-PRISM-011 | 3-minute demo video published | X5 | X0 | NOT_IMPLEMENTED | — | — |

---

# Evidence Record Template

```yaml
evidence_id: EVD-...
claim:
environment:
build:
  commit_sha:
spec_versions: []
observed_at:
procedure:
inputs:
result:
transaction:
  network:
  hash:
  block:
  status:
contracts: []
claim_scope:
limitations:
independent_verification:
maturity:
```

---

# Mainnet Receipt Rule

For each STRK20 submission transaction, record at minimum:

```text
network = SN_MAIN
transaction hash
success status
block
STRK20 pool involvement
Prism contract involvement where applicable
build commit
user/demo flow
privacy property actually evidenced
strk20.json inclusion
```

A transaction hash is evidence that an action occurred. It is not by itself proof of every privacy property claimed about that action.

---

# Next Evidence Gap

**EVD-STRK20-001 — mainnet pool reachability.**

This should be closed before substantial private-feature expansion.
