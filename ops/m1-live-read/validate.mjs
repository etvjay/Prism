#!/usr/bin/env node
// ops/m1-live-read/validate.mjs — offline M1 envelope validator (no RPC, no secrets)
// Validates: deployment facts (network/address/class_hash/deploy_tx/blocks/status),
// typed facets create_identity/get_identity/event/indexer/watermark, and the 5 cross-checks.
// Usage:
//   node ops/m1-live-read/validate.mjs --self-test
//   node ops/m1-live-read/validate.mjs <envelope.json> [--require-independent-read] [--forbid-strk20]
//   node ops/m1-live-read/validate.mjs <envelope.json> --expected-address 0x... --expected-class-hash 0x...

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function isHex(v) { return typeof v === "string" && /^0x[0-9a-fA-F]{1,128}$/.test(v); }
function isNet(n) { return n === "SN_SEPOLIA" || n === "SN_MAIN"; }

function canonicalStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalStringify(v[k])}`).join(",")}}`;
}

function validateM1Envelope(env) {
  const blockers = []; const errors = []; const warnings = [];
  if (!env.evidence_id) errors.push("evidence_id missing");
  if (!env.claim) errors.push("claim missing");
  if (!isNet(env.environment)) errors.push(`environment must be SN_SEPOLIA|SN_MAIN (got ${env.environment})`);
  if (!env.build?.commit_sha) errors.push("build.commit_sha missing");
  if (!env.build?.spec_versions || Object.keys(env.build.spec_versions).length === 0) errors.push("build.spec_versions missing");
  if (!env.procedure || env.procedure.length === 0) errors.push("procedure missing");
  if (!env.observed_at) errors.push("observed_at missing");
  if (!env.limitations || env.limitations.length === 0) { errors.push("limitations missing — must document what is NOT evidenced"); blockers.push("limitations missing — must document what is NOT evidenced"); }

  const dep = env.deployment;
  if (!dep) blockers.push("deployment missing — need network, address, class_hash, deploy_tx, block_number, status");
  else {
    if (!isNet(dep.network)) errors.push("deployment.network invalid");
    if (env.environment !== dep.network) blockers.push(`wrong network: envelope ${env.environment} != deployment ${dep.network}`);
    if (!isHex(dep.address)) errors.push("deployment.address malformed");
    if (!isHex(dep.class_hash)) errors.push("deployment.class_hash malformed");
    if (!isHex(dep.deploy_tx)) errors.push("deployment.deploy_tx malformed");
    if (typeof dep.block_number !== "number" || !Number.isFinite(dep.block_number)) errors.push("deployment.block_number invalid");
    if (dep.status !== "SUCCEEDED") blockers.push(`deployment.status ${dep.status} — required SUCCEEDED`);
  }

  // Address mismatch: deployment vs contracts[0]
  if (dep && env.contracts && env.contracts.length > 0) {
    const depAddr = dep.address?.toLowerCase();
    const cAddr = env.contracts[0].address?.toLowerCase();
    if (depAddr && cAddr && depAddr !== cAddr) blockers.push(`address mismatch: deployment ${depAddr} != contracts[0] ${cAddr}`);
    const depHash = dep.class_hash?.toLowerCase();
    const cHash = env.contracts[0].class_hash?.toLowerCase();
    if (depHash && cHash && depHash !== cHash) blockers.push(`address mismatch: deployment class_hash ${depHash} != contracts[0] ${cHash}`);
  }

  const txs = env.transactions || [];
  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i];
    if (!isNet(tx.network)) errors.push(`transactions[${i}].network invalid`);
    if (tx.network !== env.environment) blockers.push(`wrong network: transactions[${i}] ${tx.network} != ${env.environment}`);
    if (!isHex(tx.hash)) errors.push(`transactions[${i}].hash malformed`);
    if (tx.block == null) blockers.push(`transactions[${i}].block missing`);
    if (!tx.status || tx.status === "UNKNOWN") blockers.push(`transactions[${i}].status missing/UNKNOWN — malformed receipt`);
    if (tx.status === "REVERTED") blockers.push(`transactions[${i}].status REVERTED`);
  }

  const iv = env.independent_verification;
  if (!iv || (!iv.explorer_url && !iv.rpc_second_read)) blockers.push("missing independent read — need explorer_url or rpc_second_read (address_match)");
  if (env.target_manifest && env.target_manifest.network !== env.environment) blockers.push(`target_manifest network ${env.target_manifest.network} != envelope ${env.environment}`);
  const inputChainId = env.inputs?.chainId ?? env.inputs?.chain_id;
  if (typeof inputChainId === "number" && env.target_manifest && env.target_manifest.chain_id !== inputChainId) blockers.push(`chainId target mismatch: inputs ${inputChainId} != manifest ${env.target_manifest.chain_id}`);

  // Stale block: check inputs.watermark vs inputs.confirmedBlock if present
  const projWm = env.inputs?.watermark?.projectionWatermark ?? env.inputs?.getIdentity?.watermark ?? env.inputs?.indexer?.watermark ?? null;
  const confirmed = env.inputs?.watermark?.confirmedBlock ?? env.inputs?.confirmedBlock ?? null;
  if (typeof projWm === "number" && typeof confirmed === "number") {
    const K = env.inputs?.watermark?.boundK ?? env.inputs?.getIdentity?.staleBoundK ?? 5;
    if (projWm < confirmed - K) blockers.push(`stale block: watermark ${projWm} < confirmed ${confirmed} - K ${K}`);
  }
  if (projWm === null && confirmed !== null) blockers.push("stale block: watermark null — cannot prove freshness");

  // strk20 guard
  const writesStrk = (env.procedure || []).some(p => /write.*strk20\.json/i.test(p) && !/do not write|never write|must not write/i.test(p));
  if (writesStrk) { errors.push("procedure writes strk20.json"); blockers.push("procedure writes strk20.json — blocked"); }
  if (env.inputs?.writeStrk20Json === true) { errors.push("writeStrk20Json forbidden"); blockers.push("writeStrk20Json blocked"); }
  if (typeof env.evidence_id === "string" && env.evidence_id.toLowerCase().endsWith("strk20.json")) { errors.push("evidence_id must not be strk20.json"); blockers.push("strk20.json path blocked"); }

  // M1 facet checks: if inputs.facets includes create_identity but transactions empty → blocker
  const facets = env.inputs?.facets ?? [];
  if (facets.includes("create_identity") && (!txs || txs.length === 0)) blockers.push("create_identity facet declared but transactions empty — malformed receipt");
  if (facets.includes("event") && !env.inputs?.event?.selector) warnings.push("event facet without selector — incomplete event evidence");
  if (facets.includes("indexer") && typeof env.inputs?.indexer?.watermark !== "number" && env.inputs?.indexer?.watermark !== null) warnings.push("indexer facet without watermark");

  let suggested = env.maturity || "X0";
  if (errors.length) suggested = "X0";
  else if (blockers.length) {
    const hasIV = !!(iv?.explorer_url || iv?.rpc_second_read);
    if (!hasIV) suggested = "X2";
    else if (["X3", "X4", "X5"].includes(suggested)) suggested = "X2";
    if (suggested === "X0") suggested = "X2";
  }
  const valid = errors.length === 0;
  const promotable = valid && blockers.length === 0;
  return { valid, promotable, blockers, suggestedMaturity: suggested, errors, warnings };
}

if (process.argv.includes("--self-test")) {
  const fixture = {
    evidence_id: "EVD-PRISM-004",
    claim: "M1 self-test fixture",
    environment: "SN_SEPOLIA",
    build: { commit_sha: "7a385d2", spec_versions: { scarb: "2.20.0" }, observed_at: "2026-08-23T00:00:00Z" },
    procedure: ["scarb build", "M1 facets: create_identity, get_identity, event, indexer, watermark — TEST DOUBLE"],
    inputs: { chainId: 84532, facets: ["create_identity", "get_identity", "event", "indexer", "watermark"], watermark: { projectionWatermark: 12345, confirmedBlock: 12348, boundK: 5 } },
    deployment: { network: "SN_SEPOLIA", address: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", class_hash: "0x0abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789", deploy_tx: "0x0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0dead", block_number: 12345, status: "SUCCEEDED" },
    transactions: [{ network: "SN_SEPOLIA", hash: "0x0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0dead", block: 12345, status: "SUCCEEDED" }],
    contracts: [{ address: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", class_hash: "0x0abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789", name: "PrismIdentityRegistry" }],
    claim_scope: "M1 fixture — no live RPC",
    limitations: ["TEST DOUBLE — no live RPC", "no strk20.json"],
    independent_verification: { explorer_url: "https://sepolia.voyager.online/tx/0x0dead", rpc_second_read: { block: 12345, status: "SUCCEEDED", address_match: true }, verified_at: "2026-08-23T00:00:00Z" },
    maturity: "X3",
    observed_at: "2026-08-23T00:00:00Z",
    target_manifest: { environment: "testnet", network: "SN_SEPOLIA", chain_id: 84532 },
    promotion_blockers: [],
  };
  const r = validateM1Envelope(fixture);
  console.log(`valid=${r.valid} promotable=${r.promotable} maturity=${r.suggestedMaturity}`);
  if (!r.valid || !r.promotable) { console.error("self-test fixture should be promotable", r); process.exit(1); }
  // wrong network
  const wrongNet = { ...fixture, environment: "SN_MAIN" };
  const r2 = validateM1Envelope(wrongNet);
  if (r2.promotable) { console.error("wrong network should not be promotable"); process.exit(1); }
  // address mismatch
  const mismatch = { ...fixture, contracts: [{ address: "0x0222222222222222222222222222222222222222222222222222222222222222", class_hash: fixture.deployment.class_hash, name: "PrismIdentityRegistry" }] };
  const r3 = validateM1Envelope(mismatch);
  if (r3.promotable) { console.error("address mismatch should be blocked"); process.exit(1); }
  // missing independent read
  const noIV = { ...fixture, independent_verification: { explorer_url: null, rpc_second_read: null, verified_at: null } };
  const r4 = validateM1Envelope(noIV);
  if (r4.promotable) { console.error("missing independent read should not be promotable"); process.exit(1); }
  // malformed receipt
  const bad = { ...fixture, transactions: [{ network: "SN_SEPOLIA", hash: "0xzzzz", block: null, status: "UNKNOWN" }] };
  const r5 = validateM1Envelope(bad);
  if (r5.promotable) { console.error("malformed receipt should not be promotable"); process.exit(1); }
  // stale block
  const stale = { ...fixture, inputs: { ...fixture.inputs, watermark: { projectionWatermark: 90, confirmedBlock: 100, boundK: 5 } } };
  const r6 = validateM1Envelope(stale);
  if (r6.promotable) { console.error("stale block should not be promotable"); process.exit(1); }
  // strk20 guard
  const strk = { ...fixture, procedure: ["write strk20.json"] };
  const r7 = validateM1Envelope(strk);
  if (r7.promotable) { console.error("strk20 write should be blocked"); process.exit(1); }
  console.log("✓ validate.mjs --self-test: all 5 cross-checks + strk20 correctly block promotion");
  process.exit(0);
}

const file = process.argv.slice(2).find(a => !a.startsWith("--") && !a.startsWith("--expected"));
if (!file) {
  console.error("usage: node ops/m1-live-read/validate.mjs <envelope.json> [--require-independent-read] [--expected-address 0x...] [--expected-class-hash 0x...]");
  process.exit(2);
}
if (file.toLowerCase().endsWith("strk20.json")) {
  console.error("✕ envelope path is strk20.json — this file must never be an evidence envelope");
  process.exit(1);
}
const raw = readFileSync(resolve(file), "utf8");
let env;
try { env = JSON.parse(raw); } catch (e) { console.error(`✕ invalid JSON: ${e.message}`); process.exit(2); }

// Optional explicit address/class hash cross-check against supplied evidence file
const expectedAddress = process.argv.includes("--expected-address") ? process.argv[process.argv.indexOf("--expected-address") + 1] : null;
const expectedClassHash = process.argv.includes("--expected-class-hash") ? process.argv[process.argv.indexOf("--expected-class-hash") + 1] : null;
if (expectedAddress && env.deployment && env.deployment.address.toLowerCase() !== expectedAddress.toLowerCase()) {
  console.error(`✕ address mismatch: envelope ${env.deployment.address} != expected ${expectedAddress}`);
  process.exit(1);
}
if (expectedClassHash && env.deployment && env.deployment.class_hash.toLowerCase() !== expectedClassHash.toLowerCase()) {
  console.error(`✕ class_hash mismatch: envelope ${env.deployment.class_hash} != expected ${expectedClassHash}`);
  process.exit(1);
}

const res = validateM1Envelope(env);
if (res.errors.length) { console.error("errors:"); res.errors.forEach(e => console.error(`  ✕ ${e}`)); }
if (res.warnings.length) { console.error("warnings:"); res.warnings.forEach(w => console.error(`  ! ${w}`)); }
if (res.blockers.length) { console.error("promotion blockers:"); res.blockers.forEach(b => console.error(`  ⊘ ${b}`)); }
console.log(`\nvalid=${res.valid} promotable=${res.promotable} suggestedMaturity=${res.suggestedMaturity}`);
console.log(`canonical: ${canonicalStringify(env).slice(0, 140)}…`);
if (!res.promotable) {
  console.error("\n⊘ NOT PROMOTABLE — correctly blocking EVIDENCE_LEDGER / X3+ until all receipt fields + independent read + watermark freshness present.");
  process.exit(1);
}
console.log("\n✓ PROMOTABLE — M1 envelope passes all deployment + facet + cross-check gates.");
