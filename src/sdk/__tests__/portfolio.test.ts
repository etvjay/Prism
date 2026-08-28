import { describe, expect, it } from "vitest";
import { createPrismClient } from "../client";

function okResponse(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "content-type": "application/json", "x-prism-watermark": "1789000000" },
  });
}

describe("Prism SDK portfolio read", () => {
  it("reads the derived portfolio without requesting private consent", async () => {
    let requestedUrl = "";
    let requestedHeaders: Headers | undefined;
    const client = createPrismClient({
      baseUrl: "https://prism.example",
      fetch: async (input, init) => {
        requestedUrl = String(input);
        requestedHeaders = init?.headers as Headers;
        return okResponse({ state: "empty" });
      },
    });

    const result = await client.portfolio.get("prism:P7F21");

    expect(result.ok).toBe(true);
    expect(requestedUrl).toBe("https://prism.example/v1/portfolio/prism%3AP7F21");
    expect(requestedHeaders?.get("x-privacy-wallet-consent")).toBeNull();
  });

  it("sends an explicit consent marker and opaque wallet session reference when requested", async () => {
    let requestedHeaders: Headers | undefined;
    const client = createPrismClient({
      baseUrl: "https://prism.example",
      fetch: async (_input, init) => {
        requestedHeaders = init?.headers as Headers;
        return okResponse({ state: "partial" });
      },
    });

    await client.portfolio.get("prism:P7F21", {
      privacyWalletConsent: "granted",
      walletSessionRef: "wallet-session-1",
    });

    expect(requestedHeaders?.get("x-privacy-wallet-consent")).toBe("granted");
    expect(requestedHeaders?.get("x-privacy-wallet-session-ref")).toBe("wallet-session-1");
  });
});
