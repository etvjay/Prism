// Gated live vertical test: application factory → Starknet read/indexer → Postgres projection.
// No invoke/broadcast path exists in this test.

import { afterEach, describe, expect, it } from "vitest";
import { closeFactory, getAppFactory, resetFactory } from "../factory";

const TEST_URL = process.env.PRISM_POSTGRES_TEST_URL;
const RPC_URL = process.env.STARKNET_RPC_URL;
const REGISTRY = process.env.STARKNET_REGISTRY_ADDRESS;
const SCOPE = REGISTRY ? { registryAddress: REGISTRY, network: "SN_SEPOLIA", registryVersion: (process.env.STARKNET_REGISTRY_VERSION === "2" ? "v2" : "v1") as "v1" | "v2" } : null;
const suite = TEST_URL && RPC_URL && REGISTRY ? describe : describe.skip;

suite("live durable projection through application factory", () => {
  afterEach(async () => {
    await closeFactory();
    resetFactory();
  });

  it("projects the observed SN_SEPOLIA registry event into Postgres", async () => {
    const factory = await getAppFactory();
    expect(factory.isPostgres).toBe(true);
    expect(factory.isStarknetConfigured).toBe(true);
    expect(factory.eventProjectionCoordinator).not.toBeNull();
    const result = await factory.eventProjectionCoordinator!.runOnce();
    expect(result.advanced).toBe(true);
    expect(result.scanWatermark).not.toBeNull();
    expect(result.pagesFetched).toBeGreaterThan(0);
    expect(await factory.prismEventsStore!.count(SCOPE!)).toBeGreaterThanOrEqual(1);
    expect((await factory.projectionCheckpointStore!.get(SCOPE!))?.scanWatermark).toBe(result.scanWatermark);
  }, 120_000);
});
