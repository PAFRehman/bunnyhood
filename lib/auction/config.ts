import { isAddress, type Address } from "viem";

export type AuctionNetworkKey = "mainnet" | "testnet";

export type PublicAuctionNetwork = {
  key: AuctionNetworkKey;
  chainId: number;
  name: string;
  shortName: string;
  explorerUrl: string;
  publicRpcUrl: string;
  auctionAddress: Address | null;
  usdgAddress: Address | null;
  deploymentBlock: string | null;
  configured: boolean;
};

export type ServerAuctionNetwork = PublicAuctionNetwork & {
  rpcUrl: string;
};

const MAINNET_AUCTION_FALLBACK = "0x5991A2dF15A8F6A256D3Ec51E99254Cd3fb576A9";
const MAINNET_USDG_FALLBACK = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

function optionalAddress(name: string, fallback?: string): Address | null {
  const value = process.env[name]?.trim() || fallback || "";
  if (!value) return null;
  if (!isAddress(value)) throw new Error(`${name} must be a valid EVM address.`);
  return value as Address;
}

function optionalBlock(name: string) {
  const value = process.env[name]?.trim();
  if (!value) return null;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a non-negative block number.`);
  return value;
}

export function getAuctionNetwork(key: AuctionNetworkKey): ServerAuctionNetwork {
  const mainnet = key === "mainnet";
  const publicRpcUrl = mainnet
    ? "https://rpc.mainnet.chain.robinhood.com"
    : "https://rpc.testnet.chain.robinhood.com";
  const auctionAddress = optionalAddress(
    mainnet ? "AUCTION_MAINNET_ADDRESS" : "AUCTION_TESTNET_ADDRESS",
    mainnet ? MAINNET_AUCTION_FALLBACK : undefined,
  );
  const usdgAddress = optionalAddress(
    mainnet ? "USDG_MAINNET_ADDRESS" : "USDG_TESTNET_ADDRESS",
    mainnet ? MAINNET_USDG_FALLBACK : undefined,
  );

  return {
    key,
    chainId: mainnet ? 4663 : 46630,
    name: mainnet ? "Robinhood Chain" : "Robinhood Chain Testnet",
    shortName: mainnet ? "Mainnet" : "Testnet",
    explorerUrl: mainnet
      ? "https://robinhoodchain.blockscout.com"
      : "https://explorer.testnet.chain.robinhood.com",
    publicRpcUrl,
    rpcUrl: process.env[mainnet ? "ROBINHOOD_MAINNET_RPC_URL" : "ROBINHOOD_TESTNET_RPC_URL"]?.trim()
      || publicRpcUrl,
    auctionAddress,
    usdgAddress,
    deploymentBlock: optionalBlock(
      mainnet ? "AUCTION_MAINNET_DEPLOYMENT_BLOCK" : "AUCTION_TESTNET_DEPLOYMENT_BLOCK",
    ),
    configured: Boolean(auctionAddress && usdgAddress),
  };
}

export function toPublicAuctionNetwork(network: ServerAuctionNetwork): PublicAuctionNetwork {
  const { rpcUrl: _privateRpcUrl, ...safe } = network;
  void _privateRpcUrl;
  return safe;
}

export function getPublicAuctionNetworks() {
  return ["mainnet", "testnet"].map((key) =>
    toPublicAuctionNetwork(getAuctionNetwork(key as AuctionNetworkKey))
  );
}

export function parseAuctionNetwork(value: string | null): AuctionNetworkKey {
  return value === "testnet" ? "testnet" : "mainnet";
}
