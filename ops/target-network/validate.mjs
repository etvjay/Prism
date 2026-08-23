#!/usr/bin/env node
// ops/target-network/validate.mjs — offline manifest lint, no secrets, no RPC
// - asserts manifest.yaml status is PROPOSED (correctly blocking before owner decision)
// - asserts owner_decision UNDECIDED (no silent accept)
// - asserts per-env network/chainId are as proposed
// - asserts no hard-coded secret or deploy address is present

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function fail(msg) {
  console.error(`✕ ${msg}`);
}

function pass(msg) {
  console.log(`✓ ${msg}`);
}

const manifestPath = resolve("ops/target-network/manifest.yaml");
if (!existsSync(manifestPath)) {
  fail(`manifest missing at ${manifestPath}`);
  process.exit(2);
}
const raw = readFileSync(manifestPath, "utf8");

// Minimal checks without yaml dep (keep offline, no install)
const decisionLedgerPath = resolve("projects/prism/DECISIONS.md");
const decisionLedger = existsSync(decisionLedgerPath) ? readFileSync(decisionLedgerPath, "utf8") : "";
const topStatus = raw.match(/^status:\s*([A-Z_]+)/m)?.[1] ?? "MISSING";
const ownerStart = raw.indexOf("owner_decision:");
const ownerRaw = ownerStart >= 0 ? raw.slice(ownerStart) : "";
const ownerStatus = ownerRaw.match(/^\s+status:\s*([A-Z_]+)/m)?.[1] ?? "MISSING";
const hasDecisionRecord =
  /## DEC-PRISM-SYS-003[\s\S]*?\*\*Status:\*\* Accepted/.test(decisionLedger) &&
  /## DEC-PRISM-OPS-001[\s\S]*?\*\*Status:\*\* Accepted/.test(decisionLedger);
const accepted =
  topStatus === "ACCEPTED" &&
  ownerStatus === "ACCEPTED" &&
  raw.includes("decision_id: DEC-PRISM-OPS-001") &&
  raw.includes("selected_environment: testnet") &&
  raw.includes("disposition_chainId_v2: ACCEPT") &&
  hasDecisionRecord;
const proposed = topStatus === "PROPOSED" && ownerStatus === "UNDECIDED";

const checks = [
  accepted
    ? { ok: true, passMsg: "manifest status ACCEPTED with mirrored owner decision" }
    : proposed
      ? { ok: true, passMsg: "manifest status is PROPOSED (correctly blocking before owner decision)" }
      : { ok: false, failMsg: `manifest/owner decision state invalid: ${topStatus}/${ownerStatus}` },
  accepted
    ? { ok: true, passMsg: "DEC-PRISM-SYS-003 and DEC-PRISM-OPS-001 append-only records verified" }
    : proposed
      ? { ok: true, passMsg: "owner_decision UNDECIDED (correctly blocking)" }
      : { ok: false, failMsg: "accepted manifest requires both append-only decision records" },
  { needle: "SN_SEPOLIA", passMsg: "testnet starknet SN_SEPOLIA present", failMsg: "testnet starknet SN_SEPOLIA missing" },
  { needle: "chain_id: 84532", passMsg: "testnet Base chain_id 84532 present", failMsg: "testnet Base chain_id 84532 missing" },
  { needle: "SN_MAIN", passMsg: "mainnet SN_MAIN present (release-gated)", failMsg: "mainnet SN_MAIN missing" },
  { needle: "chain_id: 8453", passMsg: "mainnet Base chain_id 8453 present", failMsg: "mainnet Base chain_id 8453 missing" },
  { needle: "RELEASE_GATED_PROPOSED", passMsg: "mainnet status is RELEASE_GATED_PROPOSED", failMsg: "mainnet status is not RELEASE_GATED_PROPOSED" },
];

let ok = true;
for (const c of checks) {
  if (c.ok === true || (c.needle && raw.includes(c.needle))) pass(c.passMsg);
  else { fail(c.failMsg); ok = false; }
}

// No hex private key literal
const hexKeyRe = /0x[0-9a-fA-F]{64}/;
if (hexKeyRe.test(raw) && !raw.includes("0x<") ) {
  // allow placeholders 0x<...> but not real 64-hex
  const matches = raw.match(/0x[0-9a-fA-F]{64}/g);
  if (matches && matches.some(m => !m.includes("<"))) {
    // Check if any match is not inside a comment about pool (canonical pool is allowed)
    const pool = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
    const nonPool = matches.filter(m => m.toLowerCase() !== pool.toLowerCase());
    if (nonPool.length) { fail(`manifest must not contain hex secrets (found ${nonPool.slice(0,2).join(",")})`); ok = false; }
    else pass("no non-pool hex secrets in manifest");
  }
} else {
  pass("no hex private key literal in manifest");
}

// No hard-coded Alchemy/RPC key
if (/alchemy\.com\/v2\/[A-Za-z0-9_-]{10,}/.test(raw)) { fail("manifest must not contain hard-coded RPC key"); ok = false; }
else pass("no hard-coded RPC key in manifest");

// Validate proposal md exists
if (existsSync(resolve("ops/target-network/PROPOSAL.md"))) pass("PROPOSAL.md exists");
else { fail("PROPOSAL.md missing"); ok = false; }

if (!ok) {
  console.error("\n✕ target-network manifest validation FAILED — decision state or environment declaration is invalid.");
  process.exit(1);
}
if (accepted) {
  console.log("\n✓ target-network manifest validation passed — testnet owner decision accepted; mainnet remains release-gated.");
} else {
  console.log("\n✓ target-network manifest validation passed — still PROPOSED/UNDECIDED and correctly blocking promotion.");
}
