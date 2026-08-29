// Provider-injected STRK20 action adapter for Wallet API route.
// Authority: starknet.js 10.4.0 WalletAccountV6 strk20PrepareInvoke / strk20InvokeTransaction / strk20Balances / executeWithProof
// All I/O via injected provider; never touches viewing keys; fail-closed on unsupported/unknown.

import { Strk20Error, STRK20_ERROR_CODE } from "../domain/errors";
import { assertNoViewingKey } from "../domain/privacy-guard";
import { classifyStrk20Capability, classifyWalletEnvironment, getExpectedWalletEnvironment, type ExpectedWalletEnvironment } from "../domain/wallet-capability";
import { normalizeShadowAccountObservation, type ShadowAccountObservation } from "../domain/shadow-account";
import {
  normalizeReceipt,
  normalizeHex,
  validateActions,
  ensureCapabilityOrThrow,
  ensureNetworkOrThrow,
  classifyProviderError,
  type Strk20Action,
  type CapabilityResult,
  type Strk20CallAndProof,
  type NormalizedReceipt,
  STRK20_POOL_ADDRESS,
} from "../domain/strk20-action-port";
import { assertCallAndProofShape, assertNotEmptyProofForSubmission, assertProofPresent, isEmptyProof, type Strk20Call } from "../domain/strk20-proof";

export type Hex = `0x${string}`;

/**
 * Minimal provider surface that maps 1:1 to WalletAccountV6 + walletV6 helpers.
 * Mobile connector work stays behind this boundary – no starknetkit assumption.
 */
export interface WalletStrk20ActionProvider {
  supportedWalletApi(): Promise<string[]>;
  supportedSpecs(): Promise<string[]>;
  requestChainId(): Promise<string>;
  /** Optional metadata-only observation; no account/key/note material is accepted. */
  observeShadowAccountCapability?(): Promise<unknown>;
  // STRK20 methods — raw provider responses are validated before use.
  strk20PrepareInvoke?(actions: Strk20Action[], simulate?: boolean): Promise<unknown>;
  strk20InvokeTransaction?(actions: Strk20Action[]): Promise<{ transaction_hash: string } | { transactionHash: string }>;
  strk20Balances?(tokens: Hex[]): Promise<{ token: string; balance: string }[]>;
  // WalletAccountV6.executeWithProof(calls, proof) submits a prepared call.
  executeWithProof?(calls: readonly import("../domain/strk20-proof").Strk20Call[], proof: import("../domain/strk20-proof").Strk20Proof): Promise<{ transaction_hash: string }>;
  // Optional receipt observer (falls back to provider if absent).
  getReceipt?(txHash: Hex): Promise<Record<string, unknown> | null>;
}

export interface Strk20ActionPort {
  observeCapability(): Promise<CapabilityResult>;
  ensureReady(): Promise<{ chainId: string; apiVersions: string[]; specs: string[] }>;
  prepare(actions: Strk20Action[], opts: { simulate: boolean }): Promise<Strk20CallAndProof>;
  simulate(actions: Strk20Action[]): Promise<Strk20CallAndProof>; // convenience: simulate=true, empty proof
  execute(actions: Strk20Action[]): Promise<{ transactionHash: Hex }>;
  executeWithProof(call: Strk20Call, proof: import("../domain/strk20-proof").Strk20Proof): Promise<{ transactionHash: Hex }>;
  isSupported(): Promise<boolean>;
  observeReceipt(txHash: Hex): Promise<NormalizedReceipt | null>;
}

function requireMethod<K extends keyof WalletStrk20ActionProvider>(provider: WalletStrk20ActionProvider, method: K): NonNullable<WalletStrk20ActionProvider[K]> {
  const fn = provider[method];
  if (typeof fn !== "function") {
    throw new Strk20Error(STRK20_ERROR_CODE.UNSUPPORTED_WALLET_METHOD, `wallet_missing_method:${String(method)}_requires_supportedWalletApi>=0.10.3`);
  }
  return fn as NonNullable<WalletStrk20ActionProvider[K]>;
}

function toHex(hash: string | { transaction_hash: string } | { transactionHash: string }): Hex {
  const value = typeof hash === "string"
    ? hash
    : typeof (hash as { transaction_hash?: unknown }).transaction_hash === "string"
      ? (hash as { transaction_hash: string }).transaction_hash
      : (hash as { transactionHash?: string }).transactionHash;
  if (typeof value !== "string") {
    throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "missing_transaction_hash_in_provider_response");
  }
  try {
    return normalizeHex(value) as Hex;
  } catch {
    throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "malformed_transaction_hash_in_provider_response");
  }
}

export class WalletStrk20ActionAdapter implements Strk20ActionPort {
  private readonly expectedChainId: ExpectedWalletEnvironment;

  constructor(
    private readonly provider: WalletStrk20ActionProvider,
    opts: { expectedChainId?: string | null } = {},
  ) {
    assertNoViewingKey(provider, "WalletStrk20ActionAdapter.provider");
    assertNoViewingKey(opts, "WalletStrk20ActionAdapter.opts");
    // Default SN_SEPOLIA per M4 runtime requirement
    this.expectedChainId = getExpectedWalletEnvironment(opts.expectedChainId ?? "SN_SEPOLIA");
  }

  async observeCapability(): Promise<CapabilityResult> {
    let apiVersions: string[];
    let specs: string[];
    try {
      const [rawApiVersions, rawSpecs] = await Promise.all([this.provider.supportedWalletApi(), this.provider.supportedSpecs()]);
      if (!Array.isArray(rawApiVersions) || !Array.isArray(rawSpecs) || !rawApiVersions.every((v) => typeof v === "string") || !rawSpecs.every((v) => typeof v === "string")) {
        throw new Error("malformed_capability_response");
      }
      apiVersions = rawApiVersions;
      specs = rawSpecs;
    } catch {
      throw new Strk20Error(STRK20_ERROR_CODE.CAPABILITY_UNKNOWN, "capability_query_failed");
    }
    assertNoViewingKey({ apiVersions, specs }, "observeCapability.result");
    const capabilityStatus = classifyStrk20Capability(apiVersions, specs);
    let chainId: string;
    try {
      const rawChainId = await this.provider.requestChainId();
      if (typeof rawChainId !== "string" || rawChainId.trim().length === 0) throw new Error("malformed_chain_id");
      chainId = rawChainId;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).toLowerCase();
      if (msg.includes("refused") || msg.includes("rejected")) throw new Strk20Error(STRK20_ERROR_CODE.PROVIDER_REFUSED, "chain_id_provider_refused");
      throw new Strk20Error(STRK20_ERROR_CODE.CAPABILITY_UNKNOWN, "chain_id_query_failed");
    }
    const env = classifyWalletEnvironment(chainId, { mainnet: "SN_MAIN", sepolia: "SN_SEPOLIA" });
    const mismatch = env !== this.expectedChainId;
    let shadowAccount: ShadowAccountObservation | undefined;
    if (typeof this.provider.observeShadowAccountCapability === "function") {
      try {
        shadowAccount = normalizeShadowAccountObservation(await this.provider.observeShadowAccountCapability());
      } catch {
        // Shadow-account support is optional. A failed observation is recorded
        // as unknown and never blocks the ordinary Wallet API route.
        shadowAccount = normalizeShadowAccountObservation(null);
      }
    }
    return {
      capable: capabilityStatus === "supported",
      capabilityStatus,
      apiVersions,
      specs,
      chainId,
      environment: env,
      mismatch,
      expected: this.expectedChainId,
      ...(shadowAccount === undefined ? {} : { shadowAccount }),
    };
  }

  async isSupported(): Promise<boolean> {
    try {
      const c = await this.observeCapability();
      return c.capable && !c.mismatch && c.environment !== "UNKNOWN";
    } catch {
      return false;
    }
  }

  async ensureReady(): Promise<{ chainId: string; apiVersions: string[]; specs: string[] }> {
    const cap = await this.observeCapability();
    ensureCapabilityOrThrow(cap.apiVersions, cap.specs);
    if (cap.environment === "UNKNOWN") {
      throw new Strk20Error(STRK20_ERROR_CODE.NETWORK_MISMATCH, "unknown_network");
    }
    if (cap.mismatch) {
      throw new Strk20Error(STRK20_ERROR_CODE.NETWORK_MISMATCH, `expected_${cap.expected}_got_${cap.environment}`);
    }
    return { chainId: cap.chainId, apiVersions: cap.apiVersions, specs: cap.specs };
  }

  async prepare(actions: Strk20Action[], opts: { simulate: boolean }): Promise<Strk20CallAndProof> {
    assertNoViewingKey({ actions, opts }, "prepare.args");
    validateActions(actions);
    await this.ensureReady();
    const fn = requireMethod(this.provider, "strk20PrepareInvoke");
    try {
      const raw = await fn.call(this.provider, actions, opts.simulate);
      assertNoViewingKey(raw, "prepare.result");
      assertCallAndProofShape(raw, "prepare.result");
      // simulate=true must return an empty proof; a real prepare must return one.
      if (opts.simulate) {
        if (!isEmptyProof(raw.proof)) {
          throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "simulate_expected_empty_proof_but_got_non_empty");
        }
      } else {
        assertProofPresent(raw.proof, "prepare.non_simulate");
      }
      return raw;
    } catch (e) {
      if (e instanceof Strk20Error) throw e;
      return classifyProviderError(e);
    }
  }

  async simulate(actions: Strk20Action[]): Promise<Strk20CallAndProof> {
    return this.prepare(actions, { simulate: true });
  }

  async execute(actions: Strk20Action[]): Promise<{ transactionHash: Hex }> {
    assertNoViewingKey(actions, "execute.actions");
    validateActions(actions);
    await this.ensureReady();
    const fn = requireMethod(this.provider, "strk20InvokeTransaction");
    try {
      // Long-running proof state: this call may take significantly longer due to SNIP-36 proof generation; caller must tolerate.
      const res = await fn.call(this.provider, actions);
      const txHash = toHex(res as unknown as string | { transaction_hash: string } | { transactionHash: string });
      assertNoViewingKey({ txHash }, "execute.result");
      return { transactionHash: txHash };
    } catch (e) {
      if (e instanceof Strk20Error) throw e;
      return classifyProviderError(e);
    }
  }

  async executeWithProof(call: Strk20Call, proof: import("../domain/strk20-proof").Strk20Proof): Promise<{ transactionHash: Hex }> {
    assertNoViewingKey({ call, proof }, "executeWithProof.args");
    if (isEmptyProof(proof)) {
      throw new Strk20Error(STRK20_ERROR_CODE.PROOF_REQUIRED, "empty_proof_must_not_be_submitted_call_was_simulated");
    }
    assertNotEmptyProofForSubmission({ call, proof } as Strk20CallAndProof);
    await this.ensureReady();
    const fn = requireMethod(this.provider, "executeWithProof");
    try {
      const res = await fn.call(this.provider, [call], proof);
      const txHash = toHex(res as unknown as string | { transaction_hash: string } | { transactionHash: string });
      return { transactionHash: txHash };
    } catch (e) {
      if (e instanceof Strk20Error) throw e;
      return classifyProviderError(e);
    }
  }

  async observeReceipt(txHash: Hex): Promise<NormalizedReceipt | null> {
    assertNoViewingKey({ txHash }, "observeReceipt");
    if (!this.provider.getReceipt) return null;
    try {
      const raw = await this.provider.getReceipt(txHash);
      if (!raw) return null;
      assertNoViewingKey(raw, "observeReceipt.raw");
      return normalizeReceipt(raw, txHash);
    } catch (e) {
      if (e instanceof Strk20Error) throw e;
      throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "receipt_fetch_failed");
    }
  }
}
