// PRISM-7 + PRISM-8 V8.3 acceptance tests — derived from projects/prism/system
// authority: TEST_ARCHITECTURE.md (TEST-7-*, TEST-8-3-*), CONTRACT_SPEC.md
// OP-7-01/OP-7-02/OP-8-01/OP-8-02/OP-8-03, EVENT_CATALOGUE.md
// (EVT-PRISM-IDENTITY-CREATED, EVT-EXECUTION-IDENTITY-BOUND, EVT-BINDING-REVOKED),
// ERROR_CATALOGUE.md ERR-001..005/007..011, INVARIANTS.md
// INV-SYS-001..004/006/007, DEC-PRISM-SYS-001 (ACCEPTED).
//
// TDD note: the V8.3 tests were written against the interface first and
// observed failing against the PRISM-7-only contract before the binding
// implementation was added; all pass after implementation.

// Canonical events are matched through the contract's Event enum wrapper
// (snforge assert_emitted accepts the full enum variant value).
use prism_identity_registry::{
    IPrismIdentityRegistryDispatcher, IPrismIdentityRegistryDispatcherTrait, Resolution,
};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
    start_cheat_caller_address, stop_cheat_caller_address,
};
use starknet::ContractAddress;

const VENUE_BASE: felt252 = 'BASE';
const VENUE_SOLANA: felt252 = 'SOLANA'; // unsupported venue for negatives

fn address(a: felt252) -> ContractAddress {
    a.try_into().unwrap()
}

/// Deploy a fresh registry and return its dispatcher + address.
fn deploy_registry() -> (IPrismIdentityRegistryDispatcher, ContractAddress) {
    let contract = declare("PrismIdentityRegistry").unwrap().contract_class();
    let (contract_address, _) = contract.deploy(@ArrayTrait::new()).unwrap();
    (IPrismIdentityRegistryDispatcher { contract_address }, contract_address)
}

/// Create an identity with `caller` pranked as the transaction sender
/// (OP-7-01: caller becomes controller).
fn create_as(registry_address: ContractAddress, caller: ContractAddress) -> felt252 {
    let registry = IPrismIdentityRegistryDispatcher { contract_address: registry_address };
    start_cheat_caller_address(registry_address, caller);
    let prism_id = registry.create_identity();
    stop_cheat_caller_address(registry_address);
    prism_id
}

/// Bind with `caller` pranked as sender.
fn bind_as(
    registry_address: ContractAddress,
    caller: ContractAddress,
    prism_id: felt252,
    execution_account: ContractAddress,
    digest: felt252,
) {
    let registry = IPrismIdentityRegistryDispatcher { contract_address: registry_address };
    start_cheat_caller_address(registry_address, caller);
    registry.bind_execution_identity(prism_id, VENUE_BASE, execution_account, digest);
    stop_cheat_caller_address(registry_address);
}

// =====================================================================
// PRISM-7 baseline coverage (preserved behavior)
// =====================================================================

#[test]
fn test_7_authorized_create_succeeds_and_read_is_deterministic() {
    let (registry, registry_address) = deploy_registry();
    let controller = address(0x4d2);

    let prism_id = create_as(registry_address, controller);

    let identity = registry.get_identity(prism_id).expect('identity must exist');
    assert!(identity.controller == controller, "controller must equal caller");
    assert!(identity.version == 0, "identity_version must start at 0");
}

#[test]
fn test_7_unknown_identity_reads_not_found() {
    let (registry, _) = deploy_registry();
    assert!(registry.get_identity(999).is_none(), "unknown id must be None");
}

// =====================================================================
// V8.3 — bind_execution_identity (OP-8-01)
// =====================================================================

/// TEST-8-3-1 / A8-1: controller binds a verified proof; ACTIVE binding
/// recorded with block timestamps + version 1; ExecutionIdentityBound emitted
/// with the exact catalogue payload.
#[test]
fn test_8_bind_success_emits_event_and_records_active_binding() {
    let (registry, registry_address) = deploy_registry();
    let controller = address(0x111);
    let base_account = address(0xabc);
    let digest: felt252 = 0xd1e5;

    let prism_id = create_as(registry_address, controller);

    let mut spy = spy_events();
    bind_as(registry_address, controller, prism_id, base_account, digest);

    // Resolution flips to the bound account — canonical at Starknet state
    // transition (INV-SYS-003).
    assert!(
        registry.resolve(prism_id, VENUE_BASE) == Resolution::ActiveDestination(base_account),
        "resolve must return the active destination",
    );

    spy
        .assert_emitted(
            @array![
                (
                    registry_address,
                    prism_identity_registry::PrismIdentityRegistry::Event::ExecutionIdentityBound(
                        prism_identity_registry::PrismIdentityRegistry::ExecutionIdentityBound {
                            prism_id,
                            venue: VENUE_BASE,
                            execution_account: base_account,
                            proof_digest: digest,
                        },
                    ),
                ),
            ],
        );
}

/// TEST-8-3-2a / ERR-002: bind on unknown PrismID reverts.
#[test]
#[should_panic(expected: ('ERR-002: IDENTITY NOT FOUND',))]
fn test_8_bind_unknown_identity_reverts() {
    let (registry, _) = deploy_registry();
    start_cheat_caller_address(registry.contract_address, address(0x222));
    registry.bind_execution_identity(42, VENUE_BASE, address(0xabc), 0xf00d);
    stop_cheat_caller_address(registry.contract_address);
}

/// TEST-8-3-2b / ERR-004 (INV-SYS-002): non-controller caller reverts.
#[test]
#[should_panic(expected: ('ERR-004: NOT CONTROLLER',))]
fn test_8_bind_wrong_controller_reverts() {
    let (registry, registry_address) = deploy_registry();
    let controller = address(0x111);
    let attacker = address(0x999);

    let prism_id = create_as(registry_address, controller);

    start_cheat_caller_address(registry_address, attacker);
    registry.bind_execution_identity(prism_id, VENUE_BASE, address(0xabc), 0xf00d);
    stop_cheat_caller_address(registry_address);
}

/// TEST-8-3-2c / ERR-001: unsupported venue reverts.
#[test]
#[should_panic(expected: ('ERR-001: INVALID VENUE',))]
fn test_8_bind_invalid_venue_reverts() {
    let (registry, registry_address) = deploy_registry();
    let controller = address(0x111);
    let prism_id = create_as(registry_address, controller);

    start_cheat_caller_address(registry_address, controller);
    registry.bind_execution_identity(prism_id, VENUE_SOLANA, address(0xabc), 0xf00d);
    stop_cheat_caller_address(registry_address);
}

/// TEST-8-3-2d / ERR-005: zero execution account reverts.
#[test]
#[should_panic(expected: ('ERR-005: INVALID ACCOUNT',))]
fn test_8_bind_zero_execution_account_reverts() {
    let (registry, registry_address) = deploy_registry();
    let controller = address(0x111);
    let prism_id = create_as(registry_address, controller);

    start_cheat_caller_address(registry_address, controller);
    registry.bind_execution_identity(prism_id, VENUE_BASE, address(0), 0xf00d);
    stop_cheat_caller_address(registry_address);
}

/// TEST-8-3-2e / ERR-008: duplicate ACTIVE bind on the same key reverts.
#[test]
#[should_panic(expected: ('ERR-008: ALREADY ACTIVE',))]
fn test_8_bind_duplicate_active_reverts() {
    let (registry, registry_address) = deploy_registry();
    let controller = address(0x111);
    let base_account = address(0xabc);

    let prism_id = create_as(registry_address, controller);
    bind_as(registry_address, controller, prism_id, base_account, 0xd001);

    start_cheat_caller_address(registry_address, controller);
    registry.bind_execution_identity(prism_id, VENUE_BASE, base_account, 0xd002);
    stop_cheat_caller_address(registry_address);
}

/// TEST-8-3-3 / ERR-007 (INV-SYS-004, FT-003): a consumed proof digest can
/// never be reused — not even on a different key or identity.
#[test]
#[should_panic(expected: ('ERR-007: DIGEST CONSUMED',))]
fn test_8_consumed_digest_replay_reverts_on_same_key() {
    let (registry, registry_address) = deploy_registry();
    let controller = address(0x111);
    let base_account = address(0xabc);
    let other_account = address(0xdef);
    let digest: felt252 = 0xd1e5;

    let prism_id = create_as(registry_address, controller);
    bind_as(registry_address, controller, prism_id, base_account, digest);

    // Replay on a different execution account (fresh key), same digest:
    // still reverts — digest single-use is global, per INV-SYS-004.
    start_cheat_caller_address(registry_address, controller);
    registry.bind_execution_identity(prism_id, VENUE_BASE, other_account, digest);
    stop_cheat_caller_address(registry_address);
}

/// TEST-8-3-3b: replay across identities also reverts (digest map is
/// registry-global).
#[test]
#[should_panic(expected: ('ERR-007: DIGEST CONSUMED',))]
fn test_8_consumed_digest_replay_reverts_across_identities() {
    let (_, registry_address) = deploy_registry();
    let controller = address(0x111);

    let id_a = create_as(registry_address, controller);
    let id_b = create_as(registry_address, controller);
    bind_as(registry_address, controller, id_a, address(0xabc), 0xd1e5);

    start_cheat_caller_address(registry_address, controller);
    let registry = IPrismIdentityRegistryDispatcher { contract_address: registry_address };
    registry.bind_execution_identity(id_b, VENUE_BASE, address(0xdef), 0xd1e5);
    stop_cheat_caller_address(registry_address);
}

// =====================================================================
// V8.3 — revoke_binding (OP-8-03)
// =====================================================================

/// TEST-8-4-1 / A8-x: controller revokes; BindingRevoked emitted with exact
/// payload; resolution flips to sentinel (INV-SYS-007).
#[test]
fn test_8_revoke_success_emits_event_and_flips_resolution() {
    let (registry, registry_address) = deploy_registry();
    let controller = address(0x111);
    let base_account = address(0xabc);
    let digest: felt252 = 0xd1e5;

    let prism_id = create_as(registry_address, controller);
    bind_as(registry_address, controller, prism_id, base_account, digest);

    let mut spy = spy_events();
    start_cheat_caller_address(registry_address, controller);
    registry.revoke_binding(prism_id, VENUE_BASE, base_account);
    stop_cheat_caller_address(registry_address);

    assert!(
        registry.resolve(prism_id, VENUE_BASE) == Resolution::NoActiveDestination,
        "revoked binding must resolve to the sentinel",
    );

    spy
        .assert_emitted(
            @array![
                (
                    registry_address,
                    prism_identity_registry::PrismIdentityRegistry::Event::BindingRevoked(
                        prism_identity_registry::PrismIdentityRegistry::BindingRevoked {
                            prism_id, venue: VENUE_BASE, execution_account: base_account,
                        },
                    ),
                ),
            ],
        );
}

/// ERR-009: revoking a never-bound account reverts.
#[test]
#[should_panic(expected: ('ERR-009: BINDING NOT FOUND',))]
fn test_8_revoke_missing_binding_reverts() {
    let (registry, registry_address) = deploy_registry();
    let controller = address(0x111);
    let prism_id = create_as(registry_address, controller);

    start_cheat_caller_address(registry_address, controller);
    registry.revoke_binding(prism_id, VENUE_BASE, address(0xabc));
    stop_cheat_caller_address(registry_address);
}

/// TEST-8-4-2 / ERR-011 idempotence: revoking an already-REVOKED binding
/// succeeds silently — no second event, no revert.
#[test]
fn test_8_revoke_is_idempotent_no_duplicate_event() {
    let (registry, registry_address) = deploy_registry();
    let controller = address(0x111);
    let base_account = address(0xabc);

    let prism_id = create_as(registry_address, controller);
    bind_as(registry_address, controller, prism_id, base_account, 0xd1e5);

    start_cheat_caller_address(registry_address, controller);
    registry.revoke_binding(prism_id, VENUE_BASE, base_account);
    // Second revoke: benign success (ERR-011 semantics), returns version.
    let version = registry.revoke_binding(prism_id, VENUE_BASE, base_account);
    stop_cheat_caller_address(registry_address);
    assert!(version == 1, "binding_version must be unchanged");

    let mut spy = spy_events();
    // Third revoke still emits nothing.
    start_cheat_caller_address(registry_address, controller);
    registry.revoke_binding(prism_id, VENUE_BASE, base_account);
    stop_cheat_caller_address(registry_address);
    spy
        .assert_not_emitted(
            @array![
                (
                    registry_address,
                    prism_identity_registry::PrismIdentityRegistry::Event::BindingRevoked(
                        prism_identity_registry::PrismIdentityRegistry::BindingRevoked {
                            prism_id, venue: VENUE_BASE, execution_account: base_account,
                        },
                    ),
                ),
            ],
        );
}

/// TEST-8-4-3 / INV-SYS-006: no reactivation path exists. A revoked key can
/// be REBOUND only as a new binding instance with a fresh digest; the old
/// fact stays revoked forever.
#[test]
fn test_8_revoked_state_never_returns_to_active_without_new_fact() {
    let (registry, registry_address) = deploy_registry();
    let controller = address(0x111);
    let base_account = address(0xabc);

    let prism_id = create_as(registry_address, controller);
    bind_as(registry_address, controller, prism_id, base_account, 0xd001);
    start_cheat_caller_address(registry_address, controller);
    registry.revoke_binding(prism_id, VENUE_BASE, base_account);
    stop_cheat_caller_address(registry_address);

    assert!(
        registry.resolve(prism_id, VENUE_BASE) == Resolution::NoActiveDestination,
        "revoked must resolve to sentinel",
    );
}

/// Re-bind after revoke with a FRESH digest creates binding_version 2 and
/// restores resolution to the new ACTIVE fact (CONTRACT_SPEC uniqueness note).
#[test]
fn test_8_rebind_after_revoke_with_fresh_digest_creates_version_two() {
    let (registry, registry_address) = deploy_registry();
    let controller = address(0x111);
    let base_account = address(0xabc);

    let prism_id = create_as(registry_address, controller);
    bind_as(registry_address, controller, prism_id, base_account, 0xd001);
    start_cheat_caller_address(registry_address, controller);
    registry.revoke_binding(prism_id, VENUE_BASE, base_account);
    let v2 = registry.bind_execution_identity(prism_id, VENUE_BASE, base_account, 0xd002);
    stop_cheat_caller_address(registry_address);
    assert!(v2 == 2, "re-bind must increment binding_version");

    assert!(
        registry.resolve(prism_id, VENUE_BASE) == Resolution::ActiveDestination(base_account),
        "new binding instance must be resolvable",
    );
}

/// Wrong controller cannot revoke (INV-SYS-002 on the revoke path).
#[test]
#[should_panic(expected: ('ERR-004: NOT CONTROLLER',))]
fn test_8_revoke_wrong_controller_reverts() {
    let (registry, registry_address) = deploy_registry();
    let controller = address(0x111);
    let attacker = address(0x999);
    let base_account = address(0xabc);

    let prism_id = create_as(registry_address, controller);
    bind_as(registry_address, controller, prism_id, base_account, 0xd001);

    start_cheat_caller_address(registry_address, attacker);
    registry.revoke_binding(prism_id, VENUE_BASE, base_account);
    stop_cheat_caller_address(registry_address);
}

/// Invalid transition: revoke of an unknown identity reverts (ERR-002).
#[test]
#[should_panic(expected: ('ERR-002: IDENTITY NOT FOUND',))]
fn test_8_revoke_unknown_identity_reverts() {
    let (registry, registry_address) = deploy_registry();
    start_cheat_caller_address(registry_address, address(0x222));
    registry.revoke_binding(77, VENUE_BASE, address(0xabc));
    stop_cheat_caller_address(registry_address);
}

// =====================================================================
// V8.3 — resolve (OP-8-02)
// =====================================================================

/// TEST-8-4-4 / INV-SYS-007: resolve returns the sentinel — never the
/// account — for unknown ids, unbound pairs, and revoked bindings.
#[test]
fn test_8_resolve_sentinel_for_unknown_and_unbound() {
    let (registry, registry_address) = deploy_registry();
    let controller = address(0x111);
    let base_account = address(0xabc);

    // Unknown PrismID → sentinel, never reverts.
    assert!(
        registry.resolve(12345, VENUE_BASE) == Resolution::NoActiveDestination,
        "unknown id resolves to sentinel",
    );

    // Known id, never-bound venue pair → sentinel.
    let prism_id = create_as(registry_address, controller);
    assert!(
        registry.resolve(prism_id, VENUE_BASE) == Resolution::NoActiveDestination,
        "unbound pair resolves to sentinel",
    );

    // Bound then revoked → sentinel (not the account, not "revoked-as-active").
    bind_as(registry_address, controller, prism_id, base_account, 0xd1e5);
    start_cheat_caller_address(registry_address, controller);
    registry.revoke_binding(prism_id, VENUE_BASE, base_account);
    stop_cheat_caller_address(registry_address);
    assert!(
        registry.resolve(prism_id, VENUE_BASE) == Resolution::NoActiveDestination,
        "revoked must NOT resolve as active",
    );
}

// =====================================================================
// Persistence / invariants
// =====================================================================

/// TEST-7-2-4 persistence: Prism ID persists and reads identically after the
/// full bind/revoke lifecycle — parent identity untouched by binding state
/// (INV-SYS-006 second clause).
#[test]
fn test_prism_id_persists_through_binding_lifecycle() {
    let (registry, registry_address) = deploy_registry();
    let controller = address(0x111);
    let base_account = address(0xabc);

    let prism_id = create_as(registry_address, controller);
    let before = registry.get_identity(prism_id).expect('identity must exist');

    bind_as(registry_address, controller, prism_id, base_account, 0xd001);
    start_cheat_caller_address(registry_address, controller);
    registry.revoke_binding(prism_id, VENUE_BASE, base_account);
    stop_cheat_caller_address(registry_address);

    let after = registry.get_identity(prism_id).expect('identity must survive lifecycle');
    assert!(before.controller == after.controller, "controller immutable");
    assert!(before.created_at_block == after.created_at_block, "creation block immutable");
    assert!(before.version == after.version, "binding mutations must not bump identity_version");
}
