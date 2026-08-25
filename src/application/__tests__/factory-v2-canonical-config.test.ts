import { describe, expect, it } from "vitest";
import {
  CANONICAL_TESTNET_V2,
  createStarknetReadPorts,
  getStarknetProjectionConfig,
} from "../factory";
import { PRISM_EVENT_SELECTORS } from "../../features/prism-operations/adapters/starknet-event-indexer";
import { InMemoryPrismEventsStore } from "../../features/prism-operations/adapters/postgres-prism-events-store";
import { InMemoryEventProjectionCheckpointStore } from "../../features/prism-operations/domain/event-projection-checkpoint";
import { EventProjectionCoordinator } from "../../features/prism-operations/domain/event-projection-coordinator";

const ORIGINAL_ENV = { ...process.env };

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withEnvAsync(overrides: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("canonical SN_SEPOLIA Registry V2 runtime configuration", () => {
  it("pins the deployed V2 registry and starts projection at its deployment block", () => {
    withEnv({
      STARKNET_CHAIN_ID: "SN_SEPOLIA",
      NEXT_PUBLIC_STARKNET_NETWORK: "SN_SEPOLIA",
      STARKNET_REGISTRY_ADDRESS: CANONICAL_TESTNET_V2.registryAddress,
      STARKNET_REGISTRY_VERSION: "v2",
      PRISM_STARKNET_INDEXER_START_BLOCK: undefined,
    }, () => {
      expect(getStarknetProjectionConfig()).toMatchObject({
        network: "SN_SEPOLIA",
        registryAddress: CANONICAL_TESTNET_V2.registryAddress,
        registryVersion: "v2",
        initialFromBlock: CANONICAL_TESTNET_V2.deploymentBlock,
      });
    });
  });

  it("rejects a V2 address, version, network, or start block that is not the deployed canonical scope", () => {
    const base = {
      STARKNET_CHAIN_ID: "SN_SEPOLIA",
      NEXT_PUBLIC_STARKNET_NETWORK: "SN_SEPOLIA",
      STARKNET_REGISTRY_VERSION: "v2",
      STARKNET_REGISTRY_ADDRESS: CANONICAL_TESTNET_V2.registryAddress,
      PRISM_STARKNET_INDEXER_START_BLOCK: String(CANONICAL_TESTNET_V2.deploymentBlock),
    };
    withEnv({ ...base, STARKNET_REGISTRY_ADDRESS: "0x1111" }, () => {
      expect(() => getStarknetProjectionConfig()).toThrow(/canonical_v2_registry_address_mismatch/);
    });
    withEnv({ ...base, STARKNET_REGISTRY_CLASS_HASH: "0x1" }, () => {
      expect(() => getStarknetProjectionConfig()).toThrow(/canonical_v2_class_hash_mismatch/);
    });
    withEnv({ ...base, PRISM_STARKNET_INDEXER_START_BLOCK: "14015841" }, () => {
      expect(() => getStarknetProjectionConfig()).toThrow(/canonical_v2_start_block_mismatch/);
    });
    withEnv({ ...base, STARKNET_CHAIN_ID: "SN_MAIN", NEXT_PUBLIC_STARKNET_NETWORK: "SN_MAIN" }, () => {
      expect(() => getStarknetProjectionConfig()).toThrow(/canonical_v2_network_mismatch/);
    });
    withEnv({ ...base, STARKNET_REGISTRY_VERSION: "v1" }, () => {
      expect(() => getStarknetProjectionConfig()).toThrow(/canonical_v2_requires_v2_version/);
    });
  });

  it("keeps an explicitly scoped V1 legacy registry on its own ABI and start block", () => {
    withEnv({
      STARKNET_CHAIN_ID: "SN_SEPOLIA",
      NEXT_PUBLIC_STARKNET_NETWORK: "SN_SEPOLIA",
      STARKNET_REGISTRY_ADDRESS: "0x67b2f847d7805501c3db79474bdb33e7538825fa0f83aa3cd0083f02ee655c4",
      STARKNET_REGISTRY_VERSION: "v1",
      PRISM_STARKNET_INDEXER_START_BLOCK: undefined,
    }, () => {
      expect(getStarknetProjectionConfig()).toMatchObject({
        registryVersion: "v1",
        initialFromBlock: 0,
      });
    });
  });

  it("passes the canonical V2 deployment block through the factory indexer into the coordinator", async () => {
    const filters: Array<Record<string, unknown>> = [];
    const provider = {
      async callContract() { return ["0x1"]; },
      async getEvents(filter: Record<string, unknown>) {
        filters.push(filter);
        return {
          events: [{
            block_number: CANONICAL_TESTNET_V2.deploymentBlock,
            transaction_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            event_index: 0,
            keys: [PRISM_EVENT_SELECTORS.PrismIdentityCreated, "0x1"],
            data: ["0x2222"],
          }],
          continuation_token: null,
        };
      },
      async getBlockNumber() { return CANONICAL_TESTNET_V2.deploymentBlock; },
    };

    await withEnvAsync({
      STARKNET_RPC_URL: "https://fake.rpc",
      STARKNET_CHAIN_ID: "SN_SEPOLIA",
      NEXT_PUBLIC_STARKNET_NETWORK: "SN_SEPOLIA",
      STARKNET_REGISTRY_ADDRESS: CANONICAL_TESTNET_V2.registryAddress,
      STARKNET_REGISTRY_VERSION: "v2",
      PRISM_STARKNET_INDEXER_START_BLOCK: undefined,
    }, async () => {
      const ports = createStarknetReadPorts({ starknetReadProvider: provider as never });
      expect(ports).toMatchObject({
        registryAddress: CANONICAL_TESTNET_V2.registryAddress,
        registryVersion: "v2",
        initialFromBlock: CANONICAL_TESTNET_V2.deploymentBlock,
      });

      const eventsStore = new InMemoryPrismEventsStore();
      const checkpoints = new InMemoryEventProjectionCheckpointStore();
      const coordinator = new EventProjectionCoordinator({
        registryAddress: ports!.registryAddress,
        network: ports!.network,
        registryVersion: ports!.registryVersion,
        initialFromBlock: ports!.initialFromBlock,
        checkpointStore: checkpoints,
        eventsStore,
        indexer: ports!.indexer,
      });
      const result = await coordinator.runOnce();
      expect(result.advanced).toBe(true);
      expect(result.inserted).toBe(1);
      expect(filters[0]?.from_block).toEqual({ block_number: CANONICAL_TESTNET_V2.deploymentBlock });
      expect(await eventsStore.count({
        registryAddress: CANONICAL_TESTNET_V2.registryAddress,
        network: "SN_SEPOLIA",
        registryVersion: "v2",
      })).toBe(1);
      expect((await checkpoints.get({
        registryAddress: CANONICAL_TESTNET_V2.registryAddress,
        network: "SN_SEPOLIA",
        registryVersion: "v2",
      }))?.scanWatermark).toBe(CANONICAL_TESTNET_V2.deploymentBlock);
    });
  });
});
