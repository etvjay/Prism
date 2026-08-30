#!/usr/bin/env node
// Fail-closed SN_MAIN release gate. Offline: reads only a supplied JSON packet.
// Usage: node ops/release/validate-mainnet.mjs <packet.json>
//        node ops/release/validate-mainnet.mjs --self-test

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HEX = /^0x[0-9a-fA-F]{2,128}$/;
const PLACEHOLDER = /<|YOUR_|REPLACE|TODO|TBD|example|dummy|placeholder/i;
const required = (value, label, errors) => {
  if (value === undefined || value === null || value === "" || (typeof value === "string" && PLACEHOLDER.test(value))) errors.push(`${label} is missing, placeholder, or not exact`);
};

export function validate(packet) {
  const errors = [];
  if (packet?.release_status !== "MAINNET_READY") errors.push("release_status must be MAINNET_READY");
  if (packet?.environment !== "SN_MAIN") errors.push("environment must be SN_MAIN");
  if (packet?.network?.starknet !== "SN_MAIN") errors.push("network.starknet must be SN_MAIN");
  if (packet?.network?.base_chain_id !== 8453) errors.push("network.base_chain_id must be exact integer 8453");
  if (!packet?.owner_decision || packet.owner_decision.status !== "ACCEPTED") errors.push("owner_decision.status must be ACCEPTED");
  for (const key of ["decision_id", "decided_by", "decided_at", "signature"]) required(packet?.owner_decision?.[key], `owner_decision.${key}`, errors);

  const figures = packet?.mainnet_figures;
  if (!figures || typeof figures !== "object") errors.push("mainnet_figures is required");
  else {
    if (figures.starknet_chain_id !== "SN_MAIN") errors.push("mainnet_figures.starknet_chain_id must be SN_MAIN");
    if (figures.base_chain_id !== 8453) errors.push("mainnet_figures.base_chain_id must be exact integer 8453");
    required(figures.pool_address, "mainnet_figures.pool_address", errors);
    if (!HEX.test(figures.pool_address ?? "")) errors.push("mainnet_figures.pool_address must be an exact hex address");
    if (figures.required_final_transaction_count !== 3) errors.push("required_final_transaction_count must be exactly 3");
    if (!Array.isArray(figures.final_submission_hashes) || figures.final_submission_hashes.length !== 3 || figures.final_submission_hashes.some(h => !HEX.test(h) || PLACEHOLDER.test(h))) errors.push("final_submission_hashes must contain exactly 3 exact transaction hashes");
    const hv = figures.hub_validator;
    if (!hv || hv.ok !== true || hv.pool !== true || hv.mine !== true) errors.push("hub_validator must be observed exactly as ok=true, pool=true, mine=true");
    for (const key of ["pool_event_tx_hash", "pool_event_block", "validator_source", "verified_at"]) required(figures[key], `mainnet_figures.${key}`, errors);
  }

  if (!Array.isArray(packet.contracts) || packet.contracts.length === 0) errors.push("contracts must list every required mainnet contract");
  else packet.contracts.forEach((c, i) => {
    for (const key of ["name", "address", "class_hash", "deployment_block", "constructor_calldata"]) required(c?.[key], `contracts[${i}].${key}`, errors);
    if (!HEX.test(c?.address ?? "") || !HEX.test(c?.class_hash ?? "")) errors.push(`contracts[${i}] address/class_hash must be exact hex`);
    if (!Number.isSafeInteger(c?.deployment_block) || c.deployment_block <= 0) errors.push(`contracts[${i}].deployment_block must be exact positive integer`);
    const r = c?.receipt;
    if (!r || r.status !== "ACCEPTED" || !HEX.test(r.tx_hash ?? "") || !Number.isSafeInteger(r.block) || r.block <= 0) errors.push(`contracts[${i}] requires exact accepted deployment receipt (tx_hash, block, status)`);
    const iv = c?.independent_read;
    if (!iv || iv.address_match !== true || iv.class_hash_match !== true || !iv.provider || !iv.verified_at) errors.push(`contracts[${i}] requires independent address/class-hash readback`);
  });

  const wp = packet.wallet_prover;
  if (!wp || wp.status !== "OBSERVED") errors.push("wallet_prover.status must be OBSERVED");
  else for (const key of ["wallet_provider", "wallet_address", "prover_provider", "proof_id", "receipt_tx_hash", "verified_at"]) required(wp[key], `wallet_prover.${key}`, errors);
  return { ok: errors.length === 0, errors };
}

function runSelfTest() {
  const exact = "0x" + "1".repeat(64);
  const packet = {
    release_status: "MAINNET_READY", environment: "SN_MAIN", network: { starknet: "SN_MAIN", base_chain_id: 8453 },
    owner_decision: { status: "ACCEPTED", decision_id: "DEC-PRISM-MAINNET-001", decided_by: "owner", decided_at: "2026-01-01T00:00:00Z", signature: "signed-decision" },
    mainnet_figures: { starknet_chain_id: "SN_MAIN", base_chain_id: 8453, pool_address: exact, required_final_transaction_count: 3, final_submission_hashes: [exact, exact, exact], hub_validator: { ok: true, pool: true, mine: true }, pool_event_tx_hash: exact, pool_event_block: 1, validator_source: "independent", verified_at: "2026-01-01T00:00:00Z" },
    contracts: [{ name: "registry", address: exact, class_hash: exact, deployment_block: 1, constructor_calldata: "0x1", receipt: { tx_hash: exact, block: 1, status: "ACCEPTED" }, independent_read: { provider: "independent", address_match: true, class_hash_match: true, verified_at: "2026-01-01T00:00:00Z" } }],
    wallet_prover: { status: "OBSERVED", wallet_provider: "wallet", wallet_address: exact, prover_provider: "prover", proof_id: "proof-1", receipt_tx_hash: exact, verified_at: "2026-01-01T00:00:00Z" }
  };
  if (!validate(packet).ok || validate({ ...packet, mainnet_figures: { ...packet.mainnet_figures, final_submission_hashes: [] } }).ok || validate({ ...packet, owner_decision: { ...packet.owner_decision, status: "PROPOSED" } }).ok) throw new Error("self-test failed");
  console.log("✓ mainnet release validator self-test passed (complete packet passes; missing figures/owner decision fail closed)");
}

if (process.argv.includes("--self-test")) { runSelfTest(); process.exit(0); }
const file = process.argv.slice(2).find(a => !a.startsWith("--"));
if (!file) { console.error("usage: node ops/release/validate-mainnet.mjs <packet.json> [--json]"); process.exit(2); }
let packet;
try { packet = JSON.parse(readFileSync(resolve(file), "utf8")); } catch (e) { console.error(`✕ invalid packet JSON: ${e.message}`); process.exit(2); }
const result = validate(packet);
if (!result.ok) { console.error("✕ NOT MAINNET_READY — fail-closed blockers:"); result.errors.forEach(e => console.error(`  ⊘ ${e}`)); process.exit(1); }
console.log("✓ MAINNET_READY packet satisfies exact figures, receipts, independent reads, wallet/prover evidence, and owner decision gates");
