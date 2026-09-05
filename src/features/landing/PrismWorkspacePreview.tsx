"use client";

import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import RefractedCore from "./RefractedCore";
import { PrivacyDemoSlot } from "../privacy-flow";
import { LiveStateDemoSlot } from "../live-state";
import styles from "./PrismWorkspacePreview.module.css";

type WorkspaceTab = "home" | "activity" | "connections" | "profile";
type WorkspaceAction = "send" | "receive" | "approval" | "connect";
type IconName =
  | "activity"
  | "approval"
  | "arrow"
  | "connect"
  | "connections"
  | "home"
  | "lock"
  | "profile"
  | "receive"
  | "send"
  | "spark";

type NavigationItem = {
  id: WorkspaceTab;
  icon: IconName;
  label: string;
};

const navigationGroups: readonly { label: string; items: readonly NavigationItem[] }[] = [
  {
    label: "Workspace",
    items: [
      { id: "home", icon: "home", label: "Overview" },
      { id: "activity", icon: "activity", label: "Activity" },
    ],
  },
  {
    label: "Network",
    items: [{ id: "connections", icon: "connections", label: "Connections" }],
  },
  {
    label: "Account",
    items: [{ id: "profile", icon: "profile", label: "Profile" }],
  },
] as const;

const navigationItems = navigationGroups.flatMap((group) => group.items);

const viewLabels: Record<WorkspaceTab, { eyebrow: string; title: string }> = {
  home: { eyebrow: "Private coordination", title: "Overview" },
  activity: { eyebrow: "Evidence ledger", title: "Activity" },
  connections: { eyebrow: "Trust and routing", title: "Connections" },
  profile: { eyebrow: "Identity controls", title: "Profile" },
};

const actionCopy: Record<Exclude<WorkspaceAction, "connect">, string> = {
  send: "Send starts a payment or private transfer after a destination is verified. No transaction was sent.",
  receive: "Receive creates a destination or payment request after connection. Nothing was shared.",
  approval: "Approval creates a governed request. A request cannot move funds.",
};

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    home: (
      <>
        <path d="M3.5 10.8 12 3.7l8.5 7.1" />
        <path d="M5.4 9.8v10.1h13.2V9.8" />
        <path d="M9.2 19.9v-5.7h5.6v5.7" />
      </>
    ),
    activity: (
      <>
        <path d="M4 18.5V14l3.5-3.5 3 2.6 5.8-7.1" />
        <path d="M14.4 6h1.9v1.9" />
        <path d="M4 21h16" />
      </>
    ),
    connections: (
      <>
        <circle cx="7" cy="8" r="3" />
        <circle cx="17" cy="16" r="3" />
        <path d="m9.4 9.8 5.2 4.4" />
        <path d="M14.7 6.2h4.1v4.1" />
        <path d="m18.8 6.2-4.7 4.7" />
      </>
    ),
    profile: (
      <>
        <circle cx="12" cy="8" r="3.4" />
        <path d="M5.2 20c.7-4 3-6 6.8-6s6.1 2 6.8 6" />
      </>
    ),
    send: (
      <>
        <path d="M4 12h15" />
        <path d="m14 7 5 5-5 5" />
      </>
    ),
    receive: (
      <>
        <path d="M20 12H5" />
        <path d="m10 17-5-5 5-5" />
      </>
    ),
    approval: (
      <>
        <path d="M12 3.5 19 6v5.6c0 4.3-2.6 7.4-7 8.9-4.4-1.5-7-4.6-7-8.9V6l7-2.5Z" />
        <path d="m8.8 12 2.1 2.1 4.5-4.6" />
      </>
    ),
    connect: (
      <>
        <path d="M12 5v14M5 12h14" />
        <circle cx="12" cy="12" r="9" />
      </>
    ),
    arrow: (
      <>
        <path d="M5 12h13" />
        <path d="m14 8 4 4-4 4" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
      </>
    ),
    spark: (
      <>
        <path d="M12 3v5M12 16v5M3 12h5M16 12h5" />
        <path d="m5.6 5.6 3.1 3.1m6.6 6.6 3.1 3.1m0-12.8-3.1 3.1m-6.6 6.6-3.1 3.1" />
      </>
    ),
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  );
}

function ActionButton({
  description,
  icon,
  label,
  onClick,
}: {
  description: string;
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={styles.actionButton} onClick={onClick} type="button">
      <span className={styles.actionIcon}><Icon name={icon} /></span>
      <span className={styles.actionCopy}>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <span className={styles.actionArrow}><Icon name="arrow" /></span>
    </button>
  );
}

function StateRow({ label, status, value }: { label: string; status: string; value: string }) {
  return (
    <div className={styles.stateRow}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <small>{status}</small>
    </div>
  );
}

function HomeOverview({
  actionNotice,
  onAction,
  onOpenActivity,
  onOpenConnections,
}: {
  actionNotice: string | null;
  onAction: (action: WorkspaceAction) => void;
  onOpenActivity: () => void;
  onOpenConnections: () => void;
}) {
  return (
    <div className={styles.homeView}>
      <section className={styles.connectionBanner} aria-label="Workspace connection state">
        <div className={styles.bannerMark}><Icon name="spark" /></div>
        <div>
          <span className={styles.cardEyebrow}>Current state</span>
          <h3>Nothing is connected yet.</h3>
          <p>Connect a verified account or relationship to load requests, permissions, private state, and evidence.</p>
        </div>
        <button className={styles.darkButton} onClick={() => onAction("connect")} type="button">
          Connect
          <Icon name="arrow" />
        </button>
      </section>

      {/* Demo-only privacy wallet flow (?demo=privacy). Renders nothing by default. */}
      <PrivacyDemoSlot />

      {/* Demo-only read-only live state (?demo=livestate). Renders nothing by default. */}
      <LiveStateDemoSlot />

      <section className={styles.actionSection} aria-labelledby="quick-actions-title">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.cardEyebrow}>Start here</span>
            <h3 id="quick-actions-title">What do you want to do?</h3>
          </div>
          <span className={styles.sectionNote}>Nothing executes from this preview</span>
        </div>
        <div className={styles.actionGrid}>
          <ActionButton description="Move funds to someone" icon="send" label="Send" onClick={() => onAction("send")} />
          <ActionButton description="Request or share a destination" icon="receive" label="Receive" onClick={() => onAction("receive")} />
          <ActionButton description="Ask before an action" icon="approval" label="Approval" onClick={() => onAction("approval")} />
          <ActionButton description="Add an account or relationship" icon="connect" label="Connect" onClick={() => onAction("connect")} />
        </div>
        {actionNotice ? <p className={styles.actionNotice} role="status">{actionNotice}</p> : null}
      </section>

      <div className={styles.dashboardColumns}>
        <div className={styles.primaryColumn}>
          <section className={`${styles.dashboardCard} ${styles.attentionCard}`}>
            <div className={styles.cardHeader}>
              <div>
                <span className={styles.cardEyebrow}>Attention</span>
                <h3>What needs you</h3>
              </div>
              <span className={styles.countPill}>0 observed</span>
            </div>
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}><Icon name="approval" /></span>
              <div>
                <strong>Connect to load your decisions.</strong>
                <p>Payment requests, approvals, channel invitations, private-state consent, and unresolved receipts appear here only after observation.</p>
              </div>
            </div>
          </section>

          <section className={`${styles.dashboardCard} ${styles.relationshipCard}`}>
            <div className={styles.cardHeader}>
              <div>
                <span className={styles.cardEyebrow}>Relationships</span>
                <h3>Private coordination starts here.</h3>
              </div>
              <button className={styles.textButton} onClick={onOpenConnections} type="button">
                Connections <Icon name="arrow" />
              </button>
            </div>
            <p className={styles.cardLead}>Messages, payment requests, approvals, claim invitations, and receipts live inside a verified relationship, not a generic chat inbox.</p>
            <div className={styles.relationshipEmpty}>
              <span className={styles.relationshipGlyph}><Icon name="connections" /></span>
              <div>
                <strong>No active relationships loaded.</strong>
                <small>Connect with someone or resolve a verified destination to begin.</small>
              </div>
            </div>
          </section>
        </div>

        <div className={styles.contextColumn}>
          <section className={styles.dashboardCard}>
            <div className={styles.cardHeader}>
              <div>
                <span className={styles.cardEyebrow}>Context</span>
                <h3>What Prism can see</h3>
              </div>
              <span className={styles.neutralPill}>Preview</span>
            </div>
            <div className={styles.stateList}>
              <StateRow label="Canonical root" status="Not read" value="Starknet" />
              <StateRow label="Wallet session" status="Unavailable" value="Not connected" />
              <StateRow label="Private state" status="Wallet-owned" value="Consent required" />
              <StateRow label="Receipt evidence" status="Not observed" value="None loaded" />
            </div>
          </section>

          <section className={`${styles.dashboardCard} ${styles.activityCard}`}>
            <div className={styles.cardHeader}>
              <div>
                <span className={styles.cardEyebrow}>Recent activity</span>
                <h3>Evidence only</h3>
              </div>
              <button className={styles.iconButton} aria-label="Open Activity" onClick={onOpenActivity} type="button">
                <Icon name="arrow" />
              </button>
            </div>
            <div className={styles.activityEmpty}>
              <span className={styles.activityLine} />
              <p>No reconciled operations or receipts have been observed.</p>
              <small>Submitted is not complete.</small>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function SurfacePlaceholder({
  body,
  facts,
  icon,
  title,
}: {
  body: string;
  facts: readonly string[];
  icon: IconName;
  title: string;
}) {
  return (
    <div className={styles.surfacePlaceholder}>
      <div className={styles.placeholderIntro}>
        <span className={styles.placeholderIcon}><Icon name={icon} /></span>
        <div>
          <h3>{title}</h3>
          <p>{body}</p>
        </div>
      </div>
      <div className={styles.placeholderFacts}>
        {facts.map((fact) => <span key={fact}>{fact}</span>)}
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
      if (!navigationItems.some((item) => item.id === tab)) return;
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

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, tab: WorkspaceTab) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const currentIndex = navigationItems.findIndex((item) => item.id === tab);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? navigationItems.length - 1
        : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + navigationItems.length) % navigationItems.length;
    const next = navigationItems[nextIndex];
    selectTab(next.id);
    window.requestAnimationFrame(() => document.getElementById(`workspace-tab-${next.id}`)?.focus());
  };

  const handleAction = (action: WorkspaceAction) => {
    if (action === "connect") {
      selectTab("connections");
      return;
    }
    setActiveTab("home");
    setActionNotice(actionCopy[action]);
  };

  const activeView = viewLabels[activeTab];

  return (
    <section className={styles.workspaceSection} id="workspace" aria-labelledby="workspace-title">
      <div className={styles.workspaceShell}>
        <aside className={styles.workspaceRail} aria-label="Product navigation">
          <div className={styles.railBrand}>
            <span className={styles.railGlyph}><RefractedCore label="" state="PRISM" variant="flat" /></span>
            <span className={styles.railBrandCopy}>
              <strong>Prism</strong>
              <small>Private coordination</small>
            </span>
          </div>

          <nav className={styles.tabList} aria-label="Workspace views" role="tablist" aria-orientation="vertical">
            {navigationGroups.map((group) => (
              <div className={styles.tabGroup} key={group.label}>
                <span className={styles.tabGroupLabel}>{group.label}</span>
                {group.items.map((item) => (
                  <button
                    aria-controls={`workspace-panel-${item.id}`}
                    aria-label={item.label}
                    aria-selected={activeTab === item.id}
                    className={`${styles.tabButton} ${activeTab === item.id ? styles.tabButtonActive : ""}`}
                    id={`workspace-tab-${item.id}`}
                    key={item.id}
                    onClick={() => selectTab(item.id)}
                    onKeyDown={(event) => handleTabKeyDown(event, item.id)}
                    role="tab"
                    tabIndex={activeTab === item.id ? 0 : -1}
                    title={item.label}
                    type="button"
                  >
                    <span className={styles.activeRail} aria-hidden="true" />
                    <span className={styles.tabIcon}><Icon name={item.icon} /></span>
                    <span className={styles.tabLabel}>{item.label}</span>
                    <span className={styles.tabArrow}><Icon name="arrow" /></span>
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div className={styles.railFooter}>
            <span className={styles.railStatusDot} aria-hidden="true" />
            <span className={styles.railFooterCopy}>
              <strong>Preview only</strong>
              <small>No account or operation implied</small>
            </span>
          </div>
        </aside>

        <div className={styles.workspaceMain}>
          <header className={styles.workspaceHeader}>
            <div>
              <p className={styles.panelEyebrow}>{activeView.eyebrow}</p>
              <h2 id="workspace-title">{activeView.title}</h2>
            </div>
            <div className={styles.headerStatus}>
              <span className={styles.headerStatusDot} aria-hidden="true" />
              <span className={styles.headerStatusLong}>Unconnected preview</span>
              <span className={styles.headerStatusShort}>Preview</span>
            </div>
          </header>

          <div
            aria-labelledby={`workspace-tab-${activeTab}`}
            className={styles.viewTransition}
            id={`workspace-panel-${activeTab}`}
            key={activeTab}
            role="tabpanel"
          >
            {activeTab === "home" ? (
              <HomeOverview
                actionNotice={actionNotice}
                onAction={handleAction}
                onOpenActivity={() => selectTab("activity")}
                onOpenConnections={() => selectTab("connections")}
              />
            ) : null}

            {activeTab === "activity" ? (
              <SurfacePlaceholder
                body="Requests, actions, operations, receipts, and state transitions appear only after durable observation and reconciliation. A submitted operation is never shown as complete."
                facts={["No operations observed", "No receipts observed", "No relationship events loaded"]}
                icon="activity"
                title="Only evidence belongs here."
              />
            ) : null}

            {activeTab === "connections" ? (
              <SurfacePlaceholder
                body="Accounts, people, private relationship channels, applications, devices, and authorities appear here after verification. Messaging begins inside an active relationship."
                facts={["No verified accounts", "No active relationships", "No delegated authorities"]}
                icon="connections"
                title="Relationships begin with verified connections."
              />
            ) : null}

            {activeTab === "profile" ? (
              <SurfacePlaceholder
                body="Canonical identity, linked accounts, disclosure choices, privacy permissions, communication devices, and session controls appear only after their source state is read."
                facts={["Canonical identity not read", "No disclosure policy loaded", "No session controls available"]}
                icon="profile"
                title="Your identity controls stay yours."
              />
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
