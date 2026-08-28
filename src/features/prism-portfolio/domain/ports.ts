import type {
  AssetUnitCompatibility,
  ConnectedPortfolio,
  PortfolioAsset,
  PortfolioCoverage,
  PortfolioFreshness,
  PortfolioNumeric,
  PortfolioBranchState,
  PortfolioValuationStatus,
  PortfolioVenue,
  PrivacyWalletConsent,
  PrivacyWalletConsentStatus,
  PublicPortfolioVenue,
} from "./types";

export type GrantedPrivacyWalletConsent = PrivacyWalletConsent & { readonly status: "granted" };

/** One account returned by an authoritative public binding/resolution read. */
export interface ExplicitPublicAccount {
  /** `address` is preferred; `account` is accepted as a vocabulary alias. */
  readonly address?: string;
  readonly account?: string;
  readonly bindingId?: string;
}

/**
 * The resolver is the only authority allowed to associate a public account with
 * a Prism ID. The aggregation service has no address/alias/graph fallback.
 */
export interface PublicAccountResolution {
  readonly venue: PublicPortfolioVenue;
  /** Optional in-flight marker for a resolver that has not produced a destination yet. */
  readonly state?: PortfolioBranchState;
  readonly accounts?: readonly ExplicitPublicAccount[];
  /** Convenience form for a venue with one explicit destination. */
  readonly account?: ExplicitPublicAccount | string | null;
  /** Canonical resolver vocabulary alias for a single execution account. */
  readonly executionAccount?: string | null;
  readonly authoritativeSource: string;
  readonly observedAt: number;
  readonly freshness: PortfolioFreshness;
  readonly coverage?: PortfolioCoverage;
  /** A resolver may explicitly mark a candidate as inferred; it is rejected. */
  readonly authority?: "explicit_binding" | "canonical_resolution" | "inferred" | "unknown";
}

export interface PublicAccountResolver {
  resolve(input: { prismId: string; venue: PublicPortfolioVenue }): Promise<PublicAccountResolution>;
}

export interface PortfolioBalanceObservation {
  /** Providers may return an explicit in-flight state without assets. */
  readonly state?: PortfolioBranchState;
  /** A privacy wallet may repeat the consent decision in its response. */
  readonly consent?: PrivacyWalletConsentStatus;
  readonly assets?: readonly {
    readonly assetId: string;
    readonly symbol?: string;
    readonly unit: string;
    readonly amount: PortfolioNumeric;
  }[];
  /** Wallet API vocabulary alias; `unit` defaults to `base-unit` at this seam. */
  readonly balances?: readonly {
    readonly token: string;
    readonly symbol?: string;
    readonly unit?: string;
    readonly amount: PortfolioNumeric;
  }[];
  readonly authoritativeSource: string;
  readonly observedAt: number;
  readonly freshness: PortfolioFreshness;
  readonly coverage?: PortfolioCoverage;
  readonly assetUnitCompatibility?: AssetUnitCompatibility;
}

export interface PublicPortfolioBalanceSource {
  observe(input: {
    prismId: string;
    venue: PublicPortfolioVenue;
    address: string;
    bindingId?: string;
  }): Promise<PortfolioBalanceObservation>;
}

/**
 * A private source receives consent as an explicit capability. It does not
 * receive an address, viewing key, note, proof, or provider response sink.
 */
export interface PrivatePortfolioBalanceSource {
  observe(input: {
    prismId: string;
    consent: GrantedPrivacyWalletConsent;
  }): Promise<PortfolioBalanceObservation>;
}

export interface PortfolioValuationObservation {
  /** A quote for the whole observed balance. */
  readonly value?: PortfolioNumeric;
  /** Optional per-unit quote; the service multiplies it by the observed amount. */
  readonly price?: PortfolioNumeric;
  readonly currency: string;
  readonly authoritativeSource: string;
  readonly observedAt: number;
  readonly freshness: PortfolioFreshness;
  /** Optional echo fields let the service detect a mismatched quote. */
  readonly assetId?: string;
  readonly unit?: string;
}

export interface PortfolioValuationSource {
  value?(input: {
    prismId: string;
    venue: PortfolioVenue;
    asset: PortfolioAsset;
    assetId: string;
    unit: string;
    amount: string;
  }): Promise<PortfolioValuationObservation>;
  getPrice?(input: {
    prismId: string;
    venue: PortfolioVenue;
    asset: PortfolioAsset;
    assetId: string;
    unit: string;
    amount: string;
  }): Promise<PortfolioValuationObservation>;
}

export type PublicBalanceSourceSet =
  | Partial<Record<PublicPortfolioVenue, PublicPortfolioBalanceSource>>
  | ReadonlyMap<PublicPortfolioVenue, PublicPortfolioBalanceSource>;

export interface PortfolioAggregationDependencies {
  readonly publicAccountResolver: PublicAccountResolver;
  readonly publicBalanceSources: PublicBalanceSourceSet;
  readonly privateBalanceSource?: PrivatePortfolioBalanceSource | null;
  readonly valuationSource?: PortfolioValuationSource | null;
  /** Optional deterministic observation clock for callers that need one. */
  readonly now?: () => number;
}

export interface AggregatePortfolioInput {
  readonly prismId: string;
  readonly privacyWalletConsent?: PrivacyWalletConsent | null;
}

export interface PortfolioAggregationPort {
  /** Preferred aggregation method for application services. */
  aggregate?(input: AggregatePortfolioInput): Promise<ConnectedPortfolio>;
  /** Read-oriented alias used by transport adapters. */
  getPortfolio?(input: AggregatePortfolioInput): Promise<ConnectedPortfolio>;
}

export type { PortfolioValuationStatus };
