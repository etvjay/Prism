// PrismAllocationHelper — smallest meaningful Prism-owned STRK20 private
// application action: private capital allocation from the Prism Home into a
// vault/router as the external application target.
//
// Canonical ABI replicated 1:1 from first-party starknet-privacy
// (packages/privacy/src/test_contracts/mock_swap_executor.cairo +
// packages/privacy/src/objects.cairo, commit 66e3caae):
//
//   fn privacy_invoke(
//     ref self: T,
//     in_token: ContractAddress,
//     out_token: ContractAddress,
//     in_amount: u128,
//     note_id: felt252,
//   ) -> Span<OpenNoteDeposit>;
//
//   OpenNoteDeposit { note_id: felt252, token: ContractAddress, amount: u128 }
//
// Flow (same as the canonical reference): the STRK20 privacy pool withdraws
// the input tokens to this helper, calls privacy_invoke, the helper executes
// the external application action (vault deposit), measures the OUTPUT
// BALANCE DELTA as authoritative (never the action return value), approves
// get_caller_address() (the privacy pool) to pull the output, and returns the
// Span<OpenNoteDeposit> instructing which open note to credit.
//
// Privacy truth: hides the direct user identity behind the allocation action.
// Does NOT hide amount, timing, target application, or open-note amount.
//
// Authority model: permissionless + stateless like the reference — it trusts
// only measured balance deltas and approves whoever called it. No storage,
// no events, no admin key, no fee logic.
//
// Out of scope / NOT claimed: multi-directional operations, note ownership
// reads, viewing keys, any amount/timing privacy.

use starknet::ContractAddress;

/// X2 TEST FIXTURE — replicated OpenNoteDeposit ABI from
/// starknet-privacy packages/privacy/src/objects.cairo (66e3caae).
/// Field order is canonical: { note_id, token, amount }.
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

/// X2 TEST FIXTURE — minimal ERC-20 surface matching the canonical
/// IERC20Dispatcher usage in starknet-privacy mock_swap_executor.cairo
/// (u128 amounts, Starknet-native selectors).
#[starknet::interface]
pub trait IERC20<T> {
    fn balance_of(self: @T, account: ContractAddress) -> u128;
    fn approve(ref self: T, spender: ContractAddress, amount: u128) -> bool;
    fn transfer(ref self: T, recipient: ContractAddress, amount: u128) -> bool;
    fn transfer_from(
        ref self: T, sender: ContractAddress, recipient: ContractAddress, amount: u128,
    ) -> bool;
}

/// X2 TEST FIXTURE — external application target surface. A vault/router
/// standing in for the real Prism allocation destination. Only the deposit
/// direction of the canonical swap shape is exercised; nothing beyond this
/// surface is assumed.
#[starknet::interface]
pub trait IExternalApp<T> {
    fn deposit(ref self: T, assets: u256, receiver: ContractAddress) -> u256;
}

#[starknet::interface]
pub trait IPrismAllocationHelper<T> {
    /// Canonical entry point invoked by the STRK20 privacy pool via
    /// INVOKE_SELECTOR. Any revert rolls back the whole pool operation
    /// atomically.
    fn privacy_invoke(
        ref self: T,
        in_token: ContractAddress,
        out_token: ContractAddress,
        in_amount: u128,
        note_id: felt252,
    ) -> Span<OpenNoteDeposit>;
}

pub mod errors {
    pub const ZERO_IN_TOKEN: felt252 = 'ZERO_IN_TOKEN';
    pub const ZERO_OUT_TOKEN: felt252 = 'ZERO_OUT_TOKEN';
    pub const TOKENS_EQUAL: felt252 = 'TOKENS_EQUAL';
    pub const ZERO_IN_AMOUNT: felt252 = 'ZERO_IN_AMOUNT';
    pub const ZERO_OUT_AMOUNT: felt252 = 'ZERO_OUT_AMOUNT';
    pub const OUT_AMOUNT_OVERFLOW: felt252 = 'OUT_OVERFLOW';
}

#[starknet::contract]
pub mod PrismAllocationHelper {
    use core::num::traits::Zero;
    use super::{
        IERC20Dispatcher, IERC20DispatcherTrait, IExternalAppDispatcher,
        IExternalAppDispatcherTrait, OpenNoteDeposit, errors,
    };
    use starknet::{ContractAddress, get_caller_address, get_contract_address};

    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    pub impl PrismAllocationHelperImpl of super::IPrismAllocationHelper<ContractState> {
        fn privacy_invoke(
            ref self: ContractState,
            in_token: ContractAddress,
            out_token: ContractAddress,
            in_amount: u128,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            // Input validation (reference error-code style).
            assert(!in_token.is_zero(), errors::ZERO_IN_TOKEN);
            assert(!out_token.is_zero(), errors::ZERO_OUT_TOKEN);
            assert(in_token != out_token, errors::TOKENS_EQUAL);
            assert(!in_amount.is_zero(), errors::ZERO_IN_AMOUNT);

            let self_addr = get_contract_address();
            // Caller is the privacy pool in a real invocation.
            let pool_addr = get_caller_address();

            let in_erc20 = IERC20Dispatcher { contract_address: in_token };
            let out_erc20 = IERC20Dispatcher { contract_address: out_token };

            // Authoritative measurement bookends around the action.
            let balance_before = out_erc20.balance_of(account: self_addr);

            // Approve the external application (vault/router) to pull the
            // withdrawn input, then execute the action. Minted-shares return
            // value ignored; the measured delta is authoritative.
            in_erc20.approve(spender: out_token, amount: in_amount);
            IExternalAppDispatcher { contract_address: out_token }.deposit(
                in_amount.into(), receiver: self_addr,
            );

            let delta = out_erc20.balance_of(account: self_addr) - balance_before;
            assert(delta > Zero::zero(), errors::ZERO_OUT_AMOUNT);
            // A u128-measured delta must fit the OpenNoteDeposit amount field.
            let out_amount = delta.try_into().expect('OUT_OVERFLOW');

            // Approve the caller (the privacy pool) to pull the output back
            // for open-note credit — exactly as the canonical reference does.
            out_erc20.approve(spender: pool_addr, amount: delta);

            [OpenNoteDeposit { note_id, token: out_token, amount: out_amount }].span()
        }
    }
}
