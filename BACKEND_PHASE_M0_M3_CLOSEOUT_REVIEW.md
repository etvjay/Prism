# Backend Phase M0/M3 Closeout Review — Parent Tree 457378b

**Worktree:** `/home/ubuntu/prism-work/phase-m0-m3-closeout` HEAD `457378b` `docs(prism): record post-integration convergence redteam`
**Model:** Muse Spark 1.2 free (review-only, no ChatGPT/Codex)
**Scope:** M0 + M3 only per `projects/prism/agent-packets/PRISM_PARENT_CLOSEOUT_GOAL.md:1-72`; Phase 8 / frontend / M8/M9 / `strk20.json` excluded
**Static checks only:** `git diff --check` + file reads listed in task; no secrets, no broadcast, no deploy, no push

---

## M0 — Product/System Release Contract

**Governing plan:** `projects/prism/agent-packets/PRISM_MAINNET_PHASE_PLAN.md:52-84` defines M0 exit as `one accepted Product/System release contract + no unresolved contradiction in selected MVP path + all deferred features explicit`.

**Accepted decisions (from `projects/prism/DECISIONS.md` and `ops/target-network/manifest.yaml`):**

- `DEC-PRISM-001..018` canonical Product/System truth (Starknet root, `PrismID != address`, venue-native execution, Starknet+Base MVP, STRK20 first surface, wallet API first, privacy observer-specific, shadow-account excluded, own-contract rule) `projects/prism/DECISIONS.md:8-252`
- `DEC-PRISM-SYS-001` Option A trust model — backend verifies Base ladder (EOA→1271→6492), Starknet controller signs bind, registry enforces `caller==controller` + single-use digest `projects/prism/DECISIONS.md:254-285`
- `DEC-PRISM-SYS-003` chainId-v2 `ACCEPT` — `chain_id` first ordered field, manifest-scoped, no silent fallback, `e8886af` as mandatory pre-deploy gate `projects/prism/DECISIONS.md:288-316` + `ops/target-network/manifest.yaml:19`
- `DEC-PRISM-OPS-001` testnet `SN_SEPOLIA + Base Sepolia 84532 ACCEPTED`, `SN_MAIN + 8453 RELEASE_GATED_PROPOSED` `projects/prism/DECISIONS.md:318-352` mirrored `ops/target-network/manifest.yaml:31-84`
- `DEC-PRISM-M5-001` `PrismVesuLendingHelper` selected for M5 testnet route; PrismClaim deferred `projects/prism/DECISIONS.md:355-383`; vesu probe observed `projects/prism/M5_LIVE_HELPER_VESU_PROBE.md:1-115` (M5-scoped, does not close M0)

**Manifest:** `ops/target-network/manifest.yaml:12-13,31-35` `status ACCEPTED`, `owner_decision ACCEPTED testnet` `DEC-PRISM-OPS-001` `2026-08-23T18:27:26Z`.

**Exact remaining owner decision (not invented, not canonicalized):**

Per `projects/prism/agent-packets/PRISM_MAINNET_PHASE_PLAN.md:35-44,82-83`:

> Which release band is being shipped? Is Prism Pause a mainnet requirement or a post-mainnet enhancement? Band A — Identity MVP mainnet (persistent Prism ID + native Base binding + truthful Home/operation surface) vs Band B — Pause-enabled Prism mainnet (Band A + Prism Pause as pre-settlement control boundary). Current state: `M5 helper route recorded in DEC-PRISM-M5-001, but the overall Band A vs Band B release choice and Pause-as-mainnet-promise decision remain open.`

No `DEC-*-M0-*` record selects Band A or Band B; no Pause P0 canonicalization for mainnet. Parent Closeout Goal lane goal restates: `M0 canonical Band A/B and Pause promise decision` `projects/prism/agent-packets/PRISM_PARENT_CLOSEOUT_GOAL.md:34-46` is not yet recorded.

**Non-negotiables respected:** no `strk20.json` writes (`ops/evidence/README.md:81-83` guard), no worker push/Linear/Notion/frontend `projects/prism/agent-packets/PRISM_PARENT_CLOSEOUT_GOAL.md:49-52`.

**Verdict:** `M0_BLOCKED_BY_OWNER_RELEASE_BAND`

---

## M3 — Base Connection and Decisive Identity Proof

**Known funded/deployed facts from parent docs (no inference beyond files):**

- Starknet infrastructure deployed on `SN_SEPOLIA` `projects/prism/agent-packets/PRISM_MAINNET_PHASE_PLAN.md:125`
- Wallets funded and Starknet infrastructure deployed; **no live Base proof/bind/resolve/revoke sequence has been observed** `projects/prism/agent-packets/PRISM_MAINNET_PHASE_PLAN.md:220-222`
- Target network accepted for testnet: `SN_SEPOLIA` + `Base Sepolia 84532` `ops/target-network/manifest.yaml:32-48`; mainnet `RELEASE_GATED_PROPOSED` `ops/target-network/manifest.yaml:52-70`
- `DEC-PRISM-SYS-001` Option A authorizes the proof ladder + controller-signed bind model `projects/prism/DECISIONS.md:254-263`; `DEC-PRISM-OPS-001` notes remaining gates include `funded Base Sepolia EOA proof ladder` and `independent RPC/explorer readback` `projects/prism/DECISIONS.md:340-345`; none are evidenced at X3.
- Evidence maturity gates `AUDIT.md:375-378` G2/G3 `NOT_IMPLEMENTED`; required `M1 create_identity` live `SN_SEPOLIA` receipt also open `ops/m1-live-read/PROCEDURE.md:11-13,203-235,248-262`
- M5 probe artifacts (`0x047c0f8b…131c` account, helper classes `0x07f3dd9a…90adf`) `projects/prism/M5_LIVE_HELPER_VESU_PROBE.md:11-31` are M5-scoped and do not substitute for M3 decisive proof.

**Exact live sequence still required (per `projects/prism/agent-packets/PRISM_MAINNET_PHASE_PLAN.md:176-192` and `projects/prism/agent-packets/PRISM_PARENT_CLOSEOUT_GOAL.md:40`):**

```
Base proof → controller bind → ACTIVE resolve → revoke → empty resolve
```

Expanded per plan `PRISM_MAINNET_PHASE_PLAN.md:183-191`:

```
connect Base EOA → issue chainId-v2 challenge (chainId 84532 per manifest) → Base wallet signs
→ backend verifies EOA/1271/6492 class → controller signs Starknet bind → registry consumes digest
→ resolve(P, BASE) = B → revoke B → resolve(P, BASE) = NO_ACTIVE_DESTINATION → get_identity(P) still succeeds
```

Adversarial cases required but not yet observed: wrong signer, altered recipient/Prism ID/domain/venue/chainId, expired challenge, nonce/digest replay, wrong Starknet controller, duplicate active destination, stale indexer `PRISM_MAINNET_PHASE_PLAN.md:193-205`. Each step needs `operation IDs / signature class / bind+revoke tx hashes / receipt status SUCCEEDED / block numbers / independent reads / watermark` `PRISM_MAINNET_PHASE_PLAN.md:210-218` via deterministic envelope `ops/evidence/README.md:7-19`.

**Authority — no worker signing/broadcast:**

Per `PRISM_PARENT_CLOSEOUT_GOAL.md:49-59` non-negotiables + `ops/m1-live-read/PROCEDURE.md:248-263` owner/operator remainder: **no worker may sign, invoke, or broadcast** `create_identity`, Base challenge, bind, or revoke. The first `create_identity`, Base proof, and Starknet `bind` are parent/operator-executed with funded accounts and independent Voyager + second RPC read; workers perform only offline validation (`git diff --check`, `node ops/target-network/validate.mjs`, `node ops/evidence/validate.mjs --self-test`).

**Verdict:** `M3_BLOCKED_BY_PARENT_SIGNING`

---

**Static checks run:**

```
git diff --check → clean (no whitespace errors)
head 457378b verified (git rev-parse HEAD)
ops/target-network/manifest.yaml status ACCEPTED with DEC-PRISM-OPS-001 mirrored
No strk20.json writes; strk20.json remains {"transactions":[],"contracts":[]}
```

M0_BLOCKED_BY_OWNER_RELEASE_BAND
M3_BLOCKED_BY_PARENT_SIGNING
