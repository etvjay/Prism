"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import {
  asProviderFailure,
  WALLET_SESSION_ERROR_CODE,
} from "./errors";
import {
  createStarknetWalletSession,
  errorSession,
} from "./session-state";
import {
  createSessionReducerState,
  sessionReducer,
  type DiscoveredWalletOption,
  type SessionReducerState,
} from "./reducer";
import {
  environmentLabel,
  selectSessionSnapshot,
  type CapabilitySlot,
  type ReceiptProjection,
  type SessionSnapshot,
  type SessionUiState,
} from "./selectors";
import { getExpectedWalletEnvironment } from "../../prism-strk20/domain/wallet-capability";
import {
  createStarknetWalletBoundary,
  createStarknetWalletDiscovery,
  type DiscoveredStarknetWallet,
  type StarknetWalletBoundary,
  type StarknetWalletDiscovery,
} from "./starknet-wallet-provider";
import {
  StarknetWalletSessionAdapter,
  type StarknetWalletSessionProvider,
} from "./starknet-wallet-adapter";
import { SESSION_STRINGS } from "./strings";
import type { PrivacyWalletSession, StarknetWalletSession } from "./types";
import type { M5Provider } from "../../prism-strk20/m5/ports";

export interface SessionProviderProps {
  readonly children: ReactNode;
  readonly expectedEnvironment?: string | null;
  readonly rpcUrl?: string | null;
  /** Optional operation state supplied by the existing privacy state machine. */
  readonly operation?: PrivacyWalletSession | null;
}

export interface SessionContextValue {
  readonly state: SessionReducerState;
  readonly snapshot: SessionSnapshot;
  readonly uiState: SessionUiState;
  readonly capabilities: readonly CapabilitySlot[];
  readonly receipt: ReceiptProjection | null;
  readonly wallets: readonly DiscoveredWalletOption[];
  readonly notice: string | null;
  readonly startDiscovery: () => void;
  readonly connectWallet: (walletId: string) => void;
  readonly disconnect: () => void;
  readonly switchNetwork: () => void;
  readonly getM5Provider: () => M5Provider | null;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function walletErrorNotice(session: StarknetWalletSession): string | null {
  if (session.error === null) return null;
  if (session.error.code === WALLET_SESSION_ERROR_CODE.CONSENT_DENIED) {
    return SESSION_STRINGS.consentDenied;
  }
  return SESSION_STRINGS.connectionFailed;
}

function walletIdFor(discoveredWallet: DiscoveredStarknetWallet): string {
  return discoveredWallet.id;
}

function hasNoAccounts(change: unknown): boolean {
  if (!change || typeof change !== "object") return false;
  const accounts = (change as { readonly accounts?: unknown }).accounts;
  return Array.isArray(accounts) && accounts.length === 0;
}

export function SessionProvider({
  children,
  expectedEnvironment: configuredEnvironment,
  rpcUrl: configuredRpcUrl,
  operation = null,
}: SessionProviderProps) {
  const expectedEnvironment = getExpectedWalletEnvironment(
    configuredEnvironment ?? process.env.NEXT_PUBLIC_STARKNET_NETWORK,
  );
  const rpcUrl = (configuredRpcUrl ?? process.env.NEXT_PUBLIC_STARKNET_RPC_URL ?? "").trim() || null;
  const initialSessionRef = useRef<StarknetWalletSession | null>(null);
  if (initialSessionRef.current === null) {
    initialSessionRef.current = createStarknetWalletSession({
      now: Date.now(),
      expectedEnvironment,
    });
  }

  const [state, dispatch] = useReducer(
    sessionReducer,
    initialSessionRef.current,
    createSessionReducerState,
  );
  const stateRef = useRef(state);
  const discoveryRef = useRef<StarknetWalletDiscovery | null>(null);
  const discoveryUnsubscribeRef = useRef<(() => void) | null>(null);
  const walletMapRef = useRef(new Map<string, DiscoveredStarknetWallet>());
  const activeBoundaryRef = useRef<StarknetWalletBoundary | null>(null);
  const activeAdapterRef = useRef<StarknetWalletSessionAdapter | null>(null);
  const activeUnsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    dispatch({ type: "operation-observed", operation });
  }, [operation]);

  const clearActiveBoundary = useCallback(() => {
    activeUnsubscribeRef.current?.();
    activeUnsubscribeRef.current = null;
    activeBoundaryRef.current = null;
    activeAdapterRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      discoveryUnsubscribeRef.current?.();
      activeUnsubscribeRef.current?.();
    };
  }, []);

  const refreshFromBoundary = useCallback(async (
    adapter: StarknetWalletSessionAdapter,
    changeTriggered: boolean,
  ) => {
    const current = stateRef.current.session;
    if (current.accountAddress === null) return;
    if (changeTriggered) dispatch({ type: "refresh-started" });
    const refreshed = await adapter.refresh(current, Date.now());
    dispatch({ type: "session-refreshed", session: refreshed });
  }, []);

  const subscribeToBoundary = useCallback((
    boundary: StarknetWalletBoundary,
    adapter: StarknetWalletSessionAdapter,
  ) => {
    activeUnsubscribeRef.current?.();
    activeUnsubscribeRef.current = boundary.subscribe((change) => {
      if (hasNoAccounts(change)) {
        void adapter.disconnect(stateRef.current.session, Date.now()).then((disconnected) => {
          clearActiveBoundary();
          dispatch({ type: "session-disconnected", session: disconnected });
        });
        return;
      }
      void refreshFromBoundary(adapter, true).catch(() => {
        dispatch({ type: "notice", notice: SESSION_STRINGS.connectionFailed });
      });
    });
  }, [clearActiveBoundary, refreshFromBoundary]);

  const connectWallet = useCallback((walletId: string) => {
    const discoveredWallet = walletMapRef.current.get(walletId);
    if (!discoveredWallet) return;
    dispatch({ type: "connection-started", walletId });

    if (!rpcUrl) {
      const failed = errorSession(
        createStarknetWalletSession({
          now: Date.now(),
          expectedEnvironment,
          walletName: discoveredWallet.name,
        }),
        WALLET_SESSION_ERROR_CODE.PROVIDER_FAILURE,
        "starknet_rpc_unavailable",
        Date.now(),
      );
      dispatch({ type: "session-observed", session: failed, walletId });
      dispatch({ type: "notice", notice: SESSION_STRINGS.walletRpcUnavailable });
      return;
    }

    const boundary = createStarknetWalletBoundary(discoveredWallet, rpcUrl, expectedEnvironment);
    const adapter = new StarknetWalletSessionAdapter(boundary.provider, { expectedEnvironment });
    activeBoundaryRef.current = boundary;
    activeAdapterRef.current = adapter;

    void adapter.connect(Date.now()).then((connected) => {
      dispatch({ type: "session-observed", session: connected, walletId });
      if (connected.accountAddress !== null && connected.error === null) {
        subscribeToBoundary(boundary, adapter);
      }
    }).catch((error: unknown) => {
      const mapped = asProviderFailure(error);
      const failed = errorSession(
        createStarknetWalletSession({
          now: Date.now(),
          expectedEnvironment,
          walletName: discoveredWallet.name,
        }),
        mapped.code,
        mapped.detail ?? "starknet_connect_failed",
        Date.now(),
      );
      dispatch({ type: "session-observed", session: failed, walletId });
      clearActiveBoundary();
    });
  }, [clearActiveBoundary, expectedEnvironment, rpcUrl, subscribeToBoundary]);

  const startDiscovery = useCallback(() => {
    dispatch({ type: "discovery-started" });
    const discovery = discoveryRef.current ?? createStarknetWalletDiscovery();
    discoveryRef.current = discovery;
    discoveryUnsubscribeRef.current?.();

    const syncWallets = (
      wallets: readonly DiscoveredStarknetWallet[],
      finishDiscovery = false,
    ) => {
      walletMapRef.current = new Map(wallets.map((wallet) => [walletIdFor(wallet), wallet]));
      const options = wallets.map(({ id, name }) => ({ id, name }));
      dispatch({ type: "wallets-updated", wallets: options });
      if (finishDiscovery || stateRef.current.phase === "discovering") {
        dispatch({ type: "discovery-finished", wallets: options });
        if (wallets.length === 1) connectWallet(wallets[0].id);
      }
    };

    discoveryUnsubscribeRef.current = discovery.subscribe((wallets) => syncWallets(wallets));
    syncWallets(discovery.getWallets(), true);
  }, [connectWallet]);

  const disconnect = useCallback(() => {
    const adapter = activeAdapterRef.current;
    const current = stateRef.current.session;
    if (!adapter || current.accountAddress === null) {
      clearActiveBoundary();
      dispatch({ type: "session-disconnected", session: createStarknetWalletSession({ now: Date.now(), expectedEnvironment }) });
      return;
    }
    void adapter.disconnect(current, Date.now()).then((disconnected) => {
      clearActiveBoundary();
      dispatch({ type: "session-disconnected", session: disconnected });
    });
  }, [clearActiveBoundary, expectedEnvironment]);

  const switchNetwork = useCallback(() => {
    const boundary = activeBoundaryRef.current;
    const adapter = activeAdapterRef.current;
    if (!boundary || !adapter) return;
    dispatch({ type: "refresh-started" });
    void boundary.switchNetwork().then((switched) => {
      if (!switched) {
        dispatch({ type: "notice", notice: SESSION_STRINGS.networkSwitchFailed });
        dispatch({ type: "session-refreshed", session: stateRef.current.session });
        return;
      }
      return refreshFromBoundary(adapter, false);
    }).catch(() => {
      dispatch({ type: "notice", notice: SESSION_STRINGS.networkSwitchFailed });
      dispatch({ type: "session-refreshed", session: stateRef.current.session });
    });
  }, [refreshFromBoundary]);

  const getM5Provider = useCallback(() => activeBoundaryRef.current?.getM5Provider() ?? null, []);

  const snapshot = useMemo(() => selectSessionSnapshot(state), [state]);
  const notice = state.notice ?? walletErrorNotice(state.session);
  const value = useMemo<SessionContextValue>(() => ({
    state,
    snapshot,
    uiState: snapshot.state,
    capabilities: snapshot.capabilities,
    receipt: snapshot.receipt,
    wallets: state.wallets,
    notice,
    startDiscovery,
    connectWallet,
    disconnect,
    switchNetwork,
    getM5Provider,
  }), [connectWallet, disconnect, getM5Provider, notice, snapshot, startDiscovery, state, switchNetwork]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (context === null) {
    throw new Error("useSession must be used inside SessionProvider");
  }
  return context;
}

export function useSessionState(): SessionSnapshot {
  return useSession().snapshot;
}

export function expectedEnvironmentText(session: StarknetWalletSession): string {
  return environmentLabel(session.expectedEnvironment);
}

export type { StarknetWalletSessionProvider };
