import { describe, expect, it } from "vitest";
import { buildM3DryRunDeps, runM3DryRunSequence, validateM3PublicConfig } from "../m3-base-sequence-runner";
import { StarknetSubmitAdapterV2 } from "../../prism-operations/adapters/starknet-submit-v2";
import type { InMemoryRegistry } from "../../../application/adapters/in-memory-registry";
import { PrismApplicationService } from "../../../application/prism-application";

const CONTROLLER = "0x1111";
const V2_REGISTRY = "0x2222";

describe("M3 V2 application boundary", () => {
  it("runs the application dry-run with exact V2 digest semantics", async () => {
    const deps = await buildM3DryRunDeps({});
    const registry = deps.registry as unknown as InMemoryRegistry & { setDigestMode(mode: "v1" | "v2"): void };
    registry.setDigestMode("v2");
    deps.submitPort = new StarknetSubmitAdapterV2({
      registryAddress: V2_REGISTRY,
      account: {
        address: CONTROLLER,
        async execute() { return { transaction_hash: "0x1" }; },
      },
    });
    const config = validateM3PublicConfig({
      chainId: 84532,
      domain: "prism.example",
      venue: "BASE",
      prismId: "prism:1",
      executionAccount: "0x1111111111111111111111111111111111111111",
      controllerAddress: CONTROLLER,
      registryAddress: V2_REGISTRY,
      registryVersion: "v2",
      liveRequested: false,
    }, 84532);
    const result = await runM3DryRunSequence(config, deps);
    expect(result.verdict).toBe("M3_BASE_SEQUENCE_RUNNER_READY_X2");
    expect(result.config.registryVersion).toBe("v2");
    const bind = result.steps.find((step) => step.step === "bind (submitted)");
    expect(bind?.detail).toMatch(/u256 low\/high/);
    expect(bind?.calldata).toHaveLength(5);
  });

  it("rejects a missing application registry version instead of silently selecting V1", async () => {
    const deps = await buildM3DryRunDeps({});
    expect(() => new PrismApplicationService({
      challengeService: deps.challengeService,
      operationStore: deps.operationStore,
      registry: deps.registry,
      submitPort: deps.submitPort,
      registryVersion: undefined as never,
      clock: deps.clock,
      idGenerator: deps.idGenerator,
    })).toThrow(/registryVersion must be explicitly v1 or v2/);
  });

  it("rejects an invalid application registry version instead of silently selecting V1", async () => {
    const deps = await buildM3DryRunDeps({});
    expect(() => new PrismApplicationService({
      challengeService: deps.challengeService,
      operationStore: deps.operationStore,
      registry: deps.registry,
      submitPort: deps.submitPort,
      registryVersion: "v3" as never,
      clock: deps.clock,
      idGenerator: deps.idGenerator,
    })).toThrow(/registryVersion must be explicitly v1 or v2/);
  });
});
