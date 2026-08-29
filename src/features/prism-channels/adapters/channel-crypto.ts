// Established hash adapter for channel commitments. No network or key
// material is accessed here; viem supplies the standard Keccak-256 primitive.

import { keccak256, toBytes } from "viem";
import type { ChannelCommitmentHashPort } from "../domain/ports";
import type { Hex } from "../domain/channel";

export const viemChannelCommitmentHash: ChannelCommitmentHashPort = {
  hashUtf8(input: string): Hex {
    return keccak256(toBytes(input)) as Hex;
  },
};
