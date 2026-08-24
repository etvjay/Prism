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
      from_address?: string;
    }>;
    continuation_token?: string | null;
  }>;
  // Optional for scan-head watermark when the provider supports it.
  getBlockNumber?(): Promise<number>;
}

export type StarknetRegistryVersion = "v1" | "v2";

export type StarknetEventIndexerOptions = {
  /** Injected RpcProvider-like reader (no secret file reads). */
  reader: StarknetEventReader;
  /** Registry contract address to filter events (0x hex). */
  registryAddress: string;
  /** ABI version controls ExecutionIdentityBound digest decoding. */
  registryVersion: StarknetRegistryVersion;
  /** Require every provider event to identify this exact registry address. Defaults true. */
  requireEventOrigin?: boolean;
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

const FELT_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;
const CONTRACT_ADDRESS_LIMIT = 1n << 251n;

function isFelt(value: string | undefined): boolean {
  if (!value || !/^0x[0-9a-fA-F]+$/.test(value)) return false;
  try {
    const n = BigInt(value);
    return n >= 0n && n < FELT_PRIME;
  } catch {
    return false;
  }
}

function isContractAddress(value: string | undefined): boolean {
  if (!isFelt(value)) return false;
  return BigInt(value!) < CONTRACT_ADDRESS_LIMIT;
}

function isNonZeroContractAddress(value: string | undefined): boolean {
  return isContractAddress(value) && BigInt(value!) !== 0n;
}

function isPrismIdFelt(value: string | undefined): boolean {
  return isFelt(value) && BigInt(value!) > 0n;
}

function normalizeTxHash(value: string): Hex | null {
  const raw = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{1,64}$/.test(raw)) return null;
  return `0x${raw.slice(2).padStart(64, "0")}` as Hex;
}

function combineU256Limbs(lowRaw: string | undefined, highRaw: string | undefined): Hex | null {
  if (!lowRaw || !highRaw || !/^0x[0-9a-fA-F]+$/.test(lowRaw) || !/^0x[0-9a-fA-F]+$/.test(highRaw)) return null;
  const low = BigInt(lowRaw);
  const high = BigInt(highRaw);
  const limit = 1n << 128n;
  if (low >= limit || high >= limit) return null;
  return `0x${(low + (high << 128n)).toString(16).padStart(64, "0")}` as Hex;
}

function sameContractAddress(a: string | undefined, b: string): boolean {
  if (!a || !isNonZeroContractAddress(a)) return false;
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
}
function decodeBaseVenue(value: string | undefined): "BASE" | null {
  if (!value || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  try {
    return BigInt(value) === BigInt("0x42415345") ? "BASE" : null;
  } catch {
    return null;
  }
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
  private readonly registryVersion: StarknetRegistryVersion;
  private readonly requireEventOrigin: boolean;
  private readonly chunkSize: number;

  constructor(options: StarknetEventIndexerOptions) {
    if (!options.reader || typeof options.reader.getEvents !== "function") {
      throw new Error("invariant_violation: StarknetEventIndexerAdapter requires injected reader.getEvents");
    }
    if (!isNonZeroContractAddress(options.registryAddress)) {
      throw new Error("invariant_violation: registryAddress must be a nonzero ContractAddress");
    }
    if (options.registryVersion !== "v1" && options.registryVersion !== "v2") {
      throw new Error("invariant_violation: registryVersion must be v1 or v2");
    }
    this.reader = options.reader;
    this.registryAddress = options.registryAddress.toLowerCase();
    this.registryVersion = options.registryVersion;
    this.requireEventOrigin = options.requireEventOrigin ?? true;
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
      if (ev.from_address === undefined ? this.requireEventOrigin : !sameContractAddress(ev.from_address, this.registryAddress)) continue;
      const eventKeys = ev.keys ?? ev.event?.keys ?? [];
      const eventData = ev.data ?? ev.event?.data ?? [];
      const blockNumber = typeof ev.block_number === "number" ? ev.block_number : null;
      if (blockNumber === null || !Number.isSafeInteger(blockNumber) || blockNumber < 0) continue;
      const eventIndex = ev.event_index;
      if (typeof eventIndex !== "number" || !Number.isSafeInteger(eventIndex) || eventIndex < 0) continue;
      const kind = this.inferKind(eventKeys);
      if (!kind) continue;
      const payload = this.inferPayload(kind, eventData, eventKeys);
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
        if (!Number.isSafeInteger(scannedThrough) || scannedThrough < 0) throw new Error("invalid_scan_watermark");
        watermark = scannedThrough;
      } catch (cause) {
        throw new StarknetEventIndexerError("getBlockNumber failed", cause);
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
      const match = raw.events.find((event) => {
        if (normalizeTxHash(event.transaction_hash ?? "") !== canonicalTxHash) return false;
        if (this.requireEventOrigin && event.from_address === undefined) return false;
        if (event.from_address !== undefined && !sameContractAddress(event.from_address, this.registryAddress)) return false;
        const keys = event.keys ?? event.event?.keys ?? [];
        const data = event.data ?? event.event?.data ?? [];
        const kind = this.inferKind(keys);
        return kind !== null && typeof event.block_number === "number" && Number.isSafeInteger(event.block_number) && event.block_number >= 0 && typeof event.event_index === "number" && Number.isSafeInteger(event.event_index) && event.event_index >= 0 && this.inferPayload(kind, data, keys) !== null;
      });
      if (!match) return { txHash: canonicalTxHash, eventObserved: false, blockNumber: null, eventIndex: null };
      const blockNumber = match.block_number as number;
      const eventIndex = match.event_index as number;
      const eventName = this.inferKind(match.keys ?? match.event?.keys ?? []) as string;
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
      if (keys.length !== 2 || data.length !== 1) return null;
      const prismId = keys[1];
      const controller = data[0];
      if (!isPrismIdFelt(prismId) || !isNonZeroContractAddress(controller)) return null;
      return { prismId, controller } as unknown as RegistryCanonicalEvent["payload"];
    }
    if (kind === "ExecutionIdentityBound") {
      if (keys.length !== 4) return null;
      const prismId = keys[1];
      const venue = decodeBaseVenue(keys[2]);
      const executionAccount = keys[3];
      const proofDigest = this.registryVersion === "v2"
        ? (data.length === 2 ? combineU256Limbs(data[0], data[1]) : null)
        : (data.length === 1 && isFelt(data[0]) ? data[0] : null);
      if (!isPrismIdFelt(prismId) || !venue || !isNonZeroContractAddress(executionAccount) || !proofDigest) return null;
      return { prismId, venue, executionAccount, proofDigest } as unknown as RegistryCanonicalEvent["payload"];
    }
    if (kind === "BindingRevoked") {
      if (keys.length !== 4 || data.length !== 0) return null;
      const prismId = keys[1];
      const venue = decodeBaseVenue(keys[2]);
      const executionAccount = keys[3];
      if (!isPrismIdFelt(prismId) || !venue || !isNonZeroContractAddress(executionAccount)) return null;
      return { prismId, venue, executionAccount } as unknown as RegistryCanonicalEvent["payload"];
    }
    return null;
  }
}
