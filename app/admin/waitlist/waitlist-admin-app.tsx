"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Row = {
  id: string;
  joinNumber: number;
  rank: number;
  walletAddress: string;
  referralCode: string;
  referredByCode: string | null;
  referralCount: number;
  bonusPoints: number;
  points: number;
  joinedAt: string;
  followCompletedAt: string | null;
  engageCompletedAt: string | null;
  bonusPostUrl: string | null;
  xUsername: string | null;
};
type AdminData = {
  stats: { entries: number; referrals: number; bonusPosts: number; pendingSync: number; failedSync: number };
  rows: Row[];
  sheetsConfigured: boolean;
};

async function request<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    const error = new Error(data.error || "Admin request failed.");
    Object.assign(error, { status: response.status });
    throw error;
  }
  return data;
}

const numberFormat = new Intl.NumberFormat("en-US");

export function WaitlistAdminApp() {
  const router = useRouter();
  const [data, setData] = useState<AdminData | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await request<AdminData>(`/api/admin/waitlist?search=${encodeURIComponent(search)}`));
    } catch (error) {
      if ((error as Error & { status?: number }).status === 401) {
        router.push("/admin/spin?next=/admin/waitlist");
        return;
      }
      setMessage(error instanceof Error ? error.message : "Waitlist data could not be loaded.");
    }
  }, [router, search]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const refresh = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 15_000);
    return () => { window.clearTimeout(initial); window.clearInterval(refresh); };
  }, [load]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(searchInput.trim());
  }

  async function syncSheets() {
    setBusy(true);
    setMessage("");
    try {
      const result = await request<{ result: { configured: boolean; delivered: number; pending: number } }>("/api/admin/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "sync_sheets" }),
      });
      setMessage(result.result.configured
        ? `Google Sheets: ${result.result.delivered} synced, ${result.result.pending} pending.`
        : "Google Sheets is not configured. Neon records are safe.");
      await load();
    } catch (error) {
      if ((error as Error & { status?: number }).status === 401) {
        router.push("/admin/spin?next=/admin/waitlist");
        return;
      }
      setMessage(error instanceof Error ? error.message : "Google Sheets sync failed.");
    } finally {
      setBusy(false);
    }
  }

  async function copyWallets() {
    if (!data?.rows.length) return;
    await navigator.clipboard.writeText(data.rows.map((row) => row.walletAddress).join("\n"));
    setMessage(`${data.rows.length} wallet${data.rows.length === 1 ? "" : "s"} copied.`);
  }

  return (
    <main className="waitlist-admin-page">
      <header className="waitlist-admin-nav">
        <Link href="/">BH / ADMIN</Link>
        <nav><Link href="/admin/spin">SPIN ADMIN</Link><Link href="/admin/rabbit-hole">RABBIT HOLE</Link><Link href="/waitlist">PUBLIC WAITLIST ↗</Link></nav>
      </header>
      <section className="waitlist-admin-hero">
        <div><p>PRIVATE CONTROL ROOM</p><h1>WAITLIST<br /><em>LEDGER.</em></h1></div>
        <p>Every joined wallet, task confirmation, referral, score, bonus post, and Google Sheets delivery state is read from Neon. This route is protected by the existing admin session.</p>
      </section>

      {!data ? <div className="waitlist-admin-loading">LOADING LIVE NEON RECORDS…</div> : <>
        <section className="waitlist-admin-stats">
          <article><span>ENTRIES</span><strong>{numberFormat.format(data.stats.entries)}</strong></article>
          <article><span>REFERRALS</span><strong>{numberFormat.format(data.stats.referrals)}</strong></article>
          <article><span>VERIFIED X POSTS</span><strong>{numberFormat.format(data.stats.bonusPosts)}</strong></article>
          <article className={data.stats.pendingSync ? "attention" : ""}><span>SHEETS PENDING</span><strong>{numberFormat.format(data.stats.pendingSync)}</strong><small>{data.sheetsConfigured ? `${data.stats.failedSync} retrying` : "not configured"}</small></article>
        </section>

        <section className="waitlist-admin-records">
          <div className="waitlist-admin-tools">
            <form onSubmit={submitSearch}><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search wallet, X account, referral code, or post URL" /><button>SEARCH</button></form>
            <button type="button" onClick={() => void copyWallets()}>COPY SHOWN WALLETS</button>
            <button type="button" onClick={() => void syncSheets()} disabled={busy}>{busy ? "SYNCING…" : "SYNC GOOGLE SHEETS"}</button>
          </div>
          <div className="waitlist-admin-table-wrap">
            <table>
              <thead><tr><th>Rank</th><th>Join #</th><th>Wallet</th><th>Points</th><th>Referrals</th><th>Referral code</th><th>Referred by</th><th>Tasks</th><th>X account</th><th>Post</th><th>Joined</th></tr></thead>
              <tbody>{data.rows.map((row) => <tr key={row.id}>
                <td><strong>#{row.rank}</strong></td>
                <td>#{String(row.joinNumber).padStart(4, "0")}</td>
                <td><code>{row.walletAddress}</code></td>
                <td><b>{row.points}</b></td>
                <td>{row.referralCount}</td>
                <td><code>{row.referralCode}</code></td>
                <td>{row.referredByCode || "—"}</td>
                <td><span className={row.followCompletedAt ? "ok" : "missing"}>FOLLOW + BELL</span><span className={row.engageCompletedAt ? "ok" : "missing"}>ENGAGEMENT</span></td>
                <td>{row.xUsername ? `@${row.xUsername}` : "—"}</td>
                <td>{row.bonusPostUrl ? <a href={row.bonusPostUrl} target="_blank" rel="noreferrer">VIEW ↗</a> : "—"}</td>
                <td>{new Date(row.joinedAt).toLocaleString()}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {!data.rows.length && <div className="waitlist-admin-empty">NO MATCHING WAITLIST RECORDS.</div>}
        </section>
      </>}
      {message && <div className="waitlist-admin-toast" role="status">{message}<button type="button" onClick={() => setMessage("")}>×</button></div>}
    </main>
  );
}
