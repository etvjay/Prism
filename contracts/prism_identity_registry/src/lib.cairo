// PrismIdentityRegistry — PRISM-7 vertical slice.
//
// Authority: projects/prism/system/CONTRACT_SPEC.md (OP-7-01, OP-7-02),
// EVENT_CATALOGUE.md (EVT-PRISM-IDENTITY-CREATED), DOMAIN_MODEL.md
// (OBJ-PRISM-001/002), INVARIANTS.md (INV-SYS-001/002/008/012).
//
// Scope guard (IMPLEMENTATION_PACKET): NO binding, proof verification,
// resolver, revocation, portfolio, social, bridge, STRK20 helper, shadow
// accounts, guardians, delegation, recovery, inheritance, agent authority,
// or universal account abstraction. The PRISM-8 binding lifecycle storage
// shape is reserved by documentation only; no binding operations exist.
//
// Deployment posture: immutable, no proxy (SD-002).

use starknet::ContractAddress;

/// OBJ-PRISM-001 — PrismIdentity canonical read shape (OP-7-02 output).
#[derive(Drop, Serde, PartialEq, Copy, Debug, starknet::Store)]
pub struct Identity {
    /// Controller: Starknet account authorized to mutate protected state
    /// (OBJ-PRISM-002). Mutable by layout only; rotation is OUT OF
    /// SPRINT SCOPE — no PRISM-7 entrypoint writes it after creation.
    pub controller: ContractAddress,
    /// Block number at creation.
    pub created_at_block: u64,
    /// identity_version; increments only on controller change — never on
    /// binding mutations. Starts and remains 0 throughout PRISM-7.
    pub version: u32,
}

#[starknet::interface]
pub trait IPrismIdentityRegistry<TContractState> {
    /// OP-7-01 create_identity() → prism_id
    ///
    /// Caller becomes controller of the new identity (authorized-creation
    /// rule; AUTHORITY_MATRIX §2: caller = any Starknet account, once per
    /// allocated id). The registry allocates the id; callers cannot choose
    /// one — ids are globally unique by construction (INV-SYS-001), so a
    /// duplicate/colliding creation path does not exist.
    fn create_identity(ref self: TContractState) -> felt252;

    /// OP-7-02 get_identity(prism_id) → Identity | NOT_FOUND flag
    ///
    /// Deterministic public read. Returns None for unknown ids rather
    /// than reverting (ERR-010 as view-return flag; revert_codes: []).
    fn get_identity(self: @TContractState, prism_id: felt252) -> Option<Identity>;
}

#[starknet::contract]
pub mod PrismIdentityRegistry {
    use core::num::traits::Zero;
    use starknet::ContractAddress;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };

    use super::Identity;

    /// EVT-PRISM-IDENTITY-CREATED — past-tense canonical event (schema v1).
    /// Carries exactly {prism_id, controller}; prism_id is keyed.
    /// No metadata beyond these two fields (INV-SYS-008: pseudonymous).
    ///
    /// Onchain emitted name: `PrismIdentityCreated` (the variant below).
    #[derive(Drop, starknet::Event)]
    pub struct PrismIdentityCreated {
        #[key]
        pub prism_id: felt252,
        pub controller: ContractAddress,
    }

    /// Contract event enum — canonical history for PRISM-7 consists
    /// solely of PrismIdentityCreated facts (EVENT_CATALOGUE).
    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PrismIdentityCreated: PrismIdentityCreated,
    }

    #[storage]
    struct Storage {
        // ---- OBJ-PRISM-001 identity state (PRISM-7 authoritative) ----
        /// Registry counter; last allocated PrismID. Ids start at 1.
        /// Counter-derived allocation is the authoritative enforcement of
        /// INV-SYS-001: a PrismID is never an address-typed key.
        id_counter: felt252,
        /// identities[prism_id] = {controller, created_at_block, version}
        identities: Map::<felt252, Identity>,

        // ---- PRISM-8 reserved storage shape (NOT implemented here) ----
        // Reserved for the PRISM-8 binding lifecycle in this same registry
        // lineage; never written or read by any PRISM-7 entrypoint:
        //
        // bindings: Map::<(felt252, felt252, ContractAddress), Binding>
        //   Binding {status: ACTIVE|REVOKED, bound_at_block, revoked_at_block}
        // consumed_digests: Map::<felt252, bool>   (proof digest single-use)
        //
        // Kept as documentation, not dead storage: declaring unused map
        // entries adds no information. PRISM-8's implementation run adds
        // them alongside OP-8-01..03.


    }

    #[constructor]
    fn constructor(ref self: ContractState) {
        self.id_counter.write(0);
    }

    #[abi(embed_v0)]
    impl RegistryImpl of super::IPrismIdentityRegistry<ContractState> {
        /// OP-7-01. Caller becomes controller. Emits EVT-PRISM-IDENTITY-CREATED.
        fn create_identity(ref self: ContractState) -> felt252 {
            let caller = starknet::get_caller_address();
            let block = starknet::get_block_info().unbox().block_number;

            // Allocation: fresh key per call. ERR-003 internal allocation
            // collision is unreachable by counter construction.
            let new_prism_id = self.id_counter.read() + 1;
            self.id_counter.write(new_prism_id);

            self.identities.write(
                new_prism_id,
                Identity {
                    controller: caller,
                    created_at_block: block,
                    version: 0,
                },
            );

            // Canonical past-tense fact; payload exactly {prism_id, controller}.
            self.emit(
                PrismIdentityCreated {
                    prism_id: new_prism_id,
                    controller: caller,
                },
            );

            new_prism_id
        }

        /// OP-7-02. Public deterministic read; NOT_FOUND as Option::None.
        /// Existence probe: an unallocated slot reads back as the zero
        /// value, and the zero address can never be stored as controller
        /// (caller addresses are never zero), so this is an exact check.
        fn get_identity(self: @ContractState, prism_id: felt252) -> Option<Identity> {
            let identity = self.identities.read(prism_id);
            if identity.controller.is_zero() {
                Option::None
            } else {
                Option::Some(identity)
            }
        }
    }
}
