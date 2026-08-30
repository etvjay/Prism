// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {PrismLayerZeroBase} from "../src/PrismLayerZeroBase.sol";

/// @notice Dry-run deployment script. Broadcast only when explicitly requested by Foundry.
contract DeployPrismLayerZeroBase is Script {
    function run() external returns (PrismLayerZeroBase app) {
        address endpoint = vm.envAddress("BASE_LZ_ENDPOINT");
        address owner = vm.envAddress("BASE_OAPP_OWNER");
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        app = new PrismLayerZeroBase(endpoint, owner);
        vm.stopBroadcast();
    }
}
