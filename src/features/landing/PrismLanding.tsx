"use client";

import { useEffect, useRef, useState } from "react";
import RefractedCore, { type RefractedCoreState } from "./RefractedCore";
import styles from "./PrismLanding.module.css";

type HeroContext = {
  network: "Starknet" | "Base";
  role: "Identity anchor" | "Native execution";
};

type HeroNarrativeState = {
  core: RefractedCoreState;
  contexts: readonly HeroContext[];
  holdMs: number;
  id: "promise" | "identity-anchor" | "native-context" | "resolved-identity";
  label: string;
  support: string;
  title: readonly [string, string];
};

const identityContexts: readonly HeroContext[] = [
  { network: "Starknet", role: "Identity anchor" },
  { network: "Base", role: "Native execution" },
];

const heroNarrative: readonly HeroNarrativeState[] = [
  {
    core: "PRISM",
    contexts: [],
    holdMs: 3000,
    id: "promise",
    label: "Promise",
    support: "One Prism ID for your identity, assets, relationships, and activity across networks.",
    title: ["Your Home", "Across Chains."],
  },
  {
    core: "ID",
    contexts: [identityContexts[0]],
    holdMs: 3200,
    id: "identity-anchor",
    label: "Identity anchor",
    support: "Starknet anchors your Prism ID.",
    title: ["Your Home,", "Wherever You Act."],
  },
  {
    core: "CONTINUITY",
    contexts: identityContexts,
    holdMs: 3900,
    id: "native-context",
    label: "Native contexts",
    support: "Your accounts stay native. Your identity stays coherent.",
    title: ["Your Home,", "Wherever You Act."],
  },
  {
    core: "HOME",
    contexts: identityContexts,
    holdMs: 0,
    id: "resolved-identity",
    label: "Persistent identity",
    support: "One Prism ID. One persistent identity across the accounts you use.",
    title: ["Your Home,", "Wherever You Act."],
  },
];

const finalHeroStateIndex = heroNarrative.length - 1;

function BrandLockup() {
  return (
    <a className={styles.brandLockup} href="#top" aria-label="Prism home">
      <RefractedCore label="" state="PRISM" variant="flat" />
      <span>Prism</span>
    </a>
  );
}

export default function PrismLanding() {
  const enterTimerRef = useRef<number | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [activeStateIndex, setActiveStateIndex] = useState(0);
  const [entryAcknowledged, setEntryAcknowledged] = useState(false);
  const [entering, setEntering] = useState(false);
  const [introRunning, setIntroRunning] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const activeState = heroNarrative[activeStateIndex];
  const sequenceComplete = activeStateIndex === finalHeroStateIndex;

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const applyMotionPreference = () => {
      setReducedMotion(motionQuery.matches);

      if (motionQuery.matches) {
        setIntroRunning(false);
        setActiveStateIndex(finalHeroStateIndex);
      }
    };

    applyMotionPreference();
    motionQuery.addEventListener("change", applyMotionPreference);
    return () => motionQuery.removeEventListener("change", applyMotionPreference);
  }, []);

  useEffect(() => {
    if (reducedMotion || !introRunning || sequenceComplete) return;

    const timer = window.setTimeout(() => {
      setActiveStateIndex((current) => Math.min(current + 1, finalHeroStateIndex));
    }, activeState.holdMs);

    return () => window.clearTimeout(timer);
  }, [activeState.holdMs, introRunning, reducedMotion, sequenceComplete]);

  useEffect(() => {
    return () => {
      if (enterTimerRef.current !== null) window.clearTimeout(enterTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };

    window.addEventListener("keydown", closeMenuOnEscape);
    return () => window.removeEventListener("keydown", closeMenuOnEscape);
  }, [menuOpen]);

  const selectHeroState = (stateIndex: number) => {
    setIntroRunning(false);
    setActiveStateIndex(stateIndex);
  };

  const previewEntryTransition = () => {
    if (entering) return;

    setIntroRunning(false);
    setEntryAcknowledged(true);

    if (reducedMotion) return;

    setEntering(true);
    enterTimerRef.current = window.setTimeout(() => {
      setEntering(false);
      enterTimerRef.current = null;
    }, 1200);
  };

  const closeMenuAndSelect = (stateIndex: number) => {
    setMenuOpen(false);
    selectHeroState(stateIndex);
  };

  return (
    <main className={styles.page} id="top">
      <section
        className={`${styles.heroShell} ${entering ? styles.heroEntering : ""}`}
        aria-labelledby="hero-title"
      >
        <nav className={styles.publicNav} aria-label="Public navigation">
          <BrandLockup />

          <div className={styles.navLinks}>
            <a href="#top" onClick={() => selectHeroState(0)}>Home</a>
            <a href="#hero-sequence" onClick={() => selectHeroState(1)}>ID</a>
            <a href="#identity-context" onClick={() => selectHeroState(2)}>Explore</a>
          </div>

          <div className={styles.navActions}>
            <a className={styles.signInLink} href="#enter-prism">Entry preview</a>
            <button
              aria-controls="mobile-menu"
              aria-expanded={menuOpen}
              aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
              className={styles.menuButton}
              ref={menuButtonRef}
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
              <a href="#top" onClick={() => closeMenuAndSelect(0)}>Home</a>
              <a href="#hero-sequence" onClick={() => closeMenuAndSelect(1)}>ID</a>
              <a href="#identity-context" onClick={() => closeMenuAndSelect(2)}>Explore</a>
              <a href="#enter-prism" onClick={() => setMenuOpen(false)}>Entry preview</a>
            </div>
          ) : null}
        </nav>

        <div className={styles.heroContent} id="hero-sequence">
          <div className={styles.heroCopy}>
            <div
              aria-atomic="true"
              aria-live="polite"
              className={styles.heroMessage}
              key={activeState.id}
            >
              <p className={styles.eyebrow}>
                {String(activeStateIndex + 1).padStart(2, "0")} / 04 · {activeState.label}
              </p>
              <h1 id="hero-title">
                {activeState.title[0]}
                <br />
                {activeState.title[1]}
              </h1>
              <p className={styles.heroSupport}>{activeState.support}</p>
            </div>

            <div className={styles.contextStage} id="identity-context">
              {activeState.contexts.length > 0 ? (
                <dl className={styles.contextLedger} aria-label="Prism identity and execution contexts">
                  {activeState.contexts.map((context) => (
                    <div className={styles.contextRow} key={context.network}>
                      <dt>{context.network}</dt>
                      <dd>{context.role}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className={styles.contextPlaceholder}>Identity continuity, without replacing native accounts.</p>
              )}
            </div>

            <div className={styles.sequenceControls} aria-label="Hero narrative states">
              <div className={styles.sequenceSteps}>
                {heroNarrative.map((state, stateIndex) => (
                  <button
                    aria-label={`Show ${state.label.toLowerCase()} state`}
                    aria-pressed={stateIndex === activeStateIndex}
                    className={styles.sequenceStep}
                    key={state.id}
                    onClick={() => selectHeroState(stateIndex)}
                    type="button"
                  >
                    <span aria-hidden="true">{String(stateIndex + 1).padStart(2, "0")}</span>
                  </button>
                ))}
              </div>
              {!reducedMotion && !sequenceComplete ? (
                <button
                  className={styles.sequenceToggle}
                  onClick={() => setIntroRunning((running) => !running)}
                  type="button"
                >
                  {introRunning ? "Pause intro" : "Continue intro"}
                </button>
              ) : null}
            </div>

            <button
              aria-describedby="enter-prism-status"
              className={`${styles.darkButton} ${styles.heroButton}`}
              disabled={entering}
              id="enter-prism"
              onClick={previewEntryTransition}
              type="button"
            >
              {entering ? "Previewing transition" : "Enter Prism"}
              <span aria-hidden="true">›</span>
            </button>
            <p
              aria-live="polite"
              className={styles.entryStatus}
              id="enter-prism-status"
              role="status"
            >
              {entering
                ? "Transition preview only. No sign-in or navigation has occurred."
                : entryAcknowledged
                  ? reducedMotion
                    ? "Entry preview acknowledged. Motion is off; no sign-in or navigation occurred."
                    : "Transition preview complete. No sign-in or navigation occurred."
                  : "Preview only — product entry is not connected yet."}
            </p>
          </div>

          <div className={styles.heroObject}>
            <div className={styles.heroAssembly}>
              <RefractedCore
                className={styles.heroCore}
                label={`Living Refracted Core. Current state: ${activeState.label}`}
                state={activeState.core}
                variant="living"
              />
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
