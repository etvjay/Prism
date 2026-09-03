# Prism — Evidence Ledger
## v0.2

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

## Reconciled baseline disposition

The current Core v1 preparation ceiling is **X2 overall**. Two separately scoped
testnet facets are recorded at X3: `EVD-PRISM-004` (identity create/read/event/scan)
and `EVD-PRISM-014` (Registry V2 plus direct M3 bind/resolve/revoke facts). These
rows do not promote the complete Core v1 release, repeated/reproduced evidence, or
mainnet readiness. `EVD-PRISM-005..007` and all `EVD-STRK20-*` rows remain
`X0` / `NOT_IMPLEMENTED`. The root `strk20.json` remains intentionally empty.

---

| Evidence ID | Claim | Target | Current | Status | Evidence / receipt | Limitation |
|---|---|---:|---:|---|---|---|
| EVD-PRISM-001 | Public Prism sprint repository exists with code | X5 | X5 | PASS | `https://github.com/etvjay/Prism` | proves repository/setup only |
| EVD-PRISM-002 | Prism registration is present in upstream sprint registry | X5 | X5 | PASS | upstream `starkience/strk20-hackathon/registry.json` contains `etvjay/Prism` | does not prove product implementation |
| EVD-PRISM-003 | Root `strk20.json` exists with required shape | X5 | X5 | PASS | repository root | evidence fields still intentionally empty |
| EVD-PRISM-004 | Prism ID can be created/read on Starknet | X5 | X3 | PASS | SN_SEPOLIA `create_identity` tx `0x0457a43d908da21e8acd723ba94639d6009c123ec4c4d944175f2bbfa05e3a6f` succeeded at block `13960873`; `PrismIdentityCreated` event allocated Prism ID `0x1`; `get_identity(0x1)` matched via sncast, PublicNode, and the user-provided Alchemy SN_SEPOLIA endpoint; read-only scan completed to current block; one live factory→Postgres event projection/checkpoint run passed | repeated durable reconciliation, operation receipt tail, and full M1 vertical slice remain open |
| EVD-PRISM-014 | Explicitly deployed Registry V2 identity and direct M3 bind/resolve/revoke facts are observed on SN_SEPOLIA | X3 | X3 | PASS | V2 registry `0x06f77be5c7bdfef252dd322481b4430a587b781df4f79d3b344808d125ec530d`, class `0x4349a331b4339c1f20ccdb745e2d60a194f8da64cb789bb70bf60463f42dd8d`, deployment block `14015842`; fresh `prism:1` tx `0x72c6651c52d1f8b90419da04d0dd27b6b5515e40d68b57504f00ef509696dc0`; direct M3 bind tx `0x65f654fa67b080cbd3789cabe8779377a640d2f79d2818385636196157ba974` at block `14017479`; revoke tx `0x5068e6d21e6df05f0a6e1a9a170422bfcdbfc81b9bcb7c6a4939b8dfb0f2a42` at block `14017549`; receipts/readbacks observed with alternate reads | durable V2 projection, repeated/restart reconciliation, and mainnet evidence remain open |
| EVD-PRISM-005 | Base control proof prevents unauthorized binding | X4 | X0 | NOT_IMPLEMENTED | — | — |
| EVD-PRISM-006 | Active Base binding resolves from Prism ID | X4 | X0 | NOT_IMPLEMENTED | — | — |
| EVD-PRISM-007 | Revoked Base binding no longer resolves while Prism ID persists | X4 | X0 | NOT_IMPLEMENTED | — | decisive identity proof |
| EVD-PRISM-008 | Real Starknet balance displayed accurately | X4 | X0 | NOT_IMPLEMENTED | — | — |
| EVD-PRISM-009 | Real Base balance displayed accurately | X4 | X0 | NOT_IMPLEMENTED | — | — |
| EVD-STRK20-001 | Prism can reach STRK20 pool on SN_MAIN from a supported wallet | X5 | X0 | NOT_IMPLEMENTED | — | G0 smoke; need not be final submission hash |
| EVD-STRK20-002 | Real shielded/private balance can be read intentionally through wallet-mediated consent and shown correctly | X5 | X0 | NOT_IMPLEMENTED | — | do not use balance reads for feature detection |
| EVD-STRK20-003 | Real private transfer succeeds on mainnet with privacy claims matched to observed metadata | X5 | X0 | NOT_IMPLEMENTED | — | may not qualify for final sprint list if it bypasses declared Prism contracts |
| EVD-STRK20-004 | Meaningful Prism-owned pool-integrated helper action succeeds on mainnet | X5 | X0 | NOT_IMPLEMENTED | — | strongest integration-depth candidate |
| EVD-STRK20-005 | At least three final mainnet hashes satisfy pool + own-contract validation | X5 | X0 | NOT_IMPLEMENTED | `strk20.json` empty | required once Prism declares contracts |
| EVD-STRK20-006 | Current hub validator logic independently rechecked against each selected final hash | X5 | X0 | NOT_IMPLEMENTED | upstream `scripts/build-projects.mjs` logic documented | runtime receipts not yet available |
| EVD-PRISM-010 | Public product demo works end-to-end | X5 | X0 | NOT_IMPLEMENTED | — | — |
| EVD-PRISM-011 | 3-minute demo video published | X5 | X0 | NOT_IMPLEMENTED | — | — |
| EVD-PRISM-012 | Wallet capability phase is locally buildable without private-state access | X2 | X2 | PASS | commit `6f6a138`; local TypeScript check, production build, and diff check pass | Ready-wallet observation, reconnect observation, and G0 remain open |
| EVD-PRISM-013 | Canonical landing and truthful testnet Home shell compile, render, and pass responsive visual review without fabricated user state | X3 | X2 | PASS | implementation commit `d0c27ed`; TypeScript, Next production build, server-render assertions, desktop 1363×936 review, mobile 390×844 review, CTA/Home-state interaction, console/overlay and overflow checks pass | public deployment and real-wallet observation remain open |

---

# Current Research Evidence

## EVD-RSCH-STRK20-001 — Current normal-dapp route

**Status:** PASS / source-level evidence

```text
get-starknet 6.0.3
starknet.js 10.4.0 / WalletAccountV6
Wallet API 0.10.3
privacy-enabled wallet
```

This establishes the planned route; it does not prove Prism's implementation works.

The current implementation treats Wallet API/spec version `0.10.3` as the minimum supported STRK20 capability threshold and records the observed network separately from the configured target.

## EVD-RSCH-STRK20-002 — Hub own-contract validation

**Status:** PASS / source-level evidence

Current upstream `scripts/build-projects.mjs` verifies each submitted hash for:

```text
mainnet existence
successful execution
STRK20 pool event
and, when project contracts are declared,
project-contract involvement by event or calldata
```

This evidence governs selection of final `strk20.json.transactions`.

## EVD-RSCH-STRK20-003 — Shadow-account route split

**Status:** PASS / source-level evidence

SDK release-candidate changelog shows SDK-side shadow-account functionality, while the referenced consumer Wallet API route remains unavailable. This supports exclusion from the sprint-critical MVP without claiming the SDK mechanism is absent.

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
hub_validator:
  ok:
  pool:
  mine:
claim_scope:
limitations:
independent_verification:
maturity:
```

---

# Mainnet Receipt Rule

For every final STRK20 submission transaction record:

```text
network = SN_MAIN
transaction hash (exact 32-byte value; distinct from the other two)
success status
block
STRK20 pool event
Prism contract involvement if contracts are declared
build commit
user/demo flow
privacy property actually evidenced
independent provider/explorer read
strk20.json inclusion only after separate authorization
```

The release packet must carry exactly three distinct final submission hashes. A repeated
hash is one observation, not three submissions, even if the hub validator returns the same
result. Record receipt and independent-read evidence before any ledger promotion.
```text
ok   = true
pool = true
mine = true
```

A transaction hash is evidence that an action occurred. It is not by itself proof of every privacy property claimed about that action.

---

# Preparatory vs Submission Evidence

Keep separate:

```text
Preparatory mainnet evidence
  e.g. ordinary shield proving wallet/pool reachability

Final sprint evidence
  ≥3 transactions satisfying all hub checks
```

The preparatory hash remains useful even when it is not eligible for the final list.

---

# Next Evidence Gap

**EVD-STRK20-001 — mainnet pool reachability.**

Close G0 with the smallest safe real mainnet interaction, then immediately begin the project-owned helper path needed for final qualifying receipts.
