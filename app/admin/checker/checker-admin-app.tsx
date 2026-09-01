"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type CheckerStats = { total: number; gtd: number; fcfs: number };
type CheckerRow = {
  walletAddress: string;
  eligibilityType: "GTD" | "FCFS";
  importedAt: string;
  updatedAt: string;
};
type CheckerAdminData = { stats: CheckerStats; rows: CheckerRow[] };

async function adminRequest<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    const error = new Error(data.error || "The admin request failed.");
    Object.assign(error, { status: response.status });
    throw error;
  }
  return data;
}

const numberFormat = new Intl.NumberFormat("en-US");
const ADDRESS_MATCH = /0x[0-9a-fA-F]{40}/g;

function draftCount(value: string) {
  return new Set(value.match(ADDRESS_MATCH)?.map((wallet) => wallet.toLowerCase()) ?? []).size;
}

export function CheckerAdminApp() {
  const router = useRouter();
  const [data, setData] = useState<CheckerAdminData | null>(null);
  const [gtdWallets, setGtdWallets] = useState("");
  const [fcfsWallets, setFcfsWallets] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const draft = useMemo(() => ({
    gtd: draftCount(gtdWallets),
    fcfs: draftCount(fcfsWallets),
  }), [fcfsWallets, gtdWallets]);

  const goToLogin = useCallback(() => {
    router.push("/admin/spin?next=/admin/checker");
  }, [router]);

  const load = useCallback(async () => {
    try {
      setData(await adminRequest<CheckerAdminData>(`/api/admin/checker?search=${encodeURIComponent(search)}`));
    } catch (error) {
      if ((error as Error & { status?: number }).status === 401) {
        goToLogin();
        return;
      }
      setMessage(error instanceof Error ? error.message : "Checker data could not be loaded.");
    }
  }, [goToLogin, search]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const refresh = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(refresh);
    };
  }, [load]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 7_000);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function importWallets(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.gtd && !draft.fcfs) {
      setMessage("Paste at least one valid GTD or FCFS wallet.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await adminRequest<{ imported: number; stats: CheckerStats }>("/api/admin/checker", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gtdWallets, fcfsWallets }),
      });
      setGtdWallets("");
      setFcfsWallets("");
      setMessage(`${numberFormat.format(result.imported)} wallet${result.imported === 1 ? "" : "s"} saved. Checker totals updated.`);
      await load();
    } catch (error) {
      if ((error as Error & { status?: number }).status === 401) {
        goToLogin();
        return;
      }
      setMessage(error instanceof Error ? error.message : "Wallets could not be imported.");
    } finally {
      setBusy(false);
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(searchInput.trim());
  }

  async function copyWallets(type: "GTD" | "FCFS") {
    if (!data) return;
    const wallets = data.rows
      .filter((row) => row.eligibilityType === type)
      .map((row) => row.walletAddress);
    if (!wallets.length) {
      setMessage(`No ${type} wallets are visible in this view.`);
      return;
    }
    await navigator.clipboard.writeText(wallets.join("\n"));
    setMessage(`${wallets.length} shown ${type} wallet${wallets.length === 1 ? "" : "s"} copied.`);
  }

  async function removeWallet(walletAddress: string) {
    if (!window.confirm(`Remove ${walletAddress} from the public checker?`)) return;
    setBusy(true);
    setMessage("");
    try {
      await adminRequest("/api/admin/checker", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ walletAddress }),
      });
      setMessage("Wallet removed from the checker.");
      await load();
    } catch (error) {
      if ((error as Error & { status?: number }).status === 401) {
        goToLogin();
        return;
      }
      setMessage(error instanceof Error ? error.message : "Wallet could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="checker-admin-page">
      <header className="checker-admin-nav">
        <Link href="/">BH / PRIVATE</Link>
        <nav>
          <Link href="/admin/spin">SPIN ADMIN</Link>
          <Link href="/checker">OPEN PUBLIC CHECKER ↗</Link>
        </nav>
      </header>

      <section className="checker-admin-hero">
        <div>
          <p>HIDDEN CONTROL ROOM</p>
          <h1>WALLET<br /><em>INDEX.</em></h1>
        </div>
        <p>Paste complete EVM wallets into the correct list. Existing wallets stay saved; importing a wallet again updates its GTD or FCFS status.</p>
      </section>

      {!data ? <div className="checker-admin-loading">LOADING PRIVATE WALLET INDEX…</div> : (
        <>
          <section className="checker-admin-stats">
            <article><span>ALL ELIGIBLE WALLETS</span><strong>{numberFormat.format(data.stats.total)}</strong><small>GTD + FCFS</small></article>
            <article className="gtd"><span>GTD WALLETS ADDED</span><strong>{numberFormat.format(data.stats.gtd)}</strong><small>Guaranteed</small></article>
            <article><span>FCFS WALLETS ADDED</span><strong>{numberFormat.format(data.stats.fcfs)}</strong><small>First Come, First Served</small></article>
          </section>

          <form className="checker-admin-import" onSubmit={importWallets}>
            <div className="checker-admin-import-head">
              <div><span>01 / BULK IMPORT</span><h2>ADD OR UPDATE WALLETS.</h2></div>
              <p>One wallet per line is recommended. Commas and spaces also work. The same wallet cannot be submitted in both boxes.</p>
            </div>
            <div className="checker-admin-import-grid">
              <label>
                <span><b>GTD WALLETS</b><i>{draft.gtd} detected</i></span>
                <textarea value={gtdWallets} onChange={(event) => setGtdWallets(event.target.value)} placeholder={"0x1234…\n0xabcd…"} spellCheck={false} disabled={busy} />
              </label>
              <label>
                <span><b>FCFS WALLETS</b><i>{draft.fcfs} detected</i></span>
                <textarea value={fcfsWallets} onChange={(event) => setFcfsWallets(event.target.value)} placeholder={"0x5678…\n0xef01…"} spellCheck={false} disabled={busy} />
              </label>
            </div>
            <button type="submit" disabled={busy || (!draft.gtd && !draft.fcfs)}>
              {busy ? "SAVING PRIVATE INDEX…" : `SAVE ${numberFormat.format(draft.gtd + draft.fcfs)} WALLETS`}
              <b>↗</b>
            </button>
          </form>

          <section className="checker-admin-records">
            <div className="checker-admin-records-head">
              <div><span>02 / LIVE DATABASE</span><h2>ELIGIBILITY RECORDS.</h2></div>
              <p>Showing the newest 500 records. Search a complete or partial wallet to inspect it.</p>
            </div>
            <div className="checker-admin-tools">
              <form onSubmit={submitSearch}>
                <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search wallet address" />
                <button>SEARCH</button>
              </form>
              <button type="button" onClick={() => void copyWallets("GTD")}>COPY SHOWN GTD</button>
              <button type="button" onClick={() => void copyWallets("FCFS")}>COPY SHOWN FCFS</button>
            </div>
            <div className="checker-admin-table-wrap">
              <table>
                <thead><tr><th>Status</th><th>Wallet address</th><th>Last imported</th><th>Control</th></tr></thead>
                <tbody>{data.rows.map((row) => (
                  <tr key={row.walletAddress}>
                    <td><span className={`checker-admin-badge ${row.eligibilityType.toLowerCase()}`}>{row.eligibilityType}</span></td>
                    <td><code>{row.walletAddress}</code></td>
                    <td>{new Date(row.updatedAt).toLocaleString()}</td>
                    <td><button type="button" disabled={busy} onClick={() => void removeWallet(row.walletAddress)}>REMOVE</button></td>
                  </tr>
                ))}</tbody>
              </table>
              {!data.rows.length && <div className="checker-admin-empty">NO MATCHING WALLETS.</div>}
            </div>
          </section>
        </>
      )}

      {message && <div className="checker-admin-toast" role="status"><span>{message}</span><button type="button" onClick={() => setMessage("")}>×</button></div>}
    </main>
  );
}
