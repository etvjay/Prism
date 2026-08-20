# Evidence & Audit Foundry
## Claim Traceability, Runtime Proof, Conformance, Drift, and Recanonicalization Engine — v0.95

**Core question:** What do we actually know the built system can do, under what conditions, and how strongly can we prove it?

**Maturity target:** 9.5/10 operational standard

---

# 1. Mandate

The Evidence & Audit Foundry is the return path from implementation to truth.

It owns:

- claim traceability;
- evidence maturity;
- runtime proof;
- conformance evidence;
- production/mainnet receipts;
- regression detection;
- security evidence;
- privacy-claim verification;
- integration evidence;
- operational evidence;
- drift classification;
- reopen recommendations.

It never marks a claim PASS because “the demo worked once.”

---

# 2. Canonical Traceability Chain

Every critical claim should link:

```text
Product Claim
   ↓
Product Invariant
   ↓
System Invariant
   ↓
Domain Object / State
   ↓
Command / Query / Event
   ↓
Enforcement Layer
   ↓
Interface Capability
   ↓
Test
   ↓
Runtime Evidence
   ↓
Audit Verdict
```

Stable references:

```text
CLM
INV
OBJ
SM
CMD
QRY
EVT
CAP
API
TEST
EVD
```

Missing links reduce confidence.

---

# 3. Claim Record

```yaml
claim_id: CLM-...
statement:
authority:
scope:
assumptions: []
invariant_refs: []
system_refs: []
capability_refs: []
target_evidence_level:
risk_if_false:
current_status:
```

Claims must be falsifiable enough to test.

---

# 4. Evidence Record

```yaml
evidence_id: EVD-...
claim_refs: []
type:
environment:
observed_at:
build_id:
commit_sha:
spec_versions: []
source:
procedure:
inputs:
result:
raw_artifact:
reproduction_steps:
independent_verification:
limitations:
expires_or_stales_at:
reviewer:
```

Evidence should survive beyond a chat transcript.

---

# 5. Evidence Types

Examples:

```text
SOURCE_FACT
LOCAL_TEST
PROPERTY_TEST
CONTRACT_TEST
SECURITY_TEST
INTEGRATION_TEST
E2E_RUN
DEPLOYMENT
CHAIN_RECEIPT
WEBHOOK_RECEIPT
TRACE
METRIC
SCREEN_RECORDING
USER_OBSERVATION
CONFORMANCE_REPORT
AUDIT_FINDING
```

Not all types have equal strength.

---

# 6. Evidence Maturity

| Level | Standard |
|---|---|
| `X0` | hypothesis / no implementation evidence |
| `X1` | fixture/mock demonstrates shape only |
| `X2` | controlled local implementation |
| `X3` | realistic environment/testnet/external dependency |
| `X4` | repeated/reproduced under multiple runs/accounts/failure paths |
| `X5` | production/mainnet/publicly or independently verifiable evidence |

A claim can regress from X5 if the evidence becomes stale after incompatible changes.

---

# 7. Evidence Sufficiency Dimensions

Maturity alone is insufficient.

Score each critical claim on:

```text
Correctness
Reproducibility
Independence
Freshness
Coverage
Adversarial Strength
Environment Fidelity
Traceability
```

A mainnet transaction can prove execution occurred without proving the full privacy claim.

---

# 8. Audit Status

Item statuses:

```text
PASS
FAIL
NOT_IMPLEMENTED
BLOCKED
DEGRADED
STALE_EVIDENCE
```

Overall:

```text
PASS
PASS_WITH_LIMITATIONS
INSUFFICIENT_EVIDENCE
RESEARCH_REQUIRES_REFRAMING
RECANONICALIZATION_REQUIRED
```

---

# 9. PASS Standard

A critical claim is `PASS` only when:

```text
[ ] claim is precise
[ ] assumptions are registered
[ ] enforcement is identified
[ ] tests exist
[ ] evidence exists
[ ] evidence reproduces
[ ] relevant failure/adversarial path tested
[ ] current implementation version matches evidence
[ ] limitations are disclosed
```

---

# 10. Runtime Evidence Envelope

Every release/build should publish:

```yaml
build_id:
commit_sha:
environment:
deployed_versions:
spec_versions:
tests:
deployments:
runtime_receipts:
known_failures:
known_deviations:
reconciliation_status:
observability_links:
```

---

# 11. Conformance Audit

## System conformance

- state transition legality;
- invariant enforcement;
- authority;
- idempotency;
- concurrency;
- error semantics;
- async lifecycle;
- reconciliation.

## Interface conformance

- schemas;
- auth;
- object auth;
- pagination;
- rate/error contracts;
- event signatures;
- replay;
- SDK/API parity;
- MCP capability parity;
- payment binding.

## Experience conformance

- System state ↔ visible state;
- no premature completion;
- blocked reason accuracy;
- privacy copy accuracy;
- proof moment uses real data where required.

## Design conformance

- token usage;
- accessibility;
- responsive;
- performance;
- live/mock labeling.

---

# 12. Security Evidence

Security claims require more than functional success.

For each critical authority/economic invariant:

```text
positive test
negative test
replay test
stale-state test
cross-object authorization test
malformed-input test
dependency-failure test
```

Where applicable:

```text
fuzzing
property testing
static analysis
independent review
```

---

# 13. Privacy Claim Audit

Every privacy statement decomposes into:

```text
observer
protected datum
visibility condition
linkability
timing leakage
amount leakage
metadata leakage
operator visibility
public-chain visibility
```

Example:

> “Private transfer”

must answer:

```text
Private from whom?
Which fields?
Under what route?
What metadata remains?
```

Marketing copy receives the same privacy audit as code.

---

# 14. Economic Evidence

For value-moving systems, verify:

- exact asset;
- amount/decimals;
- fee;
- recipient;
- finality;
- double-execution protection;
- refund/compensation;
- accounting reconciliation.

A UI receipt alone is not economic evidence.

---

# 15. Failure Evidence

Do not only collect success evidence.

Required for decisive workflows:

```text
permission failure
invalid input
stale state
dependency outage
duplicate retry
timeout
revert
indexer lag
restart/recovery
```

A system whose failure behavior has never been exercised remains lower maturity.

---

# 16. Reconciliation Evidence

Prove the system repairs divergence.

Examples:

```text
confirmed chain tx missing from DB
duplicate event delivery
worker restart mid-operation
indexer lag
reverted transaction
```

Record before/after state and repair action.

---

# 17. Drift Audit

Compare implementation against canonical artifacts.

Drift classes:

```text
D0 visual/cosmetic
D1 implementation detail
D2 public interface
D3 domain/state
D4 authority/privacy/trust
D5 product primitive/user/problem
```

D3+ must produce a change proposal.

D4–D5 may require Reopen/Recanonicalize.

---

# 18. Regression Model

Every accepted claim gets a regression trigger.

Examples:

- contract version changed;
- API schema changed;
- signer/auth provider changed;
- privacy dependency changed;
- SDK major version changed;
- UI state machine changed.

Relevant evidence is marked:

```text
CURRENT
STALE
INVALIDATED
```

---

# 19. Reopen Recommendation

Use:

```yaml
reopen_id:
triggering_evidence:
canonical_decision_ref:
severity:
what_was_falsified:
affected_layers:
options:
recommended_authority:
temporary_safety_action:
```

Evidence may recommend reopening.

Evidence Foundry does not silently rewrite Product truth.

---

# 20. Evidence Ledger

```markdown
| Claim | Target | Current | Status | Evidence | Build | Last verified | Limitation |
```

For machine processing, mirror as structured data.

---

# 21. Release Evidence Gate

A release is evidence-complete only when:

```text
[ ] build/spec versions recorded
[ ] decisive claims mapped
[ ] critical invariants tested
[ ] conformance suite passes
[ ] decisive workflow E2E passes
[ ] negative/failure paths exercised
[ ] deployed artifacts recorded
[ ] economic receipts reconciled where relevant
[ ] privacy claims audited
[ ] known limitations published
[ ] stale evidence identified
[ ] production rollback/recovery evidence available where required
```

---

# 22. Evidence Quality Anti-Slop

Reject:

- screenshots as sole proof of backend behavior;
- a single happy-path run as reliability proof;
- testnet evidence presented as mainnet;
- mocks presented as integration;
- transaction hash presented as proof of hidden properties it cannot demonstrate;
- claims with no reproduction steps;
- PASS without limitations;
- old evidence reused after incompatible changes;
- “audited” meaning self-reviewed only;
- security inferred from absence of observed exploit.

---

# 23. Audit Tests

### Claim Test
Is the claim precise and falsifiable?

### Traceability Test
Can it be followed from Product → runtime?

### Reproduction Test
Can another operator reproduce it?

### Independence Test
Can it be verified outside the system's own UI?

### Failure Test
Has the negative path been exercised?

### Adversarial Test
Was authority/replay/privacy challenged?

### Freshness Test
Does evidence still match current build?

### Coverage Test
Does evidence prove the full claim, not a subset?

### Drift Test
Did implementation change meaning?

---

# 24. Evidence Canonicalization Gate

```text
[ ] critical claims registered
[ ] evidence linked to build/spec version
[ ] maturity levels justified
[ ] limitations stated
[ ] stale evidence identified
[ ] conformance results captured
[ ] security/privacy evidence captured where relevant
[ ] failure evidence captured
[ ] drift classified
[ ] reopen recommendations routed
[ ] next evidence gap prioritized
```

---

# 25. Command Modes

- `Evidence Handoff Audit`
- `Claim Map`
- `Evidence Ledger`
- `Runtime Truth`
- `Conformance Audit`
- `Security Evidence`
- `Privacy Claim Audit`
- `Economic Evidence`
- `Failure Evidence`
- `Reconciliation Evidence`
- `Mainnet Evidence`
- `Regression Audit`
- `Drift Check`
- `Reopen Recommendation`
- `Canonicalize Evidence`

---

# 26. Session Output

```text
Evidence version:
Claims evaluated:
PASS:
FAIL:
BLOCKED:
Maturity upgrades:
Maturity regressions:
Stale evidence:
Drift:
Security/privacy findings:
Reopen recommendations:
Highest-risk evidence gap:
Next experiment:
```

---

**Evidence Foundry maxim:**  
**A claim is only as strong as the evidence that proves the exact thing being claimed.**
