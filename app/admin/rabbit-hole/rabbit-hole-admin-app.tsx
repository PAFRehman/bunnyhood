"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ClaimStatus = "eligible" | "minting" | "claimed" | "failed";

type EligibilityStats = {
  total: number;
  eligible: number;
  minting: number;
  claimed: number;
  failed: number;
};

type EligibilityRow = {
  id: string;
  username: string;
  xUserId: string | null;
  xName: string | null;
  status: ClaimStatus;
  wallet: string | null;
  transactionHash: string | null;
  tokenId: string | null;
  contractAddress: string | null;
  chainId: number | null;
  imageCid: string | null;
  metadataCid: string | null;
  metadataGatewayUrl: string | null;
  claimedAt: string | null;
  updatedAt: string | null;
};

type EligibilityData = { stats: EligibilityStats; rows: EligibilityRow[] };
type ApiError = { error?: string; code?: string };

async function adminRequest<T>(url: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  if (init?.method && init.method !== "GET") headers.set("content-type", "application/json");
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  const result = await response.json().catch(() => ({})) as T & ApiError;
  if (response.status === 401) {
    const error = new Error("Admin sign-in required.");
    Object.assign(error, { code: "ADMIN_AUTH_REQUIRED", status: 401 });
    throw error;
  }
  if (!response.ok) {
    const error = new Error(result.error || "Rabbit Hole records could not be loaded.");
    Object.assign(error, { code: result.code, status: response.status });
    throw error;
  }
  return result;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

function importRowCount(value: string) {
  return value.split(/\r?\n/).filter((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return false;
    return !(index === 0 && /^(?:x_?)?username(?:\s*[,\t].*)?$/i.test(trimmed.replace(/^@/, "")));
  }).length;
}

function explorerUrl(row: EligibilityRow) {
  if (!row.transactionHash) return null;
  const origin = row.chainId === 4663
    ? "https://robinhoodchain.blockscout.com"
    : "https://explorer.testnet.chain.robinhood.com";
  return `${origin}/tx/${row.transactionHash}`;
}

function explorerTokenUrl(row: EligibilityRow) {
  if (!row.contractAddress || !row.tokenId) return null;
  const origin = row.chainId === 4663
    ? "https://robinhoodchain.blockscout.com"
    : "https://explorer.testnet.chain.robinhood.com";
  return `${origin}/token/${row.contractAddress}/instance/${row.tokenId}`;
}

export function RabbitHoleAdminApp() {
  const router = useRouter();
  const [data, setData] = useState<EligibilityData | null>(null);
  const [importText, setImportText] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<"add" | "replace" | null>(null);
  const [refreshingMetadataId, setRefreshingMetadataId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (query = search) => {
    try {
      const next = await adminRequest<EligibilityData>(`/api/admin/rabbit-hole/eligibility?search=${encodeURIComponent(query)}`);
      setData(next);
      setError("");
    } catch (nextError) {
      if ((nextError as Error & { status?: number }).status === 401) {
        router.replace("/admin/spin?next=/admin/rabbit-hole");
        return;
      }
      setError(nextError instanceof Error ? nextError.message : "Rabbit Hole records could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [router, search]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const refresh = window.setInterval(() => {
      if (document.visibilityState === "visible" && !busy) void load();
    }, 5_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(refresh);
    };
  }, [busy, load]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 6_000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const rowCount = useMemo(() => importRowCount(importText), [importText]);

  async function updateEligibility(mode: "add" | "replace") {
    const action = mode === "add"
      ? `Add or update these ${rowCount} eligible users without removing anyone already loaded?`
      : `Replace the editable eligibility list with these ${rowCount} users? Claimed and minting records will be preserved.`;
    if (!window.confirm(action)) return;
    setBusy(mode);
    setError("");
    try {
      await adminRequest("/api/admin/rabbit-hole/eligibility", {
        method: mode === "add" ? "PUT" : "POST",
        body: JSON.stringify({ data: importText }),
      });
      setImportText("");
      setSearch("");
      setSearchInput("");
      await load("");
      setMessage(mode === "add"
        ? "Eligible users added. Existing eligibility and every claim were preserved."
        : "Editable eligibility list replaced. Claimed and minting records were preserved.");
    } catch (nextError) {
      if ((nextError as Error & { status?: number }).status === 401) {
        router.replace("/admin/spin?next=/admin/rabbit-hole");
        return;
      }
      setError(nextError instanceof Error ? nextError.message : "Eligibility could not be updated.");
    } finally {
      setBusy(null);
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = searchInput.trim();
    setSearch(next);
    void load(next);
  }

  async function copyWallet(wallet: string) {
    try {
      await navigator.clipboard.writeText(wallet);
      setMessage("Full claimed wallet copied.");
    } catch {
      setError("Wallet could not be copied. Select the full address manually.");
    }
  }

  async function refreshExplorerMetadata(row: EligibilityRow) {
    setRefreshingMetadataId(row.id);
    setError("");
    try {
      await adminRequest<{ ok: true; tokenId: string }>("/api/admin/rabbit-hole/refetch-metadata", {
        method: "POST",
        body: JSON.stringify({ eligibilityId: row.id }),
      });
      setMessage(`Blockscout is refreshing the artwork for SBT #${row.tokenId}. Reload its token page shortly.`);
    } catch (nextError) {
      if ((nextError as Error & { status?: number }).status === 401) {
        router.replace("/admin/spin?next=/admin/rabbit-hole");
        return;
      }
      setError(nextError instanceof Error ? nextError.message : "Explorer metadata could not be refreshed.");
    } finally {
      setRefreshingMetadataId(null);
    }
  }

  return (
    <main className="spin-admin-page">
      <div className="spin-admin-shell">
        <div className="spin-admin-brand">
          <strong>BUNNY HOOD · RABBIT HOLE ADMIN</strong>
          <div><span className="admin-live"><i /> LIVE · 5S</span><a href="/RabbitHole">Open Rabbit Hole</a><a href="/admin/spin">Wheel admin</a></div>
        </div>

        <section className="admin-dashboard rabbit-admin-dashboard">
          <header>
            <div><p className="section-kicker">PRIVATE ELIGIBILITY CONTROL</p><h1>Load the<br /><em>100.</em></h1></div>
            <p className="rabbit-admin-intro">Add X usernames without deleting the current list, inspect every claim, and copy complete claimed wallets. Numeric X IDs are optional but provide stronger identity binding.</p>
          </header>

          {error && <div className="admin-storage-pause"><strong>RABBIT HOLE ERROR</strong><span>{error}</span></div>}

          <div className="admin-stats rabbit-admin-stats">
            <div><span>TOTAL LOADED</span><strong>{data?.stats.total ?? 0}</strong></div>
            <div><span>ELIGIBLE</span><strong>{data?.stats.eligible ?? 0}</strong></div>
            <div><span>MINTING</span><strong>{data?.stats.minting ?? 0}</strong></div>
            <div><span>CLAIMED</span><strong>{data?.stats.claimed ?? 0}</strong></div>
            <div><span>FAILED</span><strong>{data?.stats.failed ?? 0}</strong></div>
          </div>

          <div className="admin-grid rabbit-admin-editor-grid">
            <section className="admin-panel rabbit-admin-import">
              <p className="section-kicker">ADD ELIGIBLE USERS</p>
              <h2>Paste usernames.</h2>
              <label htmlFor="rabbit-admin-import">One per line, or username,x_user_id</label>
              <textarea id="rabbit-admin-import" value={importText} onChange={(event) => setImportText(event.target.value)} rows={13} placeholder={"0xPAF\nanother_user,123456789\nhttps://x.com/thirduser"} spellCheck={false} />
              <div className="rabbit-admin-import-count"><span className={rowCount > 100 ? "over" : ""}>{rowCount} / 100 INPUT ROWS</span></div>
              <button className="admin-submit" type="button" disabled={Boolean(busy) || rowCount === 0 || rowCount > 100} onClick={() => void updateEligibility("add")}>{busy === "add" ? "ADDING…" : "ADD USERS"}</button>
              <button className="admin-secondary-button rabbit-replace-button" type="button" disabled={Boolean(busy) || rowCount === 0 || rowCount > 100} onClick={() => void updateEligibility("replace")}>{busy === "replace" ? "REPLACING…" : "REPLACE WHOLE EDITABLE LIST"}</button>
              <p className="admin-note"><strong>Add users</strong> is the normal safe option. Replacement removes unclaimed names not included in the pasted list, but never removes claimed or currently minting records.</p>
            </section>

            <section className="admin-panel rabbit-admin-guide">
              <p className="section-kicker">IMPORT FORMAT</p><h2>What you can paste</h2>
              <div className="admin-campaign-data">
                <div><span>X username</span><strong>0xPAF</strong></div>
                <div><span>Username with @</span><strong>@0xPAF</strong></div>
                <div><span>Full X profile URL</span><strong>https://x.com/0xPAF</strong></div>
                <div><span>Strong pre-binding</span><strong>0xPAF,123456789</strong></div>
              </div>
              <p className="admin-note">The username is matched case-insensitively. When no numeric X ID is supplied, the first successful X login permanently binds the list entry to that X account.</p>
              <p className="admin-note">One X identity and one receiving wallet can each claim only once. The SBT stays non-transferable forever.</p>
            </section>
          </div>

          <section className="admin-panel admin-records-panel rabbit-admin-records">
            <div className="admin-records-heading"><div><p className="section-kicker">LIVE RABBIT HOLE LEDGER</p><h2>Eligibility and claimed wallets.</h2><p>Claimed wallet addresses are displayed in full. Search by username, numeric X ID, wallet, or transaction hash.</p></div></div>
            <div className="admin-record-toolbar"><form onSubmit={submitSearch}><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search username, X ID, wallet or tx" /><button type="submit">Search</button></form></div>
            <div className={`admin-table-wrap ${loading ? "loading" : ""}`}>
              <table className="admin-data-table rabbit-admin-table"><thead><tr><th>Identity</th><th>Status</th><th>Claimed wallet</th><th>Token</th><th>IPFS / chain</th><th>Updated</th></tr></thead><tbody>
                {data?.rows.map((row) => <tr key={row.id}>
                  <td><strong>@{row.username}</strong><small>{row.xUserId || "X ID binds on first login"}</small></td>
                  <td><span className={`rabbit-ledger-status ${row.status}`}>{row.status}</span></td>
                  <td>{row.wallet ? <div className="rabbit-full-wallet"><code>{row.wallet}</code><button type="button" onClick={() => void copyWallet(row.wallet!)}>COPY</button></div> : "—"}</td>
                  <td><strong>{row.tokenId ? `#${row.tokenId}` : "—"}</strong></td>
                  <td><div className="rabbit-ledger-links">{row.metadataGatewayUrl && <a href={row.metadataGatewayUrl} target="_blank" rel="noreferrer">IPFS ↗</a>}{explorerUrl(row) && <a href={explorerUrl(row)!} target="_blank" rel="noreferrer">TX ↗</a>}{explorerTokenUrl(row) && <a href={explorerTokenUrl(row)!} target="_blank" rel="noreferrer">SBT ↗</a>}{row.status === "claimed" && row.tokenId && row.metadataCid && <button type="button" disabled={refreshingMetadataId === row.id} onClick={() => void refreshExplorerMetadata(row)}>{refreshingMetadataId === row.id ? "REFRESHING…" : "REFRESH EXPLORER"}</button>}{!row.metadataGatewayUrl && !explorerUrl(row) && "—"}</div></td>
                  <td>{formatDate(row.updatedAt)}</td>
                </tr>)}
              </tbody></table>
              {!loading && data?.rows.length === 0 && <div className="admin-empty">No matching Rabbit Hole users found.</div>}
            </div>
          </section>
        </section>
      </div>
      {message && <div className="spin-message" role="status">{message}</div>}
    </main>
  );
}
