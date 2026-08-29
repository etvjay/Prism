import { describe, expect, it } from "vitest";
import { InMemoryPrismEventsStore } from "../adapters/postgres-prism-events-store";
import type { RegistryCanonicalEvent, RegistryEventScopeInput } from "../domain/event-indexer";
import type { Hex } from "../domain/operation";
import { normalizeStarknetContractAddress } from "../../prism-identity/domain/starknet-boundary";

const TX: Hex = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TX_B: Hex = `0x${"b".repeat(64)}`;
const REGISTRY_A = "0x1111111111111111111111111111111111111111";
const REGISTRY_B = "0x2222222222222222222222222222222222222222";
const SCOPE_A_V1: RegistryEventScopeInput = { registryAddress: REGISTRY_A, network: "SN_SEPOLIA", registryVersion: "v1" };
const SCOPE_A_V2: RegistryEventScopeInput = { registryAddress: REGISTRY_A, network: "SN_SEPOLIA", registryVersion: "v2" };
const SCOPE_B_V1: RegistryEventScopeInput = { registryAddress: REGISTRY_B, network: "SN_SEPOLIA", registryVersion: "v1" };

const EVENT: RegistryCanonicalEvent = {
  txHash: TX,
  eventIndex: 0,
  blockNumber: 10,
  kind: "PrismIdentityCreated",
  payload: { prismId: "0x1", controller: "0x2" },
};

describe("PrismEventsStore scoped correlation", () => {
  it("does not deduplicate same tx_hash+event_index across registry or ABI version scopes", async () => {
    const store = new InMemoryPrismEventsStore();

    expect(await store.insert(EVENT, SCOPE_A_V1)).toEqual({ inserted: true, duplicate: false });
    expect(await store.insert(EVENT, SCOPE_A_V2)).toEqual({ inserted: true, duplicate: false });
    expect(await store.insert(EVENT, SCOPE_B_V1)).toEqual({ inserted: true, duplicate: false });

    expect(await store.count(SCOPE_A_V1)).toBe(1);
    expect(await store.count(SCOPE_A_V2)).toBe(1);
    expect(await store.count(SCOPE_B_V1)).toBe(1);
    expect((await store.get(TX, 0, SCOPE_A_V1))?.registryVersion).toBe("v1");
    expect((await store.get(TX, 0, SCOPE_A_V2))?.registryVersion).toBe("v2");
    expect((await store.get(TX, 0, SCOPE_B_V1))?.registryAddress).toBe(normalizeStarknetContractAddress(REGISTRY_B));
  });

  it("fails closed instead of exposing an unscoped historical projection", async () => {
    const store = new InMemoryPrismEventsStore();
    await expect(store.insert(EVENT)).rejects.toMatchObject({ code: "scope_required" });
    await expect(store.count()).rejects.toMatchObject({ code: "scope_required" });
    await expect(store.listOrdered()).rejects.toMatchObject({ code: "scope_required" });
  });

  it("keeps normal scoped ordering and block-range queries deterministic", async () => {
    const store = new InMemoryPrismEventsStore();
    await store.insert({ ...EVENT, txHash: TX_B, blockNumber: 12 }, SCOPE_A_V1);
    await store.insert({ ...EVENT, txHash: "0x9999999999999999999999999999999999999999999999999999999999999999" as Hex, blockNumber: 10 }, SCOPE_A_V1);
    await store.insert({ ...EVENT, txHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as Hex, blockNumber: 11 }, SCOPE_B_V1);

    expect((await store.listOrdered(SCOPE_A_V1)).map((event) => [event.blockNumber, event.txHash])).toEqual([
      [10, "0x9999999999999999999999999999999999999999999999999999999999999999"],
      [12, TX_B],
    ]);
    expect((await store.listByBlockRange(11, 12, SCOPE_A_V1)).map((event) => event.blockNumber)).toEqual([12]);
  });

  it("iterates deterministic scoped keyset pages without crossing an upper watermark", async () => {
    const store = new InMemoryPrismEventsStore();
    const firstEvent = { ...EVENT, txHash: TX_B, blockNumber: 12 };
    const secondEvent = { ...EVENT, txHash: "0x9999999999999999999999999999999999999999999999999999999999999999" as Hex, blockNumber: 10 };
    await store.insert(firstEvent, SCOPE_A_V1);
    await store.insert(secondEvent, SCOPE_A_V1);
    await store.insert({ ...EVENT, txHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as Hex, blockNumber: 11 }, SCOPE_B_V1);

    const first = await store.listOrderedPage(SCOPE_A_V1, { limit: 1, toBlock: 11 });
    expect(first.events).toHaveLength(1);
    expect(first.events[0]).toMatchObject({ txHash: secondEvent.txHash, blockNumber: 10, eventIndex: 0 });
    expect(first.nextCursor).toMatchObject({ blockNumber: 10, eventIndex: 0 });
    const afterFirst = await store.listOrderedPage(SCOPE_A_V1, { limit: 1, toBlock: 11, after: first.nextCursor });
    expect(afterFirst.events).toHaveLength(0);
    expect(afterFirst.nextCursor).toBeNull();

    const unbounded = await store.listOrderedPage(SCOPE_A_V1, { limit: 1, after: first.nextCursor });
    expect(unbounded.events).toHaveLength(1);
    expect(unbounded.events[0]).toMatchObject({ txHash: firstEvent.txHash, blockNumber: 12, eventIndex: 0 });
  });
});
