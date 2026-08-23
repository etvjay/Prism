import type { CSSProperties } from "react";

export type RefractedCoreState = "prism" | "home" | "id" | "continuity";

type RefractedCoreProps = {
  className?: string;
  decorative?: boolean;
  size?: number | string;
  state?: RefractedCoreState;
  title?: string;
};

const facets = [
  "44 36 50 11 59 9 55 36",
  "60 38 79 19 86 26 68 44",
  "69 47 94 42 96 51 70 56",
  "66 60 88 72 81 82 61 68",
  "55 69 59 94 50 97 48 70",
  "42 67 27 88 18 82 36 60",
  "34 55 7 62 5 52 34 47",
  "38 41 17 29 24 19 45 35",
];

export function RefractedCore({
  className = "",
  decorative = true,
  size = 24,
  state = "prism",
  title = "Refracted Core",
}: RefractedCoreProps) {
  const accessibility = decorative
    ? { "aria-hidden": true as const }
    : { role: "img", "aria-label": title };

  return (
    <svg
      {...accessibility}
      className={`refracted-core refracted-core--${state} ${className}`.trim()}
      height={size}
      style={{ "--core-size": typeof size === "number" ? `${size}px` : size } as CSSProperties}
      viewBox="0 0 100 100"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {facets.map((points, index) => (
        <polygon
          className={`refracted-core__facet refracted-core__facet--${index + 1}`}
          key={points}
          points={points}
        />
      ))}
    </svg>
  );
}
