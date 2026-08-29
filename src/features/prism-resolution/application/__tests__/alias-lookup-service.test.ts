import { describe, expect, it } from "vitest";
import type {
  AliasAssociationResult,
  ExternalAlias,
  ExternalAliasResolution,
  IdentityAliasAssociationPort,
  IdentityAliasProvider,
} from "../../../../integrations/identity-alias/types";
import {
  AliasLookupService,
  serializeAliasLookupResult,
} from "../alias-lookup-service";

const ALIAS: ExternalAlias = { provider: "starknet-id", value: "Alice.stark" };
const PRISM_ID = "prism:P7F21";

function providerFor(result: Partial<ExternalAliasResolution> = {}): IdentityAliasProvider {
  return {
    providerId: "starknet-id",
    async resolve(alias) {
      return {
        status: "RESOLVED",
        alias,
        subject: "starknet-subject:alice",
        externalAddress: "0x123",
        canonicalValue: "alice.stark",
        detail: null,
        ...result,
      };
    },
  };
}

function associationFor(result: AliasAssociationResult): IdentityAliasAssociationPort {
  return { async resolve() { return result; } };
}

describe("AliasLookupService", () => {
  it("normalizes provider evidence and exposes a Prism ID only for explicit association", async () => {
    const service = new AliasLookupService({
      providers: new Map([["starknet-id", providerFor()]]),
      association: associationFor({
        status: "ASSOCIATED",
        prismId: PRISM_ID,
        evidence: "explicit_prism_association",
      }),
    });

    const result = await service.lookup(ALIAS);

    expect(result).toMatchObject({
      status: "RESOLVED",
      alias: { provider: "starknet-id", value: "alice.stark" },
      subject: "starknet-subject:alice",
      prismId: PRISM_ID,
      associationEvidence: "explicit_prism_association",
      association: {
        status: "ASSOCIATED",
        prismId: PRISM_ID,
        evidence: "explicit_prism_association",
      },
    });
  });

  it("keeps a resolved external alias unassociated when no explicit association exists", async () => {
    const service = new AliasLookupService({
      providers: new Map([["starknet-id", providerFor()]]),
      association: associationFor({ status: "NOT_ASSOCIATED", detail: "no explicit link" }),
    });

    const result = await service.lookup({ provider: "starknet-id", value: PRISM_ID });

    expect(result.status).toBe("RESOLVED");
    expect(result.association?.status).toBe("NOT_ASSOCIATED");
    expect(result.prismId).toBeNull();
    expect(result.associationEvidence).toBeNull();
  });

  it("returns a typed unknown/blocker for an unconfigured provider without inferring identity", async () => {
    const service = new AliasLookupService();

    const result = await service.lookup(ALIAS);

    expect(result.status).toBe("BLOCKED_BY_INTERFACE_EVIDENCE");
    expect(result.prismId).toBeNull();
    expect(result.subject).toBeNull();
    expect(JSON.stringify(result)).not.toContain(PRISM_ID);
  });

  it.each([
    ["NOT_FOUND", "NOT_FOUND"],
    ["UNAVAILABLE", "UNAVAILABLE"],
    ["BLOCKED_BY_INTERFACE_EVIDENCE", "BLOCKED_BY_INTERFACE_EVIDENCE"],
  ] as const)("preserves provider state %s without association or destination", async (status, expected) => {
    const service = new AliasLookupService({
      providers: new Map([["starknet-id", providerFor({
        status,
        subject: "should-not-cross-boundary",
        externalAddress: "0x456",
        canonicalValue: "other",
        detail: "provider-internal-detail",
      })]]),
      association: associationFor({ status: "ASSOCIATED", prismId: PRISM_ID, evidence: "explicit_prism_association" }),
    });

    const result = await service.lookup(ALIAS);

    expect(result.status).toBe(expected);
    expect(result.prismId).toBeNull();
    expect(result.association).toBeNull();
    expect(result.subject).toBeNull();
    expect(result.externalAddress).toBeNull();
  });

  it("redacts raw provider response material and provider-supplied detail", async () => {
    const provider: IdentityAliasProvider = {
      providerId: "starknet-id",
      async resolve(alias) {
        return {
          status: "RESOLVED",
          alias,
          subject: "external-subject:alice",
          externalAddress: "0x123",
          canonicalValue: "alice.stark",
          detail: "ciphertext=secret-ciphertext viewingKey=secret-viewing-key privateNote=do-not-return",
          rawProviderResponse: { credential: "provider-secret" },
        } as ExternalAliasResolution & Record<string, unknown>;
      },
    };
    const service = new AliasLookupService({
      providers: new Map([["starknet-id", provider]]),
      association: associationFor({ status: "NOT_ASSOCIATED", detail: "association unavailable to caller" }),
    });

    const result = serializeAliasLookupResult(await service.lookup(ALIAS));
    const wire = JSON.stringify(result);

    expect(wire).toContain("external-subject:alice");
    expect(wire).not.toContain("secret-ciphertext");
    expect(wire).not.toContain("secret-viewing-key");
    expect(wire).not.toContain("provider-secret");
    expect(wire).not.toContain("rawProviderResponse");
  });

  it("rejects malformed association evidence instead of accepting a Prism-looking string", async () => {
    const association: IdentityAliasAssociationPort = {
      async resolve() {
        return { status: "ASSOCIATED", prismId: PRISM_ID } as never;
      },
    };
    const service = new AliasLookupService({
      providers: new Map([["starknet-id", providerFor()]]),
      association,
    });

    const result = await service.lookup(ALIAS);

    expect(result.status).toBe("RESOLVED");
    expect(result.association?.status).toBe("UNAVAILABLE");
    expect(result.prismId).toBeNull();
    expect(result.associationEvidence).toBeNull();
  });
});
