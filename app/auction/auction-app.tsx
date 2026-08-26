"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  formatUnits,
  http,
  parseUnits,
  type Address,
  type EIP1193Provider,
  type Hash,
} from "viem";
import { AUCTION_ABI, ERC20_ABI, USDG_DECIMALS } from "@/lib/auction/abi";
import type { AuctionNetworkKey, PublicAuctionNetwork } from "@/lib/auction/config";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

type Bid = {
  id: string;
  auctionId: string;
  bidder: Address;
  amount: string;
  transactionHash: Hash;
  blockNumber: string;
  logIndex: number;
  timestamp: string | null;
};

type ReadySnapshot = {
  ready: true;
  network: PublicAuctionNetwork;
  latestBlock: string;
  historyComplete: boolean;
  bids: Bid[];
  auction: {
    auctionId: string;
    seller: Address;
    startTime: string;
    endTime: string;
    minimumBid: string;
    minBidIncrementBps: string;
    highestBidder: Address;
    highestBid: string;
    state: number;
    stateName: string;
    totalBidsCount: string;
    isActive: boolean;
    isEnded: boolean;
  };
  reservation: {
    reservationId: string;
    winner: Address;
    winningBid: string;
    finalized: boolean;
    fulfilled: boolean;
  };
  accounting: {
    minimumNextBid: string;
    pendingSellerProceeds: string;
    totalRefundable: string;
    authorizedMinter: Address;
    escrowBalance: string;
  };
  wallet: {
    account: Address | null;
    usdgBalance: string;
    allowance: string;
    refundableBalance: string;
    nativeBalance: string;
  };
  refreshedAt: string;
};

type UnreadySnapshot = {
  ready: false;
  network: PublicAuctionNetwork;
  reason: string;
  latestBlock: string | null;
  bids: Bid[];
  historyComplete: false;
};

type Snapshot = ReadySnapshot | UnreadySnapshot;
type TransactionAction = "bid" | "refund" | "finalize" | "proceeds" | null;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function shortAddress(value?: string | null) {
  if (!value || value.toLowerCase() === ZERO_ADDRESS) return "None yet";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function formatUsdg(value: string | bigint | undefined, digits = 2) {
  const amount = typeof value === "bigint" ? value : BigInt(value || "0");
  const numeric = Number(formatUnits(amount, USDG_DECIMALS));
  return numeric.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatEth(value: string | undefined) {
  return Number(formatUnits(BigInt(value || "0"), 18)).toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  });
}

function errorMessage(error: unknown) {
  if (!(error instanceof Error)) return "The transaction could not be completed.";
  const message = error.message;
  if (/rejected|denied|cancelled/i.test(message)) return "Transaction cancelled in your wallet.";
  if (/BidTooLow/i.test(message)) return "That bid is below the on-chain minimum.";
  if (/AuctionEnded/i.test(message)) return "The auction has already ended.";
  if (/AuctionNotActive/i.test(message)) return "The auction is not active yet.";
  return message.length > 180 ? "The transaction could not be completed." : message;
}

function explorerLink(network: PublicAuctionNetwork, type: "address" | "tx", value: string) {
  return `${network.explorerUrl}/${type}/${value}`;
}

function networkChain(network: PublicAuctionNetwork) {
  return defineChain({
    id: network.chainId,
    name: network.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [network.publicRpcUrl] } },
    blockExplorers: { default: { name: "Robinhood Explorer", url: network.explorerUrl } },
    testnet: network.key === "testnet",
  });
}

function useCountdown(endTime: string | undefined) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1_000));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1_000)), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Number(endTime || 0) - now);
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  return {
    expired: Boolean(endTime && seconds === 0),
    label: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`,
  };
}

export function AuctionApp({ networks }: { networks: PublicAuctionNetwork[] }) {
  const router = useRouter();
  const [networkKey, setNetworkKey] = useState<AuctionNetworkKey>("mainnet");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [historyComplete, setHistoryComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [feedError, setFeedError] = useState("");
  const [walletAddress, setWalletAddress] = useState<Address | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [bidAmount, setBidAmount] = useState("");
  const [action, setAction] = useState<TransactionAction>(null);
  const [notice, setNotice] = useState("");
  const cursorRef = useRef<string | null>(null);
  const bidMapRef = useRef(new Map<string, Bid>());
  const network = networks.find((item) => item.key === networkKey) || networks[0];

  const loadSnapshot = useCallback(async (reset = false) => {
    const query = new URLSearchParams({ network: networkKey });
    if (walletAddress) query.set("account", walletAddress);
    if (!reset && cursorRef.current) query.set("afterBlock", cursorRef.current);
    try {
      const response = await fetch(`/api/admin/auction/snapshot?${query.toString()}`, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      const data = await response.json() as Snapshot & { error?: string };
      if (response.status === 401) {
        router.push("/admin/spin");
        return;
      }
      if (!response.ok) throw new Error(data.error || "Auction feed unavailable.");
      setSnapshot(data);
      if (reset) {
        bidMapRef.current = new Map();
        setHistoryComplete(data.historyComplete);
      }
      for (const bid of data.bids) bidMapRef.current.set(bid.id, bid);
      const merged = [...bidMapRef.current.values()].sort((left, right) => {
        const blockOrder = BigInt(right.blockNumber) - BigInt(left.blockNumber);
        return blockOrder > 0n ? 1 : blockOrder < 0n ? -1 : right.logIndex - left.logIndex;
      });
      setBids(merged);
      cursorRef.current = data.latestBlock;
      setFeedError("");
    } catch (error) {
      setFeedError(error instanceof Error ? error.message : "Auction feed unavailable.");
    } finally {
      setLoading(false);
    }
  }, [networkKey, router, walletAddress]);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadSnapshot(true), 0);
    const refresh = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadSnapshot(false);
    }, 4_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(refresh);
    };
  }, [loadSnapshot]);

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider) return;
    void Promise.all([
      provider.request({ method: "eth_accounts" }),
      provider.request({ method: "eth_chainId" }),
    ]).then(([accounts, chainId]) => {
      const values = accounts as Address[];
      setWalletAddress(values[0] || null);
      setWalletChainId(Number(BigInt(chainId as string)));
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 7_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function selectNetwork(key: AuctionNetworkKey) {
    if (key === networkKey) return;
    cursorRef.current = null;
    bidMapRef.current = new Map();
    setBids([]);
    setSnapshot(null);
    setLoading(true);
    setBidAmount("");
    setNetworkKey(key);
  }

  async function ensureWalletNetwork() {
    const provider = window.ethereum;
    if (!provider) throw new Error("Install an EVM wallet such as MetaMask or Rabby first.");
    const chainHex = `0x${network.chainId.toString(16)}`;
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error
        ? Number((error as { code: unknown }).code)
        : 0;
      if (code !== 4902) throw error;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: chainHex,
          chainName: network.name,
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [network.publicRpcUrl],
          blockExplorerUrls: [network.explorerUrl],
        }],
      });
    }
    setWalletChainId(network.chainId);
    return provider;
  }

  async function connectWallet() {
    setNotice("");
    try {
      const provider = await ensureWalletNetwork();
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as Address[];
      if (!accounts[0]) throw new Error("No wallet account was selected.");
      setWalletAddress(accounts[0]);
      setNotice(`Wallet connected on ${network.shortName}.`);
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }

  async function getTransactionClients() {
    if (!network.auctionAddress || !network.usdgAddress) throw new Error("This network is not configured.");
    const provider = await ensureWalletNetwork();
    let account = walletAddress;
    if (!account) {
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as Address[];
      account = accounts[0] || null;
      setWalletAddress(account);
    }
    if (!account) throw new Error("Connect your wallet first.");
    const chain = networkChain(network);
    return {
      account,
      publicClient: createPublicClient({ chain, transport: http(network.publicRpcUrl, { timeout: 20_000 }) }),
      walletClient: createWalletClient({ account, chain, transport: custom(provider) }),
    };
  }

  async function waitFor(hash: Hash, publicClient: ReturnType<typeof createPublicClient>) {
    setNotice(`Transaction submitted · ${hash.slice(0, 10)}…`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
    if (receipt.status !== "success") throw new Error("The transaction reverted on-chain.");
  }

  async function submitBid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot?.ready || !network.auctionAddress || !network.usdgAddress) return;
    setAction("bid");
    setNotice("");
    try {
      const enteredAmount = bidAmount.trim() || formatUnits(BigInt(snapshot.accounting.minimumNextBid), USDG_DECIMALS);
      const amount = parseUnits(enteredAmount, USDG_DECIMALS);
      const minimum = BigInt(snapshot.accounting.minimumNextBid);
      if (amount < minimum) throw new Error(`Minimum next bid is ${formatUsdg(minimum)} USDG.`);
      const { account, publicClient, walletClient } = await getTransactionClients();
      const selfLeading = snapshot.auction.highestBidder.toLowerCase() === account.toLowerCase();
      const current = BigInt(snapshot.auction.highestBid);
      const transferRequired = selfLeading ? amount - current : amount;
      if (BigInt(snapshot.wallet.usdgBalance) < transferRequired) {
        throw new Error(`Insufficient USDG. This bid requires ${formatUsdg(transferRequired)} USDG from your wallet.`);
      }
      if (BigInt(snapshot.wallet.allowance) < transferRequired) {
        setNotice("Approve the USDG transfer in your wallet.");
        const approvalHash = await walletClient.writeContract({
          account,
          address: network.usdgAddress,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [network.auctionAddress, transferRequired],
        });
        await waitFor(approvalHash, publicClient);
      }
      setNotice("Confirm the bid in your wallet.");
      const bidHash = await walletClient.writeContract({
        account,
        address: network.auctionAddress,
        abi: AUCTION_ABI,
        functionName: "placeBid",
        args: [amount],
      });
      await waitFor(bidHash, publicClient);
      setNotice("Bid confirmed on-chain. The live ledger is updating.");
      await loadSnapshot(true);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setAction(null);
    }
  }

  async function runAuctionAction(nextAction: Exclude<TransactionAction, "bid" | null>) {
    if (!snapshot?.ready || !network.auctionAddress) return;
    setAction(nextAction);
    setNotice("");
    try {
      const { account, publicClient, walletClient } = await getTransactionClients();
      const hash = nextAction === "refund"
        ? await walletClient.writeContract({ account, address: network.auctionAddress, abi: AUCTION_ABI, functionName: "claimRefund" })
        : nextAction === "finalize"
          ? await walletClient.writeContract({ account, address: network.auctionAddress, abi: AUCTION_ABI, functionName: "finalizeAuction" })
          : await walletClient.writeContract({ account, address: network.auctionAddress, abi: AUCTION_ABI, functionName: "claimSellerProceeds" });
      await waitFor(hash, publicClient);
      setNotice("Transaction confirmed on Robinhood Chain.");
      await loadSnapshot(true);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setAction(null);
    }
  }

  const countdown = useCountdown(snapshot?.ready ? snapshot.auction.endTime : undefined);
  const highestBid = snapshot?.ready ? BigInt(snapshot.auction.highestBid) : 0n;
  const suggestedBid = snapshot?.ready
    ? formatUnits(BigInt(snapshot.accounting.minimumNextBid), USDG_DECIMALS)
    : "";
  const sortedBids = useMemo(() => bids, [bids]);
  const walletOnSelectedNetwork = walletChainId === network.chainId;
  const isSeller = Boolean(snapshot?.ready && walletAddress
    && snapshot.auction.seller.toLowerCase() === walletAddress.toLowerCase());

  return (
    <main className="auction-page">
      <nav className="auction-nav">
        <Link className="auction-brand" href="/">
          <Image src="/assets/bunny-hood-mark.webp" alt="" width={42} height={42} priority />
          <span><strong>BUNNY HOOD</strong><small>AUCTION CONTROL</small></span>
        </Link>
        <div className="auction-nav-actions">
          <span className="auction-private"><i /> ADMIN ONLY</span>
          <Link href="/admin/spin">Control room</Link>
          <button type="button" onClick={connectWallet}>
            {walletAddress ? shortAddress(walletAddress) : "Connect wallet"}
          </button>
        </div>
      </nav>

      <section className="auction-hero">
        <div className="auction-hero-copy">
          <div className="auction-eyebrow"><span /> ROBINHOOD CHAIN · RESERVED 1/1</div>
          <h1>THE HOOD&apos;S<br /><em>ON-CHAIN 1/1.</em></h1>
          <p>Private auction operations with live contract state, complete bid activity, escrow accounting, and settlement controls.</p>
          <div className="auction-network-switch" aria-label="Auction network">
            {networks.map((item) => (
              <button
                type="button"
                key={item.key}
                className={networkKey === item.key ? "active" : ""}
                onClick={() => selectNetwork(item.key)}
              >
                <i className={item.configured ? "configured" : ""} />
                {item.shortName}
              </button>
            ))}
          </div>
        </div>
        <div className="auction-art">
          <Image src="/assets/bunny-hood-hero.webp" alt="Bunny Hood reserved auction artwork" fill sizes="(max-width: 800px) 92vw, 44vw" priority />
          <span>GENESIS RESERVATION · 01/01</span>
        </div>
      </section>

      <section className="auction-console">
        <div className="auction-console-head">
          <div><span className="auction-kicker">LIVE CONTRACT FEED</span><h2>{network.name}</h2></div>
          <div className="auction-feed-status"><i className={feedError ? "error" : ""} />{feedError ? "FEED INTERRUPTED" : "LIVE · 4S"}</div>
        </div>

        {notice && <div className="auction-notice" role="status">{notice}</div>}
        {feedError && <div className="auction-error">{feedError}</div>}

        {loading && !snapshot ? (
          <div className="auction-loading">Reading {network.shortName} contract state…</div>
        ) : !snapshot?.ready ? (
          <div className="auction-config-card">
            <span>NETWORK NOT READY</span>
            <h2>{network.shortName} auction is safely disabled.</h2>
            <p>{snapshot?.reason || "The auction configuration is incomplete."}</p>
            <code>{network.key === "testnet" ? "AUCTION_TESTNET_ADDRESS + USDG_TESTNET_ADDRESS" : "AUCTION_MAINNET_ADDRESS + USDG_MAINNET_ADDRESS"}</code>
          </div>
        ) : (
          <>
            <div className="auction-metrics">
              <article><span>HIGHEST BID</span><strong>{formatUsdg(highestBid)}</strong><small>USDG</small></article>
              <article><span>TOP BIDDER</span><strong className="address-value">{shortAddress(snapshot.auction.highestBidder)}</strong><small>ON-CHAIN LEADER</small></article>
              <article><span>{snapshot.auction.isEnded ? "STATUS" : "ENDING IN"}</span><strong>{snapshot.auction.isEnded || countdown.expired ? snapshot.auction.stateName : countdown.label}</strong><small>{snapshot.auction.totalBidsCount} CONTRACT BIDS</small></article>
              <article><span>ESCROW BALANCE</span><strong>{formatUsdg(snapshot.accounting.escrowBalance)}</strong><small>USDG VERIFIED</small></article>
            </div>

            <div className="auction-workspace">
              <section className="auction-panel auction-bid-panel">
                <div className="auction-panel-title"><div><span>EXECUTION</span><h3>Place a USDG bid.</h3></div><b>{snapshot.auction.stateName}</b></div>
                <div className="auction-wallet-grid">
                  <div><span>CONNECTED WALLET</span><strong>{shortAddress(walletAddress)}</strong></div>
                  <div><span>NETWORK</span><strong className={walletAddress && !walletOnSelectedNetwork ? "warning" : ""}>{walletAddress ? (walletOnSelectedNetwork ? network.shortName : `Switch to ${network.shortName}`) : "Not connected"}</strong></div>
                  <div><span>USDG BALANCE</span><strong>{formatUsdg(snapshot.wallet.usdgBalance)}</strong></div>
                  <div><span>ETH FOR GAS</span><strong>{formatEth(snapshot.wallet.nativeBalance)}</strong></div>
                </div>
                <form onSubmit={submitBid} className="auction-bid-form">
                  <label htmlFor="auction-bid">TOTAL BID AMOUNT</label>
                  <div><input id="auction-bid" inputMode="decimal" value={bidAmount || suggestedBid} onChange={(event) => setBidAmount(event.target.value)} placeholder="0.00" /><span>USDG</span></div>
                  <p>Minimum next bid: <strong>{formatUsdg(snapshot.accounting.minimumNextBid)} USDG</strong>. If approval is needed, your wallet will request approval first and the bid second.</p>
                  <button type="submit" disabled={action !== null || !snapshot.auction.isActive}>
                    {action === "bid" ? "Confirming on-chain…" : snapshot.auction.isActive ? "Review & place bid" : "Auction is not active"}
                  </button>
                </form>

                <div className="auction-action-stack">
                  {BigInt(snapshot.wallet.refundableBalance) > 0n && (
                    <div><span><strong>{formatUsdg(snapshot.wallet.refundableBalance)} USDG refund ready</strong><small>Pull your outbid escrow back to this wallet.</small></span><button type="button" disabled={action !== null} onClick={() => runAuctionAction("refund")}>{action === "refund" ? "Claiming…" : "Claim refund"}</button></div>
                  )}
                  {snapshot.auction.isEnded && snapshot.auction.state === 2 && (
                    <div><span><strong>Settlement is ready</strong><small>Anyone can finalize the auction after it ends.</small></span><button type="button" disabled={action !== null} onClick={() => runAuctionAction("finalize")}>{action === "finalize" ? "Finalizing…" : "Finalize"}</button></div>
                  )}
                  {isSeller && BigInt(snapshot.accounting.pendingSellerProceeds) > 0n && (
                    <div><span><strong>{formatUsdg(snapshot.accounting.pendingSellerProceeds)} USDG proceeds</strong><small>Only the configured seller can withdraw.</small></span><button type="button" disabled={action !== null} onClick={() => runAuctionAction("proceeds")}>{action === "proceeds" ? "Withdrawing…" : "Withdraw"}</button></div>
                  )}
                </div>
              </section>

              <section className="auction-panel auction-ledger">
                <div className="auction-panel-title"><div><span>REAL-TIME LEDGER</span><h3>All bids.</h3></div><b>{sortedBids.length} LOADED</b></div>
                {!historyComplete && <div className="auction-history-warning">Set the deployment block environment variable to guarantee complete RPC history if the explorer fallback is unavailable.</div>}
                <div className="auction-bid-list">
                  {sortedBids.length === 0 ? (
                    <div className="auction-empty"><strong>No BidPlaced events yet.</strong><span>The first confirmed bid will appear here automatically.</span></div>
                  ) : sortedBids.map((bid, index) => {
                    const leading = bid.bidder.toLowerCase() === snapshot.auction.highestBidder.toLowerCase()
                      && bid.amount === snapshot.auction.highestBid;
                    return (
                      <article key={bid.id} className={leading ? "leading" : ""}>
                        <div className="auction-bid-rank">{leading ? "01" : String(index + 1).padStart(2, "0")}</div>
                        <div className="auction-bid-person"><strong>{shortAddress(bid.bidder)} {leading && <i>LEADING</i>}</strong><span>{bid.timestamp ? new Date(bid.timestamp).toLocaleString() : `Block ${bid.blockNumber}`}</span></div>
                        <div className="auction-bid-value"><strong>{formatUsdg(bid.amount)} <small>USDG</small></strong><a href={explorerLink(network, "tx", bid.transactionHash)} target="_blank" rel="noreferrer">View transaction</a></div>
                      </article>
                    );
                  })}
                </div>
              </section>
            </div>

            <div className="auction-detail-grid">
              <section className="auction-detail-card"><span>RESERVATION</span><h3>{snapshot.reservation.finalized ? "Winner recorded" : "Awaiting settlement"}</h3><dl><div><dt>Winner</dt><dd>{shortAddress(snapshot.reservation.winner)}</dd></div><div><dt>Winning bid</dt><dd>{formatUsdg(snapshot.reservation.winningBid)} USDG</dd></div><div><dt>NFT fulfilled</dt><dd>{snapshot.reservation.fulfilled ? "YES" : "NO"}</dd></div></dl></section>
              <section className="auction-detail-card"><span>ACCOUNTING</span><h3>Escrow visibility</h3><dl><div><dt>Refund liabilities</dt><dd>{formatUsdg(snapshot.accounting.totalRefundable)} USDG</dd></div><div><dt>Seller proceeds</dt><dd>{formatUsdg(snapshot.accounting.pendingSellerProceeds)} USDG</dd></div><div><dt>Min increment</dt><dd>{Number(snapshot.auction.minBidIncrementBps) / 100}%</dd></div></dl></section>
              <section className="auction-detail-card"><span>CONTRACTS</span><h3>{network.shortName} deployment</h3><dl><div><dt>Auction</dt><dd><a href={explorerLink(network, "address", network.auctionAddress || "")} target="_blank" rel="noreferrer">{shortAddress(network.auctionAddress)}</a></dd></div><div><dt>USDG</dt><dd><a href={explorerLink(network, "address", network.usdgAddress || "")} target="_blank" rel="noreferrer">{shortAddress(network.usdgAddress)}</a></dd></div><div><dt>Latest block</dt><dd>{Number(snapshot.latestBlock).toLocaleString()}</dd></div></dl></section>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
