# Foundry Index
## Canonical Development Stack — v0.95

The Foundry operating system is a truth-preserving pipeline for moving from evidence to product, product to system, system to human/external interfaces, implementation to runtime evidence, and evidence back into research.

---

# Canonical Flow

```text
Research
→ Product
→ System
├→ Experience → Design-to-Product ┐
└→ Interface & Ecosystem          ├→ Implementation
                                  ↓
                            Evidence / Audit
                                  ↓
                               Research
```

---

# Foundries

1. [`RESEARCH_FOUNDRY.md`](./RESEARCH_FOUNDRY.md)  
   Establishes external truth, sources, contradictions, experiments, and evidence maturity.

2. [`PRODUCT_FOUNDRY.md`](./PRODUCT_FOUNDRY.md)  
   Owns problem truth, user truth, core primitive, product invariants, non-goals, trust model, and decisive proof.

3. [`SYSTEM_FOUNDRY.md`](./SYSTEM_FOUNDRY.md)  
   Defines domain objects, state machines, authority, contracts, persistence, failure, reconciliation, observability, and test architecture.

4. [`EXPERIENCE_FOUNDRY.md`](./EXPERIENCE_FOUNDRY.md)  
   Maps System truth into human-understandable states, journeys, proof moments, and progressive disclosure.

5. [`DESIGN_TO_PRODUCT_FOUNDRY.md`](./DESIGN_TO_PRODUCT_FOUNDRY.md)  
   Realizes the accepted experience as a production-quality, accessible, responsive, performant frontend.

6. [`INTERFACE_ECOSYSTEM_FOUNDRY.md`](./INTERFACE_ECOSYSTEM_FOUNDRY.md)  
   Defines canonical capabilities, exposure, API, SDK, MCP, events, machine payments, discoverability, versioning, and conformance.

7. [`EVIDENCE_AUDIT_FOUNDRY.md`](./EVIDENCE_AUDIT_FOUNDRY.md)  
   Links claims to tests and runtime evidence, audits drift, privacy, security, conformance, and recanonicalization triggers.

8. [`FOUNDRY_PROTOCOL.md`](./FOUNDRY_PROTOCOL.md)  
   Governs cross-Foundry authority, typed handoffs, traceability, decision control, drift, and evidence feedback.

---

# Cross-Foundry IDs

Use stable prefixes:

```text
TRUTH-  accepted truth
CLM-    product claim
DEC-    decision
ASM-    assumption
CON-    contradiction
EXP-    experiment
OBJ-    domain object
SM-     state machine
TR-     transition
INV-    invariant
CMD-    command
QRY-    query
EVT-    event
ERR-    error
OP-     operation
CAP-    capability
API-    API operation
MCP-    MCP surface
TEST-   test
EVD-    evidence
CHG-    change proposal
HO-     handoff
```

---

# Prism Specialization

The Foundries remain reusable methodology. Prism specializes them through ecosystem profiles:

```text
../profiles/STARKNET_SYSTEM_PROFILE.md
../profiles/STRK20_PRIVACY_PROFILE.md
../profiles/STARKNET_INTERFACE_PROFILE.md
../profiles/STARKNET_MAINNET_EVIDENCE_PROFILE.md
```

Then Prism-specific truth lives under:

```text
../projects/prism/CANONICAL_STATE.md
../projects/prism/DECISIONS.md
../projects/prism/ASSUMPTIONS.md
../projects/prism/CONTRADICTIONS.md
../projects/prism/EVIDENCE_LEDGER.md
../projects/prism/AUDIT.md
```

---

# Precedence

```text
Canonical Product Truth
        ↓
Generic Foundry rules
        ↓
Verified Starknet / STRK20 profiles
        ↓
Prism project decisions
        ↓
Implementation
        ↓
Runtime evidence
```

Profiles may constrain Prism implementation but may not silently redefine Product truth.

---

**Core rule:** **Truth flows down as constraints. Evidence flows up as correction.**
