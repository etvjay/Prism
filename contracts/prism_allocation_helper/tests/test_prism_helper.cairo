// Adversarial + lifecycle tests for PrismAllocationHelper (canonical ABI,
// replicated from starknet-privacy @66e3caae mock_swap_executor.cairo).
//
// Coverage:
//   - success path with authoritative measured output delta
//   - zero token / zero amount / equal-token reverts
//   - insufficient-balance and action-failure rollback (FT-006 atomicity)
//   - caller-only approval boundary (get_caller_address scoping)
//   - stateless repeated invocation (replay safety)
//   - nonzero open-note amount/token correctness
//   - zero measured delta can never credit an empty open note
//
// All mocks below are X2 TEST FIXTURES only.

use core::num::traits::Zero;
use prism_allocation_helper::{
    IPrismAllocationHelperDispatcher, IPrismAllocationHelperDispatcherTrait, OpenNoteDeposit,
};
use snforge_std::{declare, ContractClassTrait, DeclareResultTrait};
use starknet::{ContractAddress, get_contract_address};
use core::array::{ArrayTrait, SpanTrait};
use prism_allocation_helper::IERC20Dispatcher as TokDisp;
use prism_allocation_helper::IERC20DispatcherTrait;
use prism_allocation_helper::IExternalAppDispatcher as AppDisp;
use prism_allocation_helper::IExternalAppDispatcherTrait;

const AMOUNT: u128 = 1000;
const NOTE_ID: felt252 = 777;

// ---------- interfaces ----------

#[starknet::interface]
pub trait IVaultKnobs<T> {
    fn set_fail_deposits(ref self: T, v: bool);
}

#[starknet::interface]
pub trait ITokenProbes<T> {
    fn allowance_probe(self: @T, owner: ContractAddress, spender: ContractAddress) -> u128;
}

#[starknet::interface]
pub trait IForeignPuller<T> {
    fn try_pull(
        ref self: T, token: ContractAddress, from: ContractAddress, to: ContractAddress,
        amount: u128,
    );
}

// ---------- mocks ----------

/// X2 TEST FIXTURE — minimal STRK20-style token, u128 amounts.
#[starknet::contract]
pub mod MockERC20 {
    use starknet::storage::{StorageMapReadAccess, StorageMapWriteAccess};
    use starknet::ContractAddress;

    #[storage]
    struct Storage {
        balances: LegacyMap<ContractAddress, u128>,
        allowances: LegacyMap<(ContractAddress, ContractAddress), u128>,
    }

    #[constructor]
    fn constructor(ref self: ContractState, initial_holder: ContractAddress, amount: u128) {
        self.balances.write(initial_holder, amount);
    }

    #[abi(embed_v0)]
    pub impl Token of prism_allocation_helper::IERC20<ContractState> {
        fn balance_of(self: @ContractState, account: ContractAddress) -> u128 {
            self.balances.read(account)
        }
        fn approve(ref self: ContractState, spender: ContractAddress, amount: u128) -> bool {
            let owner = starknet::get_caller_address();
            self.allowances.write((owner, spender), amount);
            true
        }
        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u128) -> bool {
            let sender = starknet::get_caller_address();
            let bal = self.balances.read(sender);
            assert(bal >= amount, 'INSUFF_BALANCE');
            self.balances.write(sender, bal - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            true
        }
        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u128,
        ) -> bool {
            let caller = starknet::get_caller_address();
            let key = (sender, caller);
            let allowance = self.allowances.read(key);
            assert(allowance >= amount, 'INSUFF_ALLOWANCE');
            self.allowances.write(key, allowance - amount);
            let bal = self.balances.read(sender);
            assert(bal >= amount, 'INSUFF_BALANCE');
            self.balances.write(sender, bal - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            true
        }
    }

    /// X2 TEST FIXTURE — allowance probe for boundary assertions.
    #[abi(embed_v0)]
    pub impl Probes of super::ITokenProbes<ContractState> {
        fn allowance_probe(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u128 {
            self.allowances.read((owner, spender))
        }
    }
}

/// X2 TEST FIXTURE — 1:1 mock external application (vault/router). Shares are
/// exposed through an IERC20-shaped surface so the output side of
/// privacy_invoke runs against a real dispatcher. `fail_deposits` is a
/// breakable knob used to prove FT-006 rollback.
#[starknet::contract]
pub mod MockVault {
    use starknet::storage::{StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::ContractAddress;
    use prism_allocation_helper::IERC20Dispatcher;
    use prism_allocation_helper::IERC20DispatcherTrait;

    #[storage]
    struct Storage {
        asset: ContractAddress,
        shares: LegacyMap<ContractAddress, u256>,
        share_allowances: LegacyMap<(ContractAddress, ContractAddress), u128>,
        fail_deposits: bool,
    }

    #[constructor]
    fn constructor(ref self: ContractState, asset: ContractAddress) {
        self.asset.write(asset);
        self.fail_deposits.write(false);
    }

    /// External application surface consumed by privacy_invoke.
    #[abi(embed_v0)]
    pub impl Vault of prism_allocation_helper::IExternalApp<ContractState> {
        fn deposit(ref self: ContractState, assets: u256, receiver: ContractAddress) -> u256 {
            assert(self.fail_deposits.read() == false, 'VAULT_DEPOSIT_FAIL');
            let mut asset = IERC20Dispatcher { contract_address: self.asset.read() };
            let pulled = asset.transfer_from(
                starknet::get_caller_address(), starknet::get_contract_address(), assets.low,
            );
            assert(pulled, 'PULL_FALSE');
            self.shares.write(receiver, self.shares.read(receiver) + assets);
            assets
        }
    }

    /// Share token surface (output side of the swap shape).
    #[abi(embed_v0)]
    pub impl ShareToken of prism_allocation_helper::IERC20<ContractState> {
        fn balance_of(self: @ContractState, account: ContractAddress) -> u128 {
            self.shares.read(account).low
        }
        fn approve(ref self: ContractState, spender: ContractAddress, amount: u128) -> bool {
            let owner = starknet::get_caller_address();
            self.share_allowances.write((owner, spender), amount);
            true
        }
        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u128) -> bool {
            let sender = starknet::get_caller_address();
            let held = self.shares.read(sender);
            assert(held >= amount.into(), 'INSUFF_BALANCE');
            self.shares.write(sender, held - amount.into());
            self.shares.write(recipient, self.shares.read(recipient) + amount.into());
            true
        }
        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u128,
        ) -> bool {
            let caller = starknet::get_caller_address();
            let key = (sender, caller);
            let allowance = self.share_allowances.read(key);
            assert(allowance >= amount, 'INSUFF_ALLOWANCE');
            self.share_allowances.write(key, allowance - amount);
            let held = self.shares.read(sender);
            assert(held >= amount.into(), 'INSUFF_BALANCE');
            self.shares.write(sender, held - amount.into());
            self.shares.write(recipient, self.shares.read(recipient) + amount.into());
            true
        }
    }

    /// X2 TEST FIXTURE — breakable knob.
    #[abi(embed_v0)]
    pub impl Knobs of super::IVaultKnobs<ContractState> {
        fn set_fail_deposits(ref self: ContractState, v: bool) {
            self.fail_deposits.write(v);
        }
    }
}

/// X2 TEST FIXTURE — an application target that accepts the action but emits
/// no output tokens, proving the zero-delta guard.
#[starknet::contract]
pub mod NullApp {
    use starknet::ContractAddress;

    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    pub impl App of prism_allocation_helper::IExternalApp<ContractState> {
        fn deposit(ref self: ContractState, assets: u256, receiver: ContractAddress) -> u256 {
            assets
        }
    }

    /// Token-shaped surface so the helper's output-side dispatchers resolve;
    /// balances stay at zero forever (accepts action, emits no output).
    #[abi(embed_v0)]
    pub impl DeadToken of prism_allocation_helper::IERC20<ContractState> {
        fn balance_of(self: @ContractState, account: ContractAddress) -> u128 { 0 }
        fn approve(ref self: ContractState, spender: ContractAddress, amount: u128) -> bool {
            true
        }
        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u128) -> bool {
            false
        }
        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u128,
        ) -> bool {
            false
        }
    }
}

/// X2 TEST FIXTURE — a foreign principal with no allowance anywhere. Used to
/// prove the approval boundary from the negative side.
#[starknet::contract]
pub mod ForeignPuller {
    use starknet::ContractAddress;
    use prism_allocation_helper::IERC20Dispatcher;
    use prism_allocation_helper::IERC20DispatcherTrait;

    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    pub impl Puller of super::IForeignPuller<ContractState> {
        fn try_pull(
            ref self: ContractState,
            token: ContractAddress,
            from: ContractAddress,
            to: ContractAddress,
            amount: u128,
        ) {
            let mut tok = IERC20Dispatcher { contract_address: token };
            tok.transfer_from(from, to, amount);
        }
    }
}

// ---------- deployment helpers ----------

fn setup()
-> (
    ContractAddress,
    ContractAddress,
    ContractAddress,
    ContractAddress,
    IPrismAllocationHelperDispatcher,
) {
    // This test contract plays the role of the privacy pool: it withdraws the
    // input to the helper, calls privacy_invoke, and is the approved puller
    // of outputs.
    let me = get_contract_address();
    let underlying_class = declare("MockERC20").unwrap().contract_class();
    let vault_class = declare("MockVault").unwrap().contract_class();
    let helper_class = declare("PrismAllocationHelper").unwrap().contract_class();

    let dep = underlying_class.deploy(@array![me.into(), 1_000_000]);
    assert(dep.is_ok(), 'TOKEN_DEPLOY_FAIL');
    let (underlying, _) = dep.unwrap();
    let dv = vault_class.deploy(@array![underlying.into()]);
    assert(dv.is_ok(), 'VAULT_DEPLOY_FAIL');
    let (vault, _) = dv.unwrap();
    let dh = helper_class.deploy(@array![]);
    assert(dh.is_ok(), 'HELPER_DEPLOY_FAIL');
    let (helper_addr, _) = dh.unwrap();
    (
        underlying,
        vault,
        helper_addr,
        me,
        IPrismAllocationHelperDispatcher { contract_address: helper_addr },
    )
}

/// Pool sandwich for allocation: withdraw input to helper → privacy_invoke →
/// pull output back via the approval granted to the caller. Returns the
/// OpenNoteDeposit the helper instructed the pool to credit.
fn run_allocate(
    underlying: ContractAddress,
    vault: ContractAddress,
    helper_addr: ContractAddress,
    helper: IPrismAllocationHelperDispatcher,
    in_amount: u128,
) -> OpenNoteDeposit {
    let mut tok = TokDisp { contract_address: underlying };
    let t = tok.transfer(helper_addr, in_amount);
    assert(t, 'POOL_TRANSFER_FAIL');

    let ret = helper.privacy_invoke(underlying, vault, in_amount, NOTE_ID);
    let note = *ret.at(0);
    // Pool pulls the output back via the approval granted to the caller.
    token_at(note.token).transfer_from(helper_addr, get_contract_address(), note.amount);
    note
}

fn token_at(addr: ContractAddress) -> TokDisp {
    TokDisp { contract_address: addr }
}

fn probe_at(addr: ContractAddress) -> ITokenProbesDispatcher {
    ITokenProbesDispatcher { contract_address: addr }
}

fn deploy_foreign() -> ContractAddress {
    let cls = declare("ForeignPuller").unwrap().contract_class();
    let d = cls.deploy(@array![]);
    assert(d.is_ok(), 'FOREIGN_DEPLOY_FAIL');
    d.unwrap().0
}

// ---------- lifecycle tests ----------

#[test]
fn allocate_success_credits_open_note_with_measured_delta() {
    let (underlying, vault, helper_addr, _me, mut helper) = setup();

    let note = run_allocate(underlying, vault, helper_addr, helper, AMOUNT);

    assert(note.note_id == NOTE_ID, 'BAD_NOTE_ID');
    assert(note.token == vault, 'BAD_NOTE_TOKEN');
    // 1:1 vault → minted shares equal allocated assets (measured delta).
    assert(note.amount == AMOUNT, 'BAD_NOTE_AMOUNT');

    // Atomic pool return: after the pool pulls, the helper retains nothing.
    assert(token_at(underlying).balance_of(helper_addr).is_zero(), 'STRANDED_UNDERLYING');
    assert(token_at(vault).balance_of(helper_addr).is_zero(), 'STRANDED_SHARES');
    assert(token_at(vault).balance_of(get_contract_address()) == AMOUNT, 'POOL_NOT_CREDITED');

    // The approval granted to the caller is scoped and consumed by the exact
    // output delta pull performed inside run_allocate.
}

#[test]
fn repeated_invocations_are_stateless_replay_safety() {
    let (underlying, vault, helper_addr, _me, mut helper) = setup();

    let n1 = run_allocate(underlying, vault, helper_addr, helper, AMOUNT);
    let n2 = run_allocate(underlying, vault, helper_addr, helper, AMOUNT);

    assert(n1.note_id == n2.note_id, 'REPLAY_NOTE_MISMATCH');
    assert(n1.token == n2.token, 'REPLAY_TOKEN_MISMATCH');
    assert(n1.amount == n2.amount, 'REPLAY_AMOUNT_MISMATCH');

    // No linkable state accumulated across invocations — nothing persists at
    // the helper between transactions.
    assert(token_at(underlying).balance_of(helper_addr).is_zero(), 'STATE_LEAK_UNDERLYING');
    assert(token_at(vault).balance_of(helper_addr).is_zero(), 'STATE_LEAK_SHARES');
}

// ---------- adversarial tests ----------

#[test]
#[should_panic(expected: ('ZERO_IN_TOKEN',))]
fn zero_in_token_reverts() {
    let (_u, vault, _h, _me, mut helper) = setup();
    helper.privacy_invoke(Zero::zero(), vault, AMOUNT, NOTE_ID);
}

#[test]
#[should_panic(expected: ('ZERO_OUT_TOKEN',))]
fn zero_out_token_reverts() {
    let (underlying, _v, _h, _me, mut helper) = setup();
    helper.privacy_invoke(underlying, Zero::zero(), AMOUNT, NOTE_ID);
}

#[test]
#[should_panic(expected: ('TOKENS_EQUAL',))]
fn equal_tokens_revert() {
    let (underlying, _v, _h, _me, mut helper) = setup();
    helper.privacy_invoke(underlying, underlying, AMOUNT, NOTE_ID);
}

#[test]
#[should_panic(expected: ('ZERO_IN_AMOUNT',))]
fn zero_amount_reverts() {
    let (underlying, vault, _h, _me, mut helper) = setup();
    helper.privacy_invoke(underlying, vault, Zero::zero(), NOTE_ID);
}

/// FT-006 — insufficient balance: if the input was never actually delivered
/// to the helper (the pool's withdraw leg failed / was skipped), the
/// application's transferFrom reverts inside privacy_invoke and the whole
/// operation aborts atomically.
#[test]
#[should_panic(expected: ('INSUFF_BALANCE',))]
fn insufficient_balance_rolls_back_whole_operation() {
    let (underlying, vault, _h, _me, mut helper) = setup();
    // No transfer leg at all: the helper holds nothing, so the vault pull
    // fails inside privacy_invoke and the entire tx reverts.
    helper.privacy_invoke(underlying, vault, AMOUNT, NOTE_ID);
}

/// FT-006 — action failure: if the external application reverts mid-action,
/// the whole operation aborts atomically (nothing strands, no partial note).
#[test]
#[should_panic(expected: ('VAULT_DEPOSIT_FAIL',))]
fn failing_action_aborts_whole_operation_ft006() {
    let (underlying, vault, helper_addr, _me, mut helper) = setup();

    // Input already withdrawn to the helper (simulating pool step 1).
    token_at(underlying).transfer(helper_addr, AMOUNT);

    // Break the application target.
    let mut knobs = IVaultKnobsDispatcher { contract_address: vault };
    knobs.set_fail_deposits(true);

    // Action fails → entire tx reverts, including the input withdrawal above.
    helper.privacy_invoke(underlying, vault, AMOUNT, NOTE_ID);
}

/// A zero measured delta must never credit an empty open note.
#[test]
#[should_panic(expected: ('ZERO_OUT_AMOUNT',))]
fn zero_output_cannot_mint_empty_note() {
    let me = get_contract_address();
    let tok_class = declare("MockERC20").unwrap().contract_class();
    let null_class = declare("NullApp").unwrap().contract_class();
    let helper_class = declare("PrismAllocationHelper").unwrap().contract_class();
    let (token, _) = tok_class.deploy(@array![me.into(), 1_000_000]).unwrap();
    let (null_app, _) = null_class.deploy(@array![]).unwrap();
    let (helper_addr, _) = helper_class.deploy(@array![]).unwrap();

    let mut tok = TokDisp { contract_address: token };
    tok.transfer(helper_addr, AMOUNT);
    let mut helper =
        IPrismAllocationHelperDispatcher { contract_address: helper_addr };
    // NullApp accepts the action but mints nothing → measured delta is zero.
    helper.privacy_invoke(token, null_app, AMOUNT, NOTE_ID);
}

// ---------- authorization boundary ----------

#[test]
fn only_calling_pool_can_pull_output_authorization_boundary() {
    let (underlying, vault, helper_addr, _me, mut helper) = setup();
    let note = run_allocate(underlying, vault, helper_addr, helper, AMOUNT);

    // The approval is scoped to get_caller_address() — here the simulated
    // pool. run_allocate performed the authorized pull through that approval
    // and drained the helper fully; a foreign principal would hit
    // INSUFF_ALLOWANCE on the identical call shape.
    assert(token_at(vault).balance_of(helper_addr).is_zero(), 'NOT_FULLY_PULLABLE');
    assert(token_at(vault).balance_of(get_contract_address()) == AMOUNT, 'POOL_NOT_CREDITED');
    // The negative side of this boundary is proven by
    // foreign_principal_cannot_pull_output below.
    let _ = note;
}

#[test]
#[should_panic(expected: ('INSUFF_ALLOWANCE',))]
fn foreign_principal_cannot_pull_output() {
    let (underlying, vault, helper_addr, _me, mut helper) = setup();
    run_allocate(underlying, vault, helper_addr, helper, AMOUNT);

    // A principal other than the caller of privacy_invoke has zero allowance
    // on the helper's output — the same call shape reverts.
    let foreign = deploy_foreign();
    let mut puller = IForeignPullerDispatcher { contract_address: foreign };
    puller.try_pull(vault, helper_addr, foreign, 1);
}
