export type WalletEnvironment = "SN_MAIN" | "SN_SEPOLIA" | "UNKNOWN";

export type ExpectedWalletEnvironment = Exclude<WalletEnvironment, "UNKNOWN">;

const STRK20_MINIMUM_API_VERSION = [0, 10, 3];

function parseVersion(value: string): number[] | null {
  const match = value.match(/(\d+)\.(\d+)(?:\.(\d+))?/);

  if (!match) return null;

  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function compareVersions(left: number[], right: number[]) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftPart = left[index] ?? 0;
    const rightPart = right[index] ?? 0;

    if (leftPart !== rightPart) return leftPart - rightPart;
  }

  return 0;
}

export function supportsStrk20(apiVersions: readonly string[], specs: readonly string[]) {
  return [...apiVersions, ...specs].some((value) => {
    const parsed = parseVersion(value);
    return parsed ? compareVersions(parsed, STRK20_MINIMUM_API_VERSION) >= 0 : false;
  });
}

export function classifyWalletEnvironment(
  chainId: string,
  chainIds: { mainnet: string; sepolia: string },
): WalletEnvironment {
  const normalized = chainId.trim().toUpperCase();
  const mainnetIds = ["SN_MAIN", chainIds.mainnet.toUpperCase()];
  const sepoliaIds = ["SN_SEPOLIA", chainIds.sepolia.toUpperCase()];

  if (mainnetIds.includes(normalized)) return "SN_MAIN";
  if (sepoliaIds.includes(normalized)) return "SN_SEPOLIA";
  return "UNKNOWN";
}

export function getExpectedWalletEnvironment(configuredValue?: string): ExpectedWalletEnvironment {
  return configuredValue?.trim().toUpperCase() === "SN_MAIN" ? "SN_MAIN" : "SN_SEPOLIA";
}
