// Factory wiring fix verification — covers the three HIGH defects at e022477
// 1) INDEXER shim removed, shared provider
// 2) DUAL READERS canonicalized to StarknetRegistryReadAdapter
// 3) SUBMIT PORT explicit mode, no secret wiring
// Backend only, no live RPC, no secrets, no strk20.json, no frontend.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { StarknetRegistryReadAdapter, StarknetRegistryReadError } from "../../features/prism-operations/adapters/starknet-registry-read";
import { StarknetRegistryReader, StarknetRegistryReaderError } from "../adapters/starknet-registry-reader";
import { StarknetEventIndexerAdapter, PRISM_EVENT_SELECTORS } from "../../features/prism-operations/adapters/starknet-event-indexer";
import { StarknetSubmitAdapter } from "../../features/prism-operations/adapters/starknet-submit";
import { StarknetSubmitAdapterV2 } from "../../features/prism-operations/adapters/starknet-submit-v2";
import { createIsolatedFactory, createIsolatedFactoryWithStarknet, createStarknetReadPorts, getStarknetNetwork, resetFactory, isStarknetSubmitConfiguredForFactory } from "../factory";
import type { Hex } from "../../features/prism-operations/domain/operation";
import { FELT_PRIME } from "../../features/prism-identity/domain/felt-digest";

const REGISTRY = "0x1111";
const CONTROLLER = "0x2222";
const ACCOUNT_ADDR = "0x3333";

function withEnv(overrides: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const effective = { ...overrides };
  // Injected-provider tests must declare their scope explicitly; production code
  // must never inherit this test-only SN_SEPOLIA fixture.
  const hasNetworkOverride = "STARKNET_CHAIN_ID" in effective || "NEXT_PUBLIC_STARKNET_NETWORK" in effective;
  if (effective.STARKNET_RPC_URL !== undefined && effective.STARKNET_REGISTRY_ADDRESS !== undefined && !hasNetworkOverride) {
    effective.STARKNET_CHAIN_ID = "SN_SEPOLIA";
    effective.NEXT_PUBLIC_STARKNET_NETWORK = "SN_SEPOLIA";
  }
  if (effective.STARKNET_RPC_URL !== undefined && effective.STARKNET_REGISTRY_ADDRESS !== undefined && effective.STARKNET_REGISTRY_VERSION === undefined) {
    effective.STARKNET_REGISTRY_VERSION = "v1";
  }
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(effective)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const res = fn();
  const restore = () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v as string;
    }
    for (const k of Object.keys(effective)) if (!(k in prev)) delete process.env[k];
  };
  if (res instanceof Promise) return res.finally(restore);
  restore();
  return res as unknown as Promise<void>;
}

describe("FACTORY_WIRING_FIX — defect 1: INDEXER shared provider (no dead shim)", () => {
  beforeEach(() => resetFactory());
  afterEach(() => resetFactory());

  it("createStarknetReadPorts with shared fake provider proves fetchAllRegistryEvents reaches injected getEvents (no dead shim)", async () => {
    let getEventsCalls = 0;
    const fakeProvider = {
      async callContract() {
        return ["0x0"] as string[];
      },
      async getEvents(filter: unknown) {
        getEventsCalls++;
        void filter;
        return {
          events: [
            {
              block_number: 7,
              transaction_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              event_index: 0,
              keys: [PRISM_EVENT_SELECTORS.PrismIdentityCreated, "0x1"],
              data: [CONTROLLER],
            },
          ],
          continuation_token: null,
        } as never;
      },
      async getTransactionStatus() { return {} as Record<string, unknown>; },
      async getTransactionReceipt() { return {} as Record<string, unknown>; },
      async getBlockNumber() { return 100; },
    };
    await withEnv({ STARKNET_RPC_URL: "https://fake.rpc", STARKNET_REGISTRY_ADDRESS: REGISTRY }, async () => {
      const ports = createStarknetReadPorts({ starknetReadProvider: fakeProvider as never });
      expect(ports).not.toBeNull();
      expect(ports!.provider).toBe(fakeProvider);
      const all = await ports!.indexer.fetchAllRegistryEvents({ fromBlock: 0 });
      expect(getEventsCalls).toBeGreaterThan(0);
      expect(all.events.length).toBe(1);
      expect(all.watermark).toBe(100);
      expect(all.pagesFetched).toBe(1);
    });
  });

  it("factory construction with injected provider does not bind dead shim; observeIndexer also reaches getEvents", async () => {
    const fakeProvider = {
      async callContract() { return ["0x0"] as string[]; },
      async getEvents() {
        return {
          events: [
            {
              block_number: 5,
              transaction_hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              event_index: 0,
              keys: [PRISM_EVENT_SELECTORS.PrismIdentityCreated, "0x2"],
              data: [CONTROLLER],
            },
          ],
          continuation_token: null,
        } as never;
      },
      async getTransactionStatus() { return {} as Record<string, unknown>; },
      async getBlockNumber() { return 100; },
    };
    await withEnv({ STARKNET_RPC_URL: "https://fake.rpc", STARKNET_REGISTRY_ADDRESS: REGISTRY }, async () => {
      const factory = createIsolatedFactoryWithStarknet(1_789_000_000, { starknetReadProvider: fakeProvider as never });
      expect(factory.isStarknetConfigured).toBe(true);
      expect(factory.eventIndexerAdapter).not.toBeNull();
      // shared provider is the injected one
      expect(factory.starknetReadProvider).toBe(fakeProvider);
      const idx = factory.eventIndexerAdapter as StarknetEventIndexerAdapter;
      const page = await idx.fetchRegistryEvents({ fromBlock: 0 });
      expect(page.events.length).toBe(1);
      // observe path also uses getEvents
      const obs = await idx.observeIndexer("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hex);
      expect(obs).not.toBeNull();
      expect(obs!.eventObserved).toBe(true);
    });
  });

  it("provider missing getEvents fails closed at wiring, not silently shimmed", async () => {
    const badProvider = {
      async callContract() { return ["0x0"] as string[]; },
      // no getEvents
    };
    await withEnv({ STARKNET_RPC_URL: "https://fake.rpc", STARKNET_REGISTRY_ADDRESS: REGISTRY }, async () => {
      expect(() => createStarknetReadPorts({ starknetReadProvider: badProvider as never })).toThrow(/requires_getEvents/);
    });
  });

  it("provider missing callContract fails closed", async () => {
    const badProvider = {
      async getEvents() { return { events: [], continuation_token: null } as never; },
    };
    await withEnv({ STARKNET_RPC_URL: "https://fake.rpc", STARKNET_REGISTRY_ADDRESS: REGISTRY }, async () => {
      expect(() => createStarknetReadPorts({ starknetReadProvider: badProvider as never })).toThrow(/missing_callContract/);
    });
  });
});

describe("FACTORY_WIRING_FIX — network projection scope is explicit", () => {
  const fakeProvider = {
    async callContract() { return ["0x0"] as string[]; },
    async getEvents() {
      return {
        events: [{
          block_number: 7,
          transaction_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          event_index: 0,
          keys: [PRISM_EVENT_SELECTORS.PrismIdentityCreated, "0x1"],
          data: [CONTROLLER],
        }],
        continuation_token: null,
      } as never;
    },
    async getBlockNumber() { return 7; },
  };

  it("derives SN_MAIN from explicit chain/network config and scopes indexed events", async () => {
    await withEnv({
      STARKNET_RPC_URL: "https://fake.rpc",
      STARKNET_REGISTRY_ADDRESS: REGISTRY,
      STARKNET_CHAIN_ID: "SN_MAIN",
      NEXT_PUBLIC_STARKNET_NETWORK: "SN_MAIN",
    }, async () => {
      expect(getStarknetNetwork()).toBe("SN_MAIN");
      const ports = createStarknetReadPorts({ starknetReadProvider: fakeProvider as never });
      const result = await ports!.indexer.fetchRegistryEvents({ fromBlock: 0 });
      expect(result.events[0]?.network).toBe("SN_MAIN");
    });
  });

  it("derives SN_SEPOLIA from explicit chain/network config and scopes indexed events", async () => {
    await withEnv({
      STARKNET_RPC_URL: "https://fake.rpc",
      STARKNET_REGISTRY_ADDRESS: REGISTRY,
      STARKNET_CHAIN_ID: "SN_SEPOLIA",
      NEXT_PUBLIC_STARKNET_NETWORK: "SN_SEPOLIA",
    }, async () => {
      expect(getStarknetNetwork()).toBe("SN_SEPOLIA");
      const ports = createStarknetReadPorts({ starknetReadProvider: fakeProvider as never });
      const result = await ports!.indexer.fetchRegistryEvents({ fromBlock: 0 });
      expect(result.events[0]?.network).toBe("SN_SEPOLIA");
    });
  });

  it("fails closed on inconsistent configured chain/network values", async () => {
    await withEnv({
      STARKNET_RPC_URL: "https://fake.rpc",
      STARKNET_REGISTRY_ADDRESS: REGISTRY,
      STARKNET_CHAIN_ID: "SN_MAIN",
      NEXT_PUBLIC_STARKNET_NETWORK: "SN_SEPOLIA",
    }, async () => {
      expect(() => createStarknetReadPorts({ starknetReadProvider: fakeProvider as never })).toThrow(/starknet_network_config_mismatch/);
    });
  });

  it("fails closed on unknown configured network values", async () => {
    await withEnv({
      STARKNET_RPC_URL: "https://fake.rpc",
      STARKNET_REGISTRY_ADDRESS: REGISTRY,
      STARKNET_CHAIN_ID: "SN_DEVNET",
      NEXT_PUBLIC_STARKNET_NETWORK: undefined,
    }, async () => {
      expect(() => createStarknetReadPorts({ starknetReadProvider: fakeProvider as never })).toThrow(/unknown_starknet_network/);
    });
  });

  it("fails closed when no explicit network source is configured", async () => {
    await withEnv({
      STARKNET_RPC_URL: "https://fake.rpc",
      STARKNET_REGISTRY_ADDRESS: REGISTRY,
      STARKNET_CHAIN_ID: undefined,
      NEXT_PUBLIC_STARKNET_NETWORK: undefined,
    }, async () => {
      expect(() => createStarknetReadPorts({ starknetReadProvider: fakeProvider as never })).toThrow(/starknet_network_required/);
    });
  });
});

describe("FACTORY_WIRING_FIX — defect 2: DUAL READERS canonicalized", () => {
  const REG = REGISTRY;
  function readerReturning(result: string[]) {
    return { callContract: async () => result };
  }

  it("malformed prism:001 throws ERR-002 identically via canonical and wrapper (no silent null)", async () => {
    const canonical = new StarknetRegistryReadAdapter({ reader: readerReturning(["0x0"]), registryAddress: REG });
    const wrapped = new StarknetRegistryReader({ rpcUrl: "https://fake", registryAddress: REG, reader: readerReturning(["0x0"]) as never });
    await expect(canonical.getIdentity("prism:001")).rejects.toMatchObject({ code: "ERR-002" });
    await expect(wrapped.getIdentity("prism:001")).rejects.toMatchObject({ code: "ERR-002" });
    await expect(canonical.getIdentity("prism:001")).rejects.toBeInstanceOf(StarknetRegistryReadError);
    await expect(wrapped.getIdentity("prism:001")).rejects.toBeInstanceOf(StarknetRegistryReadError);
    // Also via resolve path
    await expect(canonical.resolve("prism:001", "BASE")).rejects.toMatchObject({ code: "ERR-002" });
    await expect(wrapped.resolve("prism:001", "BASE")).rejects.toMatchObject({ code: "ERR-002" });
  });

  it("malformed prism:P1 throws ERR-002 identically", async () => {
    const canonical = new StarknetRegistryReadAdapter({ reader: readerReturning(["0x0"]), registryAddress: REG });
    const wrapped = new StarknetRegistryReader({ rpcUrl: "https://fake", registryAddress: REG, reader: readerReturning(["0x0"]) as never });
    await expect(canonical.getIdentity("prism:P1")).rejects.toMatchObject({ code: "ERR-002" });
    await expect(wrapped.getIdentity("prism:P1")).rejects.toMatchObject({ code: "ERR-002" });
  });

  it("overflow prismId beyond FELT_PRIME throws ERR-023 identically", async () => {
    const overflow = `prism:${FELT_PRIME.toString()}`; // exactly prime => overflow
    const canonical = new StarknetRegistryReadAdapter({ reader: readerReturning(["0x0"]), registryAddress: REG });
    const wrapped = new StarknetRegistryReader({ rpcUrl: "https://fake", registryAddress: REG, reader: readerReturning(["0x0"]) as never });
    await expect(canonical.getIdentity(overflow)).rejects.toMatchObject({ code: "ERR-023" });
    await expect(wrapped.getIdentity(overflow)).rejects.toMatchObject({ code: "ERR-023" });
  });

  it("malformed controller in response throws ERR-002 identically (no fabricated identity)", async () => {
    const bad = { callContract: async () => ["0x0", "not-hex", "10", "0"] };
    const canonical = new StarknetRegistryReadAdapter({ reader: bad, registryAddress: REG });
    const wrapped = new StarknetRegistryReader({ rpcUrl: "https://fake", registryAddress: REG, reader: bad as never });
    await expect(canonical.getIdentity("prism:1")).rejects.toMatchObject({ code: "ERR-002" });
    await expect(wrapped.getIdentity("prism:1")).rejects.toMatchObject({ code: "ERR-002" });
  });

  it("bare-struct Some without tag handled identically (both return controller)", async () => {
    const good = { callContract: async () => [CONTROLLER, "99", "0"] };
    const canonical = new StarknetRegistryReadAdapter({ reader: good, registryAddress: REG });
    const wrapped = new StarknetRegistryReader({ rpcUrl: "https://fake", registryAddress: REG, reader: good as never });
    const a = await canonical.getIdentity("prism:1");
    const b = await wrapped.getIdentity("prism:1");
    expect(a?.controller).toBe(b?.controller);
    expect(a?.createdAtBlock).toBe(99);
  });

  it("factory registryReadPort with injected provider uses canonical semantics (malformed prism throws, not silent null)", async () => {
    const fakeProvider = {
      async callContract() { return ["0x0"] as string[]; },
      async getEvents() { return { events: [], continuation_token: null } as never; },
      async getBlockNumber() { return 100; },
    };
    await withEnv({ STARKNET_RPC_URL: "https://fake.rpc", STARKNET_REGISTRY_ADDRESS: REG }, async () => {
      const factory = createIsolatedFactoryWithStarknet(1_789_000_000, { starknetReadProvider: fakeProvider as never });
      await expect(factory.registryReadPort.getIdentity("prism:001")).rejects.toMatchObject({ code: "ERR-002" });
      await expect(factory.registryReadPort.resolve("prism:P1", "BASE")).rejects.toMatchObject({ code: "ERR-002" });
    });
  });
});

describe("FACTORY_WIRING_FIX — defect 3: SUBMIT PORT explicit semantics", () => {
  beforeEach(() => resetFactory());
  afterEach(() => resetFactory());

  it("default factory is TEST_DOUBLE_X2, isStarknetSubmitConfigured false, never reads private keys", () => {
    const f = createIsolatedFactory(1_789_000_000);
    expect(f.submitPortMode).toBe("TEST_DOUBLE_X2");
    expect(f.isStarknetSubmitConfigured).toBe(false);
    expect(isStarknetSubmitConfiguredForFactory(f)).toBe(false);
    // env values never printed: no property exposes secret
    expect((f as unknown as Record<string, unknown>).privateKey).toBeUndefined();
    expect((f as unknown as Record<string, unknown>).STARKNET_PRIVATE_KEY).toBeUndefined();
  });

  it("injected StarknetSubmitAdapter makes mode STARKNET_INJECTED and isStarknetSubmitConfigured true", () => {
    const fakeAccount = { address: ACCOUNT_ADDR, async execute() { return { transaction_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }; } };
    const submitPort = new StarknetSubmitAdapter({ account: fakeAccount as never, registryAddress: REGISTRY });
    const f = createIsolatedFactory(1_789_000_000, { submitPort, submitPortRegistryVersion: "v1" });
    expect(f.submitPortMode).toBe("STARKNET_INJECTED");
    expect(f.isStarknetSubmitConfigured).toBe(true);
    expect(f.submitPort).toBe(submitPort);
  });

  it("production with Starknet read config but TEST_DOUBLE submit reports submit_unconfigured via mode (fail-closed signal)", async () => {
    const fakeProvider = {
      async callContract() { return ["0x0"] as string[]; },
      async getEvents() { return { events: [], continuation_token: null } as never; },
      async getBlockNumber() { return 100; },
    };
    await withEnv({ STARKNET_RPC_URL: "https://fake.rpc", STARKNET_REGISTRY_ADDRESS: REGISTRY }, async () => {
      const f = createIsolatedFactoryWithStarknet(1_789_000_000, { starknetReadProvider: fakeProvider as never });
      expect(f.isStarknetConfigured).toBe(true);
      // Still test double — explicit signal that submit is not live
      expect(f.submitPortMode).toBe("TEST_DOUBLE_X2");
      expect(f.isStarknetSubmitConfigured).toBe(false);
      // Caller can check and report submit_unconfigured rather than assuming live
      const submitUnconfigured = f.isStarknetConfigured && !f.isStarknetSubmitConfigured;
      expect(submitUnconfigured).toBe(true);
    });
  });

  it("requires submit-port ABI version to match configured registry version", async () => {
    const fakeProvider = {
      async callContract() { return ["0x0"] as string[]; },
      async getEvents() { return { events: [], continuation_token: null } as never; },
      async getBlockNumber() { return 100; },
    };
    const submitPort = {
      async submitCreateIdentity() { return { txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }; },
      async submitBind() { return { txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }; },
      async submitRevoke() { return { txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }; },
    };
    await withEnv({ STARKNET_RPC_URL: "https://fake.rpc", STARKNET_REGISTRY_ADDRESS: REGISTRY, STARKNET_REGISTRY_VERSION: "v2" }, async () => {
      expect(() => createIsolatedFactoryWithStarknet(1_789_000_000, { starknetReadProvider: fakeProvider as never, submitPort: submitPort as never, submitPortRegistryVersion: "v1" })).toThrow(/submit_port_registry_version_mismatch/);
      const factory = createIsolatedFactoryWithStarknet(1_789_000_000, { starknetReadProvider: fakeProvider as never, submitPort: submitPort as never, submitPortRegistryVersion: "v2", submitPortRegistryAddress: REGISTRY });
      expect(factory.submitPort).toBe(submitPort);
      expect(factory.isStarknetSubmitConfigured).toBe(true);
    });
  });

  it("requires an injected submit adapter registry address to match the configured read registry", async () => {
    const fakeProvider = {
      async callContract() { return ["0x0"] as string[]; },
      async getEvents() { return { events: [], continuation_token: null } as never; },
      async getBlockNumber() { return 100; },
    };
    const account = { address: ACCOUNT_ADDR, async execute() { return { transaction_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }; } };
    await withEnv({ STARKNET_RPC_URL: "https://fake.rpc", STARKNET_REGISTRY_ADDRESS: REGISTRY, STARKNET_REGISTRY_VERSION: "v1" }, async () => {
      const matching = new StarknetSubmitAdapter({ account, registryAddress: REGISTRY });
      const factory = createIsolatedFactoryWithStarknet(1_789_000_000, {
        starknetReadProvider: fakeProvider as never,
        submitPort: matching,
        submitPortRegistryVersion: "v1",
      });
      expect(factory.submitPort).toBe(matching);

      const mismatched = new StarknetSubmitAdapter({ account, registryAddress: "0x4444" });
      expect(() => createIsolatedFactoryWithStarknet(1_789_000_000, {
        starknetReadProvider: fakeProvider as never,
        submitPort: mismatched,
        submitPortRegistryVersion: "v1",
      })).toThrow(/submit_port_registry_address_mismatch/);

      const missingAddress = {
        registryVersion: "v1" as const,
        async submitCreateIdentity() { return { txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }; },
        async submitBind() { return { txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }; },
        async submitRevoke() { return { txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }; },
      };
      expect(() => createIsolatedFactoryWithStarknet(1_789_000_000, {
        starknetReadProvider: fakeProvider as never,
        submitPort: missingAddress as never,
        submitPortRegistryVersion: "v1",
      })).toThrow(/submit_port_registry_address_required/);
    });
  });

  it("keeps V1/V2 submit adapter separation while matching the configured registry address", async () => {
    const fakeProvider = {
      async callContract() { return ["0x0"] as string[]; },
      async getEvents() { return { events: [], continuation_token: null } as never; },
      async getBlockNumber() { return 100; },
    };
    const account = { address: ACCOUNT_ADDR, async execute() { return { transaction_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }; } };
    const v2 = new StarknetSubmitAdapterV2({ account, registryAddress: REGISTRY });
    await withEnv({ STARKNET_RPC_URL: "https://fake.rpc", STARKNET_REGISTRY_ADDRESS: REGISTRY, STARKNET_REGISTRY_VERSION: "v2" }, async () => {
      const factory = createIsolatedFactoryWithStarknet(1_789_000_000, {
        starknetReadProvider: fakeProvider as never,
        submitPort: v2,
        submitPortRegistryVersion: "v2",
      });
      expect(factory.submitPort).toBe(v2);
      expect(factory.submitPort.registryVersion).toBe("v2");
      expect((factory.submitPort as { registryAddress?: string }).registryAddress).toBe(REGISTRY);
    });
  });

  it("rejects a concrete V2 submit adapter mislabeled as V1", () => {
    const submitPort = new StarknetSubmitAdapterV2({
      account: { address: ACCOUNT_ADDR, async execute() { return { transaction_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }; } },
      registryAddress: REGISTRY,
    });
    expect(() => createIsolatedFactory(1_789_000_000, { submitPort, submitPortRegistryVersion: "v1" })).toThrow(/submit_port_abi_version_mismatch/);
  });

  it("missing submit config: factory does not secretly wire private keys from env", async () => {
    await withEnv({ STARKNET_PRIVATE_KEY: "0xdead", STARKNET_RPC_URL: "https://fake.rpc", STARKNET_REGISTRY_ADDRESS: REGISTRY }, async () => {
      const fakeProvider = {
        async callContract() { return ["0x0"] as string[]; },
        async getEvents() { return { events: [], continuation_token: null } as never; },
        async getBlockNumber() { return 100; },
      };
      const f = createIsolatedFactoryWithStarknet(1_789_000_000, { starknetReadProvider: fakeProvider as never });
      expect(f.isStarknetSubmitConfigured).toBe(false);
      expect(f.submitPortMode).toBe("TEST_DOUBLE_X2");
      // Ensure env private key was not consumed — submitPort is still InMemoryRegistry, not StarknetSubmitAdapter
      expect(f.submitPort.constructor.name).toBe("InMemoryRegistry");
    });
  });

  it("preserves injected StarknetSubmitAdapter path: submitCreateIdentity via injected account works", async () => {
    const fakeAccount = { address: ACCOUNT_ADDR, async execute(calls: unknown[]) { void calls; return { transaction_hash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }; } };
    const submitPort = new StarknetSubmitAdapter({ account: fakeAccount as never, registryAddress: REGISTRY });
    const f = createIsolatedFactory(1_789_000_000, { submitPort, submitPortRegistryVersion: "v1" });
    const res = await f.submitPort.submitCreateIdentity({ operationId: "op-1", controllerAddress: ACCOUNT_ADDR });
    expect(res.txHash).toBe("0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");
  });

  it("never prints env values: factory creation does not log secrets", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    try {
      await withEnv({ STARKNET_RPC_URL: "https://secret.rpc/xyz", STARKNET_REGISTRY_ADDRESS: REGISTRY }, async () => {
        const fakeProvider = {
          async callContract() { return ["0x0"] as string[]; },
          async getEvents() { return { events: [], continuation_token: null } as never; },
          async getBlockNumber() { return 100; },
        };
        createIsolatedFactoryWithStarknet(1_789_000_000, { starknetReadProvider: fakeProvider as never });
      });
      const joined = logs.join("\n");
      expect(joined).not.toContain("secret.rpc");
    } finally {
      console.log = origLog;
    }
  });
});
