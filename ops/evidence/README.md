# Evidence Envelope — deterministic builder/validator

**Module:** `src/features/evidence/evidence-envelope.ts` (pure, deterministic, offline)  
**CLI:** `ops/evidence/build.mjs` / `ops/evidence/validate.mjs` (offline, no RPC)  
**Manifest:** `ops/target-network/manifest.yaml` is the expected network/chainId source.

The envelope captures the minimum live-deployment facts the `BACKEND_PRODUCTION_READINESS_PACKET.md §6.7` template requires for every deployment or decisive-sequence run:

- **network** (`SN_SEPOLIA` default, `SN_MAIN` release-gated)
- **address** (contract address)
- **class hash** (Sierra class hash)
- **deploy tx** (hash that deployed / bound the contract)
- **blocks** (deploy block + operation blocks)
- **status** (`SUCCEEDED` only is promotable)
- **independent reads** (explorer URL + RPC second-read block/status/address_match)
- **limitations** (what is NOT evidenced)
- **commit/spec versions** (`commit_sha` + `spec_versions: {scarb, snforge, starknet,…}`)
- **maturity** (`X0..X5` — downgraded to `X2` when independent read absent)

All serialization is deterministic (`canonicalStringify` — sorted keys, no whitespace). Promotion is blocked when any required field or receipt is missing; no code path writes `strk20.json`.

---

## Build (offline, test-double fixture)

```ts
import { buildEvidenceEnvelope } from "@/features/evidence/evidence-envelope";

const envelope = buildEvidenceEnvelope({
  evidence_id: "EVD-PRISM-004",
  claim: "PrismIdentityRegistry deploy + create/read on SN_SEPOLIA",
  environment: "SN_SEPOLIA",
  build: { commit_sha: "5684163", spec_versions: { scarb:"2.20.0", snforge:"0.63.0", starknet:"10.4.0" } },
  procedure: ["scarb build", "snforge test", "sncast deploy --profile sepolia (simulated)"],
  inputs: { chainId: 84532 },
  deployment: {
    network: "SN_SEPOLIA",
    address: "0x1234…",
    class_hash: "0xabcd…",
    deploy_tx: "0xdead…",
    block_number: 12345,
    status: "SUCCEEDED",
  },
  transactions: [{ network:"SN_SEPOLIA", hash:"0xdead…", block:12345, status:"SUCCEEDED" }],
  contracts: [{ address:"0x1234…", class_hash:"0xabcd…", name:"PrismIdentityRegistry" }],
  claim_scope: "deploy receipt only — no binding yet",
  limitations: ["no independent read yet → X2 ceiling"],
  independent_verification: { explorer_url: null, rpc_second_read: null, verified_at: null },
  maturity: "X2",
  target_manifest: { environment:"testnet", network:"SN_SEPOLIA", chain_id:84532 },
});
```

## Validate (offline, deterministic)

```ts
import { validateEvidenceEnvelope } from "@/features/evidence/evidence-envelope";
const { valid, promotable, blockers, suggestedMaturity } = validateEvidenceEnvelope(envelope);
// valid=false when structure missing; promotable=false when any blocker present
// blockers includes: "deployment missing", "wrong network", "status REVERTED",
//   "independent_verification missing", "chainId target mismatch", etc.
// suggestedMaturity is downgraded to X2 when independent read absent.
```

## CLI (offline)

```bash
# Build a fixture envelope deterministically
node ops/evidence/build.mjs --self-test

# Validate an envelope file (no RPC, no secrets)
node ops/evidence/validate.mjs ops/evidence/fixtures/valid-sepolia-deploy.json
node ops/evidence/validate.mjs ops/evidence/fixtures/missing-field.json --require-independent-read

# All validators reject strk20.json writes
node ops/evidence/validate.mjs /tmp/envelope.json --forbid-strk20
```

## Promotion rule

- `valid && promotable && independent_verification present && status SUCCEEDED` → may be copied into `EVIDENCE_LEDGER.md` via the yaml template at `X3` (testnet) / `X4/X5` (mainnet + second read).
- Any `blockers.length > 0` → **not promotable**; envelope stays under `ops/evidence/envelopes/` as preparatory evidence only.
- **No code path writes `strk20.json`.** The builder throws if `procedure` or `inputs.writeStrk20Json` attempts it; `validate.mjs` rejects it; tests assert it.

## Determinism

- `canonicalStringify` produces byte-identical output for logically identical envelopes (keys sorted). Two builds with same inputs yield identical `envelopeHash`.
- Tests assert determinism and that envelope promotion is blocked for: chainId target mismatch, missing secrets/receipt fields, malformed receipt (bad hex, UNKNOWN status), wrong network, absent independent read.

---

*No live deployment or runtime claim is made by this module. Test doubles are explicitly labeled “TEST DOUBLE” in harness/tests.*
