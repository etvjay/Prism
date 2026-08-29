// Domain vocabulary for a connected portfolio projection.
//
// A portfolio is derived data. It never becomes an identity, binding, ledger,
// or receipt authority. Public account ownership enters this module only through
// the explicit binding/resolution port; private STRK20 data enters only through
// an explicit privacy-wallet consent decision.

export const PUBLIC_PORTFOLIO_VENUES = ["BASE", "STARKNET"] as const;
export type PublicPortfolioVenue = (typeof PUBLIC_PORTFOLIO_VENUES)[number];

export const PORTFOLIO_VENUES = ["BASE", "STARKNET", "STRK20"] as const;
export type PortfolioVenue = (typeof PORTFOLIO_VENUES)[number];

export const PORTFOLIO_BRANCH_STATES = [
  "loading",
  "empty",
  "observed",
  "stale",
  "unavailable",
  "partial",
  "unknown",
] as const;
export type PortfolioBranchState = (typeof PORTFOLIO_BRANCH_STATES)[number];

export const PORTFOLIO_FRESHNESS = ["fresh", "stale", "unknown"] as const;
export type PortfolioFreshness = (typeof PORTFOLIO_FRESHNESS)[number];

export const PORTFOLIO_COVERAGE = ["none", "partial", "complete"] as const;
export type PortfolioCoverage = (typeof PORTFOLIO_COVERAGE)[number];

export const ASSET_UNIT_COMPATIBILITY = ["compatible", "incompatible", "unknown"] as const;
export type AssetUnitCompatibility = (typeof ASSET_UNIT_COMPATIBILITY)[number];

export type PortfolioNumeric = string | number | bigint;

/** A balance item after the provider boundary has been allow-listed. */
export interface PortfolioAsset {
  readonly assetId: string;
  readonly symbol?: string;
  /** Human-readable unit, e.g. `ETH`, `STRK`, or an explicitly declared base unit. */
  readonly unit: string;
  /** Decimal quantity, normalized to a string in returned projections. */
  readonly amount: string;
}

export interface PortfolioCoverageDetail {
  readonly requested: number | null;
  readonly observed: number;
  readonly omitted: readonly string[];
}

export interface PortfolioError {
  readonly code: string;
  readonly detail?: string;
}

export type PrivacyWalletConsentStatus = "missing" | "required" | "denied" | "granted";

export interface PrivacyWalletConsent {
  readonly status: PrivacyWalletConsentStatus;
  /** Opaque wallet-session reference only; never a key, proof, note, or credential. */
  readonly walletSessionRef?: string;
}

export interface PortfolioPrivacyMetadata {
  readonly visibility: "PUBLIC" | "PRIVATE";
  readonly consent: "not_applicable" | PrivacyWalletConsentStatus;
}

/** One explicit source branch in the returned portfolio. */
export interface PortfolioBranch {
  readonly venue: PortfolioVenue;
  readonly visibility: "PUBLIC" | "PRIVATE";
  /** Public account fields are absent/null for private STRK20 projections. */
  readonly accounts: readonly string[];
  readonly account: string | null;
  readonly assets: readonly PortfolioAsset[];
  readonly state: PortfolioBranchState;
  readonly authoritativeSource: string | null;
  readonly observedAt: number | null;
  readonly freshness: PortfolioFreshness;
  readonly coverage: PortfolioCoverage;
  readonly coverageDetail: PortfolioCoverageDetail;
  readonly assetUnitCompatibility: AssetUnitCompatibility;
  readonly incompatibleAssets: readonly string[];
  readonly privacy: PortfolioPrivacyMetadata;
  readonly error: PortfolioError | null;
}

export interface ValuedPortfolioAsset {
  readonly venue: PortfolioVenue;
  readonly assetId: string;
  readonly unit: string;
  readonly value: string;
  readonly currency: string;
}

export interface ExcludedPortfolioAsset {
  readonly venue: PortfolioVenue;
  readonly assetId: string;
  readonly unit: string;
  readonly reason: string;
}

export interface PortfolioTotal {
  readonly amount: string;
  readonly currency: string;
  readonly coverage: PortfolioCoverage;
  readonly authoritativeSource: string;
  readonly observedAt: number;
  readonly freshness: "fresh";
  readonly includedAssets: readonly ValuedPortfolioAsset[];
  readonly excludedAssets: readonly ExcludedPortfolioAsset[];
}

export type PortfolioValuationStatus =
  | "not_requested"
  | "observed"
  | "partial"
  | "stale"
  | "unavailable"
  | "unknown";

export interface PortfolioValuationSummary {
  readonly status: PortfolioValuationStatus;
  readonly authoritativeSource: string | null;
  readonly observedAt: number | null;
  readonly freshness: PortfolioFreshness;
  readonly errors: readonly PortfolioError[];
}

export interface ConnectedPortfolio {
  readonly prismId: string;
  readonly state: PortfolioBranchState;
  readonly branches: {
    readonly BASE: PortfolioBranch;
    readonly STARKNET: PortfolioBranch;
    readonly STRK20: PortfolioBranch;
  };
  readonly total: PortfolioTotal | null;
  readonly valuation: PortfolioValuationSummary;
  readonly authoritativeSource: "derived_portfolio";
  readonly observedAt: number | null;
  readonly freshness: PortfolioFreshness;
  readonly coverage: PortfolioCoverage;
}

export type PortfolioData = ConnectedPortfolio;
