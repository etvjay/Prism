use layerzero::MessageReceipt;
use layerzero::MessagingFee;
use layerzero::Origin;
use lz_utils::bytes::Bytes32;
use starknet::ContractAddress;

#[starknet::interface]
pub trait IPrismLayerZeroStarknet<TState> {
    fn send(ref self: TState, key: u128, options: ByteArray, fee: MessagingFee, refund: ContractAddress) -> MessageReceipt;
    fn quote(self: @TState, key: u128, options: ByteArray, pay_in_lz_token: bool) -> MessagingFee;
    fn encode_payload(self: @TState, key: u128) -> ByteArray;
    fn last_received_key(self: @TState) -> u128;
    fn last_received_src_eid(self: @TState) -> u32;
    fn last_received_guid(self: @TState) -> Bytes32;
    fn received(self: @TState, guid: Bytes32) -> bool;
    fn sent_count(self: @TState) -> u256;
    fn received_count(self: @TState) -> u256;
}

#[starknet::contract]
pub mod PrismLayerZeroStarknet {
    use super::{IPrismLayerZeroStarknet, MessageReceipt, MessagingFee, Origin};
    use layerzero::oapps::oapp::oapp_core::OAppCoreComponent;
    use lz_utils::bytes::Bytes32;
    use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
    use openzeppelin::access::ownable::OwnableComponent;
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address};

    pub const BASE_SEPOLIA_EID: u32 = 40245;
    pub const STARKNET_SEPOLIA_EID: u32 = 40500;
    pub const PAYLOAD_LENGTH: u32 = 16;

    component!(path: OAppCoreComponent, storage: oapp_core, event: OAppCoreEvent);
    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OAppCoreImpl = OAppCoreComponent::OAppCoreImpl<ContractState>;
    impl OAppCoreInternalImpl = OAppCoreComponent::InternalImpl<ContractState>;
    impl OAppCoreSenderImpl = OAppCoreComponent::OAppSenderImpl<ContractState>;
    #[abi(embed_v0)]
    impl OAppCoreReceiverImpl = OAppCoreComponent::OAppReceiverImpl<ContractState>;
    #[abi(embed_v0)]
    impl ILayerZeroReceiverImpl = OAppCoreComponent::LayerZeroReceiverImpl<ContractState>;
    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        sent_count: u256,
        received_count: u256,
        consumed_guid: Map<Bytes32, bool>,
        last_received_key: u128,
        last_received_src_eid: u32,
        last_received_guid: Bytes32,
        #[substorage(v0)] oapp_core: OAppCoreComponent::Storage,
        #[substorage(v0)] ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat] OAppCoreEvent: OAppCoreComponent::Event,
        #[flat] OwnableEvent: OwnableComponent::Event,
        MessageSent: MessageSent,
        MessageReceived: MessageReceived,
    }
    #[derive(Drop, starknet::Event)]
    pub struct MessageSent { #[key] dst_eid: u32, #[key] key: u128, guid: Bytes32, nonce: u64 }
    #[derive(Drop, starknet::Event)]
    pub struct MessageReceived { #[key] src_eid: u32, #[key] key: u128, guid: Bytes32, nonce: u64 }

    #[constructor]
    fn constructor(ref self: ContractState, endpoint: ContractAddress, owner: ContractAddress, native_token: ContractAddress) {
        self.oapp_core.initializer(endpoint, owner, native_token);
        self.ownable.initializer(owner);
    }

    fn payload(key: u128) -> ByteArray {
        assert(key != 0, 'PRISM_KEY_ZERO');
        let mut out = Default::default();
        out.append_u128(key);
        out
    }

    #[abi(embed_v0)]
    impl PrismImpl of IPrismLayerZeroStarknet<ContractState> {
        fn send(ref self: ContractState, key: u128, options: ByteArray, fee: MessagingFee, refund: ContractAddress) -> MessageReceipt {
            let receipt = self.oapp_core._lz_send(get_caller_address(), BASE_SEPOLIA_EID, payload(key), options, fee, refund);
            self.sent_count.write(self.sent_count.read() + 1);
            self.emit(MessageSent { dst_eid: BASE_SEPOLIA_EID, key, guid: receipt.guid, nonce: receipt.nonce });
            receipt
        }
        fn quote(self: @ContractState, key: u128, options: ByteArray, pay_in_lz_token: bool) -> MessagingFee {
            self.oapp_core._quote(BASE_SEPOLIA_EID, payload(key), options, pay_in_lz_token)
        }
        fn encode_payload(self: @ContractState, key: u128) -> ByteArray { payload(key) }
        fn last_received_key(self: @ContractState) -> u128 { self.last_received_key.read() }
        fn last_received_src_eid(self: @ContractState) -> u32 { self.last_received_src_eid.read() }
        fn last_received_guid(self: @ContractState) -> Bytes32 { self.last_received_guid.read() }
        fn received(self: @ContractState, guid: Bytes32) -> bool { self.consumed_guid.read(guid) }
        fn sent_count(self: @ContractState) -> u256 { self.sent_count.read() }
        fn received_count(self: @ContractState) -> u256 { self.received_count.read() }
    }

    impl OAppHooks of OAppCoreComponent::OAppHooks<ContractState> {
        fn _lz_receive(ref self: OAppCoreComponent::ComponentState<ContractState>, origin: Origin, guid: Bytes32, message: ByteArray, executor: ContractAddress, extra_data: ByteArray, value: u256) {
            let mut contract = self.get_contract_mut();
            assert(origin.src_eid == BASE_SEPOLIA_EID, 'PRISM_BAD_SOURCE_EID');
            assert(message.len() == PAYLOAD_LENGTH, 'PRISM_BAD_PAYLOAD_LENGTH');
            let (_, key) = message.read_u128(0);
            assert(key != 0, 'PRISM_KEY_ZERO');
            assert(!contract.consumed_guid.read(guid), 'PRISM_GUID_REPLAY');
            contract.consumed_guid.write(guid, true);
            contract.last_received_key.write(key);
            contract.last_received_src_eid.write(origin.src_eid);
            contract.last_received_guid.write(guid);
            contract.received_count.write(contract.received_count.read() + 1);
            contract.emit(MessageReceived { src_eid: origin.src_eid, key, guid, nonce: origin.nonce });
        }
    }
}
