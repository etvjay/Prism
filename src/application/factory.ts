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

export interface AppFactory {
  handlers: ReturnType<typeof createPrismApiHandlers>;
  app: PrismApplicationService;
  registry: InMemoryRegistry;
  operationStore: OperationStore;
  ownershipStore: OwnershipProofStore;
  pauseService: InMemoryPauseService;
  pauseStore: PauseStore;
  receiptService: ReceiptService;
  challengeService: PrismChallengeService;
  prismEventsStore?: PostgresPrismEventsStore | null;
  isPostgres: boolean;
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
  let n = 1;
  const app = new PrismApplicationService({
    challengeService,
    operationStore,
    registry,
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
  return { handlers, app, registry, operationStore, ownershipStore, pauseService, pauseStore, receiptService, challengeService, prismEventsStore: null, isPostgres: false };
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

  const checker = new LocalErc1271SemanticsChecker();
  const challengeService = new PrismChallengeService({
    clock,
    crypto: viemChallengeCrypto,
    checker,
    store: ownershipStore,
    policy: { defaultTtlSeconds: 600, defaultDomain: process.env.PRISM_DOMAIN ?? "prism.example", defaultChainId: 84532 },
  });
  const registry = new InMemoryRegistry(); // Registry remains in-memory (starknet ledger) until ledger integration lands; operation/ownership/pause are durable
  let n = 1;
  const app = new PrismApplicationService({
    challengeService,
    operationStore,
    registry,
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

  return { handlers, app, registry, operationStore, ownershipStore, pauseService, pauseStore, receiptService, challengeService, prismEventsStore, isPostgres: true };
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
    ]);
  }
  singleton = null;
  singletonPromise = null;
  singletonError = null;
}

// Explicit async close for lifecycle management (e.g., tests, graceful shutdown)
export async function closeFactory(): Promise<void> {
  if (singleton) {
    const s = singleton;
    await Promise.allSettled([
      (s.ownershipStore as unknown as { close?: () => Promise<void> })?.close?.().catch(() => undefined),
      (s.operationStore as unknown as { close?: () => Promise<void> })?.close?.().catch(() => undefined),
      (s.pauseStore as unknown as { close?: () => Promise<void> })?.close?.().catch(() => undefined),
      s.prismEventsStore?.close().catch(() => undefined),
    ]);
  }
  singleton = null;
  singletonPromise = null;
  singletonError = null;
}
