/**
 * Read-only live-state surface (demo only, `?demo=livestate`).
 *
 * Reuses the privacy-flow wallet session machine:
 * connect -> capability detect -> session (sessionReducer +
 * StarknetWalletSessionAdapter over the mock provider). Once connected,
 * public chain state for the connected account + prism:8 is read through
 * the typed `LiveStateReader` port (read-only; no broadcast, no signing,
 * no spending). The private-balance slot stays consent-gated per the
 * existing consent design: blocked/fallback copy until a real consent
 * grant, never retaining keys/notes/proofs.
 */

"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createSessionReducerState, sessionReducer } from "../wallet/session/reducer";
import { selectSessionSnapshot } from "../wallet/session/selectors";
import {
  capabilitySummary,
  SESSION_STATE_GLYPHS,
  SESSION_STATE_LABELS,
  statusLine,
} from "../wallet/session/strings";
import {
  createStarknetWalletSession,
  denyConsent,
  requireConsent,
} from "../wallet/session/session-state";
import { StarknetWalletSessionAdapter } from "../wallet/session/starknet-wallet-adapter";
import { assertNoViewingKey } from "../prism-strk20/domain/privacy-guard";
import { isLiveStateDemoEnabled } from "./demoFlag";
import { buildConsentScope, decideConsent, type ConsentRecord, type ConsentScope } from "../privacy-flow/consent";
import { createStarknetWalletBoundary, createStarknetWalletDiscovery, type DiscoveredStarknetWallet } from "../wallet/session/starknet-wallet-provider";
import { createMockStarknetProvider, MOCK_SCENARIOS, MOCK_WALLET_LABELS, type MockWalletScenario } from "../privacy-flow/mockPrivacyWallet";
import {
  createBlockedLiveStateReader,
  type LiveStateReader,
} from "./liveStateAdapter";
import { createApiLiveStateReader } from "./apiLiveStateReader";
import { LIVE_STATE_FALLBACK_COPY, type LiveField, type LiveStateSnapshot } from "./liveStateTypes";
import styles from "./LiveStateTile.module.css";

function useDemoActive(): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    setActive(isLiveStateDemoEnabled(window.location.search));
  }, []);
  return active;
}

function useMockActive(): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setActive(params.get("demo") === "livestate-mock" || params.get("mock") === "livestate");
  }, []);
  return active;
}

function FieldCard({ field }: { field: LiveField }) {
  const tone = field.status === "live" ? "live" : "blocked";
  return (
    <div className={styles.field} data-testid={`live-field-${field.label}`}>
      <span className={styles.fieldLabel}>{field.label}</span>
      <span className={styles.badge} data-tone={tone}>
        {field.status === "live" ? "Live (read-only)" : field.status}
      </span>
      {field.status === "live" && field.value ? (
        <p className={styles.fieldValue}>{field.value}</p>
      ) : (
        <p className={styles.fieldFallback}>{field.fallback}</p>
      )}
    </div>
  );
}

export default function LiveStateTile({ reader }: { reader?: LiveStateReader }) {
  const [initial] = useState(() =>
    createSessionReducerState(
      createStarknetWalletSession({ now: Date.now(), expectedEnvironment: "SN_SEPOLIA" }),
    ),
  );
  const [state, dispatch] = useReducer(sessionReducer, initial);
  const [scenario, setScenario] = useState<MockWalletScenario>("supported-sepolia");
  const [wallets, setWallets] = useState<readonly DiscoveredStarknetWallet[]>([]);
  const [discoveryReady, setDiscoveryReady] = useState(false);
  const [activeWalletId, setActiveWalletId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [consentScope, setConsentScope] = useState<ConsentScope | null>(null);
  const [consentRecord, setConsentRecord] = useState<ConsentRecord | null>(null);
  const [snapshot, setSnapshot] = useState<LiveStateSnapshot | null>(null);
  const [reading, setReading] = useState(false);
  const activeBoundary = useRef<ReturnType<typeof createStarknetWalletBoundary> | null>(null);

  const sessionSnapshot = useMemo(() => selectSessionSnapshot(state), [state]);
  const { session, capabilities, state: uiState } = sessionSnapshot;
  const connected = session.accountAddress !== null;
  const consentGranted = session.consent.status === "granted";
  const discovery = useMemo(() => createStarknetWalletDiscovery(), []);
  const mockActive = useMockActive();

  useEffect(() => {
    if (mockActive) return;
    const sync = (next: readonly DiscoveredStarknetWallet[]) => {
      setWallets(next);
      setDiscoveryReady(true);
    };
    const unsubscribe = discovery.subscribe(sync);
    discovery.refresh();
    sync(discovery.getWallets());
    return unsubscribe;
  }, [discovery, mockActive]);
  const ready = uiState === "ready";
  const status = statusLine(uiState, {
    environment: session.environment,
    chainId: session.network.chainId,
    expectedEnvironment: session.expectedEnvironment,
    capabilitySummary: capabilitySummary(capabilities),
    blockNumber: null,
    reason: null,
  });

  // Read-only refresh through the typed port whenever session/consent changes.
  useEffect(() => {
    if (!connected || !ready) {
      setSnapshot(null);
      return;
    }
    setReading(true);
    // Default preview path reads real chain facts through the server-side
    // route (client never sees RPC URLs). Pass a mock/blocked reader
    // explicitly for deterministic tests or the all-blocked preview.
    const active: LiveStateReader = reader ?? createApiLiveStateReader();
    void active
      .readLiveState({ accountAddress: session.accountAddress, consentGranted })
      .then(setSnapshot)
      .finally(() => setReading(false));
  }, [connected, ready, consentGranted, session.accountAddress, reader]);

  const connectReal = (wallet: DiscoveredStarknetWallet) => {
    setBusy(true);
    setActiveWalletId(wallet.id);
    setConsentScope(null);
    setConsentRecord(null);
    setSnapshot(null);
    dispatch({ type: "connection-started", walletId: wallet.id });
    const rpcUrl = (process.env.NEXT_PUBLIC_STARKNET_RPC_URL ?? "").trim() || null;
    const boundary = createStarknetWalletBoundary(wallet, rpcUrl, "SN_SEPOLIA");
    activeBoundary.current = boundary;
    const adapter = new StarknetWalletSessionAdapter(boundary.provider, { expectedEnvironment: "SN_SEPOLIA" });
    void adapter.connect(Date.now())
      .then((observed) => dispatch({ type: "session-observed", session: observed, walletId: wallet.id }))
      .catch(() => dispatch({ type: "notice", notice: "Wallet connection failed. Try again." }))
      .finally(() => setBusy(false));
  };

  const connectMock = (next: MockWalletScenario) => {
    setScenario(next);
    setBusy(true);
    setConsentScope(null);
    setConsentRecord(null);
    setSnapshot(null);
    dispatch({ type: "connection-started", walletId: `mock-${next}` });
    const adapter = new StarknetWalletSessionAdapter(createMockStarknetProvider(next), {
      expectedEnvironment: "SN_SEPOLIA",
    });
    void adapter
      .connect(Date.now())
      .then((observed) => {
        dispatch({ type: "session-observed", session: observed, walletId: `mock-${next}` });
      })
      .finally(() => setBusy(false));
  };

  const disconnect = () => {
    setConsentScope(null);
    setConsentRecord(null);
    setSnapshot(null);
    void activeBoundary.current?.provider.disconnect?.();
    activeBoundary.current = null;
    dispatch({
      type: "session-disconnected",
      session: createStarknetWalletSession({ now: Date.now(), expectedEnvironment: "SN_SEPOLIA" }),
    });
  };

  const openConsent = () => {
    if (!connected) return;
    assertNoViewingKey({ tokens: ["STRK"], intent: "private_balance" }, "livestate_consent_open");
    const scope = buildConsentScope({
      tokens: ["STRK"],
      sessionAddress: session.accountAddress,
      now: Date.now(),
    });
    setConsentScope(scope);
    dispatch({
      type: "session-observed",
      session: requireConsent(session, Date.now()),
      walletId: `mock-${scenario}`,
    });
  };

  const resolveConsent = (decision: "granted" | "denied") => {
    if (!consentScope) return;
    const { session: next, record } = decideConsent(session, consentScope, decision, Date.now());
    setConsentRecord(record);
    setConsentScope(decision === "granted" ? null : consentScope);
    if (decision === "denied") {
      dispatch({ type: "session-observed", session: denyConsent(next, Date.now()), walletId: `mock-${scenario}` });
      return;
    }
    dispatch({ type: "session-observed", session: next, walletId: `mock-${scenario}` });
  };

  const fields: readonly LiveField[] | null = snapshot
    ? [snapshot.prismOwner, snapshot.baseBinding, snapshot.strkBalance, snapshot.baseEth]
    : null;

  return (
    <section aria-labelledby="livestate-heading" className={styles.flow} data-testid="live-state-tile">
      <div className={styles.flowHead}>
        <p className={styles.eyebrow}>Demo only · read-only · no broadcast</p>
        <h3 id="livestate-heading">Live chain state (read-only)</h3>
        <p className={styles.lede}>
          Same session machine as the privacy flow (connect → capability detect → session).
          Public state for the connected account and prism:8 reads through a typed adapter —
          read-only RPC/API only. Private balance stays consent-gated.
        </p>
      </div>

      <div className={styles.tile} data-tile="session">
        <p className={styles.tileEyebrow}>Session · connect → capability → session</p>
        <div className={styles.stateRow}>
          <strong>
            <span aria-hidden="true" className={styles.glyph}>{SESSION_STATE_GLYPHS[uiState]}</span>
            {SESSION_STATE_LABELS[uiState]}
          </strong>
          {session.accountAddress ? <code className={styles.mono}>{session.accountAddress.slice(0, 10)}…</code> : null}
        </div>
        <p aria-live="polite" className={styles.status}>{status}</p>
        <div className={styles.walletGrid} role="list">
          {mockActive ? MOCK_SCENARIOS.map((option) => (
            <button
              className={styles.walletOption}
              data-active={scenario === option && connected}
              disabled={busy}
              key={option}
              onClick={() => connectMock(option)}
              role="listitem"
              type="button"
            >
              {MOCK_WALLET_LABELS[option]} (mock)
            </button>
          )) : wallets.map((wallet) => (
            <button
              className={styles.walletOption}
              data-active={activeWalletId === wallet.id && connected}
              disabled={busy}
              key={wallet.id}
              onClick={() => connectReal(wallet)}
              role="listitem"
              type="button"
            >
              Connect {wallet.name}
            </button>
          ))}
        </div>
        {!mockActive && discoveryReady && wallets.length === 0 ? (
          <p className={styles.blocked} role="status">
            No Starknet wallet detected. Install Ready, Xverse, or AVNU, then reload this page.
          </p>
        ) : null}
        <div className={styles.ctaRow}>
          {connected ? (
            <button className={styles.ghost} onClick={disconnect} type="button">
              Disconnect
            </button>
          ) : null}
        </div>
      </div>

      <div className={styles.tile} data-tile="public-state">
        <p className={styles.tileEyebrow}>Public chain state · prism:8 + connected account</p>
        {!connected || !ready ? (
          <p className={styles.blocked} role="status">{LIVE_STATE_FALLBACK_COPY["not-connected"]}</p>
        ) : reading && !snapshot ? (
          <p className={styles.blocked} role="status">{LIVE_STATE_FALLBACK_COPY.loading}</p>
        ) : fields ? (
          <div className={styles.fieldGrid}>
            {fields.map((field) => (
              <FieldCard field={field} key={field.label} />
            ))}
          </div>
        ) : null}
        <p className={styles.meta}>
          Registry V2 0x06f77b…530d · owner 0x47c0f8…131c · bound Base Sepolia EOA 0xCf3E…e23 (EVD-PRISM-005/006).
          Reads are read-only; blocked states render fallback copy and claim no value.
        </p>
      </div>

      <div className={styles.tile} data-tile="private-balance">
        <p className={styles.tileEyebrow}>Private balance · consent-gated</p>
        {!connected ? (
          <p className={styles.blocked} role="status">{LIVE_STATE_FALLBACK_COPY["not-connected"]}</p>
        ) : !consentGranted ? (
          <>
            <p className={styles.blocked} role="status">{LIVE_STATE_FALLBACK_COPY["consent-required"]}</p>
            <div className={styles.ctaRow}>
              <button className={styles.primary} onClick={openConsent} type="button">
                Review &amp; sign consent
              </button>
            </div>
          </>
        ) : snapshot?.privateBalance.status === "live" && snapshot.privateBalance.value ? (
          <p className={styles.fieldValue}>{snapshot.privateBalance.value}</p>
        ) : (
          <p className={styles.blocked} role="status">{LIVE_STATE_FALLBACK_COPY.blocked}</p>
        )}
        {consentRecord ? (
          <p className={styles.meta}>
            Consent {consentRecord.decision} · {consentRecord.consentReference} · no key, note, or proof retained.
          </p>
        ) : null}
      </div>

      {consentScope ? (
        <div className={styles.interstitial} role="dialog" aria-modal="true" aria-labelledby="livestate-consent-title">
          <div className={styles.interstitialCard}>
            <p className={styles.eyebrow}>Consent required</p>
            <h4 id="livestate-consent-title">Reveal private balance?</h4>
            <p>Allow this session to reveal the shielded balance preview for:</p>
            <ul>
              <li>Tokens: {consentScope.tokens.join(", ")}</li>
              <li>Session: {consentScope.sessionAddress ?? "none"}</li>
              <li>Requested: {new Date(consentScope.requestedAt).toISOString()}</li>
            </ul>
            <p className={styles.meta}>No key, note, or proof is stored. Denial keeps the slot blocked.</p>
            <div className={styles.ctaRow}>
              <button className={styles.primary} onClick={() => resolveConsent("granted")} type="button">Grant</button>
              <button className={styles.ghost} onClick={() => resolveConsent("denied")} type="button">Deny</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Gated slot: renders nothing unless `?demo=livestate` (aliases: live-state, live). */
export function LiveStateDemoSlot({ reader }: { reader?: LiveStateReader }) {
  const active = useDemoActive();
  if (!active) return null;
  // Default preview path reads real chain facts through the server-side
  // route; pass `createBlockedLiveStateReader()` (or the mock reader) to
  // preview the all-blocked fallback copy or deterministic fixtures.
  void createBlockedLiveStateReader;
  return <LiveStateTile reader={reader} />;
}
