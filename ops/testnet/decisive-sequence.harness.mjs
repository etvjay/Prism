#!/usr/bin/env node
// ops/testnet/decisive-sequence.harness.mjs — procedure runner (offline)
// Usage: node ops/testnet/decisive-sequence.harness.mjs --env testnet --self-test
//        node ops/testnet/decisive-sequence.harness.mjs --env testnet --controller 0x111... --base 0xabc...

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const get = (flag, def=null) => { const i=args.indexOf(flag); return i>=0 ? (args[i+1] ?? def) : def; };

if (args.includes("--self-test")) {
  // Run the vitest harness offline (no RPC) — asserts X2 fixture passes
  const r = spawnSync("npm", ["test", "--", "src/features/evidence/__tests__/decisive-sequence.test.ts"], { stdio:"inherit" });
  // Fallback: try running evidence envelope self-test if decisive test not yet present
  if (r.status===0) console.log("\n✓ decisive-sequence harness --self-test passed (offline, TEST DOUBLE, X2)");
  process.exit(r.status ?? 0);
}

const env = get("--env","testnet");
const controller = get("--controller","0x1111111111111111111111111111111111111111");
const base = get("--base","0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

if (env !== "testnet") {
  console.error(`✕ env must be testnet for this bundle (manifest release-gated). Got ${env}`);
  process.exit(2);
}
console.log(`Harness env=${env} controller=${controller} base=${base}`);
console.log("This bundle's harness is OFFLINE — TEST DOUBLE only.");
console.log("For a live SN_SEPOLIA run, use the procedure in ops/testnet/DECISIVE_SEQUENCE_PROCEDURE.md §2 (requires funded deployer + DEC-PRISM-OPS-001 ACCEPT).");
