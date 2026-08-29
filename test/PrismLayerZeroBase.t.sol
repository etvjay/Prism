// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PrismLayerZeroBase} from "../src/PrismLayerZeroBase.sol";
import {ILayerZeroEndpointV2, MessagingParams, MessagingFee, MessagingReceipt, Origin} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";

contract LayerZeroEndpointMock {
    uint64 public nextNonce = 1;
    MessagingParams public lastParams;
    address public delegate;

    function setDelegate(address d) external { delegate = d; }
    function quote(MessagingParams calldata p, address) external pure returns (MessagingFee memory) {
        return MessagingFee(p.message.length + 100, 0);
    }
    function send(MessagingParams calldata p, address) external payable returns (MessagingReceipt memory r) {
        lastParams = p;
        r = MessagingReceipt(keccak256(abi.encode(p.message, nextNonce)), nextNonce++, MessagingFee(msg.value, 0));
    }
    function deliver(PrismLayerZeroBase app, Origin calldata origin, bytes32 guid, bytes calldata message) external {
        app.lzReceive(origin, guid, message, address(this), "");
    }
}

contract PrismLayerZeroBaseTest {
    uint32 constant STARKNET = 40500;
    bytes32 constant PEER = bytes32(uint256(0x4050));

    function deploy() internal returns (PrismLayerZeroBase app, LayerZeroEndpointMock endpoint) {
        endpoint = new LayerZeroEndpointMock();
        app = new PrismLayerZeroBase(address(endpoint), address(this));
        app.setPeer(STARKNET, PEER);
    }

    function testSendUsesOfficialEndpointAndExactSchema() public {
        (PrismLayerZeroBase app, LayerZeroEndpointMock endpoint) = deploy();
        MessagingReceipt memory receipt = app.send{value: 7}(42, "");
        require(receipt.nonce == 1);
        (uint32 dstEid, bytes32 receiver, bytes memory message,,) = endpoint.lastParams();
        require(dstEid == STARKNET);
        require(receiver == PEER);
        require(message.length == 16);
        require(uint128(bytes16(message)) == 42);
        require(app.sentCount() == 1);
    }

    function testReceiveReadbackAndReplayProtection() public {
        (PrismLayerZeroBase app, LayerZeroEndpointMock endpoint) = deploy();
        bytes memory body = app.encodePayload(0x0102030405060708090a0b0c0d0e0f10);
        bytes32 guid = bytes32(uint256(1));
        Origin memory origin = Origin(STARKNET, PEER, 9);
        endpoint.deliver(app, origin, guid, body);
        require(app.receivedCount() == 1);
        require(app.lastReceivedKey() == 0x0102030405060708090a0b0c0d0e0f10);
        require(app.lastReceivedSrcEid() == STARKNET && app.lastReceivedGuid() == guid);
        (bool ok,) = address(endpoint).call(abi.encodeCall(endpoint.deliver, (app, origin, guid, body)));
        require(!ok);
    }

    function testReceiveRejectsWrongSourcePeerAndSchema() public {
        (PrismLayerZeroBase app, LayerZeroEndpointMock endpoint) = deploy();
        bytes32 guid = bytes32(uint256(2));
        bytes memory body = app.encodePayload(1);
        (bool ok,) = address(endpoint).call(abi.encodeCall(endpoint.deliver, (app, Origin(40501, PEER, 1), guid, body)));
        require(!ok);
        (ok,) = address(endpoint).call(abi.encodeCall(endpoint.deliver, (app, Origin(STARKNET, bytes32(uint256(1)), 1), guid, body)));
        require(!ok);
        (ok,) = address(endpoint).call(abi.encodeCall(endpoint.deliver, (app, Origin(STARKNET, PEER, 1), guid, hex"01")));
        require(!ok);
        (ok,) = address(endpoint).call(abi.encodeCall(endpoint.deliver, (app, Origin(STARKNET, PEER, 1), guid, abi.encodePacked(uint128(0)))));
        require(!ok);
    }

    function testOnlyEndpointCanDeliver() public {
        (PrismLayerZeroBase app,) = deploy();
        (bool ok,) = address(app).call(abi.encodeWithSignature("lzReceive((uint32,bytes32,uint64),bytes32,bytes, address,bytes)", Origin(STARKNET, PEER, 1), bytes32(uint256(3)), app.encodePayload(1), address(this), ""));
        require(!ok);
    }

    function testZeroKeyRejected() public {
        (PrismLayerZeroBase app,) = deploy();
        (bool ok,) = address(app).call(abi.encodeCall(app.send, (uint128(0), bytes(""))));
        require(!ok);
    }
}
