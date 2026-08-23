// PrismIdentityRegistry — PRISM-7 vertical slice + PRISM-8 V8.3 binding slice.
//
// Authority: projects/prism/system/CONTRACT_SPEC.md (OP-7-01, OP-7-02, OP-8-01,
// OP-8-02, OP-8-03), EVENT_CATALOGUE.md (EVT-PRISM-IDENTITY-CREATED,
// EVT-EXECUTION-IDENTITY-BOUND, EVT-BINDING-REVOKED), DOMAIN_MODEL.md
// (OBJ-PRISM-001/002/003), INVARIANTS.md (INV-SYS-001..004/006/012),
// ERROR_CATALOGUE.md (ERR-001..005/007..011).
//
// DEC-PRISM-SYS-001 (ACCEPTED — Option A, owner Jason, 2026-08-23): the backend
// verifies the Base ownership proof via the EOA -> EIP-1271 -> ERC-6492 ladder;
// the user's Starknet controller signs the binding transaction; this registry
// enforces caller == identity.controller, consumes the proof digest exactly once
// onchain, and makes the binding canonical ONLY at the Starknet state transition.
// The registry deliberately does NOT re-verify Base signatures onchain.
//
// Scope guard: NO proxy/upgradeability, NO social metadata, NO balances, NO
// bridge/value movement, NO controller rotation, NO cross-ID exclusivity
// (DEC-PRISM-SYS-002 unresolved), NO multiple ACTIVE destinations per
// (prism_id, venue), NO reactivation of revoked bindings.
//
// Deployment posture: immutable, no proxy (SD-002).

use starknet::ContractAddress;

/// OBJ-PRISM-001 — PrismIdentity canonical read shape (OP-7-02 output).
#[derive(Drop, Serde, PartialEq, Copy, Debug, starknet::Store)]
pub struct Identity {
    /// Controller: Starknet account authorized to mutate protected state
    /// (OBJ-PRISM-002). Mutable by layout only; rotation is OUT OF
    /// SPRINT SCOPE — no entrypoint writes it after creation.
    pub controller: ContractAddress,
    /// Block number at creation.
    pub created_at_block: u64,
    /// identity_version; increments only on controller change — never on
    /// binding mutations. Starts and remains 0 throughout this slice.
    pub version: u32,
}

/// OBJ-PRISM-003 — canonical binding state (STATE_MACHINES SM-PRISM-002).
/// ACTIVE and REVOKED are the only states; REVOKED is terminal
/// (INV-SYS-006: no reactivation path exists).
#[derive(Drop, Serde, PartialEq, Copy, Debug, starknet::Store)]
pub struct Binding {
    /// true = ACTIVE, false = REVOKED. Absent key = never bound.
    pub active: bool,
    /// Block number at which the binding became canonical (bind tx).
    pub bound_at_block: u64,
    /// Block number at revocation; 0 while ACTIVE.
    pub revoked_at_block: u64,
    /// Per-key binding sequence; increments on each bind of the same key.
    /// Starts at 1 for the first binding instance.
    pub binding_version: u32,
}

/// OP-8-02 resolve() output: the ACTIVE destination or the typed sentinel.
/// Revoked state is NEVER returned as an active destination (INV-SYS-007).
#[derive(Drop, Serde, PartialEq, Copy, Debug)]
pub enum Resolution {
    ActiveDestination: ContractAddress,
    NoActiveDestination,
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

    /// OP-8-01 bind_execution_identity(prism_id, venue, execution_account, proof_digest)
    ///
    /// Controller-only acceptance of a verified Base ownership proof as a
    /// canonical ACTIVE binding (DEC-PRISM-SYS-001). Consumes the proof
    /// digest exactly once onchain (INV-SYS-004). Emits
    /// ExecutionIdentityBound. Supported venue: BASE only (ERR-001).
    fn bind_execution_identity(
        ref self: TContractState,
        prism_id: felt252,
        venue: felt252,
        execution_account: ContractAddress,
        proof_digest: felt252,
    ) -> u32;

    /// OP-8-02 resolve(prism_id, venue) → ActiveDestination | NoActiveDestination
    ///
    /// Public deterministic read. Never reverts for missing/revoked —
    /// returns the sentinel (INV-SYS-007 semantics).
    fn resolve(self: @TContractState, prism_id: felt252, venue: felt252) -> Resolution;

    /// OP-8-03 revoke_binding(prism_id, venue, execution_account)
    ///
    /// Controller-only termination of a binding. Idempotent per ERR-011:
    /// revoking an already-REVOKED binding succeeds without emitting a
    /// duplicate event. Irreversible: no reactivation entrypoint exists
    /// (INV-SYS-006). Returns the binding_version of the (existing)
    /// binding instance.
    fn revoke_binding(
        ref self: TContractState,
        prism_id: felt252,
        venue: felt252,
        execution_account: ContractAddress,
    ) -> u32;
}

#[starknet::contract]
pub mod PrismIdentityRegistry {
    use core::num::traits::Zero;
    use starknet::ContractAddress;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use super::{Binding, Identity, Resolution};

    /// Canonical venue domain type: BASE only in this slice (DEC-PRISM-005).
    /// Explicit felt252 constants — deterministic keying, no string parsing.
    pub const VENUE_BASE: felt252 = 'BASE';

    /// ERR-001 invalid_venue — any venue value outside the supported set.
    const ERR_INVALID_VENUE: felt252 = 'ERR-001: INVALID VENUE';
    /// ERR-002 identity_not_found — bind/revoke target PrismID unknown.
    const ERR_IDENTITY_NOT_FOUND: felt252 = 'ERR-002: IDENTITY NOT FOUND';
    /// ERR-004 not_controller — caller != identity.controller.
    const ERR_NOT_CONTROLLER: felt252 = 'ERR-004: NOT CONTROLLER';
    /// ERR-005 invalid_execution_account — zero-address class guard.
    const ERR_INVALID_EXECUTION_ACCOUNT: felt252 = 'ERR-005: INVALID ACCOUNT';
    /// ERR-007 proof_digest_already_consumed — onchain replay guard hit.
    const ERR_DIGEST_CONSUMED: felt252 = 'ERR-007: DIGEST CONSUMED';
    /// ERR-008 binding_already_active — duplicate ACTIVE bind on same key.
    const ERR_BINDING_ALREADY_ACTIVE: felt252 = 'ERR-008: ALREADY ACTIVE';
    /// ERR-009 binding_not_found — revoke target has no binding instance.
    const ERR_BINDING_NOT_FOUND: felt252 = 'ERR-009: BINDING NOT FOUND';

    /// EVT-PRISM-IDENTITY-CREATED — past-tense canonical event (schema v1).
    /// Carries exactly {prism_id, controller}; prism_id is keyed.
    /// No metadata beyond these two fields (INV-SYS-008: pseudonymous).
    #[derive(Drop, starknet::Event)]
    pub struct PrismIdentityCreated {
        #[key]
        pub prism_id: felt252,
        pub controller: ContractAddress,
    }

    /// EVT-EXECUTION-IDENTITY-BOUND — past-tense canonical event (schema v1).
    /// Payload exactly {prism_id, venue, execution_account, proof_digest}
    /// per EVENT_CATALOGUE; keys carry the binding key coordinates.
    #[derive(Drop, starknet::Event)]
    pub struct ExecutionIdentityBound {
        #[key]
        pub prism_id: felt252,
        #[key]
        pub venue: felt252,
        #[key]
        pub execution_account: ContractAddress,
        pub proof_digest: felt252,
    }

    /// EVT-BINDING-REVOKED — past-tense canonical event (schema v1).
    /// Payload exactly {prism_id, venue, execution_account} per EVENT_CATALOGUE.
    #[derive(Drop, starknet::Event)]
    pub struct BindingRevoked {
        #[key]
        pub prism_id: felt252,
        #[key]
        pub venue: felt252,
        #[key]
        pub execution_account: ContractAddress,
    }

    /// Contract event enum — canonical history consists solely of
    /// PrismIdentityCreated / ExecutionIdentityBound / BindingRevoked facts
    /// (EVENT_CATALOGUE reconstruction guarantee).
    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PrismIdentityCreated: PrismIdentityCreated,
        ExecutionIdentityBound: ExecutionIdentityBound,
        BindingRevoked: BindingRevoked,
    }

    #[storage]
    struct Storage {
        // ---- OBJ-PRISM-001 identity state (PRISM-7 authoritative) ----
        /// Registry counter; last allocated PrismID. Ids start at 1.
        /// Counter-derived allocation is the authoritative enforcement of
        /// INV-SYS-001: a PrismID is never an address-typed key.
        id_counter: felt252,
        /// identities[prism_id] = {controller, created_at_block, version}
        identities: Map<felt252, Identity>,
        // ---- PRISM-8 V8.3 binding lifecycle storage ----
        /// bindings[(prism_id, venue, execution_account)] — deterministic
        /// composite key; status + block timestamps + per-key version.
        bindings: Map<(felt252, felt252, ContractAddress), Binding>,
        /// consumed_digests[proof_digest] = true once accepted onchain.
        /// Single-use forever (INV-SYS-004); never cleared.
        consumed_digests: Map<felt252, bool>,
        /// O(1) resolution pointer: active_destinations[(prism_id, venue)]
        /// names the currently ACTIVE execution account for the pair, or
        /// zero when none. Written on bind, cleared-on-revoke iff it still
        /// names the revoked account (stale pointers cannot survive).
        active_destinations: Map<(felt252, felt252), ContractAddress>,
    }

    #[constructor]
    fn constructor(ref self: ContractState) {
        self.id_counter.write(0);
    }

    #[abi(embed_v0)]
    impl RegistryImpl of super::IPrismIdentityRegistry<ContractState> {
        /// OP-7-01. Caller becomes controller. Emits PrismIdentityCreated.
        fn create_identity(ref self: ContractState) -> felt252 {
            let caller = starknet::get_caller_address();
            let block = starknet::get_block_info().unbox().block_number;

            // Allocation: fresh key per call. ERR-003 internal allocation
            // collision is unreachable by counter construction.
            let new_prism_id = self.id_counter.read() + 1;
            self.id_counter.write(new_prism_id);

            self
                .identities
                .write(
                    new_prism_id,
                    Identity { controller: caller, created_at_block: block, version: 0 },
                );

            // Canonical past-tense fact; payload exactly {prism_id, controller}.
            self.emit(PrismIdentityCreated { prism_id: new_prism_id, controller: caller });

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

        /// OP-8-01. Order of checks: existence → authorization → venue →
        /// account validity → digest single-use → one-active-destination →
        /// duplicate-active. Each failure reverts before ANY storage write.
        /// A Prism ID has at most one ACTIVE destination per venue; a new
        /// binding requires revoking the current one first.
        fn bind_execution_identity(
            ref self: ContractState,
            prism_id: felt252,
            venue: felt252,
            execution_account: ContractAddress,
            proof_digest: felt252,
        ) -> u32 {
            // ERR-002: identity must exist.
            let identity = self.identities.read(prism_id);
            assert(!identity.controller.is_zero(), ERR_IDENTITY_NOT_FOUND);

            // ERR-004 (INV-SYS-002): only the identity's controller may bind.
            let caller = starknet::get_caller_address();
            assert(caller == identity.controller, ERR_NOT_CONTROLLER);

            // ERR-001: venue must be a supported domain value.
            assert(venue == VENUE_BASE, ERR_INVALID_VENUE);

            // ERR-005: zero address is not a valid execution destination.
            assert(!execution_account.is_zero(), ERR_INVALID_EXECUTION_ACCOUNT);

            let key = (prism_id, venue, execution_account);
            let existing = self.bindings.read(key);

            // ERR-007 (INV-SYS-004): each proof digest is consumable exactly
            // once ever, regardless of binding state. Replay takes precedence
            // over destination-conflict reporting so the replay invariant is
            // stable across same-key and different-key attempts.
            assert(!self.consumed_digests.read(proof_digest), ERR_DIGEST_CONSUMED);

            // At most one ACTIVE destination may exist for a Prism ID + venue.
            // This prevents last-bind-wins shadowing where an older ACTIVE fact
            // remains in storage but becomes impossible to resolve or replay.
            let active_pointer = self.active_destinations.read((prism_id, venue));
            if !active_pointer.is_zero() {
                let active_binding = self.bindings.read((prism_id, venue, active_pointer));
                assert(!active_binding.active, ERR_BINDING_ALREADY_ACTIVE);
            }

            // ERR-008: key must not already hold an ACTIVE binding.
            assert(!existing.active, ERR_BINDING_ALREADY_ACTIVE);

            // --- Canonical Starknet state transition (INV-SYS-003):
            // --- the binding becomes real HERE, nowhere earlier.
            let block = starknet::get_block_info().unbox().block_number;
            let binding_version = existing.binding_version + 1;
            self
                .bindings
                .write(
                    key,
                    Binding {
                        active: true, bound_at_block: block, revoked_at_block: 0, binding_version,
                    },
                );
            self.consumed_digests.write(proof_digest, true);
            self.active_destinations.write((prism_id, venue), execution_account);

            self.emit(ExecutionIdentityBound { prism_id, venue, execution_account, proof_digest });

            binding_version
        }

        /// OP-8-02. Public read over the deterministic key space. A REVOKED
        /// or never-bound key returns the sentinel — never the account
        /// (INV-SYS-007). Cross-ID exclusivity is intentionally NOT enforced
        /// (DEC-PRISM-SYS-002): resolution keys on (prism_id, venue) only.
        fn resolve(self: @ContractState, prism_id: felt252, venue: felt252) -> Resolution {
            match InternalImpl::resolve_active(self, prism_id, venue) {
                Option::Some(account) => Resolution::ActiveDestination(account),
                Option::None => Resolution::NoActiveDestination,
            }
        }

        /// OP-8-03. Controller-only; idempotent per ERR-011 (revoke of an
        /// already-REVOKED binding returns success without emitting another
        /// event). Irreversible: sets active=false permanently; no command
        /// can return it to ACTIVE (INV-SYS-006). Unknown binding reverts
        /// with ERR-009.
        fn revoke_binding(
            ref self: ContractState,
            prism_id: felt252,
            venue: felt252,
            execution_account: ContractAddress,
        ) -> u32 {
            // ERR-002: identity must exist (parent identity is preserved).
            let identity = self.identities.read(prism_id);
            assert(!identity.controller.is_zero(), ERR_IDENTITY_NOT_FOUND);

            // ERR-004 (INV-SYS-002): only the controller may revoke.
            let caller = starknet::get_caller_address();
            assert(caller == identity.controller, ERR_NOT_CONTROLLER);

            let key = (prism_id, venue, execution_account);
            let existing = self.bindings.read(key);

            // ERR-009: there is no binding instance to terminate.
            assert(existing.binding_version > 0, ERR_BINDING_NOT_FOUND);

            // ERR-011 idempotence: already-revoked is a benign success fact.
            if !existing.active {
                return existing.binding_version;
            }

            let block = starknet::get_block_info().unbox().block_number;
            self
                .bindings
                .write(
                    key,
                    Binding {
                        active: false,
                        bound_at_block: existing.bound_at_block,
                        revoked_at_block: block,
                        binding_version: existing.binding_version,
                    },
                );

            // Clear the resolution pointer iff it still names this account;
            // a newer re-bind of the same pair owns the pointer instead.
            let pointer = self.active_destinations.read((prism_id, venue));
            if pointer == execution_account {
                let zero: ContractAddress = 0.try_into().unwrap();
                self.active_destinations.write((prism_id, venue), zero);
            }

            self.emit(BindingRevoked { prism_id, venue, execution_account });

            existing.binding_version
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// Reverse-index-free deterministic scan helper for OP-8-02.
        ///
        /// Storage model note: bindings are keyed by the full triple
        /// (prism_id, venue, execution_account). To resolve without knowing
        /// the account, bind also records the current ACTIVE account per
        /// (prism_id, venue) in `active_destinations`; revoke clears that
        /// pointer iff it still names the revoked account. This keeps
        /// resolve O(1), deterministic, and exact — a REVOKED key never
        /// resolves, and a stale pointer cannot survive its own revocation.
        fn resolve_active(
            self: @ContractState, prism_id: felt252, venue: felt252,
        ) -> Option<ContractAddress> {
            let pointer = self.active_destinations.read((prism_id, venue));
            if pointer.is_zero() {
                return Option::None;
            }
            let binding = self.bindings.read((prism_id, venue, pointer));
            if binding.active {
                Option::Some(pointer)
            } else {
                Option::None
            }
        }
    }
}
