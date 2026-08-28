/* eslint-disable @next/next/no-img-element */
"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type ClaimStatus = "eligible" | "minting" | "claimed" | "failed";

type PublicEligibility = {
  eligible: true;
  id: string;
  username: string;
  xIdentityBound: boolean;
  status: ClaimStatus;
  claimed: boolean;
  wallet: string | null;
  transactionHash: string | null;
  tokenId: string | null;
  contractAddress: string | null;
  chainId: number | null;
  metadataUrl: string | null;
  imageUrl: string | null;
  imageCid: string | null;
  metadataCid: string | null;
  imageGatewayUrl: string | null;
  metadataGatewayUrl: string | null;
  pinnedAt: string | null;
  claimedAt: string | null;
  updatedAt: string | null;
} | {
  eligible: false;
  status: "not_eligible";
};

type RabbitState = {
  authenticated: boolean;
  user?: {
    xUserId: string;
    xUsername: string;
    xName: string;
    xProfileImageUrl: string | null;
  };
  eligibility: PublicEligibility | null;
  stats: { total: number; eligible: number; minting: number; claimed: number; failed: number };
  access: "public" | "admin_preview";
  network: {
    name: string;
    chainId: number;
    explorerUrl: string;
    contractAddress: string | null;
    contractConfigured: boolean;
  };
};

type SearchResult = PublicEligibility & {
  stats: { total: number; claimed: number };
  access: "public" | "admin_preview";
  network: RabbitState["network"];
};

type AdminRow = {
  id: string;
  username: string;
  xUserId: string | null;
  xName: string | null;
  status: ClaimStatus;
  wallet: string | null;
  transactionHash: string | null;
  tokenId: string | null;
  contractAddress: string | null;
  imageCid: string | null;
  metadataCid: string | null;
  metadataGatewayUrl: string | null;
  claimedAt: string | null;
  updatedAt: string | null;
};

type AdminData = { stats: RabbitState["stats"]; rows: AdminRow[] };
type ApiError = { error?: string; code?: string };

function csrfToken() {
  const part = document.cookie.split(";").map((item) => item.trim())
    .find((item) => item.startsWith("bh_spin_csrf="));
  return part ? decodeURIComponent(part.slice("bh_spin_csrf=".length)) : "";
}

async function api<T>(url: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  if (init?.method && init.method !== "GET") {
    headers.set("content-type", "application/json");
    const csrf = csrfToken();
    if (csrf) headers.set("x-csrf-token", csrf);
  }
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  const data = await response.json().catch(() => ({})) as T & ApiError;
  if (!response.ok) throw new Error(data.error || "The Rabbit Hole request failed.");
  return data;
}

function short(value: string | null | undefined, front = 7, back = 5) {
  if (!value) return "—";
  return value.length > front + back + 2 ? `${value.slice(0, front)}…${value.slice(-back)}` : value;
}

function Box({ profile, claimedImage }: { profile?: string | null; claimedImage?: string | null }) {
  return (
    <div className="rabbit-box-stage" aria-label="Bunny Hood soulbound box preview">
      {claimedImage
        ? <img className="rabbit-box-art" src={claimedImage} alt="Your unique Bunny Hood Rabbit Hole SBT" />
        : <svg className="rabbit-box-art" viewBox="0 0 1254 1254" role="img" aria-label={profile ? "Your X profile printed on the original Bunny Hood box" : "Original Bunny Hood Rabbit Hole box"}>
            <defs><clipPath id="rabbit-live-front"><polygon points="257,478 587,582 587,1013 257,909" /></clipPath></defs>
            <image href="/assets/rabbit-hole-box-original.png" x="0" y="0" width="1254" height="1254" />
            {profile && <g clipPath="url(#rabbit-live-front)"><image href={profile} x="257" y="478" width="330" height="431" preserveAspectRatio="xMidYMid slice" transform="matrix(1 0.3151515152 0 1 0 -80.994)" /></g>}
          </svg>}
      <span className="rabbit-box-ground">NON-TRANSFERABLE · FOREVER YOURS</span>
    </div>
  );
}

function Intro({ onComplete }: { onComplete: () => void }) {
  const [opening, setOpening] = useState(false);
  function enter() {
    if (opening) return;
    setOpening(true);
    window.setTimeout(onComplete, 1_350);
  }
  return (
    <div className={`rabbit-intro ${opening ? "opening" : ""}`}>
      <div className="rabbit-tunnel" aria-hidden="true">
        <i /><i /><i /><i /><i />
      </div>
      <div className="rabbit-door rabbit-door-left"><span>BH</span></div>
      <div className="rabbit-door rabbit-door-right"><span>?</span></div>
      <div className="rabbit-enter-copy">
        <p>BUNNY HOOD · ONCHAIN CLAIM</p>
        <h1>ENTER THE<br /><em>RABBIT HOLE</em></h1>
        <button type="button" onClick={enter} disabled={opening}>
          {opening ? "OPENING…" : "ENTER THE RABBIT HOLE"}<span>↘</span>
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ClaimStatus | "not_eligible" }) {
  const label = status === "not_eligible" ? "NOT ELIGIBLE" : status.toUpperCase();
  return <span className={`rabbit-status ${status}`}>{label}</span>;
}

export function RabbitHoleApp() {
  const [entered, setEntered] = useState(false);
  const [state, setState] = useState<RabbitState | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [wallet, setWallet] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [adminData, setAdminData] = useState<AdminData | null>(null);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [adminSearch, setAdminSearch] = useState("");
  const [refreshingMetadataId, setRefreshingMetadataId] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    try {
      const next = await api<RabbitState>("/api/rabbit-hole/me");
      setState(next);
      setError("");
      return next;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Rabbit Hole data could not be loaded.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAdmin = useCallback(async (search = "") => {
    try {
      const next = await api<AdminData>(`/api/admin/rabbit-hole/eligibility?search=${encodeURIComponent(search)}`);
      setAdminData(next);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Eligibility records could not be loaded.");
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => {
      void loadState().then((next) => {
        if (next?.access === "admin_preview") void loadAdmin();
      });
      const params = new URLSearchParams(window.location.search);
      if (params.get("connected") === "1") setMessage("X connected. Your identity has been checked against the Rabbit Hole list.");
      const authError = params.get("auth_error");
      if (authError) setError("X connection was not completed. Please try again.");
    }, 0);
    return () => window.clearTimeout(initial);
  }, [loadAdmin, loadState]);

  useEffect(() => {
    if (state?.eligibility?.eligible && state.eligibility.status === "minting") {
      const poll = window.setInterval(() => void loadState(), 3_000);
      return () => window.clearInterval(poll);
    }
  }, [loadState, state?.eligibility]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 7_000);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearching(true);
    setError("");
    try {
      const result = await api<SearchResult>(`/api/rabbit-hole/status?username=${encodeURIComponent(username)}`);
      setSearchResult(result);
    } catch (nextError) {
      setSearchResult(null);
      setError(nextError instanceof Error ? nextError.message : "Username could not be checked.");
    } finally {
      setSearching(false);
    }
  }

  async function claim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm("Mint this permanent, non-transferable SBT to the entered wallet? The wallet cannot be changed after minting.")) return;
    setClaiming(true);
    setError("");
    try {
      const result = await api<{ eligibility: PublicEligibility }>("/api/rabbit-hole/claim", {
        method: "POST",
        body: JSON.stringify({ wallet }),
      });
      setState((current) => current ? { ...current, eligibility: result.eligibility } : current);
      setMessage(result.eligibility.eligible && result.eligibility.status === "claimed"
        ? "Your unique box is pinned to IPFS and its soulbound ownership is confirmed onchain."
        : "Mint submitted. The page is watching the chain for confirmation.");
      setWallet("");
      await loadState();
      if (state?.access === "admin_preview") await loadAdmin(adminSearch);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The SBT could not be claimed.");
    } finally {
      setClaiming(false);
    }
  }

  async function disconnect() {
    try {
      await api("/api/spin/auth/logout", { method: "POST", body: "{}" });
      await loadState();
      setMessage("X disconnected from this browser.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "X could not be disconnected.");
    }
  }

  async function copyClaimedWallet(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("Claimed wallet copied.");
    } catch {
      setError("The wallet could not be copied. Select the full address manually.");
    }
  }

  async function importEligibility(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const count = importText.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#")).length;
    if (!window.confirm(`Replace the editable eligibility list with these ${count} rows? Confirmed and minting claims will always be preserved.`)) return;
    setImporting(true);
    setError("");
    try {
      await api("/api/admin/rabbit-hole/eligibility", {
        method: "POST",
        body: JSON.stringify({ data: importText }),
      });
      setImportText("");
      await Promise.all([loadState(), loadAdmin(adminSearch)]);
      setMessage("Eligibility list updated. Claimed and in-flight SBT records were preserved.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Eligibility list could not be imported.");
    } finally {
      setImporting(false);
    }
  }

  async function refreshExplorerMetadata(row: AdminRow) {
    setRefreshingMetadataId(row.id);
    setError("");
    try {
      await api<{ ok: true; tokenId: string }>("/api/admin/rabbit-hole/refetch-metadata", {
        method: "POST",
        body: JSON.stringify({ eligibilityId: row.id }),
      });
      setMessage(`Blockscout is refreshing the artwork for SBT #${row.tokenId}. Reload its explorer page shortly.`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Explorer metadata could not be refreshed.");
    } finally {
      setRefreshingMetadataId(null);
    }
  }

  const eligibility = state?.eligibility;
  const claimedImage = eligibility?.eligible && (eligibility.status === "claimed" || eligibility.status === "minting")
    ? `/api/rabbit-hole/image/${eligibility.id}`
    : null;
  const explorerTx = eligibility?.eligible && eligibility.transactionHash && state
    ? `${state.network.explorerUrl}/tx/${eligibility.transactionHash}`
    : null;
  const explorerToken = eligibility?.eligible && eligibility.contractAddress && state
    ? `${state.network.explorerUrl}/token/${eligibility.contractAddress}/instance/${eligibility.tokenId ?? ""}`
    : null;
  const openSeaToken = eligibility?.eligible && eligibility.chainId === 4663 && eligibility.contractAddress && eligibility.tokenId
    ? `https://opensea.io/item/robinhood/${eligibility.contractAddress}/${eligibility.tokenId}`
    : null;
  const downloadImage = eligibility?.eligible ? `/api/rabbit-hole/image/${eligibility.id}?download=1` : null;
  const shareTarget = openSeaToken || explorerToken || "https://www.bunnyhood.xyz/RabbitHole";
  const shareOnX = eligibility?.eligible && eligibility.status === "claimed"
    ? `https://x.com/intent/post?text=${encodeURIComponent(`I entered the Bunny Hood Rabbit Hole and claimed my permanent soulbound box as @${eligibility.username}.`)}&url=${encodeURIComponent(shareTarget)}`
    : null;
  const progress = state ? Math.min(100, Math.round((state.stats.claimed / Math.max(1, state.stats.total)) * 100)) : 0;
  const importCount = useMemo(() => importText.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#")).length, [importText]);

  return (
    <main className={`rabbit-hole-page ${entered ? "entered" : "locked"}`}>
      {!entered && <Intro onComplete={() => setEntered(true)} />}
      <header className="rabbit-nav">
        <Link href="/" className="rabbit-brand"><span>BH</span><strong>BUNNY HOOD</strong></Link>
      </header>

      <section className="rabbit-hero">
        <div className="rabbit-grid" aria-hidden="true" />
        <div className="rabbit-hero-copy">
          <p className="rabbit-kicker">01 · DESCEND</p>
          <h1>FIND YOUR<br /><em>BOX.</em></h1>
          <p>Search your X username, check your eligibility, verify the right X account, enter your wallet address, and mint your Bunny Hood SBT.</p>
          <div className="rabbit-chain-line"><span>{state?.network.name ?? "ROBINHOOD CHAIN"}</span><span>EIP-5192</span><span>SOULBOUND</span></div>
        </div>
        <Box profile={state?.user?.xProfileImageUrl} claimedImage={claimedImage} />
      </section>

      <section className="rabbit-check-section" id="check">
        <div className="rabbit-section-heading">
          <div><p className="rabbit-kicker">02 · CHECK THE LEDGER</p><h2>ARE YOU<br /><em>INSIDE?</em></h2></div>
          <div className="rabbit-counter"><strong>{state?.stats.total ?? 0}</strong><span>ELIGIBLE USERS LOADED</span><i><b style={{ width: `${Math.min(100, state?.stats.total ?? 0)}%` }} /></i></div>
        </div>
        <form className="rabbit-search" onSubmit={search}>
          <label htmlFor="rabbit-username">SEARCH X USERNAME</label>
          <div><span>@</span><input id="rabbit-username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="username" maxLength={16} required autoComplete="off" spellCheck={false} /><button disabled={searching}>{searching ? "CHECKING…" : "CHECK STATUS"}<b>↘</b></button></div>
        </form>
        {searchResult && <div className={`rabbit-search-result ${searchResult.eligible ? searchResult.status : "not_eligible"}`}>
          <div><small>LEDGER RESULT</small><strong>@{searchResult.eligible ? searchResult.username : username.replace(/^@/, "")}</strong></div>
          <StatusBadge status={searchResult.status} />
          <p>{!searchResult.eligible
            ? "This username is not in the current Rabbit Hole list."
            : searchResult.status === "claimed"
              ? `Box already claimed${searchResult.tokenId ? ` · SBT #${searchResult.tokenId}` : ""}.`
              : searchResult.status === "minting"
                ? "The SBT transaction is currently confirming onchain."
                : "This identity can connect X and claim its permanent box."}</p>
        </div>}
      </section>

      <section className="rabbit-claim-section">
        <div className="rabbit-claim-copy"><p className="rabbit-kicker">03 · BIND YOUR SOUL</p><h2>CLAIM<br /><em>FOREVER.</em></h2><p>The SBT is locked to the wallet at mint. It cannot be transferred, approved, sold, or moved by you—or by Bunny Hood.</p><ul><li><b>01</b> Verify your X identity</li><li><b>02</b> Enter your wallet address</li><li><b>03</b> Mint your SBT onchain</li></ul></div>
        <div className="rabbit-claim-card">
          {loading && <div className="rabbit-card-loading">READING THE LEDGER…</div>}
          {!loading && !state?.authenticated && <div className="rabbit-connect-card"><span className="rabbit-x-mark">X</span><small>IDENTITY REQUIRED</small><h3>Connect the X account on the eligibility list.</h3><p>Search is only a preview. X OAuth proves that the eligible username is actually yours.</p><a href="/api/rabbit-hole/auth/x/start">CONNECT X TO CONTINUE <b>↗</b></a></div>}
          {!loading && state?.authenticated && <>
            <div className="rabbit-profile-row">
              {state.user?.xProfileImageUrl ? <img src={state.user.xProfileImageUrl} alt="" referrerPolicy="no-referrer" /> : <span />}
              <div><small>CONNECTED IDENTITY</small><strong>@{state.user?.xUsername}</strong><p>{state.user?.xName}</p></div>
              <button type="button" onClick={disconnect}>DISCONNECT</button>
            </div>
            {!eligibility?.eligible && <div className="rabbit-not-eligible"><StatusBadge status="not_eligible" /><h3>This X identity is outside the current Rabbit Hole.</h3><p>Connect the exact X account whose username appears in the eligibility list.</p></div>}
            {eligibility?.eligible && eligibility.status === "claimed" && <div className="rabbit-claimed-card"><StatusBadge status="claimed" /><h3>Your soulbound box is onchain.</h3><img src={claimedImage ?? ""} alt={`Rabbit Hole SBT for @${eligibility.username}`} /><div className="rabbit-claim-facts"><span>Token<strong>#{eligibility.tokenId}</strong></span><span>Wallet<strong title={eligibility.wallet ?? ""}>{short(eligibility.wallet)}</strong></span><span>Transferable<strong>NO</strong></span></div><div className="rabbit-link-row rabbit-primary-actions">{downloadImage && <a href={downloadImage} download={`bunny-hood-rabbit-hole-${eligibility.username}.png`}>DOWNLOAD PNG ↓</a>}{shareOnX && <a href={shareOnX} target="_blank" rel="noreferrer">SHARE ON X ↗</a>}</div><small className="rabbit-share-note">X does not allow a website to attach an image through the share composer. Download the PNG, then add it to the opened X post.</small><div className="rabbit-link-row">{openSeaToken && <a href={openSeaToken} target="_blank" rel="noreferrer">VIEW ON OPENSEA ↗</a>}{explorerTx && <a href={explorerTx} target="_blank" rel="noreferrer">VIEW TRANSACTION ↗</a>}{explorerToken && <a href={explorerToken} target="_blank" rel="noreferrer">VIEW SBT ↗</a>}</div></div>}
            {eligibility?.eligible && eligibility.status === "minting" && <div className="rabbit-minting-card"><div className="rabbit-orbit-loader"><i /><i /><span>BH</span></div><StatusBadge status="minting" /><h3>Opening your box onchain…</h3><p>The mint was submitted. This page checks the chain every three seconds and will safely recover if confirmation takes longer.</p>{explorerTx && <a href={explorerTx} target="_blank" rel="noreferrer">WATCH TRANSACTION ↗</a>}</div>}
            {eligibility?.eligible && (eligibility.status === "eligible" || eligibility.status === "failed") && <form className="rabbit-wallet-form" onSubmit={claim}>
              <StatusBadge status={eligibility.status} />
              <h3>{eligibility.status === "failed" ? "The previous attempt can be retried." : "Your identity is eligible."}</h3>
              <label htmlFor="rabbit-wallet">FINAL RECEIVING WALLET</label>
              <input id="rabbit-wallet" value={wallet} onChange={(event) => setWallet(event.target.value)} placeholder="0x…" required autoComplete="off" spellCheck={false} />
              <p>Double-check this address. The SBT can never be transferred to another wallet after minting.</p>
              <button disabled={claiming || !state.network.contractConfigured}>{claiming ? "MINTING ONCHAIN…" : state.network.contractConfigured ? "CLAIM SOULBOUND BOX" : "CONTRACT NOT CONFIGURED"}<b>↘</b></button>
            </form>}
          </>}
        </div>
      </section>

      <section className="rabbit-supply-strip"><div><strong>{state?.stats.claimed ?? 0}</strong><span>CLAIMED</span></div><div className="rabbit-progress"><i><b style={{ width: `${progress}%` }} /></i><span>{progress}% OF LOADED IDENTITIES HAVE ENTERED</span></div><div><strong>{Math.max(0, (state?.stats.total ?? 0) - (state?.stats.claimed ?? 0))}</strong><span>REMAINING</span></div></section>

      {state?.access === "admin_preview" && <section className="rabbit-admin-section">
        <div className="rabbit-admin-heading"><div><p className="rabbit-kicker">PRIVATE ADMIN · ELIGIBILITY MANAGER</p><h2>LOAD THE<br /><em>100.</em></h2></div><p>This preview remains inaccessible without the existing Bunny Hood admin session. Paste one username per line, or <code>username,x_user_id</code> for stronger pre-bound identity security. Every claimed wallet remains stored in the permanent claim ledger and is shown in full below.</p></div>
        <div className="rabbit-admin-grid">
          <form className="rabbit-import-card" onSubmit={importEligibility}><label htmlFor="rabbit-import">REPLACE EDITABLE ELIGIBILITY LIST</label><textarea id="rabbit-import" value={importText} onChange={(event) => setImportText(event.target.value)} placeholder={"username\nanother_user,123456789\nhttps://x.com/thirduser"} rows={12} required /><div><span className={importCount > 100 ? "over" : ""}>{importCount} / 100 ROWS</span><button disabled={importing || importCount === 0 || importCount > 100}>{importing ? "IMPORTING…" : "IMPORT LIST"}</button></div><small>Confirmed and currently minting records are permanently preserved during replacements.</small></form>
          <div className="rabbit-admin-records"><form onSubmit={(event) => { event.preventDefault(); void loadAdmin(adminSearch); }}><input value={adminSearch} onChange={(event) => setAdminSearch(event.target.value)} placeholder="Search username, X ID, wallet or tx" /><button>SEARCH</button></form><div className="rabbit-admin-stats"><span><b>{adminData?.stats.total ?? 0}</b>Loaded</span><span><b>{adminData?.stats.claimed ?? 0}</b>Claimed</span><span><b>{adminData?.stats.minting ?? 0}</b>Minting</span><span><b>{adminData?.stats.failed ?? 0}</b>Failed</span></div><div className="rabbit-table-wrap"><table><thead><tr><th>Identity</th><th>Status</th><th>Claimed wallet</th><th>Token / IPFS</th></tr></thead><tbody>{adminData?.rows.map((row) => <tr key={row.id}><td><strong>@{row.username}</strong><small>{row.xUserId || "X ID binds at first login"}</small></td><td><StatusBadge status={row.status} /></td><td>{row.wallet ? <div className="rabbit-wallet-cell"><code>{row.wallet}</code><button type="button" onClick={() => void copyClaimedWallet(row.wallet!)}>COPY</button></div> : "—"}</td><td><strong>{row.tokenId ? `#${row.tokenId}` : "—"}</strong>{row.metadataGatewayUrl && <a href={row.metadataGatewayUrl} target="_blank" rel="noreferrer">IPFS ↗</a>}{row.status === "claimed" && row.tokenId && row.metadataCid && <button className="rabbit-refresh-metadata" type="button" disabled={refreshingMetadataId === row.id} onClick={() => void refreshExplorerMetadata(row)}>{refreshingMetadataId === row.id ? "REFRESHING…" : "REFRESH EXPLORER"}</button>}</td></tr>)}</tbody></table>{adminData?.rows.length === 0 && <p className="rabbit-empty">No eligibility records loaded yet.</p>}</div></div>
        </div>
      </section>}

      <footer className="rabbit-footer"><Link href="/">BUNNY HOOD</Link><span>SOULBOUND ON ROBINHOOD CHAIN</span><a href="https://x.com/BunnysHood" target="_blank" rel="noreferrer">@BunnysHood ↗</a></footer>
      {(message || error) && <div className={`rabbit-toast ${error ? "error" : ""}`} role="status"><strong>{error ? "RABBIT HOLE ERROR" : "RABBIT HOLE UPDATE"}</strong><span>{error || message}</span><button type="button" onClick={() => { setError(""); setMessage(""); }}>×</button></div>}
    </main>
  );
}
