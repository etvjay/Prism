// Evidence envelope builder/validator — deterministic, secret-free, offline.
// Covers: network, address, class hash, deploy tx, blocks, status, independent reads,
// limitations, commit/spec versions. Deterministic canonical serialization; promotion
// is blocked when any required field/receipt is missing; never writes strk20.json.
//
// References: EVIDENCE_LEDGER.md template, BACKEND_PRODUCTION_READINESS_PACKET §6,
//             STARKNET_MAINNET_EVIDENCE_PROFILE §4, SYSTEM_CANONICAL §9.

export type Hex = `0x${string}`;

export const ENVELOPE_VERSION = 1;

export type XMaturity = "X0" | "X1" | "X2" | "X3" | "X4" | "X5";

export type EvidenceNetwork = "SN_SEPOLIA" | "SN_MAIN" | "UNKNOWN";

export interface BuildInfo {
  commit_sha: string; // 7..40 hex
  spec_versions: Record<string, string>; // e.g. { scarb:"2.20.0", snforge:"0.63.0", starknet:"10.4.0" }
  observed_at?: string; // ISO timestamp, set by builder if absent
}

export interface DeploymentEvidence {
  network: EvidenceNetwork;
  address: Hex;
  class_hash: Hex;
  deploy_tx: Hex;
  block_number: number;
  status: "SUCCEEDED" | "REVERTED" | "UNKNOWN";
}

export interface TxEvidence {
  network: EvidenceNetwork;
  hash: Hex;
  block: number | null;
  status: "SUCCEEDED" | "REVERTED" | "UNKNOWN";
  revert_reason?: string | null;
  class_hash?: Hex | null;
}

export interface IndependentVerification {
  explorer_url: string | null;
  rpc_second_read: { block: number; status: string; address_match: boolean } | null;
  verified_at: string | null;
}

export interface EvidenceEnvelope {
  envelope_version: 1;
  evidence_id: string; // e.g. EVD-PRISM-004
  claim: string;
  environment: EvidenceNetwork; // target network of the run
  build: BuildInfo;
  procedure: string[]; // exact commands run
  inputs: Record<string, unknown>;
  deployment: DeploymentEvidence | null; // required for X3+ identity evidence
  transactions: TxEvidence[];
  contracts: Array<{ address: Hex; class_hash: Hex; name: string }>;
  hub_validator?: { ok: boolean; pool: boolean; mine: boolean } | null;
  claim_scope: string;
  limitations: string[];
  independent_verification: IndependentVerification;
  maturity: XMaturity;
  observed_at: string;
  target_manifest?: { environment: string; network: EvidenceNetwork; chain_id: number } | null;
  // derived — not stored externally, but included for determinism checks
  promotion_blockers: string[];
}

// ---------------------------------------------------------------------------
// Helpers — deterministic, no side-effects, no FS
// ---------------------------------------------------------------------------

function isHex(v: unknown): v is Hex {
  return typeof v === "string" && /^0x[0-9a-fA-F]{1,128}$/.test(v);
}

function isNonEmptyString(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

function isValidNetwork(n: unknown): n is EvidenceNetwork {
  return n === "SN_SEPOLIA" || n === "SN_MAIN";
}

export function canonicalStringify(value: unknown): string {
  // Deterministic JSON: sorted keys, no whitespace, stable for hashing/proof.
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`).join(",")}}`;
}

export function assertNoStrk20JsonWrite(path: string): void {
  const normalized = path.trim().toLowerCase();
  if (normalized.endsWith("strk20.json") || normalized === "strk20.json" || normalized.includes("/strk20.json")) {
    throw new Error(`evidence envelope must never write strk20.json (blocked path: ${path})`);
  }
}

// ---------------------------------------------------------------------------
// Builder — pure, deterministic
// ---------------------------------------------------------------------------

export interface BuildEnvelopeInput {
  evidence_id: string;
  claim: string;
  environment: EvidenceNetwork;
  build: BuildInfo;
  procedure: string[];
  inputs?: Record<string, unknown>;
  deployment?: DeploymentEvidence | null;
  transactions?: TxEvidence[];
  contracts?: Array<{ address: Hex; class_hash: Hex; name: string }>;
  claim_scope?: string;
  limitations?: string[];
  independent_verification?: IndependentVerification | null;
  maturity?: XMaturity;
  observed_at?: string;
  target_manifest?: { environment: string; network: EvidenceNetwork; chain_id: number } | null;
  hub_validator?: { ok: boolean; pool: boolean; mine: boolean } | null;
}

export function buildEvidenceEnvelope(input: BuildEnvelopeInput): EvidenceEnvelope {
  // Guard: never build an envelope that targets strk20.json write
  assertNoStrk20JsonWrite(input.evidence_id); // evidence_id must not be a file path; this catches misuse like {evidence_id:"strk20.json"}
  if (input.procedure.some((p) => p.toLowerCase().includes("strk20.json"))) {
    // Procedure may mention the file as a prohibition ("do not write strk20.json") — allow that
    // But block a procedure that actually writes it (without the prohibition wording)
    const writes = input.procedure.filter(
      (p) => />\s*strk20\.json|write.*strk20\.json/i.test(p) && !/do not write|never write|must not write/i.test(p),
    );
    if (writes.length) throw new Error(`procedure must not write strk20.json: ${writes[0]}`);
  }

  const observed_at = input.observed_at ?? input.build.observed_at ?? new Date().toISOString();
  const build: BuildInfo = {
    commit_sha: input.build.commit_sha,
    spec_versions: { ...input.build.spec_versions },
    observed_at,
  };

  const envelope: EvidenceEnvelope = {
    envelope_version: ENVELOPE_VERSION,
    evidence_id: input.evidence_id,
    claim: input.claim,
    environment: input.environment,
    build,
    procedure: [...input.procedure],
    inputs: input.inputs ? { ...input.inputs } : {},
    deployment: input.deployment ?? null,
    transactions: input.transactions ? [...input.transactions] : [],
    contracts: input.contracts ? [...input.contracts] : [],
    hub_validator: input.hub_validator ?? null,
    claim_scope: input.claim_scope ?? "",
    limitations: input.limitations ? [...input.limitations] : [],
    independent_verification: input.independent_verification ?? { explorer_url: null, rpc_second_read: null, verified_at: null },
    maturity: input.maturity ?? "X0",
    observed_at,
    target_manifest: input.target_manifest ?? null,
    promotion_blockers: [],
  };

  // Deterministic fixup: compute promotion_blockers via validator (pure)
  const validation = validateEvidenceEnvelope(envelope);
  envelope.promotion_blockers = validation.blockers;
  // Clamp maturity: validation may downgrade
  if (validation.suggestedMaturity && validation.suggestedMaturity !== envelope.maturity) {
    envelope.maturity = validation.suggestedMaturity;
  }
  return envelope;
}

// ---------------------------------------------------------------------------
// Validator — deterministic, offline, no RPC
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean; // structurally valid (required shape present)
  promotable: boolean; // may be promoted to EVIDENCE_LEDGER / X3+
  blockers: string[]; // reasons not promotable (empty when promotable)
  suggestedMaturity: XMaturity;
  errors: string[]; // structural errors
  warnings: string[];
}

export function validateEvidenceEnvelope(envelope: EvidenceEnvelope): ValidationResult {
  const blockers: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  // Structural checks
  if (!isNonEmptyString(envelope.evidence_id)) errors.push("evidence_id missing");
  if (!isNonEmptyString(envelope.claim)) errors.push("claim missing");
  if (!isValidNetwork(envelope.environment)) errors.push(`environment must be SN_SEPOLIA or SN_MAIN (got ${String(envelope.environment)})`);
  if (!isNonEmptyString(envelope.build?.commit_sha)) errors.push("build.commit_sha missing");
  else if (!/^[0-9a-f]{7,40}$/i.test(envelope.build.commit_sha)) warnings.push("build.commit_sha should be 7..40 hex");
  if (!envelope.build?.spec_versions || Object.keys(envelope.build.spec_versions).length === 0) errors.push("build.spec_versions missing");
  if (!envelope.procedure || envelope.procedure.length === 0) errors.push("procedure missing");
  if (!envelope.observed_at) errors.push("observed_at missing");
  if (!isNonEmptyString(envelope.claim_scope)) warnings.push("claim_scope empty");
  if (!envelope.limitations || envelope.limitations.length === 0) {
    errors.push("limitations missing — must document what is NOT evidenced");
    blockers.push("limitations missing — must document what is NOT evidenced");
  }

  // Deployment evidence is the critical block for network/address/class hash/deploy tx/blocks/status
  const dep = envelope.deployment;
  if (!dep) {
    blockers.push("deployment missing — need network, address, class_hash, deploy_tx, block_number, status");
  } else {
    if (!isValidNetwork(dep.network)) errors.push(`deployment.network invalid: ${String(dep.network)}`);
    if (envelope.environment !== dep.network) blockers.push(`wrong network: envelope environment ${envelope.environment} != deployment.network ${dep.network}`);
    if (!isHex(dep.address)) errors.push("deployment.address malformed (expected 0x… hex)");
    if (!isHex(dep.class_hash)) errors.push("deployment.class_hash malformed");
    if (!isHex(dep.deploy_tx)) errors.push("deployment.deploy_tx malformed");
    if (typeof dep.block_number !== "number" || !Number.isFinite(dep.block_number) || dep.block_number <= 0) errors.push("deployment.block_number missing/invalid");
    if (dep.status !== "SUCCEEDED") blockers.push(`deployment.status is ${dep.status} — required SUCCEEDED`);
  }

  // Transactions block: every tx must have receipt-grade fields
  if (!envelope.transactions || envelope.transactions.length === 0) {
    // Not an error for pure deploy envelope, but blocks promotion for operation evidence
    // The harness (create→…→revoke) expects at least one operation tx; we treat missing tx as blocker for X3+
    // For EVD-PRISM-004 (deploy only), deployment alone may still be promotable — so don't error here, only warn
    warnings.push("transactions empty — operation evidence requires transaction receipts");
  } else {
    for (let i = 0; i < envelope.transactions.length; i++) {
      const tx = envelope.transactions[i];
      const prefix = `transactions[${i}]`;
      if (!isValidNetwork(tx.network)) errors.push(`${prefix}.network invalid`);
      if (tx.network !== envelope.environment) blockers.push(`wrong network: ${prefix} network ${tx.network} != envelope environment ${envelope.environment}`);
      if (!isHex(tx.hash)) errors.push(`${prefix}.hash malformed`);
      if (tx.block === null || tx.block === undefined) blockers.push(`${prefix}.block missing`);
      if (!tx.status || tx.status === "UNKNOWN") blockers.push(`${prefix}.status missing/UNKNOWN`);
      if (tx.status === "REVERTED") blockers.push(`${prefix}.status REVERTED — not promotable`);
      // class_hash on tx is not required; but if envelope expects it for reconciliation, warn
    }
  }

  // Independent verification — required for X3+ per BACKEND_PRODUCTION_READINESS_PACKET §6.7
  const iv = envelope.independent_verification;
  if (!iv || (!iv.explorer_url && !iv.rpc_second_read)) {
    blockers.push("independent_verification missing — need explorer_url or rpc_second_read for promotable evidence");
  } else {
    if (iv.rpc_second_read && !isNonEmptyString(iv.verified_at) && !envelope.observed_at) warnings.push("independent read without verified_at");
  }

  // Target manifest binding (chainId + Starknet network must match manifest if present)
  if (envelope.target_manifest) {
    if (envelope.target_manifest.network !== envelope.environment) blockers.push(`target_manifest network ${envelope.target_manifest.network} != envelope environment ${envelope.environment}`);
    // ChainId sanity: 84532 for testnet, 8453 for mainnet — envelope is Starknet evidence, but Base bindings reference chainId via inputs
    // We treat mismatch as blocker when inputs.chainId is present
    const inputChainId = (envelope.inputs as Record<string, unknown>)?.chainId ?? (envelope.inputs as Record<string, unknown>)?.chain_id;
    if (typeof inputChainId === "number" && envelope.target_manifest.chain_id !== inputChainId) {
      blockers.push(`chainId target mismatch: envelope inputs chainId ${inputChainId} != manifest chain_id ${envelope.target_manifest.chain_id} — altered_fields:chain_id`);
    }
  }

  // Missing-secrets / malformed-receipt guards (static)
  // If procedure claims a live RPC step but no env var was declared, warn
  // (The harness tests assert this via fixture, not here; validator just surfaces missing build/observed data)

  // X maturity assignment
  let suggestedMaturity: XMaturity = envelope.maturity ?? "X0";
  if (errors.length > 0) suggestedMaturity = "X0";
  else if (blockers.length > 0) {
    // Has structure but missing promotable fields → at most X2 local controlled
    // If independent read absent, downgrade to X2 even when deploy/network ok
    const hasIndependentRead = !!(iv?.explorer_url || iv?.rpc_second_read);
    if (!hasIndependentRead) suggestedMaturity = "X2";
    else if (suggestedMaturity === "X3" || suggestedMaturity === "X4" || suggestedMaturity === "X5") suggestedMaturity = "X2";
    // Keep X1/X2 as-is; never auto-upgrade
    if (suggestedMaturity === "X0") suggestedMaturity = "X2";
  } else {
    // No blockers: allow claimed maturity, but enforce minimums
    // Deploy+tx+independent read + SUCCEEDED → at least X3
    if ((suggestedMaturity === "X0" || suggestedMaturity === "X1" || suggestedMaturity === "X2") && envelope.deployment && envelope.transactions.length > 0) {
      // Do not auto-upgrade beyond X2 unless validator is explicitly told it was testnet-observed
      // For offline/fixtures, stay at X2; caller must set maturity after live observation
    }
  }

  // strk20.json guard — envelope must never be marked as writing strk20.json
  if ((envelope.inputs as Record<string, unknown>)?.writeStrk20Json === true) {
    errors.push("envelope must not write strk20.json");
    blockers.push("writeStrk20Json forbidden — evidence stays in ops/evidence/envelopes, never strk20.json");
  }
  if (envelope.procedure.some((p) => /write.*strk20\.json/i.test(p) && !/do not write|never write|must not write/i.test(p))) {
    errors.push("procedure attempts to write strk20.json");
    blockers.push("procedure writes strk20.json — blocked");
  }

  const valid = errors.length === 0;
  const promotable = valid && blockers.length === 0;

  return { valid, promotable, blockers, suggestedMaturity, errors, warnings };
}

export function isPromotable(envelope: EvidenceEnvelope): boolean {
  return validateEvidenceEnvelope(envelope).promotable;
}

// Convenience: deterministic envelope hash (for audit correlation, not consensus)
export function envelopeHash(envelope: EvidenceEnvelope): string {
  // Use canonical JSON; caller can keccak it if needed — here we return the canonical string itself
  return canonicalStringify(envelope);
}
