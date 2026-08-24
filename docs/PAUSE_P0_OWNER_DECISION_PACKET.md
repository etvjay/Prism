# Pause P0 Owner Decision Packet — Prism Pause Primitive

**Status:** DRAFT — awaiting explicit owner acceptance (Product/System)  
**Date:** 2026-08-24  
**Commit HEAD scope:** `c68cd72` (+ working-tree `src/features/prism-pause/**`, `src/application/pause-port.ts`, `src/application/factory.ts`, `src/sdk/**`, `src/features/prism-pause/ports/**`)  
**Lane:** M7 Pause P0–P7 backend/runtime — Muse Spark 1.2 free via OpenCode  
**Non-goal:** This packet does NOT silently canonicalize `PrismPause` into `projects/prism/system/**` (DOMAIN_MODEL, STATE_MACHINES, AUTHORITY_MATRIX, ERROR_CATALOGUE). Code lives under `src/features/prism-pause/**` as additive, integration-branch only until decisions below are accepted.

> Verdict policy: if any required decision remains unaccepted, the lane returns `M7_BLOCKED_BY_OWNER_DECISIONS` for canonicalization. Runtime X2 readiness (`M7_P0_P7_RUNTIME_READY_X2`) remains valid for the controlled backend/runtime slice with explicit open gates for live Postgres, live adapters, and P8 testnet.

---

## 1. Protected boundary (what this packet does NOT change)

- Starknet remains canonical Prism identity root; Base remains native execution venue.
- `submitted != completed` (INV-SYS-005) and `RELEASED != completed`.
- Backend never becomes canonical identity authority; Pause never claims post-finality rollback.
- STRK20 viewing keys remain wallet-owned; no Pause code touches seeds/keys.
- Vocabulary separation preserved: `Intent` / `ExecutionPlan` / `Pause` / `Verification` / `Decision` / `Settlement` / `Receipt`.

No `projects/prism/system/*.md|yaml`, `strk20.json`, Linear/Notion, secrets, mainnet, or Phase 8 frontend/Home was mutated.

---

## 2. Decisions required before P0 canonicalization (all blocking for markdown/YAML promotion)

### D-P0-001 — Required scope: all consequential actions vs high-risk only

| Option | Meaning | Backend implication |
|---|---|---|
| **A (strict):** Pause required for **all** consequential actions (any payment/transfer/contract_call/private_action that reaches settlement) | Every `ExecutionIntent` must traverse `PAUSED→VERIFYING→RELEASE_READY→RELEASED` before settlement. No bypass route. | `pauseIntent` becomes mandatory gate; API must reject direct submit without pause link. Higher load, stronger safety. |
| **B (risk-scoped):** Pause required only for **high-risk** actions (first-use, amount>threshold, agent-initiated, cross-chain, newly-bound recipient, simulation mismatch) | Low-risk repeat payments may auto-pass without `ESCALATED`. Policy decides risk class. | `evaluatePolicy()` still runs, but `canAutoRelease()` allowance expands. Requires explicit policy `riskTier` definition and audit. |
| **C (per-venue/action allowlist):** Pause scoped to explicit `pausedActionClasses: string[]` (e.g., `["base:transfer","starknet:invoke"]`) | Other actions use existing Operation flow unwrapped. | `Plan.chainId + calls` allowlist; P6 API must validate class membership. |

**Recommended default for X2:** **B** with `requireFirstUseEscalation=false` and `amountCeiling=null` in dev, but owner must choose A/B/C before DOMAIN_MODEL amendment. Lane currently defaults to **B-like** (all intents create a pause, but `passingSources` yields `RELEASE_READY`; `UNKNOWN` still blocks).

**Open question for owner:** Which `IntentPurpose` values are in scope for MVP? (`payment|transfer` only, or also `contract_call|private_action`?)

---

### D-P0-002 — Release authority (who may release)

Per plan §4 authority table, release authority is `user/controller/authorized_agent per policy`. Implementation enforces:

- `approval_scope_hash = sha256(pause_id + plan_hash + policy_version)` exact plan binding;
- `policyVersion` must match at `verify` and `release`;
- `RELEASED` requires `RELEASE_READY` + no `BLOCKING FAIL|UNKNOWN` + correct `planHash/approvalScopeHash`.

| Option | Who may release | How enforced |
|---|---|---|
| **A (user-only):** Only the `principal` (user) that owns the intent | `release(actor)` must equal `intent.principal`; agent `ESCALATED` always requires user approval. Simplest, strongest. |
| **B (user + controller):** User or on-chain controller currently bound to `prismId` | Requires registry lookup at `release` time (adds Starknet read). Backend not authoritative — chain is. |
| **C (delegated agent with scope):** Agent may release within its `AgentScope` (chains/assets/contracts/amount ceiling/recipients) | `AgentScope` already in `policy-engine.ts:allowedAgentScopes`; requires explicit `agentId` binding and revocation check. |
| **D (quorum/controller quorum):** Requires `requiredApprovalCount >1` (multisig/controller quorum) | `approveEscalation` loop with `requiredApprovalCount` >1; `pause-service:approve()` currently single-approve (X2) — quorum extension open. |
| **E (operator fallback):** Backend operator may release only when policy explicitly marks `operatorIsAuthorized=true` | `pause-port.ts` currently **denies** operator by default (never authoritative). E would add an explicit policy flag and audit log. Not recommended as default. |

**Current X2 enforcement:** Owner-as-principal is validated at `createIntent` (`prism:xxx`); agent scope is checked in `policy-engine`; operator is **never** authoritative. No live controller registry check at release (would be P5 live adapter).

**Owner must choose** one primary + optionally C/D, and confirm whether operator fallback is ever allowed (and under what audit).

---

### D-P0-003 — UNKNOWN policy (always-blocking vs escalate)

| Option | Semantics | Backend behavior |
|---|---|---|
| **A (fail-closed, always blocking):** Any `UNKNOWN` with `BLOCKING` severity prevents `RELEASE_READY`; pause goes `ESCALATED` and `release()` throws `ERR-116` | Current X2 behavior. `checks.ts:hasBlockingFailure` treats `UNKNOWN+BLOCKING` as blocking; `completeVerification` routes to `ESCALATED`; `release()` checks `hasBlockingFailure` (`ERR-116`). |
| **B (escalate UNKNOWN):** `UNKNOWN` escalates but does not permanently block; a qualified approver may clear it | Same routing to `ESCALATED`, but `approveEscalation` would be allowed to clear `UNKNOWN` to `RELEASE_READY` if policy explicitly allows. Currently **blocked** (`ERR-116` on approve when `PAUSE-UNKNOWN-001`). |
| **C (per-check UNKNOWN config):** Policy declares per `checkId` whether `UNKNOWN` is `BLOCKING` or `WARNING` | Requires policy extension `unknownSeverityOverrides: Record<checkId, severity>` — not yet implemented. |

**Recommended:** **A** for MVP (fail-closed). If B is desired, owner must explicitly enumerate which checks may be cleared by human approval (e.g., simulation staleness vs recipient binding).

**Owner input required:** Confirm A, or list checks where UNKNOWN may be escalated-and-cleared.

---

### D-P0-004 — Default pause expiry / sweep policy

| Field | Current X2 | Options for canonical |
|---|---|---|
| `defaultPauseTtlMs` | `10*60*1000` ms (domain store) / `3600*1000` ms (REST `pause-port`) — divergent by layer | **Unify** to single canonical default, e.g., `600s` (10 min) or `3600s` (1h) per channel risk. |
| `intent.expiresAt` | Caller-supplied (`createdAt + ttl`), validated `expiresAt > createdAt`; enforced at `pause()` via `isIntentExpired` | Owner chooses intent TTL (same as pause or longer). |
| Sweep | `sweepExpired(now)` via `store.listExpired` + `expire()` per pause with CAS guard; concurrent sweeps → one winner. No background cron in this lane (caller-driven). | Decide whether production runs a periodic `sweepExpired` cron (e.g., every 30s) vs on-demand at `verify/release`. |
| Terminal semantics | `EXPIRED` is terminal; `EXPIRED→RELEASED` rejected (`ERR-113`); `CANCELLED`/`RELEASED` never swept. | Confirm. |
| Grace / reverify | `reverify` allowed from `RELEASE_READY|ESCALATED|VERIFYING`; expired cannot reverify. | Confirm whether expired intents should auto-create a new intent version (`nextIntentVersion`) or require fresh `clientIdempotencyKey`. |

**Owner must pick:** canonical `defaultPauseTtlMs`, sweep trigger (cron vs on-demand), and whether expired intents auto-bump version or require new idempotency key.

---

### D-P0-005 — MVP action class (first vertical slice)

Per plan §8 recommended slice: **Base payment or transfer to a Prism-resolved destination** (uses existing Prism ID / Base binding primitive; exercises recipient correctness, first-use, amount policy; no STRK20 viewing-key access).

| Choice | What it exercises | What it avoids |
|---|---|---|
| **Base `payment` to Prism-resolved destination (recommendation)** | Recipient binding, first-use, amount threshold, agent scope, chain/asset/contract allowlist, plan_hash, simulation | STRK20 viewing keys, PrismClaim |
| **Starknet `invoke` (identity controller action)** | Starknet chain adapter, controller authority | Base venue |
| **STRK20 private action (post-P8)** | Wallet API / anonymizer boundary | Premature privacy claim |

**Current X2:** `chainId` is generic (`base|starknet|strk20`), `calls: ["transfer"]`, no live chain. No action class is silently made canonical.

**Owner must confirm** MVP class before P5 live adapter work and P6 product slice.

---

## 3. What remains explicitly open at X2 (not blocking runtime X2, but gating X3/X5)

| Gate | Status at X2 | Required for promotion |
|---|---|---|
| **Postgres live verification** | Port + migration SQL (`postgres-pause-store.ts:PAUSE_STORE_MIGRATION_SQL`, `idx_execution_pauses_active_per_intent` partial unique, `UPDATE WHERE version` CAS) exists; suite skips without `PRISM_POSTGRES_TEST_URL`. Memory adapter is X2 substitute. | `T7` live-DB run: `PRISM_POSTGRES_TEST_URL=postgres://… npm test` against real `pg`; row-count/unique/CAS assertions. |
| **Live settlement adapters** (`StarknetExecutionAdapter` with `Account.execute` + `RpcProvider.waitForTransaction`, `BaseExecutionAdapter` with `viem walletClient`, `STRK20WalletActionAdapter` with wallet API) | Fakes only (`FakeStarknetAdapter`/`FakeBaseAdapterImpl`/`FakeStrk20Adapter` with deterministic `0x` txHash). No live broadcast; never marks `completed`. | P5 live helpers + testnet tx hash verification. |
| **P8 SN_SEPOLIA evidence** | Out of scope by lane constraint (no broadcast, no `strk20.json` write). Bridge stops at `submitted`. | Sequence `intent→pause→verify→release→submit→confirming→confirmed→indexed→reconciled→completed` with independent receipt/read (Base Sepolia `84532` / SN_SEPOLIA). |
| **Frontend/Phase 8** | Explicitly untouched (`strk20.json` stays `{"transactions":[],"contracts":[]}`) | Product slice `Send/Activity/Home` states per plan P6, owner-led. |
| **Postgres correlation persistence** | Correlation stored via `OperationStore` (`correlationId`), not in `execution_pauses` row. REST echoes `X-Correlation-Id`; SDK carries `correlationId`. | Decide whether `execution_pauses` should also persist `correlation_id` column for direct pause-level trace (currently via joined operation). |

No X3 claimed. Evidence maturity at X2 per `EVIDENCE_AUDIT_FOUNDRY.md` §6 (controlled local).

---

## 4. Non-canonicalization affirmation

This lane did NOT add `PrismPause` to any markdown/YAML canonical domain model. Promotion of `SM-PAUSE-001`, `INV-PAUSE-*`, `ERR-100…122`, and any `AUTHORITY_MATRIX` delta requires a new append-only `DECISIONS.md` record and `projects/prism/system/**` amendment after the owner accepts D-P0-001…005 above. Any other lane that mutates canonical models without such acceptance is out of contract.

---

## 5. Required owner response shape (to unblock canonicalization)

```yaml
decision: DEC-PRISM-PAUSE-P0
accepted_options:
  D-P0-001_scope: "A|B|C"
  D-P0-002_release_authority: "A|B|C|D|(+E if explicitly allowed)"
  D-P0-003_unknown_policy: "A|B|C"
  D-P0-004_defaultPauseTtlMs: 600000  # or 3600000, unified
  D-P0-004_sweep: "cron_30s|on_demand"
  D-P0-005_mvp_action_class: "base_payment_to_resolved_prism"
intent_purposes_in_scope: ["payment","transfer"] # or broader
additionalApproval: "per_policy"
owner: "Jason"
date: "YYYY-MM-DD"
evidence_gate: "X2 runtime ready; X3 gated on live PG + adapters + P8 testnet"
```

Without this, verdict remains `M7_BLOCKED_BY_OWNER_DECISIONS` for markdown/YAML canonicalization; runtime verdict remains `M7_P0_P7_RUNTIME_READY_X2` for the backend/runtime boundary described above.

---

## 6. Contact & lane constraints

- Model: Muse Spark 1.2 free via OpenCode. No ChatGPT/Codex. Backend/runtime only.
- Boundaries still enforced: no frontend/Phase 8, M8/P8 testnet rehearsal, M9, `strk20.json`, Linear/Notion, secrets, or mainnet writes/broadcasts.
- See also: `BACK END review` at `BACKEND_PHASE_M7_REVIEW.md` (updated in this commit), `projects/prism/system-inputs/PRISM_PAUSE_P5_P7_AUDIT_MAP.md`.

