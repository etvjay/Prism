import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

const RUNNER = "ops/testnet/m3-base-sequence.runner.mjs";

function runRunner(args: string[]) {
  const env = { ...process.env };
  delete env.STARKNET_REGISTRY_VERSION;
  return spawnSync(process.execPath, [RUNNER, ...args], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
}

describe("M3 CLI registryVersion validation", () => {
  it("rejects an omitted registryVersion before dry-run preflight", () => {
    const result = runRunner(["--dry-run", "--env", "testnet"]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/registryVersion required.*live and dry-run/);
  });

  it("rejects an invalid registryVersion before dry-run preflight", () => {
    const result = runRunner(["--dry-run", "--env", "testnet", "--registry-version", "v3"]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/invalid --registry-version.*v3/);
  });

  it.each(["v1", "v2", "1", "2"])("accepts explicit registryVersion %s in CLI validation", (version) => {
    const result = runRunner(["--help", "--env", "testnet", "--registry-version", version]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/registry-version v1\|v2/);
  });
});
