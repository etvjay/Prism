# M1 Live-Read / Evidence Harness — Starknet Identity Phase Only

**Module:** `src/features/evidence/m1-live-read.ts` (pure, deterministic, offline)  
**CLI:** `ops/m1-live-read/validate.mjs` (offline) / `ops/m1-live-read/harness.mjs` (offline-first, read-only live option)  
**Procedure:** `ops/m1-live-read/PROCEDURE.md`  
**Tests:** `src/features/evidence/__tests__/m1-live-read.test.ts` (offline, TEST DOUBLE)  
**Manifest:** `ops/target-network/manifest.yaml` (`status ACCEPTED`, `owner_decision ACCEPTED testnet`) is the expected network source.

This harness validates the **already deployed** SN_SEPOLIA `PrismIdentityRegistry` without
fabricating a Prism ID and without broadcasting. It covers five typed facets:

- `create_identity` — deploy receipt `txHash/block/status` + `PrismIdentityCreated` event (`prism_id`, `controller`, `selector`)
- `get_identity` — read `controller`, `created_at_block`, `version`, `exists`, `watermark`
- `event` — canonical event `selector`, `correlationId` (`txHash:eventIndex`), payload, ordering
- `indexer` — `fetchRegistryEvents` pagination, deterministic ordering, dedup by `(txHash, eventIndex)`, `watermark`
- `watermark` — `isStaleProjection(watermark, confirmedBlock, K)` bounded staleness (`K=5`)

All serialization is deterministic (`canonicalStringify` — sorted keys, no whitespace).
Promotion is blocked when any required field, receipt, independent read, or freshness check is missing; no code path writes `strk20.json`.

---

## Offline build (fixture, TEST DOUBLE)

```ts
import { buildM1Envelope, buildM1GetIdentityFixture, buildM1EventFixture, buildM1IndexerFixture, buildM1WatermarkFixture } from "@/features/evidence/m1-live-read";

const envelope = buildM1Envelope({
  deployment: {
    network: "SN_SEPOLIA",
    address: "0x0123…",
    class_hash: "0xabcd…",
    deploy_tx: "0xdead…",
    block_number: 12345,
    status: "SUCCEEDED",
  },
  createIdentityTx: { network:"SN_SEPOLIA", hash:"0xdead…", block:12345, status:"SUCCEEDED" },
  getIdentityFixture: buildM1GetIdentityFixture({ prismId:"1", watermark:12345, confirmedBlock:12348 }),
  eventFixture: buildM1EventFixture({}),
  indexerFixture: buildM1IndexerFixture({}),
  watermarkFixture: buildM1WatermarkFixture({ projectionWatermark:12345, confirmedBlock:12348, boundK:5 }),
  independentVerification: { explorer_url:"https://sepolia.voyager.online/tx/0xdead", rpc_second_read:{block:12345,status:"SUCCEEDED",address_match:true}, verified_at:"2026-08-23T00:00:00Z" },
});
```

## Offline validate (deterministic, no RPC)

```ts
import { runM1CrossChecks, validateM1CreateIdentity, validateM1GetIdentity } from "@/features/evidence/m1-live-read";
const { valid, promotable, blockers, suggestedMaturity } = runM1CrossChecks({ envelope, watermarkFixture, indexerFixture });
// blockers includes: "wrong network", "address mismatch", "missing independent read",
//   "malformed receipt", "stale block" — each distinct
```

## CLI (offline)

```bash
# All 5 cross-checks + strk20 guard deterministically block promotion
node ops/m1-live-read/validate.mjs --self-test

# Validate a supplied envelope (no RPC, no secrets)
node ops/m1-live-read/validate.mjs ops/m1-live-read/envelopes/sepolia-registry-fixture.json
node ops/m1-live-read/validate.mjs ops/m1-live-read/envelopes/sepolia-registry-fixture.json --expected-address 0x... --expected-class-hash 0x...

# Read-only live check (no broadcast, no private key) — requires public RPC + deployed address
node ops/m1-live-read/harness.mjs --env testnet --registry 0x... --prism-id 1 --rpc https://starknet-sepolia.public.blastapi.io/rpc/v0_7
# Without --rpc, harness is offline TEST DOUBLE and exits 0 without network contact

# Also: generic envelope validator (still offline, no secrets)
node ops/m1-live-read/harness.mjs --self-test
npm test -- src/features/evidence/__tests__/m1-live-read.test.ts
```

## Promotion rule

- `valid && promotable && independent_verification present && status SUCCEEDED && watermark fresh` → may be copied into `EVIDENCE_LEDGER.md` via yaml template at `X3` (testnet, `EVD-PRISM-004`).
- Any `blockers.length > 0` → **not promotable**; envelope stays under `ops/m1-live-read/envelopes/` as preparatory evidence only.
- **No code path writes `strk20.json`.** The builder throws if `procedure` or `inputs.writeStrk20Json` attempts it; `validate.mjs` rejects it; tests assert it.

## Determinism

- `canonicalStringify` produces byte-identical output for logically identical envelopes (keys sorted). Two builds with same inputs yield identical `envelopeHash`.
- Tests assert determinism and that envelope promotion is blocked for: wrong network, address mismatch, missing independent read, malformed receipt (bad hex, UNKNOWN, missing block), stale block, and `strk20.json` writes.

## What remains operator-executed

See `ops/m1-live-read/PROCEDURE.md §5`: funding, `declare`/`deploy`, class-hash verify, first `create_identity` broadcast, receipt + second-RPC capture, Voyager URLs, and mainnet gating. This harness is read-only until that operator step exists.

---

*No live deployment or Prism ID claim is made by this module. Any execution using fixtures is explicitly labeled “TEST DOUBLE” in harness/tests.*
