import { describe, expect, it } from "vitest";
import type {
  AliasAssociationResult,
  ExternalAlias,
  IdentityAliasAssociationPort,
  IdentityAliasProvider,
} from "../../integrations/identity-alias/types";
import { AliasLookupService } from "../../features/prism-resolution/application/alias-lookup-service";
import { InMemoryResolutionSnapshotStore } from "../../features/prism-resolution/adapters/memory-resolution-snapshot-store";
import {
  ResolutionContinuityService,
  type ResolutionDestinationResolver,
} from "../../features/prism-resolution/application/continuity-service";
import { PrismApplicationService } from "../prism-application";

const PRISM_ID = "prism:P7F21";
const ALIAS: ExternalAlias = { provider: "starknet-id", value: "Alice.stark" };

function appWith(input: {
  aliasLookupService?: AliasLookupService;
  resolutionContinuityService?: ResolutionContinuityService;
}): PrismApplicationService {
  return new PrismApplicationService({
    aliasLookupService: input.aliasLookupService,
    resolutionContinuityService: input.resolutionContinuityService,
    registryVersion: "v1",
    submitPort: { registryVersion: "v1" },
  } as never);
}

function providerFor(): IdentityAliasProvider {
  return {
    providerId: "starknet-id",
    async resolve(alias) {
      return {
        status: "RESOLVED",
        alias,
        subject: "starknet-subject:alice",
        externalAddress: "0x123",
        canonicalValue: "alice.stark",
        detail: "provider-internal-detail",
      };
    },
  };
}

function associationFor(result: AliasAssociationResult): IdentityAliasAssociationPort {
  return { async resolve() { return result; } };
}

describe("resolution API application boundary", () => {
  it("returns the existing success envelope and explicit alias association evidence", async () => {
    const result = await appWith({
      aliasLookupService: new AliasLookupService({
        providers: new Map([["starknet-id", providerFor()]]),
        association: associationFor({ status: "ASSOCIATED", prismId: PRISM_ID, evidence: "explicit_prism_association" }),
      }),
    }).lookupAlias({
      headers: { requestId: "req-alias-app" },
      payload: { provider: "starknet-id", value: "Alice.stark" },
    });

    expect(result).toMatchObject({
      ok: true,
      requestId: "req-alias-app",
      data: {
        status: "RESOLVED",
        state: "FOUND",
        alias: { provider: "starknet-id", value: "alice.stark" },
        subject: "starknet-subject:alice",
        prismId: PRISM_ID,
        associationEvidence: "explicit_prism_association",
      },
    });
    expect(JSON.stringify(result)).not.toContain("provider-internal-detail");
    expect(JSON.stringify(result)).not.toMatch(/ciphertext|viewingKey|privateNote|rawProviderResponse/i);
  });

  it("keeps a provider subject from becoming a Prism ID without explicit association", async () => {
    const result = await appWith({
      aliasLookupService: new AliasLookupService({
        providers: new Map([["starknet-id", providerFor()]]),
        association: associationFor({ status: "NOT_ASSOCIATED", detail: "no link" }),
      }),
    }).lookupAlias({
      headers: { requestId: "req-alias-no-association" },
      payload: { provider: "starknet-id", value: PRISM_ID },
    });

    expect(result).toMatchObject({
      ok: true,
      data: { status: "RESOLVED", state: "FOUND", prismId: null, association: { status: "NOT_ASSOCIATED" } },
    });
  });

  it("maps continuity to previous/current snapshots with freshness and watermark", async () => {
    const resolver: ResolutionDestinationResolver = {
      async resolve() {
        return {
          executionAccount: "0xabc",
          chain: "BASE",
          bindingStatus: "ACTIVE",
          visibility: "PUBLIC",
          watermark: 101,
          authoritativeSource: "registry_canonical",
        };
      },
    };
    const result = await appWith({
      resolutionContinuityService: new ResolutionContinuityService({
        destinationResolver: resolver,
        snapshotStore: new InMemoryResolutionSnapshotStore(),
        now: () => 1_789_000_000,
      }),
    }).assessContinuity({
      headers: { requestId: "req-continuity-app" },
      payload: { identifier: { kind: "prism-id", prismId: PRISM_ID }, venue: "BASE", purpose: "SEND" },
    });

    expect(result).toMatchObject({
      ok: true,
      requestId: "req-continuity-app",
      watermark: 101,
      data: {
        status: "RESOLVED",
        state: "ACTIVE",
        continuityStatus: "RESOLVED",
        evidenceStatus: "KNOWN",
        freshness: "FRESH",
        source: "registry_canonical",
        previous: null,
        current: { prismId: PRISM_ID, venue: "BASE", purpose: "send", watermark: 101 },
        risks: [{ code: "FIRST_TIME_RECIPIENT" }],
      },
    });
    expect(JSON.stringify(result)).not.toContain("BigInt");
  });

  it("returns a typed unavailable error when continuity service wiring is absent", async () => {
    const result = await appWith({}).assessContinuity({
      headers: { requestId: "req-continuity-missing" },
      payload: { identifier: { kind: "prism-id", prismId: PRISM_ID }, venue: "BASE" },
    });

    expect(result).toMatchObject({
      ok: false,
      requestId: "req-continuity-missing",
      error: { code: "ERR-021", httpStatusHint: 503 },
    });
  });
});
