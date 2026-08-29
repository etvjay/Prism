import { describe, expect, it } from "vitest";
import {
  InMemoryResolutionSnapshotStore,
} from "../../adapters/memory-resolution-snapshot-store";
import {
  ResolutionContinuityService,
  type ResolutionDestinationObservation,
  type ResolutionDestinationResolver,
} from "../continuity-service";

const PRISM_ID = "prism:P7F21";
const VENUE = "BASE";
const PURPOSE = "send";

function serviceFor(observation: ResolutionDestinationObservation, store = new InMemoryResolutionSnapshotStore()) {
  const resolver: ResolutionDestinationResolver = { async resolve() { return observation; } };
  return { service: new ResolutionContinuityService({ destinationResolver: resolver, snapshotStore: store, now: () => 1_789_000_000 }), store };
}

describe("ResolutionContinuityService transport states", () => {
  it("reports an active canonical resolution with watermark and freshness", async () => {
    const { service } = serviceFor({
      executionAccount: "0xabc",
      chain: VENUE,
      bindingStatus: "ACTIVE",
      visibility: "PUBLIC",
      watermark: 101,
      authoritativeSource: "registry_canonical",
    });

    const result = await service.resolve({ identifier: { kind: "prism-id", prismId: PRISM_ID }, venue: VENUE, purpose: PURPOSE });

    expect(result).toMatchObject({
      status: "RESOLVED",
      state: "ACTIVE",
      evidenceStatus: "KNOWN",
      blocked: false,
      watermark: 101,
      freshness: "FRESH",
      source: "registry_canonical",
      destination: { chain: VENUE, address: "0xabc" },
    });
  });

  it("distinguishes a stale refusal from a genuine no-active destination and does not persist stale truth", async () => {
    const store = new InMemoryResolutionSnapshotStore();
    const first = serviceFor({
      executionAccount: "0xabc",
      chain: VENUE,
      bindingStatus: "ACTIVE",
      visibility: "PUBLIC",
      watermark: 101,
      authoritativeSource: "registry_canonical",
    }, store);
    await first.service.resolve({ identifier: { kind: "prism-id", prismId: PRISM_ID }, venue: VENUE, purpose: PURPOSE });

    const stale = serviceFor({
      executionAccount: null,
      chain: VENUE,
      bindingStatus: "NO_ACTIVE_DESTINATION",
      visibility: "UNKNOWN",
      watermark: 90,
      authoritativeSource: "stale_refused",
    }, store);
    const result = await stale.service.resolve({ identifier: { kind: "prism-id", prismId: PRISM_ID }, venue: VENUE, purpose: PURPOSE });

    expect(result).toMatchObject({
      state: "STALE",
      blocked: true,
      evidenceStatus: "UNKNOWN",
      watermark: 90,
      freshness: "STALE",
      source: "stale_refused",
      executionAccount: null,
      snapshot: null,
    });
    expect((await store.get({ prismId: PRISM_ID, venue: VENUE, purpose: PURPOSE }))?.destination?.address).toBe("0xabc");
  });

  it("distinguishes revoked and absent destinations", async () => {
    const revoked = serviceFor({
      executionAccount: null,
      chain: VENUE,
      bindingStatus: "REVOKED",
      visibility: "UNKNOWN",
      watermark: 103,
      authoritativeSource: "registry_canonical",
    });
    const revokedResult = await revoked.service.resolve({ identifier: { kind: "prism-id", prismId: PRISM_ID }, venue: VENUE, purpose: PURPOSE });
    expect(revokedResult).toMatchObject({ status: "NO_ACTIVE_DESTINATION", state: "BINDING_REVOKED", blocked: true });
    expect(revokedResult.risks.map((risk) => risk.code)).toContain("BINDING_REVOKED");

    const absent = serviceFor({
      executionAccount: null,
      chain: VENUE,
      bindingStatus: "NO_ACTIVE_DESTINATION",
      visibility: "UNKNOWN",
      watermark: 104,
      authoritativeSource: "registry_canonical",
    });
    const absentResult = await absent.service.resolve({ identifier: { kind: "prism-id", prismId: PRISM_ID }, venue: VENUE, purpose: PURPOSE });
    expect(absentResult).toMatchObject({ status: "NO_ACTIVE_DESTINATION", state: "NO_ACTIVE_DESTINATION", blocked: true });
    expect(absentResult.risks.map((risk) => risk.code)).toContain("NO_ACTIVE_DESTINATION");
  });

  it("reports a changed active destination as a typed change without claiming it is safe", async () => {
    const store = new InMemoryResolutionSnapshotStore();
    let address = "0xabc";
    const resolver: ResolutionDestinationResolver = { async resolve() {
      return { executionAccount: address, chain: VENUE, bindingStatus: "ACTIVE", visibility: "PUBLIC", watermark: 101, authoritativeSource: "registry_canonical" };
    } };
    const service = new ResolutionContinuityService({ destinationResolver: resolver, snapshotStore: store, now: () => 1_789_000_000 });
    const request = { identifier: { kind: "prism-id", prismId: PRISM_ID } as const, venue: VENUE, purpose: PURPOSE };

    await service.resolve(request);
    address = "0xdef";
    const result = await service.resolve(request);

    expect(result).toMatchObject({ status: "RESOLVED", state: "ADDRESS_CHANGED", blocked: false, executionAccount: "0xdef" });
    expect(result.risks.map((risk) => risk.code)).toContain("ADDRESS_CHANGED");
  });

  it("uses unavailable and unknown states for missing canonical/projection evidence", async () => {
    const unavailable = new ResolutionContinuityService({
      destinationResolver: { async resolve() { throw new Error("canonical read unavailable"); } },
      snapshotStore: new InMemoryResolutionSnapshotStore(),
      now: () => 1_789_000_000,
    });
    const unavailableResult = await unavailable.resolve({ identifier: { kind: "prism-id", prismId: PRISM_ID }, venue: VENUE, purpose: PURPOSE });
    expect(unavailableResult).toMatchObject({ status: "BLOCKED", state: "UNAVAILABLE", evidenceStatus: "UNKNOWN", blocked: true, destination: null });

    const unknown = serviceFor({
      executionAccount: "0xabc",
      chain: VENUE,
      bindingStatus: "UNKNOWN",
      visibility: "UNKNOWN",
      watermark: null,
      authoritativeSource: "unknown",
    });
    const unknownResult = await unknown.service.resolve({ identifier: { kind: "prism-id", prismId: PRISM_ID }, venue: VENUE, purpose: PURPOSE });
    expect(unknownResult).toMatchObject({ status: "BLOCKED", state: "UNKNOWN", evidenceStatus: "UNKNOWN", blocked: true, executionAccount: null });
  });
});
