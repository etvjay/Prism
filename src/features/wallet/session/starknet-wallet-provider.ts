import { createStore, type Store } from "@starknet-io/get-starknet-discovery";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import { constants, WalletAccountV6, walletV6 } from "starknet";
import type { ExpectedWalletEnvironment } from "../../prism-strk20/domain/wallet-capability";
import type { StarknetWalletSessionProvider } from "./starknet-wallet-adapter";

export interface DiscoveredStarknetWallet {
  readonly id: string;
  readonly name: string;
  readonly wallet: WalletWithStarknetFeatures;
}

export interface StarknetWalletDiscovery {
  getWallets(): readonly DiscoveredStarknetWallet[];
  subscribe(listener: (wallets: readonly DiscoveredStarknetWallet[]) => void): () => void;
}

export interface StarknetWalletBoundary {
  readonly wallet: DiscoveredStarknetWallet;
  readonly provider: StarknetWalletSessionProvider;
  subscribe(listener: (change: unknown) => void): () => void;
  switchNetwork(): Promise<boolean>;
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

  const provider: StarknetWalletSessionProvider = {
    name: discoveredWallet.name,
    connect: async () => {
      if (!rpcUrl) throw new Error("starknet_rpc_unavailable");
      account = await WalletAccountV6.connect({ nodeUrl: rpcUrl }, walletProvider);
      if (!account.address) throw new Error("starknet_account_unavailable");
      return { address: account.address };
    },
    getSession: async () => {
      if (!rpcUrl) throw new Error("starknet_rpc_unavailable");
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
  };
}
