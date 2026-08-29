import { describe, expect, it, vi } from "vitest";
import { getAppFactory } from "@/application/factory";
import { GET as portfolioGet } from "../portfolio/[prismId]/route";

vi.mock("@/application/factory", () => ({ getAppFactory: vi.fn() }));

describe("portfolio REST route", () => {
  it("passes no private consent by default", async () => {
    const getPortfolio = vi.fn(async () => ({ ok: true, data: { state: "empty" } }));
    vi.mocked(getAppFactory).mockResolvedValue({ handlers: { getPortfolio } } as never);

    const response = await portfolioGet(
      new Request("http://localhost/api/v1/portfolio/prism%3AP7F21", { headers: { "x-request-id": "request-1" } }),
      { params: Promise.resolve({ prismId: "prism%3AP7F21" }) },
    );

    expect(response.status).toBe(200);
    expect(getPortfolio).toHaveBeenCalledWith({
      payload: { prismId: "prism:P7F21", privacyWalletConsent: undefined },
      headers: { requestId: "request-1" },
    });
  });

  it("maps factory/provider exception text to a fixed redacted discriminator", async () => {
    vi.mocked(getAppFactory).mockRejectedValue(new Error("provider postgres://user:password@host/db credential token=secret"));

    const response = await portfolioGet(
      new Request("http://localhost/api/v1/portfolio/prism%3AP7F21", { headers: { "x-request-id": "request-2" } }),
      { params: Promise.resolve({ prismId: "prism%3AP7F21" }) },
    );

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain('"detail":"dependency_unavailable"');
    expect(body).not.toContain("provider postgres");
    expect(body).not.toContain("password");
    expect(body).not.toContain("secret");
  });

  it("forwards only explicit privacy-wallet consent and an opaque session reference", async () => {
    const getPortfolio = vi.fn(async () => ({ ok: true, data: { state: "partial" } }));
    vi.mocked(getAppFactory).mockResolvedValue({ handlers: { getPortfolio } } as never);

    await portfolioGet(
      new Request("http://localhost/api/v1/portfolio/prism%3AP7F21", {
        headers: {
          "x-privacy-wallet-consent": "granted",
          "x-privacy-wallet-session-ref": "wallet-session-1",
        },
      }),
      { params: Promise.resolve({ prismId: "prism%3AP7F21" }) },
    );

    expect(getPortfolio).toHaveBeenCalledWith({
      payload: {
        prismId: "prism:P7F21",
        privacyWalletConsent: { status: "granted", walletSessionRef: "wallet-session-1" },
      },
      headers: { requestId: null },
    });
  });
});
