# Experience Foundry
## Truth-Preserving Narrative, State, Journey, and Proof Engine — v0.95

**Core question:** How should a human understand, trust, and operate the real system without learning unnecessary implementation detail?

**Maturity target:** 9.5/10 operational standard

---

# 1. Mandate

The Experience Foundry translates canonical Product and System truth into a coherent human experience.

It owns:

- experience thesis;
- human/system narrative;
- central object;
- decisive journey;
- state presentation;
- information architecture;
- progressive disclosure;
- proof moments;
- interaction semantics;
- blocked/failure/recovery states;
- landing-to-product continuity.

It may simplify technical language.

It may **not** simplify system truth into false certainty.

---

# 2. Required Handoff

Experience cannot canonicalize until it receives:

```text
Product primitive
Product invariants
Non-goals
Trust/privacy model
Domain objects
State machines
Commands
Queries
Events
Permissions
Visibility rules
Operation lifecycle
Error catalogue
Authoritative-state rules
```

If these are incomplete, Experience may prototype but must mark assumptions.

---

# 3. Experience Truth Contract

Every major user-facing statement must be classifiable as:

```text
AUTHORITATIVE_STATE
DERIVED_STATE
ESTIMATE
PREDICTION
PENDING_OPERATION
EXPLANATION
MARKETING_CLAIM
```

The interface should visually distinguish materially different truth classes.

Example:

```text
Confirmed
```

is not interchangeable with:

```text
Submitted
```

or:

```text
Estimated
```

---

# 4. System-to-Experience State Map

Every decisive visible state must map to canonical System state.

```yaml
state_map_id: UXSTATE-...
system_object:
system_state:
authoritative_source:
user_facing_label:
user_explanation:
available_actions:
blocked_actions:
freshness_display:
privacy_display:
proof_available:
```

Example:

```text
Binding.status = pending_verification
→ "Verify Base account"
→ action: Sign verification
→ not: "Connected"
```

No orphan experience state is allowed in the decisive workflow.

---

# 5. Experience Thesis

Complete:

> **The user should feel as though they are [meaningful metaphor/action] while actually performing [real workflow].**

A valid metaphor must:

- explain the product primitive;
- help predict interaction;
- survive operational screens;
- not require decorative illustration to make sense.

Define:

```text
emotional starting state
emotional ending state
intellectual shift
confidence gained
primary action confidence
```

---

# 6. Narrative Architecture

## Human narrative

```text
Tension
→ Intervention
→ Control
→ Proof
→ Confidence
```

## System narrative

```text
Object
→ State
→ Authorized action
→ Transition
→ Evidence
```

The human narrative must never contradict the system narrative.

---

# 7. Native Object Contract

Every central product object receives:

```yaml
object_ref:
experience_name:
purpose:
owner:
states:
primary_actions:
secondary_actions:
relationships:
permissions:
visible_fields:
hidden_fields:
evidence:
visual_role:
interaction_role:
empty_state:
error_state:
responsive_behavior:
```

Central objects should not default to generic cards if another representation better expresses lifecycle/relationships.

---

# 8. State Presentation Rules

Every state defines:

- what has happened;
- what has **not** happened;
- who may act;
- what action is available;
- what action is blocked;
- what data is fresh/stale;
- what remains private;
- what evidence exists;
- what recovery exists.

Required state families:

```text
empty
ready
in_progress
awaiting_user
awaiting_external
confirmed
completed
failed_retryable
failed_terminal
expired
revoked
stale
permission_denied
dependency_unavailable
```

Only use states relevant to the domain.

---

# 9. Operation Presentation Contract

Long-running operations must show lifecycle truth.

```text
Preparing
→ Awaiting approval
→ Submitted
→ Confirming
→ Confirmed
```

If additional processing remains:

```text
Confirmed
→ Indexing
→ Ready
```

The user must be able to tell:

- whether value moved;
- whether it is reversible;
- whether they should retry;
- whether retry would duplicate the action;
- whether the system is waiting on them or an external dependency.

---

# 10. Decisive Journey Contract

For the primary journey define:

```yaml
journey_id:
primary_actor:
starting_context:
starting_state:
goal:
steps:
  - user_action:
    system_command:
    system_response:
    visible_transition:
    policy_check:
    evidence:
    failure_branch:
ending_state:
decisive_proof:
real_data_required:
mock_allowed:
```

The decisive journey must include:

```text
success
blocked
failure
recovery
```

not only the happy path.

---

# 11. Proof Moment

Every product thesis needs a visible proof moment.

A proof moment must:

- demonstrate the primitive rather than merely state it;
- rely on real state where the claim is operational;
- expose enough evidence to build trust;
- be repeatable.

Example pattern:

```text
Claim:
A revoked execution identity no longer resolves.

Proof:
User revokes binding
→ UI state changes
→ resolve attempt fails
→ persistent parent identity remains
```

---

# 12. Progressive Disclosure

Information depth:

## Level 1 — Outcome
What happened / what can I do?

## Level 2 — Workflow
What is the next step?

## Level 3 — Control
Who authorized it? What can I change?

## Level 4 — Mechanism
How is this enforced?

## Level 5 — Architecture
Contracts, proofs, transaction hashes, schemas.

Do not expose Level 4–5 by default unless the primary user requires it.

Do not hide Level 4–5 when trust or verification requires access.

---

# 13. Information Density Classes

Every surface must be classified:

### Cinematic
Rare; product introduction/proof.

### Explanatory
Teaches mechanism.

### Operational
Optimized for action speed and state clarity.

### Analytical
Optimized for comparison, patterns, risk.

### Administrative
Optimized for settings, permissions, policy.

Each class has different density and motion expectations.

---

# 14. Surface Contract

Every screen/surface:

```yaml
surface_id:
name:
class:
primary_actor:
purpose:
primary_object:
entry_condition:
exit_condition:
primary_decision:
primary_action:
secondary_actions:
authoritative_data:
derived_data:
real_time_behavior:
blocked_state:
failure_state:
empty_state:
proof_shown:
```

Reject surfaces with no important action, decision, state, or understanding.

---

# 15. Navigation Test

Primary navigation should follow stable user mental models, not backend modules.

Reject nav that mirrors:

```text
Identity Service
Resolver
Transactions
Indexer
```

Prefer user concepts:

```text
Home
Activity
Connections
```

when those match product truth.

---

# 16. Privacy Experience Contract

For every protected field/action define:

```text
what the user sees
what other users see
what public chain observers see
what operators see
what connected partners see
```

Privacy UI must never imply:

```text
hidden
```

when the system only provides:

```text
pseudonymous
unlinkable under certain assumptions
not shown in the app
```

Use precise copy.

---

# 17. Permission Experience Contract

Blocked actions must explain the domain reason.

Bad:

```text
Something went wrong
```

Better:

```text
This account is no longer an active destination.
```

The frontend should expose why blocked, who can unblock, what action fixes it, and whether current state is safe without leaking sensitive policy details.

---

# 18. Error & Recovery Narrative

Every important structured System error maps to:

```yaml
error_ref:
user_title:
safe_explanation:
retry_guidance:
recovery_action:
support_escalation:
preserve_user_input:
```

Avoid generic failure copy for known domain errors.

---

# 19. Motion Semantics

Motion may represent:

- authorization;
- relationship creation/removal;
- value movement;
- state progression;
- verification;
- restriction;
- failure;
- completion.

For every animation specify:

```text
state_change
meaning
duration
interruptibility
reduced_motion alternative
```

Decorative motion receives no priority over clarity.

---

# 20. Landing-to-Product Continuity

Marketing must not promise an experience the app does not continue.

Audit:

```text
landing term → product term
landing object → application object
landing claim → visible proof
landing CTA → real workflow
```

A claim shown only in marketing but absent from the application is suspect.

---

# 21. Experience Originality Tests

### Truth Test
Does it represent actual system behavior?

### Native Object Test
Is the product expressed through its own objects?

### Swap Test
Could this UI belong unchanged to an unrelated product?

### Proof Test
Does the mechanism become visible?

### Continuity Test
Does product fulfill marketing promise?

### Failure Test
Does failure remain understandable?

### Density Test
Is density appropriate to task?

### Privacy Test
Does visual treatment match actual information boundaries?

---

# 22. Experience Canonicalization Gate

```text
[ ] Product/System handoff accepted
[ ] central object defined
[ ] decisive journey defined
[ ] every decisive visible state maps to System state
[ ] success/blocked/failure/recovery paths defined
[ ] proof moment defined
[ ] privacy representation mapped
[ ] permission representation mapped
[ ] operation lifecycle represented truthfully
[ ] progressive disclosure defined
[ ] surface map justified
[ ] landing/product continuity checked
[ ] unresolved assumptions registered
```

---

# 23. Command Modes

- `Experience Handoff Audit`
- `Experience Kernel`
- `Narrative Map`
- `Journey`
- `State Presentation`
- `Surface Map`
- `Native Objects`
- `Privacy Experience`
- `Permission Experience`
- `Visual Grammar`
- `Interaction Metaphor`
- `Motion Pass`
- `Proof Pass`
- `Originality Audit`
- `Experience Drift Check`
- `Frontend Handoff`
- `Canonicalize Experience`

---

# 24. Session Output

```text
Experience version:
Experience thesis:
Central object:
State-map changes:
Journey changes:
Surface changes:
Proof moments:
Privacy/permission changes:
Errors/recovery changes:
Assumptions:
Contradictions:
Next prototype/evidence step:
```

---

**Experience Foundry maxim:**  
**Translate complexity; never translate uncertainty into false certainty.**
