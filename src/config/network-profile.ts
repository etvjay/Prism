/** Typed, environment-scoped deployment figures. Null means not supplied. */
export type NetworkName = "SN_SEPOLIA" | "SN_MAIN";
export type BaseNetworkName = "BASE_SEPOLIA" | "BASE_MAINNET";
export type ProfileStatus = "ACCEPTED" | "RELEASE_GATED_PROPOSED" | "READY";

export type ContractFigure = {
  address: string | null;
  classHash: string | null;
  deploymentBlock: number | null;
  constructorParameters: readonly string[] | null;
  abiVersion: string | null;
  schemaVersion: string | null;
};

export type NetworkProfile = {
  environment: "testnet" | "mainnet";
  status: ProfileStatus;
  isDefault: boolean;
  networkIdentity: `${NetworkName}+${BaseNetworkName}`;
  starknet: {
    network: NetworkName;
    chainId: NetworkName;
    registry: ContractFigure;
  };
  base: {
    network: BaseNetworkName;
    chainId: number;
    registry: ContractFigure;
    helper: ContractFigure;
    oapp: ContractFigure;
  };
  immutableContractSet: readonly string[];
  independentlyValidated: boolean;
  validationSource: string | null;
};

const emptyFigure = (): ContractFigure => ({
  address: null,
  classHash: null,
  deploymentBlock: null,
  constructorParameters: null,
  abiVersion: null,
  schemaVersion: null,
});

/** Existing testnet scope. No mainnet figure is inherited by this object. */
export const TESTNET_PROFILE: NetworkProfile = {
  environment: "testnet",
  status: "ACCEPTED",
  isDefault: true,
  networkIdentity: "SN_SEPOLIA+BASE_SEPOLIA",
  starknet: {
    network: "SN_SEPOLIA",
    chainId: "SN_SEPOLIA",
    registry: {
      address: "0x06f77be5c7bdfef252dd322481b4430a587b781df4f79d3b344808d125ec530d",
      classHash: "0x4349a331b4339c1f20ccdb745e2d60a194f8da64cb789bb70bf60463f42dd8d",
      deploymentBlock: 14015842,
      constructorParameters: [],
      abiVersion: "v2",
      schemaVersion: "v2",
    },
  },
  base: {
    network: "BASE_SEPOLIA",
    chainId: 84532,
    registry: emptyFigure(),
    helper: emptyFigure(),
    oapp: emptyFigure(),
  },
  immutableContractSet: ["SN_SEPOLIA.registry"],
  independentlyValidated: true,
  validationSource: "existing testnet deployment manifest",
};

/** Deliberately un-runnable until an operator supplies every exact figure. */
export const MAINNET_PROFILE: NetworkProfile = {
  environment: "mainnet",
  status: "RELEASE_GATED_PROPOSED",
  isDefault: false,
  networkIdentity: "SN_MAIN+BASE_MAINNET",
  starknet: { network: "SN_MAIN", chainId: "SN_MAIN", registry: emptyFigure() },
  base: {
    network: "BASE_MAINNET",
    chainId: 8453,
    registry: emptyFigure(),
    helper: emptyFigure(),
    oapp: emptyFigure(),
  },
  immutableContractSet: [],
  independentlyValidated: false,
  validationSource: null,
};

const ADDRESS = /^0x[0-9a-f]{1,64}$/i;
const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;
const PLACEHOLDER = /<|>|placeholder|todo|tbd|example|changeme/i;
const MAINNET_IMMUTABLE_CONTRACT_SET = ["SN_MAIN.registry", "BASE_MAINNET.registry", "BASE_MAINNET.helper", "BASE_MAINNET.oapp"] as const;

function requireFigure(figure: ContractFigure, label: string, evm: boolean): void {
  if (!figure.address || PLACEHOLDER.test(figure.address) || !(evm ? EVM_ADDRESS : ADDRESS).test(figure.address)) throw new Error(`${label}.address missing or invalid`);
  if (!figure.classHash || PLACEHOLDER.test(figure.classHash) || !/^0x[0-9a-f]{1,64}$/i.test(figure.classHash)) throw new Error(`${label}.classHash missing or invalid`);
  if (figure.deploymentBlock === null || !Number.isSafeInteger(figure.deploymentBlock) || figure.deploymentBlock < 0) throw new Error(`${label}.deploymentBlock missing or invalid`);
  if (!figure.constructorParameters || figure.constructorParameters.some((v) => PLACEHOLDER.test(v))) throw new Error(`${label}.constructorParameters missing or invalid`);
  if (!figure.abiVersion || PLACEHOLDER.test(figure.abiVersion)) throw new Error(`${label}.abiVersion missing or invalid`);
  if (!figure.schemaVersion || PLACEHOLDER.test(figure.schemaVersion)) throw new Error(`${label}.schemaVersion missing or invalid`);
}

/** Validate identity always; validate all mainnet figures before it can run. */
export function validateNetworkProfile(profile: NetworkProfile): NetworkProfile {
  if (profile.networkIdentity !== `${profile.starknet.network}+${profile.base.network}`) throw new Error("network identity mismatch");
  if (profile.environment === "testnet" && profile.networkIdentity !== "SN_SEPOLIA+BASE_SEPOLIA") throw new Error("testnet network mismatch");
  if (profile.environment === "mainnet" && profile.networkIdentity !== "SN_MAIN+BASE_MAINNET") throw new Error("mainnet network mismatch");
  if (profile.environment === "mainnet" && profile.base.chainId !== 8453) throw new Error("mainnet Base chain mismatch");
  if (profile.environment === "testnet" && profile.base.chainId !== 84532) throw new Error("testnet Base chain mismatch");
  if (profile.environment === "testnet") requireFigure(profile.starknet.registry, "starknet.registry", false);
  if (profile.environment === "mainnet") {
    requireFigure(profile.starknet.registry, "starknet.registry", false);
    requireFigure(profile.base.registry, "base.registry", true);
    requireFigure(profile.base.helper, "base.helper", true);
    requireFigure(profile.base.oapp, "base.oapp", true);
    if (profile.status !== "READY" || profile.isDefault || !profile.independentlyValidated || !profile.validationSource) throw new Error("mainnet is incomplete or not independently validated");
    if (profile.immutableContractSet.length !== MAINNET_IMMUTABLE_CONTRACT_SET.length || new Set(profile.immutableContractSet).size !== MAINNET_IMMUTABLE_CONTRACT_SET.length || MAINNET_IMMUTABLE_CONTRACT_SET.some((identity) => !profile.immutableContractSet.includes(identity))) throw new Error("mainnet immutable contract set must contain each exact identity once");
  }
  if (profile.immutableContractSet.length === 0) throw new Error("immutable contract set missing");
  if (new Set(profile.immutableContractSet).size !== profile.immutableContractSet.length) throw new Error("immutable contract set must contain unique identities");
  const figures = [profile.starknet.registry, profile.base.registry, profile.base.helper, profile.base.oapp];
  const addresses = figures.map((figure) => figure.address).filter((address): address is string => Boolean(address));
  if (new Set(addresses.map((address) => address.toLowerCase())).size !== addresses.length) throw new Error("contract addresses must be unique");
  return profile;
}
