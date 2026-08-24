// Singleton factory for route handlers — environment-aware but injectable for tests.
// No live broadcast: ports are fakes unless env wiring is explicitly enabled.
// Postgres wiring is environment-gated via PRISM_POSTGRES_TEST_URL (or PRISM_POSTGRES_URL).
// - If URL present and valid → Postgres adapters (challenge/operation/pause/event) with migrate fail-closed.
// - If URL absent/invalid and NODE_ENV=production or PRISM_REQUIRE_POSTGRES=1 → fail-closed 503, never silent memory fallback.
// - Otherwise (dev/test without URL) → in-memory adapters for isolated tests only.

import { fixedClock } from "../features/prism-identity/adapters/clock";
import { InMemoryOwnershipProofStore } from "../features/prism-identity/adapters/memory-ownership-proof-store";
import { PostgresOwnershipProofStore } from "../features/prism-identity/adapters/postgres-ownership-proof-store";
import { viemChallengeCrypto } from "../features/prism-identity/adapters/viem-crypto";
import { LocalErc1271SemanticsChecker } from "../features/prism-identity/testing/fixtures";
import { PrismChallengeService } from "../features/prism-identity/application/challenge-service";
import { InMemoryOperationStore } from "../features/prism-operations/adapters/memory-operation-store";
import { PostgresOperationStore } from "../features/prism-operations/adapters/postgres-operation-store";
import { PostgresPrismEventsStore } from "../features/prism-operations/adapters/postgres-prism-events-store";
import type { OwnershipProofStore } from "../features/prism-identity/domain/ports";
import type { OperationStore } from "../features/prism-operations/domain/operation-store";
import type { PauseStore } from "../features/prism-pause/ports/pause-store";
import { InMemoryPauseStore } from "../features/prism-pause/adapters/memory-pause-store";
import { PostgresPauseStore } from "../features/prism-pause/adapters/postgres-pause-store";
import { InMemoryRegistry } from "./adapters/in-memory-registry";
import { PrismApplicationService } from "./prism-application";
import { createPrismApiHandlers } from "./handlers";
import { InMemoryPauseService } from "./pause-port";
import { InMemoryPauseMetrics } from "../features/prism-pause/ports/metrics";
import { createFakeAdapterRegistry } from "../features/prism-pause/adapters/fake-execution-adapters";
import { ReceiptService } from "./receipt-service";
import { AppError, APP_ERROR_CODE } from "./errors";
import { StarknetRegistryReader, getStarknetRpcUrl, getStarknetRegistryAddress, isStarknetReadConfigured, isStarknetRpcUrlValid } from "./adapters/starknet-registry-reader";
import { StarknetLedgerStatusAdapter } from "../features/prism-operations/adapters/starknet-ledger-status";
import { StarknetEventIndexerAdapter } from "../features/prism-operations/adapters/starknet-event-indexer";
import { WatermarkedResolveService } from "../features/prism-operations/domain/resolve-service";
import { ReconciliationWorker } from "../features/prism-operations/domain/reconciliation-worker";
import type { RegistryReadPort, StarknetSubmitPort } from "./ports";
import type { LedgerStatusPort, EventIndexerPort } from "../features/prism-operations/domain/ports";

export interface AppFactory {
  handlers: ReturnType<typeof createPrismApiHandlers>;
  app: PrismApplicationService;
  registry: InMemoryRegistry;
  /** Canonical read port — may be real Starknet reader when env configured, else in-memory fallback (dev/test). */
  registryReadPort: RegistryReadPort;
  /** Submit port — currently in-memory until real Account wiring lands (no private keys in this lane). */
  submitPort: StarknetSubmitPort;
  operationStore: OperationStore;
  ownershipStore: OwnershipProofStore;
  pauseService: InMemoryPauseService;
  pauseStore: PauseStore;
  receiptService: ReceiptService;
  challengeService: PrismChallengeService;
  prismEventsStore?: PostgresPrismEventsStore | null;
  /** Real read-only Starknet ports when STARKNET_RPC_URL+REGISTRY_ADDRESS present; null in dev/test fallback. */
  ledgerStatusAdapter?: (LedgerStatusPort & { getConfirmedBlock(): Promise<number | null> }) | null;
  eventIndexerAdapter?: EventIndexerPort | null;
  /** Watermarked resolve with K=5 stale refusal, wired to ledger confirmed block when available. */
  resolveService: WatermarkedResolveService;
  /** Reconciliation worker bound to durable store + ledger/indexer fakes (X2) or real adapters when configured. */
  reconciliationWorker: ReconciliationWorker;
  isPostgres: boolean;
  isStarknetConfigured: boolean;
  /** Graceful shutdown: stop worker, close stores/events. */
  shutdown(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Environment gating
// ---------------------------------------------------------------------------

export function getPostgresUrl(): string | null {
  const raw = (process.env.PRISM_POSTGRES_TEST_URL ?? process.env.PRISM_POSTGRES_URL ?? "").trim();
  if (!raw) return null;
  return raw;
}

export function isPostgresUrlValid(url: string): boolean {
  return /^postgres(ql)?:\/\//i.test(url);
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" || process.env.PRISM_REQUIRE_POSTGRES === "1" || process.env.PRISM_RUNTIME_MODE === "production";
}

export function shouldUsePostgres(): boolean {
  const url = getPostgresUrl();
  return url !== null && isPostgresUrlValid(url);
}

// Synchronous validation for fast fail-closed on malformed URL (never log secret)
function assertPostgresUrlOrThrow(url: string | null): string | null {
  if (url === null) return null;
  if (!isPostgresUrlValid(url)) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "invalid_postgres_url_format");
  }
  return url;
}

// Starknet env helpers re-exported for tests
export { getStarknetRpcUrl, getStarknetRegistryAddress, isStarknetReadConfigured, isStarknetRpcUrlValid };

function assertStarknetEnvOrThrow(): { rpcUrl: string; registryAddress: string } | null {
  const rpcUrl = getStarknetRpcUrl();
  const registryAddress = getStarknetRegistryAddress();
  if (rpcUrl === null && registryAddress === null) return null;
  if (rpcUrl === null || registryAddress === null) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "starknet_read_config_incomplete");
  }
  if (!isStarknetRpcUrlValid(rpcUrl)) throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "invalid_starknet_rpc_url");
  if (!/^0x[0-9a-f]{1,64}$/i.test(registryAddress.trim())) throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "invalid_starknet_registry_address");
  return { rpcUrl, registryAddress };
}

function createStarknetReadPorts(): { reader: StarknetRegistryReader; ledger: StarknetLedgerStatusAdapter; indexer: StarknetEventIndexerAdapter } | null {
  const cfg = assertStarknetEnvOrThrow();
  if (!cfg) return null;
  const reader = new StarknetRegistryReader({ rpcUrl: cfg.rpcUrl, registryAddress: cfg.registryAddress });
  const ledger = new StarknetLedgerStatusAdapter({ rpcUrl: cfg.rpcUrl });
  // Event indexer needs a reader: provide a minimal shim that delegates to ledger's provider getEvents if available.
  // If ledger has no getEvents, indexer will fail-closed on fetch; for read-only lane we create adapter with a throw-on-call reader so fetch is fail-closed yet wiring is visible.
  const indexerReader = {
    async getEvents() {
      throw new Error("indexer_getEvents_requires_explicit_reader_injection");
    },
  } as unknown as import("../features/prism-operations/adapters/starknet-event-indexer").StarknetEventReader;
  let indexer: StarknetEventIndexerAdapter;
  try {
    indexer = new StarknetEventIndexerAdapter({ reader: indexerReader, registryAddress: cfg.registryAddress, chunkSize: 100 });
  } catch {
    // If chunkSize/registry validation fails, fail-closed
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "starknet_indexer_init_failed");
  }
  return { reader, ledger, indexer };
}

// ---------------------------------------------------------------------------
// Factory creators
// ---------------------------------------------------------------------------

function createMemoryFactory(clock = fixedClock(Math.floor(Date.now() / 1000))): AppFactory {
  const ownershipStore = new InMemoryOwnershipProofStore();
  const checker = new LocalErc1271SemanticsChecker();
  const challengeService = new PrismChallengeService({
    clock,
    crypto: viemChallengeCrypto,
    checker,
    store: ownershipStore,
    policy: { defaultTtlSeconds: 600, defaultDomain: process.env.PRISM_DOMAIN ?? "prism.example", defaultChainId: 84532 },
  });
  const operationStore = new InMemoryOperationStore();
  const registry = new InMemoryRegistry();
  // Attempt Starknet read wiring — fail-closed on invalid env, else fallback to memory for dev/test
  let starknetPorts: { reader: StarknetRegistryReader; ledger: StarknetLedgerStatusAdapter; indexer: StarknetEventIndexerAdapter } | null = null;
  let starknetError: Error | null = null;
  try {
    starknetPorts = createStarknetReadPorts();
  } catch (e) {
    starknetError = e as Error;
  }
  if (starknetError) throw starknetError;
  const registryReadPort: RegistryReadPort = starknetPorts ? starknetPorts.reader : registry;
  const ledgerStatusAdapter = starknetPorts ? starknetPorts.ledger : null;
  const eventIndexerAdapter = starknetPorts ? starknetPorts.indexer : null;
  const isStarknetConfigured = starknetPorts !== null;
  let n = 1;
  const app = new PrismApplicationService({
    challengeService,
    operationStore,
    registry: registryReadPort,
    submitPort: registry,
    clock,
    idGenerator: { generateOperationId: () => `op-${n++}-${Date.now()}` },
  });
  const handlers = createPrismApiHandlers(app);
  const pauseStore = new InMemoryPauseStore();
  const pauseMetrics = new InMemoryPauseMetrics();
  const pauseAdapters = createFakeAdapterRegistry(operationStore);
  const pauseService = new InMemoryPauseService(clock, {
    store: pauseStore,
    operationStore,
    metrics: pauseMetrics,
    adapterRegistry: pauseAdapters,
  });
  const receiptService = new ReceiptService(operationStore);
  // Watermark K=5 stale refusal — wired to ledger confirmed block when configured, otherwise fixed fake for tests
  const resolveService = new WatermarkedResolveService(registryReadPort, {
    staleBoundK: 5,
    confirmedBlockPort: ledgerStatusAdapter ?? undefined,
  });
  // Reconciliation worker — transport-neutral fakes when starknet not configured; real adapters when configured.
  // X2 guard: daemon must not start in tests; caller must use tickAllOnce. Worker is still constructed for startupRecovery demo.
  const fallbackLedger: LedgerStatusPort = ledgerStatusAdapter ?? {
    async observeChain() {
      return null;
    },
  };
  const fallbackIndexer: EventIndexerPort = eventIndexerAdapter ?? {
    async observeIndexer(txHash) {
      return { txHash, eventObserved: false, blockNumber: null, eventIndex: null };
    },
    async observeReconciliation(txHash) {
      return { chainReceiptMatched: false, eventMatchedToOperation: false, matchedTxHash: null };
    },
  };
  const reconciliationWorker = new ReconciliationWorker({
    store: operationStore,
    ledger: fallbackLedger,
    indexer: fallbackIndexer,
    clock,
    config: { staleWatermarkK: 5, sweepLimit: 100 },
  });
  const shutdown = async () => {
    reconciliationWorker.stop();
    await Promise.allSettled([
      (ownershipStore as unknown as { close?: () => Promise<void> })?.close?.().catch(() => undefined),
      (operationStore as unknown as { close?: () => Promise<void> })?.close?.().catch(() => undefined),
      (pauseStore as unknown as { close?: () => Promise<void> })?.close?.().catch(() => undefined),
    ]);
  };
  return {
    handlers,
    app,
    registry,
    registryReadPort,
    submitPort: registry,
    operationStore,
    ownershipStore,
    pauseService,
    pauseStore,
    receiptService,
    challengeService,
    prismEventsStore: null,
    ledgerStatusAdapter,
    eventIndexerAdapter,
    resolveService,
    reconciliationWorker,
    isPostgres: false,
    isStarknetConfigured,
    shutdown,
  };
}

async function createPostgresFactory(url: string, clock = fixedClock(Math.floor(Date.now() / 1000))): Promise<AppFactory> {
  // Validate format synchronously before attempting network
  assertPostgresUrlOrThrow(url);

  // Create PG-backed stores. Each does migrate() fail-closed.
  const ownershipStore = new PostgresOwnershipProofStore({ connectionString: url });
  const operationStore = new PostgresOperationStore({ connectionString: url });
  const pauseStore = new PostgresPauseStore({ connectionString: url });
  const prismEventsStore = new PostgresPrismEventsStore({ connectionString: url });

  try {
    await ownershipStore.migrate();
    await operationStore.migrate();
    await pauseStore.migrate();
    await prismEventsStore.migrate();
  } catch (cause) {
    // Close any pools that were opened before rethrowing fail-closed
    await Promise.allSettled([ownershipStore.close().catch(() => undefined), operationStore.close().catch(() => undefined), pauseStore.close?.().catch(() => undefined), prismEventsStore.close().catch(() => undefined)]);
    if (cause instanceof AppError) throw cause;
    // Wrap driver error as stable 503 without leaking URL
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, `postgres_connect_or_migrate_failed:${(cause as Error)?.message?.slice(0, 80) ?? "unknown"}`);
  }

  // Starknet read wiring — fail-closed on invalid config, otherwise real adapters
  let starknetPorts: { reader: StarknetRegistryReader; ledger: StarknetLedgerStatusAdapter; indexer: StarknetEventIndexerAdapter } | null = null;
  let starknetError: Error | null = null;
  try {
    starknetPorts = createStarknetReadPorts();
  } catch (e) {
    starknetError = e as Error;
  }
  if (starknetError) {
    await Promise.allSettled([ownershipStore.close().catch(() => undefined), operationStore.close().catch(() => undefined), pauseStore.close?.().catch(() => undefined), prismEventsStore.close().catch(() => undefined)]);
    throw starknetError;
  }
  const registry = new InMemoryRegistry(); // Fallback registry for test helpers; real read path uses registryReadPort
  const registryReadPort: RegistryReadPort = starknetPorts ? starknetPorts.reader : registry;
  const ledgerStatusAdapter = starknetPorts ? starknetPorts.ledger : null;
  const eventIndexerAdapter = starknetPorts ? starknetPorts.indexer : null;
  const isStarknetConfigured = starknetPorts !== null;

  const checker = new LocalErc1271SemanticsChecker();
  const challengeService = new PrismChallengeService({
    clock,
    crypto: viemChallengeCrypto,
    checker,
    store: ownershipStore,
    policy: { defaultTtlSeconds: 600, defaultDomain: process.env.PRISM_DOMAIN ?? "prism.example", defaultChainId: 84532 },
  });
  let n = 1;
  const app = new PrismApplicationService({
    challengeService,
    operationStore,
    registry: registryReadPort,
    submitPort: registry,
    clock,
    idGenerator: { generateOperationId: () => `op-${n++}-${Date.now()}` },
  });
  const handlers = createPrismApiHandlers(app);
  const pauseMetrics = new InMemoryPauseMetrics();
  const pauseAdapters = createFakeAdapterRegistry(operationStore);
  const pauseService = new InMemoryPauseService(clock, {
    store: pauseStore,
    operationStore,
    metrics: pauseMetrics,
    adapterRegistry: pauseAdapters,
  });
  const receiptService = new ReceiptService(operationStore);
  const resolveService = new WatermarkedResolveService(registryReadPort, {
    staleBoundK: 5,
    confirmedBlockPort: ledgerStatusAdapter ?? undefined,
  });
  const fallbackLedger: LedgerStatusPort = ledgerStatusAdapter ?? {
    async observeChain() {
      return null;
    },
  };
  const fallbackIndexer: EventIndexerPort = eventIndexerAdapter ?? {
    async observeIndexer(txHash) {
      return { txHash, eventObserved: false, blockNumber: null, eventIndex: null };
    },
    async observeReconciliation(txHash) {
      return { chainReceiptMatched: false, eventMatchedToOperation: false, matchedTxHash: null };
    },
  };
  const reconciliationWorker = new ReconciliationWorker({
    store: operationStore,
    ledger: fallbackLedger,
    indexer: fallbackIndexer,
    clock,
    config: { staleWatermarkK: 5, sweepLimit: 100 },
  });
  const shutdown = async () => {
    reconciliationWorker.stop();
    await Promise.allSettled([
      ownershipStore.close().catch(() => undefined),
      operationStore.close().catch(() => undefined),
      pauseStore.close?.().catch(() => undefined),
      prismEventsStore.close().catch(() => undefined),
    ]);
  };
  return {
    handlers,
    app,
    registry,
    registryReadPort,
    submitPort: registry,
    operationStore,
    ownershipStore,
    pauseService,
    pauseStore,
    receiptService,
    challengeService,
    prismEventsStore,
    ledgerStatusAdapter,
    eventIndexerAdapter,
    resolveService,
    reconciliationWorker,
    isPostgres: true,
    isStarknetConfigured,
    shutdown,
  };
}

// ---------------------------------------------------------------------------
// Singleton state (async)
// ---------------------------------------------------------------------------

let singleton: AppFactory | null = null;
let singletonPromise: Promise<AppFactory> | null = null;
let singletonError: Error | null = null;

async function createSingletonFactory(): Promise<AppFactory> {
  const url = getPostgresUrl();
  const prod = isProductionRuntime();

  if (url !== null) {
    // URL present: must be valid format and reachable, otherwise fail-closed
    if (!isPostgresUrlValid(url)) {
      throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "invalid_postgres_url_format");
    }
    try {
      return await createPostgresFactory(url);
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, `postgres_init_failed:${(e as Error).message?.slice(0, 80) ?? "unknown"}`);
    }
  }

  if (prod) {
    // Production without Postgres is fail-closed: never silently fall back to memory
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "postgres_url_missing_in_production");
  }

  // Dev/test without Postgres: in-memory isolated
  return createMemoryFactory();
}

export async function getAppFactory(): Promise<AppFactory> {
  if (singleton) return singleton;
  if (singletonError) throw singletonError;
  if (singletonPromise) return singletonPromise;
  singletonPromise = createSingletonFactory()
    .then((f) => {
      singleton = f;
      singletonPromise = null;
      return f;
    })
    .catch((e) => {
      singletonError = e as Error;
      singletonPromise = null;
      throw e;
    });
  return singletonPromise;
}

// Synchronous accessor for legacy call sites that have already ensured memory mode.
// Throws fail-closed if singleton not yet initialized and production gating requires postgres.
export function getAppFactorySync(): AppFactory {
  if (singleton) return singleton;
  const url = getPostgresUrl();
  const prod = isProductionRuntime();
  if (url !== null && !isPostgresUrlValid(url)) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "invalid_postgres_url_format");
  }
  if (url !== null) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "postgres_factory_requires_async_init");
  }
  if (prod) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "postgres_url_missing_in_production");
  }
  // Lazy memory singleton for sync path (dev only)
  singleton = createMemoryFactory();
  return singleton;
}

// Backward-compatible alias: handlers that have not yet migrated to async can call this
// but we prefer they migrate to `await getAppFactory()`.
export function getAppFactoryLegacy(): AppFactory {
  // If postgres URL is present we must fail closed rather than silently return memory
  const url = getPostgresUrl();
  if (url !== null) {
    if (!isPostgresUrlValid(url)) throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "invalid_postgres_url_format");
    // postgres requires async init; signal caller to use async path
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "postgres_factory_requires_async_init");
  }
  if (isProductionRuntime()) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "postgres_url_missing_in_production");
  }
  return getAppFactorySync();
}

// For tests: create isolated factory with deterministic clock (always memory, never postgres)
export function createIsolatedFactory(start = 1_789_000_000): AppFactory {
  const clock = fixedClock(start);
  return createMemoryFactory(clock);
}

export function resetFactory() {
  // Close postgres pools if they were opened
  if (singleton) {
    const s = singleton;
    // best-effort close without awaiting (reset is sync; callers can await close explicitly if needed)
    void Promise.allSettled([
      (s.ownershipStore as unknown as { close?: () => Promise<void> })?.close?.().catch(() => undefined),
      (s.operationStore as unknown as { close?: () => Promise<void> })?.close?.().catch(() => undefined),
      (s.pauseStore as unknown as { close?: () => Promise<void> })?.close?.().catch(() => undefined),
      s.prismEventsStore?.close().catch(() => undefined),
      s.reconciliationWorker?.stop(),
    ]);
    // also shutdown worker
    try {
      s.reconciliationWorker?.stop();
    } catch {}
  }
  singleton = null;
  singletonPromise = null;
  singletonError = null;
}

// Explicit async close for lifecycle management (e.g., tests, graceful shutdown)
export async function closeFactory(): Promise<void> {
  if (singleton) {
    const s = singleton;
    try {
      s.reconciliationWorker?.stop();
    } catch {}
    await Promise.allSettled([
      (s.ownershipStore as unknown as { close?: () => Promise<void> })?.close?.().catch(() => undefined),
      (s.operationStore as unknown as { close?: () => Promise<void> })?.close?.().catch(() => undefined),
      (s.pauseStore as unknown as { close?: () => Promise<void> })?.close?.().catch(() => undefined),
      s.prismEventsStore?.close().catch(() => undefined),
      s.shutdown?.().catch(() => undefined),
    ]);
  }
  singleton = null;
  singletonPromise = null;
  singletonError = null;
}
