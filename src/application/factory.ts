// Singleton factory for route handlers — environment-aware but injectable for tests.
// No live settlement adapter is wired by default. Test doubles are accepted
// only through explicit test-only factory overrides.
// Postgres wiring is environment-gated via PRISM_POSTGRES_TEST_URL (or PRISM_POSTGRES_URL).
// - If URL present and valid → Postgres adapters (challenge/operation/pause/event) with migrate fail-closed.
// - If URL absent/invalid and NODE_ENV=production or PRISM_REQUIRE_POSTGRES=1 → fail-closed 503, never silent memory fallback.
// - Otherwise (dev/test without URL) → in-memory adapters for isolated tests only.

import { fixedClock } from "../features/prism-identity/adapters/clock";
import { normalizeStarknetContractAddress } from "../features/prism-identity/domain/starknet-boundary";
import { InMemoryOwnershipProofStore } from "../features/prism-identity/adapters/memory-ownership-proof-store";
import { PostgresOwnershipProofStore } from "../features/prism-identity/adapters/postgres-ownership-proof-store";
import { viemChallengeCrypto } from "../features/prism-identity/adapters/viem-crypto";
import { LocalErc1271SemanticsChecker } from "../features/prism-identity/testing/fixtures";
import { PrismChallengeService } from "../features/prism-identity/application/challenge-service";
import { InMemoryOperationStore } from "../features/prism-operations/adapters/memory-operation-store";
import { PostgresOperationStore } from "../features/prism-operations/adapters/postgres-operation-store";
import { PostgresPrismEventsStore } from "../features/prism-operations/adapters/postgres-prism-events-store";
import { PostgresEventProjectionCheckpointStore } from "../features/prism-operations/domain/event-projection-checkpoint";
import type { EventProjectionCheckpointStore } from "../features/prism-operations/domain/event-projection-checkpoint";
import { EventProjectionCoordinator } from "../features/prism-operations/domain/event-projection-coordinator";
import type { OwnershipProofStore } from "../features/prism-identity/domain/ports";
import type { OperationStore } from "../features/prism-operations/domain/operation-store";
import type { PauseStore } from "../features/prism-pause/ports/pause-store";
import { InMemoryPauseStore } from "../features/prism-pause/adapters/memory-pause-store";
import { PostgresPauseStore } from "../features/prism-pause/adapters/postgres-pause-store";
import type { PauseExecutionAdapter, SettlementChain } from "../features/prism-pause/ports/execution-adapter";
import { InMemoryRegistry } from "./adapters/in-memory-registry";
import { PrismApplicationService } from "./prism-application";
import { createPrismApiHandlers } from "./handlers";
import { InMemoryPauseService } from "./pause-port";
import { InMemoryPauseMetrics } from "../features/prism-pause/ports/metrics";
import { ReceiptService } from "./receipt-service";
import { AppError, APP_ERROR_CODE } from "./errors";
import { StarknetRegistryReader, getStarknetRpcUrl, getStarknetRegistryAddress, isStarknetReadConfigured, isStarknetRpcUrlValid } from "./adapters/starknet-registry-reader";
import { StarknetLedgerStatusAdapter } from "../features/prism-operations/adapters/starknet-ledger-status";
import { StarknetEventIndexerAdapter } from "../features/prism-operations/adapters/starknet-event-indexer";
import type { StarknetEventReader, StarknetRegistryVersion } from "../features/prism-operations/adapters/starknet-event-indexer";
import { WatermarkedResolveService, type ProjectionReadPort } from "../features/prism-operations/domain/resolve-service";
import { ReconciliationWorker } from "../features/prism-operations/domain/reconciliation-worker";
import type { RegistryReadPort, StarknetSubmitPort } from "./ports";
import { isConcreteStarknetSubmitAdapter } from "./ports";
import type { PauseAuthorityResolver } from "../features/prism-pause/ports/authority";
import type { VerificationSourceProvider } from "../features/prism-pause/domain/policy-engine";
import type { LedgerStatusPort, EventIndexerPort } from "../features/prism-operations/domain/ports";
import { RpcProvider } from "starknet";

export type SubmitPortMode = "TEST_DOUBLE_X2" | "STARKNET_INJECTED";
export type FactoryRuntimeMode = "test" | "development" | "production";

/** Canonical Starknet projection scopes supported by the configured runtime. */
export type StarknetNetwork = "SN_SEPOLIA" | "SN_MAIN";

/** Public deployment facts for the sole canonical testnet Registry V2 scope. */
export const CANONICAL_TESTNET_V2 = {
  network: "SN_SEPOLIA",
  registryVersion: "v2",
  registryAddress: "0x06f77be5c7bdfef252dd322481b4430a587b781df4f79d3b344808d125ec530d",
  classHash: "0x4349a331b4339c1f20ccdb745e2d60a194f8da64cb789bb70bf60463f42dd8d",
  deploymentBlock: 14015842,
} as const;

export type StarknetProjectionConfig = {
  network: StarknetNetwork;
  registryAddress: string;
  registryVersion: StarknetRegistryVersion;
  classHash: string | null;
  initialFromBlock: number;
};

type StarknetProjectionConfigEnv = Record<string, string | undefined>;

function parseStarknetNetwork(raw: string | undefined, source: string): StarknetNetwork | null {
  const value = raw?.trim();
  if (!value) return null;
  const normalized = value.toUpperCase();
  if (normalized === "SN_SEPOLIA" || normalized === "0X534E5F5345504F4C4941") return "SN_SEPOLIA";
  if (normalized === "SN_MAIN" || normalized === "0X534E5F4D41494E") return "SN_MAIN";
  throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, `unknown_starknet_network:${source}`);
}

export type StarknetNetworkConfig = Partial<Record<"STARKNET_CHAIN_ID" | "NEXT_PUBLIC_STARKNET_NETWORK", string | undefined>>;

/**
 * Resolve the one network scope used by the read/indexer/projection path.
 * STARKNET_CHAIN_ID is the server-side source; the browser network setting is
 * accepted as an explicit fallback and, when present, must agree with it.
 * There is deliberately no production default.
 */
export function getStarknetNetwork(env: StarknetNetworkConfig = {
  STARKNET_CHAIN_ID: process.env.STARKNET_CHAIN_ID,
  NEXT_PUBLIC_STARKNET_NETWORK: process.env.NEXT_PUBLIC_STARKNET_NETWORK,
}): StarknetNetwork {
  const chain = parseStarknetNetwork(env.STARKNET_CHAIN_ID, "STARKNET_CHAIN_ID");
  const network = parseStarknetNetwork(env.NEXT_PUBLIC_STARKNET_NETWORK, "NEXT_PUBLIC_STARKNET_NETWORK");
  if (chain && network && chain !== network) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "starknet_network_config_mismatch");
  }
  if (!chain && !network) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "starknet_network_required");
  }
  return chain ?? network!;
}

export interface FactorySubmitOptions {
  /** Injected submit port for controlled callers; structural test doubles stay test-only. */
  submitPort?: StarknetSubmitPort;
}

export interface FactoryStarknetOverrides {
  /** Injected read provider shared across callContract + getEvents (for tests). If omitted, factory creates one RpcProvider. */
  starknetReadProvider?: StarknetEventReader & {
    callContract?(args: { contractAddress: string; entrypoint: string; calldata: string[] }, blockIdentifier?: string): Promise<string[]>;
    call?(args: { contractAddress: string; entrypoint: string; calldata: string[] }): Promise<string[]>;
    getTransactionStatus?(txHash: string): Promise<Record<string, unknown>>;
    getTransactionReceipt?(txHash: string): Promise<Record<string, unknown>>;
    getBlockNumber?(): Promise<number>;
    getBlockLatestAccepted?(): Promise<{ block_number: number }>;
  };
  /** Explicit ABI version for an injected submit port or isolated offline fixture; there is no V1 default. */
  submitPortRegistryVersion?: StarknetRegistryVersion;
  /** Explicit registry address for an injected test double that cannot declare one itself. */
  submitPortRegistryAddress?: string;
  /** Explicit Pause authority policy; omitted keeps approve/release fail-closed while D-P0-002 is open. */
  pauseAuthorityResolver?: PauseAuthorityResolver;
  /** Explicit isolated-test verification double; never accepted from REST/API input. */
  verificationSourceProvider?: VerificationSourceProvider;
  /** Settlement doubles are opt-in and accepted only by runtimeMode=test factories. */
  testOnlyPauseSettlementAdapters?: Map<SettlementChain, PauseExecutionAdapter>;
  /** Test-only adapter constructor receives the factory-owned OperationStore. */
  testOnlyPauseSettlementAdapterFactory?: (operationStore: OperationStore) => Map<SettlementChain, PauseExecutionAdapter>;
  submitPort?: StarknetSubmitPort;
}

export interface AppFactory {
  /** Runtime classification controls whether local doubles may serve commands. */
  runtimeMode: FactoryRuntimeMode;
  /** Stable guard used by all chain-touching API handlers. */
  assertChainTouchingConfigured(): void;
  handlers: ReturnType<typeof createPrismApiHandlers>;
  app: PrismApplicationService;
  registry: InMemoryRegistry;
  /** Canonical read port — may be real Starknet reader when env configured, else in-memory fallback (dev/test). */
  registryReadPort: RegistryReadPort;
  /** Submit port — TEST_DOUBLE_X2 by default; live Starknet only via explicit injection. */
  submitPort: StarknetSubmitPort;
  /** Explicit mode label so callers never mistake TEST_DOUBLE for live submission. */
  submitPortMode: SubmitPortMode;
  /** True only when a concrete StarknetSubmitAdapter/V2 instance was injected. */
  isStarknetSubmitConfigured: boolean;
  operationStore: OperationStore;
  ownershipStore: OwnershipProofStore;
  pauseService: InMemoryPauseService;
  pauseStore: PauseStore;
  receiptService: ReceiptService;
  challengeService: PrismChallengeService;
  prismEventsStore?: PostgresPrismEventsStore | null;
  /** Durable canonical-event projection; constructed only with Postgres + configured Starknet read. */
  eventProjectionCoordinator?: EventProjectionCoordinator | null;
  /** Scope-bound durable projection read port used by WatermarkedResolveService fallback. */
  projectionReadPort?: ProjectionReadPort | null;
  projectionCheckpointStore?: EventProjectionCheckpointStore | null;
  /** Real read-only Starknet ports when STARKNET_RPC_URL+REGISTRY_ADDRESS present; null in dev/test fallback. */
  ledgerStatusAdapter?: (LedgerStatusPort & { getConfirmedBlock(): Promise<number | null> }) | null;
  eventIndexerAdapter?: EventIndexerPort | null;
  /** Shared read provider when Starknet configured (single RpcProvider or injected fake). Null in dev fallback. */
  starknetReadProvider?: FactoryStarknetOverrides["starknetReadProvider"] | null;
  /** Watermarked resolve with K=5 stale refusal, wired to ledger confirmed block when available. */
  resolveService: WatermarkedResolveService;
  /** Reconciliation worker bound to durable store + ledger/indexer fakes (X2) or real adapters when configured. */
  reconciliationWorker: ReconciliationWorker;
  isPostgres: boolean;
  isStarknetConfigured: boolean;
  /** Graceful shutdown: stop worker, close stores/events. */
  shutdown(): Promise<void>;
}

export function isStarknetSubmitConfiguredForFactory(factory: AppFactory): boolean {
  return factory.isStarknetSubmitConfigured;
}

/**
 * Guard the effectful identity/binding/revoke surface. Test factories may use
 * explicit doubles; development and production factories may not serve those
 * routes until both a real read path and a concrete submit adapter exist.
 */
export function assertChainTouchingConfiguredForFactory(
  factory: Pick<AppFactory, "runtimeMode" | "isStarknetConfigured" | "submitPortMode" | "isStarknetSubmitConfigured" | "submitPort">,
): void {
  if (factory.runtimeMode === "test") return;
  if (!factory.isStarknetConfigured) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "starknet_read_unconfigured");
  }
  if (factory.submitPortMode !== "STARKNET_INJECTED" || !factory.isStarknetSubmitConfigured || !isConcreteStarknetSubmitAdapter(factory.submitPort)) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "submit_unconfigured");
  }
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

export function getRuntimeMode(): FactoryRuntimeMode {
  if (isProductionRuntime()) return "production";
  if (process.env.NODE_ENV === "test" || process.env.PRISM_RUNTIME_MODE === "test") return "test";
  return "development";
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

function assertStarknetEnvOrThrow(): { rpcUrl: string; registryAddress: string; network: StarknetNetwork; registryVersion: StarknetRegistryVersion; initialFromBlock: number; classHash: string | null } | null {
  const rpcUrl = getStarknetRpcUrl();
  const registryAddress = getStarknetRegistryAddress();
  if (rpcUrl === null && registryAddress === null) return null;
  if (rpcUrl === null || registryAddress === null) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "starknet_read_config_incomplete");
  }
  if (!isStarknetRpcUrlValid(rpcUrl)) throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "invalid_starknet_rpc_url");
  const projection = getStarknetProjectionConfig();
  return {
    rpcUrl,
    registryAddress: projection.registryAddress,
    network: projection.network,
    registryVersion: projection.registryVersion,
    initialFromBlock: projection.initialFromBlock,
    classHash: projection.classHash,
  };
}

function normalizeStarknetRegistryVersion(raw: string | undefined): StarknetRegistryVersion {
  const value = raw?.trim().toLowerCase();
  if (!value) throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "starknet_registry_version_required");
  const normalized = value === "1" ? "v1" : value === "2" ? "v2" : value;
  if (normalized !== "v1" && normalized !== "v2") throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "invalid_starknet_registry_version");
  return normalized;
}

function normalizedOptionalClassHash(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(value)) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "invalid_starknet_registry_class_hash");
  }
  return `0x${value.slice(2).toLowerCase().padStart(64, "0")}`;
}

function parseProjectionStartBlock(raw: string | undefined, registryVersion: StarknetRegistryVersion, network: StarknetNetwork): number {
  const value = raw?.trim() || (registryVersion === "v2" && network === "SN_SEPOLIA" ? String(CANONICAL_TESTNET_V2.deploymentBlock) : "0");
  const block = Number(value);
  if (!Number.isSafeInteger(block) || block < 0) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "invalid_starknet_indexer_start_block");
  }
  if (registryVersion === "v2" && network === "SN_SEPOLIA" && block !== CANONICAL_TESTNET_V2.deploymentBlock) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "canonical_v2_start_block_mismatch");
  }
  return block;
}

/**
 * Resolve and validate the configured Starknet projection scope before any
 * provider, checkpoint, or event decoder is constructed. Testnet V2 is pinned
 * to the explicitly deployed address and block; V1 remains an independent
 * explicitly scoped legacy ABI.
 */
export function getStarknetProjectionConfig(env: StarknetProjectionConfigEnv = process.env): StarknetProjectionConfig {
  const network = getStarknetNetwork({
    STARKNET_CHAIN_ID: env.STARKNET_CHAIN_ID,
    NEXT_PUBLIC_STARKNET_NETWORK: env.NEXT_PUBLIC_STARKNET_NETWORK,
  });
  const rawAddress = (env.STARKNET_REGISTRY_ADDRESS ?? env.PRISM_REGISTRY_ADDRESS ?? "").trim();
  const registryAddress = normalizeRegistryAddress(rawAddress, "starknet_registry_address_required", "invalid_starknet_registry_address");
  const registryVersion = normalizeStarknetRegistryVersion(env.STARKNET_REGISTRY_VERSION);
  const classHash = normalizedOptionalClassHash(env.STARKNET_REGISTRY_CLASS_HASH);

  if (registryAddress === CANONICAL_TESTNET_V2.registryAddress && registryVersion !== "v2") {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "canonical_v2_requires_v2_version");
  }
  if (registryVersion === "v2" && network !== CANONICAL_TESTNET_V2.network) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "canonical_v2_network_mismatch");
  }
  if (registryVersion === "v2" && network === "SN_SEPOLIA" && registryAddress !== CANONICAL_TESTNET_V2.registryAddress) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "canonical_v2_registry_address_mismatch");
  }
  const canonicalClassHash = normalizedOptionalClassHash(CANONICAL_TESTNET_V2.classHash)!;
  if (registryVersion === "v2" && classHash !== null && classHash !== canonicalClassHash) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "canonical_v2_class_hash_mismatch");
  }

  return {
    network,
    registryAddress,
    registryVersion,
    classHash,
    initialFromBlock: parseProjectionStartBlock(env.PRISM_STARKNET_INDEXER_START_BLOCK, registryVersion, network),
  };
}

function getStarknetRegistryVersion(env: StarknetProjectionConfigEnv = process.env): StarknetRegistryVersion {
  return normalizeStarknetRegistryVersion(env.STARKNET_REGISTRY_VERSION);
}

function requireExplicitRegistryVersion(value: unknown): StarknetRegistryVersion {
  if (value === undefined || value === null || value === "") {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "starknet_registry_version_required");
  }
  if (value !== "v1" && value !== "v2") {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "invalid_starknet_registry_version");
  }
  return value;
}

function getConfiguredRegistryVersion(overrides?: FactoryStarknetOverrides): StarknetRegistryVersion {
  return overrides?.submitPortRegistryVersion === undefined
    ? getStarknetRegistryVersion()
    : requireExplicitRegistryVersion(overrides.submitPortRegistryVersion);
}

function assertSubmitPortAbiVersion(submitPort: StarknetSubmitPort | undefined, registryVersion: StarknetRegistryVersion): void {
  const declared = submitPort?.registryVersion;
  if (declared !== undefined && declared !== registryVersion) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "submit_port_abi_version_mismatch");
  }
}

function normalizeRegistryAddress(value: unknown, missingMessage: string, invalidMessage: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, missingMessage);
  }
  try {
    return normalizeStarknetContractAddress(value, "registryAddress");
  } catch {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, invalidMessage);
  }
}

function assertSubmitPortRegistryAddress(
  submitPort: StarknetSubmitPort | undefined,
  registryAddress: string,
  explicitSubmitPortRegistryAddress?: string,
): void {
  if (!submitPort) return;
  const configured = normalizeRegistryAddress(registryAddress, "starknet_registry_address_required", "invalid_starknet_registry_address");
  const declared = submitPort.registryAddress;
  const candidate = declared ?? explicitSubmitPortRegistryAddress;
  if (candidate === undefined) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "submit_port_registry_address_required");
  }
  const actual = normalizeRegistryAddress(candidate, "submit_port_registry_address_required", "invalid_submit_port_registry_address");
  if (declared !== undefined && explicitSubmitPortRegistryAddress !== undefined) {
    const explicit = normalizeRegistryAddress(explicitSubmitPortRegistryAddress, "submit_port_registry_address_required", "invalid_submit_port_registry_address");
    if (explicit !== actual) {
      throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "submit_port_registry_address_mismatch");
    }
  }
  if (actual !== configured) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "submit_port_registry_address_mismatch");
  }
}

function getProjectionMaxPages(): number {
  const raw = (process.env.PRISM_STARKNET_INDEXER_MAX_PAGES ?? "1000").trim();
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "invalid_starknet_indexer_max_pages");
  return value;
}

function createSharedRpcProvider(rpcUrl: string): FactoryStarknetOverrides["starknetReadProvider"] {
  return new RpcProvider({ nodeUrl: rpcUrl }) as unknown as FactoryStarknetOverrides["starknetReadProvider"];
}

export function createStarknetReadPorts(overrides?: FactoryStarknetOverrides): { reader: StarknetRegistryReader; ledger: StarknetLedgerStatusAdapter; indexer: StarknetEventIndexerAdapter; provider: FactoryStarknetOverrides["starknetReadProvider"]; network: StarknetNetwork; registryAddress: string; registryVersion: StarknetRegistryVersion; initialFromBlock: number; classHash: string | null } | null {
  const cfg = assertStarknetEnvOrThrow();
  if (!cfg) return null;
  // Share one read-only provider across callContract and getEvents — no dead shim.
  const provider = overrides?.starknetReadProvider ?? createSharedRpcProvider(cfg.rpcUrl);
  // Validate provider implements both surfaces fail-closed
  const hasCall = typeof (provider as unknown as { callContract?: unknown }).callContract === "function" || typeof (provider as unknown as { call?: unknown }).call === "function";
  const hasGetEvents = typeof (provider as unknown as { getEvents?: unknown }).getEvents === "function";
  if (!hasCall) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "starknet_reader_missing_callContract");
  }
  if (!hasGetEvents) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "starknet_indexer_requires_getEvents");
  }
  const reader = new StarknetRegistryReader({ rpcUrl: cfg.rpcUrl, registryAddress: cfg.registryAddress, reader: provider as unknown as import("./adapters/starknet-registry-reader").StarknetRegistryReaderRpc });
  const ledger = new StarknetLedgerStatusAdapter({ rpcUrl: cfg.rpcUrl, reader: provider as unknown as import("../features/prism-operations/adapters/starknet-ledger-status").StarknetRpcReader });
  const registryVersion = cfg.registryVersion;
  assertSubmitPortAbiVersion(overrides?.submitPort, registryVersion);
  if (overrides?.submitPort && overrides.submitPortRegistryVersion !== registryVersion) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "submit_port_registry_version_mismatch");
  }
  assertSubmitPortRegistryAddress(overrides?.submitPort, cfg.registryAddress, overrides?.submitPortRegistryAddress);
  let indexer: StarknetEventIndexerAdapter;
  try {
    indexer = new StarknetEventIndexerAdapter({ reader: provider as unknown as StarknetEventReader, registryAddress: cfg.registryAddress, network: cfg.network, registryVersion, requireEventOrigin: process.env.NODE_ENV === "production" || process.env.VITEST !== "true", chunkSize: 100, maxPages: getProjectionMaxPages() });
  } catch {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "starknet_indexer_init_failed");
  }
  return {
    reader,
    ledger,
    indexer,
    provider,
    network: cfg.network,
    registryAddress: cfg.registryAddress,
    registryVersion: cfg.registryVersion,
    initialFromBlock: cfg.initialFromBlock,
    classHash: cfg.classHash,
  };
}

// ---------------------------------------------------------------------------
// Factory creators
// ---------------------------------------------------------------------------

function createMemoryFactory(
  clock = fixedClock(Math.floor(Date.now() / 1000)),
  overrides?: FactoryStarknetOverrides,
  runtimeMode: FactoryRuntimeMode = getRuntimeMode(),
): AppFactory {
  if (overrides?.submitPort && !overrides.submitPortRegistryVersion) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "submit_port_registry_version_required");
  }
  if (runtimeMode !== "test" && (overrides?.testOnlyPauseSettlementAdapters || overrides?.testOnlyPauseSettlementAdapterFactory)) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "pause_settlement_test_double_forbidden_in_runtime");
  }
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
  let starknetPorts: { reader: StarknetRegistryReader; ledger: StarknetLedgerStatusAdapter; indexer: StarknetEventIndexerAdapter; provider: FactoryStarknetOverrides["starknetReadProvider"]; network: StarknetNetwork; registryAddress: string; registryVersion: StarknetRegistryVersion; initialFromBlock: number; classHash: string | null } | null = null;
  let starknetError: Error | null = null;
  try {
    starknetPorts = createStarknetReadPorts(overrides);
  } catch (e) {
    starknetError = e as Error;
  }
  if (starknetError) throw starknetError;
  const registryReadPort: RegistryReadPort = starknetPorts ? starknetPorts.reader : registry;
  const ledgerStatusAdapter = starknetPorts ? starknetPorts.ledger : null;
  const eventIndexerAdapter = starknetPorts ? starknetPorts.indexer : null;
  const starknetReadProvider = starknetPorts ? starknetPorts.provider : null;
  const isStarknetConfigured = starknetPorts !== null;
  const registryVersion = starknetPorts ? starknetPorts.registryVersion : getConfiguredRegistryVersion(overrides);
  assertSubmitPortAbiVersion(overrides?.submitPort, registryVersion);
  registry.setDigestMode(registryVersion);
  // Submit port semantics are explicit: the default is a local-only double;
  // live submission is possible only through an injected concrete adapter.
  const submitPort: StarknetSubmitPort = overrides?.submitPort ?? registry;
  const hasConcreteSubmitAdapter = isConcreteStarknetSubmitAdapter(overrides?.submitPort);
  const submitPortMode: SubmitPortMode = hasConcreteSubmitAdapter ? "STARKNET_INJECTED" : "TEST_DOUBLE_X2";
  const isStarknetSubmitConfigured = hasConcreteSubmitAdapter;
  const assertChainTouchingConfigured = () => assertChainTouchingConfiguredForFactory({ runtimeMode, isStarknetConfigured, submitPortMode, isStarknetSubmitConfigured, submitPort });
  if (runtimeMode === "production") assertChainTouchingConfigured();
  let n = 1;
  const app = new PrismApplicationService({
    challengeService,
    operationStore,
    registry: registryReadPort,
    submitPort,
    submitPortMode,
    isStarknetSubmitConfigured,
    registryVersion,
    clock,
    idGenerator: { generateOperationId: () => `op-${n++}-${Date.now()}` },
  });
  const handlers = createPrismApiHandlers(app, { assertChainTouchingConfigured });
  const pauseStore = new InMemoryPauseStore();
  const pauseMetrics = new InMemoryPauseMetrics();
  const pauseAdapters = runtimeMode === "test"
    ? overrides?.testOnlyPauseSettlementAdapters ?? overrides?.testOnlyPauseSettlementAdapterFactory?.(operationStore)
    : undefined;
  const pauseService = new InMemoryPauseService(clock, {
    store: pauseStore,
    operationStore,
    metrics: pauseMetrics,
    adapterRegistry: pauseAdapters,
    authorityResolver: overrides?.pauseAuthorityResolver,
    verificationSourceProvider: overrides?.verificationSourceProvider,
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
    runtimeMode,
    assertChainTouchingConfigured,
    handlers,
    app,
    registry,
    registryReadPort,
    submitPort,
    submitPortMode,
    isStarknetSubmitConfigured,
    operationStore,
    ownershipStore,
    pauseService,
    pauseStore,
    receiptService,
    challengeService,
    prismEventsStore: null,
    eventProjectionCoordinator: null,
    projectionReadPort: null,
    projectionCheckpointStore: null,
    ledgerStatusAdapter,
    eventIndexerAdapter,
    starknetReadProvider,
    resolveService,
    reconciliationWorker,
    isPostgres: false,
    isStarknetConfigured,
    shutdown,
  };
}

async function createPostgresFactory(
  url: string,
  clock = fixedClock(Math.floor(Date.now() / 1000)),
  overrides?: FactoryStarknetOverrides,
  runtimeMode: FactoryRuntimeMode = getRuntimeMode(),
): Promise<AppFactory> {
  if (overrides?.submitPort && !overrides.submitPortRegistryVersion) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "submit_port_registry_version_required");
  }
  if (runtimeMode !== "test" && (overrides?.testOnlyPauseSettlementAdapters || overrides?.testOnlyPauseSettlementAdapterFactory)) {
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "pause_settlement_test_double_forbidden_in_runtime");
  }
  // Validate format synchronously before attempting network
  assertPostgresUrlOrThrow(url);

  // Create PG-backed stores. Each does migrate() fail-closed.
  const ownershipStore = new PostgresOwnershipProofStore({ connectionString: url });
  const operationStore = new PostgresOperationStore({ connectionString: url });
  const pauseStore = new PostgresPauseStore({ connectionString: url });
  const prismEventsStore = new PostgresPrismEventsStore({ connectionString: url });
  const projectionCheckpointStore = new PostgresEventProjectionCheckpointStore({ connectionString: url });

  try {
    await ownershipStore.migrate();
    await operationStore.migrate();
    await pauseStore.migrate();
    await prismEventsStore.migrate();
    await projectionCheckpointStore.migrate();
  } catch (cause) {
    // Close any pools that were opened before rethrowing fail-closed
    await Promise.allSettled([ownershipStore.close().catch(() => undefined), operationStore.close().catch(() => undefined), pauseStore.close?.().catch(() => undefined), prismEventsStore.close().catch(() => undefined), projectionCheckpointStore.close().catch(() => undefined)]);
    if (cause instanceof AppError) throw cause;
    // Wrap driver error as stable 503 without leaking URL
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, `postgres_connect_or_migrate_failed:${(cause as Error)?.message?.slice(0, 80) ?? "unknown"}`);
  }

  // Starknet read wiring — fail-closed on invalid config, otherwise real adapters sharing one provider
  let starknetPorts: { reader: StarknetRegistryReader; ledger: StarknetLedgerStatusAdapter; indexer: StarknetEventIndexerAdapter; provider: FactoryStarknetOverrides["starknetReadProvider"]; network: StarknetNetwork; registryAddress: string; registryVersion: StarknetRegistryVersion; initialFromBlock: number; classHash: string | null } | null = null;
  let starknetError: Error | null = null;
  try {
    starknetPorts = createStarknetReadPorts(overrides);
  } catch (e) {
    starknetError = e as Error;
  }
  if (starknetError) {
    await Promise.allSettled([ownershipStore.close().catch(() => undefined), operationStore.close().catch(() => undefined), pauseStore.close?.().catch(() => undefined), prismEventsStore.close().catch(() => undefined), projectionCheckpointStore.close().catch(() => undefined)]);
    throw starknetError;
  }
  const registry = new InMemoryRegistry(); // Fallback registry for test helpers; real read path uses registryReadPort
  const registryReadPort: RegistryReadPort = starknetPorts ? starknetPorts.reader : registry;
  const ledgerStatusAdapter = starknetPorts ? starknetPorts.ledger : null;
  const eventIndexerAdapter = starknetPorts ? starknetPorts.indexer : null;
  const starknetReadProvider = starknetPorts ? starknetPorts.provider : null;
  const isStarknetConfigured = starknetPorts !== null;
  const registryVersion = starknetPorts ? starknetPorts.registryVersion : getConfiguredRegistryVersion(overrides);
  assertSubmitPortAbiVersion(overrides?.submitPort, registryVersion);
  registry.setDigestMode(registryVersion);
  const eventProjectionCoordinator = starknetPorts
    ? new EventProjectionCoordinator({
        registryAddress: starknetPorts.registryAddress,
        network: starknetPorts.network,
        registryVersion,
        initialFromBlock: starknetPorts.initialFromBlock,
        checkpointStore: projectionCheckpointStore,
        eventsStore: prismEventsStore,
        indexer: starknetPorts.indexer,
      })
    : null;
  const projectionReadPort: ProjectionReadPort | null = eventProjectionCoordinator;
  const submitPort: StarknetSubmitPort = overrides?.submitPort ?? registry;
  const hasConcreteSubmitAdapter = isConcreteStarknetSubmitAdapter(overrides?.submitPort);
  const submitPortMode: SubmitPortMode = hasConcreteSubmitAdapter ? "STARKNET_INJECTED" : "TEST_DOUBLE_X2";
  const isStarknetSubmitConfigured = hasConcreteSubmitAdapter;
  const assertChainTouchingConfigured = () => assertChainTouchingConfiguredForFactory({ runtimeMode, isStarknetConfigured, submitPortMode, isStarknetSubmitConfigured, submitPort });
  if (runtimeMode === "production") {
    try {
      assertChainTouchingConfigured();
    } catch (cause) {
      await Promise.allSettled([ownershipStore.close().catch(() => undefined), operationStore.close().catch(() => undefined), pauseStore.close?.().catch(() => undefined), prismEventsStore.close().catch(() => undefined), projectionCheckpointStore.close().catch(() => undefined)]);
      throw cause;
    }
  }

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
    submitPort,
    submitPortMode,
    isStarknetSubmitConfigured,
    registryVersion,
    clock,
    idGenerator: { generateOperationId: () => `op-${n++}-${Date.now()}` },
  });
  const handlers = createPrismApiHandlers(app, { assertChainTouchingConfigured });
  const pauseMetrics = new InMemoryPauseMetrics();
  const pauseAdapters = runtimeMode === "test"
    ? overrides?.testOnlyPauseSettlementAdapters ?? overrides?.testOnlyPauseSettlementAdapterFactory?.(operationStore)
    : undefined;
  const pauseService = new InMemoryPauseService(clock, {
    store: pauseStore,
    operationStore,
    metrics: pauseMetrics,
    adapterRegistry: pauseAdapters,
    authorityResolver: overrides?.pauseAuthorityResolver,
    verificationSourceProvider: overrides?.verificationSourceProvider,
  });
  const receiptService = new ReceiptService(operationStore);
  const resolveService = new WatermarkedResolveService(registryReadPort, {
    staleBoundK: 5,
    confirmedBlockPort: ledgerStatusAdapter ?? undefined,
    projectionReadPort: projectionReadPort ?? undefined,
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
      projectionCheckpointStore.close().catch(() => undefined),
    ]);
  };
  return {
    runtimeMode,
    assertChainTouchingConfigured,
    handlers,
    app,
    registry,
    registryReadPort,
    submitPort,
    submitPortMode,
    isStarknetSubmitConfigured,
    operationStore,
    ownershipStore,
    pauseService,
    pauseStore,
    receiptService,
    challengeService,
    prismEventsStore,
    eventProjectionCoordinator,
    projectionReadPort,
    projectionCheckpointStore,
    ledgerStatusAdapter,
    eventIndexerAdapter,
    starknetReadProvider,
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
  const runtimeMode = getRuntimeMode();

  if (url !== null) {
    // URL present: must be valid format and reachable, otherwise fail-closed
    if (!isPostgresUrlValid(url)) {
      throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "invalid_postgres_url_format");
    }
    try {
      return await createPostgresFactory(url, fixedClock(Math.floor(Date.now() / 1000)), undefined, runtimeMode);
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, `postgres_init_failed:${(e as Error).message?.slice(0, 80) ?? "unknown"}`);
    }
  }

  if (runtimeMode === "production") {
    // Production without Postgres is fail-closed: never silently fall back to memory
    throw new AppError(APP_ERROR_CODE.RPC_UNAVAILABLE, "postgres_url_missing_in_production");
  }

  // Dev/test without Postgres: in-memory isolated
  return createMemoryFactory(fixedClock(Math.floor(Date.now() / 1000)), undefined, runtimeMode);
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
  singleton = createMemoryFactory(fixedClock(Math.floor(Date.now() / 1000)), undefined, getRuntimeMode());
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
export function createIsolatedFactory(start = 1_789_000_000, overrides?: FactoryStarknetOverrides): AppFactory {
  const clock = fixedClock(start);
  return createMemoryFactory(clock, overrides, "test");
}

// Explicit factory with injected Starknet read provider and/or submit port (for wiring tests)
export function createIsolatedFactoryWithStarknet(start = 1_789_000_000, overrides: FactoryStarknetOverrides): AppFactory {
  const clock = fixedClock(start);
  return createMemoryFactory(clock, overrides, "test");
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
      s.projectionCheckpointStore?.close().catch(() => undefined),
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
      s.projectionCheckpointStore?.close().catch(() => undefined),
      s.shutdown?.().catch(() => undefined),
    ]);
  }
  singleton = null;
  singletonPromise = null;
  singletonError = null;
}
