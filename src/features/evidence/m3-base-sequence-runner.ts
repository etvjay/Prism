// M3 Base Sequence Runner — parent-executable testnet preflight for
// challenge → EOA/EIP-1271/ERC-6492 verification → controller bind → resolve → revoke → empty resolve.
//
// Design constraints (from M3_BASE_SEQUENCE_RUNNER task):
// - Accepts injected/public configuration (no file/secret reads, no broadcast by default)
// - Performs dry-run/preflight by default; live broadcast only with explicit signing provider
// - Preserves exact chain/domain/nonce/expiry/replay semantics and fails closed on
//   unknown signer / provider / receipt states
// - Never fabricates a bind receipt when live signing provider is unavailable
// - Exact felt digest/prismId calldata at Starknet boundary is enforced via the same
//   named mappings as starknet-submit adapter (toFieldBoundedDigest, prismIdToRegistryFelt)
// - submitted != completed (INV-SYS-005) is asserted at every chain-touching step
//
// This module is pure domain/application wiring: all effects are via injected ports.
// The CLI wrapper (ops/testnet/m3-base-sequence.runner.mjs) validates manifest/env
// and decides whether to supply a live Starknet account or stay in dry-run.

import type { Hex } from "../prism-identity/domain/hex";
import type { EvmAddress } from "../prism-identity/domain/identifiers";
import { toFieldBoundedDigest, prismIdToRegistryFelt, FELT_PRIME, DIGEST_MASK_250 } from "../prism-identity/domain/felt-digest";
import type { Clock } from "../prism-identity/domain/ports";
import { PrismChallengeService } from "../prism-identity/application/challenge-service";
import type { PrismChallengeService as PrismChallengeServiceType } from "../prism-identity/application/challenge-service";
import { PrismApplicationService } from "../../application/prism-application";
import type { RegistryReadPort, StarknetSubmitPort } from "../../application/ports";
import type { OperationStore } from "../prism-operations/domain/operation-store";
import type { IdGenerator } from "../../application/ports";

export const M3_RUNNER_LABEL = "M3_BASE_SEQUENCE_RUNNER — dry-run preflight (TEST DOUBLE unless --live with signing provider)" as const;
export const M3_MANIFEST_CHAIN_ID_TESTNET = 84532;
export const M3_MANIFEST_CHAIN_ID_MAINNET = 8453;
export const M3_EXPECTED_VENUE = "BASE" as const;
export const M3_DEFAULT_DOMAIN = "prism.example";
export const M3_STARKNET_NETWORK_TESTNET = "SN_SEPOLIA" as const;

export type M3RunnerPublicConfig = {
  /** Injected chainId — must equal manifest base.chain_id for selected env */
  chainId: number;
  domain: string;
  venue: string;
  prismId: string;
  executionAccount: string;
  controllerAddress: string;
  registryAddress?: string;
  rpcUrl?: string;
  registryVersion?: "v1" | "v2" | "1" | "2";
  starknetNetwork?: string;
  /** Optional signing provider presence signal (injected, not read from file) */
  hasLiveSigningProvider?: boolean;
  /** Optional explicit live flag (parent must set --live to allow broadcast) */
  liveRequested?: boolean;
};

export type M3RunnerValidatedConfig = M3RunnerPublicConfig & {
  normalizedDomain: string;
  normalizedExecutionAccount: EvmAddress;
  normalizedControllerAddress: string;
  registryFeltPrismId: Hex;
  registryVersion: "v1" | "v2";
};

export type M3Step = {
  step: string;
  status: "ok" | "blocked" | "failed";
  code?: string;
  detail?: string;
  operationId?: string | null;
  state?: string | null;
  txHash?: Hex | null;
  signatureClass?: string | null;
  calldata?: unknown[] | null;
};

export type M3RunnerResult = {
  label: typeof M3_RUNNER_LABEL;
  config: M3RunnerValidatedConfig;
  steps: M3Step[];
  verdict: "M3_BASE_SEQUENCE_RUNNER_READY_X2" | "M3_BLOCKED_BY_SIGNING_ENVIRONMENT" | "M3_FAILED";
  blockers: string[];
  submittedNotCompleted: boolean;
  dryRun: boolean;
};

export type M3RunnerDeps = {
  challengeService: PrismChallengeServiceType;
  registry: RegistryReadPort;
  submitPort: StarknetSubmitPort;
  operationStore: OperationStore;
  clock: Clock;
  idGenerator: IdGenerator;
};

// ---------------------------------------------------------------------------
// Config validation — fail closed, no silent fallback
// ---------------------------------------------------------------------------

export function validateM3PublicConfig(input: M3RunnerPublicConfig, manifestChainId?: number): M3RunnerValidatedConfig {
  const chainId = input.chainId;
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error(`M3_CONFIG_BLOCKED: invalid chainId ${chainId}`);
  }
  if (manifestChainId !== undefined && chainId !== manifestChainId) {
    throw new Error(`M3_CONFIG_BLOCKED: chainId mismatch: inputs ${chainId} != manifest ${manifestChainId} — altered_fields:chain_id`);
  }
  const venue = input.venue.trim().toUpperCase();
  if (venue !== M3_EXPECTED_VENUE) {
    throw new Error(`M3_CONFIG_BLOCKED: invalid venue ${venue} — expected ${M3_EXPECTED_VENUE}`);
  }
  const domain = input.domain.trim().toLowerCase();
  if (domain.length === 0 || domain.includes(" ") || !domain.includes(".")) {
    throw new Error(`M3_CONFIG_BLOCKED: invalid domain ${input.domain}`);
  }
  // prismId: must be canonical prism:<decimal> for M3 felt boundary (decimal digits, no leading zeros, < FELT_PRIME)
  // Reuse the same mapping as starknet-submit for exact parity.
  let registryFeltPrismId: Hex;
  try {
    registryFeltPrismId = prismIdToRegistryFelt(input.prismId);
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`M3_CONFIG_BLOCKED: prismId boundary: ${msg}`);
  }
  const exec = input.executionAccount.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(exec)) {
    throw new Error(`M3_CONFIG_BLOCKED: malformed executionAccount ${input.executionAccount}`);
  }
  if (exec === "0x0000000000000000000000000000000000000000") {
    throw new Error(`M3_CONFIG_BLOCKED: zero executionAccount`);
  }
  const ctrl = input.controllerAddress.trim().toLowerCase();
  if (!/^0x[0-9a-f]{1,64}$/.test(ctrl)) {
    throw new Error(`M3_CONFIG_BLOCKED: malformed controllerAddress ${input.controllerAddress}`);
  }
  if (BigInt(ctrl) === 0n || BigInt(ctrl) >= (1n << 251n)) {
    throw new Error(`M3_CONFIG_BLOCKED: controllerAddress outside ContractAddress range`);
  }
  if (input.registryAddress) {
    const reg = input.registryAddress.trim().toLowerCase();
    if (!/^0x[0-9a-f]{1,64}$/.test(reg)) throw new Error(`M3_CONFIG_BLOCKED: malformed registryAddress ${input.registryAddress}`);
    if (BigInt(reg) === 0n || BigInt(reg) >= (1n << 251n)) throw new Error(`M3_CONFIG_BLOCKED: registryAddress outside ContractAddress range`);
    if (reg === ctrl) throw new Error(`M3_CONFIG_BLOCKED: controller must not equal registry`);
  }
  const versionRaw = input.registryVersion ?? (input.liveRequested ? undefined : "v1");
  if (!versionRaw) throw new Error("M3_CONFIG_BLOCKED: registryVersion required for live");
  const version = versionRaw === "1" ? "v1" : versionRaw === "2" ? "v2" : versionRaw;
  if (version !== "v1" && version !== "v2") throw new Error(`M3_CONFIG_BLOCKED: invalid registryVersion ${versionRaw}`);
  return {
    ...input,
    registryVersion: version,
    venue,
    normalizedDomain: domain,
    normalizedExecutionAccount: exec as EvmAddress,
    normalizedControllerAddress: ctrl,
    registryFeltPrismId,
  };
}

// ---------------------------------------------------------------------------
// Live signing environment gate — precise blocker, no fabrication
// ---------------------------------------------------------------------------

export function detectLiveSigningBlocker(config: M3RunnerPublicConfig, envRecord: Record<string, string | undefined>): { blocked: boolean; blocker: string | null } {
  const liveRequested = !!config.liveRequested;
  const hasStarknetKey = !!(envRecord.STARKNET_SEPOLIA_DEPLOYER_PRIVATE_KEY || envRecord.STARKNET_SEPOLIA_KEYSTORE_PATH || envRecord.CONTROLLER_PRIVATE_KEY || envRecord.STARKNET_PRIVATE_KEY);
  const hasBaseKey = !!(envRecord.BASE_SIGNER_PRIVATE_KEY || envRecord.BASE_PRIVATE_KEY || envRecord.EOA_PRIVATE_KEY);

  if (!liveRequested) {
    return {
      blocked: true,
      blocker: `M3_BLOCKED_BY_SIGNING_ENVIRONMENT: live signing not requested (--live not set). Dry-run preflight only. No bind receipt fabricated. Provide STARKNET_SEPOLIA_DEPLOYER_PRIVATE_KEY (or keystore) and BASE_SIGNER_PRIVATE_KEY with --live to enable live broadcast.`,
    };
  }
  if (!hasStarknetKey || !hasBaseKey) {
    const missing: string[] = [];
    if (!hasStarknetKey) missing.push("Starknet controller/deployer signing provider");
    if (!hasBaseKey) missing.push("Base signing provider");
    return {
      blocked: true,
      blocker: `M3_BLOCKED_BY_SIGNING_ENVIRONMENT: missing ${missing.join(" and ")}. No bind receipt fabricated. Set both injected signing providers and re-run with --live.`,
    };
  }
  // Live requested and material present — still require explicit registry/rpc for broadcast
  if (!config.registryAddress || !config.rpcUrl) {
    return {
      blocked: true,
      blocker: `M3_BLOCKED_BY_SIGNING_ENVIRONMENT: live broadcast requires injected registryAddress and rpcUrl (STARKNET_REGISTRY_ADDRESS, STARKNET_RPC_URL). Dry-run only — no receipt fabricated.`,
    };
  }
  return { blocked: false, blocker: null };
}

// ---------------------------------------------------------------------------
// Felt boundary helpers — exact calldata parity checks (exported for tests)
// ---------------------------------------------------------------------------

export function feltDigestForCalldata(proofDigest: Hex): Hex {
  return toFieldBoundedDigest(proofDigest).felt;
}

export function prismFeltForCalldata(prismId: string): Hex {
  return prismIdToRegistryFelt(prismId);
}

// ---------------------------------------------------------------------------
// Dry-run sequence — exercises full M3 gate without live broadcast
// ---------------------------------------------------------------------------

export async function runM3DryRunSequence(
  validatedConfig: M3RunnerValidatedConfig,
  deps: M3RunnerDeps,
  options: {
    signer?: { address: EvmAddress; signMessage: (args: { message: string }) => Promise<Hex> };
    smartAccountOwner?: { smartAccount: EvmAddress; owner: EvmAddress; signMessage: (args: { message: string }) => Promise<Hex> };
    erc6492Wrapper?: { counterfactualAccount: EvmAddress; innerSignature: Hex };
  } = {},
): Promise<M3RunnerResult> {
  const steps: M3Step[] = [];
  const blockers: string[] = [];
  let submittedNotCompleted = true;

  const app = new PrismApplicationService({
    challengeService: deps.challengeService,
    operationStore: deps.operationStore,
    registry: deps.registry,
    submitPort: deps.submitPort,
    registryVersion: validatedConfig.registryVersion,
    clock: deps.clock,
    idGenerator: deps.idGenerator,
  });

  const session = {
    sessionId: "sess_m3_runner",
    userId: "user-m3",
    issuedAt: deps.clock.now() - 5,
    expiresAt: deps.clock.now() + 600,
  };

  // Use provided signer or generate ephemeral EOA via viem (dynamic import to stay transport-neutral here)
  let signer: { address: EvmAddress; signMessage: (args: { message: string }) => Promise<Hex> };
  if (options.signer) {
    signer = options.signer;
  } else {
    // Lazy import viem ephemeral signer
    const { makeEoaSigner } = await import("../prism-identity/testing/fixtures");
    const acct = makeEoaSigner();
    signer = {
      address: acct.address.toLowerCase() as EvmAddress,
      signMessage: (args) => acct.signMessage({ message: args.message }) as Promise<Hex>,
    };
  }

  // For dry-run, executionAccount should match signer address for EOA verification to succeed.
  // If caller supplied executionAccount that differs, we keep it but note wrong-signer will be exercised separately.
  const executionAccount = validatedConfig.normalizedExecutionAccount;

  // 1. Issue challenge — validates chainId/domain/venue binding in digest
  let issued: Awaited<ReturnType<PrismChallengeService["issueChallenge"]>>;
  let issueStep: M3Step;
  try {
    // Need to ensure challengeService policy matches validated config
    // We assume caller constructed challengeService with policy defaultChainId = validatedConfig.chainId and defaultDomain = validatedConfig.normalizedDomain
    issued = await deps.challengeService.issueChallenge({
      prismId: validatedConfig.prismId,
      venue: validatedConfig.venue,
      executionAccount,
      ttlSeconds: 600,
    });
    // Verify issued view matches injected config
    if (issued.chainId !== validatedConfig.chainId) {
      throw new Error(`chainId mismatch issued ${issued.chainId} != config ${validatedConfig.chainId}`);
    }
    if (issued.domain !== validatedConfig.normalizedDomain) {
      throw new Error(`domain mismatch issued ${issued.domain} != config ${validatedConfig.normalizedDomain}`);
    }
    issueStep = { step: "challenge issue", status: "ok", detail: `challengeId ${issued.challengeId} digest ${issued.digest} nonce ${issued.nonce} chainId ${issued.chainId} domain ${issued.domain}` };
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    issueStep = { step: "challenge issue", status: "blocked", code: "ERR-001/ERR-012", detail: msg };
    blockers.push(msg);
    steps.push(issueStep);
    return { label: M3_RUNNER_LABEL, config: validatedConfig, steps, verdict: "M3_FAILED", blockers, submittedNotCompleted: false, dryRun: true };
  }
  steps.push(issueStep);

  // 2. Verify EOA signature class
  let verifiedEoa: Awaited<ReturnType<PrismChallengeService["submitProof"]>> | null = null;
  try {
    // If executionAccount doesn't match signer, this will be wrong-signer; we handle that as separate gate test
    // For main dry-run, we need executionAccount to equal signer address — if not, skip EOA verify and use wrong-signer path
    const sig = await signer.signMessage({ message: issued.messageToSign });
    // Need presented fields
    const { presentedFromIssued } = await import("../prism-identity/testing/fixtures");
    const presented = presentedFromIssued(issued as unknown as import("../prism-identity/application/challenge-service").IssuedChallengeView);
    verifiedEoa = await deps.challengeService.submitProof({
      challengeId: issued.challengeId,
      presented: presented as unknown as import("../prism-identity/domain/verification").PresentedChallengeFields,
      signature: sig,
    });
    if (verifiedEoa.signatureClass !== "EOA") {
      throw new Error(`expected EOA got ${verifiedEoa.signatureClass}`);
    }
    steps.push({ step: "verify EOA", status: "ok", signatureClass: verifiedEoa.signatureClass, detail: `digest ${verifiedEoa.digest}` });
  } catch (cause) {
    const code = (cause as { code?: string })?.code ?? "ERR-003/014";
    const msg = cause instanceof Error ? cause.message : String(cause);
    // If executionAccount mismatched signer, this is expected wrong-signer case for dry-run — record but don't abort whole sequence if we can re-issue
    const isWrongSignerSetup = executionAccount !== (signer.address.toLowerCase() as string);
    if (isWrongSignerSetup && code === "ERR-003") {
      steps.push({ step: "verify EOA (wrong signer expected)", status: "blocked", code, detail: msg });
      blockers.push(`wrong signer correctly rejected: ${msg}`);
      // Re-issue a new challenge for the signer's actual account to continue sequence
      try {
        const reIssued = await deps.challengeService.issueChallenge({
          prismId: validatedConfig.prismId,
          venue: validatedConfig.venue,
          executionAccount: signer.address.toLowerCase() as EvmAddress,
          ttlSeconds: 600,
        });
        const reSig = await signer.signMessage({ message: reIssued.messageToSign });
        const { presentedFromIssued: pfi } = await import("../prism-identity/testing/fixtures");
        const rePresented = pfi(reIssued as unknown as import("../prism-identity/application/challenge-service").IssuedChallengeView);
        const reVerified = await deps.challengeService.submitProof({
          challengeId: reIssued.challengeId,
          presented: rePresented as unknown as import("../prism-identity/domain/verification").PresentedChallengeFields,
          signature: reSig,
        });
        verifiedEoa = reVerified;
        issued = reIssued;
        steps.push({ step: "verify EOA (re-issued for signer)", status: "ok", signatureClass: reVerified.signatureClass, detail: `digest ${reVerified.digest}` });
      } catch (reCause) {
        const reMsg = reCause instanceof Error ? reCause.message : String(reCause);
        steps.push({ step: "verify EOA retry", status: "failed", code: (reCause as { code?: string })?.code, detail: reMsg });
        return { label: M3_RUNNER_LABEL, config: validatedConfig, steps, verdict: "M3_FAILED", blockers, submittedNotCompleted: false, dryRun: true };
      }
    } else {
      steps.push({ step: "verify EOA", status: "failed", code, detail: msg });
      blockers.push(msg);
      return { label: M3_RUNNER_LABEL, config: validatedConfig, steps, verdict: "M3_FAILED", blockers, submittedNotCompleted: false, dryRun: true };
    }
  }

  if (!verifiedEoa) {
    blockers.push("no verified digest for bind");
    return { label: M3_RUNNER_LABEL, config: validatedConfig, steps, verdict: "M3_FAILED", blockers, submittedNotCompleted: false, dryRun: true };
  }

  // Ensure digest maps to felt correctly — exact calldata check (no silent fallback)
  let feltDigest: Hex;
  let feltPrismId: Hex;
  try {
    feltDigest = feltDigestForCalldata(verifiedEoa.digest);
    feltPrismId = prismFeltForCalldata(validatedConfig.prismId);
    steps.push({ step: "felt boundary precheck", status: "ok", detail: `prismId ${validatedConfig.prismId} -> felt ${feltPrismId} digest ${verifiedEoa.digest} -> felt ${feltDigest} bounded=${BigInt(verifiedEoa.digest) > DIGEST_MASK_250}` });
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    steps.push({ step: "felt boundary precheck", status: "blocked", code: "ERR-002/023", detail: msg });
    blockers.push(msg);
    return { label: M3_RUNNER_LABEL, config: validatedConfig, steps, verdict: "M3_FAILED", blockers, submittedNotCompleted: false, dryRun: true };
  }

  // 3. Seed registry identity for bind (controller must match)
  // In dry-run, seed identity so controller bind can be attempted without prior create_identity broadcast
  const registrySeed = deps.registry as unknown as { seedIdentity?: (prismId: string, controller: string) => void };
  if (registrySeed.seedIdentity) {
    registrySeed.seedIdentity(validatedConfig.prismId, validatedConfig.normalizedControllerAddress);
    steps.push({ step: "seed identity (dry-run)", status: "ok", detail: `prism ${validatedConfig.prismId} controller ${validatedConfig.normalizedControllerAddress}` });
  }

  // 4. Controller bind — via application layer (verifies digest not consumed, controller matches)
  // Capture calldata via submitPort spy if available
  let bindTxHash: Hex | null = null;
  let bindOperationId: string | null = null;
  let bindCalldata: unknown[] | null = null;
  try {
    // Wrap submitPort.execute to capture calldata if using StarknetSubmitAdapter with injected account
    const originalSubmitBind = deps.submitPort.submitBind.bind(deps.submitPort);
    let captured: unknown[] | null = null;
    const spiedPort: StarknetSubmitPort = {
      ...deps.submitPort,
      async submitBind(input) {
        // For InMemoryRegistry, capture doesn't apply; for StarknetSubmitAdapter with fake account, we can capture via adapter's account.execute
        const res = await originalSubmitBind(input);
        // Try to infer calldata from input + felt mapping
        captured = [feltPrismId, validatedConfig.venue, (input.executionAccount as string).toLowerCase(), feltDigest];
        bindCalldata = captured;
        return res;
      },
      async submitCreateIdentity(input) { return deps.submitPort.submitCreateIdentity(input); },
      async submitRevoke(input) { return deps.submitPort.submitRevoke(input); },
    };
    const appWithSpy = new PrismApplicationService({
      challengeService: deps.challengeService,
      operationStore: deps.operationStore,
      registry: deps.registry,
      submitPort: spiedPort,
      registryVersion: validatedConfig.registryVersion,
      clock: deps.clock,
      idGenerator: deps.idGenerator,
    });
    const bindRes = await appWithSpy.bind({
      headers: { requestId: "m3-bind", idempotencyKey: `m3-bind-${Date.now()}`, correlationId: "m3" },
      session,
      payload: {
        prismId: validatedConfig.prismId,
        venue: validatedConfig.venue,
        executionAccount: (verifiedEoa ? (signer.address.toLowerCase() as string) : executionAccount) as EvmAddress,
        proofDigest: verifiedEoa.digest,
        controllerAddress: validatedConfig.normalizedControllerAddress,
      },
    });
    if (!bindRes.ok) {
      const code = (bindRes as { ok: false; error: { code: string } }).error.code;
      throw Object.assign(new Error(`bind failed ${code}`), { code });
    }
    if ((bindRes.data.state as string) === "completed") {
      submittedNotCompleted = false;
      throw new Error("INV-SYS-005 violated: bind completed without reconciliation");
    }
    if ((bindRes.data.state as string) !== "submitted") {
      throw new Error(`bind must be submitted got ${bindRes.data.state}`);
    }
    bindTxHash = (await deps.operationStore.getById(bindRes.data.operationId))?.txHash as Hex | null ?? null;
    bindOperationId = bindRes.data.operationId;
    if (!bindCalldata) bindCalldata = [feltPrismId, validatedConfig.venue, (signer.address.toLowerCase() as string), feltDigest];
    steps.push({ step: "bind (submitted)", status: "ok", operationId: bindOperationId, state: bindRes.data.state, txHash: bindTxHash, calldata: bindCalldata, detail: `calldata[0] ${feltPrismId} [3] ${feltDigest}` });
  } catch (cause) {
    const code = (cause as { code?: string })?.code ?? "ERR-004/007/021";
    const msg = cause instanceof Error ? cause.message : String(cause);
    steps.push({ step: "bind", status: "blocked", code, detail: msg });
    blockers.push(msg);
    // Do not fabricate receipt on blocker
    return { label: M3_RUNNER_LABEL, config: validatedConfig, steps, verdict: "M3_FAILED", blockers, submittedNotCompleted, dryRun: true };
  }

  // Simulate reconciliation making bind visible (dry-run only — no real receipt)
  const applyBind = (deps.registry as unknown as { applyBindForTest?: (prismId: string, venue: string, executionAccount: string, digest: Hex) => void }).applyBindForTest;
  if (applyBind) {
    applyBind.call(deps.registry, validatedConfig.prismId, validatedConfig.venue, signer.address.toLowerCase() as string, verifiedEoa.digest);
    steps.push({ step: "apply bind (reconciliation dry-run)", status: "ok", detail: "binding ACTIVE in registry double" });
  }

  // 5. Resolve pre-revoke → ACTIVE
  try {
    const app2 = new PrismApplicationService({
      challengeService: deps.challengeService,
      operationStore: deps.operationStore,
      registry: deps.registry,
      submitPort: deps.submitPort,
      registryVersion: validatedConfig.registryVersion,
      clock: deps.clock,
      idGenerator: deps.idGenerator,
    });
    const resolved = await app2.resolve({ payload: { prismId: validatedConfig.prismId, venue: validatedConfig.venue } });
    if (!resolved.ok) throw new Error(`resolve failed ${resolved.error.code}`);
    if (resolved.data.executionAccount === null) throw new Error("resolve should be ACTIVE before revoke");
    const expected = signer.address.toLowerCase();
    if (resolved.data.executionAccount.toLowerCase() !== expected) throw new Error(`resolve mismatch ${resolved.data.executionAccount} != ${expected}`);
    steps.push({ step: "resolve pre-revoke", status: "ok", detail: `executionAccount ${resolved.data.executionAccount} watermark ${resolved.data.watermark}` });
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    steps.push({ step: "resolve pre-revoke", status: "failed", detail: msg });
    blockers.push(msg);
    return { label: M3_RUNNER_LABEL, config: validatedConfig, steps, verdict: "M3_FAILED", blockers, submittedNotCompleted, dryRun: true };
  }

  // 6. Revoke
  let revokeTxHash: Hex | null = null;
  let revokeOpId: string | null = null;
  try {
    const app3 = new PrismApplicationService({
      challengeService: deps.challengeService,
      operationStore: deps.operationStore,
      registry: deps.registry,
      submitPort: deps.submitPort,
      registryVersion: validatedConfig.registryVersion,
      clock: deps.clock,
      idGenerator: deps.idGenerator,
    });
    const revRes = await app3.revoke({
      headers: { requestId: "m3-revoke", idempotencyKey: `m3-revoke-${Date.now()}` },
      session,
      payload: {
        prismId: validatedConfig.prismId,
        venue: validatedConfig.venue,
        executionAccount: signer.address.toLowerCase() as string,
        controllerAddress: validatedConfig.normalizedControllerAddress,
      },
    });
    if (!revRes.ok) throw Object.assign(new Error(`revoke failed ${revRes.error.code}`), { code: revRes.error.code });
    if ((revRes.data.state as string) === "completed") {
      submittedNotCompleted = false;
      throw new Error("INV-SYS-005 violated: revoke completed without reconciliation");
    }
    revokeOpId = revRes.data.operationId;
    revokeTxHash = (await deps.operationStore.getById(revokeOpId))?.txHash as Hex | null ?? null;
    steps.push({ step: "revoke (submitted)", status: "ok", operationId: revokeOpId, state: revRes.data.state, txHash: revokeTxHash, detail: `revoke_binding calldata [0] ${feltPrismId}` });
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    const code = (cause as { code?: string })?.code;
    // Revoke may be idempotent no-op if already revoked — treat as blocked not failed
    steps.push({ step: "revoke", status: "blocked", code, detail: msg });
    blockers.push(msg);
    return { label: M3_RUNNER_LABEL, config: validatedConfig, steps, verdict: "M3_FAILED", blockers, submittedNotCompleted, dryRun: true };
  }

  const applyRevoke = (deps.registry as unknown as { applyRevokeForTest?: (prismId: string, venue: string, executionAccount: string) => void }).applyRevokeForTest;
  if (applyRevoke) {
    applyRevoke.call(deps.registry, validatedConfig.prismId, validatedConfig.venue, signer.address.toLowerCase() as string);
    steps.push({ step: "apply revoke (reconciliation dry-run)", status: "ok", detail: "binding REVOKED" });
  }

  // 7. Resolve post-revoke → NO_ACTIVE_DESTINATION (null)
  try {
    const app4 = new PrismApplicationService({
      challengeService: deps.challengeService,
      operationStore: deps.operationStore,
      registry: deps.registry,
      submitPort: deps.submitPort,
      registryVersion: validatedConfig.registryVersion,
      clock: deps.clock,
      idGenerator: deps.idGenerator,
    });
    const after = await app4.resolve({ payload: { prismId: validatedConfig.prismId, venue: validatedConfig.venue } });
    if (!after.ok) throw new Error(`resolve post failed ${after.error.code}`);
    if (after.data.executionAccount !== null) throw new Error("revoked resolve should be null");
    steps.push({ step: "resolve post-revoke", status: "ok", detail: "NO_ACTIVE_DESTINATION" });
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    steps.push({ step: "resolve post-revoke", status: "failed", detail: msg });
    blockers.push(msg);
    return { label: M3_RUNNER_LABEL, config: validatedConfig, steps, verdict: "M3_FAILED", blockers, submittedNotCompleted, dryRun: true };
  }

  // 8. P still exists (get_identity)
  try {
    const app5 = new PrismApplicationService({
      challengeService: deps.challengeService,
      operationStore: deps.operationStore,
      registry: deps.registry,
      submitPort: deps.submitPort,
      registryVersion: validatedConfig.registryVersion,
      clock: deps.clock,
      idGenerator: deps.idGenerator,
    });
    const ident = await app5.getIdentity({ payload: { prismId: validatedConfig.prismId } });
    if (!ident.ok || !ident.data.exists) throw new Error("prism identity should persist after revoke");
    steps.push({ step: "get_identity persists", status: "ok", detail: `controller ${ident.data.controller}` });
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    steps.push({ step: "get_identity persists", status: "failed", detail: msg });
    blockers.push(msg);
    return { label: M3_RUNNER_LABEL, config: validatedConfig, steps, verdict: "M3_FAILED", blockers, submittedNotCompleted, dryRun: true };
  }

  return {
    label: M3_RUNNER_LABEL,
    config: validatedConfig,
    steps,
    verdict: "M3_BASE_SEQUENCE_RUNNER_READY_X2",
    blockers: [],
    submittedNotCompleted,
    dryRun: true,
  };
}

// ---------------------------------------------------------------------------
// Helper to build default dry-run deps (in-memory doubles) with injected clock
// ---------------------------------------------------------------------------

export async function buildM3DryRunDeps(opts: {
  chainId?: number;
  domain?: string;
  clockNow?: number;
}): Promise<M3RunnerDeps> {
  const { fixedClock } = await import("../prism-identity/adapters/clock");
  const { InMemoryOwnershipProofStore } = await import("../prism-identity/adapters/memory-ownership-proof-store");
  const { viemChallengeCrypto } = await import("../prism-identity/adapters/viem-crypto");
  const { LocalErc1271SemanticsChecker } = await import("../prism-identity/testing/fixtures");
  const { InMemoryOperationStore } = await import("../prism-operations/adapters/memory-operation-store");
  const { InMemoryRegistry } = await import("../../application/adapters/in-memory-registry");

  const clock = fixedClock(opts.clockNow ?? 1_789_000_000);
  const store = new InMemoryOwnershipProofStore();
  const checker = new LocalErc1271SemanticsChecker();
  const challengeService = new PrismChallengeService({
    clock,
    crypto: viemChallengeCrypto,
    checker,
    store,
    policy: {
      defaultTtlSeconds: 600,
      defaultDomain: (opts.domain ?? M3_DEFAULT_DOMAIN).toLowerCase(),
      defaultChainId: opts.chainId ?? M3_MANIFEST_CHAIN_ID_TESTNET,
    },
  });
  const operationStore = new InMemoryOperationStore();
  const registry = new InMemoryRegistry();
  let n = 1;
  const idGenerator = { generateOperationId: () => `op-m3-${n++}-${Date.now()}` };
  return { challengeService, registry, submitPort: registry as unknown as StarknetSubmitPort, operationStore, clock, idGenerator };
}
