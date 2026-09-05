import { createStore, type Store } from "@starknet-io/get-starknet-discovery";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import { constants, RpcProvider, WalletAccountV6, walletV6 } from "starknet";
import type { ExpectedWalletEnvironment } from "../../prism-strk20/domain/wallet-capability";
import type { StarknetWalletSessionProvider } from "./starknet-wallet-adapter";
import { WalletV6M5Adapter, type WalletAccountV6Like } from "../../prism-strk20/m5/wallet-adapter";
import { PRIVACY_POOL_SEPOLIA } from "../../prism-strk20/m5/constants";
import type { M5Provider } from "../../prism-strk20/m5/ports";

const REGISTRY_V2 = "0x06f77be5c7bdfef252dd322481b4430a587b781df4f79d3b344808d125ec530d";

export interface DiscoveredStarknetWallet {
  readonly id: string;
  readonly name: string;
  readonly wallet: WalletWithStarknetFeatures;
}

export interface StarknetWalletDiscovery {
  getWallets(): readonly DiscoveredStarknetWallet[];
  subscribe(listener: (wallets: readonly DiscoveredStarknetWallet[]) => void): () => void;
  /** Re-scan legacy injected globals after the page has hydrated. */
  refresh(): void;
}

export interface StarknetWalletBoundary {
  readonly wallet: DiscoveredStarknetWallet;
  readonly provider: StarknetWalletSessionProvider;
  subscribe(listener: (change: unknown) => void): () => void;
  switchNetwork(): Promise<boolean>;
  /** User-authorized mutation; only callable after an explicit UI action. */
  createPrismIdentity(): Promise<{ readonly txHash: string }>;
  getM5Provider(): M5Provider | null;
}

type WalletV6Provider = Parameters<typeof WalletAccountV6.connect>[1];
type WalletChange = Parameters<typeof walletV6.subscribeWalletEvent>[1];

type WalletFeatureMap = Record<string, unknown>;

function asWalletV6Provider(wallet: WalletWithStarknetFeatures): WalletV6Provider {
  // get-starknet and starknet.js resolve compatible wallet-standard shapes from
  // different type package instances. Keep the compatibility cast at this SDK seam.
  return wallet as unknown as WalletV6Provider;
}

function hasWalletApiFeature(wallet: WalletWithStarknetFeatures): boolean {
  return Boolean((wallet.features as WalletFeatureMap)["starknet:walletApi"]);
}

function walletOption(wallet: WalletWithStarknetFeatures, index: number): DiscoveredStarknetWallet {
  const name = wallet.name.trim() || "Starknet wallet";
  return { id: `${name}:${index}`, name, wallet };
}

function mapWallets(wallets: readonly WalletWithStarknetFeatures[]): readonly DiscoveredStarknetWallet[] {
  return wallets.map(walletOption);
}

function createDiscoveryStore(): Store {
  return createStore();
}

export function createStarknetWalletDiscovery(): StarknetWalletDiscovery {
  const store = createDiscoveryStore();
  const current = () => mapWallets(store.getWallets());
  return {
    getWallets: current,
    subscribe: (listener) => store.subscribe((wallets) => listener(mapWallets(wallets))),
    refresh: () => store._refreshInjectedWallets(),
  };
}

function expectedChainId(environment: ExpectedWalletEnvironment): string {
  return environment === "SN_MAIN" ? constants.StarknetChainId.SN_MAIN : constants.StarknetChainId.SN_SEPOLIA;
}

export function createStarknetWalletBoundary(
  discoveredWallet: DiscoveredStarknetWallet,
  rpcUrl: string | null,
  expectedEnvironment: ExpectedWalletEnvironment,
): StarknetWalletBoundary {
  const wallet = discoveredWallet.wallet;
  const walletProvider = asWalletV6Provider(wallet);
  const walletApiAvailable = hasWalletApiFeature(wallet);
  let account: WalletAccountV6 | null = null;
  const standardConnect = wallet.features["standard:connect"].connect;

  const connectFromStandard = async (): Promise<{ readonly address: string }> => {
    const result = await standardConnect();
    const standardAccount = result.accounts[0];
    if (!standardAccount || typeof standardAccount.address !== "string" || standardAccount.address.length === 0) {
      throw new Error("starknet_account_unavailable");
    }
    return { address: standardAccount.address };
  };

  const provider: StarknetWalletSessionProvider = {
    name: discoveredWallet.name,
    connect: async () => {
      if (!rpcUrl) return connectFromStandard();
      account = await WalletAccountV6.connect({ nodeUrl: rpcUrl }, walletProvider);
      if (!account.address) throw new Error("starknet_account_unavailable");
      return { address: account.address };
    },
    getSession: async () => {
      if (!rpcUrl) {
        const standardAccount = wallet.accounts[0];
        return standardAccount?.address ? { address: standardAccount.address } : null;
      }
      const silentAccount = await WalletAccountV6.connectSilent({ nodeUrl: rpcUrl }, walletProvider);
      account = silentAccount;
      return silentAccount.address ? { address: silentAccount.address } : null;
    },
    disconnect: async () => {
      await wallet.features["standard:disconnect"].disconnect();
      account = null;
    },
    supportedWalletApi: async () => {
      if (!walletApiAvailable) return [];
      return walletV6.supportedWalletApi(walletProvider);
    },
    supportedSpecs: async () => {
      if (!walletApiAvailable) return [];
      return walletV6.supportedSpecs(walletProvider);
    },
    requestChainId: async () => {
      if (walletApiAvailable) return walletV6.requestChainId(walletProvider);
      if (!account) throw new Error("starknet_account_unavailable");
      return account.provider.getChainId();
    },
  };

  return {
    wallet: discoveredWallet,
    provider,
    subscribe: (listener) => walletV6.subscribeWalletEvent(walletProvider, listener as WalletChange),
    switchNetwork: () => walletV6.switchStarknetChain(
      walletProvider,
      expectedChainId(expectedEnvironment) as Parameters<typeof walletV6.switchStarknetChain>[1],
    ),
    createPrismIdentity: async () => {
      if (!account) throw new Error("starknet_account_unavailable");
      // This is deliberately not invoked by connect/session effects. The caller
      // reaches this boundary only from the explicit Create button, allowing the
      // connected WalletAccountV6 to show its authorization prompt.
      const result = await account.execute([{
        contractAddress: REGISTRY_V2,
        entrypoint: "create_identity",
        calldata: [],
      }]);
      const rawHash = result.transaction_hash.trim().toLowerCase();
      if (!/^0x[0-9a-f]{1,64}$/.test(rawHash)) throw new Error("malformed_tx_hash");
      return { txHash: `0x${rawHash.slice(2).padStart(64, "0")}` };
    },
    getM5Provider: () => account
      ? new WalletV6M5Adapter({
          wallet: account as unknown as WalletAccountV6Like,
          capabilityProvider: {
            supportedWalletApi: async () => walletV6.supportedWalletApi(walletProvider),
            supportedSpecs: async () => walletV6.supportedSpecs(walletProvider),
            requestChainId: async () => walletV6.requestChainId(walletProvider),
          },
          walletFeatures: wallet,
          // Fee observation is a public read and must not depend on an
          // optional wallet-provider method. The wallet still owns all
          // authorization, proving, notes, and transaction submission.
          feeReader: rpcUrl
            ? {
                getFeeAmount: async () => {
                  const rpc = new RpcProvider({ nodeUrl: rpcUrl });
                  const result = await rpc.callContract({
                    contractAddress: PRIVACY_POOL_SEPOLIA,
                    entrypoint: "get_fee_amount",
                    calldata: [],
                  });
                  if (!Array.isArray(result) || result.length < 1 || result.length > 2 || !result.every((value) => typeof value === "string")) {
                    throw new Error("malformed_pool_fee_response");
                  }
                  const low = BigInt(result[0]);
                  const high = result.length === 2 ? BigInt(result[1]) : 0n;
                  if (low < 0n || high < 0n || low >= (1n << 128n) || high >= (1n << 128n)) {
                    throw new Error("invalid_pool_fee_response");
                  }
                  return { fee: low + (high << 128n), blockNumber: null };
                },
              }
            : undefined,
        })
      : null,
  };
}
