"use client";

import { useEffect, useRef, useState } from "react";
import WalletConnectionPanel from "../wallet/WalletConnectionPanel";
import RefractedCore, { type RefractedCoreState } from "./RefractedCore";
import styles from "./PrismLanding.module.css";

const idleStates: RefractedCoreState[] = ["PRISM", "HOME", "ID", "CONTINUITY"];

type HomeNotice = "idle" | "send" | "receive";

function StatusPill({ children, tone = "planned" }: { children: React.ReactNode; tone?: "testnet" | "planned" | "abstract" }) {
  return <span className={`${styles.statusPill} ${styles[`status${tone}`]}`}>{children}</span>;
}

function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <a className={`${styles.brandLockup} ${compact ? styles.brandCompact : ""}`} href="#top" aria-label="Prism">
      <RefractedCore label="Prism" state="PRISM" variant="flat" />
      <span>Prism</span>
    </a>
  );
}

export default function PrismLanding() {
  const storyRef = useRef<HTMLDivElement>(null);
  const homeRef = useRef<HTMLElement>(null);
  const enterTimerRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const [coreState, setCoreState] = useState<RefractedCoreState>("PRISM");
  const [activeStory, setActiveStory] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);
  const [homeNotice, setHomeNotice] = useState<HomeNotice>("idle");

  useEffect(() => {
    if (activeStory || entering) return;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mediaQuery.matches) return;

    let index = 0;
    const interval = window.setInterval(() => {
      index = (index + 1) % idleStates.length;
      setCoreState(idleStates[index]);
    }, 4600);

    return () => window.clearInterval(interval);
  }, [activeStory, entering]);

  useEffect(() => {
    const root = storyRef.current;
    if (!root) return;

    const sections = Array.from(root.querySelectorAll<HTMLElement>("[data-core-state]"));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];

        if (!visible) return;

        const element = visible.target as HTMLElement;
        const nextState = element.dataset.coreState as RefractedCoreState | undefined;
        if (!nextState) return;

        setActiveStory(element.id);
        setCoreState(nextState);
      },
      { rootMargin: "-22% 0px -34%", threshold: [0.18, 0.42, 0.68] },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (enterTimerRef.current !== null) window.clearTimeout(enterTimerRef.current);
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    };
  }, []);

  const enterPrism = () => {
    if (enterTimerRef.current !== null) window.clearTimeout(enterTimerRef.current);
    setEntering(true);
    setCoreState("HOME");
    enterTimerRef.current = window.setTimeout(() => {
      homeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setEntering(false);
      enterTimerRef.current = null;
    }, 620);
  };

  const setActionNotice = (notice: Exclude<HomeNotice, "idle">) => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    setHomeNotice(notice);
    noticeTimerRef.current = window.setTimeout(() => {
      setHomeNotice("idle");
      noticeTimerRef.current = null;
    }, 3600);
  };

  return (
    <main className={styles.page} id="top">
      <section className={`${styles.heroShell} ${entering ? styles.heroEntering : ""}`} aria-labelledby="hero-title">
        <nav className={styles.publicNav} aria-label="Public navigation">
          <BrandLockup />

          <div className={styles.navLinks}>
            <a href="#top">Home</a>
            <a href="#identity-resolution">ID</a>
            <a href="#narrative">Explore</a>
          </div>

          <div className={styles.navActions}>
            <a className={styles.signInLink} href="#prism-home">Sign in</a>
            <button className={styles.darkButton} type="button" onClick={enterPrism}>
              Enter Prism <span aria-hidden="true">›</span>
            </button>
          </div>
        </nav>

        <div className={styles.heroContent}>
          <div className={styles.heroCopy}>
            <h1 id="hero-title">
              Your Home
              <br />
              Across Chains.
            </h1>
            <p>
              One Prism ID for your identity, assets,
              <br className={styles.desktopBreak} /> relationships, and activity across networks.
            </p>
            <button className={`${styles.darkButton} ${styles.heroButton}`} type="button" onClick={enterPrism}>
              Enter Prism <span aria-hidden="true">›</span>
            </button>
          </div>

          <div className={styles.heroObject} aria-live="polite">
            <div className={styles.heroAura} aria-hidden="true" />
            <RefractedCore className={styles.heroCore} state={coreState} variant="living" />
            <div className={styles.plinth} aria-hidden="true">
              <span />
            </div>
          </div>
        </div>
      </section>

      <section className={styles.introBand} aria-label="Prism product principle">
        <p>Identity is persistent.</p>
        <p>Execution is venue-specific.</p>
        <p>Authority connects them.</p>
      </section>

      <section className={styles.narrative} id="narrative" aria-labelledby="narrative-title">
        <div className={styles.narrativeHeading}>
          <p className={styles.eyebrow}>How Prism resolves you</p>
          <h2 id="narrative-title">One center. Every context remains legible.</h2>
        </div>

        <div className={styles.storyLayout} ref={storyRef}>
          <aside className={styles.stickyCore} aria-label={`Prism state: ${coreState}`}>
            <div className={styles.stickyCoreInner}>
              <RefractedCore className={styles.storyCore} state={coreState} variant="living" />
              <div>
                <span>Current state</span>
                <strong>{coreState}</strong>
              </div>
            </div>
          </aside>

          <div className={styles.storySections}>
            <article
              className={`${styles.storySection} ${activeStory === "identity-resolution" ? styles.storyActive : ""}`}
              data-core-state="ID"
              id="identity-resolution"
            >
              <div className={styles.storyIndex}>01</div>
              <div className={styles.storyCopy}>
                <p className={styles.eyebrow}>Persistent onchain identity</p>
                <h3>One Prism ID, resolved across chains.</h3>
                <p>
                  Prism ID anchors your identity once. Starknet anchors its onchain state, then
                  Prism resolves you into the chains and venues where you act.
                </p>
              </div>

              <div className={styles.anchorDiagram} aria-label="Prism ID resolves through Starknet to venue contexts">
                <div className={`${styles.endpoint} ${styles.endpointPrimary}`}>
                  <span>Prism ID</span>
                  <StatusPill>PLANNED</StatusPill>
                </div>
                <div className={`${styles.track} ${styles.trackVertical}`}><i /></div>
                <div className={`${styles.endpoint} ${styles.endpointAnchor}`}>
                  <span>Starknet</span>
                  <StatusPill tone="testnet">TESTNET</StatusPill>
                </div>
                <div className={styles.branchTrack}><i /></div>
                <div className={styles.endpointRow}>
                  <div className={styles.endpoint}>
                    <span>Base</span>
                    <StatusPill>PLANNED</StatusPill>
                  </div>
                  <div className={styles.endpoint}>
                    <span>Private state</span>
                    <StatusPill tone="abstract">ABSTRACT</StatusPill>
                  </div>
                  <div className={styles.endpoint}>
                    <span>Future venue</span>
                    <StatusPill>PLANNED</StatusPill>
                  </div>
                </div>
              </div>
            </article>

            <article
              className={`${styles.storySection} ${activeStory === "identity-bindings" ? styles.storyActive : ""}`}
              data-core-state="ID"
              id="identity-bindings"
            >
              <div className={styles.storyIndex}>02</div>
              <div className={styles.storyCopy}>
                <p className={styles.eyebrow}>Identity bindings</p>
                <h3>Bring the identities you already use.</h3>
                <p>Email, social, and wallet identities can bind to one persistent Prism ID.</p>
              </div>

              <div className={styles.bindingDiagram} aria-label="External identities bind toward Prism ID">
                <div className={styles.bindingSources}>
                  {['Gmail', 'X', 'Telegram', 'Wallet'].map((source) => (
                    <div className={styles.bindingSource} key={source}>
                      <span>{source}</span>
                      <StatusPill>PLANNED</StatusPill>
                    </div>
                  ))}
                </div>
                <div className={styles.bindingLines} aria-hidden="true"><i /></div>
                <div className={`${styles.endpoint} ${styles.endpointPrimary}`}>
                  <span>Prism ID</span>
                  <StatusPill>PLANNED</StatusPill>
                </div>
              </div>
            </article>

            <article
              className={`${styles.storySection} ${activeStory === "home-convergence" ? styles.storyActive : ""}`}
              data-core-state="HOME"
              id="home-convergence"
            >
              <div className={styles.storyIndex}>03</div>
              <div className={styles.storyCopy}>
                <p className={styles.eyebrow}>Prism Home</p>
                <h3>One home for what follows you across networks.</h3>
                <p>Prism Home brings identity, assets, relationships, and activity into one coherent place.</p>
              </div>

              <div className={styles.homeDomains}>
                {['Identity', 'Assets', 'Relationships', 'Activity'].map((domain) => (
                  <div key={domain}>
                    <span>{domain}</span>
                    <small>Not resolved</small>
                  </div>
                ))}
                <div className={styles.homeDomainCore}>
                  <RefractedCore state="HOME" variant="flat" />
                  <strong>Home</strong>
                </div>
              </div>
            </article>

            <article
              className={`${styles.storySection} ${activeStory === "authority-resolution" ? styles.storyActive : ""}`}
              data-core-state="PRISM"
              id="authority-resolution"
            >
              <div className={styles.storyIndex}>04</div>
              <div className={styles.storyCopy}>
                <p className={styles.eyebrow}>Context and authority</p>
                <h3>The right identity, in the right context.</h3>
                <p>Prism resolves which identity, account, or relationship should be used for each action.</p>
              </div>

              <div className={styles.authorityFlow} aria-label="Request resolves through an authorized path">
                {[
                  ['Request', 'ABSTRACT'],
                  ['Candidate paths', 'ABSTRACT'],
                  ['Authorized path', 'PLANNED'],
                  ['Resolve', 'PLANNED'],
                ].map(([label, state], index) => (
                  <div className={styles.authorityStep} key={label}>
                    <div>
                      <span>{label}</span>
                      <small>{state}</small>
                    </div>
                    {index < 3 ? <i aria-hidden="true" /> : null}
                  </div>
                ))}
              </div>
            </article>

            <article
              className={`${styles.storySection} ${activeStory === "continuity" ? styles.storyActive : ""}`}
              data-core-state="CONTINUITY"
              id="continuity"
            >
              <div className={styles.storyIndex}>05</div>
              <div className={styles.storyCopy}>
                <p className={styles.eyebrow}>Continuity</p>
                <h3>Continuity, not fragmentation.</h3>
                <p>
                  Move across chains and applications without losing the identity and history that
                  make those actions yours.
                </p>
              </div>

              <div className={styles.continuityTrace} aria-label="One resolved center persists through changing contexts">
                <span className={styles.traceStart}>Prism ID</span>
                <div className={styles.traceLine}><i /></div>
                <span>Starknet</span>
                <div className={styles.traceLine}><i /></div>
                <span>Context</span>
                <div className={styles.traceLine}><i /></div>
                <span className={styles.traceEnd}>You</span>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className={styles.homeEntry} id="prism-home" ref={homeRef} aria-labelledby="home-title">
        <div className={styles.homeShell}>
          <header className={styles.homeTopbar}>
            <BrandLockup compact />
            <nav aria-label="Prism Home navigation">
              <a aria-current="page" href="#prism-home">Home</a>
              <a href="#home-activity">Activity</a>
              <a href="#home-connections">Connections</a>
              <a href="#home-profile">Profile</a>
            </nav>
            <span className={styles.testnetBadge}>TESTNET · SEPOLIA</span>
          </header>

          <div className={styles.homeWelcome}>
            <div>
              <p className={styles.eyebrow}>Prism Home</p>
              <h2 id="home-title">Your home is waiting for its first authority.</h2>
              <p>No identity, balance, connection, or activity is invented here.</p>
            </div>
            <div className={styles.homeActions}>
              <button type="button" onClick={() => setActionNotice("send")}>Send</button>
              <button type="button" onClick={() => setActionNotice("receive")}>Receive</button>
            </div>
          </div>

          <div className={styles.homeStateNotice} aria-live="polite">
            {homeNotice === "send"
              ? "Send is unavailable until a Prism ID and destination are resolved."
              : homeNotice === "receive"
                ? "Receive is unavailable until a destination authority is connected."
                : "Connect a supported wallet to begin resolving this Home."}
          </div>

          <div className={styles.homeStateGrid}>
            <article id="home-profile">
              <span>Prism ID</span>
              <strong>Not registered</strong>
              <small>Persistent identity</small>
            </article>
            <article>
              <span>Financial state</span>
              <strong>Not disclosed</strong>
              <small>No balance request has been made</small>
            </article>
            <article id="home-connections">
              <span>Connections</span>
              <strong>Not connected</strong>
              <small>Venue-specific authorities</small>
            </article>
            <article id="home-activity">
              <span>Activity</span>
              <strong>No activity yet</strong>
              <small>Receipts will appear here</small>
            </article>
          </div>

          <WalletConnectionPanel />
        </div>
      </section>

      <section className={styles.editorialClose}>
        <RefractedCore state="CONTINUITY" variant="flat" />
        <p>One Prism ID.</p>
        <h2>Come home across chains.</h2>
        <button className={styles.darkButton} type="button" onClick={enterPrism}>
          Enter Prism <span aria-hidden="true">›</span>
        </button>
      </section>

      <footer className={styles.footer}>
        <BrandLockup compact />
        <p>Persistent identity on Starknet. Native execution everywhere else.</p>
        <span>Testnet build · No private state requested</span>
      </footer>
    </main>
  );
}
