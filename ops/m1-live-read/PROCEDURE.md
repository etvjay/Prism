# M1 Live-Read / Evidence Procedure — Starknet Identity Phase Only

**Phase:** M1 `PrismIdentityRegistry` deploy + `create_identity` / `get_identity` live-read  
**Network:** `SN_SEPOLIA` (testnet) — `Base` `84532` is out of scope for M1; STRK20 / PrismChannel / Pause detached  
**Status:** `PROCEDURE — NO BROADCAST IN THIS BUNDLE`  
**Manifest:** `ops/target-network/manifest.yaml` (`status ACCEPTED`, `owner_decision ACCEPTED testnet`)  
**Contract:** `contracts/prism_identity_registry/src/lib.cairo` — immutable, no proxy (SD-002)  
**Envelope:** `src/features/evidence/m1-live-read.ts` + `src/features/evidence/evidence-envelope.ts` (offline, deterministic)  
**Harness:** `ops/m1-live-read/harness.mjs` (offline, TEST DOUBLE labeled; live variant is read-only)

This procedure validates the **already deployed** SN_SEPOLIA registry without fabricating
a Prism ID. The first `create_identity` broadcast remains owner/operator-executed
(see §5 — Owner/Operator Remainder).

---

## 0. Preconditions (all verified offline in this bundle)

- Worktree @ `7a385d2` (current HEAD).
- `ops/target-network/manifest.yaml` `status ACCEPTED` with `DEC-PRISM-OPS-001` mirrored in `projects/prism/DECISIONS.md`.
- No secrets in repo (`node ops/starknet/validate.mjs` ✓, `node ops/evidence/validate.mjs --self-test` ✓).
- `npm test` / `typecheck` / `build` green at X2 (see §7 of review packet).
- No `strk20.json` writes (`validate` blocks; tests assert; `strk20.json` remains `{"transactions":[],"contracts":[]}`).
- Deployment facts are **supplied by current evidence** (env file or envelope under `ops/m1-live-read/envelopes/` or `ops/evidence/envelopes/`). No address is hard-coded as live truth in this doc.

When the operator has deployed the registry, the live variant of this procedure
replaces fixture inputs with observed RPC data — recorded as a new envelope,
not retrofitted into this bundle.

---

## 1. Supplied evidence validation (offline)

The harness validates the four deployment facts the envelope requires
(`BACKEND_PRODUCTION_READINESS_PACKET §6.7` + `evidence-envelope.ts`):

```
network    SN_SEPOLIA  (must equal manifest.testnet.starknet.network)
address    0x… 64 hex  (contract address deployed via sncast deploy)
class_hash 0x… 64 hex  (Sierra class hash from sncast declare)
deploy_tx  0x… 64 hex  (hash that deployed / bound the contract)
block      number >0   (deploy block, status SUCCEEDED only)
status     SUCCEEDED   (REVERTED/UNKNOWN blocks promotion)
independent_read  explorer_url OR rpc_second_read {block,status,address_match}
```

**Offline check (no RPC, no secret):**

```bash
# 1. Manifest still ACCEPTED and secret-free
node ops/target-network/validate.mjs
node ops/starknet/validate.mjs

# 2. Envelope fixtures + cross-checks (X2)
node ops/m1-live-read/validate.mjs --self-test
npm test -- src/features/evidence/__tests__/m1-live-read.test.ts

# 3. Validate a supplied envelope (example: once deployed)
node ops/evidence/validate.mjs ops/m1-live-read/envelopes/sepolia-registry-20260823.json --require-independent-read
node ops/m1-live-read/validate.mjs ops/m1-live-read/envelopes/sepolia-registry-20260823.json
```

Expected offline result (this bundle, X2):
```
deployment present → structure valid
independent_verification absent → NOT PROMOTABLE, suggestedMaturity X2, blockers [independent_verification missing]
wrong network / address mismatch / malformed receipt / stale block → blockers with distinct reasons
envelope + M1 facets deterministic via canonicalStringify
```

Any envelope missing a promoter field stays under `ops/m1-live-read/envelopes/` or `ops/evidence/envelopes/` as preparatory evidence only; it is never copied into `EVIDENCE_LEDGER.md` or `strk20.json` until `SUCCEEDED` + independent read + address/class hash matched.

---

## 2. Read-only create/read procedure for the already deployed registry

**Rule: do not fabricate a Prism ID.** The harness never calls `create_identity`
without an explicit operator-funded broadcast path. All steps below are `call`
/ `getEvents` / `getBlock` — read only, no `invoke`.

### 2.1 Resolve registry deployment from supplied evidence

```
Input:  ops/m1-live-read/registry.json  (or envelope deployment block)
  { network: "SN_SEPOLIA", address: "0x…", class_hash: "0x…", deploy_tx: "0x…", block_number: N }

Check:  address == contracts[0].address
        class_hash == declared Sierra hash
        deploy_tx has status SUCCEEDED on SN_SEPOLIA (receipt)
        block_number >0 and matches explorer
        independent read present (Voyager tx page + second RPC read)
```

If the supplied file is missing, the harness exits `BLOCKED` with
`deployment missing — need network, address, class_hash, deploy_tx, block_number, status`.

### 2.2 Read-only `get_identity` (no broadcast)

**Via `starknet.js` (read-only, no signer):**

```ts
import { RpcProvider, Contract } from "starknet";
const provider = new RpcProvider({ nodeUrl: process.env.STARKNET_RPC_URL }); // or public Sepolia RPC
const registry = new Contract(abi, address, provider);
// Probe a known prismId (do not invent one — use an observed PrismIdentityCreated event's prism_id)
const res = await registry.call("get_identity", [prismId]);
// res is Option<Identity> — None for unknown, Some({controller, created_at_block, version}) for existing
// Record: prismId, controller, createdAtBlock, version, watermark = observed block, confirmedBlock = provider.getBlock("latest")
```

**Via `sncast` (read-only):**

```bash
sncast --profile sepolia call \
  --contract-address $REGISTRY_ADDRESS \
  --function get_identity \
  --calldata $PRISM_ID
# Returns 0 (= None) for unknown; or (controller, created_at_block, version) for existing
```

**What not to do:**

```
✕ sncast invoke create_identity   — broadcast, operator only
✕ fabricating prismId "prism:P999" and treating None as evidence of anything
✕ using get_identity result as proof without cross-checking event + watermark
```

### 2.3 Read-only event + indexer read

```bash
# Events are the canonical history (EVENT_CATALOGUE: PrismIdentityCreated only in M1)
# Use indexer adapter with injected reader — no secret, paginated, deduped by (txHash, eventIndex)

# starknet.js equivalent (read-only):
await provider.getEvents({
  from_block: { block_number: deployBlock },
  to_block: "latest",
  address: REGISTRY_ADDRESS,
  keys: [["0x2c3cc45f2ad701f3571bc1faaf7d37e194064f8e8e3269b8642fc31624960e7"]], // PrismIdentityCreated selector
  chunk_size: 100,
});

# Harness indexer facet (offline, TEST DOUBLE) demonstrates:
# - deterministic ordering (block_number, txHash, eventIndex)
# - deduplication by (txHash:eventIndex)
# - watermark = max(blockNumber) | null
# - continuation_token pagination (fetchAllRegistryEvents)
```

### 2.4 Watermark freshness

```
isStaleProjection(watermark, confirmedBlock, K)  with K=5 (QRY-8-01, INV-SYS-007)

watermark null          → stale (X2)
watermark 90, confirmed 100, K=5 → stale (90 < 95) → blocker
watermark 96, confirmed 100, K=5 → fresh (96 >= 95) → promotable (if other checks pass)
```

Collected alongside every read: `watermark`, `confirmedBlock`, `boundK`, `isStale`.

### 2.5 Typed envelope recording

For each live read, build one envelope per facet (or one M1 envelope with facets):

```ts
import { buildM1Envelope, buildM1GetIdentityFixture } from "@/features/evidence/m1-live-read";

const getIdentityFacet = buildM1GetIdentityFixture({ prismId:"1", controller:"0x…", watermark, confirmedBlock, staleBoundK:5 });
const envelope = buildM1Envelope({
  deployment: { network:"SN_SEPOLIA", address, class_hash, deploy_tx, block_number, status:"SUCCEEDED" },
  getIdentityFixture: getIdentityFacet,
  indexerFixture: buildM1IndexerFixture({ registryAddress: address, events, watermark }),
  watermarkFixture: buildM1WatermarkFixture({ projectionWatermark: watermark, confirmedBlock, boundK:5 }),
  independentVerification: { explorer_url: voyagerTxUrl, rpc_second_read: { block, status:"SUCCEEDED", address_match:true }, verified_at },
});
validateEvidenceEnvelope(envelope) + runM1CrossChecks(envelope) must be promotable before any ledger copy.
```

All serialization is deterministic (`canonicalStringify` — sorted keys, no whitespace). Two builds with same inputs yield identical `envelopeHash`.

---

## 3. Cross-checks (promotion blockers)

Every envelope is run through `runM1CrossChecks`:

| Failure mode | Detection | Blocker text |
|---|---|---|
| **wrong network** | `envelope.environment != SN_SEPOLIA` or `tx.network != SN_SEPOLIA` | `wrong network: envelope SN_MAIN != deployment SN_SEPOLIA` |
| **address mismatch** | `deployment.address != contracts[0].address` or `observed RPC address != deployment.address` | `address mismatch: deployment 0x01 != contracts[0] 0x02` |
| **missing independent read** | `explorer_url==null && rpc_second_read==null` | `independent_verification missing` → downgrade to `X2`, not promotable |
| **malformed receipt** | bad hex, `status UNKNOWN/REVERTED`, `block null` | `malformed receipt: …` + structural `errors` |
| **stale block** | `watermark < confirmedBlock - K` or `watermark null` | `stale block: watermark 90 < confirmed 100 - K 5` |

Sibling cases (also blockers): `deployment missing`, `class_hash malformed`, `chainId target mismatch` (`inputs.chainId != manifest base.chain_id 84532`), `procedure writes strk20.json`.

---

## 4. Live testnet run (OWNER/OPERATOR — NOT IN THIS BUNDLE)

Only after funding + owner gate, the operator executes the **first**
`create_identity` broadcast (the only state-changing M1 step):

```bash
# Env (outside repo — values redacted, never committed)
export STARKNET_RPC_URL="https://starknet-sepolia.g.alchemy.com/v2/..."
export NEXT_PUBLIC_STARKNET_NETWORK="SN_SEPOLIA"
export STARKNET_SEPOLIA_DEPLOYER_PRIVATE_KEY="<env only — never commit>"
# or: export STARKNET_SEPOLIA_KEYSTORE_PATH=~/.starknet-accounts/keystores/sepolia.json

# 1. Deploy registry (immutable, SD-002) — record envelope
sncast --profile sepolia declare --contract-name PrismIdentityRegistry
sncast --profile sepolia deploy --class-hash <CLASS_HASH> --constructor-calldata
# Capture: network SN_SEPOLIA, address, class_hash, deploy_tx, block, status SUCCEEDED
# Independent read: second RpcProvider + Voyager explorer URL

# 2. First live create_identity (operator-signed, sequencer atomic)
sncast --profile sepolia invoke \
  --contract-address $REGISTRY_ADDRESS \
  --function create_identity
# Capture: txHash, block, status, PrismIdentityCreated event (prism_id, controller)

node ops/m1-live-read/validate.mjs ops/m1-live-read/envelopes/sepolia-create-20260823.json --require-independent-read

# 3. Read-back + event + watermark (read-only, no second broadcast)
sncast --profile sepolia call --contract-address $REGISTRY_ADDRESS --function get_identity --calldata <PRISM_ID>
# Fetch events: provider.getEvents({address: $REGISTRY_ADDRESS, keys:[[PrismIdentityCreated]]})
# Watermark: getEvents watermark vs getBlock("latest") → isStaleProjection

# 4. Evidence promotion (X3 testnet, only after observed SUCCEEDED + independent read)
# Copy validated envelope fields into EVIDENCE_LEDGER.md via yaml template — EVD-PRISM-004 X0 → X3
# No strk20.json writes from M1 logic
```

Abort conditions (any → `FAILED_RETRYABLE`/`requires_attention`, never `completed`):
- `observed network != SN_SEPOLIA` → `wrong network` blocker.
- `address mismatch` vs RPC `getClassHashAt` → blocker.
- `execution_status != SUCCEEDED` / `REVERTED` → blocker.
- `independent_verification` absent → downgrade to `X2`, not promotable.
- Any secret missing → harness throws `missing_secret` before any RPC (read-only path needs no secret; write path does).
- `watermark` stale (`< confirmed-K`) → `stale block` blocker.
- `strk20.json` write attempted → build throws, validator rejects.

---

## 5. What remains owner/operator-executed

The following are **not** executed by this harness and remain owner/operator work
for the first live `create_identity` broadcast:

1. **Fund a Starknet Sepolia deployer account** (seed fee token + declare/deploy balance).
2. **`sncast declare` PrismIdentityRegistry** — record `class_hash`.
3. **`sncast deploy` with `--class-hash` + constructor calldata** — record `address`, `deploy_tx`, `block`, verify `class_hash` at address via `getClassHashAt`.
4. **Hold/steward the deployer private key or keystore** (env-only, never committed; no private key handling in this lane).
5. **Broadcast the first `create_identity`** (`sncast invoke` or WalletAccount) — the only M1 state change; harness is read-only until this exists.
6. **Capture the `PrismIdentityCreated` receipt** (`txHash`, `block`, `status SUCCEEDED`, event `prism_id`/`controller`) and confirm with **second RPC read**.
7. **Produce Voyager/explorer URLs** for deploy tx + create tx (independent verification).
8. **Decide how many further `create_identity` calls to run** (each allocates a new `prism_id`; re-use avoids double costs).
9. **Gate mainnet:** M1 must not write `strk20.json`; `SN_MAIN` is release-gated (`manifest.yaml:mainnet RELEASE_GATED_PROPOSED`).

No broadcast, signer, or secret is handled by the M1 harness itself.

---

## 6. Mapping

| Procedure step | System artifact | Gates |
|---|---|---|
| validate deploy facts | `OP-7-01`/`OP-7-02`, `OBJ-PRISM-001`, `TEST-7-2-1/3/5-1` | `G1` registry deploy (`AUDIT.md §13`) |
| create_identity receipt + event | `CONTRACT_SPEC OP-7-01`, `EVENT_CATALOGUE PrismIdentityCreated`, `INV-SYS-001/002/005` | `T4` contract unit, `T9` ledger indexing |
| get_identity read + watermark | `CONTRACT_SPEC OP-7-02`, `QRY-7-01`, `INV-SYS-007` | `T9` indexer, `T12` stale recovery |
| indexer fetch + dedup | `EVENT_CATALOGUE reconstruction guarantee`, `StarknetEventIndexerAdapter` | `T9` ledger integration, `T12` duplicate handling |
| watermark freshness | `QRY-8-01`, `INV-SYS-007`, `isStaleProjection` | `T12` |
| cross-checks (5 modes) | `INV-SYS-002/004/005/007`, `ERROR_CATALOGUE ERR-001..004`, `manifest R04/R06` | `T11` E2E decisive prep, `T12` failure |
| submitted≠completed | `SM-PRISM-003`, `INV-SYS-005`, `AUTHORITY_MATRIX §4` | `G1`, `T12` |
| strk20 guard | `INV-PRISM-016`, `EVIDENCE_LEDGER Mainnet Receipt Rule` | `G8` |

Harness authenticity is `T4` (registry call), `T9` (event/indexer), `T11` (decisive pre-condition), `T12` (failure/watermark/stale/malformed).

---

## 7. Evidence produced

- **Dry-run (this bundle):** fixture envelopes under `ops/m1-live-read/envelopes/` labeled `TEST DOUBLE`, `X2` only, `NOT PROMOTABLE` (no live deploy, no independent read, no real `prismId`) — stays preparatory.
- **Live run (next packet, operator-executed):** per-step envelopes with `deployment`, `transactions[].block/status`, `event`, `indexer.watermark`, `get_identity.watermark`, `independent_verification`, `limitations`, `build.commit_sha` + `spec_versions`, promoted to `EVIDENCE_LEDGER.md` at `X3` (testnet, `EVD-PRISM-004`).

Tests assert determinism and that promotion is blocked for: wrong network, address mismatch, missing independent read, malformed receipt, stale block, `strk20.json` writes.

---

*No live deployment or Prism ID claim is made by this doc. Any execution using fixtures, InMemoryRegistry, or the offline harness reader is explicitly a local controlled double, not live network evidence — X maturity stays X2 until a live SN_SEPOLIA observe with independent read.*
