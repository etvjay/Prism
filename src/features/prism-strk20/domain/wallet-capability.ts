// Pure capability detection for STRK20 consumer Wallet API route.
// Authority: docs/STRK20_CONTEXT capability detection + STRK20_PRIVACY_PROFILE least-privilege.
// Must only use supportedWalletApi / supportedSpecs version queries; never balance reads.

const STRK20_MINIMUM_API_VERSION = [0, 10, 3] as const;

type ParsedVersion = {
  parts: [number, number, number];
  prerelease: boolean;
};

function parseVersion(value: unknown): ParsedVersion | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+)\.(\d+)(?:\.(\d+))?(?:-[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  const parts: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
  if (parts.some((part) => !Number.isSafeInteger(part) || part < 0)) return null;
  return { parts, prerelease: value.includes("-") };
}

function compareVersions(left: readonly number[], right: readonly number[]): number {
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) return l - r;
  }
  return 0;
}

function isAtLeastMinimum(version: ParsedVersion): boolean {
  const comparison = compareVersions(version.parts, STRK20_MINIMUM_API_VERSION);
  // A release candidate is below the corresponding stable release.
  return comparison > 0 || (comparison === 0 && !version.prerelease);
}

export type Strk20CapabilityStatus = "supported" | "unsupported" | "unknown";

/**
 * Classify a provider capability response without treating missing or malformed
 * answers as a definitive unsupported wallet. The wallet standard returns
 * version arrays; an empty or malformed response is an observation failure.
 */
export function classifyStrk20Capability(
  apiVersions: readonly unknown[],
  specs: readonly unknown[],
): Strk20CapabilityStatus {
  const values = [...apiVersions, ...specs];
  if (values.length === 0) return "unknown";
  const parsed = values.map(parseVersion);
  if (parsed.some((version) => version === null)) return "unknown";
  return parsed.some((version) => isAtLeastMinimum(version!)) ? "supported" : "unsupported";
}

/**
 * Pure STRK20 capability check: true when any valid apiVersion or spec is >=0.10.3.
 * Never touches balances, viewing keys, or private state.
 */
export function supportsStrk20(apiVersions: readonly string[], specs: readonly string[]): boolean {
  return classifyStrk20Capability(apiVersions, specs) === "supported";
}

export type WalletEnvironment = "SN_MAIN" | "SN_SEPOLIA" | "UNKNOWN";
export type ExpectedWalletEnvironment = Exclude<WalletEnvironment, "UNKNOWN">;

function normalizeKnownNetworkId(chainId: string): string {
  const normalized = chainId.trim().toUpperCase();
  if (/^0X[0-9A-F]+$/.test(normalized) && normalized.length % 2 === 0) {
    try {
      const bytes = normalized.slice(2).match(/.{2}/g) ?? [];
      const decoded = String.fromCharCode(...bytes.map((byte) => Number.parseInt(byte, 16))).toUpperCase();
      if (decoded === "SN_MAIN" || decoded === "SN_SEPOLIA") return decoded;
    } catch {
      // Fall through to UNKNOWN for malformed or unsupported encodings.
    }
  }
  return normalized;
}

export function classifyWalletEnvironment(
  chainId: string,
  chainIds: { mainnet: string; sepolia: string },
): WalletEnvironment {
  const n = normalizeKnownNetworkId(chainId);
  const mainIds = ["SN_MAIN", chainIds.mainnet.toUpperCase()];
  const sepoliaIds = ["SN_SEPOLIA", chainIds.sepolia.toUpperCase()];
  if (mainIds.includes(n)) return "SN_MAIN";
  if (sepoliaIds.includes(n)) return "SN_SEPOLIA";
  return "UNKNOWN";
}

export function getExpectedWalletEnvironment(v?: string): ExpectedWalletEnvironment {
  return v?.trim().toUpperCase() === "SN_MAIN" ? "SN_MAIN" : "SN_SEPOLIA";
}

export interface CapabilityDetectionInput {
  apiVersions: readonly string[];
  specs: readonly string[];
  chainId: string;
  expectedChainId: string;
}

export interface CapabilityResult {
  capable: boolean;
  environment: WalletEnvironment;
  mismatch: boolean;
}

/**
 * Pure composite capability + environment check.
 * No I/O, no balance reads, no viewing keys.
 */
export function detectCapability(input: CapabilityDetectionInput): CapabilityResult {
  const capable = supportsStrk20(input.apiVersions, input.specs);
  const env = classifyWalletEnvironment(input.chainId, {
    mainnet: "SN_MAIN",
    sepolia: "SN_SEPOLIA",
  });
  // expectedChainId is "SN_MAIN" | "SN_SEPOLIA" string
  const expected = getExpectedWalletEnvironment(input.expectedChainId);
  // Need to map expected string to environment comparison; classify already does SN_MAIN/SEPOLIA
  const mismatch = env !== expected;
  return { capable, environment: env, mismatch };
}
