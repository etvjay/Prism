import { describe, expect, it, vi } from "vitest";
import { createPrismApiHandlers, PORTFOLIO_API_CONTRACTS } from "../handlers";
import type { ConnectedPortfolio } from "../../features/prism-portfolio/domain/types";
import { PortfolioAggregationService } from "../../features/prism-portfolio/application/portfolio-service";
import { createIsolatedFactory } from "../factory";

const OBSERVED_AT = 1_789_000_000;

const portfolio: ConnectedPortfolio = {
  prismId: "prism:P7F21",
  state: "empty",
  branches: {
    BASE: {
      venue: "BASE",
      visibility: "PUBLIC",
      accounts: [],
      account: null,
      assets: [],
      state: "empty",
      authoritativeSource: "base_binding_resolution",
      observedAt: 1_789_000_000,
      freshness: "fresh",
      coverage: "none",
      coverageDetail: { requested: null, observed: 0, omitted: [] },
      assetUnitCompatibility: "unknown",
      incompatibleAssets: [],
      privacy: { visibility: "PUBLIC", consent: "not_applicable" },
      error: null,
    },
    STARKNET: {
      venue: "STARKNET",
      visibility: "PUBLIC",
      accounts: [],
      account: null,
      assets: [],
      state: "empty",
      authoritativeSource: "starknet_binding_resolution",
      observedAt: 1_789_000_000,
      freshness: "fresh",
      coverage: "none",
      coverageDetail: { requested: null, observed: 0, omitted: [] },
      assetUnitCompatibility: "unknown",
      incompatibleAssets: [],
      privacy: { visibility: "PUBLIC", consent: "not_applicable" },
      error: null,
    },
    STRK20: {
      venue: "STRK20",
      visibility: "PRIVATE",
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
      privacy: { visibility: "PRIVATE", consent: "required" },
      error: { code: "PORTFOLIO_CONSENT_REQUIRED" },
    },
  },
  total: null,
  valuation: { status: "not_requested", authoritativeSource: null, observedAt: null, freshness: "unknown", errors: [] },
  authoritativeSource: "derived_portfolio",
  observedAt: 1_789_000_000,
  freshness: "unknown",
  coverage: "partial",
};

describe("portfolio application handler", () => {
  it("delegates portfolio reads and exposes the additive API contract", async () => {
    const aggregate = vi.fn(async () => portfolio);
    const handlers = createPrismApiHandlers({} as never, {
      portfolioService: { aggregate, getPortfolio: aggregate },
    });

    const response = await handlers.getPortfolio({
      payload: { prismId: "prism:P7F21" },
      headers: { requestId: "portfolio-request" },
    });

    expect(response).toEqual({ ok: true, data: portfolio, requestId: "portfolio-request" });
    expect(aggregate).toHaveBeenCalledWith({ prismId: "prism:P7F21", privacyWalletConsent: undefined });
    expect(PORTFOLIO_API_CONTRACTS).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "GET", path: "/v1/portfolio/:prismId", handler: "getPortfolio" }),
    ]));
  });

  it("allows isolated factories to inject the portfolio projector without creating a fake default", async () => {
    const service = new PortfolioAggregationService({
      publicAccountResolver: { resolve: async ({ venue }) => ({
        venue,
        accounts: [],
        authoritativeSource: `${venue.toLowerCase()}_binding_resolution`,
        observedAt: OBSERVED_AT,
        freshness: "fresh",
      }) },
      publicBalanceSources: {},
    });
    const factory = createIsolatedFactory(OBSERVED_AT, { portfolioService: service, submitPortRegistryVersion: "v1" });
    try {
      const response = await factory.handlers.getPortfolio({ payload: { prismId: "prism:P7F21" } });
      expect(response).toMatchObject({ ok: true, data: { state: "unknown" } });
    } finally {
      await factory.shutdown();
    }
  });

  it("accepts a read-only portfolio port that exposes getPortfolio as its canonical method", async () => {
    const getPortfolio = vi.fn(async () => portfolio);
    const handlers = createPrismApiHandlers({} as never, {
      portfolioService: { getPortfolio } as never,
    });

    const response = await handlers.getPortfolio({ payload: { prismId: "prism:P7F21" } });

    expect(response).toMatchObject({ ok: true, data: portfolio });
    expect(getPortfolio).toHaveBeenCalledWith({ prismId: "prism:P7F21", privacyWalletConsent: undefined });
  });
});
