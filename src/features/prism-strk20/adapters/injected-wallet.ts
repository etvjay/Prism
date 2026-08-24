// Provider-injected Wallet API adapter for M4 consumer route.
// Authority: STRK20_CONTEXT wallet execution truths; wallet-api-route.md.
// All external I/O via injected wallet provider double (X2 in tests).
// Never touches viewing keys; capability via supportedWalletApi/supportedSpecs only.

import { Strk20Error, STRK20_ERROR_CODE } from "../domain/errors";
import { assertNoViewingKey } from "../domain/privacy-guard";
import type {
  Strk20WalletPort,
  CapabilityObservation,
  PoolFeeObservation,
  DepositObservation,
  PrivateBalanceObservation,
  TransferObservation,
} from "../domain/ports";
import type { Hex } from "../domain/receipt";

export interface InjectedWalletProvider {
  supportedWalletApi(): Promise<string[]>;
  supportedSpecs(): Promise<string[]>;
  requestChainId(): Promise<string>;
  isRegistered(): Promise<boolean>;
  getFeeAmount(): Promise<{ fee: bigint; blockNumber: number | null }>;
  approve(params: { token: Hex; amount: bigint; spender: Hex }): Promise<Hex>;
  shield(params: { token: Hex; amount: bigint; quotedFee: bigint }): Promise<DepositObservation>;
  balances(params: { tokens: Hex[] }): Promise<PrivateBalanceObservation>;
  transfer(params: { token: Hex; amount: bigint; recipient: Hex; quotedFee: bigint }): Promise<TransferObservation>;
  getReceipt(txHash: Hex): Promise<{ executionStatus: string; blockNumber: number | null; events: { address: string; keys: string[] }[] } | null>;
}

export class InjectedWalletStrk20Adapter implements Strk20WalletPort {
  constructor(private readonly provider: InjectedWalletProvider) {
    assertNoViewingKey(provider, "injected_provider");
  }

  async observeCapability(): Promise<CapabilityObservation> {
    const [apiVersions, specs] = await Promise.all([this.provider.supportedWalletApi(), this.provider.supportedSpecs()]);
    assertNoViewingKey({ apiVersions, specs }, "observeCapability_result");
    // Capability detection must not trigger balance consent; we verify no balances call here
    const chainId = await this.provider.requestChainId();
    return { apiVersions, specs, chainId };
  }

  async observeChainId(): Promise<string> {
    return this.provider.requestChainId();
  }

  async isRegistered(): Promise<boolean> {
    return this.provider.isRegistered();
  }

  async observeFee(): Promise<PoolFeeObservation> {
    const v = await this.provider.getFeeAmount();
    if (v.fee < 0n) throw new Strk20Error(STRK20_ERROR_CODE.FEE_UNAVAILABLE, "negative_fee");
    return { fee: v.fee, blockNumber: v.blockNumber };
  }

  async requestApproval(params: { token: Hex; amount: bigint; spender: Hex }): Promise<Hex> {
    assertNoViewingKey(params, "requestApproval_params");
    return this.provider.approve(params);
  }

  async requestShield(params: { token: Hex; amount: bigint; quotedFee: bigint }): Promise<DepositObservation> {
    assertNoViewingKey(params, "requestShield_params");
    const obs = await this.provider.shield(params);
    if (obs.screening === "rejected") {
      // Distinct from dependency failure
      throw new Strk20Error(STRK20_ERROR_CODE.SCREENING_REJECTED, "deposit_screening_rejected");
    }
    if (obs.screening === "unavailable") {
      throw new Strk20Error(STRK20_ERROR_CODE.SCREENING_UNAVAILABLE, "screening_unavailable");
    }
    return obs;
  }

  async requestPrivateBalances(params: { tokens: Hex[]; requireConsent: true }): Promise<PrivateBalanceObservation> {
    assertNoViewingKey(params, "requestPrivateBalances_params");
    if (params.requireConsent !== true) throw new Strk20Error(STRK20_ERROR_CODE.CONSENT_REQUIRED, "consent_must_be_explicit");
    const res = await this.provider.balances({ tokens: params.tokens });
    if (res.consent === "denied") throw new Strk20Error(STRK20_ERROR_CODE.CONSENT_DENIED, "user_denied_balance_consent");
    if (res.consent === "required") throw new Strk20Error(STRK20_ERROR_CODE.CONSENT_REQUIRED, "consent_required");
    return res;
  }

  async requestPrivateTransfer(params: { token: Hex; amount: bigint; recipient: Hex; quotedFee: bigint }): Promise<TransferObservation> {
    assertNoViewingKey(params, "requestPrivateTransfer_params");
    return this.provider.transfer(params);
  }

  async observeReceipt(txHash: Hex): Promise<DepositObservation | TransferObservation | null> {
    assertNoViewingKey({ txHash }, "observeReceipt");
    const r = await this.provider.getReceipt(txHash);
    if (!r) return null;
    // Normalize to DepositObservation shape for simplicity
    return {
      txHash,
      executionStatus: r.executionStatus as DepositObservation["executionStatus"],
      screening: "approved",
      blockNumber: r.blockNumber,
      receiptEvents: r.events,
    } as DepositObservation;
  }
}
