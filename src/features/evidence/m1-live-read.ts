// M1 live-read typed evidence harness — Starknet identity phase only.
// Scope: validates deployed SN_SEPOLIA PrismIdentityRegistry facts without fabricating
// a Prism ID, and provides typed fixtures/validators for five facets:
// create_identity / get_identity / event / indexer / watermark.
// All functions are deterministic, offline, secret-free, and never write strk20.json.
// Authority: SYSTEM_FOUNDRY §9/12/20, CONTRACT_SPEC OP-7-01/02, EVENT_CATALOGUE,
// INV-SYS-001/002/005/007, TEST_ARCHITECTURE T4/T9/T11/T12, EVD-PRISM-004.

import {
  buildEvidenceEnvelope,
  validateEvidenceEnvelope,
  canonicalStringify,
  assertNoStrk20JsonWrite,
  type EvidenceEnvelope,
  type DeploymentEvidence,
  type TxEvidence,
  type Hex,
  type EvidenceNetwork,
} from "./evidence-envelope";
import { isStaleProjection } from "../prism-operations/domain/event-indexer";
import { PRISM_EVENT_SELECTORS } from "../prism-operations/adapters/starknet-event-indexer";

// ---------------------------------------------------------------------------
// Typed facet payloads — each facet maps to a required evidence shape
// ---------------------------------------------------------------------------

export type M1Facet = "create_identity" | "get_identity" | "event" | "indexer" | "watermark";

export interface M1CreateIdentityFixture {
  facet: "create_identity";
  network: EvidenceNetwork;
  txHash: Hex;
  block: number;
  status: "SUCCEEDED" | "REVERTED" | "UNKNOWN";
  event: {
    selector: Hex;
    prismId: string;
    controller: Hex;
    txHash: Hex;
    eventIndex: number;
    blockNumber: number;
  };
  independentVerification: { explorer_url: string | null; rpc_second_read: { block: number; status: string; address_match: boolean } | null };
}

export interface M1GetIdentityFixture {
  facet: "get_identity";
  prismId: string;
  controller: Hex;
  createdAtBlock: number;
  version: number;
  watermark: number | null;
  exists: boolean;
  confirmedBlock: number | null;
  staleBoundK: number;
}

export interface M1EventFixture {
  facet: "event";
  kind: "PrismIdentityCreated";
  txHash: Hex;
  eventIndex: number;
  blockNumber: number;
  selector: Hex;
  payload: { prismId: string; controller: Hex };
  correlationId: string;
}

export interface M1IndexerFixture {
  facet: "indexer";
  registryAddress: Hex;
  events: Array<{ txHash: Hex; eventIndex: number; blockNumber: number; kind: string }>;
  watermark: number | null;
  pagesFetched: number;
  continuationToken: string | null;
  dedupKeys: string[];
}

export interface M1WatermarkFixture {
  facet: "watermark";
  projectionWatermark: number | null;
  confirmedBlock: number;
  boundK: number;
  isStale: boolean;
}

export type M1Fixture =
  | M1CreateIdentityFixture
  | M1GetIdentityFixture
  | M1EventFixture
  | M1IndexerFixture
  | M1WatermarkFixture;

// ---------------------------------------------------------------------------
// Deterministic builders — TEST DOUBLE labeled, never claim live
// ---------------------------------------------------------------------------

const TEST_DOUBLE_LABEL = "TEST DOUBLE — M1 live-read fixture (no live RPC)";
const FIXTURE_REGISTRY: Hex = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const FIXTURE_CLASS_HASH: Hex = "0x0abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const FIXTURE_TX: Hex = "0x0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0dead";
const FIXTURE_CONTROLLER: Hex = "0x1111111111111111111111111111111111111111111111111111111111111111";

export function buildM1CreateIdentityFixture(overrides?: Partial<M1CreateIdentityFixture>): M1CreateIdentityFixture {
  return {
    facet: "create_identity",
    network: "SN_SEPOLIA",
    txHash: FIXTURE_TX,
    block: 12345,
    status: "SUCCEEDED",
    event: {
      selector: PRISM_EVENT_SELECTORS.PrismIdentityCreated as Hex,
      prismId: "1",
      controller: FIXTURE_CONTROLLER,
      txHash: FIXTURE_TX,
      eventIndex: 0,
      blockNumber: 12345,
    },
    independentVerification: {
      explorer_url: "https://sepolia.voyager.online/tx/0x0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0dead",
      rpc_second_read: { block: 12345, status: "SUCCEEDED", address_match: true },
    },
    ...overrides,
  };
}

export function buildM1GetIdentityFixture(overrides?: Partial<M1GetIdentityFixture>): M1GetIdentityFixture {
  return {
    facet: "get_identity",
    prismId: "1",
    controller: FIXTURE_CONTROLLER,
    createdAtBlock: 12345,
    version: 0,
    watermark: 12345,
    exists: true,
    confirmedBlock: 12348,
    staleBoundK: 5,
    ...overrides,
  };
}

export function buildM1EventFixture(overrides?: Partial<M1EventFixture>): M1EventFixture {
  return {
    facet: "event",
    kind: "PrismIdentityCreated",
    txHash: FIXTURE_TX,
    eventIndex: 0,
    blockNumber: 12345,
    selector: PRISM_EVENT_SELECTORS.PrismIdentityCreated as Hex,
    payload: { prismId: "1", controller: FIXTURE_CONTROLLER },
    correlationId: `${FIXTURE_TX.toLowerCase()}:0`,
    ...overrides,
  };
}

export function buildM1IndexerFixture(overrides?: Partial<M1IndexerFixture>): M1IndexerFixture {
  return {
    facet: "indexer",
    registryAddress: FIXTURE_REGISTRY,
    events: [
      { txHash: FIXTURE_TX, eventIndex: 0, blockNumber: 12345, kind: "PrismIdentityCreated" },
    ],
    watermark: 12345,
    pagesFetched: 1,
    continuationToken: null,
    dedupKeys: [`${FIXTURE_TX.toLowerCase()}:0`],
    ...overrides,
  };
}

export function buildM1WatermarkFixture(overrides?: Partial<M1WatermarkFixture>): M1WatermarkFixture {
  const base = {
    facet: "watermark" as const,
    projectionWatermark: 12345 as number | null,
    confirmedBlock: 12348,
    boundK: 5,
    isStale: false as boolean,
  };
  const merged = { ...base, ...overrides };
  // Recompute isStale deterministically via isStaleProjection
  merged.isStale = isStaleProjection(merged.projectionWatermark, merged.confirmedBlock, merged.boundK);
  return merged;
}

// ---------------------------------------------------------------------------
// Validators — pure, offline, no secrets
// ---------------------------------------------------------------------------

export interface M1ValidationResult {
  valid: boolean;
  blockers: string[];
  errors: string[];
  warnings: string[];
}

function isHex(v: unknown): v is Hex {
  return typeof v === "string" && /^0x[0-9a-fA-F]{1,128}$/.test(v as string);
}

export function validateM1CreateIdentity(fixture: M1CreateIdentityFixture): M1ValidationResult {
  const blockers: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  if (fixture.network !== "SN_SEPOLIA") blockers.push(`wrong network: create_identity ${fixture.network} != SN_SEPOLIA`);
  if (!isHex(fixture.txHash)) errors.push("create_identity.txHash malformed");
  if (fixture.block === null || fixture.block === undefined) blockers.push("create_identity.block missing");
  if (fixture.status !== "SUCCEEDED") blockers.push(`create_identity.status ${fixture.status} — required SUCCEEDED`);
  if (fixture.status === "UNKNOWN") blockers.push("create_identity.status UNKNOWN — malformed receipt");
  if (!fixture.independentVerification?.explorer_url && !fixture.independentVerification?.rpc_second_read) blockers.push("missing independent read — need explorer_url or rpc_second_read");
  if (fixture.event.selector.toLowerCase() !== PRISM_EVENT_SELECTORS.PrismIdentityCreated.toLowerCase()) errors.push("create_identity.event selector mismatch — expected PrismIdentityCreated");
  if (!isHex(fixture.event.prismId as unknown as string) && fixture.event.prismId !== "1") {
    // prismId is felt252 decimal string in this slice — allow numeric string
    if (!/^\d+$/.test(fixture.event.prismId)) errors.push("create_identity.event.prismId malformed");
  }
  const valid = errors.length === 0;
  return { valid, blockers, errors, warnings };
}

export function validateM1GetIdentity(fixture: M1GetIdentityFixture): M1ValidationResult {
  const blockers: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!fixture.prismId) errors.push("get_identity.prismId missing");
  if (!isHex(fixture.controller)) errors.push("get_identity.controller malformed");
  if (typeof fixture.createdAtBlock !== "number" || !Number.isFinite(fixture.createdAtBlock)) errors.push("get_identity.createdAtBlock invalid");
  if (fixture.watermark === null) warnings.push("get_identity.watermark null — stale by definition");
  if (fixture.confirmedBlock !== null && fixture.watermark !== null) {
    const stale = isStaleProjection(fixture.watermark, fixture.confirmedBlock, fixture.staleBoundK);
    if (stale) blockers.push(`stale block: watermark ${fixture.watermark} < confirmed ${fixture.confirmedBlock} - K ${fixture.staleBoundK}`);
  }
  if (fixture.watermark === null && fixture.confirmedBlock !== null) blockers.push("stale block: watermark null — cannot prove freshness");
  const valid = errors.length === 0;
  return { valid, blockers, errors, warnings };
}

export function validateM1Event(fixture: M1EventFixture): M1ValidationResult {
  const blockers: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isHex(fixture.txHash)) errors.push("event.txHash malformed");
  if (fixture.selector.toLowerCase() !== PRISM_EVENT_SELECTORS.PrismIdentityCreated.toLowerCase()) errors.push("event.selector mismatch — expected PrismIdentityCreated");
  if (!isHex(fixture.payload.controller)) errors.push("event.payload.controller malformed");
  const expectedCorrelation = `${fixture.txHash.toLowerCase()}:${fixture.eventIndex}`;
  if (fixture.correlationId !== expectedCorrelation) errors.push(`event.correlationId mismatch: ${fixture.correlationId} != ${expectedCorrelation}`);
  if (typeof fixture.blockNumber !== "number" || fixture.blockNumber <= 0) errors.push("event.blockNumber invalid");
  const valid = errors.length === 0;
  return { valid, blockers, errors, warnings };
}

export function validateM1Indexer(fixture: M1IndexerFixture): M1ValidationResult {
  const blockers: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isHex(fixture.registryAddress)) errors.push("indexer.registryAddress malformed");
  // Address mismatch is checked externally against deployment address — here we just validate shape
  if (fixture.events.length === 0) warnings.push("indexer.events empty — no PrismIdentityCreated observed");
  // Dedup check: dedupKeys must equal events mapped to txHash:eventIndex
  const computedKeys = fixture.events.map((e) => `${e.txHash.toLowerCase()}:${e.eventIndex}`);
  const dupes = computedKeys.filter((k, i) => computedKeys.indexOf(k) !== i);
  if (dupes.length > 0) errors.push(`indexer duplicate keys: ${dupes.join(",")}`);
  if (fixture.dedupKeys && fixture.dedupKeys.length !== computedKeys.length) warnings.push("indexer dedupKeys length mismatch");
  if (fixture.continuationToken !== null && typeof fixture.continuationToken !== "string") errors.push("indexer.continuationToken malformed");
  // Watermark must be max blockNumber or null
  const expectedWatermark = fixture.events.length > 0 ? Math.max(...fixture.events.map((e) => e.blockNumber)) : null;
  if (fixture.watermark !== expectedWatermark) errors.push(`indexer.watermark mismatch: ${fixture.watermark} != ${expectedWatermark}`);
  const valid = errors.length === 0;
  return { valid, blockers, errors, warnings };
}

export function validateM1Watermark(fixture: M1WatermarkFixture): M1ValidationResult {
  const blockers: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const computed = isStaleProjection(fixture.projectionWatermark, fixture.confirmedBlock, fixture.boundK);
  if (computed !== fixture.isStale) errors.push(`watermark.isStale mismatch: computed ${computed} != fixture ${fixture.isStale}`);
  if (computed) blockers.push(`stale block: watermark ${fixture.projectionWatermark} < confirmed ${fixture.confirmedBlock} - K ${fixture.boundK}`);
  if (fixture.projectionWatermark === null) warnings.push("watermark null — stale");
  const valid = errors.length === 0;
  return { valid, blockers, errors, warnings };
}

// ---------------------------------------------------------------------------
// Cross-checks — the 5 required failure modes for M1 promotion blocking
// ---------------------------------------------------------------------------

export interface M1CrossCheckInput {
  envelope: EvidenceEnvelope;
  indexerFixture?: M1IndexerFixture;
  watermarkFixture?: M1WatermarkFixture;
  /** Optional second independent read to compare address_match */
  observedRegistryAddress?: Hex;
}

export interface M1CrossCheckResult {
  valid: boolean;
  promotable: boolean;
  blockers: string[];
  errors: string[];
  suggestedMaturity: "X0" | "X1" | "X2" | "X3" | "X4" | "X5";
}

export function runM1CrossChecks(input: M1CrossCheckInput): M1CrossCheckResult {
  const { envelope } = input;
  // Reuse envelope validator for base blockers/errors
  const base = validateEvidenceEnvelope(envelope);
  const blockers = [...base.blockers];
  const errors = [...base.errors];

  // 1. wrong network — already in base, but make explicit
  if (envelope.environment !== "SN_SEPOLIA") blockers.push(`wrong network cross-check: envelope ${envelope.environment} != SN_SEPOLIA`);

  // 2. address mismatch — deployment.address vs contracts[0].address
  if (envelope.deployment && envelope.contracts.length > 0) {
    const depAddr = envelope.deployment.address.toLowerCase();
    const contractAddr = envelope.contracts[0].address.toLowerCase();
    if (depAddr !== contractAddr) {
      blockers.push(`address mismatch: deployment ${depAddr} != contracts[0] ${contractAddr}`);
    }
  }
  if (input.observedRegistryAddress && envelope.deployment) {
    if (input.observedRegistryAddress.toLowerCase() !== envelope.deployment.address.toLowerCase()) {
      blockers.push(`address mismatch: observed RPC address ${input.observedRegistryAddress.toLowerCase()} != envelope deployment ${envelope.deployment.address.toLowerCase()}`);
    }
  }

  // 3. missing independent read — base already covers, but ensure downgrade
  const iv = envelope.independent_verification;
  if (!iv || (!iv.explorer_url && !iv.rpc_second_read)) {
    if (!blockers.includes("independent_verification missing — need explorer_url or rpc_second_read for promotable evidence")) {
      blockers.push("missing independent read — need explorer_url or rpc_second_read");
    }
  }

  // 4. malformed receipt — base covers, but add explicit for class_hash/address hex length
  if (envelope.deployment) {
    if (!isHex(envelope.deployment.address)) errors.push("cross-check: deployment.address malformed receipt");
    if (!isHex(envelope.deployment.class_hash)) errors.push("cross-check: deployment.class_hash malformed receipt");
    if (!isHex(envelope.deployment.deploy_tx)) errors.push("cross-check: deployment.deploy_tx malformed receipt");
    if (envelope.deployment.status === "UNKNOWN") blockers.push("malformed receipt: deployment.status UNKNOWN");
  }
  for (const tx of envelope.transactions) {
    if (!isHex(tx.hash)) errors.push("cross-check: transaction hash malformed receipt");
    if (tx.status === "UNKNOWN") blockers.push("malformed receipt: transaction status UNKNOWN");
    if (tx.block === null) blockers.push("malformed receipt: transaction block missing");
  }

  // 5. stale block — watermark vs confirmed block
  if (input.watermarkFixture) {
    const w = input.watermarkFixture;
    const stale = isStaleProjection(w.projectionWatermark, w.confirmedBlock, w.boundK);
    if (stale) blockers.push(`stale block cross-check: watermark ${w.projectionWatermark} < confirmed ${w.confirmedBlock} - K ${w.boundK}`);
  }
  if (input.indexerFixture) {
    // If indexer watermark is far behind envelope deployment block, treat as stale
    if (envelope.deployment && input.indexerFixture.watermark !== null) {
      const depBlock = envelope.deployment.block_number;
      const wm = input.indexerFixture.watermark;
      // Simple staleness: watermark behind deployment block by >10
      if (wm !== null && depBlock !== null && wm < depBlock - 10) {
        blockers.push(`stale block cross-check: indexer watermark ${wm} << deployment block ${depBlock}`);
      }
    }
  }

  const valid = errors.length === 0;
  const promotable = valid && blockers.length === 0;
  let suggestedMaturity: M1CrossCheckResult["suggestedMaturity"] = base.suggestedMaturity;
  if (!valid) suggestedMaturity = "X0";
  else if (!promotable) {
    const hasIV = !!(iv?.explorer_url || iv?.rpc_second_read);
    if (!hasIV) suggestedMaturity = "X2";
    else if (["X3", "X4", "X5"].includes(suggestedMaturity)) suggestedMaturity = "X2";
    if (suggestedMaturity === "X0") suggestedMaturity = "X2";
  }
  return { valid, promotable, blockers, errors, suggestedMaturity };
}

// ---------------------------------------------------------------------------
// Envelope factory for M1 — wraps deployment + facets into one envelope
// ---------------------------------------------------------------------------

export interface BuildM1EnvelopeInput {
  evidenceId?: string;
  claim?: string;
  network?: EvidenceNetwork;
  deployment: DeploymentEvidence;
  createIdentityTx?: TxEvidence;
  getIdentityFixture?: M1GetIdentityFixture;
  eventFixture?: M1EventFixture;
  indexerFixture?: M1IndexerFixture;
  watermarkFixture?: M1WatermarkFixture;
  independentVerification?: EvidenceEnvelope["independent_verification"];
  chainId?: number;
  maturity?: "X0" | "X1" | "X2" | "X3" | "X4" | "X5";
  observedAt?: string;
}

export function buildM1Envelope(input: BuildM1EnvelopeInput): EvidenceEnvelope {
  const evidenceId = input.evidenceId ?? "EVD-PRISM-004";
  assertNoStrk20JsonWrite(evidenceId);
  const network = input.network ?? "SN_SEPOLIA";
  const txs: TxEvidence[] = input.createIdentityTx ? [input.createIdentityTx] : [];
  const facets: string[] = [];
  if (input.createIdentityTx) facets.push("create_identity");
  if (input.getIdentityFixture) facets.push("get_identity");
  if (input.eventFixture) facets.push("event");
  if (input.indexerFixture) facets.push("indexer");
  if (input.watermarkFixture) facets.push("watermark");
  const envelope = buildEvidenceEnvelope({
    evidence_id: evidenceId,
    claim: input.claim ?? `M1 live-read ${facets.join("+") || "registry deploy"} on ${network} (${TEST_DOUBLE_LABEL})`,
    environment: network,
    build: { commit_sha: "7a385d2", spec_versions: { scarb: "2.20.0", snforge: "0.63.0", starknet: "10.4.0" } },
    procedure: [
      "scarb build",
      "snforge test",
      `M1 facets: ${facets.join(", ") || "deploy only"} — ${TEST_DOUBLE_LABEL}`,
      "read-only: starknet_call get_identity + getEvents (no broadcast)",
    ],
    inputs: {
      chainId: input.chainId ?? 84532,
      facets,
      harnessLabel: TEST_DOUBLE_LABEL,
      ...(input.getIdentityFixture ? { getIdentity: { prismId: input.getIdentityFixture.prismId, watermark: input.getIdentityFixture.watermark } } : {}),
      ...(input.eventFixture ? { event: { selector: input.eventFixture.selector, correlationId: input.eventFixture.correlationId } } : {}),
      ...(input.indexerFixture ? { indexer: { registryAddress: input.indexerFixture.registryAddress, watermark: input.indexerFixture.watermark } } : {}),
      ...(input.watermarkFixture ? { watermark: { projectionWatermark: input.watermarkFixture.projectionWatermark, confirmedBlock: input.watermarkFixture.confirmedBlock, boundK: input.watermarkFixture.boundK } } : {}),
    },
    deployment: input.deployment,
    transactions: txs,
    contracts: [{ address: input.deployment.address, class_hash: input.deployment.class_hash, name: "PrismIdentityRegistry" }],
    claim_scope: `M1 Starknet identity phase — facets ${facets.join(", ") || "deploy only"} — no Prism ID fabricated; read-only verification only`,
    limitations: [
      `${TEST_DOUBLE_LABEL} — no live SN_SEPOLIA RPC by default`,
      "no independent read → X2 ceiling unless explorer_url + rpc_second_read supplied",
      "operator must broadcast first create_identity; harness is read-only",
      "strk20.json never written",
    ],
    independent_verification: input.independentVerification ?? { explorer_url: null, rpc_second_read: null, verified_at: null },
    maturity: input.maturity ?? "X2",
    observed_at: input.observedAt,
    target_manifest: { environment: "testnet", network: "SN_SEPOLIA", chain_id: input.chainId ?? 84532 },
  });
  // Clamp maturity via validator: if independent read present and no blockers, allow X3 — caller may request X3 for live envelope
  if (input.maturity === "X3" && envelope.promotion_blockers.length === 0) {
    envelope.maturity = "X3";
  }
  return envelope;
}

// Re-export canonicalStringify for determinism checks
export { canonicalStringify };
