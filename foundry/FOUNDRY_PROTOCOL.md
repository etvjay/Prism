# Foundry Protocol
## Canonical Cross-Foundry Operating System — v0.95

**Status:** Canonical coordination layer  
**Maturity target:** 9.5/10 operational standard  
**Purpose:** Ensure every Foundry has explicit authority, typed handoffs, traceability, change control, and evidence feedback.

---

# 1. Governing Principle

The Foundry system exists to prevent a common failure:

> A downstream implementation decision becomes upstream product truth merely because it was convenient, attractive, or already coded.

The Foundry Protocol therefore defines:

- who has authority over what;
- what each Foundry may consume;
- what it must produce;
- what it may refine;
- what it may not redefine;
- how contradictions are escalated;
- how decisions are reopened;
- how evidence returns upstream;
- how canonical artifacts remain traceable.

---

# 2. Canonical Foundry Chain

```text
Research Foundry
      ↓ evidence
Product Foundry
      ↓ product truth
System Foundry
      ├→ Experience Foundry → Design-to-Product Foundry ┐
      └→ Interface & Ecosystem Foundry                  ├→ Implementation
                                                        ↓
                                                  Evidence / Audit
                                                        ↓
                                                     Research
```

Experience and Interface are parallel projections of System truth.

Design-to-Product consumes Experience truth plus System state contracts.

Implementation consumes accepted specifications from all applicable layers.

---

# 3. Global Authority Hierarchy

Use this precedence whenever two artifacts disagree:

1. **Observed, reproducible external reality**
2. **Canonical Product Truth**
3. **Product invariants, privacy requirements, and trust model**
4. **Canonical domain model and state machines**
5. **System authority, contract, event, and failure specifications**
6. **Canonical experience state mapping and decisive journey**
7. **Canonical capability registry and public interface contracts**
8. **Accepted design system and frontend implementation rules**
9. **Service-specific implementation**
10. **Generated code, documentation, examples, fixtures**

A lower layer cannot silently override a higher layer.

A runtime observation can challenge higher truth but does not automatically rewrite it; it enters the Reopen process.

---

# 4. Universal Artifact Identity

Every canonical artifact should expose:

```yaml
artifact_id: <stable identifier>
artifact_type: <product|system|experience|interface|evidence|...>
version: <semantic or monotonic version>
status: <draft|accepted|canonical|deprecated|superseded>
authority: <owning foundry>
created_at: <timestamp>
updated_at: <timestamp>
supersedes: <artifact_id@version|null>
depends_on:
  - <artifact_id@version>
decision_refs:
  - <decision_id>
evidence_refs:
  - <evidence_id>
```

This prevents “latest file wins” ambiguity.

---

# 5. Universal Handoff Envelope

Every substantial Foundry handoff must contain:

```yaml
handoff_id: HO-...
from_foundry: ...
to_foundry: ...
source_versions:
  - artifact_id@version

protected_decisions:
  - DEC-...

accepted_truth:
  - statement_id: TRUTH-...
    statement: ...
    authority: ...

open_assumptions:
  - ASM-...

known_contradictions:
  - CON-...

allowed_changes:
  - ...

forbidden_changes:
  - ...

required_outputs:
  - ...

acceptance_gates:
  - ...

reopen_conditions:
  - ...

next_evidence_step:
  experiment_id: EXP-...
```

A downstream Foundry must explicitly accept the handoff or raise a contradiction.

---

# 6. Mandatory Handoffs

## 6.1 Research → Product

Required inputs:

```text
Evidence Register
Source Register
Assumption Register
Contradiction Register
Benchmark Map
Falsification Results
Evidence Maturity
```

Research may constrain feasibility and expose reality.

Research may not independently redefine primary user, painful problem, product primitive, or product invariants without routing a Reopen recommendation to Product.

## 6.2 Product → System

Required handoff schema:

```yaml
ProductDefinition:
  primary_user:
  painful_moment:
  desired_outcome:
  core_concept:
  core_primitive:
  decisive_proof:
Actors: []
Assets: []
ProductInvariants: []
NonGoals: []
TrustBoundaries: []
PrivacyRequirements: []
EconomicRequirements: []
ProtectedDecisions: []
AllowedMechanismChanges: []
OpenQuestions: []
```

System may choose mechanisms. System may not alter the primitive or trust model merely to simplify implementation.

## 6.3 System → Experience

Required handoff:

```yaml
DomainObjects: []
StateMachines: []
Commands: []
Queries: []
Events: []
Permissions: []
VisibilityRules: []
OperationLifecycles: []
ErrorCatalogue: []
FreshnessRules: []
AuthoritativeStateRules: []
```

Experience may rename technical states for comprehension. It may not visually represent a state as more complete, private, authorized, or reversible than System truth.

## 6.4 System → Interface & Ecosystem

Required handoff:

```yaml
CanonicalDomainObjects: []
CanonicalCommands: []
CanonicalQueries: []
CanonicalEvents: []
AuthorityRules: []
PrivacyClasses: []
EconomicActions: []
IrreversibleActions: []
IdempotencyRules: []
AsyncLifecycles: []
ErrorSemantics: []
VersionedSchemas: []
```

Interface Foundry may expose or withhold capabilities. It may not manufacture domain capabilities from internal functions.

## 6.5 Experience → Design-to-Product

Required handoff:

```yaml
ExperienceThesis:
CentralObject:
DecisiveJourney:
StatePresentationMap: []
SurfaceMap: []
ProofMoments: []
ProgressiveDisclosureRules: []
InteractionRules: []
MotionSemantics: []
ContentHierarchy: []
ProtectedTerminology: []
```

Design may refine form. Design may not invent fake states, fake metrics, fake proofs, or alternative workflows.

## 6.6 Interface → Implementation

Required handoff:

```yaml
CapabilityRegistryVersion:
OpenAPISpecVersion:
EventCatalogueVersion:
ErrorCatalogueVersion:
AuthorizationScopesVersion:
SDKContractVersion:
MCPManifestVersion:
PaymentAdapterVersion:
ConformanceSuiteVersion:
```

Implementation cannot redefine contract meaning from controller code.

## 6.7 Implementation → Evidence

Required evidence envelope:

```yaml
build_id:
commit_sha:
environment:
spec_versions:
deployments: []
tests: []
runtime_receipts: []
known_deviations: []
observed_failures: []
```

---

# 7. Traceability Chain

Every important externally visible behavior should be traceable:

```text
Problem Truth
   ↓
Product Claim
   ↓
Product Invariant
   ↓
Domain Object / State
   ↓
Command or Query
   ↓
System Enforcement
   ↓
Experience State
   ↓
Capability
   ↓
API / SDK / MCP Projection
   ↓
Test
   ↓
Runtime Evidence
```

Use stable IDs:

```text
CLM-...
INV-...
OBJ-...
CMD-...
QRY-...
EVT-...
CAP-...
API-...
TEST-...
EVD-...
```

A capability with no upstream claim/domain trace should be treated as suspicious. A product claim with no eventual evidence path is not yet operationalized.

---

# 8. Change-Control Protocol

All changes are classified as:

- `CLARIFY` — meaning unchanged; wording/schema description improves.
- `STRENGTHEN` — invariant or validation becomes stricter without invalidating accepted behavior.
- `EXTEND` — adds compatible capability without changing existing semantics.
- `EVOLVE` — changes mechanism or accepted behavior while preserving the primitive/invariants.
- `BREAK` — existing external contract semantics change.
- `REOPEN` — new evidence challenges canonical truth.
- `RECANONICALIZE` — higher-level truth is deliberately changed and propagated.

---

# 9. Change Proposal Schema

```yaml
change_id: CHG-...
class: CLARIFY|STRENGTHEN|EXTEND|EVOLVE|BREAK|REOPEN|RECANONICALIZE
raised_by:
affected_artifacts: []
upstream_authorities: []
problem:
evidence_refs: []
proposed_change:
alternatives: []
compatibility_impact:
migration_required:
security_impact:
privacy_impact:
economic_impact:
reconsideration_conditions:
decision_status:
```

A `REOPEN`, `BREAK`, trust-model change, or product contradiction cannot be accepted by a downstream Foundry alone.

---

# 10. Global Decision Ledger

Every material decision uses:

```yaml
decision_id: DEC-...
layer:
status: proposed|accepted|canonical|superseded|reopened
decision:
reason:
evidence_refs: []
alternatives_rejected: []
assumptions: []
consequences: []
affected_layers: []
compatibility:
migration:
support_obligation:
reopen_conditions: []
owner:
date:
```

Decisions are immutable records; superseding creates a new decision rather than editing history away.

---

# 11. Assumption and Contradiction Discipline

## Assumption

```yaml
assumption_id: ASM-...
statement:
introduced_by:
affected_claims: []
risk:
validation_plan:
deadline:
status:
```

## Contradiction

```yaml
contradiction_id: CON-...
statement_a:
statement_b:
sources:
severity:
affected_layers:
temporary_resolution:
required_authority:
status:
```

No contradiction may be silently “resolved” inside implementation.

---

# 12. Canonicalization Gates

A Foundry may not declare its layer canonical unless:

### Universal gates
- upstream handoff accepted;
- all protected decisions acknowledged;
- contradictions classified;
- assumptions explicitly registered;
- outputs use canonical vocabulary;
- next evidence-producing step exists;
- artifact version recorded.

### System gate
- domain objects defined;
- meaningful state machines complete;
- critical invariants allocated to authorities;
- failure/retry/reconciliation specified.

### Experience gate
- every decisive visible state maps to System truth;
- decisive proof is visible;
- blocked/failure path exists;
- no fake completion or privacy.

### Design gate
- tokens/components/state behavior accepted;
- accessibility and responsive gates defined;
- no production-critical state is mock-only without explicit labeling.

### Interface gate
- capability registry accepted;
- exposure audit complete;
- stable errors and async semantics defined;
- conformance tests derivable.

### Evidence gate
- every PASS cites reproducible evidence;
- maturity level justified;
- deviations recorded.

---

# 13. Project Control Plane

Each project should maintain:

```text
/CANONICAL_STATE.md
/DECISIONS.md
/ASSUMPTIONS.md
/CONTRADICTIONS.md
/EVIDENCE_LEDGER.md
/AUDIT.md
```

Recommended machine-readable companions:

```text
/foundry/domain-model.yaml
/foundry/invariants.yaml
/foundry/state-machines.yaml
/foundry/capabilities.yaml
/foundry/events.yaml
/foundry/errors.yaml
/foundry/traceability.yaml
```

Markdown is the human-readable authority; structured companions make conformance possible.

---

# 14. Drift Detection

Run a Drift Check whenever:

- implementation semantics differ from spec;
- a new feature appears without Product approval;
- UI introduces a state not present in System truth;
- API exposes an internal function directly;
- a privacy claim broadens;
- payment begins affecting authorization;
- examples become fictional representations of unsupported capabilities;
- a sponsor integration starts changing the core product.

Drift severity:

```text
D0 cosmetic
D1 implementation
D2 interface
D3 domain
D4 trust/privacy
D5 product
```

D3–D5 require upstream review.

---

# 15. Evidence Feedback Loop

Evidence is allowed to challenge the Foundry chain.

```text
System assumption
→ implementation observation
→ evidence
→ Research verifies
→ System may Evolve or Product may Reopen
```

The correct response is not to fake the UI or hide the limitation.

---

# 16. Global Slop Tests

Every Foundry should apply:

- **Authority Test** — Who is actually authoritative?
- **Projection Test** — Is this a faithful projection or a new product decision?
- **Reality Test** — Does runtime support the claim?
- **Failure Test** — What happens when dependencies fail?
- **Retry Test** — Can the action be repeated safely?
- **Privacy Test** — Does exposure match the privacy model?
- **Evolution Test** — Can this survive additive change?
- **Evidence Test** — What would prove this?
- **Delete Test** — If this layer disappeared, would the product still mean the same thing?
- **Drift Test** — Did convenience silently alter upstream truth?

---

# 17. Foundry Session Footer

Every substantial Foundry session ends with:

```text
Canonical artifacts updated:
Decisions created:
Decisions superseded:
Assumptions added:
Contradictions added:
Evidence added:
Maturity changes:
Drift detected:
Unresolved questions:
Next evidence-producing step:
```

---

# 18. Protocol Quality Standard

The Foundry Protocol is considered healthy when:

- two independent operators can reach substantially the same downstream interpretation;
- no downstream layer needs hidden conversational context to know protected truth;
- every major external behavior is traceable upstream and downstream;
- contradictions are visible rather than absorbed;
- evidence can force reconsideration without destroying history;
- generated artifacts are projections of canonical models, not replacements for them.

---

**Canonical maxim:**  
**Truth flows down as constraints. Evidence flows up as correction.**
