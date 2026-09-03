import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  TESTNET_PROFILE,
  MAINNET_PROFILE,
  validateNetworkProfile,
  type NetworkProfile,
} from "../network-profile";

const completeMainnet = (): NetworkProfile => ({
  ...MAINNET_PROFILE,
  status: "READY",
  starknet: {
    ...MAINNET_PROFILE.starknet,
    registry: { ...MAINNET_PROFILE.starknet.registry, address: "0x" + "1".repeat(64), classHash: "0x" + "2".repeat(64), deploymentBlock: 123, constructorParameters: ["0x3"], abiVersion: "v2", schemaVersion: "v2" },
  },
  base: {
    ...MAINNET_PROFILE.base,
    registry: { ...MAINNET_PROFILE.base.registry, address: "0x" + "4".repeat(40), classHash: "0x" + "7".repeat(64), deploymentBlock: 456, constructorParameters: ["0xa"], abiVersion: "v1", schemaVersion: "v1" },
    helper: { ...MAINNET_PROFILE.base.helper, address: "0x" + "5".repeat(40), classHash: "0x" + "8".repeat(64), deploymentBlock: 456, constructorParameters: ["0xb"], abiVersion: "v1", schemaVersion: "v1" },
    oapp: { ...MAINNET_PROFILE.base.oapp, address: "0x" + "6".repeat(40), classHash: "0x" + "9".repeat(64), deploymentBlock: 456, constructorParameters: ["0xc"], abiVersion: "v1", schemaVersion: "v1" },
  },
  immutableContractSet: ["SN_MAIN.registry", "BASE_MAINNET.registry", "BASE_MAINNET.helper", "BASE_MAINNET.oapp"],
  independentlyValidated: true,
  validationSource: "independent test fixture",
});

describe("network configuration profiles", () => {
  it("keeps testnet complete, valid, and the default", () => {
    expect(TESTNET_PROFILE.isDefault).toBe(true);
    expect(validateNetworkProfile(TESTNET_PROFILE)).toMatchObject({ networkIdentity: "SN_SEPOLIA+BASE_SEPOLIA" });
  });

  it("fails closed for the shipped mainnet profile", () => {
    expect(() => validateNetworkProfile(MAINNET_PROFILE)).toThrow(/mainnet.*incomplete|missing/i);
  });

  it("validates a complete mainnet profile only when every figure is supplied", () => {
    expect(validateNetworkProfile(completeMainnet())).toMatchObject({ networkIdentity: "SN_MAIN+BASE_MAINNET" });
  });

  it("rejects placeholders, cross-network figures, and invalid immutable sets", () => {
    expect(() => validateNetworkProfile({ ...completeMainnet(), starknet: { ...completeMainnet().starknet, registry: { ...completeMainnet().starknet.registry, address: "0x<REGISTRY>" } } })).toThrow(/placeholder|address/i);
    expect(() => validateNetworkProfile({ ...completeMainnet(), base: { ...completeMainnet().base, chainId: 84532 } })).toThrow(/chain|network/i);
    expect(() => validateNetworkProfile({ ...completeMainnet(), immutableContractSet: [] })).toThrow(/immutable/i);
    expect(() => validateNetworkProfile({ ...completeMainnet(), immutableContractSet: ["SN_MAIN.registry", "SN_MAIN.registry", "BASE_MAINNET.helper", "BASE_MAINNET.oapp"] })).toThrow(/immutable/i);
    expect(() => validateNetworkProfile({ ...TESTNET_PROFILE, immutableContractSet: ["SN_SEPOLIA.registry", "SN_SEPOLIA.registry"] })).toThrow(/unique/i);
    expect(() => validateNetworkProfile({ ...completeMainnet(), base: { ...completeMainnet().base, helper: { ...completeMainnet().base.helper, address: completeMainnet().base.registry.address } } })).toThrow(/unique/i);
  });

  it("does not mutate the STRK20 evidence artifact", () => {
    const before = readFileSync("strk20.json", "utf8");
    expect(() => validateNetworkProfile(MAINNET_PROFILE)).toThrow();
    expect(readFileSync("strk20.json", "utf8")).toBe(before);
  });
});
