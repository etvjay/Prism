import {
  PortfolioAggregationError,
  PORTFOLIO_ERROR_CODE,
} from "../domain/errors";
import type {
  AggregatePortfolioInput,
  ExplicitPublicAccount,
  PortfolioAggregationDependencies,
  PortfolioBalanceObservation,
  PublicPortfolioBalanceSource,
  PortfolioValuationObservation,
  PublicAccountResolution,
  PublicBalanceSourceSet,
} from "../domain/ports";
import { PORTFOLIO_BRANCH_STATES } from "../domain/types";
import type {
  ConnectedPortfolio,
  ExcludedPortfolioAsset,
  PortfolioAsset,
  PortfolioBranch,
  PortfolioBranchState,
  PortfolioCoverage,
  PortfolioError,
  PortfolioFreshness,
  PortfolioNumeric,
  PortfolioPrivacyMetadata,
  PortfolioTotal,
  PortfolioValuationSummary,
  PortfolioVenue,
  PrivacyWalletConsent,
  PublicPortfolioVenue,
  ValuedPortfolioAsset,
} from "../domain/types";

interface NormalizedObservation {
  readonly state?: PortfolioBranchState;
  readonly consent?: PrivacyWalletConsent["status"];
  readonly assets: readonly PortfolioAsset[];
  readonly authoritativeSource: string;
  readonly observedAt: number;
  readonly freshness: PortfolioFreshness;
  readonly coverage: PortfolioCoverage;
  readonly assetUnitCompatibility?: PortfolioBranch["assetUnitCompatibility"];
}

interface AssetNormalization {
  readonly assets: readonly PortfolioAsset[];
  readonly incompatibleAssets: readonly string[];
  readonly compatibility: PortfolioBranch["assetUnitCompatibility"];
}

interface ValuationSuccess {
  readonly venue: PortfolioVenue;
  readonly asset: PortfolioAsset;
  readonly value: string;
  readonly currency: string;
  readonly source: string;
  readonly observedAt: number;
}

const PUBLIC_VISIBILITY: PortfolioPrivacyMetadata = {
  visibility: "PUBLIC",
  consent: "not_applicable",
};

const PRIVATE_VISIBILITY = (consent: PrivacyWalletConsent["status"]): PortfolioPrivacyMetadata => ({
  visibility: "PRIVATE",
  consent,
});

function isFreshness(value: unknown): value is PortfolioFreshness {
  return value === "fresh" || value === "stale" || value === "unknown";
}

function isCoverage(value: unknown): value is PortfolioCoverage {
  return value === "none" || value === "partial" || value === "complete";
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeDecimal(value: PortfolioNumeric, field: string): string {
  let raw: string;
  if (typeof value === "bigint") raw = value.toString(10);
  else if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new PortfolioAggregationError(PORTFOLIO_ERROR_CODE.INVALID_OBSERVATION, `${field}_not_finite`);
    raw = String(value);
  } else if (typeof value === "string") raw = value.trim();
  else throw new PortfolioAggregationError(PORTFOLIO_ERROR_CODE.INVALID_OBSERVATION, `${field}_not_numeric`);

  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(raw)) {
    throw new PortfolioAggregationError(PORTFOLIO_ERROR_CODE.INVALID_OBSERVATION, `${field}_must_be_non_negative_decimal`);
  }
  const [integerPart, fractionPart] = raw.split(".");
  const integer = integerPart.replace(/^0+(?=\d)/, "");
  const fraction = (fractionPart ?? "").replace(/0+$/, "");
  return fraction.length > 0 ? `${integer}.${fraction}` : integer;
}

function addDecimals(left: string, right: string): string {
  const [leftInteger, leftFraction = ""] = left.split(".");
  const [rightInteger, rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const leftScaled = BigInt(`${leftInteger}${leftFraction.padEnd(scale, "0")}`);
  const rightScaled = BigInt(`${rightInteger}${rightFraction.padEnd(scale, "0")}`);
  const sum = (leftScaled + rightScaled).toString(10).padStart(scale + 1, "0");
  if (scale === 0) return sum;
  const integer = sum.slice(0, -scale).replace(/^0+(?=\d)/, "");
  const fraction = sum.slice(-scale).replace(/0+$/, "");
  return fraction.length > 0 ? `${integer}.${fraction}` : integer;
}

function multiplyDecimals(left: string, right: string): string {
  const [leftInteger, leftFraction = ""] = left.split(".");
  const [rightInteger, rightFraction = ""] = right.split(".");
  const scale = leftFraction.length + rightFraction.length;
  const product = BigInt(`${leftInteger}${leftFraction}`) * BigInt(`${rightInteger}${rightFraction}`);
  if (scale === 0) return product.toString(10);
  const raw = product.toString(10).padStart(scale + 1, "0");
  const integer = raw.slice(0, -scale).replace(/^0+(?=\d)/, "");
  const fraction = raw.slice(-scale).replace(/0+$/, "");
  return fraction.length > 0 ? `${integer}.${fraction}` : integer;
}

function error(code: string, detail?: string): PortfolioError {
  return { code, ...(detail ? { detail } : {}) };
}

function safeProviderDetail(): string {
  return "provider_failure";
}

const PRIVATE_PROJECTION_FORBIDDEN = [/viewing.?key/i, /private.?key/i, /seed.?phrase/i, /mnemonic/i, /raw.?proof/i];

function containsForbiddenPrivateMaterial(asset: PortfolioAsset): boolean {
  return [asset.assetId, asset.symbol ?? "", asset.unit].some((value) => PRIVATE_PROJECTION_FORBIDDEN.some((pattern) => pattern.test(value)));
}

function sourceForInternal(sources: PublicBalanceSourceSet, venue: PublicPortfolioVenue) {
  if (typeof (sources as ReadonlyMap<PublicPortfolioVenue, PublicPortfolioBalanceSource>).get === "function") {
    return (sources as ReadonlyMap<PublicPortfolioVenue, PublicPortfolioBalanceSource>).get(venue);
  }
  return (sources as Partial<Record<PublicPortfolioVenue, PublicPortfolioBalanceSource>>)[venue];
}

function normalizeAccountResolution(resolution: PublicAccountResolution): ExplicitPublicAccount[] {
  const candidates: ExplicitPublicAccount[] = [];
  if (Array.isArray(resolution.accounts)) candidates.push(...resolution.accounts);
  if (resolution.account !== undefined && resolution.account !== null) {
    if (typeof resolution.account === "string") candidates.push({ address: resolution.account });
    else candidates.push(resolution.account);
  }
  if (resolution.executionAccount !== undefined && resolution.executionAccount !== null) {
    candidates.push({ address: resolution.executionAccount });
  }
  const seen = new Set<string>();
  const normalized: ExplicitPublicAccount[] = [];
  for (const candidate of candidates) {
    const address = typeof candidate?.address === "string"
      ? candidate.address.trim()
      : typeof candidate?.account === "string"
        ? candidate.account.trim()
        : "";
    if (!address) continue;
    const key = `${address.toLowerCase()}|${candidate.bindingId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ address, ...(candidate.bindingId ? { bindingId: candidate.bindingId } : {}) });
  }
  return normalized;
}

function normalizeObservation(observation: PortfolioBalanceObservation): NormalizedObservation {
  if (!observation || typeof observation !== "object") {
    throw new PortfolioAggregationError(PORTFOLIO_ERROR_CODE.INVALID_OBSERVATION, "observation_required");
  }
  if (!nonEmptyString(observation.authoritativeSource)) {
    throw new PortfolioAggregationError(PORTFOLIO_ERROR_CODE.INVALID_OBSERVATION, "authoritative_source_required");
  }
  if (!Number.isSafeInteger(observation.observedAt) || observation.observedAt < 0) {
    throw new PortfolioAggregationError(PORTFOLIO_ERROR_CODE.INVALID_OBSERVATION, "observed_at_invalid");
  }
  if (!isFreshness(observation.freshness)) {
    throw new PortfolioAggregationError(PORTFOLIO_ERROR_CODE.INVALID_OBSERVATION, "freshness_invalid");
  }
  const rawAssets = Array.isArray(observation.assets)
    ? observation.assets
    : Array.isArray(observation.balances)
      ? observation.balances.map((balance) => ({
        assetId: balance.token,
        ...(balance.symbol === undefined ? {} : { symbol: balance.symbol }),
        unit: balance.unit ?? "base-unit",
        amount: balance.amount,
      }))
      : null;
  if (rawAssets === null) {
    throw new PortfolioAggregationError(PORTFOLIO_ERROR_CODE.INVALID_OBSERVATION, "assets_or_balances_must_be_array");
  }
  if (observation.state !== undefined && !PORTFOLIO_BRANCH_STATES.includes(observation.state)) {
    throw new PortfolioAggregationError(PORTFOLIO_ERROR_CODE.INVALID_OBSERVATION, "state_invalid");
  }
  if (observation.state === "loading" && rawAssets.length > 0) {
    throw new PortfolioAggregationError(PORTFOLIO_ERROR_CODE.INVALID_OBSERVATION, "loading_observation_has_assets");
  }
  if (observation.consent !== undefined && !["missing", "required", "denied", "granted"].includes(observation.consent)) {
    throw new PortfolioAggregationError(PORTFOLIO_ERROR_CODE.INVALID_OBSERVATION, "consent_invalid");
  }
  if (observation.assetUnitCompatibility !== undefined && !["compatible", "incompatible", "unknown"].includes(observation.assetUnitCompatibility)) {
    throw new PortfolioAggregationError(PORTFOLIO_ERROR_CODE.INVALID_OBSERVATION, "asset_unit_compatibility_invalid");
  }
  const coverage = observation.coverage ?? (rawAssets.length > 0 ? "complete" : "none");
  if (!isCoverage(coverage)) {
    throw new PortfolioAggregationError(PORTFOLIO_ERROR_CODE.INVALID_OBSERVATION, "coverage_invalid");
  }
  return {
    ...(observation.state === undefined ? {} : { state: observation.state }),
    ...(observation.consent === undefined ? {} : { consent: observation.consent }),
    assets: rawAssets.map((asset) => {
      if (!asset || !nonEmptyString(asset.assetId) || !nonEmptyString(asset.unit)) {
        throw new PortfolioAggregationError(PORTFOLIO_ERROR_CODE.INVALID_OBSERVATION, "asset_identity_required");
      }
      const symbol = asset.symbol === undefined ? undefined : String(asset.symbol).trim();
      return {
        assetId: asset.assetId.trim(),
        ...(symbol ? { symbol } : {}),
        unit: asset.unit.trim(),
        amount: normalizeDecimal(asset.amount, "asset_amount"),
      };
    }),
    authoritativeSource: observation.authoritativeSource.trim(),
    observedAt: observation.observedAt,
    freshness: observation.freshness,
    coverage,
    ...(observation.assetUnitCompatibility === undefined ? {} : { assetUnitCompatibility: observation.assetUnitCompatibility }),
  };
}

function normalizeAssets(observations: readonly NormalizedObservation[]): AssetNormalization {
  const groups = new Map<string, { units: Set<string>; byUnit: Map<string, { symbol?: string; amount: string }> }>();
  for (const observation of observations) {
    for (const asset of observation.assets) {
      const group = groups.get(asset.assetId) ?? { units: new Set<string>(), byUnit: new Map() };
      group.units.add(asset.unit);
      const existing = group.byUnit.get(asset.unit);
      group.byUnit.set(asset.unit, {
        ...(existing?.symbol ?? asset.symbol ? { symbol: existing?.symbol ?? asset.symbol } : {}),
        amount: existing ? addDecimals(existing.amount, asset.amount) : asset.amount,
      });
      groups.set(asset.assetId, group);
    }
  }

  const assets: PortfolioAsset[] = [];
  const incompatibleAssets: string[] = [];
  for (const [assetId, group] of groups) {
    if (group.units.size > 1) {
      incompatibleAssets.push(assetId);
      continue;
    }
    const unit = [...group.units][0];
    const value = group.byUnit.get(unit)!;
    assets.push({ assetId, ...(value.symbol ? { symbol: value.symbol } : {}), unit, amount: value.amount });
  }
  return {
    assets,
    incompatibleAssets,
    compatibility: groups.size === 0 ? "unknown" : incompatibleAssets.length > 0 ? "incompatible" : "compatible",
  };
}

function branchStateForFreshness(freshness: PortfolioFreshness): PortfolioBranchState {
  if (freshness === "stale") return "stale";
  if (freshness === "unknown") return "unknown";
  return "empty";
}

function branchSkeleton(
  venue: PortfolioVenue,
  visibility: "PUBLIC" | "PRIVATE",
  privacy: PortfolioPrivacyMetadata,
): PortfolioBranch {
  return {
    venue,
    visibility,
    accounts: [],
    account: null,
    assets: [],
    state: "unknown",
    authoritativeSource: null,
    observedAt: null,
    freshness: "unknown",
    coverage: "none",
    coverageDetail: { requested: null, observed: 0, omitted: [] },
    assetUnitCompatibility: "unknown",
    incompatibleAssets: [],
    privacy,
    error: null,
  };
}

function combineSourceNames(names: readonly string[]): string | null {
  const unique = [...new Set(names.filter(nonEmptyString).map((name) => name.trim()))];
  if (unique.length === 0) return null;
  return unique.length === 1 ? unique[0] : "multiple_authoritative_sources";
}

function branchFromObservations(
  venue: PortfolioVenue,
  visibility: "PUBLIC" | "PRIVATE",
  privacy: PortfolioPrivacyMetadata,
  accounts: readonly ExplicitPublicAccount[],
  observations: readonly NormalizedObservation[],
  failures: readonly PortfolioError[],
  resolution: { source: string | null; observedAt: number | null; freshness: PortfolioFreshness; coverage?: PortfolioCoverage },
): PortfolioBranch {
  const branch = branchSkeleton(venue, visibility, privacy);
  const allFresh = observations.filter((observation) => observation.freshness === "fresh");
  const hasStale = observations.some((observation) => observation.freshness === "stale");
  const hasUnknown = observations.some((observation) => observation.freshness === "unknown");
  const hasLoading = observations.some((observation) => observation.state === "loading");
  const declaredIncompatible = observations.some((observation) => observation.assetUnitCompatibility === "incompatible");
  const declaredUnknown = observations.some((observation) => observation.assetUnitCompatibility === "unknown");
  const resolutionIncomplete = resolution.coverage !== undefined && resolution.coverage !== "complete";
  const usable = allFresh;
  const normalization = normalizeAssets(usable);
  const compatibility = declaredIncompatible
    ? "incompatible"
    : declaredUnknown
      ? "unknown"
      : normalization.compatibility;
  const hasUnitIssue = normalization.incompatibleAssets.length > 0
    || (normalization.assets.length > 0 && compatibility !== "compatible");
  const sourceObservations = usable.length > 0 ? usable : observations;
  const source = combineSourceNames([
    ...sourceObservations.map((observation) => observation.authoritativeSource),
    ...(sourceObservations.length === 0 && resolution.source ? [resolution.source] : []),
  ]);
  const observedAtValues = [...observations.map((observation) => observation.observedAt), ...(resolution.observedAt === null ? [] : [resolution.observedAt])];
  const observedAt = observedAtValues.length > 0 ? Math.max(...observedAtValues) : null;
  const omitted = [...normalization.incompatibleAssets];
  if (failures.length > 0) omitted.push(...failures.map((failure) => failure.detail ?? failure.code));

  let state: PortfolioBranchState;
  let freshness: PortfolioFreshness;
  if (usable.length === 0) {
    freshness = failures.length > 0
      ? "unknown"
      : hasLoading || hasUnknown || resolution.freshness === "unknown" ? "unknown"
        : hasStale || resolution.freshness === "stale" ? "stale" : "fresh";
    state = failures.length > 0
      ? observations.length > 0 ? "partial" : failures.some((failure) => failure.code === PORTFOLIO_ERROR_CODE.INVALID_OBSERVATION) ? "unknown" : "unavailable"
      : hasLoading ? "loading" : resolutionIncomplete || hasUnitIssue ? "partial" : branchStateForFreshness(freshness);
  } else {
    freshness = "fresh";
    state = failures.length > 0 || hasLoading || hasStale || hasUnknown || resolutionIncomplete || hasUnitIssue || usable.some((observation) => observation.coverage === "partial")
      ? "partial"
      : normalization.assets.length > 0 ? "observed" : "empty";
  }

  const completeCoverage = observations.length > 0 && observations.every((observation) => observation.coverage === "complete") && failures.length === 0 && !hasLoading && !hasStale && !hasUnknown && !resolutionIncomplete && !hasUnitIssue;
  const coverage: PortfolioCoverage = normalization.assets.length === 0
    ? "none"
    : completeCoverage ? "complete" : "partial";
  return {
    ...branch,
    accounts: accounts.map((account) => account.address ?? account.account!).filter(nonEmptyString),
    account: accounts.length === 1 ? (accounts[0].address ?? accounts[0].account ?? null) : null,
    assets: normalization.assets,
    state,
    authoritativeSource: source,
    observedAt,
    freshness,
    coverage,
    coverageDetail: {
      requested: accounts.length > 0 ? accounts.length : null,
      observed: normalization.assets.length,
      omitted,
    },
    assetUnitCompatibility: compatibility,
    incompatibleAssets: normalization.incompatibleAssets,
    error: failures[0] ?? null,
  };
}

function unavailableBranch(
  venue: PortfolioVenue,
  privacy: PortfolioPrivacyMetadata,
  code: string,
  detail: string,
  metadata?: {
    readonly accounts?: readonly ExplicitPublicAccount[];
    readonly authoritativeSource?: string | null;
    readonly observedAt?: number | null;
    readonly freshness?: PortfolioFreshness;
  },
): PortfolioBranch {
  const branch = branchSkeleton(venue, privacy.visibility, privacy);
  const accounts = metadata?.accounts ?? [];
  return {
    ...branch,
    state: "unavailable",
    accounts: accounts.map((account) => account.address ?? account.account!).filter(nonEmptyString),
    account: accounts.length === 1 ? (accounts[0].address ?? accounts[0].account ?? null) : null,
    authoritativeSource: metadata?.authoritativeSource ?? null,
    observedAt: metadata?.observedAt ?? null,
    freshness: metadata?.freshness ?? "unknown",
    coverageDetail: { requested: accounts.length > 0 ? accounts.length : null, observed: 0, omitted: [] },
    error: error(code, detail),
  };
}

function unknownBranch(
  venue: PortfolioVenue,
  privacy: PortfolioPrivacyMetadata,
  code: string,
  detail: string,
): PortfolioBranch {
  const branch = branchSkeleton(venue, privacy.visibility, privacy);
  return { ...branch, state: "unknown", error: error(code, detail) };
}

function normalizeValuation(observation: PortfolioValuationObservation, amount: string): {
  value: string;
  currency: string;
  source: string;
  observedAt: number;
  freshness: PortfolioFreshness;
  assetId?: string;
  unit?: string;
} {
  if (!observation || !nonEmptyString(observation.currency) || !nonEmptyString(observation.authoritativeSource)) {
    throw new PortfolioAggregationError(PORTFOLIO_ERROR_CODE.INVALID_OBSERVATION, "valuation_metadata_required");
  }
  if (!Number.isSafeInteger(observation.observedAt) || observation.observedAt < 0) {
    throw new PortfolioAggregationError(PORTFOLIO_ERROR_CODE.INVALID_OBSERVATION, "valuation_observed_at_invalid");
  }
  if (!isFreshness(observation.freshness)) {
    throw new PortfolioAggregationError(PORTFOLIO_ERROR_CODE.INVALID_OBSERVATION, "valuation_freshness_invalid");
  }
  const value = observation.value !== undefined
    ? normalizeDecimal(observation.value, "valuation_value")
    : observation.price !== undefined
      ? multiplyDecimals(amount, normalizeDecimal(observation.price, "valuation_price"))
      : (() => { throw new PortfolioAggregationError(PORTFOLIO_ERROR_CODE.INVALID_OBSERVATION, "valuation_value_or_price_required"); })();
  return {
    value,
    currency: observation.currency.trim(),
    source: observation.authoritativeSource.trim(),
    observedAt: observation.observedAt,
    freshness: observation.freshness,
    ...(observation.assetId === undefined ? {} : { assetId: observation.assetId }),
    ...(observation.unit === undefined ? {} : { unit: observation.unit }),
  };
}

function branchHasData(branch: PortfolioBranch): boolean {
  return branch.assets.length > 0 && (branch.state === "observed" || branch.state === "partial");
}

function allKnownEmpty(branches: readonly PortfolioBranch[]): boolean {
  return branches.every((branch) => branch.state === "empty");
}

function overallState(
  branches: readonly PortfolioBranch[],
  valuation: PortfolioValuationSummary,
  total: PortfolioTotal | null,
): PortfolioBranchState {
  const hasData = branches.some(branchHasData);
  if (!hasData) {
    if (branches.some((branch) => branch.state === "loading")) return "loading";
    if (allKnownEmpty(branches)) return "empty";
    if (branches.some((branch) => branch.state === "unavailable")) return "unavailable";
    if (branches.some((branch) => branch.state === "stale")) return "stale";
    if (branches.some((branch) => branch.state === "unknown")) return "unknown";
    return "partial";
  }
  const branchIssue = branches.some((branch) => !["observed", "empty"].includes(branch.state));
  if (branchIssue || valuation.status !== "observed" || total === null || total.coverage !== "complete") return "partial";
  return "observed";
}

function deriveFreshness(
  branches: readonly PortfolioBranch[],
  valuation: PortfolioValuationSummary,
): PortfolioFreshness {
  if (branches.some((branch) => branch.freshness === "stale") || valuation.freshness === "stale") return "stale";
  if (branches.some((branch) => branch.freshness === "unknown") || valuation.freshness === "unknown") return "unknown";
  return "fresh";
}

export class PortfolioAggregationService {
  constructor(private readonly deps: PortfolioAggregationDependencies) {}

  async aggregate(input: AggregatePortfolioInput): Promise<ConnectedPortfolio> {
    const prismId = this.validatePrismId(input.prismId);
    const [base, starknet] = await Promise.all([
      this.buildPublicBranch(prismId, "BASE"),
      this.buildPublicBranch(prismId, "STARKNET"),
    ]);
    const privateBranch = await this.buildPrivateBranch(prismId, input.privacyWalletConsent ?? null);
    const branches = { BASE: base, STARKNET: starknet, STRK20: privateBranch } as const;
    const valuation = await this.valueBranches(prismId, [base, starknet, privateBranch]);
    const total = valuation.total;
    const state = overallState([base, starknet, privateBranch], valuation.summary, total);
    const observedAtValues = [
      base.observedAt,
      starknet.observedAt,
      privateBranch.observedAt,
      valuation.summary.observedAt,
    ].filter((value): value is number => value !== null);
    return {
      prismId,
      state,
      branches,
      total,
      valuation: valuation.summary,
      authoritativeSource: "derived_portfolio",
      observedAt: observedAtValues.length > 0 ? Math.max(...observedAtValues) : null,
      freshness: deriveFreshness([base, starknet, privateBranch], valuation.summary),
      coverage: total?.coverage ?? (state === "empty" ? "none" : "partial"),
    };
  }

  async getPortfolio(input: AggregatePortfolioInput): Promise<ConnectedPortfolio> {
    return this.aggregate(input);
  }

  private async buildPublicBranch(prismId: string, venue: PublicPortfolioVenue): Promise<PortfolioBranch> {
    let resolution: PublicAccountResolution;
    try {
      resolution = await this.deps.publicAccountResolver.resolve({ prismId, venue });
    } catch {
      return unavailableBranch(venue, PUBLIC_VISIBILITY, PORTFOLIO_ERROR_CODE.RESOLUTION_UNAVAILABLE, safeProviderDetail());
    }
    if (!resolution || resolution.venue !== venue || (resolution.state !== undefined && !PORTFOLIO_BRANCH_STATES.includes(resolution.state)) || !nonEmptyString(resolution.authoritativeSource) || !isFreshness(resolution.freshness) || !Number.isSafeInteger(resolution.observedAt) || resolution.observedAt < 0) {
      return unknownBranch(venue, PUBLIC_VISIBILITY, PORTFOLIO_ERROR_CODE.INVALID_OBSERVATION, "resolution_observation_invalid");
    }
    if (resolution.authority === "inferred" || resolution.authority === "unknown") {
      return unknownBranch(venue, PUBLIC_VISIBILITY, PORTFOLIO_ERROR_CODE.INFERRED_ACCOUNT_REJECTED, "explicit_binding_resolution_required");
    }
    if (resolution.state === "loading") {
      const branch = branchFromObservations(venue, "PUBLIC", PUBLIC_VISIBILITY, [], [], [], {
        source: resolution.authoritativeSource,
        observedAt: resolution.observedAt,
        freshness: "unknown",
        coverage: resolution.coverage,
      });
      return { ...branch, state: "loading", freshness: "unknown", account: null, accounts: [] };
    }
    const accounts = normalizeAccountResolution(resolution);
    if (resolution.freshness !== "fresh") {
      const branch = branchFromObservations(venue, "PUBLIC", PUBLIC_VISIBILITY, [], [], [], {
        source: resolution.authoritativeSource,
        observedAt: resolution.observedAt,
        freshness: resolution.freshness,
        coverage: resolution.coverage,
      });
      return { ...branch, state: resolution.freshness === "stale" ? "stale" : "unknown", account: null, accounts: [] };
    }
    if (accounts.length === 0) {
      const branch = branchFromObservations(venue, "PUBLIC", PUBLIC_VISIBILITY, [], [], [], {
        source: resolution.authoritativeSource,
        observedAt: resolution.observedAt,
        freshness: resolution.freshness,
        coverage: resolution.coverage,
      });
      return { ...branch, state: "empty", coverage: "none", account: null, accounts: [] };
    }
    const source = sourceForInternal(this.deps.publicBalanceSources, venue);
    if (!source) return unavailableBranch(venue, PUBLIC_VISIBILITY, PORTFOLIO_ERROR_CODE.BALANCE_UNAVAILABLE, "balance_source_unconfigured", {
      accounts,
      authoritativeSource: resolution.authoritativeSource,
      observedAt: resolution.observedAt,
      // The binding read is fresh, but the balance itself has not been
      // observed because its provider is missing.
      freshness: "unknown",
    });

    const settled = await Promise.allSettled(accounts.map((account) => source.observe({
      prismId,
      venue,
      address: account.address ?? account.account!,
      ...(account.bindingId ? { bindingId: account.bindingId } : {}),
    })));
    const observations: NormalizedObservation[] = [];
    const failures: PortfolioError[] = [];
    for (const result of settled) {
      if (result.status === "fulfilled") {
        try {
          observations.push(normalizeObservation(result.value));
        } catch (cause) {
          failures.push(cause instanceof PortfolioAggregationError ? cause.toExternalShape() : error(PORTFOLIO_ERROR_CODE.INVALID_OBSERVATION, "balance_observation_invalid"));
        }
      } else {
        failures.push(error(PORTFOLIO_ERROR_CODE.BALANCE_UNAVAILABLE, safeProviderDetail()));
      }
    }
    return branchFromObservations(venue, "PUBLIC", PUBLIC_VISIBILITY, accounts, observations, failures, {
      source: resolution.authoritativeSource,
      observedAt: resolution.observedAt,
      freshness: resolution.freshness,
      coverage: resolution.coverage,
    });
  }

  private async buildPrivateBranch(prismId: string, consent: PrivacyWalletConsent | null): Promise<PortfolioBranch> {
    if (!consent || consent.status !== "granted") {
      if (consent?.status === "denied") return unknownBranch("STRK20", PRIVATE_VISIBILITY("denied"), PORTFOLIO_ERROR_CODE.CONSENT_DENIED, "privacy_wallet_consent_denied");
      return unknownBranch("STRK20", PRIVATE_VISIBILITY(consent?.status === "required" ? "required" : "required"), PORTFOLIO_ERROR_CODE.CONSENT_REQUIRED, "privacy_wallet_consent_required");
    }
    const source = this.deps.privateBalanceSource;
    if (!source) return unavailableBranch("STRK20", PRIVATE_VISIBILITY("granted"), PORTFOLIO_ERROR_CODE.BALANCE_UNAVAILABLE, "private_balance_source_unconfigured");
    try {
      const observation = normalizeObservation(await source.observe({
        prismId,
        consent: { status: "granted", ...(consent.walletSessionRef ? { walletSessionRef: consent.walletSessionRef } : {}) },
      }));
      if (observation.consent !== undefined && observation.consent !== "granted") {
        const consentStatus = observation.consent === "denied" ? "denied" : "required";
        const code = consentStatus === "denied" ? PORTFOLIO_ERROR_CODE.CONSENT_DENIED : PORTFOLIO_ERROR_CODE.CONSENT_REQUIRED;
        return unknownBranch("STRK20", PRIVATE_VISIBILITY(consentStatus), code, consentStatus === "denied" ? "privacy_wallet_consent_denied" : "privacy_wallet_consent_required");
      }
      if (observation.assets.some(containsForbiddenPrivateMaterial)) {
        return unavailableBranch("STRK20", PRIVATE_VISIBILITY("granted"), PORTFOLIO_ERROR_CODE.INVALID_OBSERVATION, "private_balance_observation_invalid");
      }
      return branchFromObservations("STRK20", "PRIVATE", PRIVATE_VISIBILITY("granted"), [], [observation], [], {
        source: null,
        observedAt: null,
        freshness: "unknown",
      });
    } catch (cause) {
      // Never echo a provider-supplied private error detail. The private
      // branch exposes only a stable state/code; keys, notes, and proofs stay
      // wallet-owned even when the provider fails.
      const code = cause instanceof PortfolioAggregationError && cause.code === PORTFOLIO_ERROR_CODE.INVALID_OBSERVATION
        ? PORTFOLIO_ERROR_CODE.INVALID_OBSERVATION
        : PORTFOLIO_ERROR_CODE.BALANCE_UNAVAILABLE;
      const detail = code === PORTFOLIO_ERROR_CODE.INVALID_OBSERVATION
        ? "private_balance_observation_invalid"
        : safeProviderDetail();
      return unavailableBranch("STRK20", PRIVATE_VISIBILITY("granted"), code, detail);
    }
  }

  private async valueBranches(prismId: string, branches: readonly PortfolioBranch[]): Promise<{ summary: PortfolioValuationSummary; total: PortfolioTotal | null }> {
    const rawCandidates: { venue: PortfolioVenue; asset: PortfolioAsset }[] = [];
    const excludedAssets: ExcludedPortfolioAsset[] = [];
    for (const branch of branches) {
      for (const assetId of branch.incompatibleAssets) {
        excludedAssets.push({ venue: branch.venue, assetId, unit: "unknown", reason: "incompatible_asset_units" });
      }
      if (branch.assetUnitCompatibility !== "compatible") {
        for (const asset of branch.assets) {
          excludedAssets.push({ venue: branch.venue, assetId: asset.assetId, unit: asset.unit, reason: `asset_unit_compatibility_${branch.assetUnitCompatibility}` });
        }
        continue;
      }
      for (const asset of branch.assets) rawCandidates.push({ venue: branch.venue, asset });
    }
    // Asset identity is global to the projection. If one logical asset arrives
    // with different units across explicit venues, exclude every such item
    // rather than silently adding unlike quantities.
    const unitsByAsset = new Map<string, Set<string>>();
    for (const candidate of rawCandidates) {
      const units = unitsByAsset.get(candidate.asset.assetId) ?? new Set<string>();
      units.add(candidate.asset.unit);
      unitsByAsset.set(candidate.asset.assetId, units);
    }
    const globallyIncompatible = new Set([...unitsByAsset.entries()]
      .filter(([, units]) => units.size > 1)
      .map(([assetId]) => assetId));
    const candidates: { venue: PortfolioVenue; asset: PortfolioAsset }[] = [];
    for (const candidate of rawCandidates) {
      if (globallyIncompatible.has(candidate.asset.assetId)) {
        excludedAssets.push({ venue: candidate.venue, assetId: candidate.asset.assetId, unit: candidate.asset.unit, reason: "incompatible_asset_units" });
      } else {
        candidates.push(candidate);
      }
    }
    if (candidates.length === 0) {
      return {
        summary: {
          status: excludedAssets.length > 0 ? "unknown" : "not_requested",
          authoritativeSource: null,
          observedAt: null,
          freshness: "unknown",
          errors: excludedAssets.length > 0 ? [error(PORTFOLIO_ERROR_CODE.VALUATION_INCOMPATIBLE, "incompatible_asset_units")] : [],
        },
        total: null,
      };
    }
    const source = this.deps.valuationSource;
    if (!source) {
      const valuationError = error(PORTFOLIO_ERROR_CODE.VALUATION_UNAVAILABLE, "valuation_source_unconfigured");
      return {
        summary: { status: "unavailable", authoritativeSource: null, observedAt: null, freshness: "unknown", errors: [valuationError] },
        total: null,
      };
    }
    const read = source.value ?? source.getPrice;
    if (!read) {
      const valuationError = error(PORTFOLIO_ERROR_CODE.VALUATION_UNAVAILABLE, "valuation_source_unconfigured");
      return {
        summary: { status: "unavailable", authoritativeSource: null, observedAt: null, freshness: "unknown", errors: [valuationError] },
        total: null,
      };
    }
    const settled = await Promise.allSettled(candidates.map(({ venue, asset }) => read.call(source, {
      prismId,
      venue,
      asset,
      assetId: asset.assetId,
      unit: asset.unit,
      amount: asset.amount,
    })));
    const successes: ValuationSuccess[] = [];
    const errors: PortfolioError[] = [];
    let sawStale = false;
    let sawUnknown = false;
    for (let index = 0; index < settled.length; index += 1) {
      const candidate = candidates[index];
      const result = settled[index];
      if (result.status === "rejected") {
        errors.push(error(PORTFOLIO_ERROR_CODE.VALUATION_UNAVAILABLE, safeProviderDetail()));
        excludedAssets.push({ venue: candidate.venue, assetId: candidate.asset.assetId, unit: candidate.asset.unit, reason: "valuation_unavailable" });
        continue;
      }
      try {
        const observation = normalizeValuation(result.value, candidate.asset.amount);
        if (observation.assetId !== undefined && observation.assetId !== candidate.asset.assetId) {
          throw new PortfolioAggregationError(PORTFOLIO_ERROR_CODE.VALUATION_INCOMPATIBLE, "valuation_asset_mismatch");
        }
        if (observation.unit !== undefined && observation.unit !== candidate.asset.unit) {
          throw new PortfolioAggregationError(PORTFOLIO_ERROR_CODE.VALUATION_INCOMPATIBLE, "valuation_unit_mismatch");
        }
        if (observation.freshness === "stale") {
          sawStale = true;
          errors.push(error(PORTFOLIO_ERROR_CODE.VALUATION_STALE, "valuation_stale"));
          excludedAssets.push({ venue: candidate.venue, assetId: candidate.asset.assetId, unit: candidate.asset.unit, reason: "valuation_stale" });
          continue;
        }
        if (observation.freshness === "unknown") {
          sawUnknown = true;
          errors.push(error(PORTFOLIO_ERROR_CODE.VALUATION_UNAVAILABLE, "valuation_freshness_unknown"));
          excludedAssets.push({ venue: candidate.venue, assetId: candidate.asset.assetId, unit: candidate.asset.unit, reason: "valuation_freshness_unknown" });
          continue;
        }
        successes.push({ venue: candidate.venue, asset: candidate.asset, value: observation.value, currency: observation.currency, source: observation.source, observedAt: observation.observedAt });
      } catch (cause) {
        const mapped = cause instanceof PortfolioAggregationError ? cause.toExternalShape() : error(PORTFOLIO_ERROR_CODE.VALUATION_INCOMPATIBLE, "valuation_invalid");
        errors.push(mapped);
        excludedAssets.push({ venue: candidate.venue, assetId: candidate.asset.assetId, unit: candidate.asset.unit, reason: mapped.detail ?? mapped.code });
      }
    }
    const currencies = [...new Set(successes.map((success) => success.currency))];
    let included = successes;
    if (currencies.length > 1) {
      const currency = currencies[0];
      const incompatible = successes.filter((success) => success.currency !== currency);
      included = successes.filter((success) => success.currency === currency);
      for (const success of incompatible) {
        errors.push(error(PORTFOLIO_ERROR_CODE.VALUATION_INCOMPATIBLE, "valuation_currency_mismatch"));
        excludedAssets.push({ venue: success.venue, assetId: success.asset.assetId, unit: success.asset.unit, reason: "valuation_currency_mismatch" });
      }
    }
    const uniqueErrors = errors.filter((candidate, index) => errors.findIndex((entry) => entry.code === candidate.code && entry.detail === candidate.detail) === index);
    const observedAt = included.length > 0 ? Math.max(...included.map((success) => success.observedAt)) : null;
    const valuationSource = combineSourceNames(included.map((success) => success.source));
    const status: PortfolioValuationSummary["status"] = included.length === 0
      ? sawStale && !sawUnknown && errors.every((candidate) => candidate.code === PORTFOLIO_ERROR_CODE.VALUATION_STALE) ? "stale"
        : errors.length > 0 ? sawUnknown ? "unknown" : "unavailable"
          : "not_requested"
      : included.length === candidates.length && excludedAssets.length === 0 ? "observed" : "partial";
    const summary: PortfolioValuationSummary = {
      status,
      authoritativeSource: valuationSource,
      observedAt,
      freshness: sawStale ? "stale" : sawUnknown || included.length === 0 ? "unknown" : "fresh",
      errors: uniqueErrors,
    };
    if (included.length === 0) return { summary, total: null };
    const amount = included.reduce((sum, success) => addDecimals(sum, success.value), "0");
    const currency = included[0].currency;
    const branchCoverageComplete = branches.every((branch) => branch.state === "observed" || branch.state === "empty");
    const coverage: PortfolioCoverage = status === "observed" && branchCoverageComplete ? "complete" : "partial";
    const total: PortfolioTotal = {
      amount,
      currency,
      coverage,
      authoritativeSource: valuationSource ?? "injected_valuation_source",
      observedAt: observedAt!,
      freshness: "fresh",
      includedAssets: included.map((success): ValuedPortfolioAsset => ({
        venue: success.venue,
        assetId: success.asset.assetId,
        unit: success.asset.unit,
        value: success.value,
        currency: success.currency,
      })),
      excludedAssets: [...excludedAssets],
    };
    return { summary, total };
  }

  private validatePrismId(value: string): string {
    const prismId = typeof value === "string" ? value.trim() : "";
    if (!/^prism:[0-9A-Za-z]{1,64}$/.test(prismId)) {
      throw new PortfolioAggregationError(PORTFOLIO_ERROR_CODE.INVALID_PRISM_ID, "malformed_prism_id");
    }
    return prismId;
  }
}

export const ConnectedPortfolioService = PortfolioAggregationService;
export async function aggregateConnectedPortfolio(
  deps: PortfolioAggregationDependencies,
  input: AggregatePortfolioInput,
): Promise<ConnectedPortfolio> {
  return new PortfolioAggregationService(deps).aggregate(input);
}
