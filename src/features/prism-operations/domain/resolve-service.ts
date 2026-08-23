// Watermarked resolve serving boundary.
// Canonical-source preference: registry (Starknet) is authoritative per
// AUTHORITY_MATRIX A6; cache/indexer is secondary under bounded staleness.
// Stale-cache refusal: stale ACTIVE is never served (INV-SYS-007).
// Transport-neutral: no RPC/DB imports; reads via injected ports.

import type { RegistryReadPort } from "../../../application/ports";
import { isStaleProjection, resolveBinding, type ProjectionState } from "./event-indexer";
import { isWatermarkStale } from "./recovery";

export type ResolveServingResult = {
  /** Active destination or null = NO_ACTIVE_DESTINATION */
  executionAccount: string | null;
  /** Block watermark from canonical read */
  watermark: number | null;
  /** Authoritative source that served this result */
  authoritativeSource: "registry_canonical" | "indexer_projection" | "stale_refused";
  /** Whether the projection was stale and refused */
  staleRefused: boolean;
};

export class StaleCacheError extends Error {
  readonly code = "ERR-023" as const;
  readonly httpStatusHint = 409;
  constructor(message: string) {
    super(message);
    this.name = "StaleCacheError";
  }
}

export type ResolveServiceOptions = {
  /** Bounded staleness K (QRY-8-01). Default 5 blocks. */
  staleBoundK?: number;
  /**
   * Confirmed block provider — returns latest Starknet confirmed block number.
   * In production, wired to StarknetLedgerStatusAdapter or provider.getBlock.
   * If unavailable, stale checks are skipped (fail-open for liveness, but stale ACTIVE is still refused when watermark known).
   */
  getConfirmedBlock?: () => Promise<number | null>;
};

export class WatermarkedResolveService {
  private readonly registry: RegistryReadPort;
  /** Optional indexer projection for canonical-preference fallback (LEDGER_INDEX). */
  private readonly getProjection: (() => ProjectionState) | null;
  private readonly staleBoundK: number;
  private readonly getConfirmedBlock: (() => Promise<number | null>) | null;

  constructor(
    registry: RegistryReadPort,
    options: ResolveServiceOptions & { getProjection?: () => ProjectionState } = {},
  ) {
    this.registry = registry;
    this.getProjection = options.getProjection ?? null;
    this.staleBoundK = options.staleBoundK ?? 5;
    this.getConfirmedBlock = options.getConfirmedBlock ?? null;
  }

  /**
   * Resolve with canonical-source preference and stale-cache refusal.
   *
   * 1. Read canonical registry (authoritative per A6).
   * 2. If canonical watermark is stale vs confirmedBlock, refuse stale ACTIVE (serve NO_ACTIVE_DESTINATION).
   * 3. If registry is unavailable (throws), optionally fallback to indexer projection when watermark is fresh.
   * 4. Never serves stale ACTIVE as active (INV-SYS-007).
   */
  async resolve(
    prismId: string,
    venue: string,
    opts: { allowStale?: boolean; confirmedBlock?: number | null } = {},
  ): Promise<ResolveServingResult> {
    const allowStale = opts.allowStale ?? false;

    // Try canonical registry first
    try {
      const canonical = await this.registry.resolve(prismId, venue);
      const watermark = canonical.watermark;
      // Stale check if we can determine confirmed block
      const confirmedBlock = opts.confirmedBlock ?? (this.getConfirmedBlock ? await this.getConfirmedBlock() : null);
      if (confirmedBlock !== null && watermark !== null) {
        const stale = isWatermarkStale(watermark, confirmedBlock, this.staleBoundK);
        if (stale && canonical.executionAccount !== null && !allowStale) {
          // Stale ACTIVE refused: canonical ACTIVE is behind confirmed, do not serve as active
          return {
            executionAccount: null,
            watermark,
            authoritativeSource: "stale_refused",
            staleRefused: true,
          };
        }
        if (stale && canonical.executionAccount !== null && allowStale) {
          // Caller explicitly allows stale — serve but mark
          return {
            executionAccount: canonical.executionAccount,
            watermark,
            authoritativeSource: "registry_canonical",
            staleRefused: false,
          };
        }
      } else if (confirmedBlock !== null && watermark === null && canonical.executionAccount !== null && !allowStale) {
        // No watermark but have ACTIVE — treat as stale-refused for safety when confirmed known
        return {
          executionAccount: null,
          watermark: null,
          authoritativeSource: "stale_refused",
          staleRefused: true,
        };
      }
      return {
        executionAccount: canonical.executionAccount,
        watermark,
        authoritativeSource: "registry_canonical",
        staleRefused: false,
      };
    } catch {
      // Canonical read failure — fallback to indexer projection if available and not stale
      if (this.getProjection) {
        const projection = this.getProjection();
        const watermark = projection.watermark;
        const confirmedBlock = opts.confirmedBlock ?? (this.getConfirmedBlock ? await this.getConfirmedBlock() : null);
        if (confirmedBlock !== null && watermark !== null) {
          if (isStaleProjection(watermark, confirmedBlock, this.staleBoundK) && !allowStale) {
            throw new StaleCacheError(`stale_projection:watermark_${watermark}_confirmed_${confirmedBlock}_K_${this.staleBoundK}`);
          }
        }
        const executionAccount = resolveBinding(projection, prismId, venue);
        return {
          executionAccount,
          watermark,
          authoritativeSource: "indexer_projection",
          staleRefused: false,
        };
      }
      throw new StaleCacheError("registry_unavailable_and_no_projection");
    }
  }

  /** Direct watermark staleness check for testing/observability. */
  isStale(watermark: number | null, confirmedBlock: number): boolean {
    return isWatermarkStale(watermark, confirmedBlock, this.staleBoundK);
  }
}
