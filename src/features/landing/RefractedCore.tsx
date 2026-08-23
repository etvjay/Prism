import { useId } from "react";
import styles from "./PrismLanding.module.css";

export type RefractedCoreState = "PRISM" | "HOME" | "ID" | "CONTINUITY";

type RefractedCoreProps = {
  className?: string;
  label?: string;
  state?: RefractedCoreState;
  variant?: "flat" | "living";
};

const facets = [
  "M108 101 L106 36 L129 17 L132 99 Z",
  "M137 103 L165 62 L219 44 L166 106 Z",
  "M143 113 L211 95 L229 121 L144 134 Z",
  "M138 140 L190 169 L210 218 L127 148 Z",
  "M119 145 L132 226 L98 214 L107 142 Z",
  "M101 136 L46 193 L27 168 L95 119 Z",
  "M97 112 L19 96 L47 71 L106 101 Z",
  "M104 99 L68 38 L96 24 L118 97 Z",
];

export default function RefractedCore({
  className = "",
  label = "Prism Refracted Core",
  state = "PRISM",
  variant = "living",
}: RefractedCoreProps) {
  const instanceId = useId().replaceAll(":", "");
  const gradientIds = {
    ivory: `prism-ivory-${instanceId}`,
    neutral: `prism-neutral-facet-${instanceId}`,
    graphite: `prism-graphite-${instanceId}`,
    pearl: `prism-pearl-${instanceId}`,
    core: `prism-core-${instanceId}`,
    shadow: `prism-soft-shadow-${instanceId}`,
  };
  const livingFills = [
    gradientIds.neutral,
    gradientIds.ivory,
    gradientIds.graphite,
    gradientIds.neutral,
    gradientIds.ivory,
    gradientIds.neutral,
    gradientIds.graphite,
    gradientIds.ivory,
  ];

  return (
    <svg
      aria-label={label}
      className={`${styles.refractedCore} ${styles[variant]} ${className}`}
      data-state={state}
      role="img"
      viewBox="0 0 240 240"
    >
      <defs>
        <linearGradient id={gradientIds.ivory} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#fffdfa" />
          <stop offset="0.52" stopColor="#dfe0e5" />
          <stop offset="1" stopColor="#96989e" />
        </linearGradient>
        <linearGradient id={gradientIds.neutral} x1="0" x2="0.9" y1="0" y2="1">
          <stop offset="0" stopColor="#f6f6f7" />
          <stop offset="0.48" stopColor="#c5c6cb" />
          <stop offset="1" stopColor="#777980" />
        </linearGradient>
        <linearGradient id={gradientIds.graphite} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#a4a5aa" />
          <stop offset="0.5" stopColor="#5d5f64" />
          <stop offset="1" stopColor="#1f1e24" />
        </linearGradient>
        <linearGradient id={gradientIds.pearl} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#dedfe4" />
          <stop offset="1" stopColor="#8f9198" />
        </linearGradient>
        <radialGradient id={gradientIds.core} cx="38%" cy="28%" r="75%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.68" stopColor="#e1e2e6" />
          <stop offset="1" stopColor="#95979e" />
        </radialGradient>
        <filter id={gradientIds.shadow} x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="4" floodColor="#101010" floodOpacity="0.2" stdDeviation="3" />
        </filter>
      </defs>

      <g className={styles.facetGroup} filter={variant === "living" ? `url(#${gradientIds.shadow})` : undefined}>
        {facets.map((path, index) => (
          <path
            className={`${styles.facet} ${styles[`facet${index + 1}`]}`}
            d={path}
            key={path}
            style={variant === "living" ? { fill: `url(#${livingFills[index]})` } : undefined}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <circle
          className={styles.coreDisc}
          cx="120"
          cy="121"
          r="18"
          style={variant === "living" ? { fill: `url(#${gradientIds.core})` } : undefined}
        />
      </g>
    </svg>
  );
}
