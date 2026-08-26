import type { PrivacyWalletSession, StarknetWalletSession } from "./types";

import { SESSION_STRINGS } from "./strings";

export type SessionPhase = "idle" | "discovering" | "connecting" | "refreshing";

export interface DiscoveredWalletOption {
  readonly id: string;
  readonly name: string;
}

export interface SessionReducerState {
  readonly phase: SessionPhase;
  readonly wallets: readonly DiscoveredWalletOption[];
  readonly activeWalletId: string | null;
  /** The authoritative SDK-neutral session contract. */
  readonly session: StarknetWalletSession;
  /** An optional observed privacy operation; it is never advanced by this reducer. */
  readonly operation: PrivacyWalletSession | null;
  readonly notice: string | null;
}

export type SessionReducerAction =
  | { readonly type: "discovery-started" }
  | { readonly type: "discovery-finished"; readonly wallets: readonly DiscoveredWalletOption[] }
  | { readonly type: "wallets-updated"; readonly wallets: readonly DiscoveredWalletOption[] }
  | { readonly type: "connection-started"; readonly walletId: string }
  | { readonly type: "refresh-started" }
  | { readonly type: "session-observed"; readonly session: StarknetWalletSession; readonly walletId?: string | null }
  | { readonly type: "session-refreshed"; readonly session: StarknetWalletSession }
  | { readonly type: "session-disconnected"; readonly session: StarknetWalletSession }
  | { readonly type: "operation-observed"; readonly operation: PrivacyWalletSession | null }
  | { readonly type: "notice"; readonly notice: string | null };

export function createSessionReducerState(session: StarknetWalletSession): SessionReducerState {
  return {
    phase: "idle",
    wallets: [],
    activeWalletId: null,
    session,
    operation: null,
    notice: null,
  };
}

function withoutNotice(state: SessionReducerState): SessionReducerState {
  return state.notice === null ? state : { ...state, notice: null };
}

export function sessionReducer(
  state: SessionReducerState,
  action: SessionReducerAction,
): SessionReducerState {
  switch (action.type) {
    case "discovery-started":
      return {
        ...state,
        phase: "discovering",
        wallets: [],
        activeWalletId: null,
        operation: null,
        notice: null,
      };
    case "discovery-finished":
      return {
        ...state,
        phase: "idle",
        wallets: [...action.wallets],
        notice: action.wallets.length === 0 ? SESSION_STRINGS.noWallet : null,
      };
    case "wallets-updated":
      return { ...state, wallets: [...action.wallets] };
    case "connection-started":
      return {
        ...withoutNotice(state),
        phase: "connecting",
        activeWalletId: action.walletId,
        operation: null,
      };
    case "refresh-started":
      return { ...withoutNotice(state), phase: "refreshing" };
    case "session-observed":
      return {
        ...withoutNotice(state),
        phase: "idle",
        activeWalletId: action.session.accountAddress === null ? null : action.walletId ?? state.activeWalletId,
        session: action.session,
        operation: null,
      };
    case "session-refreshed": {
      const accountChanged = state.session.accountAddress !== action.session.accountAddress;
      return {
        ...withoutNotice(state),
        phase: "idle",
        activeWalletId: action.session.accountAddress === null ? null : state.activeWalletId,
        session: action.session,
        operation: accountChanged ? null : state.operation,
      };
    }
    case "session-disconnected":
      return {
        ...withoutNotice(state),
        phase: "idle",
        activeWalletId: null,
        session: action.session,
        operation: null,
      };
    case "operation-observed":
      return { ...state, operation: action.operation };
    case "notice":
      return { ...state, notice: action.notice };
    default:
      return state;
  }
}
