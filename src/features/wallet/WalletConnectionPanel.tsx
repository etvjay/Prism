"use client";

import { useEffect, useState } from "react";
import { createStore } from "@starknet-io/get-starknet-discovery";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import { WalletAccountV6, walletV6 } from "starknet";

type WalletV6Provider = Parameters<typeof WalletAccountV6.connect>[1];

type ConnectionState =
  | "disconnected"
  | "discovering"
  | "connecting"
  | "privacy-capable"
  | "privacy-unsupported"
  | "capability-unknown"
  | "consent-required"
  | "unavailable";

type WalletSnapshot = {
  walletName: string;
  address: string;
  chainId: string;
  apiVersions: string[];
  specs: string[];
  privacyCapable: boolean;
};

const STRK20_API_FAMILY = [0, 10, 0];

function parseVersion(value: string): number[] | null {
  const match = value.match(/(\d+)\.(\d+)(?:\.(\d+))?/);

  if (!match) return null;

  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function compareVersions(left: number[], right: number[]) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftPart = left[index] ?? 0;
    const rightPart = right[index] ?? 0;

    if (leftPart !== rightPart) return leftPart - rightPart;
  }

  return 0;
}

function supportsStrk20(apiVersions: string[], specs: string[]) {
  return [...apiVersions, ...specs].some((value) => {
    const parsed = parseVersion(value);
    return parsed ? compareVersions(parsed, STRK20_API_FAMILY) >= 0 : false;
  });
}

function normalizeAddress(address: string) {
  const hex = address.toLowerCase().replace(/^0x/, "");
  return `0x${hex.padStart(64, "0")}`;
}

function asWalletV6Provider(wallet: WalletWithStarknetFeatures): WalletV6Provider {
  // get-starknet 6.0.3 resolves types-js 0.10.4-beta.1 while starknet.js 10.4.0's
  // V6 adapter resolves its bundled 0.10.3 alias. The runtime wallet-standard shape
  // is shared; keep the compatibility cast at this SDK boundary only.
  return wallet as unknown as WalletV6Provider;
}

function hasWalletApiFeature(wallet: WalletWithStarknetFeatures) {
  return Boolean((wallet.features as Record<string, unknown>)["starknet:walletApi"]);
}

function isConsentRejection(error: unknown) {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  return ["reject", "denied", "cancel", "declin"].some((word) => message.includes(word));
}

const stateLabels: Record<ConnectionState, string> = {
  disconnected: "Disconnected",
  discovering: "Looking for wallets",
  connecting: "Connecting",
  "privacy-capable": "STRK20 capable",
  "privacy-unsupported": "Connected · STRK20 unavailable",
  "capability-unknown": "Connected · capability unknown",
  "consent-required": "Connection needs consent",
  unavailable: "Unavailable",
};

export default function WalletConnectionPanel() {
  const [wallets, setWallets] = useState<WalletWithStarknetFeatures[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>("discovering");
  const [connectingWallet, setConnectingWallet] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<WalletSnapshot | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const store = createStore();
    const syncWallets = (discoveredWallets: readonly WalletWithStarknetFeatures[]) => {
      setWallets([...discoveredWallets]);
      setConnectionState((currentState) =>
        currentState === "discovering" ? "disconnected" : currentState,
      );
    };

    syncWallets(store.getWallets());
    return store.subscribe(syncWallets);
  }, []);

  const connectWallet = async (wallet: WalletWithStarknetFeatures) => {
    const rpcUrl = process.env.NEXT_PUBLIC_STARKNET_RPC_URL;

    setErrorMessage(null);
    setSnapshot(null);

    if (!rpcUrl) {
      setConnectionState("unavailable");
      setErrorMessage("Set NEXT_PUBLIC_STARKNET_RPC_URL before connecting a wallet.");
      return;
    }

    setConnectingWallet(wallet.name);
    setConnectionState("connecting");

    try {
      const v6Wallet = asWalletV6Provider(wallet);
      const account = await WalletAccountV6.connect({ nodeUrl: rpcUrl }, v6Wallet);
      const walletApiAvailable = hasWalletApiFeature(wallet);
      let apiVersions: string[] = [];
      let specs: string[] = [];
      let capabilityCheckSucceeded = !walletApiAvailable;

      if (walletApiAvailable) {
        try {
          [apiVersions, specs] = await Promise.all([
            walletV6.supportedWalletApi(v6Wallet),
            walletV6.supportedSpecs(v6Wallet),
          ]);
        } catch {
          capabilityCheckSucceeded = false;
        }
      }

      let chainId = "Unknown network";

      try {
        chainId = walletApiAvailable
          ? await walletV6.requestChainId(v6Wallet)
          : await account.provider.getChainId();
      } catch {
        // The connected account remains useful even when the wallet cannot report its chain.
      }

      const privacyCapable = capabilityCheckSucceeded && supportsStrk20(apiVersions, specs);
      const nextSnapshot: WalletSnapshot = {
        walletName: wallet.name,
        address: normalizeAddress(account.address),
        chainId,
        apiVersions,
        specs,
        privacyCapable,
      };

      setSnapshot(nextSnapshot);
      setConnectionState(
        capabilityCheckSucceeded
          ? privacyCapable
            ? "privacy-capable"
            : "privacy-unsupported"
          : "capability-unknown",
      );

      if (!capabilityCheckSucceeded) {
        setErrorMessage("Connected, but this wallet did not answer its capability query.");
      }
    } catch (error) {
      setConnectionState(isConsentRejection(error) ? "consent-required" : "unavailable");
      setErrorMessage(
        isConsentRejection(error)
          ? "Approve the connection in your wallet to continue."
          : "The wallet could not be connected. Check the wallet and RPC configuration.",
      );
    } finally {
      setConnectingWallet(null);
    }
  };

  const disconnectWallet = () => {
    setSnapshot(null);
    setErrorMessage(null);
    setConnectionState("disconnected");
  };

  return (
    <section className="wallet-section" aria-labelledby="wallet-heading">
      <div className="section-heading">
        <p className="eyebrow">Wallet access</p>
        <h2 id="wallet-heading">Connect the authority that makes Prism real.</h2>
        <p className="section-lede">
          Prism checks the wallet&apos;s declared Wallet API support before any private state is
          requested. A capable wallet can become the authority for Starknet execution and the
          STRK20 private surface.
        </p>
      </div>

      <div className={`wallet-card wallet-card--${connectionState}`}>
        <div className="wallet-card-header">
          <div>
            <span className="label">Connection state</span>
            <strong className="wallet-state">
              <span className="state-dot" aria-hidden="true" />
              {stateLabels[connectionState]}
            </strong>
          </div>
          {snapshot ? (
            <button className="text-button" type="button" onClick={disconnectWallet}>
              Disconnect
            </button>
          ) : null}
        </div>

        {snapshot ? (
          <div className="wallet-details">
            <div>
              <span className="label">Wallet</span>
              <strong>{snapshot.walletName}</strong>
            </div>
            <div>
              <span className="label">Account</span>
              <strong className="mono">{snapshot.address}</strong>
            </div>
            <div>
              <span className="label">Network</span>
              <strong className="mono">{snapshot.chainId}</strong>
            </div>
            <div>
              <span className="label">Declared Wallet API</span>
              <strong className="mono">
                {snapshot.apiVersions.length > 0 ? snapshot.apiVersions.join(", ") : "Not reported"}
              </strong>
            </div>
          </div>
        ) : (
          <div className="wallet-connect-content">
            <p>
              {wallets.length > 0
                ? "Choose a discovered Starknet wallet to continue."
                : "Install or unlock a Starknet wallet, then return here to connect."}
            </p>
            {wallets.length > 0 ? (
              <div className="wallet-list">
                {wallets.map((wallet) => (
                  <button
                    className="wallet-option"
                    disabled={connectionState === "connecting"}
                    key={wallet.name}
                    type="button"
                    onClick={() => connectWallet(wallet)}
                  >
                    <span>
                      <strong>{wallet.name}</strong>
                      <small>Starknet wallet</small>
                    </span>
                    <span className="wallet-option-action">
                      {connectingWallet === wallet.name ? "Connecting…" : "Connect"}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}

        {errorMessage ? <p className="wallet-message wallet-message--error">{errorMessage}</p> : null}
        <p className="wallet-message wallet-message--privacy">
          Capability detection uses supported API/spec queries only. Prism does not read shielded
          balances, viewing keys, private keys, or seed phrases in this step.
        </p>
      </div>
    </section>
  );
}
