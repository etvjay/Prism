// Production factory hardening — focused behaviors per WORKER_BRIEF.md.
// Evidence ceiling X2: local isolated factories and injected fixtures only.
// No credentials, no .env access, no RPC, no deployment in this lane.
//
// Behavior 1 — Profile-correct Base challenge domain:
import { describe, it, expect, vi } from "vitest";
import {
  createIsolatedFactory,
  defaultChainIdForProfile,
  resolveErc1271SemanticsChecker,
  resolvePauseMetrics,
  getAppFactory,
  resetFactory,
  closeFactory,
  getRuntimeMode,
  isProductionRuntime,
  startFactoryLifecycle,
} from "../factory";
import { ReconciliationWorker } from "../../features/prism-operations/domain/reconciliation-worker";
import { LocalErc1271SemanticsChecker } from "../../features/prism-identity/testing/fixtures";
import { InMemoryPauseMetrics } from "../../features/prism-pause/ports/metrics";
import { AppError, APP_ERROR_CODE } from "../errors";

//   Production TESTNET uses Base chain id 84532; production MAINNET uses 8453.
//   The challenge policy chain id is derived from the already-validated runtime
//   profile; there is no implicit mainnet fallback and no hard-coded 84532.

const EXECUTION_ACCOUNT = "0x1111111111111111111111111111111111111111";

/** Writable view of process.env for test stubbing (@types/node marks it read-only). */
const env = process.env as unknown as Record<string, string | undefined>;

/** Stub the Starknet registry version required by isolated factory construction (existing lane convention). */
function withStarknetRegistryStub<T>(run: () => T): T {
  const prev = env.STARKNET_REGISTRY_VERSION;
  try {
    env.STARKNET_REGISTRY_VERSION = "v1";
    return run();
  } finally {
    if (prev === undefined) delete env.STARKNET_REGISTRY_VERSION;
    else env.STARKNET_REGISTRY_VERSION = prev;
  }
}

async function issueChainId(profileEnv: "TESTNET" | "MAINNET"): Promise<number> {
  const prev: Record<string, string | undefined> = {
    PRISM_RUNTIME_PROFILE: env.PRISM_RUNTIME_PROFILE,
    STARKNET_REGISTRY_VERSION: env.STARKNET_REGISTRY_VERSION,
    STARKNET_RPC_URL: env.STARKNET_RPC_URL,
    STARKNET_REGISTRY_ADDRESS: env.STARKNET_REGISTRY_ADDRESS,
  };
  try {
    env.PRISM_RUNTIME_PROFILE = profileEnv;
    env.STARKNET_REGISTRY_VERSION = "v1";
    delete env.STARKNET_RPC_URL;
    delete env.STARKNET_REGISTRY_ADDRESS;
    const f = createIsolatedFactory();
    const issued = await f.challengeService.issueChallenge({
      prismId: "prism:P7F21",
      venue: "BASE",
      executionAccount: EXECUTION_ACCOUNT,
    });
    return issued.chainId;
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  }
}

describe("production factory hardening — profile-correct Base challenge domain", () => {
  it("maps the validated runtime profile to the Base chain id with no implicit fallback", () => {
    expect(defaultChainIdForProfile("TESTNET")).toBe(84532);
    expect(defaultChainIdForProfile("MAINNET")).toBe(8453);
  });

  it("issues MAINNET-profile challenges on Base chain id 8453 (never a retained testnet 84532)", async () => {
    expect(await issueChainId("MAINNET")).toBe(8453);
  });

  it("keeps TESTNET-profile challenges on Base Sepolia chain id 84532", async () => {
    expect(await issueChainId("TESTNET")).toBe(84532);
  });
});

describe("production factory hardening — no local EIP-1271 fixture in production/rehearsal", () => {
  it("defaults to the local fixture only in test/development factories", () => {
    const f = withStarknetRegistryStub(() => createIsolatedFactory());
    expect(f.runtimeMode).toBe("test");
    expect(f.erc1271SemanticsChecker).toBeInstanceOf(LocalErc1271SemanticsChecker);
  });

  it("rejects the local fixture even when explicitly injected in production", () => {
    const checker = new LocalErc1271SemanticsChecker();
    expect(() => resolveErc1271SemanticsChecker(checker, "production")).toThrowError(
      /erc1271_test_double_forbidden_in_production/,
    );
  });

  it("fails closed with a stable typed application error when production has no checker", () => {
    let threw: unknown;
    try {
      resolveErc1271SemanticsChecker(undefined, "production");
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeInstanceOf(AppError);
    expect((threw as AppError).code).toBe(APP_ERROR_CODE.RPC_UNAVAILABLE);
    expect((threw as AppError).message).toContain("erc1271_semantics_checker_missing_in_production");
  });

  it("keeps the local fixture default in test/development and accepts a non-fixture production checker", () => {
    expect(resolveErc1271SemanticsChecker(undefined, "test")).toBeInstanceOf(LocalErc1271SemanticsChecker);
    expect(resolveErc1271SemanticsChecker(undefined, "development")).toBeInstanceOf(LocalErc1271SemanticsChecker);
    const injected = { check: async () => ({ status: "valid" as const }) };
    expect(resolveErc1271SemanticsChecker(injected, "production")).toBe(injected);
  });

  it("treats PRISM_RUNTIME_MODE=rehearsal as the production runtime (shared production behavior)", () => {
    const prev = env.PRISM_RUNTIME_MODE;
    try {
      env.PRISM_RUNTIME_MODE = "rehearsal";
      expect(isProductionRuntime()).toBe(true);
      expect(getRuntimeMode()).toBe("production");
      // Rehearsal collapses to the production runtime, which fails closed.
      let threw: unknown;
      try {
        resolveErc1271SemanticsChecker(undefined, "production");
      } catch (e) {
        threw = e;
      }
      expect(threw).toBeInstanceOf(AppError);
      expect((threw as AppError).code).toBe(APP_ERROR_CODE.RPC_UNAVAILABLE);
      expect((threw as AppError).message).toContain("erc1271_semantics_checker_missing_in_production");
    } finally {
      if (prev === undefined) delete env.PRISM_RUNTIME_MODE;
      else env.PRISM_RUNTIME_MODE = prev;
    }
  });
});

describe("production factory hardening — no in-memory Pause metrics in production/rehearsal", () => {
  it("defaults to in-memory Pause metrics only in test/development factories", () => {
    const f = withStarknetRegistryStub(() => createIsolatedFactory());
    expect(f.runtimeMode).toBe("test");
    expect(f.pauseMetrics).toBeInstanceOf(InMemoryPauseMetrics);
  });

  it("rejects in-memory metrics even when explicitly injected in production", () => {
    const metrics = new InMemoryPauseMetrics();
    expect(() => resolvePauseMetrics(metrics, "production")).toThrowError(
      /pause_metrics_test_double_forbidden_in_production/,
    );
  });

  it("fails closed with a stable typed application error when production has no Pause metrics", () => {
    let threw: unknown;
    try {
      resolvePauseMetrics(undefined, "production");
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeInstanceOf(AppError);
    expect((threw as AppError).code).toBe(APP_ERROR_CODE.RPC_UNAVAILABLE);
    expect((threw as AppError).message).toContain("pause_metrics_missing_in_production");
  });

  it("keeps the in-memory default in test/development and accepts a non-fixture production sink", () => {
    expect(resolvePauseMetrics(undefined, "test")).toBeInstanceOf(InMemoryPauseMetrics);
    expect(resolvePauseMetrics(undefined, "development")).toBeInstanceOf(InMemoryPauseMetrics);
    const injected = { increment: () => undefined };
    expect(resolvePauseMetrics(injected, "production")).toBe(injected);
  });
});

describe("production factory hardening — explicit reconciliation lifecycle", () => {
  it("awaits production worker startup and propagates startup failure after cleanup", async () => {
    const startupFailure = new Error("worker_start_failed");
    const startReconciliation = vi.fn().mockRejectedValue(startupFailure);
    const shutdown = vi.fn().mockResolvedValue(undefined);
    const factory = { runtimeMode: "production" as const, startReconciliation, shutdown };

    await expect(startFactoryLifecycle(factory)).rejects.toBe(startupFailure);
    expect(startReconciliation).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("does not start the daemon for test factories", async () => {
    const startReconciliation = vi.fn().mockResolvedValue(undefined);
    const shutdown = vi.fn().mockResolvedValue(undefined);
    await startFactoryLifecycle({ runtimeMode: "test", startReconciliation, shutdown });
    expect(startReconciliation).not.toHaveBeenCalled();
    expect(shutdown).not.toHaveBeenCalled();
  });

  it("starts the reconciliation worker once, tolerates repeat start, and shutdown stops it", async () => {
    const startSpy = vi.spyOn(ReconciliationWorker.prototype, "start");
    const f = withStarknetRegistryStub(() => createIsolatedFactory());
    const prevNodeEnv = process.env.NODE_ENV;
    const prevVitest = process.env.VITEST;
    try {
      // The worker's X2 guard reads these at start() time; stub a non-test
      // runtime so the daemon may actually start inside this focused test.
      env.NODE_ENV = "development";
      delete env.VITEST;
      await f.startReconciliation();
      expect(f.reconciliationWorker.isRunning()).toBe(true);
      await f.startReconciliation(); // repeat start is harmless
      expect(startSpy).toHaveBeenCalledTimes(1);
    } finally {
      if (prevNodeEnv === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = prevNodeEnv;
      if (prevVitest === undefined) delete env.VITEST;
      else env.VITEST = prevVitest;
      await f.shutdown();
    }
    expect(f.reconciliationWorker.isRunning()).toBe(false);
    expect(startSpy).toHaveBeenCalledTimes(1);
    startSpy.mockRestore();
  });

  it("invokes the lifecycle exactly once from the singleton path while test guards hold", async () => {
    resetFactory();
    const startSpy = vi.spyOn(ReconciliationWorker.prototype, "start");
    // Existing lane convention: stub the Starknet registry version required by
    // isolated/singleton factory construction. No URL is set, so the test-mode
    // singleton resolves the in-memory factory — no real infrastructure here.
    const prev = env.STARKNET_REGISTRY_VERSION;
    try {
      env.STARKNET_REGISTRY_VERSION = "v1";
      const f = await getAppFactory();
      // Test factories do not auto-start the daemon; callers use tickAllOnce.
      expect(startSpy).toHaveBeenCalledTimes(0);
      expect(f.reconciliationWorker.isRunning()).toBe(false);
      const f2 = await getAppFactory();
      expect(f2).toBe(f);
      expect(startSpy).toHaveBeenCalledTimes(0); // repeat construction never starts it
    } finally {
      startSpy.mockRestore();
      if (prev === undefined) delete env.STARKNET_REGISTRY_VERSION;
      else env.STARKNET_REGISTRY_VERSION = prev;
      resetFactory();
      await closeFactory().catch(() => undefined);
    }
  });
});

describe("production factory hardening — dependency path remains fail-closed (regression guard)", () => {
  it("rejects the production singleton without postgres and without any override", async () => {
    const savedNodeEnv = env.NODE_ENV;
    const savedMode = env.PRISM_RUNTIME_MODE;
    const savedRequire = env.PRISM_REQUIRE_POSTGRES;
    try {
      env.NODE_ENV = "production";
      delete env.PRISM_RUNTIME_MODE;
      env.PRISM_REQUIRE_POSTGRES = "true";
      resetFactory();
      try {
        await expect(getAppFactory()).rejects.toMatchObject({ code: APP_ERROR_CODE.RPC_UNAVAILABLE });
      } finally {
        resetFactory();
        await closeFactory().catch(() => undefined);
      }
    } finally {
      if (savedNodeEnv === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = savedNodeEnv;
      if (savedMode === undefined) delete env.PRISM_RUNTIME_MODE;
      else env.PRISM_RUNTIME_MODE = savedMode;
      if (savedRequire === undefined) delete env.PRISM_REQUIRE_POSTGRES;
      else env.PRISM_REQUIRE_POSTGRES = savedRequire;
    }
  });
});
