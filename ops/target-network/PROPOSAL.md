# Target-Network Proposal — Bundle 3T (Evidence-Preparation, No Deployment)

**Status:** `PROPOSED — OWNER DECISION REQUIRED`  
**Worktree:** `backend-bundle-3t` @ `5684163`  
**Authority:** `STACK_DECISIONS.md:SD-006`, `CONTRADICTIONS.md:CON-PRISM-012`, `SYSTEM_CANONICAL.md:§6`, `BACKEND_PRODUCTION_READINESS_PACKET.md:§6–§7`, `CHAINID_V2_DECISION_PACKET.md:SD-008`  
**Manifest:** `ops/target-network/manifest.yaml` (machine-readable; this file is the human-readable proposal)

---

## 1. Proposal

| Environment | Starknet network | Base network | Base chainId | Status |
|---|---|---|---|---|
| **testnet** (default for all Bundle 3T work) | `SN_SEPOLIA` | Base Sepolia | `84532` | **PROPOSED as default** |
| **mainnet** (release-gated evidence) | `SN_MAIN` | Base Mainnet | `8453` | **PROPOSED as release-gated** |

- Default development/runtime = **SN_SEPOLIA + Base Sepolia**. Every harness, evidence envelope, and validation script defaults to this pair.
- Mainnet (`SN_MAIN` + `8453`, canonical STRK20 pool `0x0403…812a`) is a **separate environment behind an explicit Jason-approved release gate**. No harness or envelope in this bundle assumes mainnet.
- The Base `chainId` is bound into the challenge digest (schema v2, `e8886af` / DEC-PRISM-SYS-003 companion). A proof minted on one Base network cannot verify on the other — `ERR-012 altered_fields:chain_id` / `ERR-003`.

This matches `CON-PRISM-012` resolution:

> default development/runtime = SN_SEPOLIA; mainnet configuration = explicit release gate; qualifying sprint evidence = still earned on SN_MAIN after testnet acceptance.

---

## 2. No silent acceptance — how the gate works

This proposal **does not silently accept itself**. The mechanism is intentionally two-step:

1. **Manifest status = `PROPOSED`.** Every consumer (evidence envelope builder, harness, sncast validation) treats `PROPOSED` as *undecided* and must refuse to produce a promotable envelope until the owner decision block is filled.
2. **Owner decision required:** Jason creates an append-only record in `projects/prism/DECISIONS.md` (suggested `DEC-PRISM-OPS-001` or as part of `DEC-PRISM-SYS-003` disposition), copying the shape from `CHAINID_V2_DECISION_PACKET.md:§6`:

```yaml
decision_id: DEC-PRISM-OPS-001
layer: System/Ops
status: ACCEPTED   # or REJECTED / SUPERSEDED
subject: target-network manifest (testnet=SN_SEPOLIA+84532 default, mainnet=SN_MAIN+8453 release-gated)
selected_option: 1  # accept default+gate
decided_by: Jason
decided_at: <ISO date>
companion_work: SD-008 chainId-v2 disposition recorded separately
```

3. **Mirroring:** once that DEC exists, `ops/target-network/manifest.yaml:owner_decision` is updated to `ACCEPTED` with `decision_id / decided_by / decided_at / selected_environment / disposition_chainId_v2 / signature` pointing back to the DECISIONS commit. Until both exist, the gate is OPEN.

**Rejection path:** an owner `REJECTED` record must name the residual risk owner and revisit trigger (first multi-environment deployment plan), per `CHAINID_V2_DECISION_PACKET.md:§5`.

**Deferral is a recorded decision** with a named risk window — leaving this proposal forever `PROPOSED` is itself an explicit state (no deployment is unblocked).

---

## 3. Why this split

- **Testnet reduces financial exposure** and exercises wallet/binding/revocation failure states without production value at risk (`BACKEND_PRODUCTION_READINESS_PACKET.md:§6` docs v0.3 §35 lifecycle).
- **Mainnet evidence remains required** for `G0` (pool reachability), `X4/X5` maturity, and hub `ok=pool=mine=true` once contracts are declared (`AUDIT.md:§13` gates, `EVIDENCE_LEDGER.md:X-Scale`).
- The split mirrors `TEST_ARCHITECTURE.md:§5` ladder: `devnet (snforge, X2) → SN_SEPOLIA+Base Sepolia (X3) → SN_MAIN release-gated (X4/X5)`.
- No `strk20.json` is written from testnet logic (`EVIDENCE_LEDGER.md:Mainnet Receipt Rule`; `ops/target-network/manifest.yaml:R06`).

---

## 4. ChainId-v2 (SD-008) coupling

The target-network choice is **blocked on SD-008** disposition (`CHAINID_V2_DECISION_PACKET.md`). The manifest encodes:

- `base.chain_id` per environment as the mandatory `policy.defaultChainId` value the challenge service must be wired with (no hard-coded fallback).
- The harness `chainId target mismatch` test asserts that presenting a proof minted on `84532` against a binding expecting `8453` fails with `altered_fields:chain_id`.

Acceptance of SD-008 requires the EXTEND-class spec amendment (`SD-005` envelope + `INV-SYS-011` + `OBJ-PRISM-005` persisted_fields → add `chain_id` as first ordered field, schema v2). This proposal records SD-008 as `UNDECIDED` until Jason decides; it does not pre-decide it.

---

## 5. What remains unresolved (owner/funding gates)

- **Target-network decision** — `DEC-PRISM-OPS-001` (or combined with `DEC-PRISM-SYS-003`) — **OPEN**. Funding/deploy path stays blocked on `UNDECIDED` until closed.
- **SD-008 chainId-v2** — `DEC-PRISM-SYS-003` — **OPEN** (red-team recommends ACCEPT as pre-deployment gate).
- **Funding gate** — funded deployer account + faucet plan for SN_SEPOLIA / Base Sepolia — **OPEN**; this bundle provides only secret-free templates (`ops/starknet/sncast.toml.example` etc.).
- **G0 mainnet reachability** — **NOT_IMPLEMENTED** (no mainnet evidence in this bundle).
- All other runtime rows `EVD-PRISM-004..007` remain `X0` / `NOT_IMPLEMENTED` until live-network observation.

---

## 6. Consumers (read-only)

- **Evidence envelope builder** (`src/features/evidence/evidence-envelope.ts`) — reads `manifest.yaml:environments[env]` for expected network/chainId, refuses promotion if `owner_decision.status != ACCEPTED`.
- **Harness** (`ops/testnet/decisive-sequence.harness.ts` + `DECISIVE_SEQUENCE_PROCEDURE.md`) — defaults to `testnet`, asserts observed RPC `SN_SEPOLIA` and `chainId 84532`.
- **sncast/provider templates** (`ops/starknet/sncast.toml.example`, `ops/starknet/provider.example.toml`, `ops/.env.example.sncast`) — env var names declared in manifest; values stay out of repo.
- **Review** (`BACKEND_BUNDLE_3T_REVIEW.md`) — traces this proposal to `AUDIT.md:G1/G2/G3`, `EVIDENCE_LEDGER.md:EVD-PRISM-004..007`, `TEST_ARCHITECTURE.md:T9/T11/T12`, Notion `SC-04/05/06/10/21`.

---

## 7. Validation (no deployment side-effect)

```bash
# Static manifest lint (no secrets, no RPC)
node ops/target-network/validate.mjs
# Expected before owner decision:
#   ✕ owner_decision UNDECIDED — correctly blocking deployment (PROPOSED, not ACCEPTED)

# After owner ACCEPT, envelope/harness consume the accepted environment only.
```

**Antagonist check:** a PR that edits `manifest.yaml:status` to `ACCEPTED` without an accompanying `DECISIONS.md` append-only record must be rejected in review — the file-level change alone is insufficient (this rule is enforced by `validate.mjs`).

---

*Governing principle: Research → Experiment → Build → Evidence. Testnet proves the mechanism; mainnet proves the evidence.*
