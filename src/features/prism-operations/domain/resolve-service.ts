// Watermarked resolve serving boundary.
// Canonical-source preference: registry (Starknet) is authoritative per
// AUTHORITY_MATRIX A6; cache/indexer is secondary under bounded staleness.
// Stale-cache refusal: stale ACTIVE is never served (INV-SYS-007).
// Transport-neutral: no RPC/DB imports; reads via injected ports.

import type { RegistryReadPort } from "../../../application/ports";
import { isStaleProjection, resolveBinding, type ProjectionState } from "./event-indexer";
import { isWatermarkStale } from "./recovery";

/**
 * Confirmed-block port — ledger "confirmed block" reader.
 * In production wired to StarknetLedgerStatusAdapter.getConfirmedBlock or
 * RpcProvider.getBlockLatestAccepted. Fail-closed on unknown: if the port
 * returns null or throws, stale ACTIVE is refused.
 */
export interface ConfirmedBlockPort {
  getConfirmedBlock(): Promise<number | null>;
}

/**
 * Async projection read boundary. Implementations are scoped to one registry,
 * network, and ABI version; they must never merge event streams from another
 * scope. The application resolver consumes only the reconstructed projection,
 * never raw provider events.
 */
export interface ProjectionReadPort {
  getProjection(): Promise<ProjectionState | null>;
}

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
   * In production, wired to StarknetLedgerStatusAdapter/ConfirmedBlockPort or provider.getBlock.
   * Fail-closed: if unavailable or throws, stale/unknown ACTIVE is refused.
   */
  getConfirmedBlock?: () => Promise<number | null>;
  /** Ledger-backed confirmed-block port (preferred over raw function). */
  confirmedBlockPort?: ConfirmedBlockPort;
  /** Durable/indexed projection fallback, bound to one canonical event scope. */
  projectionReadPort?: ProjectionReadPort;
};

export class WatermarkedResolveService {
  private readonly registry: RegistryReadPort;
  /** Optional indexer projection for canonical-preference fallback (LEDGER_INDEX). */
  private readonly getProjection: (() => ProjectionState | null | Promise<ProjectionState | null>) | null;
  private readonly projectionReadPort: ProjectionReadPort | null;
  private readonly staleBoundK: number;
  private readonly getConfirmedBlock: (() => Promise<number | null>) | null;
  private readonly confirmedBlockPort: ConfirmedBlockPort | null;

  constructor(
    registry: RegistryReadPort,
    options: ResolveServiceOptions & { getProjection?: () => ProjectionState | null | Promise<ProjectionState | null> } = {},
  ) {
    this.registry = registry;
    this.getProjection = options.getProjection ?? null;
    this.projectionReadPort = options.projectionReadPort ?? null;
    this.staleBoundK = options.staleBoundK ?? 5;
    this.getConfirmedBlock = options.getConfirmedBlock ?? null;
    this.confirmedBlockPort = options.confirmedBlockPort ?? null;
  }

  private async resolveConfirmedBlock(explicit: number | null | undefined): Promise<number | null> {
    if (explicit !== undefined && explicit !== null) return explicit;
    if (this.confirmedBlockPort) {
      try {
        return await this.confirmedBlockPort.getConfirmedBlock();
      } catch {
        return null; // fail-closed: treat port failure as unknown confirmed block
      }
    }
    if (this.getConfirmedBlock) {
      try {
        return await this.getConfirmedBlock();
      } catch {
        return null;
      }
    }
    return null;
  }

  private async readProjection(): Promise<ProjectionState | null> {
    if (this.projectionReadPort) {
      try {
        return await this.projectionReadPort.getProjection();
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message.slice(0, 120) : "unknown";
        throw new StaleCacheError(`projection_unavailable:${detail}`);
      }
    }
    if (this.getProjection) {
      try {
        return await this.getProjection();
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message.slice(0, 120) : "unknown";
        throw new StaleCacheError(`projection_unavailable:${detail}`);
      }
    }
    return null;
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
      // Fail-closed: unknown watermark with ACTIVE is refused when confirmed block is known or when ledger is unknown
      const confirmedBlock = await this.resolveConfirmedBlock(opts.confirmedBlock);
      // If ledger/confirmed block is unknown (null) and we have ACTIVE, fail closed unless allowStale
      if (confirmedBlock === null && canonical.executionAccount !== null && !allowStale) {
        // Unknown confirmed block — cannot prove freshness, refuse stale ACTIVE
        // Exception: if watermark is also null and caller explicitly allows unknown, we still refuse by default
        // This is fail-closed per INV-SYS-007: never serve stale ACTIVE as active
        return {
          executionAccount: null,
          watermark,
          authoritativeSource: "stale_refused",
          staleRefused: true,
        };
      }
      if (confirmedBlock !== null && watermark !== null) {
        const stale = isWatermarkStale(watermark, confirmedBlock, this.staleBoundK);
        if (stale && canonical.executionAccount !== null && !allowStale) {
          return {
            executionAccount: null,
            watermark,
            authoritativeSource: "stale_refused",
            staleRefused: true,
          };
        }
        if (stale && canonical.executionAccount !== null && allowStale) {
          return {
            executionAccount: canonical.executionAccount,
            watermark,
            authoritativeSource: "registry_canonical",
            staleRefused: false,
          };
        }
      } else if (confirmedBlock !== null && watermark === null && canonical.executionAccount !== null && !allowStale) {
        return {
          executionAccount: null,
          watermark: null,
          authoritativeSource: "stale_refused",
          staleRefused: true,
        };
      }
      if (canonical.executionAccount === null) {
        // NO_ACTIVE_DESTINATION is always safe to serve, even when stale/unknown — it's fail-closed by definition
        return {
          executionAccount: null,
          watermark,
          authoritativeSource: "registry_canonical",
          staleRefused: false,
        };
      }
      return {
        executionAccount: canonical.executionAccount,
        watermark,
        authoritativeSource: "registry_canonical",
        staleRefused: false,
      };
    } catch (cause) {
      // Canonical read failure — fallback to indexer projection if available and not stale
      const projection = await this.readProjection();
      if (projection) {
        const watermark = projection.watermark;
        const confirmedBlock = await this.resolveConfirmedBlock(opts.confirmedBlock);
        // Fail-closed on unknown confirmed block when projection contains ACTIVE
        const execFromProjection = resolveBinding(projection, prismId, venue);
        if (confirmedBlock === null && execFromProjection !== null && !allowStale) {
          throw new StaleCacheError(`unknown_confirmed_block:watermark_${watermark}`);
        }
        if (confirmedBlock !== null && watermark !== null) {
          if (isStaleProjection(watermark, confirmedBlock, this.staleBoundK) && !allowStale) {
            throw new StaleCacheError(`stale_projection:watermark_${watermark}_confirmed_${confirmedBlock}_K_${this.staleBoundK}`);
          }
        } else if (confirmedBlock !== null && watermark === null && execFromProjection !== null && !allowStale) {
          throw new StaleCacheError(`stale_projection:unknown_watermark`);
        }
        if (watermark === null && execFromProjection !== null && !allowStale) {
          throw new StaleCacheError(`stale_projection:null_watermark_with_active`);
        }
        return {
          executionAccount: execFromProjection,
          watermark,
          authoritativeSource: "indexer_projection",
          staleRefused: false,
        };
      }
      // Preserve StaleCacheError if already thrown
      if (cause instanceof StaleCacheError) throw cause;
      throw new StaleCacheError("registry_unavailable_and_no_projection");
    }
  }

  /** Direct watermark staleness check for testing/observability. */
  isStale(watermark: number | null, confirmedBlock: number): boolean {
    return isWatermarkStale(watermark, confirmedBlock, this.staleBoundK);
  }
}
