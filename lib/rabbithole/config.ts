import { isAddress, type Address, type Hex } from "viem";
import { getAppUrl } from "@/lib/spin/config";

export type RabbitHoleNetworkKey = "mainnet" | "testnet";

export type PublicRabbitHoleNetwork = {
  key: RabbitHoleNetworkKey;
  chainId: 4663 | 46630;
  name: string;
  explorerUrl: string;
  contractAddress: Address | null;
  deploymentBlock: string | null;
  configured: boolean;
};

export type ServerRabbitHoleNetwork = PublicRabbitHoleNetwork & {
  rpcUrl: string;
  minterPrivateKey: Hex | null;
};

function networkKey(): RabbitHoleNetworkKey {
  const value = process.env.RABBITHOLE_NETWORK?.trim().toLowerCase() || "testnet";
  if (value !== "mainnet" && value !== "testnet") {
    throw new Error("RABBITHOLE_NETWORK must be mainnet or testnet.");
  }
  return value;
}

function optionalAddress(name: string): Address | null {
  const value = process.env[name]?.trim() || "";
  if (!value || value.startsWith("REPLACE_")) return null;
  if (!isAddress(value)) throw new Error(`${name} must be a valid EVM address.`);
  return value as Address;
}

function optionalPrivateKey(): Hex | null {
  const value = process.env.RABBITHOLE_MINTER_PRIVATE_KEY?.trim() || "";
  if (!value || value.startsWith("REPLACE_")) return null;
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("RABBITHOLE_MINTER_PRIVATE_KEY must be a 32-byte hex private key.");
  }
  return value as Hex;
}

function optionalDeploymentBlock() {
  const value = process.env.RABBITHOLE_DEPLOYMENT_BLOCK?.trim() || "";
  if (!value || value.startsWith("REPLACE_")) return null;
  if (!/^\d+$/.test(value)) {
    throw new Error("RABBITHOLE_DEPLOYMENT_BLOCK must be a non-negative block number.");
  }
  return value;
}

export function getRabbitHoleNetwork(): ServerRabbitHoleNetwork {
  const key = networkKey();
  const mainnet = key === "mainnet";
  const publicRpcUrl = mainnet
    ? "https://rpc.mainnet.chain.robinhood.com"
    : "https://rpc.testnet.chain.robinhood.com";
  const contractAddress = optionalAddress("RABBITHOLE_CONTRACT_ADDRESS");
  const minterPrivateKey = optionalPrivateKey();

  return {
    key,
    chainId: mainnet ? 4663 : 46630,
    name: mainnet ? "Robinhood Chain" : "Robinhood Chain Testnet",
    explorerUrl: mainnet
      ? "https://robinhoodchain.blockscout.com"
      : "https://explorer.testnet.chain.robinhood.com",
    rpcUrl: process.env.RABBITHOLE_RPC_URL?.trim() || publicRpcUrl,
    contractAddress,
    deploymentBlock: optionalDeploymentBlock(),
    minterPrivateKey,
    configured: Boolean(contractAddress && minterPrivateKey),
  };
}

export function getPublicRabbitHoleNetwork(): PublicRabbitHoleNetwork {
  const { rpcUrl: _rpc, minterPrivateKey: _key, ...network } = getRabbitHoleNetwork();
  void _rpc;
  void _key;
  return network;
}

export function rabbitHoleMetadataUri(claimKey: Hex) {
  return `${getAppUrl()}/api/rabbithole/metadata/${claimKey}`;
}
