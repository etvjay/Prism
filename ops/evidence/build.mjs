#!/usr/bin/env node
// ops/evidence/build.mjs — deterministic fixture builder (offline, no RPC, no secrets)
// Usage: node ops/evidence/build.mjs --self-test
//        node ops/evidence/build.mjs --fixture valid --out /tmp/envelope.json

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);

function fixtureValid() {
  return {
    envelope_version: 1,
    evidence_id: "EVD-PRISM-004",
    claim: "PrismIdentityRegistry deploy + create/read on SN_SEPOLIA (fixture, TEST DOUBLE)",
    environment: "SN_SEPOLIA",
    build: { commit_sha: "5684163", spec_versions: { scarb: "2.20.0", snforge: "0.63.0", starknet: "10.4.0" }, observed_at: "2026-08-23T00:00:00Z" },
    procedure: ["scarb build", "snforge test", "TEST DOUBLE: sncast deploy (simulated)"],
    inputs: { chainId: 84532 },
    deployment: { network: "SN_SEPOLIA", address: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", class_hash: "0x0abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789", deploy_tx: "0x0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0dead", block_number: 12345, status: "SUCCEEDED" },
    transactions: [{ network: "SN_SEPOLIA", hash: "0x0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0dead", block: 12345, status: "SUCCEEDED" }],
    contracts: [{ address: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", class_hash: "0x0abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789", name: "PrismIdentityRegistry" }],
    hub_validator: null,
    claim_scope: "fixture only — no live network contact",
    limitations: ["TEST DOUBLE — no live RPC; independent read present in this fixture but downgraded by validate.mjs when absent"],
    independent_verification: { explorer_url: "https://sepolia.voyager.online/tx/0x0dead", rpc_second_read: { block: 12345, status: "SUCCEEDED", address_match: true }, verified_at: "2026-08-23T00:00:00Z" },
    maturity: "X2",
    observed_at: "2026-08-23T00:00:00Z",
    target_manifest: { environment: "testnet", network: "SN_SEPOLIA", chain_id: 84532 },
    promotion_blockers: [],
  };
}

if (args.includes("--self-test")) {
  const out = fixtureValid();
  const canon = JSON.stringify(out, Object.keys(out).sort(), 2);
  console.log(canon);
  console.log("\n✓ build.mjs --self-test: deterministic fixture emitted (no RPC, TEST DOUBLE labeled)");
  process.exit(0);
}

const fixture = args.includes("--fixture") ? args[args.indexOf("--fixture")+1] : "valid";
const outPath = args.includes("--out") ? args[args.indexOf("--out")+1] : null;

let envelope = fixtureValid();
if (fixture === "missing-field") {
  envelope = { ...envelope, deployment: null };
}

if (outPath) {
  mkdirSync(resolve(outPath, ".."), { recursive: true });
  writeFileSync(resolve(outPath), JSON.stringify(envelope, null, 2));
  console.log(`wrote ${outPath}`);
}
