// Explicit fail-closed adapter used when key-management/recovery has not been
// integrated. It intentionally does not generate keys or invent encryption.

import type {
  BindingOwnerActor,
  BindingId,
  ExecutionEndpoint,
  PrivateBindingProtectionPort,
  PrismId,
  ProtectedEndpoint,
} from "../domain/binding-disclosure";

export class UnconfiguredPrivateBindingProtection implements PrivateBindingProtectionPort {
  async getReadiness(_input: { prismId: PrismId; actor: BindingOwnerActor }) {
    return { status: "BLOCKED" as const, reason: "key_management_unconfigured" };
  }

  async protect(_input: { bindingId: BindingId; prismId: PrismId; endpoint: ExecutionEndpoint }): Promise<ProtectedEndpoint> {
    throw new Error("key_management_unconfigured");
  }

  async reveal(_input: { bindingId: BindingId; prismId: PrismId; protectedEndpoint: ProtectedEndpoint }): Promise<{ endpoint: ExecutionEndpoint; evidence: ProtectedEndpoint["evidence"] }> {
    throw new Error("key_management_unconfigured");
  }
}
