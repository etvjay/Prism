import { describe, expect, it, vi } from "vitest";
import {
  BASE_SEPOLIA_CHAIN_ID,
  BaseWalletAdapter,
  createBaseWalletDiscovery,
  type BaseWalletProvider,
  type OwnershipChallengeForSigning,
} from "../base-wallet-adapter";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const challenge: OwnershipChallengeForSigning = {
  challengeId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  digest: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  schemaVersion: 2,
  chainId: BASE_SEPOLIA_CHAIN_ID,
  domain: "prism.example",
  venue: "BASE",
  executionAccount: ACCOUNT,
  prismId: "prism:42",
  nonce: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  issuedAt: 1_700_000_000,
  expiresAt: 1_700_000_600,
  messageToSign: "exact challenge message",
};

function provider(overrides: Partial<BaseWalletProvider> = {}): BaseWalletProvider {
  return {
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_chainId") return "0x14a34";
      if (method === "eth_accounts") return [ACCOUNT];
      if (method === "eth_requestAccounts") return [ACCOUNT];
      if (method === "personal_sign") return "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
      throw new Error(`unexpected ${method}`);
    }),
    ...overrides,
  };
}

describe("Base wallet ownership-proof boundary", () => {
  it("reads chain id and selected account through typed methods", async () => {
    const adapter = new BaseWalletAdapter(provider());
    await expect(adapter.getChainId()).resolves.toBe(BASE_SEPOLIA_CHAIN_ID);
    await expect(adapter.getSelectedAccount()).resolves.toBe(ACCOUNT);
  });

  it("rejects a wrong chain before signing", async () => {
    const request = vi.fn(async ({ method }: { method: string }) => method === "eth_chainId" ? "0x1" : [ACCOUNT]);
    const adapter = new BaseWalletAdapter(provider({ request }));
    await expect(adapter.assertReady(ACCOUNT)).rejects.toThrow("wrong_chain");
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "personal_sign" }));
  });

  it("rejects an account mismatch before signing", async () => {
    const adapter = new BaseWalletAdapter(provider({ request: vi.fn(async ({ method }: { method: string }) => method === "eth_chainId" ? "0x14a34" : [OTHER]) }));
    await expect(adapter.assertReady(ACCOUNT)).rejects.toThrow("account_mismatch");
  });

  it("surfaces a rejected personal_sign without retaining the raw signature", async () => {
    const adapter = new BaseWalletAdapter(provider({ request: vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_chainId") return "0x14a34";
      if (method === "eth_accounts") return [ACCOUNT];
      throw new Error("User rejected the request");
    }) }));
    await expect(adapter.signOwnershipProof(challenge, 1_700_000_100)).rejects.toThrow("signature_rejected");
    expect(adapter.getLastProofMetadata()).toBeNull();
  });

  it("enforces expiry, domain, and chain binding", async () => {
    const adapter = new BaseWalletAdapter(provider());
    await expect(adapter.signOwnershipProof({ ...challenge, expiresAt: 1_700_000_001 }, 1_700_000_002)).rejects.toThrow("challenge_expired");
    await expect(adapter.signOwnershipProof({ ...challenge, domain: "evil.example" }, 1_700_000_100)).rejects.toThrow("challenge_domain_mismatch");
    await expect(adapter.signOwnershipProof({ ...challenge, chainId: 1 }, 1_700_000_100)).rejects.toThrow("challenge_chain_mismatch");
  });

  it("returns successful proof metadata only and retains no private material", async () => {
    const adapter = new BaseWalletAdapter(provider());
    const metadata = await adapter.signOwnershipProof(challenge, 1_700_000_100);
    expect(metadata).toEqual({
      challengeId: challenge.challengeId,
      proofDigest: challenge.digest,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      account: ACCOUNT,
      signatureClass: "EOA",
      expiresAt: challenge.expiresAt,
    });
    expect(JSON.stringify(metadata)).not.toContain("dddd");
    expect(adapter.getLastProofMetadata()).toEqual(metadata);
  });

  it("discovers EIP-6963 providers without putting provider blobs in descriptors", () => {
    const listeners = new Map<string, EventListener>();
    const win = {
      addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as Window;
    const discovery = createBaseWalletDiscovery(win);
    expect(discovery.getWallets()).toEqual([]);
    listeners.get("eip6963:announceProvider")?.({ detail: { info: { uuid: "u1", name: "Test Wallet", icon: "x", rdns: "test" }, provider: provider() } } as unknown as Event);
    expect(discovery.getWallets()).toEqual([{ id: "u1", name: "Test Wallet", rdns: "test" }]);
    expect(JSON.stringify(discovery.getWallets())).not.toContain("request");
  });
});
