// PrismVesuLendingHelper — M5 candidate: Prism-owned private lending action
// against Vesu-style vTokens on SN_SEPOLIA.
//
// Canonical STRK20 helper ABI preserved exactly (1:1 with
// starknet-privacy @66e3caae mock_swap_executor.cairo and the existing
// prism_allocation_helper):
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
// RED-TEAM H1 FIX: real SN_SEPOLIA STRK/vToken ERC-20s are standard u256
// tokens. Every REAL token surface here is u256 (balance_of, approve,
// transfer_from, vToken deposit assets + returned shares). The pool-facing
// surface stays u128: privacy_invoke.in_amount and OpenNoteDeposit.amount.
// The measured u256 output is converted to u128 ONLY via an explicit checked
// conversion that rejects any nonzero high limb — never silently truncated.
//
// Hardening vs the generic allocation helper:
//   - constructor pins privacy_pool, underlying_token, v_token;
//   - only the pinned pool may call privacy_invoke;
//   - only pinned underlying -> pinned vToken direction accepted;
//   - approves ONLY the pinned pool to pull the measured output;
//   - no admin key, no upgradeability, no arbitrary target/selector, no
//     viewing-key or proof material, no user state.
//
// Flow: the privacy pool withdraws in_amount of underlying to this helper,
// calls privacy_invoke; the helper approves the pinned vToken to pull the
// input, deposits assets=u256(in_amount) with receiver=self, measures the
// vToken u256 balance delta as authoritative (deposit return value ignored),
// asserts nonzero + checked u128 fit, approves the pinned pool to pull the
// measured output, and returns the open-note instruction.
//
// Privacy truth: hides direct user identity behind the lending action.
// Does NOT hide amount, timing, or open-note amount.

use starknet::ContractAddress;

/// Canonical OpenNoteDeposit ABI (field order { note_id, token, amount }),
/// replicated 1:1 from starknet-privacy objects.cairo @66e3caae.
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

/// REAL-TOKEN SURFACE — standard u256 ERC-20 as deployed on SN_SEPOLIA
/// (STRK, vTokens). This replaces the blocked u128 fixture surface of the
/// generic allocation helper (red-team finding H1).
#[starknet::interface]
pub trait IERC20<T> {
    fn balance_of(self: @T, account: ContractAddress) -> u256;
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
    fn transfer(ref self: T, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: T, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
}

/// REAL-TOKEN SURFACE — Vesu-style vToken (ERC-4626 vault share token).
/// Assets in, shares minted: both u256.
#[starknet::interface]
pub trait IVToken<T> {
    fn deposit(ref self: T, assets: u256, receiver: ContractAddress) -> u256;
}

#[starknet::interface]
pub trait IPrismVesuLendingHelper<T> {
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
    pub const UNAUTHORIZED_CALLER: felt252 = 'NOT_PINNED_POOL';
    pub const WRONG_IN_TOKEN: felt252 = 'WRONG_IN_TOKEN';
    pub const WRONG_OUT_TOKEN: felt252 = 'WRONG_OUT_TOKEN';
    pub const ZERO_IN_AMOUNT: felt252 = 'ZERO_IN_AMOUNT';
    pub const ZERO_OUT_AMOUNT: felt252 = 'ZERO_OUT_AMOUNT';
    pub const OUT_AMOUNT_OVERFLOW: felt252 = 'OUT_OVERFLOW';
}

#[starknet::contract]
pub mod PrismVesuLendingHelper {
    use core::num::traits::Zero;
    use super::{
        IERC20Dispatcher, IERC20DispatcherTrait, IVTokenDispatcher, IVTokenDispatcherTrait,
        OpenNoteDeposit, errors,
    };
    use starknet::{
        ContractAddress, get_caller_address, get_contract_address,
        storage::{StoragePointerReadAccess, StoragePointerWriteAccess},
    };

    #[storage]
    struct Storage {
        privacy_pool: ContractAddress,
        underlying_token: ContractAddress,
        v_token: ContractAddress,
    }

    /// Pins the pool and both token directions at construction.
    /// No admin key, no setter, no upgrade path exists anywhere in this
    /// contract — the pins are immutable for the lifetime of the instance.
    #[constructor]
    fn constructor(
        ref self: ContractState,
        privacy_pool: ContractAddress,
        underlying_token: ContractAddress,
        v_token: ContractAddress,
    ) {
        assert(!privacy_pool.is_zero(), 'ZERO_POOL');
        assert(!underlying_token.is_zero(), 'ZERO_UNDERLYING');
        assert(!v_token.is_zero(), 'ZERO_VTOKEN');
        assert(underlying_token != v_token, 'TOKENS_EQUAL');
        self.privacy_pool.write(privacy_pool);
        self.underlying_token.write(underlying_token);
        self.v_token.write(v_token);
    }

    #[abi(embed_v0)]
    pub impl PrismVesuLendingHelperImpl of super::IPrismVesuLendingHelper<ContractState> {
        fn privacy_invoke(
            ref self: ContractState,
            in_token: ContractAddress,
            out_token: ContractAddress,
            in_amount: u128,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            // 2. Only the pinned pool may ever invoke this entry point.
            assert(
                get_caller_address() == self.privacy_pool.read(),
                errors::UNAUTHORIZED_CALLER,
            );

            // 3. Only the pinned underlying -> pinned vToken direction.
            assert(in_token == self.underlying_token.read(), errors::WRONG_IN_TOKEN);
            assert(out_token == self.v_token.read(), errors::WRONG_OUT_TOKEN);
            assert(!in_amount.is_zero(), errors::ZERO_IN_AMOUNT);

            let self_addr = get_contract_address();
            let pool_addr = self.privacy_pool.read();
            let v_token_addr = self.v_token.read();

            let mut underlying = IERC20Dispatcher { contract_address: in_token };
            let mut v_token = IVTokenDispatcher { contract_address: v_token_addr };
            let mut v_token_erc20 = IERC20Dispatcher { contract_address: v_token_addr };

            // Authoritative measurement bookends around the action (u256).
            let balance_before = v_token_erc20.balance_of(account: self_addr);

            // 4. Approve the pinned vToken to pull the withdrawn input
            // (u256), then deposit assets=u256(in_amount) with receiver=self.
            // The shares return value is ignored; the measured delta is
            // authoritative.
            underlying.approve(spender: v_token_addr, amount: in_amount.into());
            v_token.deposit(in_amount.into(), receiver: self_addr);

            let delta_u256 =
                v_token_erc20.balance_of(account: self_addr) - balance_before;
            assert(delta_u256 > Zero::zero(), errors::ZERO_OUT_AMOUNT);
            // H1 FIX: explicit checked u256 -> u128 conversion. Any nonzero
            // high limb aborts the whole operation — never a silent truncate.
            let out_amount: u128 = delta_u256.try_into().expect(errors::OUT_AMOUNT_OVERFLOW);

            // 5. Approve ONLY the pinned privacy pool to pull the measured
            // u256 output for open-note credit.
            v_token_erc20.approve(spender: pool_addr, amount: delta_u256);

            [OpenNoteDeposit { note_id, token: v_token_addr, amount: out_amount }].span()
        }
    }
}
