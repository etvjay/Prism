// Comprehensive tests for PrismVesuLendingHelper (M5 candidate).
//
// Coverage:
//   - happy path: measured u256 vToken delta credited to open note
//   - wrong caller (not pinned pool) reverts
//   - wrong in-token / wrong out-token / zero input reverts
//   - zero measured output reverts
//   - vToken deposit revert rolls back atomically
//   - balance conservation: helper retains nothing after pool pull
//   - approval scope: only pinned pool approved; foreign puller blocked
//   - repeat invocation is stateless
//   - high-limb overflow rejection (checked u256 -> u128, no truncation)
//
// All mocks are X2 TEST FIXTURES with u256-shaped ERC20/vToken surfaces,
// matching real SN_SEPOLIA STRK/vToken shapes.

use core::num::traits::Zero;
use prism_vesu_lending_helper::{
    IPrismVesuLendingHelperDispatcher, IPrismVesuLendingHelperDispatcherTrait, OpenNoteDeposit,
};
use snforge_std::{declare, ContractClassTrait, DeclareResultTrait};
use starknet::{ContractAddress, get_contract_address};
use core::panic_with_felt252;
use core::array::{ArrayTrait, SpanTrait};
use prism_vesu_lending_helper::IERC20Dispatcher as TokDisp;
use prism_vesu_lending_helper::IERC20DispatcherTrait;

const AMOUNT: u128 = 1000;
const NOTE_ID: felt252 = 777;
const U128_MAX: u128 = 340282366920938463463374607431768211455_u128;
const U128_MAX_LOW: felt252 = 340282366920938463463374607431768211455_felt252;
const U128_MAX_HIGH: felt252 = 0;

// ---------- interfaces ----------

#[starknet::interface]
pub trait IVTokenKnobs<T> {
    fn set_fail_deposits(ref self: T, v: bool);
    fn set_share_multiplier(ref self: T, m: u256);
}

#[starknet::interface]
pub trait ITokenProbes<T> {
    fn allowance_probe(self: @T, owner: ContractAddress, spender: ContractAddress) -> u256;
}

#[starknet::interface]
pub trait IForeignPuller<T> {
    fn try_pull(
        ref self: T, token: ContractAddress, from: ContractAddress, to: ContractAddress,
        amount: u256,
    );
}

#[starknet::interface]
pub trait IPoolImpersonator<T> {
    fn run_invoke(
        ref self: T, helper: ContractAddress, in_token: ContractAddress,
        out_token: ContractAddress, in_amount: u128, note_id: felt252,
    ) -> Span<OpenNoteDeposit>;
}

/// X2 TEST FIXTURE — minimal u256-shaped ERC-20 used for the underlying.
#[starknet::contract]
pub mod MockERC20 {
    use starknet::storage::{StorageMapReadAccess, StorageMapWriteAccess};
    use starknet::ContractAddress;

    #[storage]
    struct Storage {
        balances: LegacyMap<ContractAddress, u256>,
        allowances: LegacyMap<(ContractAddress, ContractAddress), u256>,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        initial_holder: ContractAddress,
        amount_low: felt252,
        amount_high: felt252,
    ) {
        let amount = u256 { low: amount_low.try_into().unwrap(), high: amount_high.try_into().unwrap() };
        self.balances.write(initial_holder, amount);
    }

    #[abi(embed_v0)]
    pub impl Token of prism_vesu_lending_helper::IERC20<ContractState> {
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }
        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            let owner = starknet::get_caller_address();
            self.allowances.write((owner, spender), amount);
            true
        }
        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
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
            amount: u256,
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

    /// X2 TEST FIXTURE — allowance probe for boundary assertions (u256).
    #[abi(embed_v0)]
    pub impl Probes of super::ITokenProbes<ContractState> {
        fn allowance_probe(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256 {
            self.allowances.read((owner, spender))
        }
    }
}

/// X2 TEST FIXTURE — Vesu-style vToken: an ERC-4626-shaped vault whose share
/// token surface is a standard u256 ERC-20. Shares minted = assets * multiplier
/// (default 1:1). `fail_deposits` proves atomic rollback on action revert;
/// `share_multiplier` drives high-limb overflow scenarios.
#[starknet::contract]
pub mod MockVToken {
    use starknet::storage::{
        StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::ContractAddress;
    use prism_vesu_lending_helper::IERC20Dispatcher;
    use prism_vesu_lending_helper::IERC20DispatcherTrait;

    #[storage]
    struct Storage {
        asset: ContractAddress,
        shares: LegacyMap<ContractAddress, u256>,
        share_allowances: LegacyMap<(ContractAddress, ContractAddress), u256>,
        fail_deposits: bool,
        share_multiplier: u256,
    }

    #[constructor]
    fn constructor(ref self: ContractState, asset: ContractAddress) {
        self.asset.write(asset);
        self.fail_deposits.write(false);
        self.share_multiplier.write(1);
    }

    /// vToken deposit surface consumed by privacy_invoke (u256 assets in).
    #[abi(embed_v0)]
    pub impl Vault of prism_vesu_lending_helper::IVToken<ContractState> {
        fn deposit(ref self: ContractState, assets: u256, receiver: ContractAddress) -> u256 {
            assert(self.fail_deposits.read() == false, 'VTOKEN_DEPOSIT_FAIL');
            let mut asset = IERC20Dispatcher { contract_address: self.asset.read() };
            let pulled = asset.transfer_from(
                starknet::get_caller_address(), starknet::get_contract_address(), assets,
            );
            assert(pulled, 'PULL_FALSE');
            let minted = assets * self.share_multiplier.read();
            self.shares.write(receiver, self.shares.read(receiver) + minted);
            minted
        }
    }

    /// Share token surface — standard u256 ERC-20 (the real output side).
    #[abi(embed_v0)]
    pub impl ShareToken of prism_vesu_lending_helper::IERC20<ContractState> {
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.shares.read(account)
        }
        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            let owner = starknet::get_caller_address();
            self.share_allowances.write((owner, spender), amount);
            true
        }
        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let sender = starknet::get_caller_address();
            let held = self.shares.read(sender);
            assert(held >= amount, 'INSUFF_BALANCE');
            self.shares.write(sender, held - amount);
            self.shares.write(recipient, self.shares.read(recipient) + amount);
            true
        }
        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let caller = starknet::get_caller_address();
            let key = (sender, caller);
            let allowance = self.share_allowances.read(key);
            assert(allowance >= amount, 'INSUFF_ALLOWANCE');
            self.share_allowances.write(key, allowance - amount);
            let held = self.shares.read(sender);
            assert(held >= amount, 'INSUFF_BALANCE');
            self.shares.write(sender, held - amount);
            self.shares.write(recipient, self.shares.read(recipient) + amount);
            true
        }
    }

    /// X2 TEST FIXTURE — breakable knobs.
    #[abi(embed_v0)]
    pub impl Knobs of super::IVTokenKnobs<ContractState> {
        fn set_fail_deposits(ref self: ContractState, v: bool) {
            self.fail_deposits.write(v);
        }
        fn set_share_multiplier(ref self: ContractState, m: u256) {
            self.share_multiplier.write(m);
        }
    }
}

/// X2 TEST FIXTURE — a second token used as the WRONG direction target.
#[starknet::contract]
pub mod OtherToken {
    use starknet::ContractAddress;

    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    pub impl Token of prism_vesu_lending_helper::IERC20<ContractState> {
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 { 0 }
        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            true
        }
        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            false
        }
        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            false
        }
    }
}

/// X2 TEST FIXTURE — foreign principal with zero allowance anywhere. Proves
/// the approval boundary from the negative side (u256 pull shape).
#[starknet::contract]
pub mod ForeignPuller {
    use starknet::ContractAddress;
    use prism_vesu_lending_helper::IERC20Dispatcher;
    use prism_vesu_lending_helper::IERC20DispatcherTrait;

    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    pub impl Puller of super::IForeignPuller<ContractState> {
        fn try_pull(
            ref self: ContractState,
            token: ContractAddress,
            from: ContractAddress,
            to: ContractAddress,
            amount: u256,
        ) {
            let mut tok = IERC20Dispatcher { contract_address: token };
            tok.transfer_from(from, to, amount);
        }
    }
}

/// X2 TEST FIXTURE — any contract other than the pinned pool attempting to
/// invoke privacy_invoke. Must always be rejected by the caller pin.
#[starknet::contract]
pub mod PoolImpersonator {
    use starknet::ContractAddress;
    use prism_vesu_lending_helper::{
        IPrismVesuLendingHelperDispatcher, IPrismVesuLendingHelperDispatcherTrait,
        OpenNoteDeposit,
    };

    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    pub impl Impostor of super::IPoolImpersonator<ContractState> {
        fn run_invoke(
            ref self: ContractState,
            helper: ContractAddress,
            in_token: ContractAddress,
            out_token: ContractAddress,
            in_amount: u128,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            let mut helper = IPrismVesuLendingHelperDispatcher { contract_address: helper };
            helper.privacy_invoke(in_token, out_token, in_amount, note_id)
        }
    }
}

// ---------- deployment helpers ----------

fn setup()
-> (
    ContractAddress, // underlying
    ContractAddress, // v_token
    ContractAddress, // helper_addr
    ContractAddress, // pool (this test contract)
    IPrismVesuLendingHelperDispatcher,
) {
    // This test contract plays the role of the pinned privacy pool: it
    // withdraws the input to the helper, calls privacy_invoke, and is the
    // only principal approved to pull outputs back.
    let me = get_contract_address();
    let underlying_class = declare("MockERC20").unwrap().contract_class();
    let vtoken_class = declare("MockVToken").unwrap().contract_class();
    let helper_class = declare("PrismVesuLendingHelper").unwrap().contract_class();

    // Constructor params only — no production addresses anywhere.
    let dep = underlying_class.deploy(@array![me.into(), 1_000_000, 0]);
    assert(dep.is_ok(), 'TOKEN_DEPLOY_FAIL');
    let (underlying, _) = dep.unwrap();
    let dv = vtoken_class.deploy(@array![underlying.into()]);
    assert(dv.is_ok(), 'VTOKEN_DEPLOY_FAIL');
    let (v_token, _) = dv.unwrap();
    let dh = helper_class.deploy(@array![me.into(), underlying.into(), v_token.into()]);
    assert(dh.is_ok(), 'HELPER_DEPLOY_FAIL');
    let (helper_addr, _) = dh.unwrap();
    (
        underlying,
        v_token,
        helper_addr,
        me,
        IPrismVesuLendingHelperDispatcher { contract_address: helper_addr },
    )
}

/// Pool sandwich for lending: withdraw input to helper → privacy_invoke →
/// pull output back via the approval granted to the pinned pool. Returns the
/// OpenNoteDeposit the helper instructed the pool to credit.
fn run_allocate(
    underlying: ContractAddress,
    v_token: ContractAddress,
    helper_addr: ContractAddress,
    helper: IPrismVesuLendingHelperDispatcher,
    in_amount: u128,
) -> OpenNoteDeposit {
    let mut tok = TokDisp { contract_address: underlying };
    let t = tok.transfer(helper_addr, in_amount.into());
    assert(t, 'POOL_TRANSFER_FAIL');

    let ret = helper.privacy_invoke(underlying, v_token, in_amount, NOTE_ID);
    let note = *ret.at(0);
    // Pool pulls the output back via the granted approval.
    TokDisp { contract_address: note.token }.transfer_from(
        helper_addr, get_contract_address(), note.amount.into(),
    );
    note
}

fn deploy_foreign() -> ContractAddress {
    let cls = declare("ForeignPuller").unwrap().contract_class();
    let d = cls.deploy(@array![]).unwrap();
    d.0
}

fn deploy_impersonator() -> ContractAddress {
    let cls = declare("PoolImpersonator").unwrap().contract_class();
    let d = cls.deploy(@array![]).unwrap();
    d.0
}

// ---------- lifecycle tests ----------

#[test]
fn happy_path_credits_open_note_with_measured_u256_delta() {
    let (underlying, v_token, helper_addr, _me, mut helper) = setup();

    let note = run_allocate(underlying, v_token, helper_addr, helper, AMOUNT);

    assert(note.note_id == NOTE_ID, 'BAD_NOTE_ID');
    assert(note.token == v_token, 'BAD_NOTE_TOKEN');
    // 1:1 vToken → measured shares equal deposited assets.
    assert(note.amount == AMOUNT, 'BAD_NOTE_AMOUNT');

    // Balance conservation: after the pool pull, the helper retains nothing.
    assert(TokDisp { contract_address: underlying }.balance_of(helper_addr).is_zero(), 'STRANDED_UNDERLYING');
    assert(TokDisp { contract_address: v_token }.balance_of(helper_addr).is_zero(), 'STRANDED_SHARES');
    assert(
        TokDisp { contract_address: v_token }.balance_of(get_contract_address())
            == AMOUNT.into(),
        'POOL_NOT_CREDITED',
    );

    // Conservation on the vToken side too: total pulled assets equal input.
    assert(TokDisp { contract_address: underlying }.balance_of(v_token) == AMOUNT.into(), 'ASSET_CONSERVATION');
}

#[test]
fn repeated_invocations_are_stateless_replay_safety() {
    let (underlying, v_token, helper_addr, _me, mut helper) = setup();

    let n1 = run_allocate(underlying, v_token, helper_addr, helper, AMOUNT);
    let n2 = run_allocate(underlying, v_token, helper_addr, helper, AMOUNT);

    assert(n1.note_id == n2.note_id, 'REPLAY_NOTE_MISMATCH');
    assert(n1.token == n2.token, 'REPLAY_TOKEN_MISMATCH');
    assert(n1.amount == n2.amount, 'REPLAY_AMOUNT_MISMATCH');

    // No linkable state accumulated across invocations — nothing persists at
    // the helper between transactions.
    assert(TokDisp { contract_address: underlying }.balance_of(helper_addr).is_zero(), 'STATE_LEAK_UNDERLYING');
    assert(TokDisp { contract_address: v_token }.balance_of(helper_addr).is_zero(), 'STATE_LEAK_SHARES');

    // Both pulls drained fully into the pool.
    assert(
        TokDisp { contract_address: v_token }.balance_of(get_contract_address())
            == (AMOUNT * 2).into(),
        'POOL_TOTAL_CREDITED',
    );
}

// ---------- authorization ----------

#[test]
#[should_panic(expected: ('NOT_PINNED_POOL',))]
fn non_pinned_caller_is_rejected() {
    let (underlying, v_token, helper_addr, _me, _helper) = setup();

    // Withdraw the input so failure is not about balances — the rejection
    // must come purely from the caller pin.
    TokDisp { contract_address: underlying }.transfer(helper_addr, AMOUNT.into());

    // A contract that is NOT the pinned pool calls privacy_invoke.
    let impostor = deploy_impersonator();
    let mut imp = IPoolImpersonatorDispatcher { contract_address: impostor };
    imp.run_invoke(helper_addr, underlying, v_token, AMOUNT, NOTE_ID);
}

// ---------- direction pinning ----------

#[test]
#[should_panic(expected: ('WRONG_IN_TOKEN',))]
fn wrong_in_token_reverts() {
    let (underlying, v_token, helper_addr, _me, mut helper) = setup();

    let other_class = declare("OtherToken").unwrap().contract_class();
    let (other, _) = other_class.deploy(@array![]).unwrap();

    TokDisp { contract_address: underlying }.transfer(helper_addr, AMOUNT.into());
    helper.privacy_invoke(other, v_token, AMOUNT, NOTE_ID);
}

#[test]
#[should_panic(expected: ('WRONG_OUT_TOKEN',))]
fn wrong_out_token_reverts() {
    let (underlying, _v, helper_addr, _me, mut helper) = setup();

    let other_class = declare("OtherToken").unwrap().contract_class();
    let (other, _) = other_class.deploy(@array![]).unwrap();

    TokDisp { contract_address: underlying }.transfer(helper_addr, AMOUNT.into());
    helper.privacy_invoke(underlying, other, AMOUNT, NOTE_ID);
}

#[test]
#[should_panic(expected: ('ZERO_IN_AMOUNT',))]
fn zero_input_reverts() {
    let (underlying, v_token, _helper_addr, _me, mut helper) = setup();
    helper.privacy_invoke(underlying, v_token, Zero::zero(), NOTE_ID);
}

/// Re-panics with the first felt of a failed deploy's revert data so the
/// constructor's own error code surfaces through should_panic.
fn surface_deploy_error(
    d: Result<(ContractAddress, core::array::Span<felt252>), Array<felt252>>,
) {
    match d {
        Result::Err(data) => {
            let first: felt252 = *data.at(0);
            panic_with_felt252(first);
        },
        Result::Ok(_) => panic_with_felt252('EXPECTED_REVERT'),
    }
}

#[test]
#[should_panic(expected: ('ZERO_POOL',))]
fn constructor_rejects_zero_pool() {
    let underlying_class = declare("MockERC20").unwrap().contract_class();
    let vtoken_class = declare("MockVToken").unwrap().contract_class();
    let helper_class = declare("PrismVesuLendingHelper").unwrap().contract_class();
    let (t, _) = underlying_class.deploy(@array![0_u32.into(), 0, 0]).unwrap();
    let (v, _) = vtoken_class.deploy(@array![t.into()]).unwrap();
    let d = helper_class.deploy(@array![0_u32.into(), t.into(), v.into()]);
    surface_deploy_error(d);
}

#[test]
#[should_panic(expected: ('TOKENS_EQUAL',))]
fn constructor_rejects_equal_tokens() {
    let underlying_class = declare("MockERC20").unwrap().contract_class();
    let helper_class = declare("PrismVesuLendingHelper").unwrap().contract_class();
    let (t, _) = underlying_class.deploy(@array![0_u32.into(), 0, 0]).unwrap();
    let d = helper_class.deploy(@array![1_u32.into(), t.into(), t.into()]);
    surface_deploy_error(d);
}

// ---------- output measurement ----------

/// A vToken that accepts the deposit but mints nothing can never credit an
/// empty open note (zero measured delta guard).
#[test]
#[should_panic(expected: ('ZERO_OUT_AMOUNT',))]
fn zero_output_cannot_mint_empty_note() {
    let me = get_contract_address();
    let tok_class = declare("MockERC20").unwrap().contract_class();
    let vt_class = declare("MockVToken").unwrap().contract_class();
    let helper_class = declare("PrismVesuLendingHelper").unwrap().contract_class();

    let (underlying, _) = tok_class.deploy(@array![me.into(), 1_000_000, 0]).unwrap();
    let (v_token, _) = vt_class.deploy(@array![underlying.into()]).unwrap();
    let (helper_addr, _) =
        helper_class.deploy(@array![me.into(), underlying.into(), v_token.into()]).unwrap();

    let mut knobs = IVTokenKnobsDispatcher { contract_address: v_token };
    knobs.set_share_multiplier(0);

    TokDisp { contract_address: underlying }.transfer(helper_addr, AMOUNT.into());
    let mut helper = IPrismVesuLendingHelperDispatcher { contract_address: helper_addr };
    helper.privacy_invoke(underlying, v_token, AMOUNT, NOTE_ID);
}

/// High-limb overflow: if the measured u256 share delta does not fit u128,
/// the checked conversion must abort the whole operation — never truncate.
#[test]
#[should_panic(expected: ('OUT_OVERFLOW',))]
fn high_limb_overflow_rejected_no_truncation() {
    let me = get_contract_address();
    let tok_class = declare("MockERC20").unwrap().contract_class();
    let vt_class = declare("MockVToken").unwrap().contract_class();
    let helper_class = declare("PrismVesuLendingHelper").unwrap().contract_class();

    let (underlying, _) = tok_class.deploy(@array![me.into(), 1_000_000, 0]).unwrap();
    let (v_token, _) = vt_class.deploy(@array![underlying.into()]).unwrap();
    let (helper_addr, _) =
        helper_class.deploy(@array![me.into(), underlying.into(), v_token.into()]).unwrap();

    // Multiplier pushes minted shares past u128::MAX while staying within
    // u256 — exactly the silent-truncation hazard H1 guards against.
    let mut knobs = IVTokenKnobsDispatcher { contract_address: v_token };
    knobs.set_share_multiplier(u256 { low: U128_MAX, high: 8 });

    TokDisp { contract_address: underlying }.transfer(helper_addr, AMOUNT.into());
    let mut helper = IPrismVesuLendingHelperDispatcher { contract_address: helper_addr };
    helper.privacy_invoke(underlying, v_token, AMOUNT, NOTE_ID);
}

/// Max-fit boundary: a delta of exactly u128::MAX must convert cleanly and
/// credit the full open-note amount.
#[test]
fn max_fit_boundary_converts_exactly() {
    let me = get_contract_address();
    let tok_class = declare("MockERC20").unwrap().contract_class();
    let vt_class = declare("MockVToken").unwrap().contract_class();
    let helper_class = declare("PrismVesuLendingHelper").unwrap().contract_class();

    let (underlying, _) =
        tok_class.deploy(@array![me.into(), U128_MAX_LOW, U128_MAX_HIGH]).unwrap();
    let (vt, _) = vt_class.deploy(@array![underlying.into()]).unwrap();
    let (helper_addr, _) =
        helper_class.deploy(@array![me.into(), underlying.into(), vt.into()]).unwrap();

    let mut knobs = IVTokenKnobsDispatcher { contract_address: vt };
    knobs.set_share_multiplier(U128_MAX.into());

    let in_amount: u128 = 1;
    TokDisp { contract_address: underlying }.transfer(helper_addr, in_amount.into());
    let mut helper = IPrismVesuLendingHelperDispatcher { contract_address: helper_addr };
    let ret = helper.privacy_invoke(underlying, vt, in_amount, NOTE_ID);
    let note = *ret.at(0);
    assert(note.amount == U128_MAX, 'BOUNDARY_AMOUNT');
    assert(note.token == vt, 'BOUNDARY_TOKEN');
}

// ---------- rollback / atomicity ----------

/// If the pinned vToken's deposit reverts mid-action, the whole operation
/// aborts atomically — including the pool's withdrawal leg above it.
#[test]
#[should_panic(expected: ('VTOKEN_DEPOSIT_FAIL',))]
fn failing_vtoken_deposit_aborts_whole_operation() {
    let (underlying, v_token, helper_addr, _me, mut helper) = setup();

    // Input already withdrawn to the helper (simulating pool step 1).
    TokDisp { contract_address: underlying }.transfer(helper_addr, AMOUNT.into());

    let mut knobs = IVTokenKnobsDispatcher { contract_address: v_token };
    knobs.set_fail_deposits(true);

    helper.privacy_invoke(underlying, v_token, AMOUNT, NOTE_ID);
}

/// FT-style: if the pool's withdraw leg failed/skipped (no input delivered),
/// the vToken pull fails inside privacy_invoke and everything reverts.
#[test]
#[should_panic(expected: ('INSUFF_BALANCE',))]
fn missing_input_delivery_rolls_back_whole_operation() {
    let (underlying, v_token, _helper_addr, _me, mut helper) = setup();
    // No transfer leg: helper holds nothing → transferFrom inside the vToken
    // deposit reverts → entire tx reverts atomically.
    helper.privacy_invoke(underlying, v_token, AMOUNT, NOTE_ID);
}

// ---------- approval scope ----------

#[test]
fn approval_scoped_to_pinned_pool_only() {
    let (underlying, v_token, helper_addr, _me, mut helper) = setup();
    let note = run_allocate(underlying, v_token, helper_addr, helper, AMOUNT);

    // The authorized pull consumed the exact measured output; nothing is
    // left pullable from the helper.
    assert(TokDisp { contract_address: v_token }.balance_of(helper_addr).is_zero(), 'NOT_FULLY_PULLABLE');
    assert(
        TokDisp { contract_address: v_token }.balance_of(get_contract_address()) == AMOUNT.into(),
        'POOL_NOT_CREDITED',
    );
    let _ = note;
}

#[test]
#[should_panic(expected: ('INSUFF_ALLOWANCE',))]
fn foreign_principal_cannot_pull_output() {
    let (underlying, v_token, helper_addr, _me, mut helper) = setup();
    run_allocate(underlying, v_token, helper_addr, helper, AMOUNT);

    // A principal other than the pinned pool has zero allowance on the
    // helper's output — the identical pull shape reverts.
    let foreign = deploy_foreign();
    let mut puller = IForeignPullerDispatcher { contract_address: foreign };
    puller.try_pull(v_token, helper_addr, foreign, 1_u256);
}

#[test]
#[should_panic(expected: ('INSUFF_ALLOWANCE',))]
fn foreign_principal_cannot_pull_underlying() {
    let (underlying, _v, helper_addr, _me, _helper) = setup();

    // Even before invocation, the helper approves nobody but the vToken
    // (during the action) and the pool (afterwards). A foreign puller on the
    // underlying finds zero allowance.
    let foreign = deploy_foreign();
    let mut puller = IForeignPullerDispatcher { contract_address: foreign };
    puller.try_pull(underlying, helper_addr, foreign, 1_u256);
}
