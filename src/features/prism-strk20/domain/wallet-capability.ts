// Pure capability detection for STRK20 consumer Wallet API route.
// Authority: docs/STRK20_CONTEXT capability detection + STRK20_PRIVACY_PROFILE least-privilege.
// Must only use supportedWalletApi / supportedSpecs version queries; never balance reads.

const STRK20_MINIMUM_API_VERSION = [0, 10, 3] as const;

function parseVersion(value: string): number[] | null {
  const match = value.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function compareVersions(left: number[], right: readonly number[]): number {
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) return l - r;
  }
  return 0;
}

/**
 * Pure STRK20 capability check: true when any apiVersion or spec >= 0.10.3.
 * Never touches balances, viewing keys, or private state.
 */
export function supportsStrk20(apiVersions: readonly string[], specs: readonly string[]): boolean {
  return [...apiVersions, ...specs].some((v) => {
    const p = parseVersion(v);
    return p ? compareVersions(p, STRK20_MINIMUM_API_VERSION) >= 0 : false;
  });
}

export type WalletEnvironment = "SN_MAIN" | "SN_SEPOLIA" | "UNKNOWN";
export type ExpectedWalletEnvironment = Exclude<WalletEnvironment, "UNKNOWN">;

export function classifyWalletEnvironment(
  chainId: string,
  chainIds: { mainnet: string; sepolia: string },
): WalletEnvironment {
  const n = chainId.trim().toUpperCase();
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
