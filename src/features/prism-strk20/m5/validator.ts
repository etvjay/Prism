// Upstream validator invocation — when configured, run actual validator logic.
// M5_CLOSEOUT_PROTOCOL: "Run the actual upstream validator where available. A local reimplementation is not sufficient."
// We support two modes:
//  1. Local hub validator script path (e.g. ops/evidence/validate.mjs or external hub's scripts/build-projects.mjs)
//  2. HTTP validator endpoint (STRK20_VALIDATOR_URL)
// If not configured, we return null and runner stays X2.

import type { Hex } from "../domain/receipt";
import type { ValidatorPort } from "./ports";
import { spawnSync } from "node:child_process";

function safeValidatorReason(value: unknown, fallback = "validator_failure"): string {
  if (typeof value !== "string") return fallback;
  if (/viewing.?key|private.?key|private.?note|private.?balance|seed.?phrase|mnemonic|calldata|proof|raw|secret|password/i.test(value)) return fallback;
  return value.slice(0, 160);
}

function parseValidatorResult(value: unknown): { ok: boolean; pool: boolean; mine: boolean; reason?: string } | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Record<string, unknown>;
  if (typeof result.ok !== "boolean" || typeof result.pool !== "boolean" || typeof result.mine !== "boolean") return null;
  return {
    ok: result.ok,
    pool: result.pool,
    mine: result.mine,
    ...(typeof result.reason === "string" ? { reason: safeValidatorReason(result.reason) } : {}),
  };
}

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
        const parsed = parseValidatorResult(await res.json());
        return parsed ?? { ok: false, pool: false, mine: false, reason: "validator_response_malformed" };
      },
    };
  }

  if (path) {
    return {
      async validate(hash: Hex) {
        // Run validator script synchronously — expects exit 0 for pass, JSON on stdout
        const r = spawnSync("node", [path, hash], { encoding: "utf-8", timeout: 15000 });
        if (r.status !== 0) {
          return { ok: false, pool: false, mine: false, reason: safeValidatorReason(r.stderr, `validator_exit_${r.status}`) };
        }
        try {
          const parsed = parseValidatorResult(JSON.parse(r.stdout));
          return parsed ?? { ok: false, pool: false, mine: false, reason: "validator_response_malformed" };
        } catch {
          // Script output is not JSON; exit 0 is not proof of validator pass.
          return { ok: false, pool: false, mine: false, reason: "validator_output_malformed" };
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
