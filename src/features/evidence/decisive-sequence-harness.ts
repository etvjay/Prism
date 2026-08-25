// Decisive-sequence harness — offline, deterministic, TEST DOUBLE labeled.
// Exercises: create → read → Base proof → controller bind → resolve → revoke →
// NO_ACTIVE_DESTINATION → Prism ID persists (CANONICAL_STATE §10, FT-001/FT-004).
// All effects are via injected ports; in this bundle the ports are InMemory doubles.
// No live RPC, no secrets, no strk20.json writes. Every chain-touching step
// produces an Operation in state `submitted` (never `completed` without
// reconciliation — INV-SYS-005).

import { buildEvidenceEnvelope, type EvidenceEnvelope, type Hex } from "./evidence-envelope";

export const HARNESS_LABEL = "TEST DOUBLE — offline decisive sequence (no live RPC)" as const;
export const DEFAULT_TESTNET = { network: "SN_SEPOLIA" as const, chainId: 84532 };

export interface HarnessStepResult {
  step: string;
  operationId: string | null;
  state: string | null;
  txHash: Hex | null;
  errorCode: string | null;
  envelope: EvidenceEnvelope | null;
}

export interface HarnessRunResult {
  label: string;
  environment: "SN_SEPOLIA";
  chainId: number;
  steps: HarnessStepResult[];
  finalResolve: string | null;
  prismIdPersists: boolean;
  maturity: string;
  promotable: boolean;
  blockers: string[];
}

// Pure helper: builds a minimal evidence envelope for one harness step (fixture).
// Caller should replace with live envelope after a real SN_SEPOLIA run.
function stepEnvelope(
  evidenceId: string,
  claim: string,
  step: string,
  txHash: Hex | null,
  status: "SUCCEEDED" | "UNKNOWN",
  chainId: number,
): EvidenceEnvelope {
  const addr: Hex = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const classHash: Hex = "0x0abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
  const tx: Hex = txHash ?? "0x0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0deadbeef0dead";
  return buildEvidenceEnvelope({
    evidence_id: evidenceId,
    claim: `${claim} — ${step} (harness ${HARNESS_LABEL})`,
    environment: "SN_SEPOLIA",
    build: { commit_sha: "5684163", spec_versions: { scarb: "2.20.0", snforge: "0.63.0", starknet: "10.4.0" } },
    procedure: ["harness: create → read → Base proof → bind → resolve → revoke → NO_ACTIVE → P persists"],
    inputs: { chainId, step, harnessLabel: HARNESS_LABEL },
    deployment: {
      network: "SN_SEPOLIA",
      address: addr,
      class_hash: classHash,
      deploy_tx: tx,
      block_number: 12345,
      status: status === "SUCCEEDED" ? "SUCCEEDED" : "UNKNOWN",
    },
    transactions: [{ network: "SN_SEPOLIA", hash: tx, block: status === "SUCCEEDED" ? 12345 : null, status }],
    contracts: [{ address: addr, class_hash: classHash, name: "PrismIdentityRegistry" }],
    claim_scope: "harness fixture only — no live network contact",
    limitations: ["TEST DOUBLE — all chain observations are in-memory fakes", "no independent verification — X2 ceiling", "no strk20.json writes"],
    independent_verification: { explorer_url: null, rpc_second_read: null, verified_at: null },
    maturity: "X2",
    target_manifest: { environment: "testnet", network: "SN_SEPOLIA", chain_id: chainId },
  });
}

export interface DecisiveHarnessDeps {
  env?: "SN_SEPOLIA";
  chainId?: number;
  controllerAddress: string;
  baseExecutionAccount: Hex;
}

// The harness re-uses the existing InMemory application stack for offline steps.
// It does NOT duplicate domain logic — it delegates to PrismApplicationService
// via the same path the live testnet run will use (only the submitPort changes).
export async function runDecisiveFixture(
  deps: DecisiveHarnessDeps,
): Promise<HarnessRunResult> {
  const chainId = deps.chainId ?? DEFAULT_TESTNET.chainId;
  const env = (deps.env ?? DEFAULT_TESTNET.network) as "SN_SEPOLIA";

  // Build the harness stack (offline doubles)
  const { fixedClock } = await import("../prism-identity/adapters/clock");
  const { InMemoryOwnershipProofStore } = await import("../prism-identity/adapters/memory-ownership-proof-store");
  const { viemChallengeCrypto } = await import("../prism-identity/adapters/viem-crypto");
  const { LocalErc1271SemanticsChecker, makeEoaSigner, presentedFromIssued } = await import("../prism-identity/testing/fixtures");
  const { InMemoryOperationStore } = await import("../prism-operations/adapters/memory-operation-store");
  const { PrismApplicationService } = await import("../../application/prism-application");
  const { InMemoryRegistry } = await import("../../application/adapters/in-memory-registry");
  const DOMAIN = "prism.example";
  const PRISM_ID = "prism:P7F21";
  const VENUE = "BASE";

  const clock = fixedClock(1_789_000_000);
  const ownershipStore = new InMemoryOwnershipProofStore();
  const checker = new LocalErc1271SemanticsChecker();
  const { PrismChallengeService } = await import("../prism-identity/application/challenge-service");
  const challengeService = new PrismChallengeService({
    clock,
    crypto: viemChallengeCrypto,
    checker,
    store: ownershipStore,
    policy: { defaultTtlSeconds: 600, defaultDomain: DOMAIN, defaultChainId: chainId },
  });
  const operationStore = new InMemoryOperationStore();
  const registry = new InMemoryRegistry();
  // Seed identity for harness (create_identity is tested separately; here we focus on bind→resolve→revoke)
  registry.seedIdentity(PRISM_ID, deps.controllerAddress);

  let n = 1;
  const idGenerator = { generateOperationId: () => `op-${n++}-${Date.now()}` };
  const app = new PrismApplicationService({ challengeService, operationStore, registry, submitPort: registry as unknown as import("../../application/ports").StarknetSubmitPort, registryVersion: "v1", clock, idGenerator });

  const session = { sessionId: "sess_12345678", userId: "user-1", issuedAt: clock.now() - 10, expiresAt: clock.now() + 600 };

  // Resolve the owner signer for the requested Base account — if it equals the caller's requested
  // executionAccount, sign with an ephemeral EOA that owns it. The harness generates one and
  // issues a challenge for that exact account so ecrecover succeeds (EOA class).
  const owner = makeEoaSigner();
  // Override executionAccount to the ephemeral owner's address so verification passes
  const executionAccount = owner.address.toLowerCase() as Hex;

  const steps: HarnessStepResult[] = [];

  // 1. create → read (seeded + read check)
  steps.push({ step: "create P", operationId: null, state: null, txHash: null, errorCode: null, envelope: null });
  const read = await app.getIdentity({ payload: { prismId: PRISM_ID } });
  if (!read.ok || !read.data.exists) throw new Error("harness: read after seed failed");
  steps.push({ step: "read P", operationId: null, state: "exists", txHash: null, errorCode: null, envelope: null });

  // 2. Base proof — issue + verify
  const issued = await app.issueChallenge({ headers: { requestId: "h-issue" }, session, payload: { prismId: PRISM_ID, venue: VENUE, executionAccount } });
  if (!issued.ok) throw new Error(`issue failed: ${issued.error.code}`);
  const sig = await owner.signMessage({ message: issued.data.messageToSign });
  const verified = await app.submitProof({
    headers: { requestId: "h-verify" },
    session,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload: { challengeId: issued.data.challengeId, presented: presentedFromIssued(issued.data as any), signature: sig as Hex },
  });
  if (!verified.ok) throw new Error(`verify failed: ${verified.error.code}`);
  steps.push({ step: "Base proof (EOA)", operationId: null, state: "VERIFIED", txHash: null, errorCode: null, envelope: null });

  // 3. controller bind — operation submitted, not completed
  const bindRes = await app.bind({
    headers: { requestId: "h-bind", idempotencyKey: "idem-harness-bind", correlationId: "corr-harness" },
    session,
    payload: {
      prismId: PRISM_ID,
      venue: VENUE,
      executionAccount,
      proofDigest: verified.data.digest,
      challengeId: issued.data.challengeId,
      chainId: issued.data.chainId,
      expiresAt: issued.data.expiresAt,
      controllerAddress: deps.controllerAddress,
    },
  });
  if (!bindRes.ok) throw new Error(`bind failed: ${bindRes.error.code}`);
  if ((bindRes.data.state as string) !== "submitted") throw new Error(`bind must be submitted (got ${bindRes.data.state})`);
  // INV-SYS-005 guard: must not be completed
  if ((bindRes.data.state as string) === "completed") throw new Error("INV-SYS-005 violated: bind completed without reconciliation");
  registry.applyBindForTest(PRISM_ID, VENUE, executionAccount, verified.data.digest);
  {
    const op = await operationStore.getById(bindRes.data.operationId);
    const txHash = (op?.txHash as Hex | null) ?? null;
    steps.push({ step: "bind B to P", operationId: bindRes.data.operationId, state: bindRes.data.state, txHash, errorCode: null, envelope: stepEnvelope("EVD-PRISM-005", "Base proof prevents unauthorized binding", "bind", txHash, "SUCCEEDED", chainId) });
  }

  // 4. resolve pre-revoke
  const resolveActive = await app.resolve({ payload: { prismId: PRISM_ID, venue: VENUE } });
  if (!resolveActive.ok) throw new Error("resolve pre failed");
  if (resolveActive.data.executionAccount?.toLowerCase() !== executionAccount) throw new Error("resolve should return B");
  steps.push({ step: "resolve(P,BASE)=B", operationId: null, state: "ACTIVE", txHash: null, errorCode: null, envelope: null });

  // 5. revoke
  const revokeRes = await app.revoke({
    headers: { requestId: "h-revoke", idempotencyKey: "idem-harness-revoke" },
    session,
    payload: { prismId: PRISM_ID, venue: VENUE, executionAccount, controllerAddress: deps.controllerAddress },
  });
  if (!revokeRes.ok) throw new Error(`revoke failed: ${revokeRes.error.code}`);
  registry.applyRevokeForTest(PRISM_ID, VENUE, executionAccount);
  {
    const op = await operationStore.getById(revokeRes.data.operationId);
    const txHash = (op?.txHash as Hex | null) ?? null;
    steps.push({ step: "revoke B", operationId: revokeRes.data.operationId, state: revokeRes.data.state, txHash, errorCode: null, envelope: stepEnvelope("EVD-PRISM-007", "Revoked binding no longer resolves", "revoke", txHash, "SUCCEEDED", chainId) });
  }

  // 6. resolve post-revoke → NO_ACTIVE_DESTINATION
  const resolveAfter = await app.resolve({ payload: { prismId: PRISM_ID, venue: VENUE } });
  if (!resolveAfter.ok) throw new Error("resolve post failed");
  if (resolveAfter.data.executionAccount !== null) throw new Error("revoked resolve should be NO_ACTIVE_DESTINATION");
  steps.push({ step: "resolve(P,BASE)=NO_ACTIVE_DESTINATION", operationId: null, state: "NO_ACTIVE", txHash: null, errorCode: null, envelope: null });

  // 7. P still exists
  const still = await app.getIdentity({ payload: { prismId: PRISM_ID } });
  const persists = !!(still.ok && still.data.exists);
  if (!persists) throw new Error("Prism ID should persist after revoke");
  steps.push({ step: "P still exists", operationId: null, state: persists ? "exists" : "missing", txHash: null, errorCode: null, envelope: null });

  // Build a summary envelope for the whole run (fixture, X2)
  const summaryEnvelope = stepEnvelope("EVD-PRISM-006", "Active Base binding resolves from Prism ID", "decisive-summary", null, "UNKNOWN", chainId);
  // The summary's validator will downgrade to X2 and block promotion (missing independent read) — correct for this bundle

  return {
    label: HARNESS_LABEL,
    environment: env,
    chainId,
    steps,
    finalResolve: resolveAfter.ok ? (resolveAfter.data.executionAccount ?? null) : null,
    prismIdPersists: persists,
    maturity: summaryEnvelope.maturity,
    promotable: false, // harness is TEST DOUBLE → never promotable without live independent read
    blockers: ["TEST DOUBLE — no live RPC", "independent_verification missing"],
  };
}
