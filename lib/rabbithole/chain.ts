import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { inTransaction } from "@/lib/spin/db";
import { HttpError } from "@/lib/spin/http";
import { RABBIT_HOLE_SBT_ABI } from "./abi";
import { getRabbitHoleNetwork } from "./config";

function clients() {
  const network = getRabbitHoleNetwork();
  if (!network.configured || !network.contractAddress || !network.minterPrivateKey) {
    throw new HttpError(
      503,
      "Rabbit Hole onchain minting is not configured yet.",
      "RABBITHOLE_NOT_CONFIGURED",
    );
  }
  const chain = defineChain({
    id: network.chainId,
    name: network.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [network.rpcUrl] } },
    blockExplorers: { default: { name: "Robinhood Explorer", url: network.explorerUrl } },
    testnet: network.key === "testnet",
  });
  const account = privateKeyToAccount(network.minterPrivateKey);
  const transport = http(network.rpcUrl, { retryCount: 2, timeout: 15_000 });
  return {
    network,
    account,
    publicClient: createPublicClient({ chain, transport }),
    walletClient: createWalletClient({ account, chain, transport }),
  };
}

async function verifyDeployment() {
  const context = clients();
  const { network, account, publicClient } = context;
  const bytecode = await publicClient.getBytecode({ address: network.contractAddress! });
  if (!bytecode || bytecode === "0x") {
    throw new HttpError(
      503,
      `No Rabbit Hole contract is deployed on ${network.name}.`,
      "RABBITHOLE_CONTRACT_MISSING",
    );
  }
  const minter = await publicClient.readContract({
    address: network.contractAddress!,
    abi: RABBIT_HOLE_SBT_ABI,
    functionName: "minter",
  });
  if (getAddress(minter) !== getAddress(account.address)) {
    throw new HttpError(
      503,
      "The configured Rabbit Hole signer is not the contract minter.",
      "RABBITHOLE_MINTER_MISMATCH",
    );
  }
  return context;
}

export async function readOnchainRabbitClaim(claimKey: Hex) {
  const { network, publicClient } = await verifyDeployment();
  const tokenId = await publicClient.readContract({
    address: network.contractAddress!,
    abi: RABBIT_HOLE_SBT_ABI,
    functionName: "claimTokenId",
    args: [claimKey],
  });
  if (tokenId === 0n) return null;
  const owner = await publicClient.readContract({
    address: network.contractAddress!,
    abi: RABBIT_HOLE_SBT_ABI,
    functionName: "ownerOf",
    args: [tokenId],
  });

  let transactionHash: Hex | null = null;
  try {
    const latestBlock = await publicClient.getBlockNumber();
    const configuredStart = network.deploymentBlock ? BigInt(network.deploymentBlock) : null;
    const fromBlock = configuredStart ?? (latestBlock > 100_000n ? latestBlock - 100_000n : 0n);
    const logs = await publicClient.getLogs({
      address: network.contractAddress!,
      event: RABBIT_HOLE_SBT_ABI[0],
      args: { claimKey },
      fromBlock,
      toBlock: "latest",
      strict: true,
    });
    transactionHash = logs.at(-1)?.transactionHash ?? null;
  } catch (error) {
    console.warn("Rabbit Hole claim log recovery was unavailable.", error);
  }
  return { tokenId, owner: getAddress(owner), transactionHash };
}

export async function broadcastRabbitClaim(input: {
  recipient: Address;
  claimKey: Hex;
  tokenUri: string;
}) {
  const context = await verifyDeployment();
  const { network, account, publicClient, walletClient } = context;

  return inTransaction(async (sql) => {
    await sql`select pg_advisory_xact_lock(hashtext('rabbit-hole-minter-nonce'))`;
    const request = await publicClient.simulateContract({
      account,
      address: network.contractAddress!,
      abi: RABBIT_HOLE_SBT_ABI,
      functionName: "mintClaim",
      args: [input.recipient, input.claimKey, input.tokenUri],
    });
    return walletClient.writeContract(request.request);
  });
}

export async function waitForRabbitClaim(transactionHash: Hex) {
  const { publicClient } = clients();
  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: transactionHash,
      confirmations: 1,
      timeout: 45_000,
      pollingInterval: 1_500,
    });
    return receipt.status === "success" ? "confirmed" as const : "reverted" as const;
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("timed out") || message.includes("timeout")) return "pending" as const;
    throw error;
  }
}
