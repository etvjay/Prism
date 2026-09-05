import { describe, expect, it, vi } from "vitest";
import { createStarknetWalletBoundary, createStarknetWalletDiscovery, type DiscoveredStarknetWallet } from "../starknet-wallet-provider";

function walletFixture() {
  const connect = vi.fn(async () => ({ accounts: [{ address: "0x123" }] }));
  const request = vi.fn(async ({ type }: { type: string }) => {
    if (type === "wallet_requestChainId") return "SN_SEPOLIA";
    if (type === "wallet_supportedWalletApi") return ["1.0.0"];
    if (type === "wallet_supportedSpecs") return ["1.0.0"];
    throw new Error(`unexpected_${type}`);
  });
  const wallet = {
    name: "Ready",
    accounts: [],
    features: {
      "standard:connect": { version: "1.0.0", connect },
      "standard:disconnect": { version: "1.0.0", disconnect: vi.fn(async () => {}) },
      "starknet:walletApi": { version: "1.0.0", request, walletVersion: "test", id: "ready" },
    },
  } as unknown as DiscoveredStarknetWallet["wallet"];
  return { wallet, connect, request };
}

describe("Starknet wallet standard boundary", () => {
  it("maps standard connect and wallet API calls without a client RPC URL", async () => {
    const fixture = walletFixture();
    const boundary = createStarknetWalletBoundary({ id: "ready:0", name: "Ready", wallet: fixture.wallet }, null, "SN_SEPOLIA");
    const provider = boundary.provider;

    await expect(provider.connect()).resolves.toEqual({ address: "0x123" });
    await expect(provider.requestChainId()).resolves.toBe("SN_SEPOLIA");
    await expect(provider.supportedWalletApi()).resolves.toEqual(["1.0.0"]);
    await expect(provider.supportedSpecs()).resolves.toEqual(["1.0.0"]);
    expect(fixture.connect).toHaveBeenCalledOnce();
    expect(fixture.request).toHaveBeenCalled();
  });

  it("returns no wallets in a non-browser environment instead of inventing options", () => {
    const discovery = createStarknetWalletDiscovery();
    expect(discovery.getWallets()).toEqual([]);
    expect(() => discovery.refresh()).not.toThrow();
  });
});
