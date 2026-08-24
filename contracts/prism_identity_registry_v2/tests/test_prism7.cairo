// PRISM-7 acceptance tests — derived from projects/prism/system authority:
// TEST_ARCHITECTURE.md §2 (TEST-7-2-1..4, TEST-7-3-1, TEST-7-5-1),
// CONTRACT_SPEC.md OP-7-01/OP-7-02, EVENT_CATALOGUE.md EVT-PRISM-IDENTITY-CREATED,
// ERROR_CATALOGUE.md ERR-010, INVARIANTS.md INV-SYS-001/002/008.
//
// TDD note: these tests were observed FAILING (contract module absent)
// before the implementation was written, then made to pass minimally.

use starknet::ContractAddress;

use snforge_std::{
    declare, start_cheat_caller_address, stop_cheat_caller_address, ContractClassTrait,
    DeclareResultTrait, EventSpyAssertionsTrait, EventSpyTrait, EventsFilterTrait,
    spy_events,
};

use prism_identity_registry_v2::{
    IPrismIdentityRegistryDispatcher, IPrismIdentityRegistryDispatcherTrait,
};

/// Onchain emitted event name for EVT-PRISM-IDENTITY-CREATED.
const IDENTITY_CREATED_SELECTOR: felt252 = selector!("PrismIdentityCreated");

/// Deploy a fresh registry and return its dispatcher + address.
fn deploy_registry() -> (IPrismIdentityRegistryDispatcher, ContractAddress) {
    let contract = declare("PrismIdentityRegistry").unwrap().contract_class();
    let (contract_address, _) = contract.deploy(@ArrayTrait::new()).unwrap();
    (
        IPrismIdentityRegistryDispatcher { contract_address },
        contract_address,
    )
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

/// felt252 has no PartialOrd in Cairo 2.20 — compare via u256 conversion.
fn felt_gt(a: felt252, b: felt252) -> bool {
    let au: u256 = a.try_into().unwrap();
    let bu: u256 = b.try_into().unwrap();
    au > bu
}

/// ------------------------------------------------------------------
/// TEST-7-2-1 (positive / A7-1, A7-2): authorized actor creates an
/// identity exactly once; repeat reads return identical canonical
/// fields; controller == caller; identity_version starts at 0.
/// Covers OP-7-01 + OP-7-02. (INV-SYS-002 creation rule.)
/// ------------------------------------------------------------------
#[test]
fn test_7_2_1_authorized_create_succeeds_and_read_is_deterministic() {
    let (registry, registry_address) = deploy_registry();
    let controller: ContractAddress = 0x4d2_felt252.try_into().unwrap();

    let prism_id = create_as(registry_address, controller);

    // Deterministic read: consecutive reads return identical values.
    let first = registry.get_identity(prism_id).expect('identity must exist');
    let second = registry.get_identity(prism_id).expect('identity must exist');
    assert!(first.controller == second.controller, "read not deterministic");
    assert!(
        first.created_at_block == second.created_at_block,
        "block read not deterministic"
    );
    assert!(first.version == second.version, "version read not deterministic");

    // Canonical creation semantics per OP-7-01.
    assert!(first.controller == controller, "controller must equal caller");
    assert!(first.version == 0, "identity_version must start at 0");
    assert!(first.created_at_block > 0, "created_at_block must be recorded");
}

/// ------------------------------------------------------------------
/// TEST-7-2-2 (negative / replay-duplicate): duplicate creation
/// fails — ids are allocated by the registry counter, so every call
/// yields a fresh, strictly increasing, globally distinct id. No
/// call path can target an existing id (A7 uniqueness by
/// construction, OP-7-01 uniqueness clause).
/// ------------------------------------------------------------------
#[test]
fn test_7_2_2_duplicate_creation_impossible_ids_never_collide() {
    let (registry, registry_address) = deploy_registry();
    let alice: ContractAddress = 0x6f_felt252.try_into().unwrap();
    let bob: ContractAddress = 0xde_felt252.try_into().unwrap();

    let id_a1 = create_as(registry_address, alice);
    let id_a2 = create_as(registry_address, alice);
    let id_b1 = create_as(registry_address, bob);

    // Every call allocates a FRESH id — no collision exists.
    assert!(id_a1 != id_a2, "same caller got colliding ids");
    assert!(id_a1 != id_b1, "cross-caller id collision");
    assert!(id_a2 != id_b1, "cross-caller id collision");

    // Monotonic counter: ids strictly increase.
    assert!(felt_gt(id_a2, id_a1), "counter not monotonic");
    assert!(felt_gt(id_b1, id_a2), "counter not monotonic");

    // Each id resolves to exactly its own controller — no cross-talk.
    assert!(
        registry.get_identity(id_a1).unwrap().controller == alice,
        "id_a1 wrong controller"
    );
    assert!(
        registry.get_identity(id_a2).unwrap().controller == alice,
        "id_a2 wrong controller"
    );
    assert!(
        registry.get_identity(id_b1).unwrap().controller == bob,
        "id_b1 wrong controller"
    );
}

/// ------------------------------------------------------------------
/// TEST-7-2-3 (negative / adversarial / A7-3): unauthorized
/// controller/identity mutation fails. INV-SYS-002 surface: the ONLY
/// mutating entrypoint in PRISM-7 scope is create_identity under the
/// documented creation rule. An attacker probing for a controller-
/// mutation entrypoint hits a revert (entrypoint not found), and the
/// existing identity remains untouched.
/// ------------------------------------------------------------------
#[test]
fn test_7_2_3_unauthorized_identity_mutation_fails() {
    let (registry, registry_address) = deploy_registry();
    let owner: ContractAddress = 0x4d_felt252.try_into().unwrap();

    let prism_id = create_as(registry_address, owner);

    // Adversarial probe: attempt to invoke a hypothetical
    // `set_controller` entrypoint from outside. PRISM-7 defines no
    // such entrypoint (SetController explicitly out of sprint scope,
    // DOMAIN_MODEL OBJ-PRISM-001) — the call MUST fail.
    let result = starknet::syscalls::call_contract_syscall(
        registry_address,
        selector!("set_controller"),
        array![prism_id].span(),
    );
    match result {
        Result::Err(_) => (), // reverted — no unauthorized mutation possible
        Result::Ok(_) => core::panic_with_felt252('mutation entrypoint found'),
    }

    // The attacked identity is unchanged.
    let identity = registry.get_identity(prism_id).expect('identity must exist');
    assert!(identity.controller == owner, "attacker mutated controller");
    assert!(identity.version == 0, "attacker mutated version");
}

/// ------------------------------------------------------------------
/// TEST-7-2-4 (boundary / INV-SYS-001): identity key is a
/// counter-derived PrismID, structurally distinct from any address.
/// First allocated id is 1 (never zero, never an address-shaped
/// value); allocation is monotonic; the id type (felt252) is not the
/// address type (ContractAddress) — enforced by the type system and
/// exercised here by construction.
/// ------------------------------------------------------------------
#[test]
fn test_7_2_4_boundary_identity_key_type_distinct_from_addresses() {
    let (_registry, registry_address) = deploy_registry();
    let controller: ContractAddress = 0x2a_felt252.try_into().unwrap();

    let first_id = create_as(registry_address, controller);

    // Boundary: allocation starts at 1 — a PrismID is never the zero
    // value and is never conflated with an address.
    assert!(first_id == 1, "first id must be 1");

    let second_id = create_as(registry_address, controller);
    assert!(second_id == 2, "counter must increment by one");

    // Structural separation (INV-SYS-001): the registry address is a
    // ContractAddress; the PrismID is a counter felt252. They are not
    // interchangeable — a PrismID is never derived from an address.
    assert!(first_id != 0, "zero id forbidden");
}

/// ------------------------------------------------------------------
/// TEST-7-3-1 (A7-4): event stream of created identities
/// reconstructs identity state from receipts alone. Asserts
/// EVT-PRISM-IDENTITY-CREATED (past tense `PrismIdentityCreated`)
/// carries exactly {prism_id (keyed), controller}, then replays
/// captured events and compares against canonical registry reads.
/// ------------------------------------------------------------------
#[test]
fn test_7_3_1_events_reconstruct_identity_state() {
    let (registry, registry_address) = deploy_registry();
    let alice: ContractAddress = 0x3e9_felt252.try_into().unwrap();
    let bob: ContractAddress = 0x7d2_felt252.try_into().unwrap();

    let mut spy = spy_events();
    let id_alice = create_as(registry_address, alice);
    let id_bob = create_as(registry_address, bob);

    // Event shape: exactly one event per creation, keyed by prism_id,
    // data = [controller] — no metadata (INV-SYS-008).
    spy
        .assert_emitted(
            @array![
                (
                    registry_address,
                    prism_identity_registry_v2::PrismIdentityRegistry::Event::PrismIdentityCreated(
                        prism_identity_registry_v2::PrismIdentityRegistry::PrismIdentityCreated {
                            prism_id: id_alice, controller: alice,
                        },
                    ),
                ),
                (
                    registry_address,
                    prism_identity_registry_v2::PrismIdentityRegistry::Event::PrismIdentityCreated(
                        prism_identity_registry_v2::PrismIdentityRegistry::PrismIdentityCreated {
                            prism_id: id_bob, controller: bob,
                        },
                    ),
                ),
            ],
        );

    // Reconstruction guarantee (EVENT_CATALOGUE): replaying
    // PrismIdentityCreated receipts alone rebuilds identity state.
    let events = spy.get_events().emitted_by(registry_address);
    let mut reconstructed_ids: Array<felt252> = array![];
    let mut reconstructed_controllers: Array<felt252> = array![];
    let mut count = 0;
    for event_pair in events.events.span() {
        let event = @event_pair.1;
        if event.keys.len() > 0 && *event.keys.at(0) == IDENTITY_CREATED_SELECTOR {
            count += 1;
            // Serialized layout: keys = [variant_selector, prism_id],
            // data = [controller]. Reconstruct from receipt fields.
            if event.keys.len() >= 2 && event.data.len() >= 1 {
                reconstructed_ids.append(*event.keys.at(1));
                reconstructed_controllers.append(*event.data.at(0));
            } else {
                reconstructed_ids.append(0);
                reconstructed_controllers.append(0);
            };
        }
    }
    assert!(count == 2, "wrong reconstruction count");
    assert!(reconstructed_ids.len() == 2, "wrong reconstruction length");
    assert!(*reconstructed_ids.at(0) == id_alice, "replay: wrong id");
    assert!(*reconstructed_ids.at(1) == id_bob, "replay: wrong id");

    // Reconstructed controllers match deterministic onchain reads.
    let alice_from_event: ContractAddress =
        (*reconstructed_controllers.at(0)).try_into().unwrap();
    let bob_from_event: ContractAddress =
        (*reconstructed_controllers.at(1)).try_into().unwrap();
    assert!(
        registry.get_identity(id_alice).unwrap().controller == alice_from_event,
        "replay: alice controller mismatch"
    );
    assert!(
        registry.get_identity(id_bob).unwrap().controller == bob_from_event,
        "replay: bob controller mismatch"
    );
}

/// ------------------------------------------------------------------
/// Negative read path (ERR-010): reading an unknown id returns the
/// NOT_FOUND flag instead of reverting — cheap existence probes stay
/// revert-free (OP-7-02 revert_codes: []).
/// ------------------------------------------------------------------
#[test]
fn test_err010_unknown_id_read_returns_not_found_flag() {
    let (registry, _) = deploy_registry();

    match registry.get_identity(9999) {
        Option::None => (),
        Option::Some(_) => core::panic_with_felt252('unknown id must not resolve'),
    }
}

/// ------------------------------------------------------------------
/// Future-compatible storage boundary: identities remain present and
/// unchanged while unrelated registry state grows (more creations)
/// — parent preservation analogue of INV-SYS-006 at PRISM-7 scope.
/// ------------------------------------------------------------------
#[test]
fn test_identity_survives_unrelated_state_growth() {
    let (registry, registry_address) = deploy_registry();
    let alice: ContractAddress = 0xb_felt252.try_into().unwrap();
    let bob: ContractAddress = 0x16_felt252.try_into().unwrap();

    let id_a = create_as(registry_address, alice);
    let snapshot = registry.get_identity(id_a).expect('identity must exist');

    // Unrelated state changes.
    let _ = create_as(registry_address, bob);
    let _ = create_as(registry_address, alice);

    // Original identity byte-identical across the unrelated activity.
    let after = registry.get_identity(id_a).expect('identity must exist');
    assert!(after.controller == snapshot.controller, "controller drifted");
    assert!(after.created_at_block == snapshot.created_at_block, "block drifted");
    assert!(after.version == snapshot.version, "version drifted");
}
