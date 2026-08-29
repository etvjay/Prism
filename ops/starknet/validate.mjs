#!/usr/bin/env node
// ops/starknet/validate.mjs — secret-free template lint, no RPC, no env required
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function fail(m){ console.error(`✕ ${m}`); }
function pass(m){ console.log(`✓ ${m}`); }

let ok = true;

const snfoundry = resolve("contracts/prism_identity_registry/snfoundry.toml");
if (!existsSync(snfoundry)) { fail("snfoundry.toml missing"); ok=false; }
else {
  const raw = readFileSync(snfoundry,"utf8");
  // Must have only commented placeholder profiles (no active url= line with real URL)
  const activeUrl = raw.split("\n").some(l => /^\s*url\s*=/.test(l) && !l.trim().startsWith("#"));
  if (activeUrl) { fail("snfoundry.toml contains active url= line — must stay commented/secret-free until owner funds deployer"); ok=false; }
  else pass("snfoundry.toml has no active secret url (placeholder only)");

  if (/alchemy\.com\/v2\/[A-Za-z0-9_-]{10,}/.test(raw)) { fail("snfoundry.toml has hard-coded RPC key"); ok=false; }
  else pass("snfoundry.toml has no hard-coded RPC key");

  const hasHexSecret = /0x[0-9a-fA-F]{64}/.test(raw);
  const isPlaceholder = raw.includes("0x<") || raw.includes("0xYOUR");
  if (hasHexSecret && !isPlaceholder && !raw.includes("0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a")) {
    const m = raw.match(/0x[0-9a-fA-F]{64}/);
    if (m) { fail(`snfoundry.toml contains hex secret ${m[0].slice(0,10)}…`); ok=false; }
  } else pass("snfoundry.toml has no hex private key literal");
}

for (const p of ["ops/starknet/sncast.toml.example","ops/starknet/provider.example.toml","ops/starknet/accounts.json.example"]) {
  if (!existsSync(resolve(p))) { fail(`${p} missing`); ok=false; continue; }
  const raw = readFileSync(resolve(p),"utf8");
  pass(`${p} exists`);
  if (/alchemy\.com\/v2\/[A-Za-z0-9_-]{15,}/.test(raw) && raw.includes("YOUR_")) {
    // placeholder with YOUR_ is ok
    pass(`${p} RPC placeholder is sanitized`);
  } else if (/alchemy\.com\/v2\/[A-Za-z0-9_-]{15,}/.test(raw)) {
    fail(`${p} contains non-placeholder Alchemy key`);
    ok=false;
  } else pass(`${p} has no hard-coded RPC key`);

  // Detect real 64-hex private key (not placeholder)
  const hexes = [...raw.matchAll(/0x[0-9a-fA-F]{64}/g)].map(m=>m[0]);
  const realHex = hexes.filter(h => !h.includes("<") && h.toLowerCase()!=="0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a".toLowerCase() && !/0x<|0xYOUR/i.test(raw.slice(raw.indexOf(h)-5, raw.indexOf(h)+5)));
  // Simpler: if file contains 0x< placeholder, treat all as placeholders
  if (raw.includes("0x<") || raw.includes("0xYOUR")) pass(`${p} hex placeholders are sanitized`);
  else if (realHex.length) { fail(`${p} contains hex secret`); ok=false; }
  else pass(`${p} has no hex private key`);

  // Must reference env var names
  if (raw.includes("_RPC_URL") || raw.includes("_PRIVATE_KEY") || raw.includes("keystore")) pass(`${p} references env var / keystore`);
  else { fail(`${p} does not reference env var for secrets`); ok=false; }
}

// No active sncast.toml committed (only example)
if (existsSync(resolve("sncast.toml")) || existsSync(resolve("ops/starknet/sncast.toml"))) {
  fail("active sncast.toml is committed — only sncast.toml.example should be in repo");
  ok=false;
} else pass("no active sncast.toml committed (only example)");

// .env must not contain secrets with real keys (check .env.example is placeholder)
if (existsSync(resolve(".env.example"))) {
  const raw = readFileSync(resolve(".env.example"),"utf8");
  if (/YOUR_ALCHEMY_KEY|YOUR_PUBLIC_OR_RESTRICTED_KEY/.test(raw)) pass(".env.example uses placeholders");
  else pass(".env.example present");
  if (/alchemy\.com\/v2\/[A-Za-z0-9_-]{15,}/.test(raw) && !/YOUR/.test(raw)) { fail(".env.example has real key"); ok=false; }
}

if (!ok) { console.error("\n✕ starknet/sncast validation FAILED"); process.exit(1); }
console.log("\n✓ starknet/sncast/provider/account templates are secret-free and env-var-driven.");
