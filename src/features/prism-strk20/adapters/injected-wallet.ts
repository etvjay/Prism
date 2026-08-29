// Provider-injected Wallet API adapter for M4 consumer route.
// Authority: STRK20_CONTEXT wallet execution truths; wallet-api-route.md.
// All external I/O via injected wallet provider double (X2 in tests).
// Never touches viewing keys; capability via supportedWalletApi/supportedSpecs only.

import { Strk20Error, STRK20_ERROR_CODE } from "../domain/errors";
import { assertNoViewingKey } from "../domain/privacy-guard";
import { classifyProviderError } from "../domain/strk20-action-port";
import type {
  Strk20WalletPort,
  CapabilityObservation,
  PoolFeeObservation,
  DepositObservation,
  PrivateBalanceObservation,
  TransferObservation,
} from "../domain/ports";
import type { Hex } from "../domain/receipt";
import { normalizeShadowAccountObservation, type ShadowAccountObservation } from "../domain/shadow-account";

export interface InjectedWalletProvider {
  supportedWalletApi(): Promise<string[]>;
  supportedSpecs(): Promise<string[]>;
  requestChainId(): Promise<string>;
  /** Optional metadata-only observation; never an execution method. */
  observeShadowAccountCapability?(): Promise<unknown>;
  isRegistered(): Promise<boolean | null>;
  getFeeAmount(): Promise<{ fee: bigint; blockNumber: number | null }>;
  approve(params: { token: Hex; amount: bigint; spender: Hex }): Promise<Hex>;
  shield(params: { token: Hex; amount: bigint; quotedFee: bigint }): Promise<DepositObservation>;
  balances(params: { tokens: Hex[] }): Promise<PrivateBalanceObservation>;
  transfer(params: { token: Hex; amount: bigint; recipient: Hex; quotedFee: bigint }): Promise<TransferObservation>;
  getReceipt(txHash: Hex): Promise<{
    executionStatus: string;
    finalityStatus?: string;
    finality_status?: string;
    blockNumber: number | null;
    events: { address: string; keys: string[] }[];
  } | null>;
}

export class InjectedWalletStrk20Adapter implements Strk20WalletPort {
  constructor(private readonly provider: InjectedWalletProvider) {
    assertNoViewingKey(provider, "injected_provider");
  }

  async observeCapability(): Promise<CapabilityObservation> {
    try {
      const [apiVersions, specs] = await Promise.all([this.provider.supportedWalletApi(), this.provider.supportedSpecs()]);
      if (!Array.isArray(apiVersions) || !apiVersions.every((value) => typeof value === "string")) {
        throw new Strk20Error(STRK20_ERROR_CODE.CAPABILITY_UNKNOWN, "malformed_supported_wallet_api");
      }
      if (!Array.isArray(specs) || !specs.every((value) => typeof value === "string")) {
        throw new Strk20Error(STRK20_ERROR_CODE.CAPABILITY_UNKNOWN, "malformed_supported_specs");
      }
      assertNoViewingKey({ apiVersions, specs }, "observeCapability_result");
      // Capability detection must not trigger balance consent; we verify no balances call here
      const chainId = await this.provider.requestChainId();
      if (typeof chainId !== "string" || chainId.trim().length === 0) {
        throw new Strk20Error(STRK20_ERROR_CODE.CAPABILITY_UNKNOWN, "malformed_chain_id");
      }
      let shadowAccount: ShadowAccountObservation | undefined;
      if (typeof this.provider.observeShadowAccountCapability === "function") {
        try {
          shadowAccount = normalizeShadowAccountObservation(await this.provider.observeShadowAccountCapability());
        } catch {
          // Optional observation failures do not disable the ordinary route.
          shadowAccount = normalizeShadowAccountObservation(null);
        }
      }
      return {
        apiVersions,
        specs,
        chainId,
        ...(shadowAccount === undefined ? {} : { shadowAccount }),
      };
    } catch (error) {
      if (error instanceof Strk20Error) throw error;
      return classifyProviderError(error);
    }
  }

  async observeChainId(): Promise<string> {
    try {
      const chainId = await this.provider.requestChainId();
      if (typeof chainId !== "string" || chainId.trim().length === 0) {
        throw new Strk20Error(STRK20_ERROR_CODE.CAPABILITY_UNKNOWN, "malformed_chain_id");
      }
      return chainId;
    } catch (error) {
      if (error instanceof Strk20Error) throw error;
      return classifyProviderError(error);
    }
  }

  async isRegistered(): Promise<boolean | null> {
    try {
      const registered = await this.provider.isRegistered();
      if (registered !== true && registered !== false && registered !== null) {
        throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "malformed_registration_observation");
      }
      return registered;
    } catch (error) {
      if (error instanceof Strk20Error) throw error;
      return classifyProviderError(error);
    }
  }

  async observeFee(): Promise<PoolFeeObservation> {
    try {
      const v = await this.provider.getFeeAmount();
      if (!v || typeof v.fee !== "bigint" || v.fee < 0n || (v.blockNumber !== null && !Number.isSafeInteger(v.blockNumber))) {
        throw new Strk20Error(STRK20_ERROR_CODE.FEE_UNAVAILABLE, "invalid_fee_observation");
      }
      return { fee: v.fee, blockNumber: v.blockNumber };
    } catch (error) {
      if (error instanceof Strk20Error) throw error;
      throw new Strk20Error(STRK20_ERROR_CODE.FEE_UNAVAILABLE, "fee_observation_failed");
    }
  }

  async requestApproval(params: { token: Hex; amount: bigint; spender: Hex }): Promise<Hex> {
    assertNoViewingKey(params, "requestApproval_params");
    try {
      const txHash = await this.provider.approve(params);
      if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(txHash.trim())) {
        throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "malformed_approval_transaction_hash");
      }
      return txHash;
    } catch (error) {
      if (error instanceof Strk20Error) throw error;
      return classifyProviderError(error);
    }
  }

  async requestShield(params: { token: Hex; amount: bigint; quotedFee: bigint }): Promise<DepositObservation> {
    assertNoViewingKey(params, "requestShield_params");
    try {
      const obs = await this.provider.shield(params);
      assertNoViewingKey(obs, "requestShield_result");
      if (!obs || typeof obs !== "object" || typeof obs.txHash !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(obs.txHash.trim())) {
        throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "malformed_shield_observation");
      }
      if (obs.screening === "rejected") {
        // Distinct from dependency failure
        throw new Strk20Error(STRK20_ERROR_CODE.SCREENING_REJECTED, "deposit_screening_rejected");
      }
      if (obs.screening === "unavailable") {
        throw new Strk20Error(STRK20_ERROR_CODE.SCREENING_UNAVAILABLE, "screening_unavailable");
      }
      if (obs.screening !== "approved") {
        throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "malformed_screening_observation");
      }
      return obs;
    } catch (error) {
      if (error instanceof Strk20Error) throw error;
      return classifyProviderError(error);
    }
  }

  async requestPrivateBalances(params: { tokens: Hex[]; requireConsent: true }): Promise<PrivateBalanceObservation> {
    assertNoViewingKey(params, "requestPrivateBalances_params");
    if (params.requireConsent !== true) throw new Strk20Error(STRK20_ERROR_CODE.CONSENT_REQUIRED, "consent_must_be_explicit");
    try {
      const res = await this.provider.balances({ tokens: params.tokens });
      assertNoViewingKey(res, "requestPrivateBalances_result");
      if (!res || typeof res !== "object" || !Array.isArray(res.balances) || !res.balances.every((balance) =>
        balance && typeof balance.token === "string" && typeof balance.amount === "bigint" && balance.amount >= 0n)) {
        throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "malformed_balance_observation");
      }
      if (res.consent === "denied") throw new Strk20Error(STRK20_ERROR_CODE.CONSENT_DENIED, "user_denied_balance_consent");
      if (res.consent === "required") throw new Strk20Error(STRK20_ERROR_CODE.CONSENT_REQUIRED, "consent_required");
      if (res.consent !== "granted") throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "malformed_consent_observation");
      return res;
    } catch (error) {
      if (error instanceof Strk20Error) throw error;
      return classifyProviderError(error);
    }
  }

  async requestPrivateTransfer(params: { token: Hex; amount: bigint; recipient: Hex; quotedFee: bigint }): Promise<TransferObservation> {
    assertNoViewingKey(params, "requestPrivateTransfer_params");
    try {
      const obs = await this.provider.transfer(params);
      assertNoViewingKey(obs, "requestPrivateTransfer_result");
      if (!obs || typeof obs !== "object" || typeof obs.txHash !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(obs.txHash.trim())) {
        throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "malformed_transfer_observation");
      }
      return obs;
    } catch (error) {
      if (error instanceof Strk20Error) throw error;
      return classifyProviderError(error);
    }
  }

  async observeReceipt(txHash: Hex): Promise<DepositObservation | TransferObservation | null> {
    assertNoViewingKey({ txHash }, "observeReceipt");
    try {
      const r = await this.provider.getReceipt(txHash);
      if (!r) return null;
      assertNoViewingKey(r, "observeReceipt_result");
      if (!Array.isArray(r.events) || !r.events.every((event) => event && typeof event.address === "string" && Array.isArray(event.keys) && event.keys.every((key) => typeof key === "string"))) {
        throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "malformed_receipt_events");
      }
      if (typeof r.executionStatus !== "string" || (r.blockNumber !== null && !Number.isSafeInteger(r.blockNumber))) {
        throw new Strk20Error(STRK20_ERROR_CODE.DEPENDENCY_FAILURE, "malformed_receipt_observation");
      }
      // Normalize to DepositObservation shape for simplicity. Only the
      // transaction hash/status/finality/event facts cross this adapter.
      return {
        txHash,
        executionStatus: r.executionStatus as DepositObservation["executionStatus"],
        finalityStatus: r.finalityStatus ?? r.finality_status ?? "UNKNOWN",
        screening: "approved",
        blockNumber: r.blockNumber,
        receiptEvents: r.events,
      } as DepositObservation;
    } catch (error) {
      if (error instanceof Strk20Error) throw error;
      return classifyProviderError(error);
    }
  }
}
