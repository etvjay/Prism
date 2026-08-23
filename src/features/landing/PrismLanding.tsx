"use client";

import { useEffect, useRef, useState } from "react";
import IdentityContextMesh, { type IdentityContextMeshState } from "./IdentityContextMesh";
import RefractedCore from "./RefractedCore";
import styles from "./PrismLanding.module.css";

type HeroNarrativeState = {
  holdMs: number;
  id: IdentityContextMeshState;
  support: string;
  title: readonly [string, string];
};

const heroNarrative: readonly HeroNarrativeState[] = [
  {
    holdMs: 3000,
    id: "promise",
    support: "One Prism ID for your identity, assets, relationships, and activity across networks.",
    title: ["Your Home", "Across Chains."],
  },
  {
    holdMs: 3200,
    id: "identity-anchor",
    support: "Starknet is your canonical identity root and native execution network.",
    title: ["Anchored on", "Starknet."],
  },
  {
    holdMs: 3900,
    id: "native-context",
    support: "Your accounts stay native. Your identity stays coherent.",
    title: ["Native where", "you act."],
  },
  {
    holdMs: 0,
    id: "resolved-identity",
    support: "One Prism ID. One persistent identity across the accounts you use.",
    title: ["Your Home,", "Wherever You Act."],
  },
];

const finalHeroStateIndex = heroNarrative.length - 1;

type SatinLayerProps = {
  className: string;
  text: string;
};

function SatinWords({ className, text }: SatinLayerProps) {
  return (
    <span aria-hidden="true" className={className}>
      {text.split(" ").map((word, wordIndex) => (
        <span className={styles.satinWord} key={`${word}-${wordIndex}`}>
          {word}
        </span>
      ))}
    </span>
  );
}

type SatinLineProps = {
  activeText: string;
  delayed?: boolean;
  previousText: string;
  transitionCycle: number;
};

function SatinLine({ activeText, delayed = false, previousText, transitionCycle }: SatinLineProps) {
  const transitioning = transitionCycle > 0 && activeText !== previousText;

  return (
    <span className={`${styles.satinLine} ${delayed ? styles.satinLineDelayed : ""}`}>
      {transitioning ? (
        <SatinWords
          className={`${styles.satinWords} ${styles.satinOutgoing}`}
          key={`out-${transitionCycle}`}
          text={previousText}
        />
      ) : null}
      <SatinWords
        className={`${styles.satinWords} ${transitioning ? styles.satinIncoming : styles.satinSettled}`}
        key={`in-${transitionCycle}`}
        text={activeText}
      />
    </span>
  );
}

function SatinBlock({ activeText, previousText, transitionCycle }: SatinLineProps) {
  const transitioning = transitionCycle > 0 && activeText !== previousText;

  return (
    <span className={styles.satinBlock}>
      {transitioning ? (
        <span
          aria-hidden="true"
          className={`${styles.satinBlockLayer} ${styles.satinBlockOutgoing}`}
          key={`out-${transitionCycle}`}
        >
          {previousText}
        </span>
      ) : null}
      <span
        aria-hidden="true"
        className={`${styles.satinBlockLayer} ${transitioning ? styles.satinBlockIncoming : styles.satinSettled}`}
        key={`in-${transitionCycle}`}
      >
        {activeText}
      </span>
    </span>
  );
}

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
  const [previousStateIndex, setPreviousStateIndex] = useState(0);
  const [entryAcknowledged, setEntryAcknowledged] = useState(false);
  const [entering, setEntering] = useState(false);
  const [introRunning, setIntroRunning] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [transitionCycle, setTransitionCycle] = useState(0);

  const activeState = heroNarrative[activeStateIndex];
  const previousState = heroNarrative[previousStateIndex];
  const sequenceComplete = activeStateIndex === finalHeroStateIndex;

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const applyMotionPreference = () => {
      setReducedMotion(motionQuery.matches);

      if (motionQuery.matches) {
        setIntroRunning(false);
        setActiveStateIndex(finalHeroStateIndex);
        setPreviousStateIndex(finalHeroStateIndex);
        setTransitionCycle(0);
      }
    };

    applyMotionPreference();
    motionQuery.addEventListener("change", applyMotionPreference);
    return () => motionQuery.removeEventListener("change", applyMotionPreference);
  }, []);

  useEffect(() => {
    if (reducedMotion || !introRunning || sequenceComplete) return;

    const timer = window.setTimeout(() => {
      setPreviousStateIndex(activeStateIndex);
      setActiveStateIndex(Math.min(activeStateIndex + 1, finalHeroStateIndex));
      setTransitionCycle((cycle) => cycle + 1);
    }, activeState.holdMs);

    return () => window.clearTimeout(timer);
  }, [activeState.holdMs, activeStateIndex, introRunning, reducedMotion, sequenceComplete]);

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
    if (stateIndex === activeStateIndex) return;

    setPreviousStateIndex(activeStateIndex);
    setActiveStateIndex(stateIndex);
    setTransitionCycle((cycle) => cycle + 1);
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
            <div className={styles.heroMessage}>
              <p className={styles.eyebrow}>Prism</p>
              <h1 aria-label={`${activeState.title[0]} ${activeState.title[1]}`} id="hero-title">
                <SatinLine
                  activeText={activeState.title[0]}
                  previousText={previousState.title[0]}
                  transitionCycle={transitionCycle}
                />
                <SatinLine
                  activeText={activeState.title[1]}
                  delayed
                  previousText={previousState.title[1]}
                  transitionCycle={transitionCycle}
                />
              </h1>
              <p aria-label={activeState.support} className={styles.heroSupport}>
                <SatinBlock
                  activeText={activeState.support}
                  previousText={previousState.support}
                  transitionCycle={transitionCycle}
                />
              </p>
              <p
                aria-atomic="true"
                aria-live="polite"
                className={styles.narrativeAnnouncement}
              >
                {`${activeState.title[0]} ${activeState.title[1]} ${activeState.support}`}
              </p>
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
            <IdentityContextMesh
              reducedMotion={reducedMotion}
              signalKey={transitionCycle}
              state={activeState.id}
            />
          </div>
        </div>
      </section>
    </main>
  );
}
