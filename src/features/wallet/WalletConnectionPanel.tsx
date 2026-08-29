"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "./session/SessionProvider";
import {
  environmentLabel,
  formatObservedAddress,
  formatObservedHash,
} from "./session/selectors";
import {
  capabilityGlyph,
  capabilitySummary,
  ctaLabel,
  SESSION_STATE_GLYPHS,
  SESSION_STATE_LABELS,
  SESSION_STRINGS,
  statusLine,
} from "./session/strings";
import styles from "./WalletConnectionPanel.module.css";

export interface WalletConnectionPanelProps {
  /** The parent flow may attach the next real action without changing session state here. */
  readonly onContinue?: () => void;
  /** Consent is supplied by the flow that owns the consent contract. */
  readonly onConsent?: () => void;
}

function isDisabledState(state: ReturnType<typeof useSession>["uiState"]): boolean {
  return state === "discovering"
    || state === "connecting"
    || state === "unsupported"
    || state === "proof-preparing"
    || state === "awaiting-approval"
    || state === "processing";
}

function showsCapabilities(state: ReturnType<typeof useSession>["uiState"]): boolean {
  return state === "unsupported"
    || state === "ready"
    || state === "consent-required"
    || state === "proof-preparing"
    || state === "awaiting-approval"
    || state === "submitted"
    || state === "processing"
    || state === "receipt-confirmed"
    || state === "reverted";
}

function explorerHref(transactionHash: string): string {
  const configured = process.env.NEXT_PUBLIC_STARKNET_EXPLORER_URL?.trim();
  const base = (configured || "https://starkscan.co/tx").replace(/\/$/, "");
  return `${base}/${transactionHash}`;
}

export default function WalletConnectionPanel({ onContinue, onConsent }: WalletConnectionPanelProps) {
  const {
    snapshot,
    wallets,
    notice,
    startDiscovery,
    connectWallet,
    disconnect,
    switchNetwork,
  } = useSession();
  const { session, capabilities, receipt, state: uiState } = snapshot;
  const [fullAddressOpen, setFullAddressOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [disconnectPending, setDisconnectPending] = useState(false);
  const disconnectTimerRef = useRef<number | null>(null);
  const addressLabel = formatObservedAddress(session.accountAddress);
  const expectedLabel = environmentLabel(session.expectedEnvironment);
  const observedLabel = session.environment === "UNKNOWN"
    ? session.network.chainId ?? SESSION_STRINGS.unknownNetwork
    : environmentLabel(session.environment);
  const status = statusLine(uiState, {
    environment: observedLabel,
    chainId: session.network.chainId,
    expectedEnvironment: expectedLabel,
    capabilitySummary: capabilitySummary(capabilities),
    blockNumber: receipt?.blockNumber ?? null,
    reason: receipt?.reason ?? null,
  });
  const cta = ctaLabel(uiState, expectedLabel);
  const ctaDisabled = isDisabledState(uiState);
  const connected = session.accountAddress !== null;
  const showReceipt = receipt !== null
    && (uiState === "submitted" || uiState === "processing" || uiState === "receipt-confirmed" || uiState === "reverted");

  useEffect(() => {
    setFullAddressOpen(false);
    setDisconnectPending(false);
  }, [uiState]);

  useEffect(() => {
    return () => {
      if (disconnectTimerRef.current !== null) window.clearTimeout(disconnectTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!fullAddressOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullAddressOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [fullAddressOpen]);

  const handleDisconnect = () => {
    if (!disconnectPending) {
      setDisconnectPending(true);
      disconnectTimerRef.current = window.setTimeout(() => {
        setDisconnectPending(false);
        disconnectTimerRef.current = null;
      }, 3000);
      return;
    }
    if (disconnectTimerRef.current !== null) window.clearTimeout(disconnectTimerRef.current);
    disconnectTimerRef.current = null;
    setDisconnectPending(false);
    disconnect();
  };

  const copyAddress = async () => {
    if (!session.accountAddress) return;
    try {
      await navigator.clipboard.writeText(session.accountAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  const handlePrimaryAction = () => {
    if (ctaDisabled) return;
    if (uiState === "wrong-network") {
      switchNetwork();
      return;
    }
    if (uiState === "disconnected" || uiState === "capability-unknown" || uiState === "unknown") {
      startDiscovery();
      return;
    }
    if (uiState === "consent-required") {
      (onConsent ?? onContinue)?.();
      return;
    }
    onContinue?.();
  };

  return (
    <section
      aria-labelledby="wallet-session-heading"
      className={styles.panel}
      data-state={uiState}
      role="region"
    >
      <div className={styles.panelIntro}>
        <p className={styles.eyebrow}>{SESSION_STRINGS.eyebrow}</p>
        <h3 id="wallet-session-heading">{SESSION_STRINGS.title}</h3>
      </div>

      <div className={styles.card}>
        <header className={styles.cardHeader}>
          <div>
            <span className={styles.label}>{SESSION_STRINGS.sessionState}</span>
            <strong className={styles.stateLabel}>
              <span aria-hidden="true" className={styles.stateGlyph}>{SESSION_STATE_GLYPHS[uiState]}</span>
              {SESSION_STATE_LABELS[uiState]}
            </strong>
          </div>
        </header>

        <p aria-live="polite" className={styles.statusLine}>{status}</p>
        {notice ? <p className={styles.notice} role="alert">{notice}</p> : null}

        <button
          className={styles.primaryAction}
          disabled={ctaDisabled}
          onClick={handlePrimaryAction}
          type="button"
        >
          {cta}
        </button>

        {uiState === "disconnected" && wallets.length > 0 ? (
          <div aria-label={SESSION_STRINGS.discoveredWallets} className={styles.walletList} role="list">
            {wallets.map((wallet) => (
              <button
                className={styles.walletOption}
                key={wallet.id}
                onClick={() => connectWallet(wallet.id)}
                role="listitem"
                type="button"
              >
                <span>{wallet.name}</span>
                <span aria-hidden="true">{SESSION_STRINGS.connect}</span>
              </button>
            ))}
          </div>
        ) : null}

        {addressLabel ? (
          <div className={styles.observedDetails}>
            {session.walletName ? (
              <div className={styles.detailRow}>
                <span className={styles.label}>{SESSION_STRINGS.wallet}</span>
                <span className={styles.detailValue}>{session.walletName}</span>
              </div>
            ) : null}
            <div className={styles.detailRow}>
              <span className={styles.label}>{SESSION_STRINGS.account}</span>
              <div className={styles.addressControls}>
                <button
                  aria-label={`${SESSION_STRINGS.copyAddress} ${addressLabel}`}
                  className={styles.addressButton}
                  onClick={() => void copyAddress()}
                  type="button"
                >
                  <span className={styles.mono}>{addressLabel}</span>
                </button>
                <button
                  aria-expanded={fullAddressOpen}
                  className={styles.disclosure}
                  onClick={() => setFullAddressOpen((open) => !open)}
                  type="button"
                >
                  {fullAddressOpen ? SESSION_STRINGS.hideFullAddress : SESSION_STRINGS.viewFullAddress}
                </button>
                {copied ? <span aria-live="polite" className={styles.copied}>{SESSION_STRINGS.copied}</span> : null}
                {fullAddressOpen ? <code className={styles.fullAddress}>{session.accountAddress}</code> : null}
              </div>
            </div>
            {session.network.chainId ? (
              <div className={styles.detailRow}>
                <span className={styles.label}>{SESSION_STRINGS.network}</span>
                <span className={styles.detailValue}>{observedLabel} · <span className={styles.mono}>{session.network.chainId}</span></span>
              </div>
            ) : null}
          </div>
        ) : null}

        {uiState === "capability-unknown" ? (
          <div aria-label={SESSION_STRINGS.checkingCapabilities} className={styles.capabilityList} role="list">
            {[0, 1, 2].map((slot) => (
              <span className={styles.capabilitySkeleton} key={slot} role="listitem" />
            ))}
          </div>
        ) : showsCapabilities(uiState) ? (
          <div aria-label={SESSION_STRINGS.observedCapabilities} className={styles.capabilityList} role="list">
            {capabilities.map((capability) => (
              <span className={`${styles.capability} ${styles[`capability--${capability.status}`]}`} key={capability.id} role="listitem">
                <span aria-hidden="true">{capabilityGlyph(capability.status)}</span>
                {capability.label}
              </span>
            ))}
          </div>
        ) : null}

        {connected ? (
          <button className={styles.disconnect} onClick={handleDisconnect} type="button">
            {disconnectPending ? SESSION_STRINGS.confirmDisconnect : SESSION_STRINGS.disconnect}
          </button>
        ) : null}

        {showReceipt ? (
          <div aria-live="polite" className={`${styles.receipt} ${styles[`receipt--${receipt.status}`]}`}>
            <div>
              <span className={styles.label}>{SESSION_STRINGS.receipt}</span>
              <span className={styles.receiptStatus}>{receipt.status}</span>
              <code className={styles.mono}>{formatObservedHash(receipt.transactionHash)}</code>
            </div>
            <a href={explorerHref(receipt.transactionHash)} rel="noopener noreferrer" target="_blank">
              {SESSION_STRINGS.viewExplorer} <span aria-hidden="true">↗</span>
            </a>
          </div>
        ) : null}
      </div>
    </section>
  );
}
