# Design-to-Product Foundry
## Production Interface, Design-System, Accessibility, and Frontend Integrity Engine — v0.95

**Core question:** How do we realize the canonical experience at production quality without altering system truth?

**Maturity target:** 9.5/10 operational standard

---

# 1. Mandate

The Design-to-Product Foundry owns production realization:

- art direction;
- typography;
- color;
- design tokens;
- component grammar;
- frontend architecture;
- state rendering;
- accessibility;
- responsive behavior;
- motion;
- performance;
- visual consistency;
- maintainability;
- design QA.

It does not own product semantics.

---

# 2. Required Handoff

Before production implementation, identify:

```text
Product primitive
Product terminology
Experience thesis
Central object
Decisive journey
Surface map
System state mappings
Permissions
Errors
Operation lifecycles
Proof moments
Privacy rules
Real vs mocked data
```

If a required frontend state has no System meaning, raise a contradiction.

---

# 3. Production Definition

A surface is not production-ready because it looks polished.

```text
PRODUCTION QUALITY =
concept integrity
+ state correctness
+ interaction clarity
+ accessibility
+ responsive behavior
+ performance
+ truthful data
+ failure handling
+ maintainability
+ visual distinction
```

---

# 4. Art Direction Contract

Derive visual form from product attributes.

For each attribute define:

| Product attribute | Composition | Typography | Color | Geometry | Density | Motion |
|---|---|---|---|---|---|---|

Canonical sentence:

> **[Product] should look and behave like [reference world A] combined with [reference world B], expressed through [specific visual/interaction language], while avoiding [specific clichés].**

Reference use must explain:

```text
borrow
transform
do not copy
product truth expressed
```

---

# 5. Typography System

Define tokens for:

```text
display
heading
body
label
caption
code/identifier
numeric-large
numeric-tabular
```

Specify:

- font family;
- weight;
- size;
- line height;
- tracking;
- numeric behavior;
- truncation;
- responsive scale;
- supported scripts;
- loading/fallback.

Financial interfaces require deliberate:

```text
tabular numerals
currency alignment
percentage formatting
precision rules
negative values
large values
tiny values
```

---

# 6. Color System

Role-based tokens:

```text
foundation
surface
surface-raised
text-primary
text-secondary
text-muted
border
identity
action-primary
action-secondary
success
warning
danger
info
focus
selection
disabled
privacy
pending
```

For every semantic color define:

- meaning;
- allowed usage;
- prohibited usage;
- non-color fallback;
- light/dark behavior;
- contrast target.

Never encode status only by color.

---

# 7. Token Contract

Tokens should cover:

```text
color
type
space
size
radius
border
elevation
opacity
container
grid
breakpoint
z-index
motion-duration
motion-easing
focus-ring
```

Page-level arbitrary values require explicit exceptions.

---

# 8. Component Grammar

## Generic primitives

Examples:

```text
Button
Input
Select
Dialog
Sheet
Menu
Tooltip
Tabs
Table
```

## Domain-native components

Must represent product meaning.

Each component:

```yaml
component_id:
domain_object:
purpose:
required_data:
states:
permissions:
actions:
loading:
empty:
error:
stale:
responsive:
accessibility:
analytics:
```

Do not let a generic `Card` become the architecture of the whole product.

---

# 9. Frontend Domain Types

Frontend types must be generated or derived from accepted contracts where possible.

Separate:

```text
Domain types
API transport types
View models
Local UI state
```

Do not mutate transport types into ad-hoc frontend truth.

Derived view models must clearly identify derivation.

---

# 10. State Rendering Matrix

For every decisive object/state define:

| System state | User label | Visual treatment | Allowed actions | Disabled actions | Evidence | Refresh behavior |
|---|---|---|---|---|---|---|

This matrix is mandatory for the decisive journey.

---

# 11. Async UI Rules

For any consequential action:

```text
idle
→ validating
→ awaiting_user_authorization
→ submitted
→ confirming
→ completed
```

or domain-specific equivalent.

Frontend must not:

- show success at submission;
- auto-retry irreversible actions without explicit safety;
- discard operation IDs;
- hide chain/payment processing;
- lose user context on recoverable failure.

---

# 12. Accessibility Gate

Target WCAG 2.2 AA unless stricter requirements exist.

Audit:

- semantic HTML;
- keyboard-only navigation;
- visible focus;
- logical tab order;
- screen-reader labels;
- accessible names/descriptions;
- dialogs focus trap/return;
- live regions for operation status;
- form errors linked to fields;
- contrast;
- non-color status;
- touch targets;
- zoom/reflow;
- reduced motion;
- prefers-contrast where useful;
- icon-only action labels.

Financially consequential actions require unambiguous accessible confirmation.

---

# 13. Responsive Gate

Define behavior at:

```text
small mobile
large mobile
tablet
desktop
wide desktop
```

For every domain component specify:

- layout;
- ordering;
- truncation;
- scroll;
- collapse;
- action placement;
- density changes.

Do not simply shrink desktop cards.

---

# 14. Data Reality Gate

Every data element is tagged internally as:

```text
LIVE_AUTHORITATIVE
LIVE_DERIVED
CACHED
ESTIMATED
MOCK
FIXTURE
```

Production demo path must not silently mix mocks with live state.

Mocks must be:

- development-only;
- sandbox-only;
- clearly labeled.

---

# 15. Financial Data Rules

Define centrally:

```text
token decimals
display precision
rounding mode
fiat conversion freshness
dust threshold
percentage precision
locale behavior
timezone
timestamp format
```

Never perform economic calculations from formatted display strings.

---

# 16. Error & Recovery Components

Every domain error category should map to consistent interface behavior.

Required patterns:

```text
inline validation
blocking action error
recoverable operation failure
dependency unavailable
permission denied
stale-state conflict
terminal failure
support escalation
```

Preserve user input after recoverable errors.

---

# 17. Empty & Partial States

Define intentionally:

- no identity;
- no connected account;
- zero balance;
- no position;
- indexer still loading;
- partial chain outage;
- privacy wallet unavailable;
- stale data;
- unsupported venue.

An empty state is not marketing copy. It should explain the next valid action.

---

# 18. Performance Budget

Set measurable budgets before polish.

Suggested categories:

```text
LCP
INP
CLS
JS bundle
initial route payload
image payload
API waterfall depth
number of blocking fonts
```

No universal numeric target is imposed by the Foundry; project requirements choose them.

But a budget must exist.

Performance regressions are production defects, not optional polish.

---

# 19. Loading Strategy

Use:

- skeletons only when spatial prediction is useful;
- spinners for bounded local actions;
- explicit operation progress for long-running work;
- stale-while-revalidate where truth semantics permit;
- optimistic UI only where reversible and safe.

Do not use animation to conceal indefinite dependency latency.

---

# 20. Motion Implementation

Every motion token:

```yaml
motion_id:
state_change:
purpose:
duration:
easing:
interruptible:
reduced_motion:
```

Reject motion without semantic purpose.

---

# 21. Security-Sensitive UI

For:

```text
send
revoke
delete
pay
delegate
change authority
reveal private data
```

define:

- confirmation threshold;
- amount/target review;
- destination display;
- irreversible warning;
- phishing-resistant context where possible;
- clipboard/address handling;
- success receipt.

Never hide a financially consequential side effect behind ambiguous CTA copy.

---

# 22. Frontend Architecture

Recommended boundaries:

```text
app shell
routes
features
domain components
generic primitives
data clients
state machines
formatters
telemetry
```

Server state should generally live in a query/cache layer.

Local UI state should not duplicate canonical server state unnecessarily.

---

# 23. Test Architecture

Required where applicable:

### Visual/system
- token conformance;
- component variants;
- snapshot only where valuable.

### Accessibility
- automated axe-like checks;
- keyboard flows;
- manual screen-reader spot checks.

### State
- component state matrix;
- async lifecycle;
- stale/conflict states.

### Integration
- typed API mocks from schema;
- real sandbox integration.

### E2E
- decisive journey;
- blocked path;
- failure/recovery path;
- mobile path.

---

# 24. Anti-Slop Audit

Detect:

- generic gradient hero;
- fake metrics;
- fake partners;
- glowing network imagery;
- random iconography;
- excessive pills;
- repetitive cards;
- arbitrary radii;
- unstructured spacing;
- decorative animation;
- crypto clichés;
- unexplained glassmorphism;
- empty landing claims;
- UI that looks complete while system is not.

Tests:

```text
Swap Test
Explanation Test
Silhouette Test
Delete Test
Reality Test
Continuity Test
Proof Test
Consistency Test
Edge-Case Test
Accessibility Test
Performance Test
```

---

# 25. Production Review Gate

```text
[ ] decisive journey complete
[ ] state rendering matches System truth
[ ] blocked/failure/recovery states complete
[ ] mocks isolated
[ ] accessibility reviewed
[ ] responsive behavior reviewed
[ ] financial formatting centralized
[ ] performance budget measured
[ ] error recovery works
[ ] loading/stale behavior truthful
[ ] security-sensitive confirmations reviewed
[ ] design tokens used consistently
[ ] landing/application continuity passes
[ ] proof moment visible
[ ] no critical anti-slop findings
```

---

# 26. Command Modes

- `Design Handoff Audit`
- `Art Direction`
- `Reference Audit`
- `Type System`
- `Color System`
- `Tokenize`
- `Component Grammar`
- `State Rendering Matrix`
- `Vertical Slice`
- `Frontend Architect`
- `Accessibility Pass`
- `Responsive Pass`
- `Performance Pass`
- `Motion Implementation`
- `Anti-Slop Audit`
- `Production Review`
- `Design Drift Check`
- `Canonicalize Build`

---

# 27. Session Output

```text
Design version:
Implementation target:
Art-direction decisions:
Token changes:
Component changes:
State matrix changes:
Accessibility findings:
Responsive findings:
Performance findings:
Mocks remaining:
Quality blockers:
Assumptions:
Next evidence-producing build step:
```

---

**Design-to-Product maxim:**  
**Beautiful is not production-ready until it is truthful, accessible, resilient, and fast.**
