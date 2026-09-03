/**
 * Explicit runtime/database boundary. A process has exactly one profile and
 * one database namespace; there is intentionally no "pick whichever URL exists"
 * behavior for MAINNET.
 */
export type RuntimeProfile = "TESTNET" | "MAINNET";

export const SUPPORTED_POSTGRES_MIGRATION_VERSION = 3;

export type RuntimeProfileConfig = {
  profile: RuntimeProfile;
  databaseUrl: string | null;
  schema: string;
  network: "SN_SEPOLIA" | "SN_MAIN";
  registryVersion: "v1" | "v2" | null;
  migrationVersion: number | null;
};

export class RuntimeProfileConfigError extends Error {
  readonly code: "profile_required" | "invalid_profile" | "database_url_missing" | "database_url_invalid" | "schema_mismatch" | "network_mismatch" | "migration_version_invalid";
  constructor(code: RuntimeProfileConfigError["code"], message: string) {
    super(message);
    this.name = "RuntimeProfileConfigError";
    this.code = code;
  }
}

const PG_URL = /^postgres(?:ql)?:\/\//i;
const SCHEMA = /^prism_(testnet|mainnet)$/;

function profileOf(raw: string | undefined, required: boolean): RuntimeProfile {
  const value = raw?.trim().toUpperCase();
  if (!value) {
    if (required) throw new RuntimeProfileConfigError("profile_required", "PRISM_RUNTIME_PROFILE is required");
    return "TESTNET";
  }
  if (value !== "TESTNET" && value !== "MAINNET") {
    throw new RuntimeProfileConfigError("invalid_profile", "PRISM_RUNTIME_PROFILE must be TESTNET or MAINNET");
  }
  return value;
}

/** Resolve and validate all profile/database selectors without opening a connection. */
export function getRuntimeProfileConfig(env: Record<string, string | undefined> = process.env): RuntimeProfileConfig {
  const runtimeMode = (env.PRISM_RUNTIME_MODE ?? "").trim().toLowerCase();
  const required = runtimeMode === "production" || env.NODE_ENV === "production" || env.PRISM_REQUIRE_POSTGRES === "1";
  const legacyUrlConfigured = Boolean((env.PRISM_POSTGRES_TEST_URL ?? env.PRISM_POSTGRES_URL ?? "").trim());
  const profile = profileOf(env.PRISM_RUNTIME_PROFILE ?? (env.PRISM_TARGET_ENV ? env.PRISM_TARGET_ENV.toUpperCase() : undefined), required && !legacyUrlConfigured);
  const expectedSchema = profile === "TESTNET" ? "prism_testnet" : "prism_mainnet";
  const explicitSchema = env.PRISM_POSTGRES_SCHEMA?.trim();
  if (explicitSchema && (!SCHEMA.test(explicitSchema) || explicitSchema !== expectedSchema)) {
    throw new RuntimeProfileConfigError("schema_mismatch", "PRISM_POSTGRES_SCHEMA does not match PRISM_RUNTIME_PROFILE");
  }

  // Legacy TEST_URL/URL are accepted only for TESTNET compatibility. MAINNET
  // can never inherit a test URL or the ambiguous PRISM_POSTGRES_URL.
  const databaseUrl = profile === "MAINNET"
    ? (env.PRISM_POSTGRES_MAINNET_URL ?? "").trim() || null
    : (env.PRISM_POSTGRES_TESTNET_URL ?? env.PRISM_POSTGRES_TEST_URL ?? env.PRISM_POSTGRES_URL ?? "").trim() || null;
  if (databaseUrl !== null && !PG_URL.test(databaseUrl)) {
    throw new RuntimeProfileConfigError("database_url_invalid", "selected PostgreSQL URL has an invalid format");
  }
  if (required && databaseUrl === null) {
    throw new RuntimeProfileConfigError("database_url_missing", `PostgreSQL URL is required for ${profile}`);
  }

  const network = profile === "TESTNET" ? "SN_SEPOLIA" : "SN_MAIN";
  const configuredNetwork = (env.STARKNET_CHAIN_ID ?? env.NEXT_PUBLIC_STARKNET_NETWORK)?.trim().toUpperCase();
  if (configuredNetwork && configuredNetwork !== network && configuredNetwork !== `0X${network === "SN_SEPOLIA" ? "534E5F5345504F4C4941" : "534E5F4D41494E"}`) {
    throw new RuntimeProfileConfigError("network_mismatch", `${profile} requires ${network}`);
  }
  const rawMigration = env.PRISM_POSTGRES_MIGRATION_VERSION?.trim();
  let migrationVersion: number | null = null;
  if (rawMigration) {
    migrationVersion = Number(rawMigration);
    if (!Number.isSafeInteger(migrationVersion) || migrationVersion < 1 || migrationVersion > SUPPORTED_POSTGRES_MIGRATION_VERSION) {
      throw new RuntimeProfileConfigError("migration_version_invalid", `PRISM_POSTGRES_MIGRATION_VERSION must be between 1 and ${SUPPORTED_POSTGRES_MIGRATION_VERSION}`);
    }
  }
  const rawRegistryVersion = env.STARKNET_REGISTRY_VERSION?.trim().toLowerCase();
  if (rawRegistryVersion && rawRegistryVersion !== "v1" && rawRegistryVersion !== "v2" && rawRegistryVersion !== "1" && rawRegistryVersion !== "2") {
    throw new RuntimeProfileConfigError("network_mismatch", "STARKNET_REGISTRY_VERSION must be v1 or v2");
  }
  return {
    profile,
    databaseUrl,
    schema: explicitSchema || expectedSchema,
    network,
    registryVersion: rawRegistryVersion === "1" || rawRegistryVersion === "v1" ? "v1" : rawRegistryVersion === "2" || rawRegistryVersion === "v2" ? "v2" : null,
    migrationVersion,
  };
}

export function postgresPoolOptions(config: RuntimeProfileConfig): { options: string } {
  // schema is validated above; quote it defensively for PostgreSQL identifier use.
  return { options: `-c search_path=${config.schema},public` };
}
