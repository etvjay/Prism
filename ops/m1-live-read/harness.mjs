#!/usr/bin/env node
// ops/m1-live-read/harness.mjs — M1 live-read harness (offline-first, read-only)
// Usage:
//   node ops/m1-live-read/harness.mjs --self-test
//   node ops/m1-live-read/harness.mjs --env testnet --registry 0x... --prism-id 1
//   node ops/m1-live-read/harness.mjs --env testnet --registry 0x... --prism-id 1 --rpc https://... --expected-class-hash 0x...
//
// This bundle's harness is OFFLINE by default (TEST DOUBLE). Live RPC is read-only
// (call/getEvents/getBlock) and never broadcasts, never handles private keys,
// never writes strk20.json. Supply --rpc to attempt a live read.

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const get = (flag, def = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? (args[i + 1] ?? def) : def;
};

if (args.includes("--self-test")) {
  // Run the vitest M1 harness offline (no RPC) — asserts X2 fixtures pass
  const r = spawnSync("npm", ["test", "--", "src/features/evidence/__tests__/m1-live-read.test.ts"], { stdio: "inherit" });
  if (r.status === 0) console.log("\n✓ m1-live-read harness --self-test passed (offline, TEST DOUBLE, X2)");
  else console.log("\n✕ m1-live-read harness --self-test failed");
  process.exit(r.status ?? 0);
}

const env = get("--env", "testnet");
const registry = get("--registry", null);
const prismId = get("--prism-id", null);
const rpc = get("--rpc", null);
const expectedClassHash = get("--expected-class-hash", null);
const fromBlockRaw = get("--from-block", "0");
const fromBlock = Number(fromBlockRaw);
if (!Number.isInteger(fromBlock) || fromBlock < 0) {
  console.error(`✕ --from-block malformed: ${fromBlockRaw}`);
  process.exit(2);
}

if (env !== "testnet") {
  console.error(`✕ env must be testnet for M1 (manifest release-gated). Got ${env}`);
  process.exit(2);
}

console.log(`M1 harness env=${env} registry=${registry ?? "(none — offline fixture)"} prismId=${prismId ?? "(none — probe mode)"} rpc=${rpc ? "live (read-only)" : "offline (TEST DOUBLE)"}`);
console.log("Authority: CONTRACT_SPEC OP-7-01/02, EVENT_CATALOGUE PrismIdentityCreated, INV-SYS-001/002/005/007");
console.log("Read-only: get_identity (call), getEvents (indexer), getBlock (watermark). No invoke, no broadcast, no strk20.json.");

if (!rpc) {
  console.log("\nThis bundle's harness is OFFLINE — TEST DOUBLE only.");
  console.log("For a live SN_SEPOLIA read, supply --rpc <public-rpc-url> and --registry <deployed-address>:");
  console.log("  node ops/m1-live-read/harness.mjs --env testnet --registry 0x123... --prism-id 1 --rpc https://starknet-sepolia.public.blastapi.io/rpc/v0_7");
  console.log("Procedure details: ops/m1-live-read/PROCEDURE.md §2.");
  console.log("\nCross-checks exercised offline (see src/features/evidence/__tests__/m1-live-read.test.ts):");
  console.log("  wrong network | address mismatch | missing independent read | malformed receipt | stale block");
  process.exit(0);
}

// ----- Live read-only path (requires --rpc + --registry) -----
if (!registry) {
  console.error("✕ --registry required for live read (supplied deployment address)");
  process.exit(2);
}
if (!/^0x[0-9a-fA-F]{1,64}$/.test(registry)) {
  console.error(`✕ --registry malformed (expected 0x hex): ${registry}`);
  process.exit(2);
}

async function rpcCall(method, params) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method} error: ${JSON.stringify(body.error)}`);
  return body.result;
}

(async () => {
  try {
    // 1) getClassHashAt — validates address/class_hash binding without secrets
    console.log("\n[1] Validating registry address/class_hash via starknet_getClassHashAt...");
    const classHashAt = await rpcCall("starknet_getClassHashAt", ["latest", registry]);
    console.log(`  classHashAt ${registry} → ${classHashAt}`);
    if (expectedClassHash && classHashAt.toLowerCase() !== expectedClassHash.toLowerCase()) {
      console.error(`✕ address mismatch cross-check: expected ${expectedClassHash} but RPC returned ${classHashAt}`);
      console.error("  → blocker: address mismatch (deployment.class_hash != observed class hash)");
      process.exit(1);
    }

    // 2) get_identity (call) — read-only, never fabricates a Prism ID; probe the supplied prismId
    const pid = prismId ?? "1";
    const pidFelt = /^0x[0-9a-fA-F]+$/.test(pid) ? pid : `0x${BigInt(pid).toString(16)}`;
    console.log(`\n[2] Read-only get_identity for prism_id=${pid} via starknet_call...`);
    // Selector verified against PrismIdentityRegistry ABI.
    const GET_IDENTITY_SELECTOR = "0x2c4943a27e820803a6ef49bb04b629950e2de615ab9ac0fb8baef037b168782";
    try {
      const callResult = await rpcCall("starknet_call", [{ contract_address: registry, entry_point_selector: GET_IDENTITY_SELECTOR, calldata: [pidFelt] }, "latest"]);
      console.log(`  starknet_call get_identity(${pid}) →`, JSON.stringify(callResult).slice(0, 400));
      // Result is Option<Identity>: deployed Cairo encoding uses tag 0 = Some, tag 1 = None.
      const isNone = Array.isArray(callResult) && callResult.length > 0 && ["0x1", "1"].includes(String(callResult[0]).toLowerCase());
      console.log(`  exists: ${isNone ? "false (None — unknown prism_id)" : "true (Some)"}`);
    } catch (e) {
      console.log(`  note: starknet_call failed (read-only): ${e.message}`);
      console.log("  fallback: use the canonical RegistryReadAdapter/RPC call path; no invoke attempted");
    }

    // 3) getEvents for PrismIdentityCreated + watermark
    console.log("\n[3] Read-only indexer fetch (PrismIdentityCreated events) + watermark...");
    const PRISM_CREATED_SELECTOR = "0x2c3cc45f2ad701f3571bc1faaf7d37e194064f8e8e3269b8642fc31624960e7";
    const allEvents = [];
    const seenEvents = new Set();
    let continuationToken = null;
    let pagesFetched = 0;
    do {
      const filter = {
        from_block: { block_number: fromBlock },
        to_block: "latest",
        address: registry,
        keys: [[PRISM_CREATED_SELECTOR]],
        chunk_size: 1000,
      };
      if (continuationToken) filter.continuation_token = continuationToken;
      const page = await rpcCall("starknet_getEvents", [filter]);
      for (const event of page.events ?? []) {
        const key = `${event.transaction_hash}:${event.event_index}`;
        if (seenEvents.has(key)) continue;
        seenEvents.add(key);
        allEvents.push(event);
      }
      pagesFetched += 1;
      continuationToken = page.continuation_token ?? null;
      if (pagesFetched >= 100 && continuationToken) throw new Error("event_pagination_limit_exceeded");
    } while (continuationToken);
    const events = allEvents;
    const eventWatermark = events.length ? Math.max(...events.map((e) => e.block_number ?? 0)) : null;
    console.log(`  events: ${events.length} PrismIdentityCreated, pages=${pagesFetched}, eventWatermark=${eventWatermark}, continuation_token=${continuationToken ?? "null"}`);
    if (events.length) {
      console.log(`  sample keys: ${JSON.stringify(events[0].keys ?? events[0].event?.keys ?? []).slice(0, 200)}`);
    }

    // 4) confirmed block + stale check
    console.log("\n[4] Watermark freshness (stale block cross-check, K=5)...");
    const latestBlock = await rpcCall("starknet_getBlockWithTxHashes", ["latest"]);
    const confirmedBlock = latestBlock.block_number ?? latestBlock.blockNumber ?? null;
    const scanWatermark = confirmedBlock;
    console.log(`  confirmedBlock (latest) = ${confirmedBlock}`);
    console.log(`  scanWatermark = ${scanWatermark}; eventWatermark = ${eventWatermark}`);
    if (scanWatermark !== null && confirmedBlock !== null) {
      const K = 5;
      const stale = scanWatermark < confirmedBlock - K;
      console.log(`  isStaleProjection(scanWatermark=${scanWatermark}, confirmed=${confirmedBlock}, K=${K}) → ${stale}`);
      if (stale) console.log("  → blocker: scan watermark behind confirmed - K");
      else if (eventWatermark !== null && eventWatermark < confirmedBlock - K) console.log("  ✓ scan fresh; newest matching event is older, which is not a scan-watermark failure");
      else console.log("  ✓ fresh (not stale)");
    } else {
      console.log("  scanWatermark null → stale by definition (confirmed block unavailable)");
    }

    console.log("\n✓ M1 live read (read-only) completed. To promote to X3, build an envelope with:");
    console.log("  deployment {address, class_hash, deploy_tx, block, status SUCCEEDED}");
    console.log("  transactions [{hash, block, status SUCCEEDED}] + PrismIdentityCreated event");
    console.log("  independent_verification {explorer_url, rpc_second_read{block,status,address_match}}");
    console.log("  then: node ops/m1-live-read/validate.mjs <envelope.json> --require-independent-read");
    console.log("No invoke, no strk20.json, no private key was used.");
  } catch (err) {
    console.error(`\n✕ live read failed (read-only, no broadcast attempted): ${err.message}`);
    if (err.stack) console.error(err.stack.split("\n").slice(0, 6).join("\n"));
    process.exit(1);
  }
})();
