import "server-only";

import { isAddress, type Address, type Hex } from "viem";
import { requireEnv } from "@/lib/spin/config";

export const MAX_RABBIT_HOLE_ELIGIBLE = 100;

export type RabbitHoleNetworkKey = "mainnet" | "testnet";

export type RabbitHoleNetwork = {
  key: RabbitHoleNetworkKey;
  chainId: number;
  name: string;
  explorerUrl: string;
  rpcUrl: string;
  contractAddress: Address | null;
};

export function normalizeXUsername(value: string) {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

export function isValidXUsername(value: string) {
  return /^[a-z0-9_]{1,15}$/.test(normalizeXUsername(value));
}

export function isRabbitHolePublic() {
  return process.env.RABBIT_HOLE_PUBLIC?.trim().toLowerCase() === "true";
}

function optionalAddress(name: string): Address | null {
  const value = process.env[name]?.trim() ?? "";
  if (!value) return null;
  if (!isAddress(value)) throw new Error(`${name} must be a valid EVM address.`);
  return value as Address;
}

export function getRabbitHoleNetwork(): RabbitHoleNetwork {
  const key: RabbitHoleNetworkKey = process.env.RABBIT_HOLE_NETWORK?.trim().toLowerCase() === "mainnet"
    ? "mainnet"
    : "testnet";
  const mainnet = key === "mainnet";
  const publicRpcUrl = mainnet
    ? "https://rpc.mainnet.chain.robinhood.com"
    : "https://rpc.testnet.chain.robinhood.com";
  return {
    key,
    chainId: mainnet ? 4663 : 46630,
    name: mainnet ? "Robinhood Chain" : "Robinhood Chain Testnet",
    explorerUrl: mainnet
      ? "https://robinhoodchain.blockscout.com"
      : "https://explorer.testnet.chain.robinhood.com",
    rpcUrl: process.env[mainnet ? "ROBINHOOD_MAINNET_RPC_URL" : "ROBINHOOD_TESTNET_RPC_URL"]?.trim()
      || publicRpcUrl,
    contractAddress: optionalAddress(
      mainnet ? "RABBIT_HOLE_MAINNET_CONTRACT_ADDRESS" : "RABBIT_HOLE_TESTNET_CONTRACT_ADDRESS",
    ),
  };
}

export function getRabbitHoleMinterKey(): Hex {
  const value = requireEnv("RABBIT_HOLE_MINTER_PRIVATE_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("RABBIT_HOLE_MINTER_PRIVATE_KEY must be a 32-byte 0x-prefixed private key.");
  }
  return value as Hex;
}
