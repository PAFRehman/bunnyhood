import "server-only";

import { HttpError } from "@/lib/spin/http";

const CHAIN_ID = 4663;
const PUBLIC_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
const EXPLORER_API_URL = "https://robinhoodchain.blockscout.com/api/v2";
const BLOCKSCOUT_API_URL = `https://api.blockscout.com/${CHAIN_ID}/api/v2`;
const REQUEST_TIMEOUT_MS = 8_000;
const NFT_TYPES = "ERC-721,ERC-404,ERC-1155";

type ItemsReply = { items?: unknown[] };
type AlchemyNftReply = { result?: { ownedNfts?: unknown[]; totalCount?: number | string }; error?: unknown };
type RpcReply = { result?: string; error?: unknown };

function rpcUrl() {
  return process.env.ROBINHOOD_MAINNET_RPC_URL?.trim() || PUBLIC_RPC_URL;
}

function blockscoutUrl(path: string) {
  const apiKey = process.env.ROBINHOOD_BLOCKSCOUT_API_KEY?.trim()
    || process.env.BLOCKSCOUT_API_KEY?.trim();
  const url = new URL(path, apiKey ? `${BLOCKSCOUT_API_URL}/` : `${EXPLORER_API_URL}/`);
  if (apiKey) url.searchParams.set("apikey", apiKey);
  return url;
}

async function getIndexedItems(path: string, params?: Record<string, string>) {
  const url = blockscoutUrl(path);
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`Blockscout returned ${response.status}.`);
  const data = await response.json() as ItemsReply;
  if (!Array.isArray(data.items)) throw new Error("Blockscout returned an invalid response.");
  return data.items;
}

async function getBlockscoutNftCount(wallet: string) {
  const items = await getIndexedItems(`addresses/${wallet}/nft`, { type: NFT_TYPES });
  return items.length;
}

async function getBlockscoutTransactionCount(wallet: string) {
  const items = await getIndexedItems(`addresses/${wallet}/transactions`, { filter: "to | from" });
  return items.length;
}

async function rpc(method: string, params: unknown[]) {
  const response = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Robinhood RPC returned ${response.status}.`);
  return response.json();
}

async function getAlchemyNftCount(wallet: string) {
  const data = await rpc("alchemy_getNFTsForOwner", [wallet, {
    pageSize: 1,
    omitMetadata: true,
    excludeFilters: ["SPAM"],
  }]) as AlchemyNftReply;
  if (data.error || !data.result) throw new Error("The RPC provider does not offer indexed NFT ownership.");
  const total = Number(data.result.totalCount ?? data.result.ownedNfts?.length ?? 0);
  return Number.isFinite(total) ? Math.max(0, total) : 0;
}

async function getOutgoingTransactionCount(wallet: string) {
  const data = await rpc("eth_getTransactionCount", [wallet, "latest"]) as RpcReply;
  if (data.error || !/^0x[0-9a-f]+$/i.test(data.result ?? "")) {
    throw new Error("The RPC provider did not return a transaction count.");
  }
  const count = BigInt(data.result ?? "0x0");
  return count > 0n ? 1 : 0;
}

export type RobinhoodWalletProof = {
  chainId: 4663;
  nftCount: number;
  transactionCount: number;
};

export async function inspectRobinhoodWallet(wallet: string): Promise<RobinhoodWalletProof> {
  const [indexedNfts, indexedTransactions] = await Promise.allSettled([
    getBlockscoutNftCount(wallet),
    getBlockscoutTransactionCount(wallet),
  ]);

  let nftCount = indexedNfts.status === "fulfilled" ? indexedNfts.value : null;
  let transactionCount = indexedTransactions.status === "fulfilled" ? indexedTransactions.value : null;

  if (nftCount === null) {
    try {
      nftCount = await getAlchemyNftCount(wallet);
    } catch {
      nftCount = null;
    }
  }
  if (transactionCount === null) {
    try {
      transactionCount = await getOutgoingTransactionCount(wallet);
    } catch {
      transactionCount = null;
    }
  }

  if (nftCount === null || transactionCount === null) {
    throw new HttpError(
      503,
      "Robinhood Chain verification is temporarily unavailable. Try again shortly.",
      "CHAIN_DATA_UNAVAILABLE",
    );
  }

  return { chainId: CHAIN_ID, nftCount, transactionCount };
}
