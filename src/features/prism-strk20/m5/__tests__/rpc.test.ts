import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBalanceViaRpc, fetchReceiptViaRpc, fetchTransactionViaRpc, hasIndependentRead } from "../rpc";

const RPC = "https://rpc.example.invalid";
const TX = "0x1" as `0x${string}`;

describe("M5 public RPC adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the Starknet JSON-RPC entry_point_selector field for balance_of", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: ["0x2", "0x1"] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchBalanceViaRpc(RPC, "0x123", "0x456");

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.method).toBe("starknet_call");
    expect(request.params[0]).toEqual({
      contract_address: "0x123",
      entry_point_selector: "0x35a73cd311a05d46deda634c5ee045db92f811b4e74bca4437fcb5302b7af33",
      calldata: ["0x456"],
    });
  });

  it("rejects malformed u256 balance readback instead of truncating extra limbs", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: ["0x1", "0x0", "0x99"] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchBalanceViaRpc(RPC, "0x123", "0x456")).rejects.toThrow(/u256/);
  });

  it("reads raw invoke calldata through the first-party Starknet transaction RPC shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { type: "INVOKE", transaction_hash: "0x1", calldata: ["0x1", "0x2"] } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const tx = await fetchTransactionViaRpc(RPC, TX);

    expect(tx).toEqual({ transactionHash: "0x1", calldata: ["0x1", "0x2"] });
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.method).toBe("starknet_getTransactionByHash");
    expect(request.params).toEqual([TX]);
  });

  it("normalizes receipt events from Starknet JSON-RPC from_address", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          execution_status: "SUCCEEDED",
          finality_status: "ACCEPTED_ON_L2",
          block_number: 12,
          events: [{ from_address: "0xabc", keys: ["0x1"], data: ["0x2"] }],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const receipt = await fetchReceiptViaRpc(RPC, TX);

    expect(receipt?.events).toEqual([{ address: "0xabc", keys: ["0x1"], data: ["0x2"] }]);
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.params).toEqual([TX]);
  });

  it("requires two distinct explicit RPC identities for independent-read promotion", () => {
    expect(hasIndependentRead(" https://rpc.two.example ", "https://rpc.one.example")).toBe(true);
    expect(hasIndependentRead("https://rpc.one.example", " https://rpc.one.example ")).toBe(false);
    expect(hasIndependentRead("", "https://rpc.one.example")).toBe(false);
  });
});
