#!/usr/bin/env node
// Fail-closed SN_MAIN release gate. Offline: reads only a supplied JSON packet.
// Usage: node ops/release/validate-mainnet.mjs <packet.json>
//        node ops/release/validate-mainnet.mjs --self-test

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Starknet transaction/address/class hashes are 251-bit felts serialized as
// exactly 32 bytes. Refuse shortened display strings and ambiguous values.
const HEX64 = /^0x[0-9a-fA-F]{64}$/;
const PLACEHOLDER = /<|YOUR_|REPLACE|TODO|TBD|example|dummy|placeholder/i;
const REQUIRED_CONTRACT_IDENTITIES = ["PrismIdentityRegistry", "PrismAllocationHelper", "PrismVesuLendingHelper", "PrismLayerZeroBase"];
const exactString = (value, label, errors) => {
  required(value, label, errors);
  if (typeof value !== "string" || PLACEHOLDER.test(value)) return;
  if (value.trim() !== value) errors.push(`${label} must not contain surrounding whitespace`);
};
const required = (value, label, errors) => {
  if (value === undefined || value === null || value === "" || (typeof value === "string" && PLACEHOLDER.test(value))) errors.push(`${label} is missing, placeholder, or not exact`);
};
const positiveBlock = (value, label, errors) => {
  if (!Number.isSafeInteger(value) || value <= 0) errors.push(`${label} must be exact positive integer`);
};
const exactHash = (value, label, errors) => {
  required(value, label, errors);
  if (!HEX64.test(value ?? "")) errors.push(`${label} must be an exact 32-byte hex value`);
};

export function validate(packet) {
  const errors = [];
  if (packet?.release_status !== "MAINNET_READY") errors.push("release_status must be MAINNET_READY");
  if (packet?.environment !== "SN_MAIN") errors.push("environment must be SN_MAIN");
  if (packet?.network?.starknet !== "SN_MAIN") errors.push("network.starknet must be SN_MAIN");
  if (packet?.network?.base_network !== "Base Mainnet") errors.push("network.base_network must be Base Mainnet");
  if (packet?.network?.base_chain_id !== 8453) errors.push("network.base_chain_id must be exact integer 8453");
  if (!packet?.owner_decision || packet.owner_decision.status !== "ACCEPTED") errors.push("owner_decision.status must be ACCEPTED");
  for (const key of ["decision_id", "decided_by", "decided_at", "signature", "approved_scope"]) exactString(packet?.owner_decision?.[key], `owner_decision.${key}`, errors);
  if (packet?.owner_decision?.selected_environment !== "SN_MAIN+Base Mainnet") errors.push("owner_decision.selected_environment must be SN_MAIN+Base Mainnet");

  const contract = packet?.environment_contract;
  if (!contract || typeof contract !== "object") errors.push("environment_contract is required");
  else {
    const expected = { profile: "mainnet", starknet_network: "SN_MAIN", starknet_chain_id: "SN_MAIN", base_network: "Base Mainnet", base_chain_id: 8453, deployment_mode: "AUTHORIZED_LIVE_ONLY" };
    for (const [key, value] of Object.entries(expected)) if (contract[key] !== value) errors.push(`environment_contract.${key} must be ${value}`);
    for (const key of ["starknet_rpc_env", "base_rpc_env", "signer_ref"]) exactString(contract[key], `environment_contract.${key}`, errors);
  }

  const figures = packet?.mainnet_figures;
  if (!figures || typeof figures !== "object") errors.push("mainnet_figures is required");
  else {
    if (figures.starknet_chain_id !== "SN_MAIN") errors.push("mainnet_figures.starknet_chain_id must be SN_MAIN");
    if (figures.base_chain_id !== 8453) errors.push("mainnet_figures.base_chain_id must be exact integer 8453");
    required(figures.pool_address, "mainnet_figures.pool_address", errors);
    if (!HEX64.test(figures.pool_address ?? "")) errors.push("mainnet_figures.pool_address must be an exact 32-byte hex value");
    if (figures.required_final_transaction_count !== 3) errors.push("required_final_transaction_count must be exactly 3");
    if (!Array.isArray(figures.final_submission_hashes) || figures.final_submission_hashes.length !== 3 || new Set(figures.final_submission_hashes).size !== 3 || figures.final_submission_hashes.some(h => !HEX64.test(h) || PLACEHOLDER.test(h))) errors.push("final_submission_hashes must contain exactly 3 distinct exact transaction hashes");
    const hv = figures.hub_validator;
    if (!hv || hv.ok !== true || hv.pool !== true || hv.mine !== true) errors.push("hub_validator must be observed exactly as ok=true, pool=true, mine=true");
    exactHash(figures.pool_event_tx_hash, "mainnet_figures.pool_event_tx_hash", errors);
    positiveBlock(figures.pool_event_block, "mainnet_figures.pool_event_block", errors);
    for (const key of ["validator_source", "verified_at"]) exactString(figures[key], `mainnet_figures.${key}`, errors);
  }

  if (!Array.isArray(packet.contracts) || packet.contracts.length !== REQUIRED_CONTRACT_IDENTITIES.length) errors.push("contracts must list exactly the four required mainnet contract identities");
  else {
    const names = packet.contracts.map(c => c?.name);
    const normalizedNames = names.map(name => typeof name === "string" ? name.toLowerCase() : name);
    const expectedNames = REQUIRED_CONTRACT_IDENTITIES.map(name => name.toLowerCase());
    if (new Set(normalizedNames).size !== REQUIRED_CONTRACT_IDENTITIES.length || expectedNames.some(name => !normalizedNames.includes(name))) errors.push("contracts must contain exactly PrismIdentityRegistry, PrismAllocationHelper, PrismVesuLendingHelper, and PrismLayerZeroBase");
    const addresses = packet.contracts.map(c => c?.address?.toLowerCase());
    if (addresses.some((address, index) => address && addresses.indexOf(address) !== index)) errors.push("contracts must contain unique addresses");
    packet.contracts.forEach((c, i) => {
      for (const key of ["name", "address", "class_hash", "deployment_block", "constructor_calldata"]) required(c?.[key], `contracts[${i}].${key}`, errors);
      if (!HEX64.test(c?.address ?? "") || !HEX64.test(c?.class_hash ?? "")) errors.push(`contracts[${i}] address/class_hash must be exact 32-byte hex values`);
      if (!Number.isSafeInteger(c?.deployment_block) || c.deployment_block <= 0) errors.push(`contracts[${i}].deployment_block must be exact positive integer`);
      const r = c?.receipt;
      if (!r || r.status !== "ACCEPTED" || !HEX64.test(r.tx_hash ?? "") || !Number.isSafeInteger(r.block) || r.block <= 0 || !r.provider) errors.push(`contracts[${i}] requires exact accepted deployment receipt (tx_hash, block, status, provider)`);
      const iv = c?.independent_read;
      if (!iv || iv.provider === r?.provider || iv.address_match !== true || iv.class_hash_match !== true || !iv.verified_at) errors.push(`contracts[${i}] requires independent address/class-hash readback from a different provider`);
    });
  }

  const funding = packet.signer_funding_preflight;
  if (!funding || funding.status !== "OBSERVED") errors.push("signer_funding_preflight.status must be OBSERVED");
  else {
    for (const key of ["environment", "base_network", "signer_ref", "wallet_provider", "prover_provider", "verified_at"]) exactString(funding[key], `signer_funding_preflight.${key}`, errors);
    if (funding.environment !== "SN_MAIN" || funding.base_network !== "Base Mainnet") errors.push("signer_funding_preflight must target exact SN_MAIN/Base Mainnet");
    for (const [name, evidence] of Object.entries({ starknet: funding.starknet, base: funding.base })) {
      if (!evidence || typeof evidence !== "object") { errors.push(`signer_funding_preflight.${name} evidence is required`); continue; }
      exactHash(evidence.deployer_address ?? evidence.submitter_address, `signer_funding_preflight.${name}.address`, errors);
      exactHash(evidence.funding_tx_hash, `signer_funding_preflight.${name}.funding_tx_hash`, errors);
      if (evidence.funding_receipt_status !== "ACCEPTED") errors.push(`signer_funding_preflight.${name}.funding_receipt_status must be ACCEPTED`);
      positiveBlock(evidence.funding_block, `signer_funding_preflight.${name}.funding_block`, errors);
      const read = evidence.funding_independent_read;
      if (!read || read.provider === evidence.funding_provider || read.address_match !== true || read.amount_match !== true || !read.verified_at) errors.push(`signer_funding_preflight.${name} requires a different-provider funding readback`);
      if (!(typeof evidence.funding_amount === "number" && Number.isFinite(evidence.funding_amount) && evidence.funding_amount > 0)) errors.push(`signer_funding_preflight.${name}.funding_amount must be observed positive number`);
    }
  }

  const wp = packet.wallet_prover;
  if (!wp || wp.status !== "OBSERVED") errors.push("wallet_prover.status must be OBSERVED");
  else {
    for (const key of ["wallet_provider", "wallet_address", "prover_provider", "proof_id", "receipt_tx_hash", "receipt_status", "receipt_block", "receipt_provider", "verified_at"]) required(wp[key], `wallet_prover.${key}`, errors);
    if (!HEX64.test(wp.wallet_address ?? "") || !HEX64.test(wp.receipt_tx_hash ?? "")) errors.push("wallet_prover wallet_address and receipt_tx_hash must be exact 32-byte hex values");
    if (wp.receipt_status !== "ACCEPTED" || !Number.isSafeInteger(wp.receipt_block) || wp.receipt_block <= 0) errors.push("wallet_prover requires an accepted receipt with a positive block");
    if (!wp.independent_read || wp.independent_read.provider === wp.wallet_provider || wp.independent_read.provider === wp.receipt_provider || wp.independent_read.address_match !== true || !wp.independent_read.verified_at) errors.push("wallet_prover requires an independent provider readback");
  }
  return { ok: errors.length === 0, errors };
}

function runSelfTest() {
  const exact = "0x" + "1".repeat(64);
  const packet = {
    release_status: "MAINNET_READY", environment: "SN_MAIN", network: { starknet: "SN_MAIN", base_network: "Base Mainnet", base_chain_id: 8453 },
    owner_decision: { status: "ACCEPTED", decision_id: "DEC-PRISM-MAINNET-001", decided_by: "owner", decided_at: "2026-01-01T00:00:00Z", signature: "signed-decision", selected_environment: "SN_MAIN+Base Mainnet", approved_scope: "deploy-and-submit" },
    environment_contract: { profile: "mainnet", starknet_network: "SN_MAIN", starknet_chain_id: "SN_MAIN", base_network: "Base Mainnet", base_chain_id: 8453, deployment_mode: "AUTHORIZED_LIVE_ONLY", starknet_rpc_env: "STARKNET_RPC_URL", base_rpc_env: "BASE_RPC_URL", signer_ref: "protected-mainnet-signer" },
    mainnet_figures: { starknet_chain_id: "SN_MAIN", base_chain_id: 8453, pool_address: exact, required_final_transaction_count: 3, final_submission_hashes: [exact, "0x" + "2".repeat(64), "0x" + "3".repeat(64)], hub_validator: { ok: true, pool: true, mine: true }, pool_event_tx_hash: exact, pool_event_block: 1, validator_source: "independent", verified_at: "2026-01-01T00:00:00Z" },
    contracts: REQUIRED_CONTRACT_IDENTITIES.map((name, i) => ({ name, address: "0x" + (i + 1).toString(16).padStart(64, "0"), class_hash: exact, deployment_block: i + 1, constructor_calldata: "0x1", receipt: { tx_hash: "0x" + (i + 10).toString(16).padStart(64, "0"), block: i + 1, status: "ACCEPTED", provider: "rpc-a" }, independent_read: { provider: "rpc-b", address_match: true, class_hash_match: true, verified_at: "2026-01-01T00:00:00Z" } })),
    signer_funding_preflight: { status: "OBSERVED", environment: "SN_MAIN", base_network: "Base Mainnet", signer_ref: "protected-mainnet-signer", wallet_provider: "wallet", prover_provider: "prover", verified_at: "2026-01-01T00:00:00Z", starknet: { deployer_address: exact, funding_provider: "rpc-a", funding_amount: 1, funding_tx_hash: exact, funding_receipt_status: "ACCEPTED", funding_block: 1, funding_independent_read: { provider: "rpc-b", address_match: true, amount_match: true, verified_at: "2026-01-01T00:00:00Z" } }, base: { submitter_address: exact, funding_provider: "rpc-a", funding_amount: 1, funding_tx_hash: "0x" + "2".repeat(64), funding_receipt_status: "ACCEPTED", funding_block: 1, funding_independent_read: { provider: "rpc-b", address_match: true, amount_match: true, verified_at: "2026-01-01T00:00:00Z" } } },
    wallet_prover: { status: "OBSERVED", wallet_provider: "wallet", wallet_address: exact, prover_provider: "prover", proof_id: "proof-1", receipt_tx_hash: exact, receipt_status: "ACCEPTED", receipt_block: 1, receipt_provider: "wallet", verified_at: "2026-01-01T00:00:00Z", independent_read: { provider: "rpc-b", address_match: true, verified_at: "2026-01-01T00:00:00Z" } }
  };
  const duplicateHashes = { ...packet, mainnet_figures: { ...packet.mainnet_figures, final_submission_hashes: [exact, "0x" + "1".repeat(64).toUpperCase(), "0x" + "3".repeat(64)] } };
  const duplicateContracts = { ...packet, contracts: packet.contracts.map((contract, index) => index === 3 ? { ...contract, name: REQUIRED_CONTRACT_IDENTITIES[0] } : contract) };
  if (!validate(packet).ok || validate({ ...packet, mainnet_figures: { ...packet.mainnet_figures, final_submission_hashes: [] } }).ok || validate(duplicateHashes).ok || validate(duplicateContracts).ok || validate({ ...packet, owner_decision: { ...packet.owner_decision, status: "PROPOSED" } }).ok) throw new Error("self-test failed");
  console.log("✓ mainnet release validator self-test passed (complete packet passes; missing figures/owner decision fail closed)");
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  if (process.argv.includes("--self-test")) { runSelfTest(); process.exit(0); }
  const file = process.argv.slice(2).find(a => !a.startsWith("--"));
  if (!file) { console.error("usage: node ops/release/validate-mainnet.mjs <packet.json> [--json]"); process.exit(2); }
  let packet;
  try { packet = JSON.parse(readFileSync(resolve(file), "utf8")); } catch (e) { console.error(`✕ invalid packet JSON: ${e.message}`); process.exit(2); }
  const result = validate(packet);
  if (!result.ok) { console.error("✕ NOT MAINNET_READY — fail-closed blockers:"); result.errors.forEach(e => console.error(`  ⊘ ${e}`)); process.exit(1); }
  console.log("✓ MAINNET_READY packet satisfies exact figures, receipts, independent reads, wallet/prover evidence, and owner decision gates");
}
