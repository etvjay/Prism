import { describe, expect, it, vi } from "vitest";
import { PRIVACY_POOL_SEPOLIA } from "../constants";
import { WalletV6M5Adapter, type WalletAccountV6Like } from "../wallet-adapter";

const FEE = 4n * 10n ** 18n;

function makeAdapter(callContract: NonNullable<WalletAccountV6Like["provider"]["callContract"]>) {
  const wallet: WalletAccountV6Like = {
    address: `0x${"1".repeat(64)}`,
    provider: { getChainId: async () => "SN_SEPOLIA", callContract },
    strk20PrepareInvoke: async () => { throw new Error("not used"); },
    strk20InvokeTransaction: async () => { throw new Error("not used"); },
  };
  return new WalletV6M5Adapter({
    wallet,
    capabilityProvider: {
      supportedWalletApi: async () => ["0.10.3"],
      supportedSpecs: async () => ["0.10.3"],
      requestChainId: async () => "SN_SEPOLIA",
    },
    walletFeatures: {},
  });
}

describe("WalletV6M5Adapter pool fee fallback", () => {
  it("reads and decodes the pool fee when WalletAccountV6 has no fee method", async () => {
    const callContract = vi.fn(async (call: { contractAddress: string; entrypoint: string; calldata: string[] }) => {
      expect(call).toEqual({ contractAddress: PRIVACY_POOL_SEPOLIA, entrypoint: "get_fee_amount", calldata: [] });
      return [`0x${FEE.toString(16)}`];
    });

    await expect(makeAdapter(callContract).getFeeAmount()).resolves.toEqual({ fee: FEE, blockNumber: null });
    expect(callContract).toHaveBeenCalledOnce();
  });

  it("combines a two-limb u256 pool fee", async () => {
    const low = 7n;
    const high = 2n;
    const callContract = vi.fn(async () => [`0x${low.toString(16)}`, `0x${high.toString(16)}`]);

    await expect(makeAdapter(callContract).getFeeAmount()).resolves.toEqual({
      fee: low + (high << 128n),
      blockNumber: null,
    });
  });
});
