"use client";

import { useEffect, useState } from "react";
import WalletConnectionPanel from "../wallet/WalletConnectionPanel";
import styles from "./PrismWorkspacePreview.module.css";

type WorkspaceTab = "home" | "activity" | "connections" | "profile";

const tabs: readonly { id: WorkspaceTab; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "activity", label: "Activity" },
  { id: "connections", label: "Connections" },
  { id: "profile", label: "Profile" },
];

function StateCell({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className={styles.stateCell}>
      <span className={styles.cellLabel}>{label}</span>
      <strong>{value}</strong>
      <span className={styles.cellDetail}>{detail}</span>
    </div>
  );
}

function PreviewActionRail({ onAction }: { onAction: (action: "send" | "receive") => void }) {
  return (
    <div className={styles.actionRail} aria-label="Preview actions">
      <button className={styles.actionButton} type="button" onClick={() => onAction("send")}>
        <span>
          <strong>Send</strong>
          <small>Prepare a governed action</small>
        </span>
        <span aria-hidden="true">↗</span>
      </button>
      <button className={styles.actionButton} type="button" onClick={() => onAction("receive")}>
        <span>
          <strong>Receive</strong>
          <small>Share a controlled destination</small>
        </span>
        <span aria-hidden="true">↘</span>
      </button>
    </div>
  );
}

function EmptyPanel({ title, body, marker }: { title: string; body: string; marker: string }) {
  return (
    <div className={styles.emptyPanel}>
      <div className={styles.emptyMarker} aria-hidden="true">{marker}</div>
      <div>
        <span className={styles.panelEyebrow}>Preview state</span>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
    </div>
  );
}

export default function PrismWorkspacePreview() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("home");
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  useEffect(() => {
    const handleWorkspaceTab = (event: Event) => {
      const tab = (event as CustomEvent<WorkspaceTab>).detail;
      if (!tabs.some((item) => item.id === tab)) return;
      setActiveTab(tab);
      setActionNotice(null);
    };

    window.addEventListener("prism:workspace-tab", handleWorkspaceTab);
    return () => window.removeEventListener("prism:workspace-tab", handleWorkspaceTab);
  }, []);

  const selectTab = (tab: WorkspaceTab) => {
    setActiveTab(tab);
    setActionNotice(null);
  };

  const handleAction = (action: "send" | "receive") => {
    setActiveTab("home");
    setActionNotice(
      action === "send"
        ? "Send is ready for a connected wallet and an observed Pause decision. No transaction was sent."
        : "Receive is ready for a connected wallet. No destination or receipt was created.",
    );
  };

  return (
    <section className={styles.workspaceSection} id="prism-home" aria-labelledby="workspace-title">
      <div className={styles.workspaceIntro}>
        <div>
          <p className={styles.eyebrow}>Product surface / preview</p>
          <h2 id="workspace-title">Your financial home, before the connection.</h2>
        </div>
        <p className={styles.introCopy}>
          A truthful product shell: live balances, identities, and receipts appear only after the
          wallet and backend have observed them. The structure is ready; the state is never invented.
        </p>
      </div>

      <div className={styles.workspaceShell}>
        <aside className={styles.workspaceRail} aria-label="Product navigation">
          <div className={styles.railBrand}>
            <span className={styles.railGlyph} aria-hidden="true">✳</span>
            <span>
              <strong>Prism</strong>
              <small>private coordination</small>
            </span>
          </div>

          <div className={styles.tabList} role="tablist" aria-label="Prism workspace">
            {tabs.map((tab) => (
              <button
                aria-selected={activeTab === tab.id}
                className={`${styles.tabButton} ${activeTab === tab.id ? styles.tabButtonActive : ""}`}
                id={`tab-${tab.id}`}
                key={tab.id}
                onClick={() => selectTab(tab.id)}
                role="tab"
                type="button"
              >
                <span className={styles.tabDot} aria-hidden="true" />
                {tab.label}
              </button>
            ))}
          </div>

          <div className={styles.railFooter}>
            <span className={styles.cellLabel}>System status</span>
            <strong><i className={styles.statusDot} aria-hidden="true" /> Preview only</strong>
            <small>No account or operation is implied.</small>
          </div>
        </aside>

        <div className={styles.workspaceMain}>
          <header className={styles.workspaceHeader}>
            <div>
              <p className={styles.panelEyebrow}>Prism ID / Home</p>
              <h3>{tabs.find((tab) => tab.id === activeTab)?.label}</h3>
            </div>
            <span className={styles.previewBadge}>Unconnected preview</span>
          </header>

          {activeTab === "home" ? (
            <div className={styles.homePanel} role="tabpanel" aria-labelledby="tab-home">
              <div className={styles.stateGrid}>
                <StateCell label="Identity" value="Awaiting wallet" detail="Canonical state is not read in this preview." />
                <StateCell label="Private state" value="Consent-gated" detail="The wallet owns notes and viewing keys." />
                <StateCell label="Activity" value="No receipts" detail="Only reconciled operations appear here." />
              </div>
              <PreviewActionRail onAction={handleAction} />
              {actionNotice ? <p className={styles.actionNotice} role="status">{actionNotice}</p> : null}
              <WalletConnectionPanel />
            </div>
          ) : null}

          {activeTab === "activity" ? (
            <div id="activity-preview" role="tabpanel" aria-labelledby="tab-activity">
              <EmptyPanel
                marker="↺"
                title="No observed activity yet."
                body="Activity will be populated from durable operations and independently reconciled receipts. A submitted operation is not shown as completed."
              />
            </div>
          ) : null}

          {activeTab === "connections" ? (
            <div id="connections-preview" role="tabpanel" aria-labelledby="tab-connections">
              <EmptyPanel
                marker="⇄"
                title="Connections are earned, not assumed."
                body="Base and other execution contexts appear here only after control proof, canonical binding, and a truthful resolution readback."
              />
            </div>
          ) : null}

          {activeTab === "profile" ? (
            <div id="profile-preview" role="tabpanel" aria-labelledby="tab-profile">
              <EmptyPanel
                marker="◌"
                title="Your Prism identity stays yours."
                body="Profile state will resolve from the canonical Prism ID. This preview does not create an identity, store a social handle, or infer authority."
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
