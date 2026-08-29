import { describe, expect, it } from "vitest";
import {
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID_HEX,
  Eip1193BaseProofAdapter,
  type Eip1193Provider,
} from "../base-proof-adapter";
import { bytesToHex, utf8ToBytes } from "../../../prism-identity/domain/hex";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const OTHER_ACCOUNT = "0x2222222222222222222222222222222222222222" as const;
const SIGNATURE = `0x${"ab".repeat(65)}` as const;
const MESSAGE = "PRISM-OWNERSHIP-CHALLENGE v2\npublic challenge";

function provider(
  responses: Record<string, unknown | (() => unknown | Promise<unknown>)>,
  calls: Array<{ method: string; params?: readonly unknown[] }>,
): Eip1193Provider {
  return {
    request: async ({ method, params }) => {
      calls.push({ method, params });
      const response = responses[method];
      if (response instanceof Error) throw response;
      if (typeof response === "function") return await response();
      return response;
    },
  };
}

describe("EIP-1193 Base Sepolia proof adapter", () => {
  it("connects with public account/network data and never exposes key material", async () => {
    const calls: Array<{ method: string; params?: readonly unknown[] }> = [];
    const adapter = new Eip1193BaseProofAdapter(provider({
      eth_requestAccounts: [ACCOUNT],
      eth_chainId: BASE_SEPOLIA_CHAIN_ID_HEX,
    }, calls));

    const result = await adapter.connect();

    expect(result).toEqual({
      status: "connected",
      account: ACCOUNT,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      chainIdHex: BASE_SEPOLIA_CHAIN_ID_HEX,
    });
    expect(calls).toEqual([
      { method: "eth_requestAccounts", params: undefined },
      { method: "eth_chainId", params: undefined },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/private|secret|seed|key/i);
    expect(Object.getOwnPropertyNames(adapter)).not.toContain("privateKey");
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(adapter))).not.toContain("sendTransaction");
  });

  it("signs only through personal_sign and returns the public signature result", async () => {
    const calls: Array<{ method: string; params?: readonly unknown[] }> = [];
    const adapter = new Eip1193BaseProofAdapter(provider({
      eth_accounts: [ACCOUNT],
      eth_chainId: BASE_SEPOLIA_CHAIN_ID_HEX,
      personal_sign: SIGNATURE,
    }, calls));

    const result = await adapter.signMessage({
      message: MESSAGE,
      expectedAccount: ACCOUNT,
    });

    expect(result).toEqual({
      status: "signed",
      account: ACCOUNT,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      chainIdHex: BASE_SEPOLIA_CHAIN_ID_HEX,
      signature: SIGNATURE,
    });
    expect(calls).toEqual([
      { method: "eth_accounts", params: undefined },
      { method: "eth_chainId", params: undefined },
      {
        method: "personal_sign",
        params: [bytesToHex(utf8ToBytes(MESSAGE)), ACCOUNT],
      },
      { method: "eth_accounts", params: undefined },
      { method: "eth_chainId", params: undefined },
    ]);
  });

  it("does not expose an arbitrary provider request capability", () => {
    const adapter = new Eip1193BaseProofAdapter({
      request: async () => undefined,
    });

    expect(Object.getOwnPropertyNames(adapter)).not.toContain("request");
    expect(Object.getOwnPropertyNames(adapter)).not.toContain("provider");
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(adapter))).not.toContain("requestValue");
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(adapter))).not.toContain("request");
  });

  it("maps wallet rejection without returning the provider error or prompt contents", async () => {
    const calls: Array<{ method: string; params?: readonly unknown[] }> = [];
    const rejection = Object.assign(new Error("User rejected the request"), { code: 4001 });
    const adapter = new Eip1193BaseProofAdapter(provider({
      eth_requestAccounts: rejection,
    }, calls));
    const result = await adapter.connect();

    expect(result).toMatchObject({
      status: "rejected",
      code: "BASE_PROOF_USER_REJECTED",
      operation: "connect",
      detail: "user_rejected",
    });
    expect(JSON.stringify(result)).not.toMatch(/User rejected|prompt|private|secret/i);
  });

  it("maps an unavailable or malformed provider to an explicit unknown state", async () => {
    const adapter = new Eip1193BaseProofAdapter({
      request: async () => {
        throw new Error("rpc failed with opaque credentials 0xabcdef0123456789");
      },
    });

    const result = await adapter.connect();

    expect(result).toEqual({
      status: "unknown",
      code: "BASE_PROOF_PROVIDER_UNKNOWN",
      operation: "connect",
      detail: "provider_request_failed",
    });
    expect(JSON.stringify(result)).not.toMatch(/opaque|credentials|abcdef/i);
  });

  it("maps a missing authoritative EIP-1193 request interface to BLOCKED_BY_PROVIDER_INTERFACE", async () => {
    const adapter = new Eip1193BaseProofAdapter({} as Eip1193Provider);

    await expect(adapter.connect()).resolves.toEqual({
      status: "blocked",
      code: "BLOCKED_BY_PROVIDER_INTERFACE",
      operation: "connect",
      detail: "eip1193_request_unavailable",
    });
  });

  it("maps a Base network mismatch before any signature request", async () => {
    const calls: Array<{ method: string; params?: readonly unknown[] }> = [];
    const adapter = new Eip1193BaseProofAdapter(provider({
      eth_requestAccounts: [ACCOUNT],
      eth_chainId: "0x1",
    }, calls));

    const result = await adapter.connect();

    expect(result).toEqual({
      status: "network_mismatch",
      code: "BASE_PROOF_NETWORK_MISMATCH",
      operation: "connect",
      detail: "wrong_network",
      account: ACCOUNT,
      expectedChainId: BASE_SEPOLIA_CHAIN_ID,
      actualChainId: 1,
      actualChainIdHex: "0x1",
    });
    expect(calls).not.toContainEqual(expect.objectContaining({ method: "personal_sign" }));
  });

  it("maps a selected-account mismatch and does not sign with another account", async () => {
    const calls: Array<{ method: string; params?: readonly unknown[] }> = [];
    const adapter = new Eip1193BaseProofAdapter(provider({
      eth_accounts: [OTHER_ACCOUNT],
      eth_chainId: BASE_SEPOLIA_CHAIN_ID_HEX,
      personal_sign: SIGNATURE,
    }, calls));

    const result = await adapter.signMessage({
      message: "public challenge",
      expectedAccount: ACCOUNT,
    });

    expect(result).toEqual({
      status: "account_mismatch",
      code: "BASE_PROOF_ACCOUNT_MISMATCH",
      operation: "signMessage",
      detail: "selected_account_mismatch",
      expectedAccount: ACCOUNT,
      actualAccount: OTHER_ACCOUNT,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      chainIdHex: BASE_SEPOLIA_CHAIN_ID_HEX,
    });
    expect(calls).not.toContainEqual(expect.objectContaining({ method: "personal_sign" }));
  });

  it("rejects a signature if the current account changes after preflight", async () => {
    let accountReads = 0;
    const calls: Array<{ method: string; params?: readonly unknown[] }> = [];
    const adapter = new Eip1193BaseProofAdapter(provider({
      eth_accounts: () => {
        accountReads += 1;
        return accountReads === 1 ? [ACCOUNT] : [OTHER_ACCOUNT];
      },
      eth_chainId: BASE_SEPOLIA_CHAIN_ID_HEX,
      personal_sign: SIGNATURE,
    }, calls));

    const result = await adapter.signMessage({ message: MESSAGE, expectedAccount: ACCOUNT });

    expect(result).toEqual({
      status: "account_mismatch",
      code: "BASE_PROOF_ACCOUNT_MISMATCH",
      operation: "signMessage",
      detail: "selected_account_mismatch",
      expectedAccount: ACCOUNT,
      actualAccount: OTHER_ACCOUNT,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      chainIdHex: BASE_SEPOLIA_CHAIN_ID_HEX,
    });
    expect(calls).toContainEqual(expect.objectContaining({ method: "personal_sign" }));
  });

  it("rejects a signature if the current chain changes after preflight", async () => {
    let chainReads = 0;
    const calls: Array<{ method: string; params?: readonly unknown[] }> = [];
    const adapter = new Eip1193BaseProofAdapter(provider({
      eth_accounts: [ACCOUNT],
      eth_chainId: () => {
        chainReads += 1;
        return chainReads === 1 ? BASE_SEPOLIA_CHAIN_ID_HEX : "0x1";
      },
      personal_sign: SIGNATURE,
    }, calls));

    const result = await adapter.signMessage({ message: MESSAGE, expectedAccount: ACCOUNT });

    expect(result).toEqual({
      status: "network_mismatch",
      code: "BASE_PROOF_NETWORK_MISMATCH",
      operation: "signMessage",
      detail: "wrong_network",
      account: ACCOUNT,
      expectedChainId: BASE_SEPOLIA_CHAIN_ID,
      actualChainId: 1,
      actualChainIdHex: "0x1",
    });
    expect(calls).toContainEqual(expect.objectContaining({ method: "personal_sign" }));
  });

  it("maps signature rejection as a public provider state", async () => {
    const calls: Array<{ method: string; params?: readonly unknown[] }> = [];
    const rejection = Object.assign(new Error("User rejected signing the secret prompt"), { code: 4001 });
    const adapter = new Eip1193BaseProofAdapter(provider({
      eth_accounts: [ACCOUNT],
      eth_chainId: BASE_SEPOLIA_CHAIN_ID_HEX,
      personal_sign: rejection,
    }, calls));

    const result = await adapter.signMessage({ message: "public challenge", expectedAccount: ACCOUNT });

    expect(result).toEqual({
      status: "rejected",
      code: "BASE_PROOF_USER_REJECTED",
      operation: "signMessage",
      detail: "user_rejected",
    });
  });
});
