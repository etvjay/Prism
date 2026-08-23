# M5 Proposal — PrismClaim composed with the Prism-owned privacy_invoke helper

**Status:** Proposed; not canonicalized  
**Scope:** M5 decision/re-entry only  
**Core answer:** Yes, PrismClaim can wrap/compose with the helper, but the helper should remain a stateless pool/application adapter. PrismClaim must own the asynchronous claim lifecycle.

## 1. Correct layering

```text
Starknet PrismIdentityRegistry
  canonical Prism ID/controller/binding authority
          │
          ▼
PrismClaim lifecycle / commitment / expiry / refund
  recipient verification and claim state
          │
          ▼
Prism Pause
  intent/policy/approval before final claim settlement
          │
          ▼
Prism privacy_invoke helper
  canonical STRK20 pool-facing adapter
          │
          ▼
STRK20 pool
  private/open-note settlement
```

### PrismClaim owns

```text
claim_id
external-principal commitment
sender policy
expiry
claim status
recipient verification result
single-use claim consumption
refund eligibility
```

### The helper owns

```text
canonical privacy_invoke ABI
input/output token boundary
measured application output delta
caller-scoped approval
atomic application action
OpenNoteDeposit return
```

### The helper must not own

```text
claim lifecycle
external social verification
recipient identity policy
expiry/refund authority
Prism identity canonical state
viewing keys
```

## 2. Candidate lifecycle

### Create/fund

```text
sender addresses a human/external principal
→ Prism verifies the principal through a ratified route
→ PrismClaim is created with commitment + expiry + sender policy
→ funding is placed through a documented pool/escrow composition
→ claim enters FUNDED / RECIPIENT_UNREGISTERED
```

### Recipient onboarding/claim

```text
recipient proves control of the external principal
→ links or creates Prism ID
→ PrismClaim becomes CLAIMABLE
→ Prism Pause evaluates the exact claim settlement plan
→ privacy pool invokes the Prism helper
→ helper performs the selected application action
→ output is returned to the pool as OpenNoteDeposit
→ claim becomes CLAIMED
```

### Expiry/refund

```text
claim expires
→ sender/authorized refund path verifies expiry
→ refund operation is paused and authorized
→ refund settles atomically
→ claim becomes REFUNDED
```

## 3. Why this is not a trivial wrapper

The current first-party `privacy_invoke` shape is:

```cairo
privacy_invoke(
  in_token,
  out_token,
  in_amount: u128,
  note_id
) -> Span<OpenNoteDeposit>
```

It does not directly carry a `claim_id`, external-principal proof, sender policy, or expiry. Therefore the composition must ratify how the claim identity is conveyed:

```text
Option A — documented note_id/claim commitment binding
Option B — helper target calldata extension supported by the pool route
Option C — separate claim settlement contract called through the helper
Option D — claim uses a separate documented pool action, not privacy_invoke
```

No option may be invented from the helper fixture alone.

## 4. Required M5 decisions

```text
D-M5-1  Who verifies the external principal, and what signed/attested fact is stored?
D-M5-2  Where is value held between FUNDED and CLAIMABLE?
D-M5-3  How does claim_id bind to the pool/helper/open-note settlement?
D-M5-4  Which authority wins the claim-vs-refund same-block race?
D-M5-5  Which fields are public: amount, expiry, status, principal commitment?
D-M5-6  Does the claim use privacy_invoke or a separate supported pool action?
```

## 5. Required state machine

```text
CREATED
→ FUNDED
→ RECIPIENT_UNREGISTERED
→ INVITATION_SENT
→ RECIPIENT_VERIFIED
→ CLAIMABLE
→ CLAIMING
→ CLAIMED
```

Refund branch:

```text
FUNDED | RECIPIENT_UNREGISTERED | INVITATION_SENT
→ EXPIRED
→ REFUND_AVAILABLE
→ REFUNDING
→ REFUNDED
```

Illegal transitions:

```text
CLAIMED → REFUNDED
REFUNDED → CLAIMED
EXPIRED → CLAIMED without a new claim
CLAIMABLE → CLAIMED twice
claim approval for claim A → settlement claim B
```

## 6. Required adversarial tests

```text
external-principal substitution
claim commitment substitution
recipient proof replay
claim double-consumption
claim-vs-refund race
expiry boundary race
sender refund authorization failure
stranded funds / dust
helper output mismatch
pool caller mismatch
plan/claim hash mismatch
post-revocation claim attempt
public metadata/privacy leakage
```

## 7. Recommended implementation decision

For the immediate M5/testnet closeout:

```text
retain the tested helper as the pool adapter
create this Claim+helper composition as a bounded proposal
run a first-party interface experiment for claim_id/value custody
implement Claim only after D-M5-1..D-M5-6 are ratified
```

If the experiment cannot prove a supported composition, close M5 with the helper route and keep PrismClaim as a documented future re-entry—not as an invented contract.

## 8. Acceptance gate

```text
Product Foundry:
  Claim is materially Prism-native, not generic escrow

Research Foundry:
  principal verification and privacy visibility are sourced/ratified

System Foundry:
  authority matrix, state machine, errors, events, and value conservation exist

Antagonist:
  replay, expiry, refund, substitution, and leakage attacks pass

AUDIT:
  G6 helper/Claim action, T4/T5/T9/T11/T12 evidence

Runtime:
  real SN_SEPOLIA pool composition + independent readback
```

No `strk20.json` write occurs from this testnet proposal.
