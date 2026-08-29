import {
  WALLET_SESSION_ERROR_CODE,
  asProviderFailure,
  isUserConsentRejection,
  WalletSessionError,
} from "./errors";
import { assertNoSecretMaterial } from "./no-secrets";
import {
  applyStarknetObservation,
  clearAuthorityState,
  createStarknetWalletSession,
  errorSession,
} from "./session-state";
import type { ExpectedWalletEnvironment } from "../../prism-strk20/domain/wallet-capability";
import type { StarknetWalletSession, WalletSessionAdapter } from "./types";

/**
 * SDK-neutral Starknet wallet surface. WalletConnectionPanel can map its
 * WalletAccountV6/walletV6 helpers into this port later without importing any
 * provider or discovery package into the session domain.
 */
export interface StarknetWalletSessionProvider {
  readonly name?: string;
  connect(): Promise<{ readonly address: string }>;
  /** Silent re-read used for account/network change events. */
  getSession?(): Promise<{ readonly address: string } | null>;
  disconnect?(): Promise<void>;
  supportedWalletApi(): Promise<readonly string[]>;
  supportedSpecs(): Promise<readonly string[]>;
  requestChainId(): Promise<string>;
}

export interface StarknetWalletSessionAdapterOptions {
  readonly expectedEnvironment?: ExpectedWalletEnvironment | string | null;
}

export class StarknetWalletSessionAdapter implements WalletSessionAdapter<StarknetWalletSession> {
  readonly venue = "starknet" as const;
  private readonly expectedEnvironment: ExpectedWalletEnvironment;

  constructor(
    private readonly provider: StarknetWalletSessionProvider,
    options: StarknetWalletSessionAdapterOptions = {},
  ) {
    assertNoSecretMaterial(provider, "starknet_provider");
    assertNoSecretMaterial(options, "starknet_adapter_options");
    if (!provider || typeof provider.connect !== "function") {
      throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.PROVIDER_FAILURE, "starknet_connect_required");
    }
    if (typeof provider.supportedWalletApi !== "function" || typeof provider.supportedSpecs !== "function") {
      throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.CAPABILITY_UNKNOWN, "capability_queries_required");
    }
    if (typeof provider.requestChainId !== "function") {
      throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.NETWORK_UNKNOWN, "chain_id_query_required");
    }
    this.expectedEnvironment = (options.expectedEnvironment === "SN_MAIN" ? "SN_MAIN" : "SN_SEPOLIA");
  }

  async connect(now: number): Promise<StarknetWalletSession> {
    let session = createStarknetWalletSession({
      now,
      expectedEnvironment: this.expectedEnvironment,
      walletName: this.provider.name ?? null,
    });
    try {
      const account = await this.provider.connect();
      const [apiVersions, specs, chainId] = await Promise.all([
        this.provider.supportedWalletApi(),
        this.provider.supportedSpecs(),
        this.provider.requestChainId(),
      ]);
      return applyStarknetObservation(session, {
        accountAddress: account.address,
        chainId,
        apiVersions,
        specs,
        walletName: this.provider.name ?? null,
      }, now);
    } catch (error) {
      const refused = isUserConsentRejection(error);
      const mapped = refused
        ? new WalletSessionError(WALLET_SESSION_ERROR_CODE.CONSENT_DENIED, "wallet_connection_denied")
        : asProviderFailure(error);
      session = errorSession(
        session,
        mapped.code,
        mapped.detail ?? "starknet_connect_failed",
        now,
        refused ? "consent-required" : "unknown",
      );
      return session;
    }
  }

  /** Re-read only non-secret account/capability/network facts from the provider. */
  async refresh(session: StarknetWalletSession, now: number): Promise<StarknetWalletSession> {
    if (session.venue !== this.venue) {
      throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.VENUE_MISMATCH, "starknet_session_required");
    }
    if (!session.accountAddress) {
      throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.PROVIDER_DISCONNECTED, "account_required_for_refresh");
    }
    try {
      const observedAccount = this.provider.getSession
        ? await this.provider.getSession()
        : { address: session.accountAddress };
      if (observedAccount === null) {
        return clearAuthorityState(session, now);
      }
      const [apiVersions, specs, chainId] = await Promise.all([
        this.provider.supportedWalletApi(),
        this.provider.supportedSpecs(),
        this.provider.requestChainId(),
      ]);
      return applyStarknetObservation(session, {
        accountAddress: observedAccount.address,
        chainId,
        apiVersions,
        specs,
        walletName: this.provider.name ?? session.walletName,
      }, now);
    } catch (error) {
      const mapped = asProviderFailure(error);
      return errorSession(session, mapped.code, mapped.detail ?? "starknet_refresh_failed", now);
    }
  }

  async disconnect(session: StarknetWalletSession, now: number): Promise<StarknetWalletSession> {
    if (session.venue !== this.venue) {
      throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.VENUE_MISMATCH, "starknet_session_required");
    }
    try {
      await this.provider.disconnect?.();
    } catch {
      // Local authority is cleared even when a provider fails to acknowledge it.
    }
    return clearAuthorityState(session, now);
  }

  accountChanged(session: StarknetWalletSession, now: number): StarknetWalletSession {
    if (session.venue !== this.venue) {
      throw new WalletSessionError(WALLET_SESSION_ERROR_CODE.VENUE_MISMATCH, "starknet_session_required");
    }
    return clearAuthorityState(session, now);
  }
}

/** Short alias for consumers that use the adapter name without “Session”. */
export { StarknetWalletSessionAdapter as StarknetWalletAdapter };
