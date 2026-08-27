"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type ClaimStatus = "PENDING" | "SUBMITTED" | "CONFIRMED" | "FAILED";

type Claim = {
  id?: string;
  status: ClaimStatus;
  wallet: string | null;
  claimKey: string | null;
  chainId: number | null;
  contractAddress: string | null;
  transactionHash: string | null;
  tokenId: string | null;
  submittedAt: string | null;
  confirmedAt: string | null;
  updatedAt?: string;
};

type AllowlistUser = {
  id: string;
  xUserId: string | null;
  xUsername: string;
  xName: string | null;
  xProfileImageUrl: string | null;
  eligible: boolean;
  claim: Claim | null;
  createdAt: string;
  updatedAt: string;
};

type RabbitHoleState = {
  network: {
    key: "mainnet" | "testnet";
    chainId: number;
    name: string;
    explorerUrl: string;
    contractAddress: string | null;
    deploymentBlock: string | null;
    configured: boolean;
  };
  totals: { eligible: number; claimed: number; pending: number; capacity: number };
  allowlist: AllowlistUser[];
  authenticated: boolean;
  user: null | {
    id: string;
    xUserId: string;
    xUsername: string;
    xName: string;
    xProfileImageUrl: string | null;
  };
  eligibility: AllowlistUser | null;
  claim: Claim | null;
  generatedAt: string;
};

type ApiError = { error?: string; code?: string };

class RabbitHoleRequestError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number) {
    super(message);
  }
}

function readCsrfCookie() {
  const item = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("bh_spin_csrf="));
  return item ? decodeURIComponent(item.slice("bh_spin_csrf=".length)) : "";
}

async function requestJson<T>(url: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  if (init?.method && init.method !== "GET") {
    headers.set("content-type", "application/json");
    headers.set("x-csrf-token", readCsrfCookie());
  }
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  const data = await response.json().catch(() => ({})) as T & ApiError;
  if (!response.ok) {
    throw new RabbitHoleRequestError(
      data.error || "The request could not be completed.",
      data.code,
      response.status,
    );
  }
  return data;
}

function shortWallet(value: string | null | undefined) {
  if (!value) return "—";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function statusLabel(record: AllowlistUser | null) {
  if (!record) return "NOT FOUND";
  if (!record.eligible) return "NOT ELIGIBLE";
  if (record.claim?.status === "CONFIRMED") return "BOX CLAIMED";
  if (record.claim?.status === "SUBMITTED" || record.claim?.status === "PENDING") return "MINTING";
  return "ELIGIBLE";
}

function usernamesFromText(value: string) {
  return [...new Set(value
    .split(/[\s,;]+/)
    .map((entry) => entry.trim().replace(/^@/, ""))
    .filter((entry) => entry && !["username", "x_username", "handle"].includes(entry.toLowerCase())))];
}

function BoxVisual({ state }: { state: RabbitHoleState | null }) {
  const claim = state?.claim;
  const confirmed = claim?.status === "CONFIRMED" && claim.claimKey;
  const profile = state?.user?.xProfileImageUrl;
  return (
    <div className={`rabbit-box-visual ${claim?.status?.toLowerCase() || "empty"}`}>
      <div className="rabbit-box-aura" />
      {/* NFT render is used after confirmation; the closed reference stays empty before mint. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="rabbit-box-image"
        src={confirmed ? `/api/rabbithole/image/${claim.claimKey}` : "/assets/rabbit-hole-box.png"}
        alt={confirmed ? `Personalized Rabbit Hole box for @${state?.user?.xUsername}` : "Closed Bunny Hood Rabbit Hole box"}
      />
      {claim && claim.status !== "CONFIRMED" && profile && (
        <div className="rabbit-box-printing" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={profile} alt="" />
          <span />
        </div>
      )}
      <div className="rabbit-box-orbit"><span>BH</span><span>?</span><span>SBT</span></div>
    </div>
  );
}

export function RabbitHoleApp() {
  const router = useRouter();
  const [intro, setIntro] = useState<"waiting" | "entering" | "complete">("waiting");
  const [state, setState] = useState<RabbitHoleState | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [searchResult, setSearchResult] = useState<AllowlistUser | null | undefined>(undefined);
  const [searchBusy, setSearchBusy] = useState(false);
  const [wallet, setWallet] = useState("");
  const [claimBusy, setClaimBusy] = useState(false);
  const [allowlistText, setAllowlistText] = useState("");
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [importBusy, setImportBusy] = useState(false);
  const [listSearch, setListSearch] = useState("");

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const next = await requestJson<RabbitHoleState>("/api/rabbithole/state");
      setState(next);
      setError("");
    } catch (requestError) {
      if (requestError instanceof RabbitHoleRequestError && requestError.status === 401) {
        router.replace("/admin/spin");
        return;
      }
      setError(requestError instanceof Error ? requestError.message : "Rabbit Hole could not be loaded.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(true), 5_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [refresh]);

  function enterRabbitHole() {
    setIntro("entering");
    window.setTimeout(() => setIntro("complete"), 1_450);
  }

  async function checkEligibility(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await requestJson<{ found: boolean; record: AllowlistUser | null }>(
        `/api/rabbithole/eligibility?username=${encodeURIComponent(search)}`,
      );
      setSearchResult(result.record);
    } catch (requestError) {
      setSearchResult(undefined);
      setError(requestError instanceof Error ? requestError.message : "Eligibility could not be checked.");
    } finally {
      setSearchBusy(false);
    }
  }

  async function claimBox(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setClaimBusy(true);
    setMessage("Preparing your unique box and sending the mint onchain…");
    setError("");
    try {
      const response = await requestJson<{ claim: Claim }>("/api/rabbithole/claim", {
        method: "POST",
        body: JSON.stringify({ wallet: state?.claim?.wallet || wallet }),
      });
      setState((current) => current ? { ...current, claim: response.claim } : current);
      setMessage(response.claim.status === "CONFIRMED"
        ? "Your soulbound Rabbit Hole box is confirmed onchain."
        : "Transaction submitted. Confirmation is being tracked live.");
      await refresh(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The claim could not be completed.");
      setMessage("");
    } finally {
      setClaimBusy(false);
    }
  }

  async function importAllowlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const usernames = usernamesFromText(allowlistText);
    setImportBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await requestJson<{ eligible: number }>("/api/rabbithole/allowlist", {
        method: "POST",
        body: JSON.stringify({ usernames, mode: importMode }),
      });
      setAllowlistText("");
      setMessage(`${result.eligible} eligible X accounts are now loaded into Rabbit Hole.`);
      await refresh(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The allowlist could not be updated.");
    } finally {
      setImportBusy(false);
    }
  }

  async function disconnectX() {
    try {
      await requestJson<{ ok: boolean }>("/api/spin/auth/logout", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setWallet("");
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "X could not be disconnected.");
    }
  }

  const filteredAllowlist = useMemo(() => {
    const query = listSearch.trim().replace(/^@/, "").toLowerCase();
    if (!query) return state?.allowlist || [];
    return (state?.allowlist || []).filter((entry) =>
      entry.xUsername.toLowerCase().includes(query)
      || (entry.xName || "").toLowerCase().includes(query)
      || (entry.claim?.wallet || "").toLowerCase().includes(query));
  }, [listSearch, state?.allowlist]);

  const connectedEligible = Boolean(state?.authenticated && state.eligibility?.eligible);
  const claimConfirmed = state?.claim?.status === "CONFIRMED";
  const claimRetryDelay = state?.claim?.transactionHash ? 10 * 60_000 : 2 * 60_000;
  const claimRetryReady = Boolean(
    state?.claim
    && (state.claim.status === "PENDING" || state.claim.status === "SUBMITTED")
    && state.claim.updatedAt
    && new Date(state.generatedAt).getTime() - new Date(state.claim.updatedAt).getTime() >= claimRetryDelay,
  );
  const explorerTransaction = state?.claim?.transactionHash
    ? `${state.network.explorerUrl}/tx/${state.claim.transactionHash}`
    : null;
  const explorerToken = claimConfirmed && state?.network.contractAddress && state.claim?.tokenId
    ? `${state.network.explorerUrl}/token/${state.network.contractAddress}/instance/${state.claim.tokenId}`
    : null;

  return (
    <main className="rabbit-hole-page">
      {intro !== "complete" && (
        <section className={`rabbit-intro ${intro}`} aria-label="Enter the Rabbit Hole">
          <div className="rabbit-vortex" aria-hidden="true">
            <i /><i /><i /><i /><i />
            <div className="rabbit-vortex-core"><span>BH</span></div>
          </div>
          <div className="rabbit-intro-copy">
            <p>PRIVATE EXPERIMENT · 001</p>
            <h1>ENTER THE<br /><em>RABBIT HOLE</em></h1>
            <span>100 identities. 100 unique boxes. Permanently onchain.</span>
            <button type="button" onClick={enterRabbitHole} disabled={intro === "entering"}>
              {intro === "entering" ? "OPENING THE HOLE…" : "ENTER THE RABBIT HOLE"}
            </button>
          </div>
        </section>
      )}

      <div className="rabbit-noise" />
      <header className="rabbit-topbar">
        <Link className="rabbit-brand" href="/"><span>BH</span><strong>BUNNY HOOD</strong></Link>
        <div className="rabbit-top-actions">
          <span className="rabbit-admin-lock">ADMIN PREVIEW</span>
          <a href="/admin/spin">DATA ADMIN</a>
          <a href="/SpinTheWheel">SPIN</a>
        </div>
      </header>

      <section className="rabbit-hero">
        <div className="rabbit-hero-copy">
          <p className="rabbit-kicker"><i /> IDENTITY DROP · SOULBOUND</p>
          <h1>YOUR PROFILE.<br />YOUR BOX.<br /><em>YOUR PROOF.</em></h1>
          <p>Search the 100-account list, verify the eligible X identity, enter one wallet, and receive a unique Bunny Hood box minted in real time.</p>
          <div className="rabbit-hero-tags"><span>ERC-721</span><span>ERC-5192</span><span>NON-TRANSFERABLE</span><span>ROBINHOOD CHAIN</span></div>
        </div>
        <BoxVisual state={state} />
      </section>

      {loading && !state ? <div className="rabbit-loading">DESCENDING INTO THE HOLE…</div> : (
        <>
          <section className="rabbit-stats" aria-label="Rabbit Hole status">
            <div><span>ELIGIBLE IDENTITIES</span><strong>{state?.totals.eligible ?? 0}<small>/100</small></strong></div>
            <div><span>ONCHAIN CLAIMED</span><strong>{state?.totals.claimed ?? 0}</strong></div>
            <div><span>MINTING NOW</span><strong>{state?.totals.pending ?? 0}</strong></div>
            <div><span>ACTIVE NETWORK</span><strong className="network-name">{state?.network.key.toUpperCase() || "—"}</strong></div>
          </section>

          {(message || error) && <div className={`rabbit-notice ${error ? "error" : "success"}`}>{error || message}</div>}

          <section className="rabbit-flow">
            <div className="rabbit-flow-heading">
              <p className="rabbit-kicker"><i /> CLAIM SEQUENCE</p>
              <h2>Find the name.<br /><em>Reveal the box.</em></h2>
            </div>

            <article className="rabbit-step">
              <span className="rabbit-step-number">01</span>
              <div><p className="rabbit-step-label">SEARCH</p><h3>Check eligibility</h3><p>Enter an X username to see whether it is inside the 100-user Rabbit Hole list and whether its box is already claimed.</p></div>
              <form onSubmit={checkEligibility} className="rabbit-search-form">
                <label htmlFor="rabbit-search">X username</label>
                <div><span>@</span><input id="rabbit-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="username" maxLength={16} required /><button disabled={searchBusy}>{searchBusy ? "CHECKING…" : "CHECK"}</button></div>
              </form>
              {searchResult !== undefined && (
                <div className={`rabbit-result ${searchResult?.eligible ? "eligible" : "not-eligible"}`}>
                  <strong>{statusLabel(searchResult)}</strong>
                  <span>{searchResult ? `@${searchResult.xUsername}` : "This username is not in the Rabbit Hole."}</span>
                  {searchResult?.claim && <small>{searchResult.claim.status === "CONFIRMED" ? `Token #${searchResult.claim.tokenId}` : "Onchain confirmation in progress"}</small>}
                </div>
              )}
            </article>

            <article className={`rabbit-step ${state?.authenticated ? "complete" : ""}`}>
              <span className="rabbit-step-number">02</span>
              <div><p className="rabbit-step-label">VERIFY</p><h3>Connect the eligible X</h3><p>The X login proves the claimant controls the exact account. On first verification the handle is permanently pinned to its X user ID.</p></div>
              {!state?.authenticated ? (
                <a className="rabbit-action" href="/api/spin/auth/x/start?next=%2FRabbitHole">CONNECT X</a>
              ) : (
                <div className="rabbit-connected">
                  {state.user?.xProfileImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={state.user.xProfileImageUrl} alt="" />
                  ) : <span>{state.user?.xName.slice(0, 1)}</span>}
                  <div><strong>@{state.user?.xUsername}</strong><small>{connectedEligible ? "ELIGIBLE IDENTITY VERIFIED" : "NOT ON THE ELIGIBLE LIST"}</small></div>
                  <button type="button" onClick={disconnectX}>CHANGE X</button>
                </div>
              )}
            </article>

            <article className={`rabbit-step ${claimConfirmed ? "claimed" : ""}`}>
              <span className="rabbit-step-number">03</span>
              <div><p className="rabbit-step-label">MINT</p><h3>Lock the destination wallet</h3><p>The first valid wallet becomes permanent for this claim. Bunny Hood pays the mint transaction and tracks confirmation live.</p></div>
              {claimConfirmed ? (
                <div className="rabbit-claimed-card">
                  <strong>SBT #{state?.claim?.tokenId} CLAIMED</strong>
                  <span>{shortWallet(state?.claim?.wallet)}</span>
                  <div>{explorerTransaction && <a href={explorerTransaction} target="_blank" rel="noreferrer">VIEW TRANSACTION ↗</a>}{explorerToken && <a href={explorerToken} target="_blank" rel="noreferrer">VIEW TOKEN ↗</a>}</div>
                </div>
              ) : (
                <form onSubmit={claimBox} className="rabbit-wallet-form">
                  <label htmlFor="rabbit-wallet">EVM wallet</label>
                  <input id="rabbit-wallet" value={state?.claim?.wallet || wallet} onChange={(event) => setWallet(event.target.value)} placeholder="0x…" pattern="0x[0-9a-fA-F]{40}" required disabled={Boolean(state?.claim?.wallet)} />
                  <button disabled={!connectedEligible || !state?.network.configured || claimBusy || Boolean(state?.claim && state.claim.status !== "FAILED" && !claimRetryReady)}>
                    {claimBusy ? "MINTING ONCHAIN…" : claimRetryReady ? "RECHECK & RETRY SAFELY" : state?.claim?.status === "SUBMITTED" || state?.claim?.status === "PENDING" ? "TRANSACTION PENDING" : "CLAIM SOULBOUND BOX"}
                  </button>
                  {!state?.network.configured && <small>Deploy and configure the SBT contract to enable real mints.</small>}
                  {state?.claim?.transactionHash && explorerTransaction && <a className="rabbit-pending-link" href={explorerTransaction} target="_blank" rel="noreferrer">TRACK TRANSACTION ↗</a>}
                </form>
              )}
            </article>
          </section>

          <section className="rabbit-admin-section">
            <div className="rabbit-admin-heading">
              <div><p className="rabbit-kicker"><i /> PRIVATE ALLOWLIST</p><h2>Load the first<br /><em>100 identities.</em></h2></div>
              <div className="rabbit-network-card"><span>ONCHAIN STATUS</span><strong>{state?.network.configured ? "ENV READY" : "SETUP REQUIRED"}</strong><small>{state?.network.name}<br />{state?.network.contractAddress ? shortWallet(state.network.contractAddress) : "No contract address"}</small></div>
            </div>

            <div className="rabbit-admin-grid">
              <form className="rabbit-import" onSubmit={importAllowlist}>
                <label htmlFor="rabbit-allowlist">Paste usernames or CSV</label>
                <textarea id="rabbit-allowlist" value={allowlistText} onChange={(event) => setAllowlistText(event.target.value)} placeholder={"@user_one\n@user_two\n@user_three"} required />
                <div className="rabbit-import-options">
                  <label><input type="radio" name="rabbit-import-mode" checked={importMode === "merge"} onChange={() => setImportMode("merge")} /> Merge with current list</label>
                  <label><input type="radio" name="rabbit-import-mode" checked={importMode === "replace"} onChange={() => setImportMode("replace")} /> Replace unclaimed eligibility</label>
                </div>
                <button disabled={importBusy}>{importBusy ? "SECURING LIST…" : "IMPORT ELIGIBLE USERS"}</button>
                <small>Maximum 100 active identities. Confirmed claims are never deleted by a replacement import.</small>
              </form>

              <div className="rabbit-ledger">
                <div className="rabbit-ledger-head"><div><span>IDENTITY LEDGER</span><strong>{state?.totals.eligible ?? 0} / 100 ACTIVE</strong></div><input value={listSearch} onChange={(event) => setListSearch(event.target.value)} placeholder="Search user or wallet" /></div>
                <div className="rabbit-ledger-list">
                  {filteredAllowlist.map((entry, index) => (
                    <div className="rabbit-ledger-row" key={entry.id}>
                      <span className="rabbit-ledger-index">{String(index + 1).padStart(3, "0")}</span>
                      {entry.xProfileImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={entry.xProfileImageUrl} alt="" />
                      ) : <span className="rabbit-avatar-fallback">?</span>}
                      <div className="rabbit-ledger-user"><strong>@{entry.xUsername}</strong><small>{entry.xUserId ? "X ID VERIFIED" : "AWAITING X CONNECTION"}</small></div>
                      <div className="rabbit-ledger-wallet"><span>{entry.claim ? shortWallet(entry.claim.wallet) : "NO WALLET"}</span><small>{entry.claim?.tokenId ? `SBT #${entry.claim.tokenId}` : "—"}</small></div>
                      <strong className={`rabbit-ledger-status ${(entry.claim?.status || (entry.eligible ? "eligible" : "disabled")).toLowerCase()}`}>{entry.claim?.status || (entry.eligible ? "ELIGIBLE" : "DISABLED")}</strong>
                    </div>
                  ))}
                  {!filteredAllowlist.length && <div className="rabbit-empty-ledger">NO IDENTITIES FOUND IN THIS LAYER.</div>}
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      <footer className="rabbit-footer"><span>BUNNY HOOD · RABBIT HOLE 001</span><span>SOULBOUND ≠ FOR SALE</span><span>ADMIN-GATED PREVIEW</span></footer>
    </main>
  );
}
