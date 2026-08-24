// Environment-gated Postgres factory wiring — fail-closed semantics.
// No secrets printed or persisted. Validates gating without live Postgres connection.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getPostgresUrl, isPostgresUrlValid, isProductionRuntime, shouldUsePostgres, resetFactory, closeFactory, getAppFactory, createIsolatedFactory } from "../factory";
import { APP_ERROR_CODE } from "../errors";

const ORIGINAL_ENV = { ...process.env };

function withEnv(overrides: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const run = async () => {
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      // restore also keys that were added
      for (const k of Object.keys(overrides)) if (!(k in prev)) delete process.env[k];
      resetFactory();
      await closeFactory().catch(() => undefined);
    }
  };
  return run();
}

describe("Factory — Postgres environment gating", () => {
  beforeEach(() => {
    resetFactory();
  });
  afterEach(async () => {
    await closeFactory().catch(() => undefined);
    // restore env
    for (const k of Object.keys(process.env)) if (!(k in ORIGINAL_ENV)) delete process.env[k];
    for (const [k, v] of Object.entries(ORIGINAL_ENV)) process.env[k] = v as string;
  });

  it("isPostgresUrlValid validates format without leaking value", () => {
    expect(isPostgresUrlValid("postgresql://user:pass@localhost:5432/db")).toBe(true);
    expect(isPostgresUrlValid("postgres://localhost/db")).toBe(true);
    expect(isPostgresUrlValid("http://localhost/db")).toBe(false);
    expect(isPostgresUrlValid("")).toBe(false);
    expect(isPostgresUrlValid("not_a_url")).toBe(false);
  });

  it("getPostgresUrl returns null when absent, never prints value", async () => {
    await withEnv({ PRISM_POSTGRES_TEST_URL: undefined, PRISM_POSTGRES_URL: undefined }, async () => {
      expect(getPostgresUrl()).toBeNull();
      expect(shouldUsePostgres()).toBe(false);
    });
  });

  it("shouldUsePostgres true only when valid URL present", async () => {
    await withEnv({ PRISM_POSTGRES_TEST_URL: "postgresql://localhost/prism_test" }, async () => {
      expect(getPostgresUrl()).toBe("postgresql://localhost/prism_test");
      expect(shouldUsePostgres()).toBe(true);
    });
    await withEnv({ PRISM_POSTGRES_TEST_URL: "http://not-postgres" }, async () => {
      expect(shouldUsePostgres()).toBe(false);
    });
  });

  it("isProductionRuntime respects NODE_ENV and flags", async () => {
    await withEnv({ NODE_ENV: "production", PRISM_POSTGRES_TEST_URL: undefined }, async () => {
      expect(isProductionRuntime()).toBe(true);
    });
    await withEnv({ NODE_ENV: "development", PRISM_REQUIRE_POSTGRES: "1" }, async () => {
      expect(isProductionRuntime()).toBe(true);
    });
    await withEnv({ NODE_ENV: "test", PRISM_REQUIRE_POSTGRES: undefined, PRISM_RUNTIME_MODE: undefined }, async () => {
      expect(isProductionRuntime()).toBe(false);
    });
  });

  it("dev/test without URL uses in-memory adapters (isolated factory path)", async () => {
    await withEnv({ NODE_ENV: "test", PRISM_POSTGRES_TEST_URL: undefined, PRISM_REQUIRE_POSTGRES: undefined }, async () => {
      const f = await getAppFactory();
      expect(f.isPostgres).toBe(false);
      expect(f.ownershipStore).toBeDefined();
      expect(f.operationStore).toBeDefined();
      expect(f.pauseStore).toBeDefined();
      await closeFactory();
    });
  });

  it("production without URL fails closed with 503 stable code, never silent memory fallback", async () => {
    await withEnv({ NODE_ENV: "production", PRISM_POSTGRES_TEST_URL: undefined, PRISM_POSTGRES_URL: undefined }, async () => {
      resetFactory();
      await expect(getAppFactory()).rejects.toMatchObject({ code: APP_ERROR_CODE.RPC_UNAVAILABLE });
      try {
        await getAppFactory();
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).not.toMatch(/postgresql:\/\//i);
        expect(msg.toLowerCase()).not.toContain("secret");
      }
      // second call also fails closed (singletonError preserved)
      await expect(getAppFactory()).rejects.toMatchObject({ code: APP_ERROR_CODE.RPC_UNAVAILABLE });
    });
  });

  it("production with invalid URL format fails closed, never attempts connection", async () => {
    await withEnv({ NODE_ENV: "production", PRISM_POSTGRES_TEST_URL: "http://invalid-not-postgres/test" }, async () => {
      resetFactory();
      await expect(getAppFactory()).rejects.toMatchObject({ code: APP_ERROR_CODE.RPC_UNAVAILABLE });
      try {
        await getAppFactory();
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).toContain("invalid_postgres_url_format");
        expect(msg).not.toContain("http://invalid");
      }
    });
  });

  it("invalid URL format fails closed in non-production too (no silent fallback)", async () => {
    await withEnv({ NODE_ENV: "test", PRISM_POSTGRES_TEST_URL: "not_a_postgres_url" }, async () => {
      resetFactory();
      await expect(getAppFactory()).rejects.toMatchObject({ code: APP_ERROR_CODE.RPC_UNAVAILABLE });
    });
  });

  it("unreachable postgres URL fails closed with 503 (no memory fallback)", async () => {
    await withEnv({ NODE_ENV: "test", PRISM_POSTGRES_TEST_URL: "postgresql://nobody:nothing@127.0.0.1:54329/prism_none" }, async () => {
      resetFactory();
      await expect(getAppFactory()).rejects.toMatchObject({ code: APP_ERROR_CODE.RPC_UNAVAILABLE });
      // ensure not leaking connection string in error detail beyond safe truncation
      try {
        await getAppFactory();
      } catch (e) {
        const msg = (e as Error).message.slice(0, 500);
        expect(msg).not.toContain("nobody:nothing");
        expect(msg.length).toBeLessThan(200);
      }
    });
  }, 10000);

  it("createIsolatedFactory always uses in-memory regardless of env (isolated tests)", async () => {
    await withEnv({ NODE_ENV: "production", PRISM_POSTGRES_TEST_URL: "postgresql://localhost/prism_test", PRISM_REQUIRE_POSTGRES: "1" }, async () => {
      const iso = createIsolatedFactory(1_789_000_100);
      expect(iso.isPostgres).toBe(false);
      // isolated factory should not attempt postgres connection
      const op = await iso.operationStore.create({
        id: "op-iso-1",
        kind: "test",
        idempotencyKey: "idem-iso-1",
        requestFingerprint: "{}",
        now: 1_789_000_000,
      });
      expect(op.state).toBe("created");
    });
  });

  it("resetFactory clears singleton so next call re-evaluates env", async () => {
    await withEnv({ NODE_ENV: "test", PRISM_POSTGRES_TEST_URL: undefined }, async () => {
      const f1 = await getAppFactory();
      expect(f1.isPostgres).toBe(false);
      resetFactory();
      const f2 = await getAppFactory();
      expect(f2.isPostgres).toBe(false);
      expect(f2).not.toBe(f1);
    });
  });
});
