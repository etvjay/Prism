import { describe, expect, it, vi } from "vitest";
import { createMcpAdapter, MCP_TOOL_DEFINITIONS } from "../mcp-boundary";

const portfolioResult = { ok: true, data: { state: "partial" } };

describe("MCP connected portfolio boundary", () => {
  it("delegates portfolio reads through the SDK without a chain or privacy bypass", async () => {
    const get = vi.fn(async () => portfolioResult);
    const adapter = createMcpAdapter({ portfolio: { get } } as never);

    const result = await adapter.callTool("prism_get_portfolio", {
      prismId: "prism:P7F21",
      privacyWalletConsent: "granted",
      walletSessionRef: "wallet-session-1",
    });

    expect(result).toBe(portfolioResult);
    expect(get).toHaveBeenCalledWith("prism:P7F21", {
      privacyWalletConsent: "granted",
      walletSessionRef: "wallet-session-1",
    });
    expect(MCP_TOOL_DEFINITIONS).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "prism_get_portfolio" }),
    ]));
  });
});
