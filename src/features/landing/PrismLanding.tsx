"use client";

import { useEffect, useRef, useState } from "react";
import RefractedCore, { type RefractedCoreState } from "./RefractedCore";
import styles from "./PrismLanding.module.css";

const narrativeStates: Record<string, { core: RefractedCoreState; label: string }> = {
  "identity-anchor": { core: "ID", label: "Identity anchor" },
  "native-execution": { core: "PRISM", label: "Native execution" },
  "home-resolution": { core: "HOME", label: "Prism Home" },
  continuity: { core: "CONTINUITY", label: "Persistent identity" },
};

function BrandLockup() {
  return (
    <a className={styles.brandLockup} href="#top" aria-label="Prism">
      <RefractedCore label="Prism" state="PRISM" variant="flat" />
      <span>Prism</span>
    </a>
  );
}

function ContextRow({ label, state }: { label: string; state: string }) {
  return (
    <div className={styles.contextRow}>
      <dt>{label}</dt>
      <dd>{state}</dd>
    </div>
  );
}

export default function PrismLanding() {
  const storyRef = useRef<HTMLOListElement>(null);
  const [activeBeat, setActiveBeat] = useState("identity-anchor");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const story = storyRef.current;
    if (!story || typeof IntersectionObserver === "undefined") return;

    const sections = Array.from(story.querySelectorAll<HTMLElement>("[data-core-state]"));
    const visibility = new Map<Element, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          visibility.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
        });

        const nextSection = sections.reduce<HTMLElement | null>((mostVisible, section) => {
          if (!mostVisible) return visibility.get(section) ? section : null;
          return (visibility.get(section) ?? 0) > (visibility.get(mostVisible) ?? 0) ? section : mostVisible;
        }, null);

        if (nextSection && (visibility.get(nextSection) ?? 0) > 0) setActiveBeat(nextSection.id);
      },
      { rootMargin: "-24% 0px -38%", threshold: [0, 0.2, 0.45, 0.7] },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const narrativeState = narrativeStates[activeBeat] ?? narrativeStates["identity-anchor"];

  return (
    <main className={styles.page} id="top">
      <section className={styles.heroShell} aria-labelledby="hero-title">
        <nav className={styles.publicNav} aria-label="Public navigation">
          <BrandLockup />

          <div className={styles.navLinks}>
            <a href="#top">Home</a>
            <a href="#identity-anchor">ID</a>
            <a href="#narrative">Explore</a>
          </div>

          <div className={styles.navActions}>
            <a className={styles.signInLink} href="#top">Sign in</a>
            <button
              aria-controls="mobile-menu"
              aria-expanded={menuOpen}
              aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
              className={styles.menuButton}
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span className={styles.menuIcon} aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </button>
          </div>

          {menuOpen ? (
            <div className={styles.mobileMenu} id="mobile-menu">
              <a href="#top" onClick={() => setMenuOpen(false)}>Home</a>
              <a href="#identity-anchor" onClick={() => setMenuOpen(false)}>ID</a>
              <a href="#narrative" onClick={() => setMenuOpen(false)}>Explore</a>
              <a href="#top" onClick={() => setMenuOpen(false)}>Sign in</a>
            </div>
          ) : null}
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
            <button
              aria-describedby="enter-prism-status"
              aria-disabled="true"
              className={`${styles.darkButton} ${styles.heroButton}`}
              type="button"
            >
              Enter Prism <span aria-hidden="true">›</span>
            </button>
            <span className={styles.srOnly} id="enter-prism-status">
              The Enter Prism transition is not available in this phase.
            </span>
          </div>

          <div className={styles.heroObject}>
            <div className={styles.heroAssembly}>
              <RefractedCore className={styles.heroCore} state="PRISM" variant="living" />
              <div className={styles.plinth} aria-hidden="true">
                <span />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.narrative} id="narrative" aria-labelledby="narrative-title">
        <h2 className={styles.srOnly} id="narrative-title">How Prism identity persists across accounts</h2>

        <div className={styles.storyLayout}>
          <aside
            className={styles.stickyCore}
            aria-label={`Living Refracted Core. Current narrative state: ${narrativeState.label}`}
          >
            <div className={styles.stickyCoreInner}>
              <div className={styles.storyCoreStage} aria-hidden="true">
                <RefractedCore className={styles.storyCore} state={narrativeState.core} variant="living" />
                <span className={styles.storyCoreShadow} />
              </div>
              <div className={styles.storyReadout}>
                <span>Living Core</span>
                <strong>{narrativeState.label}</strong>
              </div>
            </div>
          </aside>

          <ol className={styles.storySections} ref={storyRef}>
            <li
              aria-current={activeBeat === "identity-anchor" ? "step" : undefined}
              className={`${styles.storySection} ${activeBeat === "identity-anchor" ? styles.storyActive : ""}`}
              data-core-state="ID"
              id="identity-anchor"
            >
              <div className={styles.storyIndex}>01 / 04</div>
              <div className={styles.storyCopy}>
                <p className={styles.eyebrow}>One persistent center</p>
                <h3>Starknet anchors your Prism ID.</h3>
              </div>
              <dl className={styles.contextLedger} aria-label="Starknet role">
                <ContextRow label="Starknet" state="Identity anchor" />
              </dl>
            </li>

            <li
              aria-current={activeBeat === "native-execution" ? "step" : undefined}
              className={`${styles.storySection} ${activeBeat === "native-execution" ? styles.storyActive : ""}`}
              data-core-state="PRISM"
              id="native-execution"
            >
              <div className={styles.storyIndex}>02 / 04</div>
              <div className={styles.storyCopy}>
                <p className={styles.eyebrow}>Persistent identity. Venue-specific authority.</p>
                <h3>Your accounts stay native. Your identity stays coherent.</h3>
              </div>
              <dl className={`${styles.contextLedger} ${styles.contextPair}`} aria-label="MVP identity and execution contexts">
                <ContextRow label="Starknet" state="Identity anchor" />
                <ContextRow label="Base" state="Native execution" />
              </dl>
            </li>

            <li
              aria-current={activeBeat === "home-resolution" ? "step" : undefined}
              className={`${styles.storySection} ${activeBeat === "home-resolution" ? styles.storyActive : ""}`}
              data-core-state="HOME"
              id="home-resolution"
            >
              <div className={styles.storyIndex}>03 / 04</div>
              <div className={styles.storyCopy}>
                <p className={styles.eyebrow}>The experience resolves</p>
                <h3>Your Home, Wherever You Act.</h3>
              </div>
              <div className={styles.resolutionLine} aria-hidden="true">
                <span />
                <i />
                <span />
              </div>
            </li>

            <li
              aria-current={activeBeat === "continuity" ? "step" : undefined}
              className={`${styles.storySection} ${activeBeat === "continuity" ? styles.storyActive : ""}`}
              data-core-state="CONTINUITY"
              id="continuity"
            >
              <div className={styles.storyIndex}>04 / 04</div>
              <div className={styles.storyCopy}>
                <p className={styles.eyebrow}>Continuity</p>
                <h3>One Prism ID. One persistent identity across the accounts you use.</h3>
              </div>
            </li>
          </ol>
        </div>
      </section>
    </main>
  );
}
