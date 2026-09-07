"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";

type AdminData = {
  settings: {
    publicEnabled: boolean;
    maxEntries: number;
    engagementPostUrl: string;
    postText: string;
    updatedAt: string;
  };
  entriesCount: number;
  remaining: number;
  entries: Array<{
    id: string;
    xUsername: string;
    walletAddress: string;
    nftCount: number;
    transactionCount: number;
    enteredAt: string;
  }>;
};

async function adminRequest<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    const error = new Error(data.error || "The admin request could not be completed.");
    Object.assign(error, { status: response.status });
    throw error;
  }
  return data;
}

export function LastDanceAdminApp() {
  const router = useRouter();
  const [data, setData] = useState<AdminData | null>(null);
  const [publicEnabled, setPublicEnabled] = useState(false);
  const [maxEntries, setMaxEntries] = useState(100);
  const [engagementPostUrl, setEngagementPostUrl] = useState("");
  const [postText, setPostText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const login = useCallback(() => router.push("/admin/spin?next=/admin/last-dance"), [router]);
  const load = useCallback(async (syncForm = true) => {
    try {
      const next = await adminRequest<AdminData>("/api/admin/last-dance");
      setData(next);
      if (syncForm) {
        setPublicEnabled(next.settings.publicEnabled);
        setMaxEntries(next.settings.maxEntries);
        setEngagementPostUrl(next.settings.engagementPostUrl);
        setPostText(next.settings.postText);
      }
    } catch (error) {
      if ((error as Error & { status?: number }).status === 401) return login();
      setMessage(error instanceof Error ? error.message : "Last Dance data could not be loaded.");
    }
  }, [login]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const refresh = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(false);
    }, 15_000);
    return () => { window.clearTimeout(initial); window.clearInterval(refresh); };
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await adminRequest("/api/admin/last-dance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicEnabled, maxEntries, engagementPostUrl, postText }),
      });
      await load();
      setMessage("Last Dance settings saved.");
    } catch (error) {
      if ((error as Error & { status?: number }).status === 401) return login();
      setMessage(error instanceof Error ? error.message : "Settings could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function copyWallets() {
    if (!data?.entries.length) return setMessage("No entries have been recorded yet.");
    await navigator.clipboard.writeText(data.entries.map((entry) => entry.walletAddress).join("\n"));
    setMessage(`${data.entries.length} claimed wallets copied.`);
  }

  return (
    <main className="ld-admin">
      <header className="lda-nav">
        <Link href="/">BH / ADMIN</Link>
        <nav><Link href="/admin/spin">SPIN ADMIN</Link><Link href="/TheLastDance">OPEN THE LAST DANCE ↗</Link></nav>
      </header>

      <section className="lda-hero">
        <div><p>PRIVATE CONTROL ROOM</p><h1>THE LAST<br /><em>DANCE.</em></h1></div>
        <p>Control public access, the hard entry cap, both X task sources, and inspect every wallet that passed the Robinhood Chain checks.</p>
      </section>

      <section className="lda-stats">
        <article><span>ENTRIES LOCKED</span><strong>{data?.entriesCount ?? "—"}</strong><small>Unique X accounts + wallets</small></article>
        <article><span>SPOTS REMAINING</span><strong>{data?.remaining ?? "—"}</strong><small>Closes atomically at the cap</small></article>
        <article className={publicEnabled ? "live" : "private"}><span>PUBLIC ACCESS</span><strong>{publicEnabled ? "LIVE" : "PRIVATE"}</strong><small>{publicEnabled ? "Users can enter now" : "Admin preview only"}</small></article>
      </section>

      <form className="lda-settings" onSubmit={save}>
        <div className="lda-section-head"><div><span>ACCESS + CAMPAIGN</span><h2>SET THE RULES.</h2></div><p>The page starts private. Turn public access on only when the official engagement post and campaign copy are ready.</p></div>
        <label className="lda-toggle"><span><strong>PUBLIC ACCESS</strong><small>When off, only an authenticated BunnyHood admin can open the page.</small></span><input type="checkbox" checked={publicEnabled} onChange={(event) => setPublicEnabled(event.target.checked)} /><i /></label>
        <div className="lda-fields">
          <label><span>MAX ENTRIES</span><input type="number" min="1" max="100000" value={maxEntries} onChange={(event) => setMaxEntries(Number(event.target.value))} /></label>
          <label><span>OFFICIAL ENGAGEMENT POST URL</span><input type="url" value={engagementPostUrl} onChange={(event) => setEngagementPostUrl(event.target.value)} placeholder="https://x.com/BunnysHood/status/..." /></label>
        </div>
        <label className="lda-copy"><span>CREATE-POST DEFAULT TEXT <b>{postText.length} / 240</b></span><textarea value={postText} onChange={(event) => setPostText(event.target.value.slice(0, 240))} rows={5} placeholder="Write the default Last Dance post…" /><small>@BunnysHood is always required during verification and is appended by the public composer if missing here.</small></label>
        <button type="submit" disabled={busy}>{busy ? "SAVING…" : "SAVE LAST DANCE SETTINGS"}<b>↗</b></button>
      </form>

      <section className="lda-ledger">
        <div className="lda-section-head"><div><span>VERIFIED ENTRY LEDGER</span><h2>WHO MADE IT.</h2></div><button type="button" onClick={copyWallets}>COPY ALL WALLETS</button></div>
        <div className="lda-table">
          <table><thead><tr><th>#</th><th>X ACCOUNT</th><th>WALLET</th><th>NFTS FOUND</th><th>TRANSACTIONS</th><th>ENTERED</th></tr></thead>
            <tbody>{data?.entries.map((entry, index) => <tr key={entry.id}><td>{data.entriesCount - index}</td><td>@{entry.xUsername}</td><td><code>{entry.walletAddress}</code></td><td>{entry.nftCount}</td><td>{entry.transactionCount}</td><td>{new Date(entry.enteredAt).toLocaleString()}</td></tr>)}</tbody></table>
          {!data?.entries.length && <p>NO VERIFIED ENTRIES YET.</p>}
        </div>
      </section>

      {message && <div className="lda-toast"><span>{message}</span><button type="button" onClick={() => setMessage("")}>×</button></div>}
    </main>
  );
}
