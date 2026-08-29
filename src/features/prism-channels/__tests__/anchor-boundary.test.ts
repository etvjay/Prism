import { describe, expect, it, vi } from "vitest";
import { StarknetCommitmentPublisher } from "../adapters/starknet-commitment-publisher";
import {
  STARKNET_CHANNEL_ANCHOR_ABI_VERSION,
  type StarknetAnchorPayload,
  type StarknetCommitmentContractPort,
} from "../domain/ports";
import { CHANNEL_ERROR_CODE } from "../domain/errors";

const CHANNEL_COMMITMENT = `0x${"11".repeat(32)}` as `0x${string}`;
const MESSAGE_COMMITMENT = `0x${"22".repeat(32)}` as `0x${string}`;
const CIPHERTEXT_HASH = `0x${"33".repeat(32)}` as `0x${string}`;

function contractWithMemory(): { contract: StarknetCommitmentContractPort; submitted: StarknetAnchorPayload[] } {
  const submitted: StarknetAnchorPayload[] = [];
  const contract: StarknetCommitmentContractPort = {
    abiVersion: STARKNET_CHANNEL_ANCHOR_ABI_VERSION,
    contractAddress: "0x1234",
    submitAnchor: vi.fn(async (input) => {
      submitted.push(input);
      return { transactionHash: "0x01" };
    }),
    readAnchor: vi.fn(async ({ anchorRef }) => submitted.find((item) => item.anchorRef === anchorRef) ?? null),
  };
  return { contract, submitted };
}

describe("Starknet PrismChannel commitment publisher boundary", () => {
  it("submits only typed opaque commitments and safe state metadata", async () => {
    const { contract, submitted } = contractWithMemory();
    const publisher = new StarknetCommitmentPublisher({ contract });
    const result = await publisher.publishChannelAnchor({
      commitment: CHANNEL_COMMITMENT,
      version: 1,
      observedAt: 7_000_000,
      state: "PROPOSED",
    });

    expect(publisher.isTestDouble).toBe(false);
    expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({
      kind: "channel",
      anchorRef: CHANNEL_COMMITMENT,
      commitment: CHANNEL_COMMITMENT,
      relatedCommitment: null,
      version: 1,
      observedAt: 7_000_000,
      state: "PROPOSED",
    });
    expect(JSON.stringify(submitted[0])).not.toContain("prism:ALICE");
    expect(JSON.stringify(submitted[0])).not.toContain("plaintext");
  });

  it("anchors a message with a channel commitment and ciphertext hash, never memo text", async () => {
    const { contract, submitted } = contractWithMemory();
    const publisher = new StarknetCommitmentPublisher({ contract });
    await publisher.publishMessageAnchor({
      channelCommitment: CHANNEL_COMMITMENT,
      messageCommitment: MESSAGE_COMMITMENT,
      ciphertextHash: CIPHERTEXT_HASH,
      version: 2,
      observedAt: 7_000_001,
      state: "ACTIVE",
    });

    expect(submitted[0]).toMatchObject({
      kind: "message",
      anchorRef: MESSAGE_COMMITMENT,
      commitment: CIPHERTEXT_HASH,
      relatedCommitment: CHANNEL_COMMITMENT,
      version: 2,
      observedAt: 7_000_001,
      state: "ACTIVE",
    });
  });

  it("fails closed when the injected Starknet provider is unavailable", async () => {
    const { contract } = contractWithMemory();
    vi.mocked(contract.submitAnchor).mockRejectedValueOnce(new Error("rpc unavailable"));
    const publisher = new StarknetCommitmentPublisher({ contract });

    const result = publisher.publishChannelAnchor({
      commitment: CHANNEL_COMMITMENT,
      version: 1,
      observedAt: 7_000_000,
      state: "PROPOSED",
    });
    await expect(result).rejects.toMatchObject({ code: CHANNEL_ERROR_CODE.ANCHOR_UNAVAILABLE });
    await result.catch((error: unknown) => {
      expect(String(error)).not.toContain("rpc unavailable");
    });
  });

  it("rejects an anchor provider with the wrong ABI version", () => {
    const { contract } = contractWithMemory();
    const mismatched = { ...contract, abiVersion: "unversioned" } as unknown as StarknetCommitmentContractPort;
    expect(() => new StarknetCommitmentPublisher({ contract: mismatched }))
      .toThrowError(expect.objectContaining({ code: CHANNEL_ERROR_CODE.ANCHOR_PROVIDER_MISMATCH }));
  });

  it("reads back a submitted anchor through the independent provider path", async () => {
    const { contract } = contractWithMemory();
    const publisher = new StarknetCommitmentPublisher({ contract });
    await publisher.publishChannelAnchor({
      commitment: CHANNEL_COMMITMENT,
      version: 1,
      observedAt: 7_000_000,
      state: "PROPOSED",
    });

    await expect(publisher.readAnchor(CHANNEL_COMMITMENT)).resolves.toMatchObject({
      kind: "channel",
      anchorRef: CHANNEL_COMMITMENT,
      commitment: CHANNEL_COMMITMENT,
    });
  });
  it("rejects inconsistent independent anchor readback", async () => {
    const { contract } = contractWithMemory();
    vi.mocked(contract.readAnchor).mockResolvedValueOnce({
      kind: "channel",
      anchorRef: CHANNEL_COMMITMENT,
      commitment: MESSAGE_COMMITMENT,
      relatedCommitment: null,
      version: 1,
      observedAt: 7_000_000,
      state: "PROPOSED",
    });
    const publisher = new StarknetCommitmentPublisher({ contract });

    await expect(publisher.readAnchor(CHANNEL_COMMITMENT))
      .rejects.toMatchObject({ code: CHANNEL_ERROR_CODE.ANCHOR_INCONSISTENT });
  });
});
