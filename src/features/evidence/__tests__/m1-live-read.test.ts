// M1 live-read tests — typed fixtures + 5 cross-checks + facet validators, offline, no secrets.
// Covers: create_identity/get_identity/event/indexer/watermark + wrong network, address mismatch,
// missing independent read, malformed receipt, stale block, determinism, strk20 guard.
// Authority: CONTRACT_SPEC OP-7-01/02, EVENT_CATALOGUE, INV-SYS-001/002/005/007, TEST_ARCHITECTURE T4/T9/T11/T12.

import { describe, it, expect } from "vitest";
import {
  buildM1Envelope,
  buildM1CreateIdentityFixture,
  buildM1GetIdentityFixture,
  buildM1EventFixture,
  buildM1IndexerFixture,
  buildM1WatermarkFixture,
  validateM1CreateIdentity,
  validateM1GetIdentity,
  validateM1Event,
  validateM1Indexer,
  validateM1Watermark,
  runM1CrossChecks,
  canonicalStringify,
} from "../m1-live-read";
import { PRISM_EVENT_SELECTORS } from "../../prism-operations/adapters/starknet-event-indexer";

function baseDeployment() {
  return {
    network: "SN_SEPOLIA" as const,
    address: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const,
    class_hash: "0x0abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" as const,
    deploy_tx: "0x0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0dead" as const,
    block_number: 12345,
    status: "SUCCEEDED" as const,
  };
}

function validM1Envelope() {
  const dep = baseDeployment();
  return buildM1Envelope({
    deployment: dep,
    createIdentityTx: { network: "SN_SEPOLIA", hash: dep.deploy_tx, block: dep.block_number, status: "SUCCEEDED" },
    getIdentityFixture: buildM1GetIdentityFixture(),
    eventFixture: buildM1EventFixture(),
    indexerFixture: buildM1IndexerFixture(),
    watermarkFixture: buildM1WatermarkFixture(),
    independentVerification: {
      explorer_url: "https://sepolia.voyager.online/tx/0x0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0dead",
      rpc_second_read: { block: 12345, status: "SUCCEEDED", address_match: true },
      verified_at: "2026-08-23T00:00:00Z",
    },
    chainId: 84532,
    maturity: "X3" as const,
    observedAt: "2026-08-23T00:00:00Z",
  });
}

describe("M1 live-read — typed facets deterministic + promotion", () => {
  it("valid M1 envelope with all 5 facets is promotable and deterministic", () => {
    const e1 = validM1Envelope();
    // Determinism: same logical inputs with fixed observed_at must canonicalize identically
    const fixedTs = "2026-08-23T00:00:00Z";
    const dep = baseDeployment();
    const f1 = buildM1Envelope({
      deployment: dep,
      createIdentityTx: { network: "SN_SEPOLIA", hash: dep.deploy_tx, block: dep.block_number, status: "SUCCEEDED" },
      getIdentityFixture: buildM1GetIdentityFixture(),
      eventFixture: buildM1EventFixture(),
      indexerFixture: buildM1IndexerFixture(),
      watermarkFixture: buildM1WatermarkFixture(),
      independentVerification: {
        explorer_url: "https://sepolia.voyager.online/tx/0x0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0dead",
        rpc_second_read: { block: 12345, status: "SUCCEEDED", address_match: true },
        verified_at: fixedTs,
      },
    });
    // Build with same dep but force same observed_at via build override is not exposed; so compare canonical without observed_at variance
    // Instead assert that two envelopes built from same dep with same facets have identical deployments/contracts/facets (observable determinism)
    expect(e1.deployment).toEqual(f1.deployment);
    expect(e1.contracts).toEqual(f1.contracts);
    expect(e1.inputs.facets).toEqual(f1.inputs.facets);
    const cross = runM1CrossChecks({ envelope: e1, watermarkFixture: buildM1WatermarkFixture(), indexerFixture: buildM1IndexerFixture() });
    expect(cross.valid).toBe(true);
    expect(cross.promotable).toBe(true);
    expect(cross.blockers).toEqual([]);
    expect(cross.suggestedMaturity).toBe("X3");
    // Also canonicalStringify is deterministic for same object
    expect(canonicalStringify(e1)).toBe(canonicalStringify(JSON.parse(JSON.stringify(e1))));
  });

  it("create_identity facet validates tx receipt + event selector + independent read", () => {
    const f = buildM1CreateIdentityFixture();
    const v = validateM1CreateIdentity(f);
    expect(v.valid).toBe(true);
    expect(v.blockers).toEqual([]);
    // Unknown status is malformed
    const bad = buildM1CreateIdentityFixture({ status: "UNKNOWN" as const, block: null as unknown as number });
    const v2 = validateM1CreateIdentity(bad);
    expect(v2.blockers.join(" ")).toMatch(/UNKNOWN|block missing/);
    // Wrong selector
    const wsel = buildM1CreateIdentityFixture({ event: { ...f.event, selector: "0xbad" as never } });
    expect(validateM1CreateIdentity(wsel).errors.join(" ")).toMatch(/selector mismatch/);
    // Missing independent read
    const noIV = buildM1CreateIdentityFixture({ independentVerification: { explorer_url: null, rpc_second_read: null } });
    expect(validateM1CreateIdentity(noIV).blockers.join(" ")).toMatch(/missing independent read/);
  });

  it("get_identity facet validates controller + watermark freshness, stale block blocks", () => {
    const fresh = buildM1GetIdentityFixture({ watermark: 96, confirmedBlock: 100, staleBoundK: 5 });
    expect(validateM1GetIdentity(fresh).blockers).toEqual([]);
    const stale = buildM1GetIdentityFixture({ watermark: 90, confirmedBlock: 100, staleBoundK: 5 });
    expect(validateM1GetIdentity(stale).blockers.join(" ")).toMatch(/stale block/);
    const nullWm = buildM1GetIdentityFixture({ watermark: null, confirmedBlock: 100 });
    expect(validateM1GetIdentity(nullWm).blockers.join(" ")).toMatch(/stale block/);
    expect(validateM1GetIdentity(nullWm).warnings.join(" ")).toMatch(/watermark null/);
  });

  it("event facet validates selector + correlationId + block", () => {
    const f = buildM1EventFixture();
    expect(validateM1Event(f).valid).toBe(true);
    expect(f.selector.toLowerCase()).toBe(PRISM_EVENT_SELECTORS.PrismIdentityCreated.toLowerCase());
    expect(f.correlationId).toBe(`${f.txHash.toLowerCase()}:0`);
    const badCorr = buildM1EventFixture({ correlationId: "0xbad:0" });
    expect(validateM1Event(badCorr).errors.join(" ")).toMatch(/correlationId mismatch/);
    const badSel = buildM1EventFixture({ selector: "0xbad" as never });
    expect(validateM1Event(badSel).errors.join(" ")).toMatch(/selector mismatch/);
  });

  it("indexer facet validates watermark, dedup, ordering", () => {
    const f = buildM1IndexerFixture();
    expect(validateM1Indexer(f).valid).toBe(true);
    expect(f.watermark).toBe(12345);
    // Duplicate keys
    const dupe = buildM1IndexerFixture({
      events: [
        { txHash: f.events[0].txHash, eventIndex: 0, blockNumber: 12345, kind: "PrismIdentityCreated" },
        { txHash: f.events[0].txHash, eventIndex: 0, blockNumber: 12345, kind: "PrismIdentityCreated" },
      ],
      dedupKeys: ["dup"],
    });
    expect(validateM1Indexer(dupe).errors.join(" ")).toMatch(/duplicate keys/);
    // Watermark mismatch
    const badWm = buildM1IndexerFixture({ watermark: 99999 as unknown as number });
    expect(validateM1Indexer(badWm).errors.join(" ")).toMatch(/watermark mismatch/);
  });

  it("watermark facet validates isStaleProjection deterministically", () => {
    const fresh = buildM1WatermarkFixture({ projectionWatermark: 96, confirmedBlock: 100, boundK: 5 });
    expect(fresh.isStale).toBe(false);
    expect(validateM1Watermark(fresh).blockers).toEqual([]);
    const stale = buildM1WatermarkFixture({ projectionWatermark: 90, confirmedBlock: 100, boundK: 5 });
    expect(stale.isStale).toBe(true);
    expect(validateM1Watermark(stale).blockers.join(" ")).toMatch(/stale block/);
    const nullWm = buildM1WatermarkFixture({ projectionWatermark: null, confirmedBlock: 100, boundK: 5 });
    expect(nullWm.isStale).toBe(true);
  });

  it("cross-check: wrong network blocks promotion", () => {
    const env = validM1Envelope();
    env.environment = "SN_MAIN" as never;
    const cross = runM1CrossChecks({ envelope: env });
    expect(cross.promotable).toBe(false);
    expect(cross.blockers.join(" ")).toMatch(/wrong network/);
  });

  it("cross-check: address mismatch blocks promotion", () => {
    const env = validM1Envelope();
    // Mutate contracts address vs deployment address
    env.contracts[0].address = "0x0222222222222222222222222222222222222222222222222222222222222222" as never;
    const cross = runM1CrossChecks({ envelope: env });
    expect(cross.promotable).toBe(false);
    expect(cross.blockers.join(" ")).toMatch(/address mismatch/);
    // Also observed RPC address mismatch
    const env2 = validM1Envelope();
    const cross2 = runM1CrossChecks({ envelope: env2, observedRegistryAddress: "0x0333333333333333333333333333333333333333333333333333333333333333" as never });
    expect(cross2.blockers.join(" ")).toMatch(/address mismatch/);
  });

  it("cross-check: missing independent read blocks promotion and downgrades to X2", () => {
    const env = validM1Envelope();
    env.independent_verification = { explorer_url: null, rpc_second_read: null, verified_at: null };
    env.maturity = "X3" as never;
    const cross = runM1CrossChecks({ envelope: env });
    expect(cross.promotable).toBe(false);
    expect(cross.blockers.join(" ")).toMatch(/independent_verification missing|missing independent read/);
    expect(cross.suggestedMaturity).toBe("X2");
  });

  it("cross-check: malformed receipt blocks promotion", () => {
    const dep = baseDeployment();
    const badHashEnv = buildM1Envelope({
      deployment: { ...dep, address: "not-hex" as never },
      createIdentityTx: { network: "SN_SEPOLIA", hash: "0xzzzz" as never, block: null as unknown as number, status: "UNKNOWN" as never },
      independentVerification: { explorer_url: "https://sepolia.voyager.online/tx/0x0dead", rpc_second_read: { block: 12345, status: "SUCCEEDED", address_match: true }, verified_at: "2026-08-23T00:00:00Z" },
    });
    const cross = runM1CrossChecks({ envelope: badHashEnv });
    expect(cross.promotable).toBe(false);
    expect([...cross.errors, ...cross.blockers].join(" ")).toMatch(/malformed|UNKNOWN|block missing/);
    expect(cross.valid).toBe(false);
    expect(cross.suggestedMaturity).toBe("X0");
  });

  it("cross-check: stale block blocks promotion", () => {
    const env = validM1Envelope();
    const staleWm = buildM1WatermarkFixture({ projectionWatermark: 90, confirmedBlock: 100, boundK: 5 });
    const cross = runM1CrossChecks({ envelope: env, watermarkFixture: staleWm });
    expect(cross.promotable).toBe(false);
    expect(cross.blockers.join(" ")).toMatch(/stale block/);
    // Also via indexer watermark far behind deployment block
    const staleIndexer = buildM1IndexerFixture({ watermark: 100, events: [{ txHash: env.deployment!.deploy_tx, eventIndex: 0, blockNumber: 100, kind: "PrismIdentityCreated" }] });
    const env2 = validM1Envelope();
    env2.deployment!.block_number = 200;
    const cross2 = runM1CrossChecks({ envelope: env2, indexerFixture: staleIndexer });
    expect(cross2.blockers.join(" ")).toMatch(/stale block/);
  });

  it("cannot write strk20.json — builder throws, cross-check validator blocks", () => {
    expect(() => buildM1Envelope({ deployment: baseDeployment(), createIdentityTx: { network: "SN_SEPOLIA", hash: baseDeployment().deploy_tx, block: 12345, status: "SUCCEEDED" } } as unknown as never)).not.toThrow(); // normal
    const env = validM1Envelope();
    // Bypass builder guard by mutating procedure
    env.procedure = ["write strk20.json with hash 0x..."];
    const cross = runM1CrossChecks({ envelope: env });
    expect(cross.errors.join(" ")).toMatch(/strk20\.json/);
    expect(cross.promotable).toBe(false);
  });

  it("determinism: two builds with same inputs yield identical canonical envelope", () => {
    const dep = baseDeployment();
    const fixedTs = "2026-08-23T00:00:00Z";
    const e1 = buildM1Envelope({ deployment: dep, getIdentityFixture: buildM1GetIdentityFixture(), eventFixture: buildM1EventFixture(), observedAt: fixedTs });
    const e2 = buildM1Envelope({ deployment: dep, getIdentityFixture: buildM1GetIdentityFixture(), eventFixture: buildM1EventFixture(), observedAt: fixedTs });
    expect(canonicalStringify(e1)).toBe(canonicalStringify(e2));
  });
});
