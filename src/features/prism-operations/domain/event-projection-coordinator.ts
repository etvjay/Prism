// Durable canonical-event projection coordinator.
// Ordering: fetch facts → persist canonical events → CAS checkpoint.
// A crash between persistence and checkpoint is safe: replay is deduplicated
// by (registry scope, tx_hash,event_index). A checkpoint never advances past failed persistence.

import {
  normalizeRegistryEventScope,
  withEventScope,
  canonicalizeEventPrismId,
  type RegistryAbiVersion,
  type RegistryCanonicalEvent,
  type RegistryEventScope,
  reconstruct,
  type ProjectionState,
} from "./event-indexer";
import type { PrismEventsStore } from "../adapters/postgres-prism-events-store";
import type {
  EventProjectionCheckpoint,
  EventProjectionCheckpointInput,
  EventProjectionCheckpointStore,
} from "./event-projection-checkpoint";
import type { ProjectionReadPort } from "./resolve-service";

export interface EventProjectionIndexer {
  fetchAllRegistryEvents(input: { fromBlock: number; toBlock?: number | string }): Promise<{
    events: RegistryCanonicalEvent[];
    watermark: number | null;
    pagesFetched: number;
  }>;
}

export type EventProjectionCoordinatorOptions = {
  registryAddress: string;
  network: string;
  registryVersion?: RegistryAbiVersion;
  abiVersion?: RegistryAbiVersion;
  initialFromBlock: number;
  checkpointStore: EventProjectionCheckpointStore;
  eventsStore: PrismEventsStore;
  indexer: EventProjectionIndexer;
  now?: () => number;
};

export type EventProjectionRunResult = {
  advanced: boolean;
  reason: string;
  fromBlock: number;
  nextFromBlock: number | null;
  scanWatermark: number | null;
  eventWatermark: number | null;
  pagesFetched: number;
  inserted: number;
  duplicates: number;
  checkpointVersion: number | null;
};

export class EventProjectionCoordinator implements ProjectionReadPort {
  private readonly registryAddress: string;
  private readonly network: string;
  private readonly registryVersion: RegistryAbiVersion;
  private readonly scope: RegistryEventScope;
  private readonly initialFromBlock: number;
  private readonly checkpointStore: EventProjectionCheckpointStore;
  private readonly eventsStore: PrismEventsStore;
  private readonly indexer: EventProjectionIndexer;
  private readonly now: () => number;
  private runInFlight: Promise<EventProjectionRunResult> | null = null;

  constructor(options: EventProjectionCoordinatorOptions) {
    if (!/^0x[0-9a-fA-F]{1,64}$/.test(options.registryAddress)) throw new Error("event_projection_invalid_registry_address");
    if (!Number.isInteger(options.initialFromBlock) || options.initialFromBlock < 0) throw new Error("event_projection_invalid_initial_block");
    if (!options.network) throw new Error("event_projection_missing_network");
    if (!options.registryVersion && !options.abiVersion) throw new Error("event_projection_missing_registry_version");
    try {
      this.scope = normalizeRegistryEventScope({ registryAddress: options.registryAddress, network: options.network, registryVersion: options.registryVersion, abiVersion: options.abiVersion });
    } catch (cause) {
      throw new Error(cause instanceof Error ? cause.message : "event_projection_invalid_scope");
    }
    this.registryAddress = this.scope.registryAddress;
    this.network = this.scope.network;
    this.registryVersion = this.scope.registryVersion;
    this.initialFromBlock = options.initialFromBlock;
    this.checkpointStore = options.checkpointStore;
    this.eventsStore = options.eventsStore;
    this.indexer = options.indexer;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  async runOnce(): Promise<EventProjectionRunResult> {
    if (this.runInFlight) return this.runInFlight;
    const run = this.runOnceInternal();
    this.runInFlight = run;
    try {
      return await run;
    } finally {
      if (this.runInFlight === run) this.runInFlight = null;
    }
  }

  private async runOnceInternal(): Promise<EventProjectionRunResult> {
    const checkpoint = await this.checkpointStore.get(this.scope);
    if (checkpoint && (checkpoint.network !== this.network || checkpoint.registryAddress !== this.registryAddress || checkpoint.registryVersion !== this.registryVersion)) {
      throw new Error("event_projection_checkpoint_identity_mismatch");
    }
    const fromBlock = checkpoint?.nextFromBlock ?? this.initialFromBlock;
    const fetched = await this.indexer.fetchAllRegistryEvents({ fromBlock, toBlock: "latest" });
    const scopedEvents = fetched.events.map((event) => {
      try {
        const payload = event.payload as { prismId?: unknown };
        if (typeof payload.prismId !== "string") throw new Error("event_prism_id_invalid");
        return withEventScope({
          ...event,
          payload: { ...payload, prismId: canonicalizeEventPrismId(payload.prismId) } as RegistryCanonicalEvent["payload"],
        }, this.scope);
      } catch (cause) {
        if (cause instanceof Error && cause.message === "event_prism_id_invalid") {
          throw new Error("event_projection_prism_id_invalid");
        }
        throw new Error("event_projection_event_scope_mismatch");
      }
    });
    const eventWatermark = maxEventBlock(scopedEvents);
    const scanWatermark = fetched.watermark;
    if (scanWatermark === null) {
      return {
        advanced: false,
        reason: "missing_scan_watermark",
        fromBlock,
        nextFromBlock: null,
        scanWatermark: null,
        eventWatermark,
        pagesFetched: fetched.pagesFetched,
        inserted: 0,
        duplicates: 0,
        checkpointVersion: checkpoint?.version ?? null,
      };
    }
    if (!Number.isInteger(scanWatermark) || scanWatermark < fromBlock - 1) {
      throw new Error("event_projection_scan_watermark_regressed");
    }
    if (eventWatermark !== null && eventWatermark > scanWatermark) {
      throw new Error("event_projection_event_ahead_of_scan_watermark");
    }

    // Persist first. If this throws, no checkpoint mutation is attempted.
    const persisted = await this.eventsStore.insertMany(scopedEvents, this.scope);
    const next: EventProjectionCheckpointInput = {
      registryAddress: this.registryAddress,
      network: this.network,
      registryVersion: this.registryVersion,
      nextFromBlock: scanWatermark + 1,
      scanWatermark,
      eventWatermark: maxNullable(checkpoint?.eventWatermark ?? null, eventWatermark),
      continuationToken: null,
    };
    const committed = await this.checkpointStore.compareAndSet(checkpoint?.version ?? null, next, this.now());
    if (!committed) {
      return {
        advanced: false,
        reason: "checkpoint_cas_conflict",
        fromBlock,
        nextFromBlock: null,
        scanWatermark,
        eventWatermark,
        pagesFetched: fetched.pagesFetched,
        inserted: persisted.inserted,
        duplicates: persisted.duplicates,
        checkpointVersion: checkpoint?.version ?? null,
      };
    }
    const committedCheckpoint = await this.checkpointStore.get(this.scope);
    return {
      advanced: true,
      reason: fetched.events.length ? "events_persisted_and_checkpoint_advanced" : "empty_scan_checkpoint_advanced",
      fromBlock,
      nextFromBlock: next.nextFromBlock,
      scanWatermark,
      eventWatermark,
      pagesFetched: fetched.pagesFetched,
      inserted: persisted.inserted,
      duplicates: persisted.duplicates,
      checkpointVersion: committedCheckpoint?.version ?? null,
    };
  }

  async getCheckpoint(): Promise<EventProjectionCheckpoint | null> {
    return this.checkpointStore.get(this.scope);
  }

  /**
   * Read the durable, scope-bound event projection for application fallback
   * resolution. The scan watermark is preferred over the newest event block
   * so an empty/old-event scan still carries the actual indexed head.
   */
  async getProjection(): Promise<ProjectionState> {
    const events = await this.eventsStore.listOrdered(this.scope, 1000);
    const canonicalEvents = events.map((event) => {
      const payload = event.payload as { prismId?: unknown };
      if (typeof payload.prismId !== "string") throw new Error("event_projection_prism_id_invalid");
      return {
        ...event,
        payload: { ...payload, prismId: canonicalizeEventPrismId(payload.prismId) } as RegistryCanonicalEvent["payload"],
      };
    });
    const projection = reconstruct(canonicalEvents);
    const checkpoint = await this.checkpointStore.get(this.scope);
    const watermark = maxNullable(projection.watermark, checkpoint?.scanWatermark ?? null);
    return watermark === projection.watermark ? projection : { ...projection, watermark };
  }
}

function maxEventBlock(events: readonly RegistryCanonicalEvent[]): number | null {
  if (!events.length) return null;
  return Math.max(...events.map((event) => event.blockNumber));
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}
