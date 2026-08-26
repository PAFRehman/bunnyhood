import {
  createPublicClient,
  defineChain,
  http,
  isAddress,
  toEventSelector,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { AUCTION_ABI, ERC20_ABI } from "./abi";
import { getAuctionNetwork, type AuctionNetworkKey, type ServerAuctionNetwork } from "./config";

type RawAuction = {
  auctionId: bigint;
  seller: Address;
  startTime: bigint;
  endTime: bigint;
  minimumBid: bigint;
  minBidIncrementBps: bigint;
  highestBidder: Address;
  highestBid: bigint;
  state: number;
  totalBidsCount: bigint;
};

type RawReservation = {
  reservationId: bigint;
  winner: Address;
  winningBid: bigint;
  finalized: boolean;
  fulfilled: boolean;
};

type SerializableBid = {
  id: string;
  auctionId: string;
  bidder: Address;
  amount: string;
  transactionHash: Hex;
  blockNumber: string;
  logIndex: number;
  timestamp: string | null;
};

type ExplorerLog = {
  data?: string;
  topics?: string[];
  blockNumber?: string;
  transactionHash?: string;
  logIndex?: string;
  timeStamp?: string;
  timestamp?: string;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const BID_TOPIC = toEventSelector("BidPlaced(uint256,address,uint256)");
const STATE_NAMES = ["NOT CREATED", "CREATED", "ACTIVE", "SETTLED", "CANCELLED"];
const HISTORY_PAGE_SIZE = 1_000;
const MAX_HISTORY_PAGES = 100;
const RPC_LOG_CHUNK = 50_000n;

function buildClient(network: ServerAuctionNetwork) {
  const chain = defineChain({
    id: network.chainId,
    name: network.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [network.rpcUrl] } },
    blockExplorers: { default: { name: "Robinhood Explorer", url: network.explorerUrl } },
    testnet: network.key === "testnet",
  });
  return createPublicClient({
    chain,
    transport: http(network.rpcUrl, { retryCount: 2, timeout: 12_000 }),
  });
}

function numeric(value: string | undefined) {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function topicAddress(value: string | undefined): Address | null {
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) return null;
  const address = `0x${value.slice(-40)}`;
  return isAddress(address) ? address as Address : null;
}

function parseExplorerLog(log: ExplorerLog): SerializableBid | null {
  const bidder = topicAddress(log.topics?.[2]);
  const transactionHash = log.transactionHash;
  const data = log.data;
  if (!bidder || !transactionHash || !/^0x[0-9a-fA-F]{64}$/.test(transactionHash) || !data) {
    return null;
  }
  const blockNumber = numeric(log.blockNumber);
  const logIndex = Number(numeric(log.logIndex));
  const timestampValue = numeric(log.timeStamp || log.timestamp);
  return {
    id: `${transactionHash.toLowerCase()}:${logIndex}`,
    auctionId: numeric(log.topics?.[1]).toString(),
    bidder,
    amount: numeric(data).toString(),
    transactionHash: transactionHash as Hex,
    blockNumber: blockNumber.toString(),
    logIndex,
    timestamp: timestampValue > 0n
      ? new Date(Number(timestampValue) * 1_000).toISOString()
      : null,
  };
}

async function getExplorerHistory(network: ServerAuctionNetwork) {
  if (!network.auctionAddress) return null;
  const bids: SerializableBid[] = [];

  for (let page = 1; page <= MAX_HISTORY_PAGES; page += 1) {
    const query = new URLSearchParams({
      module: "logs",
      action: "getLogs",
      fromBlock: "0",
      toBlock: "latest",
      address: network.auctionAddress,
      topic0: BID_TOPIC,
      page: String(page),
      offset: String(HISTORY_PAGE_SIZE),
    });
    const response = await fetch(`${network.explorerUrl}/api?${query.toString()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Explorer returned HTTP ${response.status}.`);
    const payload = await response.json() as { status?: string; message?: string; result?: unknown };
    if (!Array.isArray(payload.result)) {
      if (payload.message?.toLowerCase().includes("no records")) return bids;
      throw new Error("Explorer returned an invalid log response.");
    }
    const pageBids = payload.result
      .map((entry) => parseExplorerLog(entry as ExplorerLog))
      .filter((entry): entry is SerializableBid => Boolean(entry));
    bids.push(...pageBids);
    if (payload.result.length < HISTORY_PAGE_SIZE) return bids;
  }

  return bids;
}

async function addBlockTimes(
  client: PublicClient,
  bids: SerializableBid[],
) {
  const missing = [...new Set(
    bids.filter((bid) => !bid.timestamp).map((bid) => bid.blockNumber),
  )];
  const timestamps = new Map<string, string>();

  for (let offset = 0; offset < missing.length; offset += 12) {
    const batch = missing.slice(offset, offset + 12);
    const blocks = await Promise.all(batch.map(async (blockNumber) => {
      try {
        const block = await client.getBlock({ blockNumber: BigInt(blockNumber) });
        return [blockNumber, new Date(Number(block.timestamp) * 1_000).toISOString()] as const;
      } catch {
        return [blockNumber, null] as const;
      }
    }));
    for (const [blockNumber, timestamp] of blocks) {
      if (timestamp) timestamps.set(blockNumber, timestamp);
    }
  }

  return bids.map((bid) => ({ ...bid, timestamp: bid.timestamp || timestamps.get(bid.blockNumber) || null }));
}

async function getRpcHistory(
  client: PublicClient,
  network: ServerAuctionNetwork,
  latestBlock: bigint,
  requestedFromBlock: bigint | null,
) {
  if (!network.auctionAddress) return { bids: [], complete: false };
  const configuredStart = network.deploymentBlock ? BigInt(network.deploymentBlock) : null;
  const fallbackStart = latestBlock > 250_000n ? latestBlock - 250_000n : 0n;
  const start = requestedFromBlock !== null
    ? (requestedFromBlock > 12n ? requestedFromBlock - 12n : 0n)
    : (configuredStart ?? fallbackStart);
  const bids: SerializableBid[] = [];

  for (let fromBlock = start; fromBlock <= latestBlock; fromBlock += RPC_LOG_CHUNK) {
    const toBlock = fromBlock + RPC_LOG_CHUNK - 1n > latestBlock
      ? latestBlock
      : fromBlock + RPC_LOG_CHUNK - 1n;
    const logs = await client.getLogs({
      address: network.auctionAddress,
      event: {
        type: "event",
        name: "BidPlaced",
        inputs: [
          { name: "auctionId", type: "uint256", indexed: true },
          { name: "bidder", type: "address", indexed: true },
          { name: "amount", type: "uint256", indexed: false },
        ],
      },
      fromBlock,
      toBlock,
    });
    for (const log of logs) {
      if (!log.transactionHash || log.logIndex === null || !log.args.bidder || log.args.amount === undefined) continue;
      bids.push({
        id: `${log.transactionHash.toLowerCase()}:${log.logIndex}`,
        auctionId: (log.args.auctionId ?? 0n).toString(),
        bidder: log.args.bidder,
        amount: log.args.amount.toString(),
        transactionHash: log.transactionHash,
        blockNumber: log.blockNumber.toString(),
        logIndex: log.logIndex,
        timestamp: null,
      });
    }
  }

  return {
    bids: await addBlockTimes(client, bids),
    complete: requestedFromBlock !== null || configuredStart !== null,
  };
}

export async function getAuctionSnapshot(options: {
  networkKey: AuctionNetworkKey;
  afterBlock: bigint | null;
  account: Address | null;
}) {
  const network = getAuctionNetwork(options.networkKey);
  const publicNetwork = {
    key: network.key,
    chainId: network.chainId,
    name: network.name,
    shortName: network.shortName,
    explorerUrl: network.explorerUrl,
    publicRpcUrl: network.publicRpcUrl,
    auctionAddress: network.auctionAddress,
    usdgAddress: network.usdgAddress,
    deploymentBlock: network.deploymentBlock,
    configured: network.configured,
  };

  if (!network.configured || !network.auctionAddress || !network.usdgAddress) {
    return {
      ready: false as const,
      network: publicNetwork,
      reason: `${network.shortName} needs its own auction and USDG contract addresses.`,
      latestBlock: null,
      bids: [],
      historyComplete: false,
    };
  }

  const client = buildClient(network);
  const [latestBlock, bytecode] = await Promise.all([
    client.getBlockNumber(),
    client.getBytecode({ address: network.auctionAddress }),
  ]);
  if (!bytecode || bytecode === "0x") {
    return {
      ready: false as const,
      network: publicNetwork,
      reason: `No auction contract bytecode was found at the configured ${network.shortName} address.`,
      latestBlock: latestBlock.toString(),
      bids: [],
      historyComplete: false,
    };
  }

  const account = options.account || ZERO_ADDRESS;
  const [
    rawAuction,
    rawReservation,
    minimumNextBid,
    pendingSellerProceeds,
    totalRefundable,
    authorizedMinter,
    isActive,
    isEnded,
    escrowBalance,
    walletBalance,
    allowance,
    refundableBalance,
    nativeBalance,
  ] = await Promise.all([
    client.readContract({ address: network.auctionAddress, abi: AUCTION_ABI, functionName: "getAuction" }),
    client.readContract({ address: network.auctionAddress, abi: AUCTION_ABI, functionName: "getReservation", args: [1n] }),
    client.readContract({ address: network.auctionAddress, abi: AUCTION_ABI, functionName: "getMinimumNextBid" }),
    client.readContract({ address: network.auctionAddress, abi: AUCTION_ABI, functionName: "pendingSellerProceeds" }),
    client.readContract({ address: network.auctionAddress, abi: AUCTION_ABI, functionName: "totalRefundable" }),
    client.readContract({ address: network.auctionAddress, abi: AUCTION_ABI, functionName: "authorizedMinter" }),
    client.readContract({ address: network.auctionAddress, abi: AUCTION_ABI, functionName: "isAuctionActive" }),
    client.readContract({ address: network.auctionAddress, abi: AUCTION_ABI, functionName: "isAuctionEnded" }),
    client.readContract({ address: network.usdgAddress, abi: ERC20_ABI, functionName: "balanceOf", args: [network.auctionAddress] }),
    client.readContract({ address: network.usdgAddress, abi: ERC20_ABI, functionName: "balanceOf", args: [account] }),
    client.readContract({ address: network.usdgAddress, abi: ERC20_ABI, functionName: "allowance", args: [account, network.auctionAddress] }),
    client.readContract({ address: network.auctionAddress, abi: AUCTION_ABI, functionName: "getRefundableBalance", args: [account] }),
    options.account ? client.getBalance({ address: account }) : Promise.resolve(0n),
  ]);

  const auction = rawAuction as RawAuction;
  const reservation = rawReservation as RawReservation;
  let bids: SerializableBid[] | null = null;
  let historyComplete = false;
  if (options.afterBlock === null) {
    try {
      bids = await getExplorerHistory(network);
      historyComplete = bids !== null;
    } catch (error) {
      console.warn("Auction explorer history unavailable; using RPC fallback.", error);
    }
  }
  if (bids === null) {
    const rpcHistory = await getRpcHistory(client, network, latestBlock, options.afterBlock);
    bids = rpcHistory.bids;
    historyComplete = rpcHistory.complete;
  }

  const uniqueBids = [...new Map(bids.map((bid) => [bid.id, bid])).values()]
    .sort((left, right) => Number(BigInt(right.blockNumber) - BigInt(left.blockNumber)) || right.logIndex - left.logIndex);

  return {
    ready: true as const,
    network: publicNetwork,
    latestBlock: latestBlock.toString(),
    historyComplete,
    bids: uniqueBids,
    auction: {
      auctionId: auction.auctionId.toString(),
      seller: auction.seller,
      startTime: auction.startTime.toString(),
      endTime: auction.endTime.toString(),
      minimumBid: auction.minimumBid.toString(),
      minBidIncrementBps: auction.minBidIncrementBps.toString(),
      highestBidder: auction.highestBidder,
      highestBid: auction.highestBid.toString(),
      state: Number(auction.state),
      stateName: STATE_NAMES[Number(auction.state)] || "UNKNOWN",
      totalBidsCount: auction.totalBidsCount.toString(),
      isActive,
      isEnded,
    },
    reservation: {
      reservationId: reservation.reservationId.toString(),
      winner: reservation.winner,
      winningBid: reservation.winningBid.toString(),
      finalized: reservation.finalized,
      fulfilled: reservation.fulfilled,
    },
    accounting: {
      minimumNextBid: minimumNextBid.toString(),
      pendingSellerProceeds: pendingSellerProceeds.toString(),
      totalRefundable: totalRefundable.toString(),
      authorizedMinter,
      escrowBalance: escrowBalance.toString(),
    },
    wallet: {
      account: options.account,
      usdgBalance: walletBalance.toString(),
      allowance: allowance.toString(),
      refundableBalance: refundableBalance.toString(),
      nativeBalance: nativeBalance.toString(),
    },
    refreshedAt: new Date().toISOString(),
  };
}
