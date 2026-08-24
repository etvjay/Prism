// Provider-injected STRK20 action adapter for Wallet API route.
// Authority: starknet.js 10.4.0 WalletAccountV6 strk20PrepareInvoke / strk20InvokeTransaction / strk20Balances / executeWithProof
// All I/O via injected provider; never touches viewing keys; fail-closed on unsupported/unknown.

import { Strk20Error, STRK20_ERROR_CODE } from "../domain/errors";
import { assertNoViewingKey } from "../domain/privacy-guard";
import { supportsStrk20, classifyWalletEnvironment, getExpectedWalletEnvironment } from "../domain/wallet-capability";
import {
  normalizeReceipt,
  validateActions,
  ensureCapabilityOrThrow,
  ensureNetworkOrThrow,
  classifyProviderError,
  type Strk20Action,
  type Strk20CallAndProof,
  type NormalizedReceipt,
  STRK20_POOL_ADDRESS,
} from "../domain/strk20-action-port";
import { assertNotEmptyProofForSubmission, isEmptyProof, type Strk20Call } from "../domain/strk20-proof";

export type Hex = `0x${string}`;

/**
 * Minimal provider surface that maps 1:1 to WalletAccountV6 + walletV6 helpers.
 * Mobile connector work stays behind this boundary – no starknetkit assumption.
 */
export interface WalletStrk20ActionProvider {
  supportedWalletApi(): Promise<string[]>;
  supportedSpecs(): Promise<string[]>;
  requestChainId(): Promise<string>;
  // STRK20 methods – may be absent on unsupported wallets (fail-closed)
  strk20PrepareInvoke?(actions: Strk20Action[], simulate?: boolean): Promise<Strk20CallAndProof>;
  strk20InvokeTransaction?(actions: Strk20Action[]): Promise<{ transaction_hash: string } | { transactionHash: string }>;
  strk20Balances?(tokens: Hex[]): Promise<{ token: string; balance: string }[]>;
  executeWithProof?(calls: Strk20Call[], proof: import("../domain/strk20-proof").Strk20Proof): Promise<{ transaction_hash: string }>;
  // Optional receipt observer (falls back to provider if absent)
  getReceipt?(txHash: Hex): Promise<Record<string, unknown> | null>;
}

export interface Strk20ActionPort {
  observeCapability(): Promise<{ capable: boolean; apiVersions: string[]; specs: string[]; environment: string; mismatch: boolean; expected: string }>;
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
  if (typeof hash === "string") return hash as Hex;
  if (typeof (hash as { transaction_hash?: string }).transaction_hash === "string") return (hash as { transaction_hash: string }).transaction_hash as Hex;
  if (typeof (hash as { transactionHash?: string }).transactionHash === "string") return (hash as { transactionHash: string }).transactionHash as Hex;
  throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "missing_transaction_hash_in_provider_response");
}

export class WalletStrk20ActionAdapter implements Strk20ActionPort {
  private readonly expectedChainId: string;

  constructor(
    private readonly provider: WalletStrk20ActionProvider,
    opts: { expectedChainId?: string | null } = {},
  ) {
    assertNoViewingKey(provider, "WalletStrk20ActionAdapter.provider");
    assertNoViewingKey(opts, "WalletStrk20ActionAdapter.opts");
    // Default SN_SEPOLIA per M4 runtime requirement
    this.expectedChainId = getExpectedWalletEnvironment(opts.expectedChainId ?? "SN_SEPOLIA");
  }

  async observeCapability(): Promise<{ capable: boolean; apiVersions: string[]; specs: string[]; environment: string; mismatch: boolean; expected: string }> {
    const [apiVersions, specs] = await Promise.all([this.provider.supportedWalletApi(), this.provider.supportedSpecs()]).catch((e) => {
      // If capability query itself throws unknown error, treat as unknown (fail-closed)
      throw new Strk20Error(STRK20_ERROR_CODE.CAPABILITY_UNKNOWN, `capability_query_failed:${String((e as Error)?.message ?? e).slice(0, 60)}`);
    });
    assertNoViewingKey({ apiVersions, specs }, "observeCapability.result");
    const capable = supportsStrk20(apiVersions, specs);
    let chainId = "UNKNOWN";
    try {
      chainId = await this.provider.requestChainId();
    } catch (e) {
      // Unknown network is fail-closed mismatch, not swallowed
      const msg = String((e as Error)?.message ?? e).toLowerCase();
      if (msg.includes("refused") || msg.includes("rejected")) throw new Strk20Error(STRK20_ERROR_CODE.PROVIDER_REFUSED, "chainId_provider_refused");
      throw new Strk20Error(STRK20_ERROR_CODE.CAPABILITY_UNKNOWN, `chainId_query_failed:${msg.slice(0, 60)}`);
    }
    const env = classifyWalletEnvironment(chainId, { mainnet: "SN_MAIN", sepolia: "SN_SEPOLIA" });
    const mismatch = env !== this.expectedChainId;
    return { capable, apiVersions, specs, environment: env, mismatch, expected: this.expectedChainId };
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
    if (!cap.capable) {
      throw new Strk20Error(STRK20_ERROR_CODE.UNSUPPORTED_WALLET, `wallet_api_below_0_10_3:api[${cap.apiVersions.join(",")}]_spec[${cap.specs.join(",")}]`);
    }
    if (cap.environment === "UNKNOWN") {
      throw new Strk20Error(STRK20_ERROR_CODE.NETWORK_MISMATCH, `unknown_network:${cap.environment}_expected_${cap.expected}`);
    }
    if (cap.mismatch) {
      throw new Strk20Error(STRK20_ERROR_CODE.NETWORK_MISMATCH, `expected_${cap.expected}_got_${cap.environment}`);
    }
    // Ensure STRK20 methods present (fail-closed missing methods)
    if (typeof this.provider.strk20PrepareInvoke !== "function" || typeof this.provider.strk20InvokeTransaction !== "function") {
      throw new Strk20Error(STRK20_ERROR_CODE.UNSUPPORTED_WALLET_METHOD, "wallet_missing_strk20_methods_requires_Ready_or_Xverse_with_api>=0.10.3");
    }
    const chainId = await this.provider.requestChainId();
    return { chainId, apiVersions: cap.apiVersions, specs: cap.specs };
  }

  async prepare(actions: Strk20Action[], opts: { simulate: boolean }): Promise<Strk20CallAndProof> {
    assertNoViewingKey({ actions, opts }, "prepare.args");
    validateActions(actions);
    await this.ensureReady();
    const fn = requireMethod(this.provider, "strk20PrepareInvoke");
    try {
      const res = await fn.call(this.provider, actions, opts.simulate);
      assertNoViewingKey(res, "prepare.result");
      // Guard: simulate=true must return empty proof; simulate=false must return non-empty proof
      if (opts.simulate) {
        if (!isEmptyProof(res.proof)) {
          // Provider violated simulate contract – fail-closed (logically not error but we enforce)
          throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "simulate_expected_empty_proof_but_got_non_empty");
        }
      } else {
        if (isEmptyProof(res.proof)) {
          throw new Strk20Error(STRK20_ERROR_CODE.PROOF_REQUIRED, "non_simulate_prepare_returned_empty_proof");
        }
      }
      // Return normalized shape (pass through proof fields as-is; adapter never injects viewing key)
      return { call: res.call, proof: res.proof };
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
      // Normalize to common shape
      const normalized = normalizeReceipt(raw as Record<string, unknown> & { transactionHash?: string });
      // Ensure requested hash matches if provider returns different key name
      if (normalized.transactionHash && normalized.transactionHash !== txHash) {
        // Normalize address comparison – keep as-is but assert no viewing key leak
        return { ...normalized, transactionHash: txHash };
      }
      return normalized;
    } catch (e) {
      if (e instanceof Strk20Error) throw e;
      throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, `receipt_fetch_failed:${String((e as Error)?.message ?? e).slice(0, 60)}`);
    }
  }
}
