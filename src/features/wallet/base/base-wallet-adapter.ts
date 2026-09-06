/** Typed, client-only Base wallet boundary.
 *
 * Provider objects stay in this module's closure. Callers receive descriptors and
 * proof metadata only; signatures are used transiently for an injected verifier
 * and are never returned, stored, or put in React state.
 */

export const BASE_SEPOLIA_CHAIN_ID = 84532 as const;
export const BASE_SEPOLIA_CHAIN_HEX = "0x14a34" as const;
export const DEFAULT_OWNERSHIP_DOMAIN = "prism.example" as const;

type RequestArguments = { readonly method: string; readonly params?: readonly unknown[] };
export interface BaseWalletProvider {
  request(args: RequestArguments): Promise<unknown>;
}

export interface BaseWalletDescriptor {
  readonly id: string;
  readonly name: string;
  readonly rdns?: string;
}

export interface BaseWalletDiscovery {
  getWallets(): readonly BaseWalletDescriptor[];
  getProvider(id: string): BaseWalletProvider | undefined;
  refresh(): void;
  subscribe(listener: (wallets: readonly BaseWalletDescriptor[]) => void): () => void;
}

export interface OwnershipChallengeForSigning {
  readonly challengeId: `0x${string}`;
  readonly digest: `0x${string}`;
  readonly schemaVersion: number;
  readonly chainId: number;
  readonly domain: string;
  readonly venue: string;
  readonly executionAccount: string;
  readonly prismId: string;
  readonly nonce: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly messageToSign: string;
}

export interface OwnershipProofMetadata {
  readonly challengeId: `0x${string}`;
  readonly proofDigest: `0x${string}`;
  readonly chainId: typeof BASE_SEPOLIA_CHAIN_ID;
  readonly account: string;
  readonly signatureClass: "EOA";
  readonly expiresAt: number;
}

function normalizeAccount(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error("base_account_unavailable");
  return value.toLowerCase();
}

function asChainId(value: unknown): number {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) throw new Error("base_chain_id_unavailable");
  const chainId = Number.parseInt(value, 16);
  if (!Number.isSafeInteger(chainId)) throw new Error("base_chain_id_unavailable");
  return chainId;
}

export class BaseWalletAdapter {
  private lastProofMetadata: OwnershipProofMetadata | null = null;
  constructor(private readonly provider: BaseWalletProvider, private readonly expectedDomain = DEFAULT_OWNERSHIP_DOMAIN) {}

  async connect(): Promise<string> {
    const accounts = await this.provider.request({ method: "eth_requestAccounts" });
    const list = Array.isArray(accounts) ? accounts : [];
    return normalizeAccount(list[0]);
  }

  async getChainId(): Promise<number> {
    return asChainId(await this.provider.request({ method: "eth_chainId" }));
  }

  async getSelectedAccount(): Promise<string | null> {
    const accounts = await this.provider.request({ method: "eth_accounts" });
    const first = Array.isArray(accounts) ? accounts[0] : null;
    return first == null ? null : normalizeAccount(first);
  }

  async assertReady(expectedAccount: string): Promise<{ readonly chainId: typeof BASE_SEPOLIA_CHAIN_ID; readonly account: string }> {
    const chainId = await this.getChainId();
    if (chainId !== BASE_SEPOLIA_CHAIN_ID) throw new Error(`wrong_chain:${chainId}`);
    const account = await this.getSelectedAccount();
    if (!account || account !== normalizeAccount(expectedAccount)) throw new Error("account_mismatch");
    return { chainId: BASE_SEPOLIA_CHAIN_ID, account };
  }

  async signOwnershipProof(challenge: OwnershipChallengeForSigning, nowSeconds: number): Promise<OwnershipProofMetadata> {
    if (!Number.isFinite(nowSeconds) || nowSeconds >= challenge.expiresAt) throw new Error("challenge_expired");
    if (challenge.domain.trim().toLowerCase() !== this.expectedDomain.toLowerCase()) throw new Error("challenge_domain_mismatch");
    if (challenge.chainId !== BASE_SEPOLIA_CHAIN_ID) throw new Error("challenge_chain_mismatch");
    const ready = await this.assertReady(challenge.executionAccount);
    try {
      // The signature remains a local variable and is deliberately not included
      // in the result. A future verifier handoff must be injected at this seam.
      const signature = await this.provider.request({ method: "personal_sign", params: [challenge.messageToSign, ready.account] });
      if (typeof signature !== "string" || !/^0x[0-9a-f]+$/i.test(signature)) throw new Error("malformed_signature");
    } catch (cause) {
      throw new Error(`signature_rejected:${cause instanceof Error ? cause.message : "unknown"}`);
    }
    const metadata: OwnershipProofMetadata = {
      challengeId: challenge.challengeId,
      proofDigest: challenge.digest,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      account: ready.account,
      signatureClass: "EOA",
      expiresAt: challenge.expiresAt,
    };
    this.lastProofMetadata = metadata;
    return metadata;
  }

  getLastProofMetadata(): OwnershipProofMetadata | null {
    return this.lastProofMetadata;
  }
}

export function createBaseWalletDiscovery(win: Pick<Window, "addEventListener" | "removeEventListener" | "dispatchEvent"> & { ethereum?: BaseWalletProvider }): BaseWalletDiscovery {
  const providers = new Map<string, BaseWalletProvider>();
  const descriptors = new Map<string, BaseWalletDescriptor>();
  const listeners = new Set<(wallets: readonly BaseWalletDescriptor[]) => void>();
  let sequence = 0;
  const announce = (event: Event) => {
    const detail = (event as CustomEvent<{ info?: { uuid?: string; name?: string; rdns?: string }; provider?: BaseWalletProvider }>).detail;
    if (!detail?.provider || !detail.info?.name) return;
    const id = detail.info.uuid?.trim() || `eip6963:${sequence++}`;
    providers.set(id, detail.provider);
    descriptors.set(id, { id, name: detail.info.name.trim(), ...(detail.info.rdns ? { rdns: detail.info.rdns } : {}) });
    listeners.forEach((listener) => listener([...descriptors.values()]));
  };
  win.addEventListener("eip6963:announceProvider", announce);
  const fallbackId = "window.ethereum";
  if (win.ethereum) {
    providers.set(fallbackId, win.ethereum);
    descriptors.set(fallbackId, { id: fallbackId, name: "Browser wallet" });
  }
  const current = () => [...descriptors.values()];
  return {
    getWallets: current,
    getProvider: (id) => providers.get(id),
    refresh: () => win.dispatchEvent(new Event("eip6963:requestProvider")),
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
