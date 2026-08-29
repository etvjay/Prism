# Prism Pause — Resolution Continuity

**Status:** additive backend/domain seam; provisional X2 policy defaults
**Scope:** `src/features/prism-pause/**` only; no frontend, deployment, mainnet, secrets, or decision-register changes.

## Purpose

A Prism-resolved destination is not a timeless address. A resolver may observe a
rotation, revocation, visibility change, or loss of an active destination between
intent creation and verification. Pause therefore accepts a typed,
server-side `resolutionContinuity` assessment instead of inferring continuity
from the requested recipient or the normalized execution plan.

The source is an observation seam, not a resolver and not a settlement receipt.
It must be populated by a trusted server-side source provider. A request body
must never be allowed to provide or override it.

## Typed source and check

The domain module is:

```text
src/features/prism-pause/domain/resolution-continuity.ts
```

It exports:

- `ResolutionContinuityRisk` and the seven risk constants;
- `ResolutionContinuitySource` for the server-side observation;
- `ResolutionContinuityAssessment` with `status`, `risks`, and `policyOutcome`;
- `ResolutionContinuityCheck(...)`, which materializes the normal typed
  `CheckResult` with `checkId=PAUSE-RESOLUTION-001`;
- `DEFAULT_RESOLUTION_CONTINUITY_OUTCOMES`, the explicit X2 mapping below.

A known no-risk source must say so explicitly:

```ts
resolutionContinuity: { risks: [] }
```

Omitting the source, setting it to `null`, setting `unknown: true`, or supplying
an unknown risk produces a fail-closed result. An assessment producer may include
an `outcome`, but it must exactly match the risk mapping; a contradictory outcome
is rejected rather than trusted.

A source may also be the structurally compatible result of the upstream
resolution-continuity service (`status`, `blocked`, and `risks: [{ code, ... }]`).
The seven mapped codes use the matrix below. Other provider/storage codes (for
example `SNAPSHOT_UNAVAILABLE`) are retained as typed `riskCodes` and force
`UNKNOWN/BLOCK`; they are never silently discarded.

`observedValue`, `expectedValue`, and `detail` are public-safe fields only. They
must not contain secrets, viewing keys, seed material, private calldata, or
unnecessary recipient metadata.

## X2 policy matrix

These defaults are explicit implementation policy, not silently promoted Product
Truth. Outcome precedence when several risks are present is:

```text
BLOCK > ESCALATE > REQUIRE_CONFIRMATION > ALLOW
```

| Resolution risk | Default outcome | Pause meaning |
|---|---|---|
| `ADDRESS_CHANGED` | `REQUIRE_CONFIRMATION` | The destination changed; automatic release is not allowed. The exact plan must still be confirmed through the existing authority and hash/CAS path. |
| `ALIAS_CHANGED` | `REQUIRE_CONFIRMATION` | The external alias or provider subject changed; confirmation is recorded separately, but unchanged blocking checks still require fresh verification. |
| `FIRST_TIME_RECIPIENT` | `REQUIRE_CONFIRMATION` | First use is visible as a typed resolution risk; it does not become an implicit allow. Existing `FirstUseCheck` behavior remains in force. |
| `BINDING_REVOKED` | `BLOCK` | The resolved binding is no longer valid. A generic escalation approval cannot turn it into `RELEASE_READY`; obtain a fresh valid resolution. |
| `VISIBILITY_CHANGED` | `ESCALATE` | A visibility/privacy boundary changed. Do not infer that either the old or new privacy meaning is acceptable; route through explicit authority review. |
| `CHAIN_CHANGED` | `REQUIRE_CONFIRMATION` | The destination chain changed. Existing route allowlists and plan hash binding still apply; a changed chain is never silently substituted. |
| `NO_ACTIVE_DESTINATION` | `BLOCK` | The resolver has no active destination. This preserves the existing `NO_ACTIVE_DESTINATION` sentinel semantics and blocks release. |
| no risks (`risks: []`) | `ALLOW` | The continuity source is known and reported no typed risk. All other Pause checks still run. |

A resolution check with `ALLOW` is `PASS/INFO`. Any known non-`ALLOW` outcome is
`FAIL/BLOCKING` and `canAutoRelease()` returns `false`. An unknown assessment is
`UNKNOWN/BLOCKING` with `policyOutcome=BLOCK`, preserving the existing UNKNOWN
fail-closed behavior.

`REQUIRE_CONFIRMATION` and `ESCALATE` do not mint authority, change the plan, or
create a settlement operation. They remain subject to the existing Pause state,
`plan_hash`, `policy_version`, `approval_scope_hash`, authority resolver, CAS,
expiry, and submission-fence checks. `BLOCK` is not a confirmation request and
is rejected by the existing `AUTHORITY_DENIED` taxonomy if an approval command
attempts to clear it. No outcome changes `RELEASED` semantics: `RELEASED` is a
future settlement-operation link, never `COMPLETED`.

## Preserved boundaries

- **Authority:** the configured `PauseAuthorityResolver` remains the only
  release/approve/cancel authority. A resolution source cannot self-authorize.
- **UNKNOWN:** missing or unknown resolver evidence is blocking. Existing
  `ERR-116` approval/release guards remain intact for UNKNOWN checks.
- **Recipient:** canonical recipient comparison and binding checks are unchanged;
  continuity is an additional source, not a replacement for recipient binding.
- **CAS:** every Pause transition still uses the existing expected-version CAS.
- **Settlement:** resolution outcomes are evaluated before release. They do not
  create, reuse, or fabricate an operation and do not claim chain settlement.
- **Submission fence:** no resolution result bypasses the durable operation row,
  `submitted != completed`, or the quarantine/`requires_attention` behavior for
  ambiguous submission outcomes.
- **Privacy:** a visibility risk is a typed policy signal, not a privacy claim.
  Pause does not access viewing keys or prove unlinkability.

## Open governance choices

The matrix is intentionally explicit but remains provisional until Product/System
acceptance. The following choices must not be silently canonicalized:

1. Whether `ADDRESS_CHANGED` and `CHAIN_CHANGED` should require user
   confirmation, qualified approver escalation, or a hard block for each action
   class/venue.
2. Whether `FIRST_TIME_RECIPIENT` is sufficient for ordinary confirmation or
   should always require a stronger approver class.
3. Whether every `VISIBILITY_CHANGED` event is escalation-worthy, and what
   evidence distinguishes a harmless metadata change from a privacy-boundary
   change.
4. Whether a fresh canonical resolution can clear a `BLOCK`, or whether the
   intent must always be recreated with a new plan hash.
5. Whether the same matrix applies to direct native addresses and only to
   Prism-resolved destinations, and how the policy varies by `IntentPurpose`.
6. Whether outcome mappings are global X2 defaults or become versioned per-user,
   per-venue, or per-action policy entries.

No decision-register entry is added by this implementation. Until those choices
are accepted, treat the code and this document as a governed backend/runtime
seam, not a canonical Product/System amendment.
