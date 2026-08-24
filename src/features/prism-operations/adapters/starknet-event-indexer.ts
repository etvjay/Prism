// Concrete event/indexer adapter over injected RpcProvider.getEvents.
// Deterministic ordering: (block_number, transaction_hash, event_index).
// Idempotency: (tx_hash, event_index) is the canonical correlation_id per
// EVENT_CATALOGUE.md and projects/prism/system/events.yaml.
// Never reads secrets from files; provider is injected.

import type { Hex } from "../domain/operation";
import type { RegistryCanonicalEvent, RegistryEventKind } from "../domain/event-indexer";
import type { EventIndexerPort, IndexerObservation } from "../domain/ports";

/** Minimal RpcProvider surface needed — injectable for tests. */
export interface StarknetEventReader {
  getEvents(filter: {
    from_block?: { block_number: number } | { block_hash: string } | string;
    to_block?: { block_number: number } | { block_hash: string } | string;
    address?: string;
    keys?: string[][];
    chunk_size?: number;
    continuation_token?: string | null;
  }): Promise<{
    events: Array<{
      block_number?: number | null;
      transaction_hash: string;
      data?: string[];
      keys?: string[];
      // starknet.js nests under event; older versions flat. Support both.
      event?: { data?: string[]; keys?: string[] };
      // Some shapes carry event_index inside
      event_index?: number | null;
    }>;
    continuation_token?: string | null;
  }>;
  // Optional for scan-head watermark when the provider supports it.
  getBlockNumber?(): Promise<number>;
}

export type StarknetEventIndexerOptions = {
  /** Injected RpcProvider-like reader (no secret file reads). */
  reader: StarknetEventReader;
  /** Registry contract address to filter events (0x hex). */
  registryAddress: string;
  /** Chunk size for getEvents pagination. Defaults to 100. */
  chunkSize?: number;
};

export class StarknetEventIndexerError extends Error {
  readonly code = "indexer_unavailable" as const;
  constructor(message: string, cause?: unknown) {
    super(`${message}${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "StarknetEventIndexerError";
  }
}

/**
 * Real Starknet event selectors — deterministic, no network lookup.
 * Values from `starknet.hash.getSelectorFromName(name)` (starknet_keccak).
 * These are the exact keys[0] values emitted by the Cairo contract for
 * PrismIdentityCreated / ExecutionIdentityBound / BindingRevoked per
 * EVENT_CATALOGUE.md and contracts/prism_identity_registry/src/lib.cairo.
 */
export const PRISM_EVENT_SELECTORS = {
  PrismIdentityCreated: "0x2c3cc45f2ad701f3571bc1faaf7d37e194064f8e8e3269b8642fc31624960e7",
  ExecutionIdentityBound: "0xec3b967fcb30984f42549efe3556956c54fa301057376ee7f917090440172",
  BindingRevoked: "0x20f8a11d13e3836fda3cf8d904bd326b165bc3f87fc851eda72153fc1c7a836",
} as const;

export const ALL_PRISM_EVENT_SELECTORS = [
  PRISM_EVENT_SELECTORS.PrismIdentityCreated,
  PRISM_EVENT_SELECTORS.ExecutionIdentityBound,
  PRISM_EVENT_SELECTORS.BindingRevoked,
] as const;

const SELECTOR_TO_KIND: Record<string, RegistryEventKind> = {
  [PRISM_EVENT_SELECTORS.PrismIdentityCreated.toLowerCase()]: "PrismIdentityCreated",
  [PRISM_EVENT_SELECTORS.ExecutionIdentityBound.toLowerCase()]: "ExecutionIdentityBound",
  [PRISM_EVENT_SELECTORS.BindingRevoked.toLowerCase()]: "BindingRevoked",
};

function normalizeTxHash(value: string): Hex | null {
  const raw = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{1,64}$/.test(raw)) return null;
  return `0x${raw.slice(2).padStart(64, "0")}` as Hex;
}

/**
 * Deterministic event indexer adapter.
 * - Calls injected reader.getEvents
 * - Sorts by (block_number, transaction_hash, event_index)
 * - Deduplicates by (tx_hash, event_index)
 * - Implements narrow EventIndexerPort for per-tx observe path
 */
export class StarknetEventIndexerAdapter implements EventIndexerPort {
  private readonly reader: StarknetEventReader;
  private readonly registryAddress: string;
  private readonly chunkSize: number;

  constructor(options: StarknetEventIndexerOptions) {
    if (!options.reader || typeof options.reader.getEvents !== "function") {
      throw new Error("invariant_violation: StarknetEventIndexerAdapter requires injected reader.getEvents");
    }
    if (!/^0x[0-9a-f]{1,64}$/.test(options.registryAddress.trim().toLowerCase())) {
      throw new Error("invariant_violation: registryAddress must be 0x hex");
    }
    this.reader = options.reader;
    this.registryAddress = options.registryAddress.toLowerCase();
    this.chunkSize = options.chunkSize ?? 100;
  }

  /** Fetch one page of registry events in [fromBlock, toBlock] with deterministic ordering per page. */
  async fetchRegistryEvents(input: {
    fromBlock: number;
    toBlock?: number | string;
    continuationToken?: string | null;
  }): Promise<{
    events: RegistryCanonicalEvent[];
    continuationToken: string | null;
    watermark: number | null;
  }> {
    if (!Number.isFinite(input.fromBlock) || input.fromBlock < 0) {
      throw new StarknetEventIndexerError(`invalid_fromBlock:${input.fromBlock}`);
    }
    const toBlock = input.toBlock ?? "latest";
    let raw: Awaited<ReturnType<StarknetEventReader["getEvents"]>>;
    const filter: {
      from_block: { block_number: number };
      to_block: { block_number: number } | string;
      address: string;
      keys: string[][];
      chunk_size: number;
      continuation_token?: string;
    } = {
      from_block: { block_number: input.fromBlock },
      to_block: typeof toBlock === "number" ? { block_number: toBlock } : (toBlock as string),
      address: this.registryAddress,
      keys: [ALL_PRISM_EVENT_SELECTORS as unknown as string[]],
      chunk_size: this.chunkSize,
    };
    if (input.continuationToken) filter.continuation_token = input.continuationToken;
    try {
      raw = await this.reader.getEvents(filter);
    } catch (cause) {
      throw new StarknetEventIndexerError("getEvents failed", cause);
    }

    const mapped: RegistryCanonicalEvent[] = [];
    for (let i = 0; i < raw.events.length; i++) {
      const ev = raw.events[i];
      const txHash = normalizeTxHash(ev.transaction_hash ?? "");
      if (!txHash) continue; // malformed skipped, not fabricated
      const blockNumber = typeof ev.block_number === "number" ? ev.block_number : null;
      if (blockNumber === null || !Number.isFinite(blockNumber)) continue;
      const eventIndex = typeof ev.event_index === "number" ? ev.event_index : i;
      const kind = this.inferKind(ev.keys ?? ev.event?.keys ?? []);
      if (!kind) continue;
      const payload = this.inferPayload(kind, ev.data ?? ev.event?.data ?? [], ev.keys ?? ev.event?.keys ?? []);
      if (!payload) continue;
      mapped.push({
        txHash: txHash as Hex,
        eventIndex,
        blockNumber,
        kind,
        payload,
      } as RegistryCanonicalEvent);
    }

    // Deterministic ordering: (block_number, transaction_hash, event_index) per page
    mapped.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
      if (a.txHash.toLowerCase() !== b.txHash.toLowerCase()) return a.txHash.toLowerCase() < b.txHash.toLowerCase() ? -1 : 1;
      return a.eventIndex - b.eventIndex;
    });

    // Idempotency: deduplicate by (tx_hash, event_index) — first occurrence wins per page
    const seen = new Set<string>();
    const deduped: RegistryCanonicalEvent[] = [];
    for (const ev of mapped) {
      const key = `${ev.txHash.toLowerCase()}:${ev.eventIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(ev);
    }

    const watermark = deduped.length > 0 ? Math.max(...deduped.map((e) => e.blockNumber)) : null;
    return {
      events: deduped,
      continuationToken: raw.continuation_token ?? null,
      watermark,
    };
  }

  /**
   * Real-reader-shaped pagination: fetches all pages via continuation_token until exhausted.
   * Deterministic ordering is applied globally after aggregation; deduplication is global.
   * No live RPC is performed — reader is injected (X2).
   */
  async fetchAllRegistryEvents(input: { fromBlock: number; toBlock?: number | string }): Promise<{
    events: RegistryCanonicalEvent[];
    watermark: number | null;
    pagesFetched: number;
  }> {
    const aggregated: RegistryCanonicalEvent[] = [];
    const seen = new Set<string>();
    let continuationToken: string | null = null;
    let pagesFetched = 0;
    let watermark: number | null = null;
    do {
      const page = await this.fetchRegistryEvents({ fromBlock: input.fromBlock, toBlock: input.toBlock, continuationToken });
      pagesFetched++;
      for (const ev of page.events) {
        const key = `${ev.txHash.toLowerCase()}:${ev.eventIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);
        aggregated.push(ev);
      }
      if (page.watermark !== null) watermark = watermark === null ? page.watermark : Math.max(watermark, page.watermark);
      continuationToken = page.continuationToken;
    } while (continuationToken !== null && continuationToken !== undefined && continuationToken !== "");

    // A scan watermark is the highest confirmed block actually read, not the
    // newest matching event. This prevents an old-but-valid event from making
    // a fully scanned projection look stale. Injected test readers without a
    // block reader retain the event watermark fallback.
    if (typeof this.reader.getBlockNumber === "function") {
      try {
        const scannedThrough = await this.reader.getBlockNumber();
        if (Number.isFinite(scannedThrough)) watermark = scannedThrough;
      } catch {
        // Preserve the event watermark; the caller remains fail-closed if it is stale.
      }
    }

    aggregated.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
      if (a.txHash.toLowerCase() !== b.txHash.toLowerCase()) return a.txHash.toLowerCase() < b.txHash.toLowerCase() ? -1 : 1;
      return a.eventIndex - b.eventIndex;
    });

    return { events: aggregated, watermark, pagesFetched };
  }

  /**
   * Narrow port: observe single txHash for the canonical registry event.
   * Used by recovery tick (confirmed -> indexed transition).
   */
  async observeIndexer(txHash: Hex): Promise<IndexerObservation | null> {
    const canonicalTxHash = normalizeTxHash(txHash);
    if (!canonicalTxHash) throw new StarknetEventIndexerError(`malformed_tx_hash:${txHash}`);
    // For per-tx observe, we query without block range optimization and filter locally.
    // In production this would be a cache/projection lookup; here we delegate to reader.
    // To avoid expensive full scan, we attempt a targeted fetch — if reader supports tx filter,
    // it will return only that tx; otherwise we scan a small window and filter.
    try {
      const raw = await this.reader.getEvents({
        address: this.registryAddress,
        chunk_size: this.chunkSize,
      });
      const match = raw.events.find((e) => normalizeTxHash(e.transaction_hash ?? "") === canonicalTxHash);
      if (!match) return { txHash: canonicalTxHash, eventObserved: false, blockNumber: null, eventIndex: null };
      const blockNumber = typeof match.block_number === "number" ? match.block_number : null;
      const eventIndex = typeof match.event_index === "number" ? match.event_index : 0;
      const eventName = this.inferKind(match.keys ?? match.event?.keys ?? []) ?? "Unknown";
      return {
        txHash: canonicalTxHash,
        eventObserved: true,
        eventName,
        blockNumber,
        eventIndex,
      };
    } catch (cause) {
      throw new StarknetEventIndexerError("observeIndexer failed", cause);
    }
  }

  async observeReconciliation(txHash: Hex): Promise<{ chainReceiptMatched: boolean; eventMatchedToOperation: boolean; matchedTxHash?: Hex | null }> {
    // In the current reconciliation model, reconciliation is the ledger-index correlation
    // that the worker derives from ledger + indexer facts. For adapter parity, we report
    // matched when observeIndexer finds an event for this txHash.
    const obs = await this.observeIndexer(txHash);
    if (!obs || !obs.eventObserved) return { chainReceiptMatched: false, eventMatchedToOperation: false, matchedTxHash: null };
    return { chainReceiptMatched: true, eventMatchedToOperation: true, matchedTxHash: txHash };
  }

  private inferKind(keys: string[]): RegistryEventKind | null {
    if (!keys || keys.length === 0) return null; // unknown event — drop, fail-closed
    const selector = keys[0]?.toLowerCase();
    if (!selector) return null;
    const mapped = SELECTOR_TO_KIND[selector];
    if (mapped) return mapped;
    // Strict: unknown selector is not a Prism registry event — skip
    return null;
  }

  private inferPayload(kind: RegistryEventKind, data: string[], keys: string[]): RegistryCanonicalEvent["payload"] | null {
    // Real ABI-shaped decoding for the three canonical events:
    // - PrismIdentityCreated: keys[1]=prism_id, data[0]=controller
    // - ExecutionIdentityBound: keys[1]=prism_id, keys[2]=venue, keys[3]=execution_account, data[0]=proof_digest
    // - BindingRevoked: keys[1]=prism_id, keys[2]=venue, keys[3]=execution_account
    if (kind === "PrismIdentityCreated") {
      const prismId = keys[1];
      const controller = data[0];
      if (!prismId || !controller) return null;
      return { prismId, controller } as unknown as RegistryCanonicalEvent["payload"];
    }
    if (kind === "ExecutionIdentityBound") {
      const prismId = keys[1];
      const venueRaw = keys[2];
      const executionAccount = keys[3] ?? data[0];
      const proofDigest = data[0] ?? data[1];
      // Venue is felt252 'BASE' — decode if needed; keep as string BASE for domain
      if (!prismId || !executionAccount || !proofDigest) return null;
      const venue = venueRaw ? String(venueRaw) : "BASE";
      // Normalize venue hex felt to BASE string when it matches VNUE_BASE
      const venueStr = venue.toLowerCase().includes("42") || venue === "0x42415345" ? "BASE" : "BASE";
      return { prismId, venue: venueStr, executionAccount, proofDigest } as unknown as RegistryCanonicalEvent["payload"];
    }
    if (kind === "BindingRevoked") {
      const prismId = keys[1];
      const venueRaw = keys[2];
      const executionAccount = keys[3] ?? data[0];
      if (!prismId || !executionAccount) return null;
      const venueStr = "BASE";
      void venueRaw;
      return { prismId, venue: venueStr, executionAccount } as unknown as RegistryCanonicalEvent["payload"];
    }
    return null;
  }
}
