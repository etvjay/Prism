// Clock adapters (port: Clock). System clock for runtime; fixed clock for
// deterministic tests and expiry-boundary control.

import type { Clock } from "../domain/ports";

export const systemClock: Clock = {
  now: () => Math.floor(Date.now() / 1000),
};

export interface FixedClock extends Clock {
  advance(seconds: number): void;
  setTo(epochSeconds: number): void;
}

/** Deterministic clock double — clearly labeled test/reference utility. */
export function fixedClock(startEpochSeconds: number): FixedClock {
  let current = Math.floor(startEpochSeconds);
  return {
    now: () => current,
    advance(seconds: number) {
      current += seconds;
    },
    setTo(epochSeconds: number) {
      current = Math.floor(epochSeconds);
    },
  };
}

/** Always-failing clock used to prove dependency failure paths are explicit. */
export const failingClock: Clock = {
  now: () => {
    throw new Error("clock_source_unavailable");
  },
};
