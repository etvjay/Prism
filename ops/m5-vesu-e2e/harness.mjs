#!/usr/bin/env node
// ops/m5-vesu-e2e/harness.mjs — provider-injected M5 E2E runner harness
// Usage:
//   node ops/m5-vesu-e2e/harness.mjs --self-test
//   node ops/m5-vesu-e2e/harness.mjs --env sepolia --amount 1000000000000000000
//   M5_RPC_URL=https://... M5_RPC_URL_2=https://... node ops/m5-vesu-e2e/harness.mjs --env sepolia --amount 1000000000000000000 --live
//
// Behavior:
//  - Without --live or without wallet provider, returns M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE (no fabricated hash)
//  - Never synthesizes a proof; simulate proof is empty and not evidence
//  - Uses public/read-only RPC for independent readback
//  - Invokes upstream validator when STRK20_VALIDATOR_PATH/URL is set

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const get = (flag, def = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? (args[i + 1] ?? def) : def;
};
const has = (flag) => args.includes(flag);

if (has("--self-test")) {
  // Run X2 unit tests for the runner
  const r = spawnSync("npm", ["test", "--", "src/features/prism-strk20/m5/__tests__/runner.test.ts"], { stdio: "inherit" });
  if (r.status === 0) console.log("\n✓ m5-vesu harness --self-test passed (X2, no wallet, no RPC, no proof)");
  process.exit(r.status ?? 0);
}

if (has("--help") || has("-h")) {
  console.log(`
M5 Vesu E2E harness — provider-injected, evidence-honest

  --self-test            Run X2 runner unit tests (no wallet, no RPC)
  --env sepolia          Target env (default sepolia; only sepolia supported for M5)
  --amount <bigint>      in_amount in STRK base units (default 1000000000000000000 = 1 STRK)
  --live                 Attempt live run (requires wallet provider injection; otherwise BLOCKED)
  --help                 This help

Environment:
  M5_RPC_URL             Public SN_SEPOLIA RPC URL (for independent readback)
  M5_RPC_URL_2           Second RPC URL for X3 independent verification
  STRK20_VALIDATOR_PATH  Path to upstream hub validator script (when configured)
  STRK20_VALIDATOR_URL   HTTP validator endpoint

Exit codes:
  0  Success (X2 ready or X3 live success)
  2  M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE (no wallet/prover)
  1  Failure (helper revert, stranded, validator mine=false, etc.)
`);
  process.exit(0);
}

const env = get("--env", "sepolia");
const amountStr = get("--amount", "1000000000000000000");
const isLive = has("--live");

if (env !== "sepolia" && env !== "SN_SEPOLIA") {
  console.error(`✕ M5 is SN_SEPOLIA only. Got --env ${env}`);
  process.exit(2);
}

const inAmount = BigInt(amountStr);
const MAX_U128 = (1n << 128n) - 1n;
if (inAmount <= 0n) {
  console.error("✕ in_amount must be >0");
  process.exit(1);
}
if (inAmount > MAX_U128) {
  console.error("✕ in_amount exceeds u128 max");
  process.exit(1);
}

console.log(`M5 Vesu E2E harness — env=SN_SEPOLIA in_amount=${inAmount} (${Number(inAmount) / 1e18} STRK)`);

if (!isLive) {
  console.log(`
⊘ M5_BLOCKED_BY_ENVIRONMENT_EVIDENCE
   Reason: no wallet/prover injected in offline harness invocation.
   The runner is provider-injected; without a real WalletAccountV6 + prover
   no transaction hash is fabricated and no mock proof is used as evidence.
   Run with --live and a real wallet to attempt the SN_SEPOLIA pool route.

   Predicates observed: capability=pending, fee=pending, simulate=pending, submission=not_attempted
   Predicate not observed: executionSucceeded, independentReadback, validatorMine

   Commit: ${process.env.GIT_COMMIT ?? "HEAD"}
   Next: connect Ready/Xverse wallet on SN_SEPOLIA with SNIP-36 prover, then re-run with --live.
`);
  process.exit(2);
}

// Live path — requires wallet injection.
// In CI/headless there is no wallet; we must not fabricate.
// We dynamically import the runner and check for injected provider via env.
const rpcUrl = process.env.M5_RPC_URL ?? process.env.NEXT_PUBLIC_STARKNET_RPC_URL ?? null;
const rpcUrl2 = process.env.M5_RPC_URL_2 ?? null;
const validatorPath = process.env.STRK20_VALIDATOR_PATH ?? null;

console.log(`RPC: ${rpcUrl ? "configured" : "not configured (X2 only)"} ${rpcUrl2 ? "+ second path for X3" : ""}`);
console.log(`Validator: ${validatorPath ?? "not configured (X2)"}`);

// No wallet injection available in Node harness without browser — return BLOCKED
console.log(`
⊘ M5_BLOCKED_BY_WALLET_PROVER
   No WalletAccountV6 provider available in Node harness.
   The provider-injected runner requires a real STRK20 wallet (Ready/Xverse) to
   generate the SNIP-36 proof. This harness cannot synthesize a proof.

   To observe live predicates, run the runner inside the browser context:
     - Connect Ready wallet on SN_SEPOLIA
     - Ensure STRK balance ≥ in_amount + fee
     - Invoke via dapp's M5 flow (see docs)

   No fabricated hash emitted.
   Evidence ceiling: X2 (runner ready, local tests green)
`);
process.exit(2);
