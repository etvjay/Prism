"use client";

import { useEffect, useRef, useState } from "react";
import RefractedCore, { type RefractedCoreState } from "./RefractedCore";
import styles from "./PrismLanding.module.css";

function BrandLockup() {
  return (
    <a className={styles.brandLockup} href="#top" aria-label="Prism">
      <RefractedCore label="Prism" state="PRISM" variant="flat" />
      <span>Prism</span>
    </a>
  );
}

export default function PrismLanding() {
  const enterTimerRef = useRef<number | null>(null);
  const [coreState, setCoreState] = useState<RefractedCoreState>("PRISM");
  const [entering, setEntering] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    return () => {
      if (enterTimerRef.current !== null) window.clearTimeout(enterTimerRef.current);
    };
  }, []);

  const enterPrism = () => {
    if (enterTimerRef.current !== null) window.clearTimeout(enterTimerRef.current);

    setEntering(true);
    setCoreState("HOME");
    enterTimerRef.current = window.setTimeout(() => {
      setCoreState("PRISM");
      setEntering(false);
      enterTimerRef.current = null;
    }, 720);
  };

  return (
    <main className={styles.page} id="top">
      <section className={`${styles.heroShell} ${entering ? styles.heroEntering : ""}`} aria-labelledby="hero-title">
        <nav className={styles.publicNav} aria-label="Public navigation">
          <BrandLockup />

          <div className={styles.navLinks}>
            <a href="#top">Home</a>
            <a href="#top">ID</a>
            <a href="#top">Explore</a>
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
            <div className={styles.mobileMenu} id="mobile-menu" role="menu">
              <a href="#top" role="menuitem" onClick={() => setMenuOpen(false)}>Home</a>
              <a href="#top" role="menuitem" onClick={() => setMenuOpen(false)}>ID</a>
              <a href="#top" role="menuitem" onClick={() => setMenuOpen(false)}>Explore</a>
              <a href="#top" role="menuitem" onClick={() => setMenuOpen(false)}>Sign in</a>
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
            <button className={`${styles.darkButton} ${styles.heroButton}`} type="button" onClick={enterPrism}>
              Enter Prism <span aria-hidden="true">›</span>
            </button>
          </div>

          <div className={styles.heroObject} aria-live="polite">
            <div className={styles.heroAssembly}>
              <RefractedCore className={styles.heroCore} state={coreState} variant="living" />
              <div className={styles.plinth} aria-hidden="true">
                <span />
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
