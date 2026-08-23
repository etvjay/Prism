#!/usr/bin/env node
// ops/evidence/validate.mjs — offline evidence-envelope validator, no RPC, no secrets
// Usage: node ops/evidence/validate.mjs <envelope.json> [--require-independent-read] [--forbid-strk20]
//        node ops/evidence/validate.mjs --self-test

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function canonicalStringify(v){
  if (v===null || typeof v!=="object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map(k=>`${JSON.stringify(k)}:${canonicalStringify(v[k])}`).join(",")}}`;
}

function isHex(v){ return typeof v==="string" && /^0x[0-9a-fA-F]{1,128}$/.test(v); }
function isNet(n){ return n==="SN_SEPOLIA" || n==="SN_MAIN"; }

function validate(env){
  const blockers=[]; const errors=[]; const warnings=[];
  if (!env.evidence_id) errors.push("evidence_id missing");
  if (!env.claim) errors.push("claim missing");
  if (!isNet(env.environment)) errors.push(`environment must be SN_SEPOLIA|SN_MAIN (got ${env.environment})`);
  if (!env.build?.commit_sha) errors.push("build.commit_sha missing");
  if (!env.build?.spec_versions || Object.keys(env.build.spec_versions).length===0) errors.push("build.spec_versions missing");
  if (!env.procedure || env.procedure.length===0) errors.push("procedure missing");
  if (!env.observed_at) errors.push("observed_at missing");
  if (!env.limitations || env.limitations.length===0) { errors.push("limitations missing — must document what is NOT evidenced"); blockers.push("limitations missing — must document what is NOT evidenced"); }
  const dep = env.deployment;
  if (!dep) blockers.push("deployment missing — need network, address, class_hash, deploy_tx, block_number, status");
  else {
    if (!isNet(dep.network)) errors.push("deployment.network invalid");
    if (env.environment !== dep.network) blockers.push(`wrong network: envelope ${env.environment} != deployment ${dep.network}`);
    if (!isHex(dep.address)) errors.push("deployment.address malformed");
    if (!isHex(dep.class_hash)) errors.push("deployment.class_hash malformed");
    if (!isHex(dep.deploy_tx)) errors.push("deployment.deploy_tx malformed");
    if (typeof dep.block_number!=="number" || !Number.isFinite(dep.block_number)) errors.push("deployment.block_number invalid");
    if (dep.status!=="SUCCEEDED") blockers.push(`deployment.status ${dep.status} — required SUCCEEDED`);
  }
  const txs = env.transactions||[];
  for(let i=0;i<txs.length;i++){
    const tx=txs[i];
    if (!isNet(tx.network)) errors.push(`transactions[${i}].network invalid`);
    if (tx.network!==env.environment) blockers.push(`wrong network: transactions[${i}] ${tx.network} != ${env.environment}`);
    if (!isHex(tx.hash)) errors.push(`transactions[${i}].hash malformed`);
    if (tx.block==null) blockers.push(`transactions[${i}].block missing`);
    if (!tx.status || tx.status==="UNKNOWN") blockers.push(`transactions[${i}].status missing/UNKNOWN`);
    if (tx.status==="REVERTED") blockers.push(`transactions[${i}].status REVERTED`);
  }
  const iv = env.independent_verification;
  if (!iv || (!iv.explorer_url && !iv.rpc_second_read)) blockers.push("independent_verification missing — need explorer_url or rpc_second_read");
  if (env.target_manifest && env.target_manifest.network !== env.environment) blockers.push(`target_manifest network ${env.target_manifest.network} != envelope ${env.environment}`);
  const inputChainId = env.inputs?.chainId ?? env.inputs?.chain_id;
  if (typeof inputChainId==="number" && env.target_manifest && env.target_manifest.chain_id !== inputChainId) blockers.push(`chainId target mismatch: inputs ${inputChainId} != manifest ${env.target_manifest.chain_id}`);
  // strk20 guard
  const writesStrk = (env.procedure||[]).some(p=>/write.*strk20\.json/i.test(p) && !/do not write|never write|must not write/i.test(p));
  if (writesStrk) { errors.push("procedure writes strk20.json"); blockers.push("procedure writes strk20.json — blocked"); }
  if (env.inputs?.writeStrk20Json===true) { errors.push("writeStrk20Json forbidden"); blockers.push("writeStrk20Json blocked"); }
  const isStrkPath = typeof env.evidence_id==="string" && env.evidence_id.toLowerCase().endsWith("strk20.json");
  if (isStrkPath) { errors.push("evidence_id must not be strk20.json"); blockers.push("strk20.json path blocked"); }

  let suggested = env.maturity||"X0";
  if (errors.length) suggested="X0";
  else if (blockers.length) {
    const hasIV = !!(iv?.explorer_url || iv?.rpc_second_read);
    if (!hasIV) suggested="X2";
    else if (["X3","X4","X5"].includes(suggested)) suggested="X2";
    if (suggested==="X0") suggested="X2";
  }
  const valid = errors.length===0;
  const promotable = valid && blockers.length===0;
  return { valid, promotable, blockers, suggestedMaturity: suggested, errors, warnings };
}

if (process.argv.includes("--self-test")){
  const okEnv = JSON.parse(readFileSync(resolve("ops/evidence/build.mjs"),"utf8").includes("fixtureValid") ? "{}" : "{}");
  // Build a fixture programmatically instead of parsing build.mjs
  const fixture = {
    evidence_id: "EVD-PRISM-004",
    claim: "self-test fixture",
    environment: "SN_SEPOLIA",
    build: { commit_sha: "5684163", spec_versions: { scarb:"2.20.0" }, observed_at: "2026-08-23T00:00:00Z" },
    procedure: ["scarb build"],
    inputs: { chainId: 84532 },
    deployment: { network:"SN_SEPOLIA", address:"0x01", class_hash:"0x02", deploy_tx:"0x03", block_number:1, status:"SUCCEEDED" },
    transactions: [{ network:"SN_SEPOLIA", hash:"0x03", block:1, status:"SUCCEEDED" }],
    contracts: [{ address:"0x01", class_hash:"0x02", name:"PrismIdentityRegistry" }],
    claim_scope: "test",
    limitations: ["none"],
    independent_verification: { explorer_url:"https://example/tx/0x03", rpc_second_read:{ block:1, status:"SUCCEEDED", address_match:true }, verified_at:"2026-08-23T00:00:00Z" },
    maturity:"X2",
    observed_at:"2026-08-23T00:00:00Z",
    target_manifest:{ environment:"testnet", network:"SN_SEPOLIA", chain_id:84532 },
    promotion_blockers:[],
  };
  const r = validate(fixture);
  console.log(`valid=${r.valid} promotable=${r.promotable} maturity=${r.suggestedMaturity}`);
  if (!r.valid || !r.promotable) { console.error("self-test fixture should be promotable"); process.exit(1); }
  // Now missing field should block
  const bad = { ...fixture, deployment: null };
  const r2 = validate(bad);
  if (r2.promotable) { console.error("missing field should not be promotable"); process.exit(1); }
  // strk20 guard
  const strk = { ...fixture, procedure: ["write strk20.json"] };
  const r3 = validate(strk);
  if (r3.promotable) { console.error("strk20 write should be blocked"); process.exit(1); }
  console.log("✓ validate.mjs --self-test: all promotion guards pass (missing field + strk20.json correctly blocked)");
  process.exit(0);
}

const file = process.argv.slice(2).find(a=>!a.startsWith("--"));
if (!file){
  console.error("usage: node ops/evidence/validate.mjs <envelope.json> [--require-independent-read]");
  process.exit(2);
}
const raw = readFileSync(resolve(file),"utf8");
let env;
try { env = JSON.parse(raw); } catch(e){ console.error(`✕ invalid JSON: ${e.message}`); process.exit(2); }

// Prevent validating a strk20.json file itself
if (file.toLowerCase().endsWith("strk20.json")){
  console.error("✕ envelope path is strk20.json — this file must never be an evidence envelope");
  process.exit(1);
}

const res = validate(env);
if (res.errors.length) { console.error("errors:"); res.errors.forEach(e=>console.error(`  ✕ ${e}`)); }
if (res.warnings.length) { console.error("warnings:"); res.warnings.forEach(w=>console.error(`  ! ${w}`)); }
if (res.blockers.length) { console.error("promotion blockers:"); res.blockers.forEach(b=>console.error(`  ⊘ ${b}`)); }
console.log(`\nvalid=${res.valid} promotable=${res.promotable} suggestedMaturity=${res.suggestedMaturity}`);
console.log(`canonical: ${canonicalStringify(env).slice(0,120)}…`);
if (!res.promotable) {
  console.error("\n⊘ NOT PROMOTABLE — correctly blocking EVIDENCE_LEDGER / X3+ until all receipt fields + independent read present.");
  process.exit(1);
}
console.log("\n✓ PROMOTABLE — envelope passes all deployment/testnet gates (caller must still record independent read + X maturity).");
