import { describe, expect, it, vi } from "vitest";
import { PortfolioAggregationService } from "../application/portfolio-service";

const OBSERVED_AT = 1_789_000_000;

function publicResolution(venue: "BASE" | "STARKNET", address: string) {
  return {
    venue,
    accounts: [{ address, bindingId: `binding-${venue.toLowerCase()}` }],
    authoritativeSource: `${venue.toLowerCase()}_binding_resolution`,
    observedAt: OBSERVED_AT,
    freshness: "fresh" as const,
  };
}

describe("PortfolioAggregationService", () => {
  it("aggregates explicitly resolved Base, Starknet, and consented STRK20 observations", async () => {
    const resolve = vi.fn(async ({ venue }: { venue: "BASE" | "STARKNET" }) =>
      venue === "BASE"
        ? publicResolution(venue, "0xbase-account")
        : publicResolution(venue, "0xstarknet-account"),
    );
    const baseObserve = vi.fn(async () => ({
      assets: [{ assetId: "eth", unit: "ETH", amount: "2" }],
      authoritativeSource: "base_rpc",
      observedAt: OBSERVED_AT,
      freshness: "fresh" as const,
      coverage: "complete" as const,
    }));
    const starknetObserve = vi.fn(async () => ({
      assets: [{ assetId: "strk", unit: "STRK", amount: "5" }],
      authoritativeSource: "starknet_rpc",
      observedAt: OBSERVED_AT,
      freshness: "fresh" as const,
      coverage: "complete" as const,
    }));
    const privateObserve = vi.fn(async () => ({
      assets: [{ assetId: "private-strk", unit: "STRK", amount: "1" }],
      authoritativeSource: "privacy_wallet",
      observedAt: OBSERVED_AT,
      freshness: "fresh" as const,
      coverage: "complete" as const,
    }));
    const value = vi.fn(async ({ assetId }: { assetId: string }) => ({
      currency: "USD",
      value: assetId === "eth" ? "300" : assetId === "strk" ? "700" : "100",
      authoritativeSource: "price-oracle",
      observedAt: OBSERVED_AT,
      freshness: "fresh" as const,
    }));

    const service = new PortfolioAggregationService({
      publicAccountResolver: { resolve },
      publicBalanceSources: {
        BASE: { observe: baseObserve },
        STARKNET: { observe: starknetObserve },
      },
      privateBalanceSource: { observe: privateObserve },
      valuationSource: { value },
    });

    const portfolio = await service.aggregate({
      prismId: "prism:P7F21",
      privacyWalletConsent: { status: "granted", walletSessionRef: "wallet-session-opaque" },
    });

    expect(resolve).toHaveBeenCalledTimes(2);
    expect(baseObserve).toHaveBeenCalledWith(expect.objectContaining({ address: "0xbase-account" }));
    expect(starknetObserve).toHaveBeenCalledWith(expect.objectContaining({ address: "0xstarknet-account" }));
    expect(privateObserve).toHaveBeenCalledWith(expect.objectContaining({
      prismId: "prism:P7F21",
      consent: { status: "granted", walletSessionRef: "wallet-session-opaque" },
    }));
    expect(portfolio.branches.BASE.state).toBe("observed");
    expect(portfolio.branches.STARKNET.state).toBe("observed");
    expect(portfolio.branches.STRK20.state).toBe("observed");
    expect(portfolio.total).toMatchObject({ amount: "1100", currency: "USD", coverage: "complete" });
  });

  it("does not read or expose private STRK20 balances without explicit wallet consent", async () => {
    const privateObserve = vi.fn(async () => ({
      assets: [{ assetId: "private-strk", unit: "STRK", amount: "99" }],
      authoritativeSource: "privacy_wallet",
      observedAt: OBSERVED_AT,
      freshness: "fresh" as const,
      coverage: "complete" as const,
    }));
    const service = new PortfolioAggregationService({
      publicAccountResolver: { resolve: async ({ venue }) => publicResolution(venue, `0x${venue.toLowerCase()}`) },
      publicBalanceSources: {
        BASE: { observe: async () => ({ assets: [], authoritativeSource: "base_rpc", observedAt: OBSERVED_AT, freshness: "fresh" as const }) },
        STARKNET: { observe: async () => ({ assets: [], authoritativeSource: "starknet_rpc", observedAt: OBSERVED_AT, freshness: "fresh" as const }) },
      },
      privateBalanceSource: { observe: privateObserve },
      valuationSource: { value: async () => ({ value: "99", currency: "USD", authoritativeSource: "oracle", observedAt: OBSERVED_AT, freshness: "fresh" as const }) },
    });

    const portfolio = await service.aggregate({ prismId: "prism:P7F21" });

    expect(privateObserve).not.toHaveBeenCalled();
    expect(portfolio.branches.STRK20.state).toBe("unknown");
    expect(portfolio.branches.STRK20.privacy.consent).toBe("required");
    expect(portfolio.branches.STRK20.assets).toEqual([]);
    expect(JSON.stringify(portfolio)).not.toContain("99");
  });

  it("reports an explicitly resolved venue with no holdings as empty", async () => {
    const value = vi.fn();
    const service = new PortfolioAggregationService({
      publicAccountResolver: { resolve: async ({ venue }) => ({
        ...publicResolution(venue, `0x${venue.toLowerCase()}`),
        accounts: [],
      }) },
      publicBalanceSources: {
        BASE: { observe: vi.fn() },
        STARKNET: { observe: vi.fn() },
      },
      privateBalanceSource: { observe: async () => ({
        assets: [],
        authoritativeSource: "privacy_wallet",
        observedAt: OBSERVED_AT,
        freshness: "fresh" as const,
      }) },
      valuationSource: { value },
    });

    const portfolio = await service.aggregate({
      prismId: "prism:P7F21",
      privacyWalletConsent: { status: "granted" },
    });

    expect(portfolio.branches.BASE.state).toBe("empty");
    expect(portfolio.branches.STARKNET.state).toBe("empty");
    expect(portfolio.branches.STRK20.state).toBe("empty");
    expect(portfolio.state).toBe("empty");
    expect(portfolio.total).toBeNull();
    expect(value).not.toHaveBeenCalled();
  });

  it("refuses stale balance observations and does not include their values", async () => {
    const baseObserve = vi.fn(async () => ({
      assets: [{ assetId: "eth", unit: "ETH", amount: "2" }],
      authoritativeSource: "base_rpc",
      observedAt: OBSERVED_AT - 100,
      freshness: "stale" as const,
    }));
    const value = vi.fn(async () => ({
      value: "300",
      currency: "USD",
      authoritativeSource: "oracle",
      observedAt: OBSERVED_AT,
      freshness: "fresh" as const,
    }));
    const service = new PortfolioAggregationService({
      publicAccountResolver: { resolve: async ({ venue }) => publicResolution(venue, `0x${venue.toLowerCase()}`) },
      publicBalanceSources: {
        BASE: { observe: baseObserve },
        STARKNET: { observe: async () => ({ assets: [], authoritativeSource: "starknet_rpc", observedAt: OBSERVED_AT, freshness: "fresh" as const }) },
      },
      privateBalanceSource: { observe: async () => ({ assets: [], authoritativeSource: "privacy_wallet", observedAt: OBSERVED_AT, freshness: "fresh" as const }) },
      valuationSource: { value },
    });

    const portfolio = await service.aggregate({ prismId: "prism:P7F21", privacyWalletConsent: { status: "granted" } });

    expect(baseObserve).toHaveBeenCalledOnce();
    expect(portfolio.branches.BASE.state).toBe("stale");
    expect(portfolio.branches.BASE.assets).toEqual([]);
    expect(value).not.toHaveBeenCalled();
    expect(portfolio.total).toBeNull();
  });

  it("keeps a partial branch and partial total when one explicit account provider fails", async () => {
    const service = new PortfolioAggregationService({
      publicAccountResolver: { resolve: async ({ venue }) => venue === "BASE"
        ? { ...publicResolution(venue, "0xbase-one"), accounts: [{ address: "0xbase-one", bindingId: "b1" }, { address: "0xbase-two", bindingId: "b2" }] }
        : { ...publicResolution(venue, "0xstarknet"), accounts: [] } },
      publicBalanceSources: {
        BASE: { observe: vi.fn(async ({ address }) => {
          if (address === "0xbase-two") throw new Error("rpc token leaked must not escape");
          return { assets: [{ assetId: "eth", unit: "ETH", amount: "1" }], authoritativeSource: "base_rpc", observedAt: OBSERVED_AT, freshness: "fresh" as const };
        }) },
        STARKNET: { observe: vi.fn() },
      },
      privateBalanceSource: { observe: async () => ({ assets: [], authoritativeSource: "privacy_wallet", observedAt: OBSERVED_AT, freshness: "fresh" as const }) },
      valuationSource: { value: async () => ({ value: "300", currency: "USD", authoritativeSource: "oracle", observedAt: OBSERVED_AT, freshness: "fresh" as const }) },
    });

    const portfolio = await service.aggregate({ prismId: "prism:P7F21", privacyWalletConsent: { status: "granted" } });

    expect(portfolio.branches.BASE.state).toBe("partial");
    expect(portfolio.branches.BASE.assets).toEqual([{ assetId: "eth", unit: "ETH", amount: "1" }]);
    expect(portfolio.branches.BASE.error?.code).toBe("PORTFOLIO_BALANCE_UNAVAILABLE");
    expect(portfolio.total).toMatchObject({ amount: "300", coverage: "partial" });
    expect(portfolio.state).toBe("partial");
    expect(JSON.stringify(portfolio)).not.toContain("rpc token leaked");
  });

  it("reports an unavailable branch when its balance source is not configured", async () => {
    const service = new PortfolioAggregationService({
      publicAccountResolver: { resolve: async ({ venue }) => publicResolution(venue, `0x${venue.toLowerCase()}`) },
      publicBalanceSources: {
        BASE: { observe: async () => ({ assets: [], authoritativeSource: "base_rpc", observedAt: OBSERVED_AT, freshness: "fresh" as const }) },
      },
      privateBalanceSource: { observe: async () => ({ assets: [], authoritativeSource: "privacy_wallet", observedAt: OBSERVED_AT, freshness: "fresh" as const }) },
    });

    const portfolio = await service.aggregate({ prismId: "prism:P7F21", privacyWalletConsent: { status: "granted" } });

    expect(portfolio.branches.STARKNET.state).toBe("unavailable");
    expect(portfolio.branches.STARKNET.error?.detail).toBe("balance_source_unconfigured");
    expect(portfolio.branches.STARKNET.freshness).toBe("unknown");
    expect(portfolio.state).toBe("unavailable");
  });

  it("does not combine balances with incompatible units", async () => {
    const value = vi.fn();
    const service = new PortfolioAggregationService({
      publicAccountResolver: { resolve: async ({ venue }) => venue === "BASE"
        ? publicResolution(venue, "0xbase")
        : { ...publicResolution(venue, "0xstarknet"), accounts: [] } },
      publicBalanceSources: {
        BASE: { observe: async () => ({
          assets: [
            { assetId: "eth", unit: "ETH", amount: "1" },
            { assetId: "eth", unit: "wei", amount: "100" },
          ],
          authoritativeSource: "base_rpc",
          observedAt: OBSERVED_AT,
          freshness: "fresh" as const,
        }) },
        STARKNET: { observe: vi.fn() },
      },
      privateBalanceSource: { observe: async () => ({ assets: [], authoritativeSource: "privacy_wallet", observedAt: OBSERVED_AT, freshness: "fresh" as const }) },
      valuationSource: { value },
    });

    const portfolio = await service.aggregate({ prismId: "prism:P7F21", privacyWalletConsent: { status: "granted" } });

    expect(portfolio.branches.BASE.assetUnitCompatibility).toBe("incompatible");
    expect(portfolio.branches.BASE.incompatibleAssets).toEqual(["eth"]);
    expect(portfolio.branches.BASE.assets).toEqual([]);
    expect(value).not.toHaveBeenCalled();
    expect(portfolio.total).toBeNull();
  });

  it("does not fabricate a total when valuation fails", async () => {
    const value = vi.fn(async () => { throw new Error("oracle credentials must not escape"); });
    const service = new PortfolioAggregationService({
      publicAccountResolver: { resolve: async ({ venue }) => venue === "BASE"
        ? publicResolution(venue, "0xbase")
        : { ...publicResolution(venue, "0xstarknet"), accounts: [] } },
      publicBalanceSources: {
        BASE: { observe: async () => ({ assets: [{ assetId: "eth", unit: "ETH", amount: "2" }], authoritativeSource: "base_rpc", observedAt: OBSERVED_AT, freshness: "fresh" as const }) },
        STARKNET: { observe: vi.fn() },
      },
      privateBalanceSource: { observe: async () => ({ assets: [], authoritativeSource: "privacy_wallet", observedAt: OBSERVED_AT, freshness: "fresh" as const }) },
      valuationSource: { value },
    });

    const portfolio = await service.aggregate({ prismId: "prism:P7F21", privacyWalletConsent: { status: "granted" } });

    expect(value).toHaveBeenCalledOnce();
    expect(portfolio.branches.BASE.state).toBe("observed");
    expect(portfolio.valuation.status).toBe("unavailable");
    expect(portfolio.total).toBeNull();
    expect(portfolio.state).toBe("partial");
    expect(JSON.stringify(portfolio)).not.toContain("oracle credentials");
  });

  it("rejects inferred public account ownership instead of querying it", async () => {
    const baseObserve = vi.fn();
    const service = new PortfolioAggregationService({
      publicAccountResolver: { resolve: async ({ venue }) => ({
        ...publicResolution(venue, "0xsame-address"),
        authority: "inferred" as const,
      }) },
      publicBalanceSources: {
        BASE: { observe: baseObserve },
        STARKNET: { observe: vi.fn() },
      },
    });

    const portfolio = await service.aggregate({ prismId: "prism:P7F21" });

    expect(baseObserve).not.toHaveBeenCalled();
    expect(portfolio.branches.BASE.state).toBe("unknown");
    expect(portfolio.branches.BASE.error?.code).toBe("PORTFOLIO_INFERRED_ACCOUNT_REJECTED");
    expect(portfolio.branches.STARKNET.error?.code).toBe("PORTFOLIO_INFERRED_ACCOUNT_REJECTED");
  });

  it("returns consented private balances without copying notes, keys, or raw proofs", async () => {
    const privateObserve = vi.fn(async () => ({
      assets: [{ assetId: "private-strk", unit: "STRK", amount: "3" }],
      authoritativeSource: "privacy_wallet",
      observedAt: OBSERVED_AT,
      freshness: "fresh" as const,
      // Provider extensions are intentionally not part of the projection.
      viewingKey: "secret viewing key",
      notes: [{ rawProof: "private proof" }],
    } as never));
    const service = new PortfolioAggregationService({
      publicAccountResolver: { resolve: async ({ venue }) => ({ ...publicResolution(venue, `0x${venue.toLowerCase()}`), accounts: [] }) },
      publicBalanceSources: {
        BASE: { observe: async () => ({ assets: [], authoritativeSource: "base_rpc", observedAt: OBSERVED_AT, freshness: "fresh" as const }) },
        STARKNET: { observe: async () => ({ assets: [], authoritativeSource: "starknet_rpc", observedAt: OBSERVED_AT, freshness: "fresh" as const }) },
      },
      privateBalanceSource: { observe: privateObserve },
    });

    const portfolio = await service.aggregate({ prismId: "prism:P7F21", privacyWalletConsent: { status: "granted" } });

    expect(privateObserve).toHaveBeenCalledOnce();
    expect(portfolio.branches.STRK20.assets).toEqual([{ assetId: "private-strk", unit: "STRK", amount: "3" }]);
    expect(portfolio.branches.STRK20).not.toHaveProperty("viewingKey");
    expect(portfolio.branches.STRK20).not.toHaveProperty("notes");
    expect(JSON.stringify(portfolio)).not.toContain("secret viewing key");
    expect(JSON.stringify(portfolio)).not.toContain("private proof");
  });

  it("does not query a public balance source when binding resolution is stale", async () => {
    const baseObserve = vi.fn();
    const service = new PortfolioAggregationService({
      publicAccountResolver: { resolve: async ({ venue }) => venue === "BASE"
        ? { ...publicResolution(venue, "0xbase"), freshness: "stale" as const }
        : { ...publicResolution(venue, "0xstarknet"), accounts: [] } },
      publicBalanceSources: {
        BASE: { observe: baseObserve },
        STARKNET: { observe: vi.fn() },
      },
    });

    const portfolio = await service.aggregate({ prismId: "prism:P7F21" });

    expect(baseObserve).not.toHaveBeenCalled();
    expect(portfolio.branches.BASE.state).toBe("stale");
    expect(portfolio.branches.BASE.authoritativeSource).toBe("base_binding_resolution");
    expect(portfolio.branches.BASE.observedAt).toBe(OBSERVED_AT);
    expect(portfolio.branches.BASE.accounts).toEqual([]);
  });

  it("preserves a loading state from an in-flight public resolution", async () => {
    const baseObserve = vi.fn();
    const service = new PortfolioAggregationService({
      publicAccountResolver: { resolve: async ({ venue }) => venue === "BASE"
        ? ({ ...publicResolution(venue, "0xbase"), state: "loading" as const, freshness: "unknown" as const } as never)
        : { ...publicResolution(venue, "0xstarknet"), accounts: [] } },
      publicBalanceSources: {
        BASE: { observe: baseObserve },
        STARKNET: { observe: vi.fn() },
      },
    });

    const portfolio = await service.aggregate({ prismId: "prism:P7F21" });

    expect(baseObserve).not.toHaveBeenCalled();
    expect(portfolio.branches.BASE.state).toBe("loading");
    expect(portfolio.branches.BASE.assets).toEqual([]);
  });

  it("keeps denied privacy-wallet consent explicit and never calls the private source", async () => {
    const privateObserve = vi.fn();
    const service = new PortfolioAggregationService({
      publicAccountResolver: { resolve: async ({ venue }) => ({ ...publicResolution(venue, `0x${venue.toLowerCase()}`), accounts: [] }) },
      publicBalanceSources: {},
      privateBalanceSource: { observe: privateObserve },
    });

    const portfolio = await service.aggregate({
      prismId: "prism:P7F21",
      privacyWalletConsent: { status: "denied" },
    });

    expect(privateObserve).not.toHaveBeenCalled();
    expect(portfolio.branches.STRK20.state).toBe("unknown");
    expect(portfolio.branches.STRK20.privacy).toEqual({ visibility: "PRIVATE", consent: "denied" });
    expect(portfolio.branches.STRK20.error?.code).toBe("PORTFOLIO_CONSENT_DENIED");
    expect(portfolio.branches.STRK20.assets).toEqual([]);
  });

  it("does not combine the same asset identity across venues when units disagree", async () => {
    const value = vi.fn();
    const service = new PortfolioAggregationService({
      publicAccountResolver: { resolve: async ({ venue }) => publicResolution(venue, `0x${venue.toLowerCase()}`) },
      publicBalanceSources: {
        BASE: { observe: async () => ({ assets: [{ assetId: "token", unit: "BASE_UNITS", amount: "1" }], authoritativeSource: "base_rpc", observedAt: OBSERVED_AT, freshness: "fresh" as const }) },
        STARKNET: { observe: async () => ({ assets: [{ assetId: "token", unit: "STARKNET_UNITS", amount: "2" }], authoritativeSource: "starknet_rpc", observedAt: OBSERVED_AT, freshness: "fresh" as const }) },
      },
      privateBalanceSource: { observe: async () => ({ assets: [], authoritativeSource: "privacy_wallet", observedAt: OBSERVED_AT, freshness: "fresh" as const }) },
      valuationSource: { value },
    });

    const portfolio = await service.aggregate({ prismId: "prism:P7F21", privacyWalletConsent: { status: "granted" } });

    expect(portfolio.branches.BASE.assets).toHaveLength(1);
    expect(portfolio.branches.STARKNET.assets).toHaveLength(1);
    expect(value).not.toHaveBeenCalled();
    expect(portfolio.valuation.status).toBe("unknown");
    expect(portfolio.total).toBeNull();
  });

  it("marks a stale valuation and excludes it from the total", async () => {
    const service = new PortfolioAggregationService({
      publicAccountResolver: { resolve: async ({ venue }) => venue === "BASE"
        ? publicResolution(venue, "0xbase")
        : { ...publicResolution(venue, "0xstarknet"), accounts: [] } },
      publicBalanceSources: {
        BASE: { observe: async () => ({ assets: [{ assetId: "eth", unit: "ETH", amount: "2" }], authoritativeSource: "base_rpc", observedAt: OBSERVED_AT, freshness: "fresh" as const }) },
        STARKNET: { observe: vi.fn() },
      },
      privateBalanceSource: { observe: async () => ({ assets: [], authoritativeSource: "privacy_wallet", observedAt: OBSERVED_AT, freshness: "fresh" as const }) },
      valuationSource: { value: async () => ({ value: "300", currency: "USD", authoritativeSource: "oracle", observedAt: OBSERVED_AT - 100, freshness: "stale" as const }) },
    });

    const portfolio = await service.aggregate({ prismId: "prism:P7F21", privacyWalletConsent: { status: "granted" } });

    expect(portfolio.valuation.status).toBe("stale");
    expect(portfolio.valuation.freshness).toBe("stale");
    expect(portfolio.total).toBeNull();
  });

  it("uses unknown rather than empty or unavailable for malformed provider observations", async () => {
    const service = new PortfolioAggregationService({
      publicAccountResolver: { resolve: async ({ venue }) => venue === "BASE"
        ? publicResolution(venue, "0xbase")
        : { ...publicResolution(venue, "0xstarknet"), accounts: [] } },
      publicBalanceSources: {
        BASE: { observe: async () => ({ assets: [{ assetId: "eth", unit: "ETH", amount: "2" }], authoritativeSource: "", observedAt: OBSERVED_AT, freshness: "fresh" as const }) },
        STARKNET: { observe: vi.fn() },
      },
      privateBalanceSource: { observe: async () => ({ assets: [], authoritativeSource: "privacy_wallet", observedAt: OBSERVED_AT, freshness: "fresh" as const }) },
    });

    const portfolio = await service.aggregate({ prismId: "prism:P7F21", privacyWalletConsent: { status: "granted" } });

    expect(portfolio.branches.BASE.state).toBe("unknown");
    expect(portfolio.branches.BASE.error?.code).toBe("PORTFOLIO_INVALID_OBSERVATION");
    expect(portfolio.branches.BASE.assets).toEqual([]);
  });

  it("preserves an explicit loading state without valuing incomplete data", async () => {
    const value = vi.fn();
    const service = new PortfolioAggregationService({
      publicAccountResolver: { resolve: async ({ venue }) => venue === "BASE"
        ? publicResolution(venue, "0xbase")
        : { ...publicResolution(venue, "0xstarknet"), accounts: [] } },
      publicBalanceSources: {
        BASE: { observe: async () => ({
          state: "loading",
          assets: [],
          authoritativeSource: "base_rpc",
          observedAt: OBSERVED_AT,
          freshness: "unknown" as const,
        } as never) },
        STARKNET: { observe: vi.fn() },
      },
      privateBalanceSource: { observe: async () => ({ assets: [], authoritativeSource: "privacy_wallet", observedAt: OBSERVED_AT, freshness: "fresh" as const }) },
      valuationSource: { value },
    });

    const portfolio = await service.aggregate({ prismId: "prism:P7F21", privacyWalletConsent: { status: "granted" } });

    expect(portfolio.branches.BASE.state).toBe("loading");
    expect(portfolio.state).toBe("loading");
    expect(portfolio.branches.BASE.assets).toEqual([]);
    expect(value).not.toHaveBeenCalled();
  });

  it("supports an injected per-unit price source without hard-coding valuation", async () => {
    const getPrice = vi.fn(async () => ({
      price: "50",
      currency: "USD",
      authoritativeSource: "price-oracle",
      observedAt: OBSERVED_AT,
      freshness: "fresh" as const,
    }));
    const service = new PortfolioAggregationService({
      publicAccountResolver: { resolve: async ({ venue }) => venue === "BASE"
        ? publicResolution(venue, "0xbase")
        : { ...publicResolution(venue, "0xstarknet"), accounts: [] } },
      publicBalanceSources: {
        BASE: { observe: async () => ({ assets: [{ assetId: "eth", unit: "ETH", amount: "2" }], authoritativeSource: "base_rpc", observedAt: OBSERVED_AT, freshness: "fresh" as const }) },
        STARKNET: { observe: vi.fn() },
      },
      privateBalanceSource: { observe: async () => ({ assets: [], authoritativeSource: "privacy_wallet", observedAt: OBSERVED_AT, freshness: "fresh" as const }) },
      valuationSource: { getPrice } as never,
    });

    const portfolio = await service.aggregate({ prismId: "prism:P7F21", privacyWalletConsent: { status: "granted" } });

    expect(getPrice).toHaveBeenCalledOnce();
    expect(portfolio.total).toMatchObject({ amount: "100", currency: "USD" });
  });

  it("does not value assets when the balance provider declares unit compatibility unknown", async () => {
    const value = vi.fn();
    const service = new PortfolioAggregationService({
      publicAccountResolver: { resolve: async ({ venue }) => venue === "BASE"
        ? publicResolution(venue, "0xbase")
        : { ...publicResolution(venue, "0xstarknet"), accounts: [] } },
      publicBalanceSources: {
        BASE: { observe: async () => ({
          assets: [{ assetId: "eth", unit: "ETH", amount: "2" }],
          authoritativeSource: "base_rpc",
          observedAt: OBSERVED_AT,
          freshness: "fresh" as const,
          assetUnitCompatibility: "unknown" as const,
        }) },
        STARKNET: { observe: vi.fn() },
      },
      privateBalanceSource: { observe: async () => ({ assets: [], authoritativeSource: "privacy_wallet", observedAt: OBSERVED_AT, freshness: "fresh" as const }) },
      valuationSource: { value },
    });

    const portfolio = await service.aggregate({ prismId: "prism:P7F21", privacyWalletConsent: { status: "granted" } });

    expect(portfolio.branches.BASE.assetUnitCompatibility).toBe("unknown");
    expect(portfolio.branches.BASE.assets).toEqual([{ assetId: "eth", unit: "ETH", amount: "2" }]);
    expect(value).not.toHaveBeenCalled();
    expect(portfolio.total).toBeNull();
  });

  it("does not project private balances when the wallet reports consent denied", async () => {
    const privateObserve = vi.fn(async () => ({
      assets: [{ assetId: "private-strk", unit: "STRK", amount: "7" }],
      consent: "denied",
      authoritativeSource: "privacy_wallet",
      observedAt: OBSERVED_AT,
      freshness: "fresh" as const,
    } as never));
    const service = new PortfolioAggregationService({
      publicAccountResolver: { resolve: async ({ venue }) => ({ ...publicResolution(venue, `0x${venue.toLowerCase()}`), accounts: [] }) },
      publicBalanceSources: {},
      privateBalanceSource: { observe: privateObserve },
    });

    const portfolio = await service.aggregate({ prismId: "prism:P7F21", privacyWalletConsent: { status: "granted" } });

    expect(privateObserve).toHaveBeenCalledOnce();
    expect(portfolio.branches.STRK20.state).toBe("unknown");
    expect(portfolio.branches.STRK20.privacy.consent).toBe("denied");
    expect(portfolio.branches.STRK20.assets).toEqual([]);
  });

  it("projects wallet balance observations through the asset allow-list", async () => {
    const privateObserve = vi.fn(async () => ({
      balances: [{ token: "private-strk-token", amount: 2n }],
      consent: "granted",
      authoritativeSource: "privacy_wallet",
      observedAt: OBSERVED_AT,
      freshness: "fresh" as const,
    } as never));
    const service = new PortfolioAggregationService({
      publicAccountResolver: { resolve: async ({ venue }) => ({ ...publicResolution(venue, `0x${venue.toLowerCase()}`), accounts: [] }) },
      publicBalanceSources: {},
      privateBalanceSource: { observe: privateObserve },
    });

    const portfolio = await service.aggregate({ prismId: "prism:P7F21", privacyWalletConsent: { status: "granted" } });

    expect(portfolio.branches.STRK20.state).toBe("observed");
    expect(portfolio.branches.STRK20.assets).toEqual([{ assetId: "private-strk-token", unit: "base-unit", amount: "2" }]);
  });

  it("fails closed if private provider data tries to put key material in an asset field", async () => {
    const privateObserve = vi.fn(async () => ({
      assets: [{ assetId: "viewingKey", unit: "STRK", amount: "7" }],
      authoritativeSource: "privacy_wallet",
      observedAt: OBSERVED_AT,
      freshness: "fresh" as const,
    }));
    const service = new PortfolioAggregationService({
      publicAccountResolver: { resolve: async ({ venue }) => ({ ...publicResolution(venue, `0x${venue.toLowerCase()}`), accounts: [] }) },
      publicBalanceSources: {},
      privateBalanceSource: { observe: privateObserve },
    });

    const portfolio = await service.aggregate({ prismId: "prism:P7F21", privacyWalletConsent: { status: "granted" } });

    expect(portfolio.branches.STRK20.state).toBe("unavailable");
    expect(portfolio.branches.STRK20.assets).toEqual([]);
    expect(JSON.stringify(portfolio)).not.toContain("viewingKey");
  });
});
