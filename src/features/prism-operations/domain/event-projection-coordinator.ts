// Durable canonical-event projection coordinator.
// Ordering: fetch facts → persist canonical events → CAS checkpoint.
// A crash between persistence and checkpoint is safe: replay is deduplicated
// by (tx_hash,event_index). A checkpoint never advances past failed persistence.

import type { RegistryCanonicalEvent } from "./event-indexer";
import type { PrismEventsStore } from "../adapters/postgres-prism-events-store";
import type {
  EventProjectionCheckpoint,
  EventProjectionCheckpointInput,
  EventProjectionCheckpointStore,
} from "./event-projection-checkpoint";

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

export class EventProjectionCoordinator {
  private readonly registryAddress: string;
  private readonly network: string;
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
    this.registryAddress = options.registryAddress.toLowerCase();
    this.network = options.network;
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
    const checkpoint = await this.checkpointStore.get(this.registryAddress);
    if (checkpoint && (checkpoint.network !== this.network || checkpoint.registryAddress !== this.registryAddress)) {
      throw new Error("event_projection_checkpoint_identity_mismatch");
    }
    const fromBlock = checkpoint?.nextFromBlock ?? this.initialFromBlock;
    const fetched = await this.indexer.fetchAllRegistryEvents({ fromBlock, toBlock: "latest" });
    const eventWatermark = maxEventBlock(fetched.events);
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
    const persisted = await this.eventsStore.insertMany(fetched.events);
    const next: EventProjectionCheckpointInput = {
      registryAddress: this.registryAddress,
      network: this.network,
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
    const committedCheckpoint = await this.checkpointStore.get(this.registryAddress);
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
    return this.checkpointStore.get(this.registryAddress);
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
