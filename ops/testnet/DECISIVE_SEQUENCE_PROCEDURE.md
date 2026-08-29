# Testnet Decisive-Sequence Procedure — Bundle 3T (Evidence-Preparation)

**Status:** `PROCEDURE — NO LIVE DEPLOYMENT IN THIS BUNDLE`  
**Manifest:** `ops/target-network/manifest.yaml` (testnet = SN_SEPOLIA + Base Sepolia 84532, default)  
**Envelope:** `src/features/evidence/evidence-envelope.ts` + `ops/evidence/validate.mjs`  
**Harness:** `src/features/evidence/decisive-sequence-harness.ts` (offline, TEST DOUBLE labeled) / `ops/testnet/decisive-sequence.harness.mjs` (procedure runner, offline)

This procedure exercises the **decisive Prism proof** `CANONICAL_STATE.md §10` on the testnet envelope:

> Create Prism ID P on Starknet → prove control of Base account B → bind B to P → resolve(P,BASE)=B → revoke B → resolve(P,BASE)=NO_ACTIVE_DESTINATION → P still exists

It is the minimum proof that Prism is not a name-to-address record and that `INV-SYS-002/003/004/006/007` hold.

---

## 0. Preconditions (all offline in this bundle)

- Worktree @ `5684163`, `backend-bundle-3t` isolation.
- `ops/target-network/manifest.yaml` status `PROPOSED` / `owner_decision UNDECIDED` — harness refuses live RPC until owner `ACCEPTS` via `DEC-PRISM-OPS-001`.
- No secrets in repo (`ops/starknet/validate.mjs` ✓).
- `npm test` / `typecheck` / `build` green at X2.
- No `strk20.json` writes (envelope validator blocks; tests assert).

When the owner funds a deployer, the live variant of this procedure replaces the TEST DOUBLE ports with real `RpcProvider` + `Base` RPC + funded wallets — recorded as a new packet (V8.5), not retrofitted into this bundle.

---

## 1. Offline dry-run (this bundle — TEST DOUBLE)

```bash
# 1. Manifest is correctly blocking live promotion
node ops/target-network/validate.mjs

# 2. Templates are secret-free
node ops/starknet/validate.mjs

# 3. Evidence envelope guards
node ops/evidence/validate.mjs --self-test

# 4. Decisive sequence — offline, deterministic, TEST DOUBLE
npm test -- src/features/evidence/__tests__/decisive-sequence.test.ts
# or
node ops/testnet/decisive-sequence.harness.mjs --env testnet --self-test
```

Expected offline result (X2):

```
create P          -> operation submitted (not completed), controller = caller
read P            -> get_identity returns {controller, created_at_block}, exists=true
issue challenge   -> challenge {chain_id:84532, domain, venue:BASE, account, prism_id} — digest bound
Base proof        -> EOA ecrecover verified (TEST DOUBLE checker — labeled undetermined→ERR-021 on real 1271)
controller bind   -> Starknet controller signs bind_execution_identity(prism_id, BASE, account, proof_digest) — submitted, not completed
resolve pre-revoke -> resolve(P,BASE)=B (ACTIVE)
revoke            -> revoke_binding(prism_id,BASE,B) — submitted, not completed
resolve post-revoke -> resolve(P,BASE)=NO_ACTIVE_DESTINATION (INV-SYS-007)
Prism ID persists -> get_identity(P) succeeds, P still ACTIVE (INV-SYS-006)
envelope          -> deployment+txs+independent_verification=null → X2, NOT PROMOTABLE (validator: independent_verification missing)
```

The harness asserts:

- `submitted ≠ completed` at every chain-touching step (INV-SYS-005 / INV-PRISM-015) — illegal `submitted→completed` skip throws `ERR-023`.
- `chainId` target mismatch fails with `altered_fields:chain_id` (SD-008).
- Wrong controller fails `ERR-004` before any binding.
- Replay fails `ERR-006` (nonce) / `ERR-007` (digest) — never double-consumed.
- Expired proof fails `ERR-013`.
- No step writes `strk20.json` (builder throws; test asserts).

---

## 2. Live testnet run (OWNER-APPROVAL PACKET — NOT IN THIS BUNDLE)

Only after `DEC-PRISM-OPS-001 ACCEPTS` testnet and a funded SN_SEPOLIA deployer exists:

```bash
# Env (outside repo — values redacted)
export STARKNET_RPC_URL="https://starknet-sepolia.g.alchemy.com/v2/..."
export NEXT_PUBLIC_STARKNET_NETWORK="SN_SEPOLIA"
export BASE_RPC_URL="https://sepolia.base.org"
export BASE_CHAIN_ID=84532   # must equal manifest base.chain_id
export STARKNET_SEPOLIA_DEPLOYER_PRIVATE_KEY="<env only — never commit>"
# or: export STARKNET_SEPOLIA_KEYSTORE_PATH=~/.starknet-accounts/keystores/sepolia.json

# 1. Deploy registry (immutable, SD-002) — record envelope
sncast --profile sepolia declare --contract-name PrismIdentityRegistry
sncast --profile sepolia deploy --class-hash <CLASS_HASH> --constructor-calldata <...>
# Capture: network SN_SEPOLIA, address, class_hash, deploy_tx, block, status SUCCEEDED
# Independent read: second RPC + Voyager explorer URL

node ops/evidence/build.mjs --env testnet --deploy-tx <TX> --out ops/evidence/envelopes/sepolia-deploy-$(date +%Y%m%d).json
node ops/evidence/validate.mjs ops/evidence/envelopes/sepolia-deploy-*.json --require-independent-read

# 2. Decisive sequence on live SN_SEPOLIA + Base Sepolia
npm run testnet:decisive -- --env testnet --prism-id auto --base-address 0x<BASE_SEPOLIA_EOA> --controller <STARKNET_SEPOLIA_ACCOUNT>
# The harness caller supplies the funded wallets; the procedure records every step:
#   create tx, read block, challengeId/digest, signature class (EOA|1271|6492), bind tx, resolve block/watermark, revoke tx, final resolve sentinel
#   Every tx is validated: network SN_SEPOLIA, block present, status SUCCEEDED, class_hash matched, independent read present

# 3. Evidence promotion
# Copy the validated envelope's fields into EVIDENCE_LEDGER.md using the yaml template — maturity X3 (testnet)
# Ledger row EVD-PRISM-004..007 moves X0 → X3 only after observed live create/read/bind/resolve/revoke
# No strk20.json writes from testnet logic (INV-PRISM-016 belongs to Phase 5 helper)
```

Live-run abort conditions (any triggers immediate `FAILED_RETRYABLE` / `requires_attention`, never `completed`):

- `observed network != SN_SEPOLIA` → envelope `wrong network` blocker.
- `Base chainId != 84532` → `altered_fields:chain_id`.
- `execution_status != SUCCEEDED` / `REVERTED` → `reverted` blocker.
- `independent_verification` absent → downgrade to `X2`, not promotable.
- Any secret missing (`STARKNET_RPC_URL` unset) → harness throws `missing_secret` before any RPC.
- Malformed receipt (bad hex, unknown status) → envelope `malformed` error.
- `strk20.json` write attempted → build throws, validator rejects.

---

## 3. Evidence produced

- Dry-run (this bundle): fixture envelopes under `ops/evidence/envelopes/` labeled `TEST DOUBLE`, `X2` only, `NOT PROMOTABLE` — stays preparatory.
- Live run (next packet, owner-approved): per-step envelopes with `deployment`, `transactions[].block/status`, `independent_verification`, `limitations`, `build.commit_sha` + `spec_versions`, promoted to `EVIDENCE_LEDGER.md` at `X3`.

---

## 4. Mapping to system artifacts

| Procedure step | System artifact | Notion SC (proposed) |
|---|---|---|
| create P + read P | `OP-7-01`/`OP-7-02`, `OBJ-PRISM-001`, `TEST-7-2-1/2/3/4` | SC-04 resolve honesty pre-condition |
| Base proof ladder | `CMD-B-01/02`, `OBJ-PRISM-005`, `INV-SYS-009/010/011`, `TEST-8-1-1/2/3`, `TEST-8-2-1..7` | SC-10 nonce single-use, SC-11 digest single-use |
| controller bind | `OP-8-01`, `SM-PRISM-002 TR-8-01`, `INV-SYS-002/003/004` | SC-04 one ACTIVE per (prism_id,venue) |
| resolve pre-revoke | `OP-8-02`, `QRY-8-01`, `INV-SYS-007` | SC-04 Resolve as Recorded |
| revoke | `OP-8-03`, `TR-8-02`, `INV-SYS-006` | SC-05 Revocation persistence |
| resolve NO_ACTIVE + P persists | `SM-PRISM-002` terminal REVOKED → no reactivation, `FT-001` | SC-05 + SC-06 reconstruction |
| submitted≠completed + reconciliation | `SM-PRISM-003`, `INV-SYS-005`, `AUTHORITY_MATRIX §4` | SC-06 ledger/operation boundary |

All steps keep `INV-SYS-005` (submitted≠completed), use deterministic canonical serialization, and are tested via `TEST_ARCHITECTURE T9` (ledger integration) + `T11` (E2E decisive) + `T12` (failure/recovery).

---

*TEST DOUBLE labeling: any execution using `InMemoryRegistry`, `LocalErc1271SemanticsChecker`, or `InMemoryOperationStore` is explicitly a local controlled double, not live network evidence — X maturity stays X2 until a live SN_SEPOLIA observe with independent read.*
