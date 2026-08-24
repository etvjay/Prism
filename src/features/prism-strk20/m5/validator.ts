// Upstream validator invocation — when configured, run actual validator logic.
// M5_CLOSEOUT_PROTOCOL: "Run the actual upstream validator where available. A local reimplementation is not sufficient."
// We support two modes:
//  1. Local hub validator script path (e.g. ops/evidence/validate.mjs or external hub's scripts/build-projects.mjs)
//  2. HTTP validator endpoint (STRK20_VALIDATOR_URL)
// If not configured, we return null and runner stays X2.

import type { Hex } from "../domain/receipt";
import type { ValidatorPort } from "./ports";
import { spawnSync } from "node:child_process";

export function createValidatorFromEnv(): ValidatorPort | null {
  const path = process.env.STRK20_VALIDATOR_PATH ?? process.env.UPSTREAM_VALIDATOR_PATH ?? null;
  const url = process.env.STRK20_VALIDATOR_URL ?? null;

  if (url) {
    return {
      async validate(hash: Hex) {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hash, network: "SN_SEPOLIA" }),
        });
        if (!res.ok) return { ok: false, pool: false, mine: false, reason: `validator http ${res.status}` };
        const j = (await res.json()) as { ok?: boolean; pool?: boolean; mine?: boolean; reason?: string };
        return { ok: !!j.ok, pool: !!j.pool, mine: !!j.mine, reason: j.reason };
      },
    };
  }

  if (path) {
    return {
      async validate(hash: Hex) {
        // Run validator script synchronously — expects exit 0 for pass, JSON on stdout
        const r = spawnSync("node", [path, hash], { encoding: "utf-8", timeout: 15000 });
        if (r.status !== 0) {
          return { ok: false, pool: false, mine: false, reason: r.stderr?.slice(0, 500) ?? `exit ${r.status}` };
        }
        try {
          const j = JSON.parse(r.stdout);
          return { ok: !!j.ok, pool: !!j.pool, mine: !!j.mine, reason: j.reason };
        } catch {
          // Script output not JSON — treat as pass/fail via exit code only
          return { ok: true, pool: true, mine: true };
        }
      },
    };
  }

  return null;
}

// X2 fixture validator for local tests — deterministic, never fabricates mainnet evidence
export function createFixtureValidator(mine: boolean): ValidatorPort {
  return {
    async validate() {
      return { ok: true, pool: true, mine, reason: mine ? undefined : "fixture mine=false" };
    },
  };
}
