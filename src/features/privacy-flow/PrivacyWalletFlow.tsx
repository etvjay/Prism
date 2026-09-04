/**
 * Prism privacy wallet flow (demo only, `?demo=privacy`).
 *
 * IA placement (frozen — no 5th tab):
 *   Overview private tile  → wallet connect + SessionUiState + shield intent
 *   Connections group       → supportedWalletApi / supportedSpecs capability row
 *   Receipt tail            → SUCCEEDED + ACCEPTED + block + pool, or pending
 *
 * All wallet calls stop at the adapter boundary: the session reducer and
 * `StarknetWalletSessionAdapter` run against typed mocks. No live chain
 * call, no balance probe, no key/note/proof retention.
 */

"use client";

import { useEffect, useMemo, useReducer, useState } from "react";
import { createSessionReducerState, sessionReducer } from "../wallet/session/reducer";
import {
  formatObservedAddress,
  formatObservedHash,
  selectSessionSnapshot,
} from "../wallet/session/selectors";
import {
  capabilityGlyph,
  capabilitySummary,
  ctaLabel,
  SESSION_STATE_GLYPHS,
  SESSION_STATE_LABELS,
  SESSION_STRINGS,
  statusLine,
} from "../wallet/session/strings";
import {
  createStarknetWalletSession,
  denyConsent,
  requireConsent,
} from "../wallet/session/session-state";
import { StarknetWalletSessionAdapter } from "../wallet/session/starknet-wallet-adapter";
import { assertNoViewingKey } from "../prism-strk20/domain/privacy-guard";
import { isPrivacyDemoEnabled } from "./demoFlag";
import {
  buildConsentScope,
  consentBindingLine,
  decideConsent,
  type ConsentRecord,
  type ConsentScope,
} from "./consent";
import {
  createMockStarknetProvider,
  mockTwoHashActivity,
  MOCK_CONFIRMED_BLOCK,
  MOCK_MATURITY_TARGET_BLOCK,
  MOCK_POOL_LABEL,
  MOCK_SCENARIOS,
  MOCK_WALLET_LABELS,
  type ActivityEntry,
  type ActivityTone,
  type MockWalletScenario,
} from "./mockPrivacyWallet";
import {
  canRequestShield,
  createShieldIntent,
  SHIELD_TOKENS,
  twoHashSlots,
  validateShieldAmount,
  type ShieldIntent,
} from "./shieldIntent";
import styles from "./PrivacyWalletFlow.module.css";

function useDemoActive(): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    setActive(isPrivacyDemoEnabled(window.location.search));
  }, []);
  return active;
}

const BLOCKED_TERMINAL_COPY: Record<string, string> = {
  unknown: "Capability versions were not returned. Re-detect before continuing — readiness is not shown.",
  unsupported: "This wallet does not expose the capabilities this app needs. Disconnect; no action continues.",
  "wrong-network": "This app runs on Starknet Sepolia. Switch networks in your wallet; nothing continues here.",
};

export default function PrivacyWalletFlow() {
  const [initial] = useState(() =>
    createSessionReducerState(
      createStarknetWalletSession({ now: Date.now(), expectedEnvironment: "SN_SEPOLIA" }),
    ),
  );
  const [state, dispatch] = useReducer(sessionReducer, initial);
  const [scenario, setScenario] = useState<MockWalletScenario>("supported-sepolia");
  const [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState<ShieldIntent>(() => createShieldIntent("STRK"));
  const [consentScope, setConsentScope] = useState<ConsentScope | null>(null);
  const [consentRecord, setConsentRecord] = useState<ConsentRecord | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [activityTone, setActivityTone] = useState<ActivityTone>("confirmed");

  const snapshot = useMemo(() => selectSessionSnapshot(state), [state]);
  const { session, capabilities, state: uiState } = snapshot;
  const connected = session.accountAddress !== null;
  const consentGranted = session.consent.status === "granted";
  const addressLabel = formatObservedAddress(session.accountAddress);

  const status = statusLine(uiState, {
    environment: session.environment,
    chainId: session.network.chainId,
    expectedEnvironment: session.expectedEnvironment,
    capabilitySummary: capabilitySummary(capabilities),
    blockNumber: null,
    reason: null,
  });
  const cta = ctaLabel(uiState, session.expectedEnvironment);
  const ctaDisabled =
    busy || uiState === "discovering" || uiState === "connecting" || uiState === "unsupported" || uiState === "processing";
  const blockedTerminal =
    uiState === "capability-unknown" || uiState === "unsupported" || uiState === "wrong-network"
      ? (BLOCKED_TERMINAL_COPY[uiState === "capability-unknown" ? "unknown" : uiState] ?? null)
      : null;
  const amountCheck = validateShieldAmount(intent.amount);
  const canShield = canRequestShield(intent, consentGranted, connected);
  const slots = twoHashSlots(intent, submitted);
  const activity: readonly ActivityEntry[] = useMemo(
    () => (submitted ? mockTwoHashActivity(activityTone) : []),
    [submitted, activityTone],
  );

  const connectMock = (next: MockWalletScenario) => {
    setScenario(next);
    setBusy(true);
    setSubmitted(false);
    setConsentScope(null);
    setConsentRecord(null);
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

  const disconnectMock = () => {
    setSubmitted(false);
    setConsentScope(null);
    setConsentRecord(null);
    dispatch({
      type: "session-disconnected",
      session: createStarknetWalletSession({ now: Date.now(), expectedEnvironment: "SN_SEPOLIA" }),
    });
  };

  const openConsent = () => {
    if (!connected) return;
    assertNoViewingKey({ tokens: [intent.token], intent }, "shield_consent_open");
    const scope = buildConsentScope({
      tokens: [intent.token],
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

  const requestShield = () => {
    if (!canShield) return;
    setSubmitted(true);
    setActivityTone("confirmed");
  };

  return (
    <section aria-labelledby="privacy-flow-heading" className={styles.flow} data-testid="privacy-wallet-flow">
      <div className={styles.flowHead}>
        <p className={styles.eyebrow}>Demo only · no live action</p>
        <h3 id="privacy-flow-heading">Privacy wallet flow</h3>
        <p className={styles.lede}>
          Mock wallets stop at the adapter boundary. Connect a demo wallet, review capabilities,
          sign the consent interstitial, then preview the two-hash shield and receipt tail.
        </p>
      </div>

      {/* Overview private tile: wallet connect + SessionUiState */}
      <div className={styles.tile} data-tile="overview">
        <p className={styles.tileEyebrow}>Overview · session tile</p>
        <div className={styles.stateRow}>
          <strong>
            <span aria-hidden="true" className={styles.glyph}>{SESSION_STATE_GLYPHS[uiState]}</span>
            {SESSION_STATE_LABELS[uiState]}
          </strong>
          {addressLabel ? <code className={styles.mono}>{addressLabel}</code> : null}
        </div>
        <p aria-live="polite" className={styles.status}>{status}</p>
        <div className={styles.walletGrid} role="list">
          {MOCK_SCENARIOS.map((option) => (
            <button
              className={styles.walletOption}
              data-active={scenario === option && connected}
              disabled={busy}
              key={option}
              onClick={() => connectMock(option)}
              role="listitem"
              type="button"
            >
              {MOCK_WALLET_LABELS[option]}
            </button>
          ))}
        </div>
        <div className={styles.ctaRow}>
          <button className={styles.primary} disabled={ctaDisabled} type="button">
            {busy ? "Connecting…" : cta}
          </button>
          {connected ? (
            <button className={styles.ghost} onClick={disconnectMock} type="button">
              {SESSION_STRINGS.disconnect}
            </button>
          ) : null}
        </div>
        {blockedTerminal ? <p className={styles.blocked} role="alert">{blockedTerminal}</p> : null}
      </div>

      {/* Connections group: capability row */}
      <div className={styles.tile} data-tile="connections">
        <p className={styles.tileEyebrow}>Connections · capability group</p>
        {capabilities.length === 0 ? (
          <div aria-label={SESSION_STRINGS.checkingCapabilities} className={styles.capabilityList} role="list">
            {[0, 1, 2].map((slot) => (
              <span className={styles.capabilitySkeleton} key={slot} role="listitem" />
            ))}
          </div>
        ) : (
          <div aria-label={SESSION_STRINGS.observedCapabilities} className={styles.capabilityList} role="list">
            {capabilities.map((capability) => (
              <span
                className={`${styles.capability} ${styles[`capability--${capability.status}`]}`}
                key={capability.id}
                role="listitem"
              >
                <span aria-hidden="true">{capabilityGlyph(capability.status)}</span>
                {capability.label}
              </span>
            ))}
          </div>
        )}
        <p className={styles.meta}>Threshold: any declared version ≥ 0.10.3 across supportedWalletApi / supportedSpecs. Detection reads versions only.</p>
      </div>

      {/* Shield intent form */}
      <div className={styles.tile} data-tile="shield">
        <p className={styles.tileEyebrow}>Overview · shield intent</p>
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Token</span>
            <select
              onChange={(event) => setIntent({ ...intent, token: event.target.value as ShieldIntent["token"] })}
              value={intent.token}
            >
              {SHIELD_TOKENS.map((token) => (
                <option key={token} value={token}>{token}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Amount</span>
            <input
              inputMode="decimal"
              onChange={(event) => setIntent({ ...intent, amount: event.target.value })}
              placeholder="0.0"
              value={intent.amount}
            />
          </label>
        </div>
        {!amountCheck.ok && intent.amount.length > 0 ? <p className={styles.fieldError}>{amountCheck.error}</p> : null}
        <p className={styles.meta}>Fee quote: <strong>{intent.feeLabel}</strong> · read fresh at request time, never hard-coded into a receipt.</p>
        {!consentGranted ? (
          <button className={styles.primary} disabled={!connected} onClick={openConsent} type="button">
            {SESSION_STRINGS.reviewSign}
          </button>
        ) : (
          <button className={styles.primary} disabled={!canShield} onClick={requestShield} type="button">
            Request shield (mock)
          </button>
        )}
        {consentRecord ? <p className={styles.meta}>Consent {consentRecord.decision}: {consentBindingLine(consentRecord)}</p> : null}
        <div className={styles.hashSlots}>
          {slots.map((slot) => (
            <div className={styles.hashSlot} key={slot.slot}>
              <span>{slot.label}</span>
              <code className={styles.mono}>{slot.transactionHash ? formatObservedHash(slot.transactionHash) : "— pending —"}</code>
            </div>
          ))}
        </div>
      </div>

      {/* Receipt / activity tail */}
      <div className={styles.tile} data-tile="activity">
        <p className={styles.tileEyebrow}>Activity · receipt tail</p>
        {activity.length === 0 ? (
          <p className={styles.meta}>No reconciled operations or receipts have been observed. Submitted is not complete.</p>
        ) : (
          <>
            <div className={styles.toneRow} role="group" aria-label="Receipt preview tone">
              {(["confirmed", "pending", "reverted"] as const).map((tone) => (
                <button
                  className={styles.tone}
                  data-active={activityTone === tone}
                  key={tone}
                  onClick={() => setActivityTone(tone)}
                  type="button"
                >
                  {tone}
                </button>
              ))}
            </div>
            <ol className={styles.activity}>
              {activity.map((entry) => (
                <li className={styles[`activity--${entry.tone}`]} key={entry.slot}>
                  <strong>{entry.slot}</strong>
                  <code className={styles.mono}>{formatObservedHash(entry.transactionHash)}</code>
                  {entry.tone === "confirmed" ? (
                    <span>SUCCEEDED · ACCEPTED_ON_L2 · block {MOCK_CONFIRMED_BLOCK} · pool {MOCK_POOL_LABEL} · mature at {MOCK_MATURITY_TARGET_BLOCK}</span>
                  ) : entry.tone === "pending" ? (
                    <span>RECEIVED · PENDING · awaiting confirmation — not complete.</span>
                  ) : (
                    <span>REVERTED · retry only via a fresh flow.</span>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>

      {/* Consent interstitial bound to tokens + session + timestamp */}
      {consentScope ? (
        <div className={styles.interstitial} role="dialog" aria-modal="true" aria-labelledby="consent-title">
          <div className={styles.interstitialCard}>
            <p className={styles.eyebrow}>Consent required</p>
            <h4 id="consent-title">{SESSION_STRINGS.reviewSign}</h4>
            <p>Allow this session to request shield state for:</p>
            <ul>
              <li>Tokens: {consentScope.tokens.join(", ")}</li>
              <li>Session: {consentScope.sessionAddress ?? "none"}</li>
              <li>Requested: {new Date(consentScope.requestedAt).toISOString()}</li>
            </ul>
            <p className={styles.meta}>No key, note, or proof is stored. Denial stops with “{SESSION_STRINGS.consentDenied}”</p>
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

/** Gated slot: renders nothing unless `?demo=privacy` (aliases: privacy-style, session). */
export function PrivacyDemoSlot() {
  const active = useDemoActive();
  if (!active) return null;
  return <PrivacyWalletFlow />;
}
