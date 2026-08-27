import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, getAddress, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const artifact = JSON.parse(readFileSync(new URL("../contracts/artifacts/BunnyHoodRabbitHoleSBT.json", import.meta.url), "utf8"));
const mainnet = process.env.RABBIT_HOLE_NETWORK?.trim().toLowerCase() === "mainnet";
const network = {
  key: mainnet ? "mainnet" : "testnet",
  chainId: mainnet ? 4663 : 46630,
  name: mainnet ? "Robinhood Chain" : "Robinhood Chain Testnet",
  explorerUrl: mainnet ? "https://robinhoodchain.blockscout.com" : "https://explorer.testnet.chain.robinhood.com",
};
const rpcUrl = process.env[mainnet ? "ROBINHOOD_MAINNET_RPC_URL" : "ROBINHOOD_TESTNET_RPC_URL"]?.trim()
  || (mainnet ? "https://rpc.mainnet.chain.robinhood.com" : "https://rpc.testnet.chain.robinhood.com");
const privateKey = process.env.RABBIT_HOLE_MINTER_PRIVATE_KEY?.trim() ?? "";
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("Set a valid RABBIT_HOLE_MINTER_PRIVATE_KEY.");
const account = privateKeyToAccount(privateKey);
const chain = defineChain({
  id: network.chainId,
  name: network.name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: { default: { name: "Robinhood Explorer", url: network.explorerUrl } },
  testnet: !mainnet,
});
const transport = http(rpcUrl, { timeout: 20_000, retryCount: 2 });
const publicClient = createPublicClient({ chain, transport });
const walletClient = createWalletClient({ account, chain, transport });
const ownerValue = process.env.RABBIT_HOLE_OWNER_ADDRESS?.trim() || account.address;
if (!isAddress(ownerValue)) throw new Error("RABBIT_HOLE_OWNER_ADDRESS must be a valid EVM address.");
const owner = getAddress(ownerValue);

console.log(`Deploying Bunny Hood Rabbit Hole SBT to ${network.name} (${network.chainId})…`);
console.log(`Owner: ${owner}`);
console.log(`Minter: ${account.address}`);
const hash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  account,
  args: ["Bunny Hood Rabbit Hole", "BHRH", owner, account.address],
});
console.log(`Transaction: ${network.explorerUrl}/tx/${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("SBT deployment reverted.");
console.log(`Contract: ${receipt.contractAddress}`);
console.log(`Set ${network.key === "mainnet" ? "RABBIT_HOLE_MAINNET_CONTRACT_ADDRESS" : "RABBIT_HOLE_TESTNET_CONTRACT_ADDRESS"}=${receipt.contractAddress}`);
