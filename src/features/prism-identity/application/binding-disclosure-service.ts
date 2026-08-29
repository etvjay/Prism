// Application service for the PUBLIC/PRIVATE binding boundary.
//
// Owner authorization, key-management readiness, and durable CAS are separate
// dependencies. This service never treats an app session/user id as ownership,
// never implements ad-hoc encryption, and never sends a PRIVATE endpoint to a
// public/chain surface.

import { assertValidPrismId } from "../domain/identifiers";
import type { BindingLifecycle, BindingVisibility as DomainBindingVisibility } from "../../prism-bindings/domain/types";
import {
  BINDING_ERROR_CODE,
  BINDING_DISCLOSURE_SCHEMA_VERSION,
  BindingDisclosureError,
  assertV0PersistableBinding,
  assertProtectionEvidence,
  assertProtectedEndpoint,
  assertValidExecutionEndpoint,
  sameProtectionEvidence,
  toPublicBindingView,
  type BindingDisclosureStore,
  type BindingId,
  type BindingOwnerActor,
  type BindingOwnerAuthorizationPort,
  type BindingOwnerOperation,
  type BindingView,
  type ExecutionEndpoint,
  type HistoricalPublicWarning,
  type PrivateBindingProtectionPort,
  type ProtectionEvidence,
  type PublicBindingView,
  type StoredBinding,
} from "../domain/binding-disclosure";

const HISTORICAL_PUBLIC_WARNING: HistoricalPublicWarning = {
  code: "HISTORICAL_PUBLIC_LINKAGE",
  message: "This binding was public previously. Prism can stop future publication and resolution, but blockchain history or third-party indexes may retain the association.",
};

export interface BindingDisclosureServiceDeps {
  readonly store: BindingDisclosureStore;
  /** Required in production. Missing/denied authorization fails closed. */
  readonly ownerAuthorization?: BindingOwnerAuthorizationPort | null;
  /** Required for private operations. Missing readiness blocks with a stable code. */
  readonly privateBindingProtection?: PrivateBindingProtectionPort | null;
  readonly clock: { now(): number };
  readonly idGenerator: { generateBindingId(): BindingId };
}

export interface CreateBindingInput {
  readonly prismId: string;
  readonly endpoint: ExecutionEndpoint;
  readonly actor: BindingOwnerActor;
  readonly bindingId?: BindingId;
  /** Optional domain selector used to reject unsupported v0 requests explicitly. */
  readonly visibility?: DomainBindingVisibility;
  readonly lifecycle?: BindingLifecycle;
}

/**
 * Domain-facing create input. The service is the explicit compatibility seam
 * between PUBLIC/SELECTIVE/PRIVATE + lifecycle and the durable v0 store.
 */
export interface PersistedCreateBindingInput extends Omit<CreateBindingInput, "visibility" | "lifecycle"> {
  readonly visibility: "PUBLIC" | "SELECTIVE" | "PRIVATE";
  readonly lifecycle: BindingLifecycle;
}

export interface BindingMutationInput {
  readonly prismId: string;
  readonly bindingId: BindingId;
  readonly actor: BindingOwnerActor;
  readonly expectedVersion?: number;
}

export interface MakePublicInput extends BindingMutationInput {
  readonly confirmExposure?: boolean;
}

function assertCreateMode(input: CreateBindingInput, expected: "PUBLIC" | "PRIVATE"): void {
  const visibility = input.visibility ?? expected;
  const lifecycle = input.lifecycle ?? "PERSISTENT";
  assertV0PersistableBinding({ visibility, lifecycle });
  if (visibility !== expected) {
    throw new BindingDisclosureError(BINDING_ERROR_CODE.INVALID_BINDING, `create_visibility_mismatch:expected_${expected}_got_${visibility}`);
  }
}

export class BindingDisclosureService {
  constructor(private readonly deps: BindingDisclosureServiceDeps) {}

  /**
   * Persist a domain binding only when it is representable by v0. SELECTIVE
   * and non-persistent lifecycles are rejected before owner/key/store work;
   * neither can be silently collapsed into a PUBLIC or PRIVATE row.
   */
  async createBinding(input: PersistedCreateBindingInput): Promise<BindingView> {
    assertV0PersistableBinding({ visibility: input.visibility, lifecycle: input.lifecycle });
    if (input.visibility === "PUBLIC") return this.createPublicBinding(input);
    return this.createPrivateBinding(input);
  }

  async createPublicBinding(input: CreateBindingInput): Promise<BindingView> {
    assertCreateMode(input, "PUBLIC");
    const prismId = this.validPrismId(input.prismId);
    assertValidExecutionEndpoint(input.endpoint);
    await this.authorizeOwner(prismId, input.actor, "CREATE");
    const now = this.now();
    const bindingId = this.bindingId(input.bindingId);
    const record: StoredBinding = {
      schemaVersion: BINDING_DISCLOSURE_SCHEMA_VERSION,
      bindingId,
      prismId,
      visibility: "PUBLIC",
      status: "ACTIVE",
      version: 0,
      endpoint: input.endpoint,
      protectedEndpoint: null,
      historicalPublic: true,
      publiclyExposedAt: now,
      hiddenAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.write(() => this.deps.store.put(record));
    return this.view(record, input.endpoint);
  }

  async createPrivateBinding(input: CreateBindingInput): Promise<BindingView> {
    assertCreateMode(input, "PRIVATE");
    const prismId = this.validPrismId(input.prismId);
    assertValidExecutionEndpoint(input.endpoint);
    await this.authorizeOwner(prismId, input.actor, "CREATE");
    const now = this.now();
    const bindingId = this.bindingId(input.bindingId);
    const protectedEndpoint = await this.protect({ bindingId, prismId, actor: input.actor, endpoint: input.endpoint });
    const record: StoredBinding = {
      schemaVersion: BINDING_DISCLOSURE_SCHEMA_VERSION,
      bindingId,
      prismId,
      visibility: "PRIVATE",
      status: "ACTIVE",
      version: 0,
      endpoint: null,
      protectedEndpoint,
      historicalPublic: false,
      publiclyExposedAt: null,
      hiddenAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.write(() => this.deps.store.put(record));
    return this.view(record, input.endpoint);
  }

  /** Public resolution surface: no owner authorization and no private rows. */
  async listPublicBindings(prismIdInput: string): Promise<readonly PublicBindingView[]> {
    const prismId = this.validPrismId(prismIdInput);
    const records = await this.read(() => this.deps.store.listPublicForIdentity(prismId));
    return records.map((record) => toPublicBindingView(record));
  }

  /** Owner-only view. Private endpoints are recovered through the typed port. */
  async listOwnerBindings(prismIdInput: string, actor: BindingOwnerActor): Promise<readonly BindingView[]> {
    const prismId = this.validPrismId(prismIdInput);
    await this.authorizeOwner(prismId, actor, "READ");
    const records = await this.read(() => this.deps.store.listForIdentity(prismId));
    const views: BindingView[] = [];
    for (const record of records) {
      views.push(await this.ownerView(record, actor));
    }
    return views;
  }

  /** Owner/private audience projection. Public rows are not mixed into it. */
  async listOwnerPrivateBindings(prismIdInput: string, actor: BindingOwnerActor): Promise<readonly BindingView[]> {
    const views = await this.listOwnerBindings(prismIdInput, actor);
    return views.filter((view) => view.visibility === "PRIVATE");
  }

  async getOwnerBinding(input: BindingMutationInput): Promise<BindingView> {
    const prismId = this.validPrismId(input.prismId);
    await this.authorizeOwner(prismId, input.actor, "READ");
    const record = await this.requireRecord(prismId, input.bindingId);
    return this.ownerView(record, input.actor);
  }

  /** PUBLIC -> PRIVATE; no history erasure is implied or returned. */
  async hidePublicBinding(input: BindingMutationInput): Promise<BindingView> {
    const prismId = this.validPrismId(input.prismId);
    await this.authorizeOwner(prismId, input.actor, "HIDE_PUBLIC");
    const current = await this.requireRecord(prismId, input.bindingId);
    this.assertExpectedVersion(current, input.expectedVersion);
    if (current.status === "REVOKED") throw new BindingDisclosureError(BINDING_ERROR_CODE.BINDING_REVOKED, "cannot_hide_revoked_binding");
    if (current.visibility !== "PUBLIC") throw new BindingDisclosureError(BINDING_ERROR_CODE.NOT_PUBLIC, "binding_is_not_public");

    // Seal before the CAS. If key management is unavailable, the current PUBLIC
    // row remains untouched and future resolution remains truthful.
    const protectedEndpoint = await this.protect({ bindingId: current.bindingId, prismId, actor: input.actor, endpoint: current.endpoint });
    const now = this.now();
    const next: StoredBinding = {
      ...current,
      visibility: "PRIVATE",
      endpoint: null,
      protectedEndpoint,
      version: current.version + 1,
      historicalPublic: true,
      publiclyExposedAt: current.publiclyExposedAt,
      hiddenAt: now,
      updatedAt: now,
    };
    const applied = await this.compareAndSet(current, next);
    if (!applied) throw new BindingDisclosureError(BINDING_ERROR_CODE.STALE_BINDING_VERSION, "hide_cas_lost");
    // The endpoint was public and the protection proof succeeded before the
    // CAS. Return that known endpoint without a second recovery call that could
    // fail after the durable transition has already won.
    return this.view(next, current.endpoint);
  }

  /** PRIVATE -> PUBLIC; explicit confirmation is required for durable exposure. */
  async makePublic(input: MakePublicInput): Promise<BindingView> {
    const prismId = this.validPrismId(input.prismId);
    await this.authorizeOwner(prismId, input.actor, "MAKE_PUBLIC");
    const current = await this.requireRecord(prismId, input.bindingId);
    this.assertExpectedVersion(current, input.expectedVersion);
    if (current.status === "REVOKED") throw new BindingDisclosureError(BINDING_ERROR_CODE.BINDING_REVOKED, "cannot_publish_revoked_binding");
    if (current.visibility === "PUBLIC") return this.ownerView(current, input.actor);
    if (input.confirmExposure !== true) {
      throw new BindingDisclosureError(BINDING_ERROR_CODE.PUBLIC_EXPOSURE_CONFIRMATION_REQUIRED, "explicit_public_exposure_confirmation_required");
    }

    const endpoint = await this.reveal({ bindingId: current.bindingId, prismId, actor: input.actor, protectedEndpoint: current.protectedEndpoint });
    const now = this.now();
    const next: StoredBinding = {
      ...current,
      visibility: "PUBLIC",
      endpoint,
      protectedEndpoint: null,
      version: current.version + 1,
      historicalPublic: true,
      publiclyExposedAt: current.publiclyExposedAt ?? now,
      updatedAt: now,
    };
    const applied = await this.compareAndSet(current, next);
    if (!applied) throw new BindingDisclosureError(BINDING_ERROR_CODE.STALE_BINDING_VERSION, "publish_cas_lost");
    return this.view(next, endpoint);
  }

  async revokeBinding(input: BindingMutationInput): Promise<BindingView> {
    const prismId = this.validPrismId(input.prismId);
    await this.authorizeOwner(prismId, input.actor, "REVOKE");
    const current = await this.requireRecord(prismId, input.bindingId);
    this.assertExpectedVersion(current, input.expectedVersion);
    if (current.status === "REVOKED") return this.ownerView(current, input.actor);

    // Preflight PRIVATE recovery before the CAS so a key-management outage
    // cannot leave a mutation applied while returning BLOCKED_BY_KEY_MANAGEMENT.
    const recoveredEndpoint = current.visibility === "PRIVATE"
      ? await this.reveal({ bindingId: current.bindingId, prismId, actor: input.actor, protectedEndpoint: current.protectedEndpoint })
      : current.endpoint;
    const next: StoredBinding = { ...current, status: "REVOKED", version: current.version + 1, updatedAt: this.now() };
    const applied = await this.compareAndSet(current, next);
    if (!applied) throw new BindingDisclosureError(BINDING_ERROR_CODE.STALE_BINDING_VERSION, "revoke_cas_lost");
    return this.view(next, recoveredEndpoint);
  }

  private async ownerView(record: StoredBinding, actor: BindingOwnerActor): Promise<BindingView> {
    if (record.visibility === "PUBLIC") return this.view(record, record.endpoint);
    const endpoint = await this.reveal({ bindingId: record.bindingId, prismId: record.prismId, actor, protectedEndpoint: record.protectedEndpoint });
    return this.view(record, endpoint);
  }

  private view(record: StoredBinding, endpoint: ExecutionEndpoint | null): BindingView {
    return {
      bindingId: record.bindingId,
      prismId: record.prismId,
      visibility: record.visibility,
      status: record.status,
      version: record.version,
      endpoint,
      historicalPublic: record.historicalPublic,
      publiclyExposedAt: record.publiclyExposedAt,
      hiddenAt: record.hiddenAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      historicalPublicWarning: record.visibility === "PRIVATE" && record.historicalPublic ? HISTORICAL_PUBLIC_WARNING : null,
    };
  }

  private async authorizeOwner(prismId: string, actor: BindingOwnerActor, operation: BindingOwnerOperation): Promise<void> {
    if (!actor || typeof actor.actorId !== "string" || actor.actorId.trim().length === 0) {
      throw new BindingDisclosureError(BINDING_ERROR_CODE.OWNER_AUTHORIZATION_REQUIRED, "owner_actor_required");
    }
    const authorizer = this.deps.ownerAuthorization;
    if (!authorizer) throw new BindingDisclosureError(BINDING_ERROR_CODE.OWNER_AUTHORIZATION_REQUIRED, "owner_authorization_port_unconfigured");
    let decision: { authorized: boolean };
    try {
      decision = await authorizer.authorize({ prismId, actor, operation });
    } catch {
      throw new BindingDisclosureError(BINDING_ERROR_CODE.OWNER_AUTHORIZATION_UNAVAILABLE, "owner_authorization_unavailable");
    }
    if (!decision || decision.authorized !== true) throw new BindingDisclosureError(BINDING_ERROR_CODE.OWNER_NOT_AUTHORIZED, "owner_authorization_denied");
  }

  private async protect(input: { bindingId: BindingId; prismId: string; actor: BindingOwnerActor; endpoint: ExecutionEndpoint }) {
    const evidence = await this.requireProtection(input.prismId, input.actor);
    const provider = this.deps.privateBindingProtection!;
    let protectedEndpoint: Awaited<ReturnType<PrivateBindingProtectionPort["protect"]>>;
    try {
      protectedEndpoint = await provider.protect({ bindingId: input.bindingId, prismId: input.prismId, endpoint: input.endpoint });
      assertProtectedEndpoint(protectedEndpoint);
    } catch (cause) {
      if (cause instanceof BindingDisclosureError && cause.code === BINDING_ERROR_CODE.BLOCKED_BY_KEY_MANAGEMENT) throw cause;
      throw new BindingDisclosureError(BINDING_ERROR_CODE.BLOCKED_BY_KEY_MANAGEMENT, "protection_failed");
    }
    if (!sameProtectionEvidence(evidence, protectedEndpoint.evidence)) {
      throw new BindingDisclosureError(BINDING_ERROR_CODE.BLOCKED_BY_KEY_MANAGEMENT, "protection_evidence_changed");
    }
    // This is an obvious-leak guard, not cryptographic proof. The provider
    // remains responsible for real encryption and must be independently proven.
    if (input.endpoint.address && protectedEndpoint.ciphertext.toLowerCase().includes(input.endpoint.address.toLowerCase())) {
      throw new BindingDisclosureError(BINDING_ERROR_CODE.BLOCKED_BY_KEY_MANAGEMENT, "ciphertext_contains_endpoint_plaintext");
    }
    return protectedEndpoint;
  }

  private async reveal(input: { bindingId: BindingId; prismId: string; actor: BindingOwnerActor; protectedEndpoint: NonNullable<Extract<StoredBinding, { visibility: "PRIVATE" }>["protectedEndpoint"]> }): Promise<ExecutionEndpoint> {
    const evidence = await this.requireProtection(input.prismId, input.actor);
    const provider = this.deps.privateBindingProtection!;
    let opened: Awaited<ReturnType<PrivateBindingProtectionPort["reveal"]>>;
    try {
      opened = await provider.reveal({ bindingId: input.bindingId, prismId: input.prismId, protectedEndpoint: input.protectedEndpoint });
      assertValidExecutionEndpoint(opened.endpoint);
      assertProtectionEvidence(opened.evidence);
    } catch (cause) {
      if (cause instanceof BindingDisclosureError && cause.code === BINDING_ERROR_CODE.BLOCKED_BY_KEY_MANAGEMENT) throw cause;
      throw new BindingDisclosureError(BINDING_ERROR_CODE.BLOCKED_BY_KEY_MANAGEMENT, "recovery_failed");
    }
    if (!sameProtectionEvidence(evidence, input.protectedEndpoint.evidence) || !sameProtectionEvidence(evidence, opened.evidence)) {
      throw new BindingDisclosureError(BINDING_ERROR_CODE.BLOCKED_BY_KEY_MANAGEMENT, "recovery_evidence_changed");
    }
    return opened.endpoint;
  }

  private async requireProtection(prismId: string, actor: BindingOwnerActor): Promise<ProtectionEvidence> {
    const provider = this.deps.privateBindingProtection;
    if (!provider) throw new BindingDisclosureError(BINDING_ERROR_CODE.BLOCKED_BY_KEY_MANAGEMENT, "key_management_port_unconfigured");
    let readiness;
    try {
      readiness = await provider.getReadiness({ prismId, actor });
    } catch {
      throw new BindingDisclosureError(BINDING_ERROR_CODE.BLOCKED_BY_KEY_MANAGEMENT, "key_management_readiness_unavailable");
    }
    if (!readiness || readiness.status !== "PROVEN") {
      throw new BindingDisclosureError(BINDING_ERROR_CODE.BLOCKED_BY_KEY_MANAGEMENT, "key_management_proof_required");
    }
    try {
      assertProtectionEvidence(readiness.evidence);
    } catch {
      throw new BindingDisclosureError(BINDING_ERROR_CODE.BLOCKED_BY_KEY_MANAGEMENT, "key_management_proof_required");
    }
    return readiness.evidence;
  }

  private async requireRecord(prismId: string, bindingId: string): Promise<StoredBinding> {
    const record = await this.read(() => this.deps.store.getById(bindingId));
    if (!record || record.prismId !== prismId) throw new BindingDisclosureError(BINDING_ERROR_CODE.BINDING_NOT_FOUND, "binding_not_found");
    return record;
  }

  private async compareAndSet(current: StoredBinding, next: StoredBinding): Promise<boolean> {
    return this.write(() => this.deps.store.compareAndSet({
      bindingId: current.bindingId,
      prismId: current.prismId,
      expectedVersion: current.version,
      expectedVisibility: current.visibility,
      expectedStatus: current.status,
      next,
    }));
  }

  private assertExpectedVersion(current: StoredBinding, expectedVersion: number | undefined): void {
    if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion !== current.version)) {
      throw new BindingDisclosureError(BINDING_ERROR_CODE.STALE_BINDING_VERSION, `expected_${String(expectedVersion)}_got_${current.version}`);
    }
  }

  private validPrismId(value: string): string {
    try {
      return assertValidPrismId(value);
    } catch {
      throw new BindingDisclosureError(BINDING_ERROR_CODE.INVALID_BINDING, "invalid_prism_id");
    }
  }

  private bindingId(value: string | undefined): string {
    const generated = value ?? this.deps.idGenerator.generateBindingId();
    if (typeof generated !== "string" || generated.trim().length === 0) throw new BindingDisclosureError(BINDING_ERROR_CODE.INVALID_BINDING, "binding_id_required");
    return generated;
  }

  private now(): number {
    const now = this.deps.clock.now();
    if (!Number.isFinite(now)) throw new BindingDisclosureError(BINDING_ERROR_CODE.STORE_UNAVAILABLE, "clock_unavailable");
    return Math.floor(now);
  }

  private async read<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (cause) {
      if (cause instanceof BindingDisclosureError) throw cause;
      throw new BindingDisclosureError(BINDING_ERROR_CODE.STORE_UNAVAILABLE, "binding_store_read_failed");
    }
  }

  private async write<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (cause) {
      if (cause instanceof BindingDisclosureError) throw cause;
      const code = (cause as { code?: string } | null)?.code;
      if (code === BINDING_ERROR_CODE.DUPLICATE_BINDING_ID) throw cause;
      throw new BindingDisclosureError(BINDING_ERROR_CODE.STORE_UNAVAILABLE, "binding_store_write_failed");
    }
  }
}
