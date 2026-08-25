import { describe, expect, it } from "vitest";
import type {
  AliasAssociationResult,
  ExternalAlias,
  ExternalAliasResolution,
  IdentityAliasAssociationPort,
  IdentityAliasProvider,
} from "../../../integrations/identity-alias/types";
import {
  InMemoryResolutionSnapshotStore,
  resolutionSnapshotKey,
} from "../adapters/memory-resolution-snapshot-store";
import {
  ResolutionContinuityService,
  type ResolutionDestinationResolver,
} from "../application/continuity-service";
import type { ResolutionBindingStatus } from "../domain/snapshot";

const PRISM_ID = "prism:P7F21";
const VENUE = "BASE";
const PURPOSE = "payment";
const ALICE: ExternalAlias = { provider: "starknet-id", value: "Alice" };
const BOB: ExternalAlias = { provider: "starknet-id", value: "Bob" };

function providerFor(state: {
  alias: ExternalAlias;
  status?: ExternalAliasResolution["status"];
  subject?: string | null;
}): IdentityAliasProvider {
  return {
    providerId: "starknet-id",
    async resolve(alias) {
      return {
        status: state.status ?? "RESOLVED",
        alias: { ...alias, value: alias.value.trim().toLowerCase() },
        subject: state.subject === undefined ? "external-subject:stable" : state.subject,
        canonicalValue: alias.value.trim().toLowerCase(),
        detail: null,
      };
    },
  };
}

function associationFor(prismId = PRISM_ID): IdentityAliasAssociationPort {
  return {
    async resolve(): Promise<AliasAssociationResult> {
      return { status: "ASSOCIATED", prismId, evidence: "explicit_prism_association" };
    },
  };
}

function resolverFor(state: {
  address: string | null;
  chain?: string | null;
  bindingStatus?: ResolutionBindingStatus;
}): ResolutionDestinationResolver {
  return {
    async resolve() {
      return {
        executionAccount: state.address,
        chain: state.chain ?? VENUE,
        bindingStatus: state.bindingStatus,
        watermark: 100,
        visibility: "PUBLIC" as const,
      };
    },
  };
}

function serviceFor(input: {
  provider: IdentityAliasProvider;
  resolver: ResolutionDestinationResolver;
  store?: InMemoryResolutionSnapshotStore;
  association?: IdentityAliasAssociationPort;
}) {
  return new ResolutionContinuityService({
    aliasProvider: input.provider,
    aliasAssociation: input.association ?? associationFor(),
    destinationResolver: input.resolver,
    snapshotStore: input.store ?? new InMemoryResolutionSnapshotStore(),
    now: () => 1_789_000_000,
  });
}

describe("ResolutionContinuityService", () => {
  it("emits FIRST_TIME_RECIPIENT and persists the first active snapshot", async () => {
    const store = new InMemoryResolutionSnapshotStore();
    const service = serviceFor({
      provider: providerFor({ alias: ALICE }),
      resolver: resolverFor({ address: "0xabc" }),
      store,
    });

    const result = await service.resolve({
      identifier: { kind: "external-alias", alias: ALICE },
      venue: VENUE,
      purpose: PURPOSE,
    });

    expect(result.status).toBe("RESOLVED");
    expect(result.blocked).toBe(false);
    expect(result.prismId).toBe(PRISM_ID);
    expect(result.executionAccount).toBe("0xabc");
    expect(result.risks.map((risk) => risk.code)).toEqual(["FIRST_TIME_RECIPIENT"]);
    expect(result.snapshot?.version).toBe(1);
    expect(await store.get(resolutionSnapshotKey({ prismId: PRISM_ID, venue: VENUE, purpose: PURPOSE }))).toMatchObject({
      prismId: PRISM_ID,
      alias: { provider: "starknet-id", value: "alice" },
      destination: { chain: VENUE, address: "0xabc" },
    });
  });

  it("emits no new risk for an unchanged resolution", async () => {
    const store = new InMemoryResolutionSnapshotStore();
    const service = serviceFor({
      provider: providerFor({ alias: ALICE }),
      resolver: resolverFor({ address: "0xabc" }),
      store,
    });
    const request = { identifier: { kind: "external-alias", alias: ALICE } as const, venue: VENUE, purpose: PURPOSE };

    await service.resolve(request);
    const result = await service.resolve(request);

    expect(result.risks).toEqual([]);
    expect(result.diff?.firstTime).toBe(false);
    expect(result.diff?.addressChanged).toBe(false);
    expect(result.diff?.aliasChanged).toBe(false);
  });

  it("emits ADDRESS_CHANGED when the active destination rotates", async () => {
    const store = new InMemoryResolutionSnapshotStore();
    const state = { address: "0xabc" };
    const service = serviceFor({
      provider: providerFor({ alias: ALICE }),
      resolver: resolverFor(state),
      store,
    });
    const request = { identifier: { kind: "external-alias", alias: ALICE } as const, venue: VENUE, purpose: PURPOSE };

    await service.resolve(request);
    state.address = "0xdef";
    const result = await service.resolve(request);

    expect(result.executionAccount).toBe("0xdef");
    expect(result.diff?.addressChanged).toBe(true);
    expect(result.risks.map((risk) => risk.code)).toContain("ADDRESS_CHANGED");
  });

  it("emits ALIAS_CHANGED when the external alias changes while the explicit Prism association remains stable", async () => {
    const store = new InMemoryResolutionSnapshotStore();
    let currentAlias = ALICE;
    const provider = providerFor({ alias: ALICE });
    provider.resolve = async (alias) => ({
      status: "RESOLVED",
      alias: { provider: alias.provider, value: currentAlias.value.toLowerCase() },
      subject: "external-subject:stable",
      canonicalValue: currentAlias.value.toLowerCase(),
      detail: null,
    });
    const service = serviceFor({
      provider,
      resolver: resolverFor({ address: "0xabc" }),
      store,
    });
    const request = { identifier: { kind: "external-alias", alias: ALICE } as const, venue: VENUE, purpose: PURPOSE };

    await service.resolve(request);
    currentAlias = BOB;
    const result = await service.resolve({ ...request, identifier: { kind: "external-alias", alias: BOB } });

    expect(result.diff?.aliasChanged).toBe(true);
    expect(result.risks.map((risk) => risk.code)).toContain("ALIAS_CHANGED");
  });

  it("emits ALIAS_CHANGED when the provider subject rotates even if the alias value is unchanged", async () => {
    const store = new InMemoryResolutionSnapshotStore();
    let currentSubject = "external-subject:stable";
    const provider: IdentityAliasProvider = {
      providerId: "starknet-id",
      async resolve(alias) {
        return {
          status: "RESOLVED",
          alias: { provider: alias.provider, value: "alice" },
          subject: currentSubject,
        };
      },
    };
    const service = serviceFor({
      provider,
      resolver: resolverFor({ address: "0xabc" }),
      store,
    });
    const request = { identifier: { kind: "external-alias", alias: ALICE } as const, venue: VENUE, purpose: PURPOSE };

    await service.resolve(request);
    currentSubject = "external-subject:rotated";
    const result = await service.resolve(request);

    expect(result.diff).toMatchObject({
      externalSubjectChanged: true,
      aliasChanged: true,
    });
    expect(result.risks.map((risk) => risk.code)).toContain("ALIAS_CHANGED");
  });

  it("blocks revoked bindings with BINDING_REVOKED", async () => {
    const service = serviceFor({
      provider: providerFor({ alias: ALICE }),
      resolver: resolverFor({ address: null, bindingStatus: "REVOKED" }),
    });

    const result = await service.resolve({
      identifier: { kind: "external-alias", alias: ALICE },
      venue: VENUE,
      purpose: PURPOSE,
    });

    expect(result.status).toBe("NO_ACTIVE_DESTINATION");
    expect(result.blocked).toBe(true);
    expect(result.executionAccount).toBeNull();
    expect(result.risks.map((risk) => risk.code)).toContain("BINDING_REVOKED");
    expect(result.risks.some((risk) => risk.blocking)).toBe(true);
  });

  it("blocks a missing active destination with NO_ACTIVE_DESTINATION", async () => {
    const service = serviceFor({
      provider: providerFor({ alias: ALICE }),
      resolver: resolverFor({ address: null, bindingStatus: "NO_ACTIVE_DESTINATION" }),
    });

    const result = await service.resolve({
      identifier: { kind: "external-alias", alias: ALICE },
      venue: VENUE,
      purpose: PURPOSE,
    });

    expect(result.status).toBe("NO_ACTIVE_DESTINATION");
    expect(result.risks.map((risk) => risk.code)).toContain("NO_ACTIVE_DESTINATION");
    expect(result.risks.find((risk) => risk.code === "NO_ACTIVE_DESTINATION")?.blocking).toBe(true);
  });

  it("fails closed when the alias provider is blocked by interface evidence", async () => {
    const store = new InMemoryResolutionSnapshotStore();
    let associationCalled = false;
    const association: IdentityAliasAssociationPort = {
      async resolve() {
        associationCalled = true;
        return { status: "ASSOCIATED", prismId: PRISM_ID, evidence: "explicit_prism_association" };
      },
    };
    const service = serviceFor({
      provider: providerFor({ alias: ALICE, status: "BLOCKED_BY_INTERFACE_EVIDENCE", subject: null }),
      resolver: resolverFor({ address: "0xabc" }),
      store,
      association,
    });

    const result = await service.resolve({
      identifier: { kind: "external-alias", alias: ALICE },
      venue: VENUE,
      purpose: PURPOSE,
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.blocked).toBe(true);
    expect(result.prismId).toBeNull();
    expect(result.risks.map((risk) => risk.code)).toContain("ALIAS_PROVIDER_INTERFACE_BLOCKED");
    expect(associationCalled).toBe(false);
    expect(await store.get(resolutionSnapshotKey({ prismId: PRISM_ID, venue: VENUE, purpose: PURPOSE }))).toBeNull();
  });

  it("catches a provider exception as a blocking unavailable-provider result", async () => {
    const provider: IdentityAliasProvider = {
      providerId: "starknet-id",
      async resolve() {
        throw new Error("provider unavailable");
      },
    };
    const service = serviceFor({ provider, resolver: resolverFor({ address: "0xabc" }) });

    const result = await service.resolve({
      identifier: { kind: "external-alias", alias: ALICE },
      venue: VENUE,
      purpose: PURPOSE,
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.risks.map((risk) => risk.code)).toContain("ALIAS_PROVIDER_UNAVAILABLE");
    expect(result.snapshot).toBeNull();
  });

  it("requires an explicit association and never interprets an alias string as a Prism ID", async () => {
    const association: IdentityAliasAssociationPort = {
      async resolve() {
        return { status: "NOT_ASSOCIATED", detail: "no explicit link" };
      },
    };
    const service = serviceFor({
      provider: providerFor({ alias: ALICE }),
      resolver: resolverFor({ address: "0xabc" }),
      association,
    });

    const result = await service.resolve({
      identifier: { kind: "external-alias", alias: { provider: "starknet-id", value: PRISM_ID } },
      venue: VENUE,
      purpose: PURPOSE,
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.prismId).toBeNull();
    expect(result.risks.map((risk) => risk.code)).toContain("ALIAS_NOT_ASSOCIATED");
  });

  it("rejects an ASSOCIATED result that lacks runtime association evidence", async () => {
    const association: IdentityAliasAssociationPort = {
      async resolve() {
        return {
          status: "ASSOCIATED",
          prismId: PRISM_ID,
        } as never;
      },
    };
    const service = serviceFor({
      provider: providerFor({ alias: ALICE }),
      resolver: resolverFor({ address: "0xabc" }),
      association,
    });

    const result = await service.resolve({
      identifier: { kind: "external-alias", alias: ALICE },
      venue: VENUE,
      purpose: PURPOSE,
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.prismId).toBeNull();
    expect(result.risks.map((risk) => risk.code)).toContain("ALIAS_NOT_ASSOCIATED");
  });

  it("resolves an explicitly supplied Prism ID without consulting an alias provider", async () => {
    const service = new ResolutionContinuityService({
      destinationResolver: resolverFor({ address: "0xabc" }),
      snapshotStore: new InMemoryResolutionSnapshotStore(),
      now: () => 1_789_000_000,
    });

    const result = await service.resolve({
      identifier: { kind: "prism-id", prismId: PRISM_ID },
      venue: VENUE,
      purpose: PURPOSE,
    });

    expect(result.status).toBe("RESOLVED");
    expect(result.prismId).toBe(PRISM_ID);
    expect(result.alias).toBeNull();
    expect(result.externalSubject).toBeNull();
  });
});
