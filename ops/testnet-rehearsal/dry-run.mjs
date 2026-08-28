#!/usr/bin/env node
// Read-only Prism testnet rehearsal preflight; never deploys or broadcasts.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../..");
const INVENTORY_PATH = resolve(SCRIPT_DIR, "endpoint-inventory.json");
const MANIFEST_PATH = resolve(REPO_ROOT, "ops/target-network/manifest.yaml");
const DECISIONS_PATH = resolve(REPO_ROOT, "projects/prism/DECISIONS.md");
const OPENAPI_PATH = resolve(REPO_ROOT, "docs/api/openapi.yaml");

const MATURITY_FIELDS = ["specified", "implemented", "integrated", "deployed", "observed", "repeated", "promotable"];
const REQUIRED_ENDPOINTS = [
  "ID_CREATE",
  "ID_READ",
  "BY_CONTROLLER",
  "CHALLENGE_ISSUE",
  "CHALLENGE_VERIFY",
  "PUBLIC_BINDINGS_LIST",
  "BIND",
  "PRIVATE_BINDINGS_LIST",
  "REVOKE",
  "RESOLVE",
  "ALIAS_LOOKUP",
  "CONTINUITY",
  "STRK20_ACTION_CREATE",
  "STRK20_ACTION_READ",
  "PRIVACY_RECEIPT_READ",
  "OPERATION_READ",
  "RECEIPT_READ",
  "INTENT_CREATE",
  "INTENT_PAUSE",
  "PAUSE_READ",
  "PAUSE_VERIFY",
  "PAUSE_RELEASE",
  "PAUSE_CANCEL",
  "PAUSE_ESCALATE",
  "PAUSE_APPROVE",
  "PAYMENT_REQUEST_CREATE",
  "PAYMENT_REQUEST_READ",
  "PAYMENT_REQUEST_ACTION",
  "GIFT_CREATE",
  "GIFT_READ",
  "GIFT_ACTION",
];
const REQUIRED_AREAS = new Set([
  "identity",
  "ownership-proof",
  "bindings",
  "resolution",
  "aliases",
  "strk20",
  "operations",
  "receipts",
  "intents",
  "pause",
  "payments",
  "gifts",
]);

// Names only. Values are inspected for shape and are never printed.
const CONFIG_NAMES = [
  "STARKNET_CHAIN_ID",
  "NEXT_PUBLIC_STARKNET_NETWORK",
  "STARKNET_RPC_URL",
  "STARKNET_SEPOLIA_RPC_URL",
  "NEXT_PUBLIC_STARKNET_RPC_URL",
  "STARKNET_REGISTRY_VERSION",
  "STARKNET_REGISTRY_ADDRESS",
  "PRISM_REGISTRY_ADDRESS",
  "STARKNET_REGISTRY_CLASS_HASH",
  "PRISM_STARKNET_INDEXER_START_BLOCK",
  "BASE_RPC_URL",
  "BASE_CHAIN_ID",
  "PRISM_POSTGRES_TEST_URL",
  "PRISM_POSTGRES_URL",
  "PRISM_REQUIRE_POSTGRES",
  "PRISM_RUNTIME_MODE",
  "PRISM_DOMAIN",
];

const REQUIRED_CONFIG_ALTERNATIVES = [
  ["STARKNET_CHAIN_ID", "NEXT_PUBLIC_STARKNET_NETWORK"],
  ["STARKNET_RPC_URL", "STARKNET_SEPOLIA_RPC_URL", "NEXT_PUBLIC_STARKNET_RPC_URL"],
  ["STARKNET_REGISTRY_ADDRESS", "PRISM_REGISTRY_ADDRESS"],
  ["STARKNET_REGISTRY_VERSION"],
  ["STARKNET_REGISTRY_CLASS_HASH"],
  ["PRISM_STARKNET_INDEXER_START_BLOCK"],
  ["BASE_RPC_URL"],
  ["BASE_CHAIN_ID"],
  ["PRISM_POSTGRES_TEST_URL", "PRISM_POSTGRES_URL"],
];

const FORBIDDEN_FLAGS = new Set([
  "--deploy",
  "--broadcast",
  "--live",
  "--invoke",
  "--sign",
  "--fund",
  "--wallet",
  "--sncast",
  "--mainnet",
  "--sn-main",
  "--base-mainnet",
  "--write-ledger",
  "--write-evidence",
  "--write-strk20",
  "--private-key",
]);

function fail(message) {
  throw new Error(message);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function parseArgs(argv) {
  const options = { selfTest: false, checkConfig: false, requireConfig: false, help: false, environment: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (FORBIDDEN_FLAGS.has(arg)) fail(`forbidden side-effect flag ${arg}; this harness is read-only`);
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--self-test") {
      options.selfTest = true;
      continue;
    }
    if (arg === "--check-config") {
      options.checkConfig = true;
      continue;
    }
    if (arg === "--require-config") {
      options.checkConfig = true;
      options.requireConfig = true;
      continue;
    }
    if (arg === "--environment" || arg === "--env") {
      const value = argv[i + 1];
      if (!nonEmpty(value) || value.startsWith("--")) fail(`${arg} requires an explicit environment`);
      options.environment = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) fail(`unknown flag ${arg}; no live/deployment flags are accepted`);
    fail(`unexpected positional argument ${arg}`);
  }
  return options;
}

function readText(path, label) {
  if (!existsSync(path)) fail(`${label} missing`);
  return readFileSync(path, "utf8");
}

function manifestSection(raw, name, endMarker) {
  const start = raw.indexOf(`\n  ${name}:`);
  if (start < 0) fail(`target manifest section ${name} missing`);
  const end = endMarker ? raw.indexOf(endMarker, start + 1) : -1;
  return raw.slice(start, end >= 0 ? end : raw.length);
}

function validateManifest() {
  const raw = readText(MANIFEST_PATH, "target-network manifest");
  const decisions = readText(DECISIONS_PATH, "decision ledger");
  const testnet = manifestSection(raw, "testnet", "\n  mainnet:");
  const ownerStart = raw.indexOf("owner_decision:");
  if (ownerStart < 0) fail("target manifest owner_decision missing");
  const owner = raw.slice(ownerStart);
  const topStatus = raw.match(/^status:\s*([A-Z_]+)/m)?.[1];
  const ownerStatus = owner.match(/^\s+status:\s*([A-Z_]+)/m)?.[1];
  const selected = owner.match(/^\s+selected_environment:\s*([a-z_]+)/m)?.[1];
  if (topStatus !== "ACCEPTED" || ownerStatus !== "ACCEPTED" || selected !== "testnet") {
    fail("testnet target manifest is not owner-accepted");
  }
  if (!testnet.includes("network: SN_SEPOLIA")) fail("testnet Starknet network is not SN_SEPOLIA");
  if (!testnet.includes("registry_version: v2")) fail("testnet registry version is not explicitly v2");
  if (!testnet.includes("chain_id: 84532")) fail("testnet Base chain id is not 84532");
  if (!raw.includes("decision_id: DEC-PRISM-OPS-001") || !raw.includes("disposition_chainId_v2: ACCEPT")) {
    fail("target manifest decision mirror is incomplete");
  }
  if (!/## DEC-PRISM-OPS-001[\s\S]*?\*\*Status:\*\* Accepted/.test(decisions)) {
    fail("DEC-PRISM-OPS-001 append-only record is missing or not accepted");
  }
  if (!/## DEC-PRISM-SYS-003[\s\S]*?\*\*Status:\*\* Accepted/.test(decisions)) {
    fail("DEC-PRISM-SYS-003 append-only record is missing or not accepted");
  }
  return { environment: "testnet", starknetNetwork: "SN_SEPOLIA", baseChainId: 84532, registryVersion: "v2" };
}

function openApiPathFor(endpointPath) {
  return endpointPath.split("?")[0];
}

function validateInventory() {
  const raw = readText(INVENTORY_PATH, "endpoint inventory");
  let inventory;
  try {
    inventory = JSON.parse(raw);
  } catch (error) {
    fail(`endpoint inventory is not valid JSON: ${error.message}`);
  }
  if (inventory.artifact_id !== "PRISM_TESTNET_REHEARSAL_ENDPOINT_INVENTORY") fail("inventory artifact id mismatch");
  if (inventory.target?.environment !== "testnet") fail("inventory target environment must be testnet");
  if (inventory.target?.starknet_network !== "SN_SEPOLIA") fail("inventory target Starknet network must be SN_SEPOLIA");
  if (inventory.target?.base_network !== "BASE_SEPOLIA") fail("inventory target Base network must be BASE_SEPOLIA");
  if (inventory.target?.base_chain_id !== 84532) fail("inventory target Base chain id must be 84532");
  if (!Array.isArray(inventory.endpoints)) fail("inventory endpoints must be an array");

  const ids = new Set();
  const areas = new Set();
  const openapi = readText(OPENAPI_PATH, "OpenAPI document");
  let present = 0;
  let missing = 0;
  for (const endpoint of inventory.endpoints) {
    if (!endpoint || typeof endpoint !== "object") fail("inventory contains a non-object endpoint");
    if (!nonEmpty(endpoint.id) || ids.has(endpoint.id)) fail(`endpoint id missing or duplicated: ${String(endpoint.id)}`);
    ids.add(endpoint.id);
    if (!REQUIRED_AREAS.has(endpoint.area)) fail(`endpoint ${endpoint.id} has an unknown area`);
    areas.add(endpoint.area);
    if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(endpoint.method)) fail(`endpoint ${endpoint.id} has an invalid method`);
    if (!nonEmpty(endpoint.path)) fail(`endpoint ${endpoint.id} has no path`);
    if (endpoint.maturity === null || typeof endpoint.maturity !== "object") fail(`endpoint ${endpoint.id} maturity missing`);
    for (const field of MATURITY_FIELDS) {
      if (typeof endpoint.maturity[field] !== "boolean") fail(`endpoint ${endpoint.id} maturity.${field} must be boolean`);
    }
    if (endpoint.maturity.specified !== true) fail(`endpoint ${endpoint.id} is not marked specified`);
    if (endpoint.maturity.promotable !== false) fail(`endpoint ${endpoint.id} must not be marked promotable by rehearsal inventory`);
    if (endpoint.maturity.implemented) {
      if (!nonEmpty(endpoint.source)) fail(`implemented endpoint ${endpoint.id} has no source path`);
      if (!existsSync(resolve(REPO_ROOT, endpoint.source))) fail(`implemented endpoint source missing: ${endpoint.source}`);
      present += 1;
    } else {
      if (endpoint.source !== null) fail(`unimplemented endpoint ${endpoint.id} must have source:null`);
      missing += 1;
    }
    if (endpoint.openapi === true) {
      const openapiPath = openApiPathFor(endpoint.path);
      if (!openapi.includes(`  ${openapiPath}:`)) fail(`OpenAPI path missing for ${endpoint.id}: ${openapiPath}`);
    }
    if (endpoint.openapi === false && endpoint.id === "BY_CONTROLLER" && endpoint.source === null) {
      fail("by-controller route unexpectedly lost");
    }
  }
  for (const id of REQUIRED_ENDPOINTS) if (!ids.has(id)) fail(`required endpoint missing: ${id}`);
  for (const area of REQUIRED_AREAS) if (!areas.has(area)) fail(`required endpoint area missing: ${area}`);
  if (inventory.endpoints.length !== REQUIRED_ENDPOINTS.length) fail(`inventory endpoint count drift: expected ${REQUIRED_ENDPOINTS.length}`);
  return { total: inventory.endpoints.length, present, missing, inventory };
}

function validateUrl(value, name, errors) {
  try {
    const parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol) || !nonEmpty(parsed.hostname)) errors.push(`${name}:invalid_url_shape`);
  } catch {
    errors.push(`${name}:invalid_url_shape`);
  }
}

function validateConfigShape(env) {
  const present = [];
  const absent = [];
  const errors = [];
  for (const name of CONFIG_NAMES) {
    if (nonEmpty(env[name])) present.push(name);
    else absent.push(name);
  }

  const starknetNetwork = nonEmpty(env.STARKNET_CHAIN_ID) ? env.STARKNET_CHAIN_ID.trim().toUpperCase() : null;
  const browserNetwork = nonEmpty(env.NEXT_PUBLIC_STARKNET_NETWORK) ? env.NEXT_PUBLIC_STARKNET_NETWORK.trim().toUpperCase() : null;
  const validNetworks = new Set(["SN_SEPOLIA", "0X534E5F5345504F4C4941"]);
  if (starknetNetwork && !validNetworks.has(starknetNetwork)) errors.push("STARKNET_CHAIN_ID:unsupported_testnet_network");
  if (browserNetwork && !validNetworks.has(browserNetwork)) errors.push("NEXT_PUBLIC_STARKNET_NETWORK:unsupported_testnet_network");
  if (starknetNetwork && browserNetwork && starknetNetwork !== browserNetwork) errors.push("STARKNET_CHAIN_ID/NEXT_PUBLIC_STARKNET_NETWORK:mismatch");

  if (nonEmpty(env.BASE_CHAIN_ID) && env.BASE_CHAIN_ID.trim() !== "84532") errors.push("BASE_CHAIN_ID:must_match_testnet");
  if (nonEmpty(env.STARKNET_REGISTRY_VERSION) && env.STARKNET_REGISTRY_VERSION.trim().toLowerCase() !== "v2") errors.push("STARKNET_REGISTRY_VERSION:must_be_v2_for_testnet_rehearsal");
  for (const name of ["STARKNET_RPC_URL", "STARKNET_SEPOLIA_RPC_URL", "NEXT_PUBLIC_STARKNET_RPC_URL", "BASE_RPC_URL"]) {
    if (nonEmpty(env[name])) validateUrl(env[name].trim(), name, errors);
  }
  for (const name of ["PRISM_POSTGRES_TEST_URL", "PRISM_POSTGRES_URL"]) {
    if (nonEmpty(env[name]) && !/^postgres(?:ql)?:\/\//i.test(env[name].trim())) errors.push(`${name}:invalid_postgres_url_shape`);
  }
  if (nonEmpty(env.PRISM_STARKNET_INDEXER_START_BLOCK)) {
    const block = Number(env.PRISM_STARKNET_INDEXER_START_BLOCK.trim());
    if (!Number.isSafeInteger(block) || block < 0) errors.push("PRISM_STARKNET_INDEXER_START_BLOCK:invalid_nonnegative_integer");
  }
  if (nonEmpty(env.PRISM_REQUIRE_POSTGRES) && env.PRISM_REQUIRE_POSTGRES.trim() !== "1") errors.push("PRISM_REQUIRE_POSTGRES:expected_1_when_set");
  if (nonEmpty(env.PRISM_RUNTIME_MODE) && !new Set(["test", "development", "production"]).has(env.PRISM_RUNTIME_MODE.trim())) errors.push("PRISM_RUNTIME_MODE:unsupported_value");
  return { present, absent, errors };
}

function assertRequiredConfig(config) {
  for (const alternatives of REQUIRED_CONFIG_ALTERNATIVES) {
    if (!alternatives.some((name) => config.present.includes(name))) {
      fail(`required runtime config group absent: ${alternatives.join(" or ")}`);
    }
  }
}

function selfTestConfigValidator() {
  const valid = validateConfigShape({
    STARKNET_CHAIN_ID: "SN_SEPOLIA",
    NEXT_PUBLIC_STARKNET_NETWORK: "SN_SEPOLIA",
    STARKNET_RPC_URL: "https://rpc.invalid.example",
    STARKNET_REGISTRY_VERSION: "v2",
    BASE_RPC_URL: "https://base.invalid.example",
    BASE_CHAIN_ID: "84532",
    PRISM_POSTGRES_TEST_URL: "postgresql://redacted.invalid/prism",
    PRISM_STARKNET_INDEXER_START_BLOCK: "1",
    PRISM_REQUIRE_POSTGRES: "1",
  });
  if (valid.errors.length !== 0) fail("config self-test valid case rejected");

  const wrongNetwork = validateConfigShape({ BASE_CHAIN_ID: "1" });
  if (!wrongNetwork.errors.includes("BASE_CHAIN_ID:must_match_testnet")) fail("config self-test did not reject wrong Base chain id");

  const malformed = validateConfigShape({ STARKNET_RPC_URL: "not-a-url", PRISM_POSTGRES_URL: "https://not-postgres" });
  if (!malformed.errors.includes("STARKNET_RPC_URL:invalid_url_shape") || !malformed.errors.includes("PRISM_POSTGRES_URL:invalid_postgres_url_shape")) {
    fail("config self-test did not reject malformed provider shapes");
  }
  return 3;
}

function printHelp() {
  console.log(`Prism testnet rehearsal dry-run (read-only)\n\nUsage:\n  node ops/testnet-rehearsal/dry-run.mjs --environment testnet --self-test\n  node ops/testnet-rehearsal/dry-run.mjs --environment testnet --check-config\n  node ops/testnet-rehearsal/dry-run.mjs --environment testnet --require-config\n\nThe harness reads the accepted testnet manifest, endpoint inventory, source route\nshapes, and OpenAPI paths. It never contacts RPC, reads signer secrets, signs,\nfunds, deploys, invokes, broadcasts, writes evidence, or writes strk20.json.\n--require-config validates presence of redacted runtime config names without\nprinting their values; it still does not contact any provider.`);
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return 0;
    }
    if (options.environment === null) fail("explicit --environment testnet is required");
    if (options.environment !== "testnet") fail("only --environment testnet is permitted; mainnet is release-gated");

    const manifest = validateManifest();
    const inventoryResult = validateInventory();
    let configResult = null;
    let configSelfTests = 0;
    if (options.selfTest) configSelfTests = selfTestConfigValidator();
    if (options.checkConfig) {
      configResult = validateConfigShape(process.env);
      if (configResult.errors.length > 0) fail(`runtime config shape invalid: ${configResult.errors.join(",")}`);
      if (options.requireConfig) assertRequiredConfig(configResult);
    }

    console.log(`✓ accepted target: ${manifest.starknetNetwork} + BASE_SEPOLIA/${manifest.baseChainId}, registry ${manifest.registryVersion}`);
    console.log(`✓ endpoint inventory validated: ${inventoryResult.total} endpoints (${inventoryResult.present} source-present, ${inventoryResult.missing} specified-only)`);
    console.log(`✓ OpenAPI/source shape checks passed; no application files were changed`);
    if (options.selfTest) console.log(`✓ config validator self-test passed: ${configSelfTests} cases`);
    if (configResult) {
      console.log(`✓ config names checked without values: ${configResult.present.length} set, ${configResult.absent.length} absent`);
      if (!options.requireConfig && configResult.absent.length > 0) console.log("! runtime config is not complete; this is expected for offline dry-run");
    }
    console.log("DRY_RUN_ONLY: no RPC, provider, wallet, signer, funding, deployment, invoke, broadcast, ledger write, or strk20.json write");
    console.log("VERDICT: PRISM_TESTNET_REHEARSAL_DRY_RUN_READY_X2");
    return 0;
  } catch (error) {
    console.error(`✕ ${error instanceof Error ? error.message : String(error)}`);
    console.error("VERDICT: PRISM_TESTNET_REHEARSAL_BLOCKED_BEFORE_SIDE_EFFECT");
    return 1;
  }
}

process.exitCode = main();
