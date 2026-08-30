// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OApp, Origin, MessagingFee, MessagingReceipt} from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Minimal non-value Prism OApp for Base Sepolia (LayerZero EID 40245).
/// @dev The application payload is exactly one uint128 in big-endian form (16 bytes),
/// matching the existing Prism testnet schema. Endpoint/OApp peer checks remain active.
contract PrismLayerZeroBase is OApp {
    uint32 public constant STARKNET_SEPOLIA_EID = 40500;
    uint32 public constant BASE_SEPOLIA_EID = 40245;
    bytes32 public constant PAYLOAD_SCHEMA = keccak256("prism:uint128-be");

    mapping(bytes32 guid => bool consumed) public consumedGuid;
    uint256 public sentCount;
    uint256 public receivedCount;
    uint128 public lastReceivedKey;
    uint32 public lastReceivedSrcEid;
    bytes32 public lastReceivedGuid;

    event PrismLayerZeroMessageSent(uint32 indexed dstEid, uint128 indexed key, bytes32 guid, uint64 nonce);
    event PrismLayerZeroMessageReceived(uint32 indexed srcEid, uint128 indexed key, bytes32 indexed guid, uint64 nonce);

    error InvalidEndpoint(uint32 eid);
    error InvalidKey();
    error InvalidPayload();
    error Replay(bytes32 guid);

    constructor(address endpoint_, address owner_) OApp(endpoint_, owner_) Ownable(owner_) {}

    function encodePayload(uint128 key) public pure returns (bytes memory) {
        if (key == 0) revert InvalidKey();
        return abi.encodePacked(key);
    }

    function quoteSend(uint128 key, bytes calldata options) external view returns (MessagingFee memory fee) {
        fee = _quote(STARKNET_SEPOLIA_EID, encodePayload(key), options, false);
    }

    /// @notice Sends the schema payload to the configured Starknet Sepolia peer.
    /// @dev This function accepts native msg.value only for the LayerZero messaging fee;
    /// no application value is transferred.
    function send(uint128 key, bytes calldata options) external payable returns (MessagingReceipt memory receipt) {
        bytes memory payload = encodePayload(key);
        receipt = _lzSend(
            STARKNET_SEPOLIA_EID,
            payload,
            options,
            MessagingFee(msg.value, 0),
            payable(msg.sender)
        );
        sentCount += 1;
        emit PrismLayerZeroMessageSent(STARKNET_SEPOLIA_EID, key, receipt.guid, receipt.nonce);
    }

    function _lzReceive(
        Origin calldata origin,
        bytes32 guid,
        bytes calldata message,
        address,
        bytes calldata
    ) internal override {
        if (origin.srcEid != STARKNET_SEPOLIA_EID) revert InvalidEndpoint(origin.srcEid);
        if (message.length != 16) revert InvalidPayload();
        uint128 key;
        assembly { key := shr(128, calldataload(message.offset)) }
        if (key == 0) revert InvalidKey();
        if (consumedGuid[guid]) revert Replay(guid);
        consumedGuid[guid] = true;
        receivedCount += 1;
        lastReceivedKey = key;
        lastReceivedSrcEid = origin.srcEid;
        lastReceivedGuid = guid;
        emit PrismLayerZeroMessageReceived(origin.srcEid, key, guid, origin.nonce);
    }
}
