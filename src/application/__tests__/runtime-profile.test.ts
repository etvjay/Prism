import { describe, expect, it } from "vitest";
import { getRuntimeProfileConfig, postgresPoolOptions } from "../runtime-profile";

const base = { PRISM_RUNTIME_MODE: "production", NODE_ENV: "production" };

describe("runtime profile PostgreSQL boundary", () => {
  it("selects TESTNET URL and isolated schema", () => {
    const c = getRuntimeProfileConfig({ ...base, PRISM_RUNTIME_PROFILE: "TESTNET", PRISM_POSTGRES_TESTNET_URL: "postgresql://test/db" });
    expect(c).toMatchObject({ profile: "TESTNET", databaseUrl: "postgresql://test/db", schema: "prism_testnet", network: "SN_SEPOLIA" });
    expect(postgresPoolOptions(c).options).toContain("search_path=prism_testnet,public");
  });

  it("never falls back to test or ambiguous URL for MAINNET", () => {
    expect(() => getRuntimeProfileConfig({ ...base, PRISM_RUNTIME_PROFILE: "MAINNET", PRISM_POSTGRES_TEST_URL: "postgresql://test/db" })).toThrowError(
      expect.objectContaining({ code: "database_url_missing" }),
    );
  });

  it("rejects a schema or network belonging to the other profile", () => {
    expect(() => getRuntimeProfileConfig({ ...base, PRISM_RUNTIME_PROFILE: "MAINNET", PRISM_POSTGRES_MAINNET_URL: "postgresql://main/db", PRISM_POSTGRES_SCHEMA: "prism_testnet" })).toThrowError(
      expect.objectContaining({ code: "schema_mismatch" }),
    );
    expect(() => getRuntimeProfileConfig({ ...base, PRISM_RUNTIME_PROFILE: "TESTNET", PRISM_POSTGRES_TESTNET_URL: "postgresql://test/db", STARKNET_CHAIN_ID: "SN_MAIN" })).toThrowError(
      expect.objectContaining({ code: "network_mismatch" }),
    );
  });

  it("fails closed on missing, malformed, and invalid profile configuration", () => {
    expect(() => getRuntimeProfileConfig(base)).toThrowError(expect.objectContaining({ code: "profile_required" }));
    expect(() => getRuntimeProfileConfig({ ...base, PRISM_RUNTIME_PROFILE: "TESTNET", PRISM_POSTGRES_TESTNET_URL: "https://not-postgres" })).toThrowError(
      expect.objectContaining({ code: "database_url_invalid" }),
    );
    expect(() => getRuntimeProfileConfig({ ...base, PRISM_RUNTIME_PROFILE: "OTHER", PRISM_POSTGRES_TESTNET_URL: "postgresql://test/db" })).toThrowError(
      expect.objectContaining({ code: "invalid_profile" }),
    );
  });

  it("validates migration version", () => {
    expect(() => getRuntimeProfileConfig({ ...base, PRISM_RUNTIME_PROFILE: "TESTNET", PRISM_POSTGRES_TESTNET_URL: "postgresql://test/db", PRISM_POSTGRES_MIGRATION_VERSION: "0" })).toThrowError(
      expect.objectContaining({ code: "migration_version_invalid" }),
    );
  });
});
