import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { compileRabbitHoleContract } from "./lib/rabbithole-contract.mjs";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

const networkKey = (process.env.RABBITHOLE_NETWORK || "testnet").toLowerCase();
if (networkKey !== "mainnet" && networkKey !== "testnet") {
  throw new Error("RABBITHOLE_NETWORK must be mainnet or testnet.");
}
const mainnet = networkKey === "mainnet";
const chainId = mainnet ? 4663 : 46630;
const rpcUrl = process.env.RABBITHOLE_RPC_URL?.trim()
  || (mainnet ? "https://rpc.mainnet.chain.robinhood.com" : "https://rpc.testnet.chain.robinhood.com");
const explorerUrl = mainnet
  ? "https://robinhoodchain.blockscout.com"
  : "https://explorer.testnet.chain.robinhood.com";
const privateKey = required("RABBITHOLE_DEPLOYER_PRIVATE_KEY");
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("RABBITHOLE_DEPLOYER_PRIVATE_KEY is invalid.");

const owner = getAddress(required("RABBITHOLE_OWNER_ADDRESS"));
const minter = getAddress(required("RABBITHOLE_MINTER_ADDRESS"));
const account = privateKeyToAccount(privateKey);
const chain = defineChain({
  id: chainId,
  name: mainnet ? "Robinhood Chain" : "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: { default: { name: "Robinhood Explorer", url: explorerUrl } },
  testnet: !mainnet,
});
const transport = http(rpcUrl, { retryCount: 2, timeout: 20_000 });
const publicClient = createPublicClient({ chain, transport });
const walletClient = createWalletClient({ account, chain, transport });
const artifact = compileRabbitHoleContract();

console.log(`Deploying BunnyHoodRabbitHoleSBT to ${chain.name} from ${account.address}...`);
const transactionHash = await walletClient.deployContract({
  account,
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  args: [owner, minter],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash, confirmations: 1 });
if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Contract deployment reverted.");
console.log(`Contract: ${receipt.contractAddress}`);
console.log(`Block: ${receipt.blockNumber}`);
console.log(`Transaction: ${explorerUrl}/tx/${transactionHash}`);
