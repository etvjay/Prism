import Image from "next/image";
import RefractedCore from "./RefractedCore";
import styles from "./PrismLanding.module.css";

export type IdentityContextMeshState =
  | "promise"
  | "identity-anchor"
  | "native-context"
  | "resolved-identity";

type IdentityContextMeshProps = {
  reducedMotion: boolean;
  signalKey: number;
  state: IdentityContextMeshState;
};

const stateDescriptions: Record<IdentityContextMeshState, string> = {
  promise:
    "Prism ID and Starknet form one bidirectional identity and execution unit.",
  "identity-anchor":
    "Prism ID and Starknet form one bidirectional unit, with Starknet emphasized as the canonical identity root and native execution network.",
  "native-context":
    "The Prism ID and Starknet unit routes downward to Base and Starknet native execution contexts.",
  "resolved-identity":
    "The model projects one persistent Prism identity across Base and Starknet native execution contexts, with Starknet as its canonical root.",
};

const signalRoutes: Record<IdentityContextMeshState, string> = {
  promise: "M374 91 H186",
  "identity-anchor": "M186 91 H374",
  "native-context": "M280 156 V218 H136 V270",
  "resolved-identity": "M280 156 V218 H424 V270",
};

function StarknetMark() {
  return (
    <span className={styles.starknetMark}>
      <Image
        alt=""
        height={159}
        src="/brand/starknet-symbol-gradient.svg"
        width={158}
      />
    </span>
  );
}

export default function IdentityContextMesh({
  reducedMotion,
  signalKey,
  state,
}: IdentityContextMeshProps) {
  return (
    <section
      aria-label={stateDescriptions[state]}
      className={styles.identityMesh}
      data-state={state}
      id="identity-context"
      role="img"
    >
      <div className={styles.meshHeading} aria-hidden="true">
        <span>Identity / execution structure</span>
        <span className={styles.meshHeadingRule} />
        <span>Identity model</span>
      </div>

      <div className={styles.meshCanvas} aria-hidden="true">
        <svg
          className={styles.meshRoutes}
          preserveAspectRatio="none"
          viewBox="0 0 560 390"
        >
          <path className={styles.meshRoute} d="M280 156 V218" />
          <path className={styles.meshRoute} d="M280 218 H136 V270" />
          <path className={styles.meshRoute} d="M280 218 H424 V270" />
          <circle className={styles.routeNode} cx="280" cy="218" r="3.5" />
          <circle className={styles.routeNode} cx="136" cy="270" r="3.5" />
          <circle className={styles.routeNode} cx="424" cy="270" r="3.5" />
        </svg>

        {!reducedMotion && signalKey > 0 ? (
          <svg
            className={styles.meshSignalRoutes}
            key={`${state}-${signalKey}`}
            preserveAspectRatio="none"
            viewBox="0 0 560 390"
          >
            <circle className={styles.routeSignal} cx="0" cy="0" r="3.2">
              <animateMotion
                begin="0s"
                dur="700ms"
                fill="freeze"
                path={signalRoutes[state]}
              />
              <animate
                attributeName="opacity"
                begin="0s"
                dur="700ms"
                fill="freeze"
                keyTimes="0;0.08;0.78;1"
                values="0;1;1;0"
              />
            </circle>
          </svg>
        ) : null}

        <div className={styles.primaryUnit}>
          <div className={styles.prismIdentity}>
            <span className={styles.prismIdentityMark}>
              <RefractedCore label="" state="HOME" variant="flat" />
            </span>
            <span className={styles.primaryCopy}>
              <span className={styles.moduleMeta}>Identity / continuity</span>
              <strong>Prism ID</strong>
            </span>
          </div>

          <div className={styles.identityRelation}>
            <span className={styles.relationLine} />
            <span className={styles.relationGlyph}>⇄</span>
            <span className={styles.relationLine} />
          </div>

          <div className={styles.starknetRoot}>
            <StarknetMark />
            <span className={styles.primaryCopy}>
              <span className={styles.moduleMeta}>Canonical root / execution</span>
              <strong>Starknet</strong>
            </span>
          </div>

          <span className={styles.unitCaption}>Primary identity + execution unit</span>
        </div>

        <div className={styles.contextLabel}>
          <span>Native execution</span>
          <i />
        </div>

        <div className={`${styles.contextModule} ${styles.baseModule}`}>
          <span className={styles.baseMark} />
          <span className={styles.contextCopy}>
            <strong>Base</strong>
            <span>Native execution</span>
          </span>
        </div>

        <div className={`${styles.contextModule} ${styles.starknetModule}`}>
          <StarknetMark />
          <span className={styles.contextCopy}>
            <strong>Starknet</strong>
            <span>Native execution</span>
          </span>
        </div>

        <div className={styles.resolutionRail}>
          <span />
          <strong>State projection</strong>
          <span />
        </div>
      </div>
    </section>
  );
}
