import "server-only";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getRabbitHoleMinterKey, getRabbitHoleNetwork } from "./config";

export function getRabbitHoleChainClients() {
  const { network, chain, publicClient, transport } = getRabbitHolePublicClient();
  const account = privateKeyToAccount(getRabbitHoleMinterKey());
  const walletClient = createWalletClient({ account, chain, transport });
  return { network, chain, publicClient, walletClient, account };
}

export function getRabbitHolePublicClient() {
  const network = getRabbitHoleNetwork();
  const chain = defineChain({
    id: network.chainId,
    name: network.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [network.rpcUrl] } },
    blockExplorers: { default: { name: "Robinhood Explorer", url: network.explorerUrl } },
    testnet: network.key === "testnet",
  });
  const transport = http(network.rpcUrl, { timeout: 15_000, retryCount: 2 });
  const publicClient = createPublicClient({ chain, transport });
  return { network, chain, publicClient, transport };
}
