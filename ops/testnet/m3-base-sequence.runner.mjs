#!/usr/bin/env node
// ops/testnet/m3-base-sequence.runner.mjs — parent-executable M3 testnet runner
//
// Scope: Backend/evidence only. No frontend, no secrets file reads, no mainnet broadcast.
// Accepts injected/public configuration and performs dry-run/preflight for:
//   challenge → EOA/EIP-1271/ERC-6492 verification → controller bind → resolve → revoke → empty resolve
// Preserves exact chain/domain/nonce/expiry/replay semantics and fails closed on
// unknown signer / provider / receipt states. Never fabricates a bind receipt.
//
// Usage:
//   node ops/testnet/m3-base-sequence.runner.mjs --self-test
//   node ops/testnet/m3-base-sequence.runner.mjs --dry-run [--env testnet] [--chain-id 84532] [--domain prism.example] [--prism-id prism:1] [--controller 0x...] [--execution-account 0x...] [--registry 0x...] --registry-version v1|v2
//   node ops/testnet/m3-base-sequence.runner.mjs --env testnet --live --chain-id 84532 --domain prism.example --prism-id prism:1 --controller 0x... --execution-account 0x... --registry 0x... --registry-version v1|v2 --rpc https://...
//     (live requires STARKNET_SEPOLIA_DEPLOYER_PRIVATE_KEY or keystore and BASE_SIGNER_PRIVATE_KEY in env — otherwise precise blocker, no receipt fabricated)
//
// Exit codes:
//   0 — dry-run preflight succeeded (M3_BASE_SEQUENCE_RUNNER_READY_X2) or --self-test passed
//   2 — blocked by signing environment (M3_BLOCKED_BY_SIGNING_ENVIRONMENT) — precise blocker, no fabricated receipt
//   1 — failed (config blocked, verification failed, etc.)

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const get = (flag, def = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? (args[i + 1] ?? def) : def;
};
const has = (flag) => args.includes(flag);

function parseEnvRecord() {
  const out = {};
  for (const k of Object.keys(process.env)) out[k] = process.env[k];
  return out;
}

function loadManifestChainId(env) {
  const p = resolve("ops/target-network/manifest.yaml");
  if (!existsSync(p)) throw new Error("target-network manifest missing");
  if (!["testnet", "mainnet", "SN_SEPOLIA", "SN_MAIN"].includes(env)) throw new Error(`unknown environment ${env}`);
  const raw = readFileSync(p, "utf8");
  const artifactStatus = raw.match(/^status:\s*([A-Z_]+)/m)?.[1];
  const ownerStart = raw.indexOf("owner_decision:");
  const ownerBlock = ownerStart >= 0 ? raw.slice(ownerStart) : "";
  const ownerStatus = ownerBlock.match(/^\s+status:\s*([A-Z_]+)/m)?.[1];
  const selectedEnvironment = ownerBlock.match(/^\s+selected_environment:\s*([a-z_]+)/m)?.[1];
  if (artifactStatus !== "ACCEPTED" || ownerStatus !== "ACCEPTED") throw new Error("target-network manifest is not owner-accepted");
  const isTestnet = env === "testnet" || env === "SN_SEPOLIA";
  const section = isTestnet ? "testnet" : "mainnet";
  const start = raw.indexOf(`\n  ${section}:`);
  const end = raw.indexOf(isTestnet ? "\n  mainnet:" : "\nowner_decision:", start);
  const sectionBlock = start >= 0 ? raw.slice(start, end >= 0 ? end : raw.length) : "";
  const sectionStatus = sectionBlock.match(/^\s+status:\s*([A-Z_]+)/m)?.[1];
  if (isTestnet) {
    if (selectedEnvironment !== "testnet" || sectionStatus !== "ACCEPTED") throw new Error("testnet is not the selected accepted environment");
  } else if (selectedEnvironment !== "mainnet" || sectionStatus !== "ACCEPTED") {
    throw new Error("mainnet is release-gated and not the selected accepted environment");
  }
  const m = sectionBlock.match(/base:[\s\S]*?chain_id:\s*(\d+)/);
  if (!m) throw new Error(`manifest base chain_id missing for ${section}`);
  return { chainId: Number(m[1]), network: isTestnet ? "SN_SEPOLIA" : "SN_MAIN" };
}

if (has("--self-test")) {
  console.log("M3 runner --self-test: running offline gate suite (no live RPC, no secrets)...");
  const r = spawnSync("npm", ["test", "--", "src/features/evidence/__tests__/m3-base-sequence-gate.test.ts", "src/features/prism-identity/__tests__/felt-digest.test.ts", "src/features/prism-operations/__tests__/starknet-submit.test.ts"], { stdio: "inherit" });
  if (r.status === 0) {
    console.log("\n✓ M3 runner --self-test passed (offline, dry-run, TEST DOUBLE, X2)");
    console.log("  Verdict: M3_BASE_SEQUENCE_RUNNER_READY_X2 (dry-run preflight)");
  } else {
    console.error("\n✕ M3 runner --self-test failed");
  }
  process.exit(r.status ?? 1);
}

const envArg = get("--env", process.env.PRISM_ENV ?? null);
if (!envArg) {
  console.error("✕ explicit --env testnet|mainnet is required; no implicit environment default");
  process.exit(1);
}
let manifestInfo;
try {
  manifestInfo = loadManifestChainId(envArg);
} catch (error) {
  console.error(`✕ target-network manifest blocked: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const chainIdArg = get("--chain-id", get("--chainId", process.env.PRISM_CHAIN_ID ?? process.env.BASE_CHAIN_ID ?? String(manifestInfo.chainId)));
const domainArg = get("--domain", process.env.PRISM_DOMAIN ?? "prism.example");
const prismIdArg = get("--prism-id", process.env.PRISM_ID ?? "prism:1");
const controllerArg = get("--controller", process.env.CONTROLLER_ADDRESS ?? "0x1111111111111111111111111111111111111111");
const execArg = get("--execution-account", get("--executionAccount", process.env.BASE_EXECUTION_ACCOUNT ?? process.env.EXECUTION_ACCOUNT ?? null));
const registryArg = get("--registry", process.env.STARKNET_REGISTRY_ADDRESS ?? process.env.PRISM_REGISTRY_ADDRESS ?? null);
const registryVersionInput = get("--registry-version", process.env.STARKNET_REGISTRY_VERSION ?? null);
const rpcArg = get("--rpc", process.env.STARKNET_RPC_URL ?? process.env.NEXT_PUBLIC_STARKNET_RPC_URL ?? null);
const liveRequested = has("--live");
const dryRunFlag = has("--dry-run") || !liveRequested;
const registryVersionRaw = registryVersionInput === null ? "" : String(registryVersionInput).trim().toLowerCase();

if (!registryVersionRaw) {
  console.error("✕ registryVersion required for live and dry-run (--registry-version or STARKNET_REGISTRY_VERSION)");
  process.exit(1);
}
const normalizedRegistryVersion = registryVersionRaw === "1" ? "v1" : registryVersionRaw === "2" ? "v2" : registryVersionRaw;
if (!["v1", "v2"].includes(normalizedRegistryVersion)) {
  console.error(`✕ invalid --registry-version: ${registryVersionInput} (expected v1 or v2)`);
  process.exit(1);
}

if (has("--help") || has("-h")) {
  console.log(`M3 Base Sequence Runner — dry-run preflight
Env: ${envArg}  Manifest chainId: ${manifestInfo.chainId}  Live: ${liveRequested}
Flags:
  --env testnet|mainnet
  --chain-id <number>   (must equal manifest base.chain_id; default ${manifestInfo.chainId})
  --domain <string>     (default prism.example)
  --prism-id prism:<decimal> (default prism:1, must be felt-representable)
  --controller 0x<hex>  (Starknet controller address)
  --execution-account 0x<40hex> (Base EOA/smart wallet; dry-run generates ephemeral if omitted)
  --registry 0x<hex>    (Starknet registry address, required for --live)
  --registry-version v1|v2  (required explicit registry ABI version for dry-run and live; no default)
  --rpc <url>           (Starknet RPC URL, required for --live)
  --dry-run             (default when --live not set — never fabricates receipt)
  --live                (requires signing provider env: STARKNET_SEPOLIA_DEPLOYER_PRIVATE_KEY etc.)
  --self-test           (runs offline gate suite, no RPC)
Examples:
  node ops/testnet/m3-base-sequence.runner.mjs --dry-run --env testnet --chain-id 84532 --domain prism.example --prism-id prism:1 --registry-version v1
  node ops/testnet/m3-base-sequence.runner.mjs --self-test
  STARKNET_RPC_URL=... STARKNET_REGISTRY_ADDRESS=... STARKNET_REGISTRY_VERSION=v1 STARKNET_SEPOLIA_DEPLOYER_PRIVATE_KEY=... BASE_SIGNER_PRIVATE_KEY=... node ops/testnet/m3-base-sequence.runner.mjs --live --env testnet --chain-id 84532 --domain prism.example --prism-id prism:1 --controller 0x... --execution-account 0x...
`);
  process.exit(0);
}

// Resolve execution account: if not supplied, we will generate ephemeral in runner core (dry-run)
let executionAccount = execArg;
if (!executionAccount) {
  // Generate a placeholder that will be replaced by ephemeral signer address inside runner core
  // But for config validation we need a valid address — so generate a random one now
  // Use Node crypto to make a deterministic ephemeral for dry-run preflight logging
  const bytes = new Uint8Array(20);
  globalThis.crypto.getRandomValues(bytes);
  executionAccount = "0x" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  console.log(`Note: --execution-account not supplied — dry-run will use ephemeral EOA ${executionAccount} (injected signer will own it)`);
}

const chainIdText = String(chainIdArg).trim();
const chainId = /^\d+$/.test(chainIdText) ? Number(chainIdText) : Number.NaN;
const publicConfig = {
  chainId,
  domain: domainArg,
  venue: "BASE",
  prismId: prismIdArg,
  executionAccount,
  controllerAddress: controllerArg,
  registryAddress: registryArg ?? undefined,
  registryVersion: normalizedRegistryVersion,
  rpcUrl: rpcArg ?? undefined,
  starknetNetwork: manifestInfo.network,
  hasLiveSigningProvider: !!(process.env.STARKNET_SEPOLIA_DEPLOYER_PRIVATE_KEY || process.env.STARKNET_SEPOLIA_KEYSTORE_PATH || process.env.CONTROLLER_PRIVATE_KEY || process.env.STARKNET_PRIVATE_KEY || process.env.BASE_SIGNER_PRIVATE_KEY),
  liveRequested,
};

console.log(`M3 runner — env=${envArg} registryVersion=${publicConfig.registryVersion} chainId=${chainId} (manifest ${manifestInfo.chainId}) domain=${publicConfig.domain} venue=BASE prismId=${publicConfig.prismId}`);
console.log(`  controller=${publicConfig.controllerAddress} executionAccount=${publicConfig.executionAccount}`);
console.log(`  registry=${publicConfig.registryAddress ?? "(none — dry-run)"} rpc=${publicConfig.rpcUrl ? "<set>" : "(none — dry-run)"} liveRequested=${liveRequested} dryRun=${dryRunFlag}`);

// If live requested but signing env missing, emit precise blocker and exit 2 without fabricating receipt
if (liveRequested) {
  const envRec = parseEnvRecord();
  const hasStarknetKey = !!(envRec.STARKNET_SEPOLIA_DEPLOYER_PRIVATE_KEY || envRec.STARKNET_SEPOLIA_KEYSTORE_PATH || envRec.CONTROLLER_PRIVATE_KEY || envRec.STARKNET_PRIVATE_KEY);
  const hasBaseKey = !!(envRec.BASE_SIGNER_PRIVATE_KEY || envRec.BASE_PRIVATE_KEY || envRec.EOA_PRIVATE_KEY);
  if (!hasStarknetKey || !hasBaseKey) {
    const missing = [];
    if (!hasStarknetKey) missing.push("Starknet controller/deployer signing provider");
    if (!hasBaseKey) missing.push("Base signing provider");
    console.error(`\n✕ M3_BLOCKED_BY_SIGNING_ENVIRONMENT: ${missing.join(" and ")} unavailable`);
    console.error(`  Required Starknet: STARKNET_SEPOLIA_DEPLOYER_PRIVATE_KEY / STARKNET_SEPOLIA_KEYSTORE_PATH / CONTROLLER_PRIVATE_KEY`);
    console.error(`  Required Base: BASE_SIGNER_PRIVATE_KEY / BASE_PRIVATE_KEY / EOA_PRIVATE_KEY. No bind receipt fabricated.`);
    console.error(`  Dry-run preflight still available: re-run without --live or with --dry-run`);
    console.error(`\nVerdict: M3_BLOCKED_BY_SIGNING_ENVIRONMENT`);
    process.exit(2);
  }
  if (!publicConfig.registryAddress || !publicConfig.rpcUrl) {
    console.error(`\n✕ M3_BLOCKED_BY_SIGNING_ENVIRONMENT: live broadcast requires --registry and --rpc (STARKNET_REGISTRY_ADDRESS, STARKNET_RPC_URL)`);
    console.error(`  No receipt fabricated. Provide injected public configuration and signing provider.`);
    console.error(`\nVerdict: M3_BLOCKED_BY_SIGNING_ENVIRONMENT`);
    process.exit(2);
  }
  console.log("Live signing provider detected — proceeding to preflight before broadcast (dry-run gate still enforced)...");
} else {
  console.log("Dry-run preflight mode — no live broadcast, no receipt fabricated. Verdict will be M3_BASE_SEQUENCE_RUNNER_READY_X2 on success or M3_BLOCKED_BY_SIGNING_ENVIRONMENT when live is required.");
}

// Validate config fail-closed (chain/domain mismatch should block)
let validated;
try {
  // Dynamic import of validation logic without needing TS build — re-implement minimal checks here for CLI
  // Reuse same rules as TS runner: chainId must equal manifest, domain must contain dot, prismId must be felt-representable
  if (!Number.isSafeInteger(chainId) || chainId < 0) throw new Error(`invalid chainId ${chainIdArg}`);
  if (chainId !== manifestInfo.chainId) {
    throw new Error(`chainId mismatch: inputs ${chainId} != manifest ${manifestInfo.chainId} — altered_fields:chain_id`);
  }
  if (!publicConfig.domain.includes(".") || publicConfig.domain.includes(" ")) {
    throw new Error(`invalid domain ${publicConfig.domain}`);
  }
  // Validate prismId via felt boundary (decimal, no leading zeros, < FELT_PRIME)
  // Inline minimal check: prism: decimal
  const trimmed = publicConfig.prismId.trim();
  if (!trimmed.startsWith("prism:")) throw new Error(`malformed_prism_id: missing prefix prism: ${publicConfig.prismId}`);
  const suffix = trimmed.slice(6);
  if (!/^[0-9]+$/.test(suffix)) throw new Error(`malformed_prism_id: non-decimal ${publicConfig.prismId}`);
  if (suffix.length > 1 && suffix.startsWith("0")) throw new Error(`malformed_prism_id: leading zeros ${publicConfig.prismId}`);
  const val = BigInt(suffix);
  if (val <= 0n) throw new Error(`malformed_prism_id: not positive ${publicConfig.prismId}`);
  const FELT_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;
  if (val >= FELT_PRIME) throw new Error(`prism_id_out_of_range: ${publicConfig.prismId} exceeds felt prime — ERR-023`);
  if (!/^0x[0-9a-f]{40}$/.test(publicConfig.executionAccount.toLowerCase())) throw new Error(`malformed executionAccount ${publicConfig.executionAccount}`);
  if (BigInt(publicConfig.executionAccount) === 0n) throw new Error("zero executionAccount is not allowed");
  if (!/^0x[0-9a-f]{1,64}$/.test(publicConfig.controllerAddress.toLowerCase())) throw new Error(`malformed controllerAddress ${publicConfig.controllerAddress}`);
  if (BigInt(publicConfig.controllerAddress) === 0n || BigInt(publicConfig.controllerAddress) >= (1n << 251n)) throw new Error("controllerAddress outside ContractAddress range");
  if (publicConfig.registryAddress) {
    if (!/^0x[0-9a-f]{1,64}$/.test(publicConfig.registryAddress.toLowerCase())) throw new Error(`malformed registryAddress ${publicConfig.registryAddress}`);
    if (BigInt(publicConfig.registryAddress) === 0n || BigInt(publicConfig.registryAddress) >= (1n << 251n)) throw new Error("registryAddress outside ContractAddress range");
  }
  validated = publicConfig;
  console.log(`✓ Config validated — chainId ${chainId}, domain ${publicConfig.domain}, prismId ${publicConfig.prismId} -> felt 0x${val.toString(16)}, executionAccount ${publicConfig.executionAccount}, controller ${publicConfig.controllerAddress}`);
} catch (e) {
  console.error(`\n✕ M3 config blocked: ${e.message}`);
  console.error(`  Fail-closed: altered chain/domain/nonce/expiry not accepted.`);
  console.error(`\nVerdict: M3_FAILED (config blocked)`);
  process.exit(1);
}

// Run dry-run preflight via vitest harness (no live RPC)
// We spawn the gate test that exercises the full sequence via in-memory doubles
console.log("\nRunning dry-run preflight gate suite (offline, TEST DOUBLE, X2)...");
const gateTests = publicConfig.registryVersion === "v2"
  ? ["src/features/evidence/__tests__/m3-base-sequence-gate.test.ts", "src/features/evidence/__tests__/m3-v2-application-boundary.test.ts", "src/features/prism-identity/__tests__/u256-digest.test.ts", "src/features/prism-operations/__tests__/starknet-submit-v2.test.ts"]
  : ["src/features/evidence/__tests__/m3-base-sequence-gate.test.ts"];
const r = spawnSync("npm", ["test", "--", ...gateTests], { stdio: "inherit" });
if (r.status === 0) {
  console.log("\n✓ Dry-run preflight passed — challenge → EOA/EIP-1271/ERC-6492 → bind (submitted) → resolve ACTIVE → revoke → empty resolve → P persists");
  if (publicConfig.registryVersion === "v2") {
    console.log("  V2 boundary: full digest serializes as u256 low/high limbs; V2 adapter tests are separate and no live receipt is fabricated.");
  } else {
    console.log("  V1 boundary: prismId -> felt at calldata[0], digest -> felt at calldata[3] (250-bit mask).");
  }
  console.log("  submitted!=completed preserved; no live broadcast in dry-run.");
  console.log("  Unknown signer/provider/receipt states correctly fail closed (ERR-003/014, ERR-021, UNKNOWN)");
  if (!liveRequested) {
    console.log("\n  Live signing not requested — no bind receipt fabricated (correct).");
    console.log("  To enable live broadcast, provide signing provider and re-run with --live (then receipt will be observed, not fabricated).");
    console.log("\nVerdict: M3_BASE_SEQUENCE_RUNNER_READY_X2");
  } else {
    console.log("\n  Live requested and preflight passed — next step is live broadcast via funded deployer (not fabricated here).");
    console.log("  Real bind txHash/block/receipt will be observed via SN_SEPOLIA RPC + Voyager, not synthesized.");
    console.log("\nVerdict: M3_BASE_SEQUENCE_RUNNER_READY_X2 (preflight), live broadcast pending signing provider execution");
  }
  process.exit(0);
} else {
  console.error("\n✕ Dry-run preflight failed — gate suite did not pass");
  console.error("  Fix chain/domain/nonce/expiry/replay or felt boundary before live broadcast.");
  console.error("\nVerdict: M3_FAILED");
  process.exit(1);
}
