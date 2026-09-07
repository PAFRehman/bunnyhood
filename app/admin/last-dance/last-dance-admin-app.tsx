"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { LAST_DANCE_POST_TEXT_MAX_LENGTH } from "@/lib/last-dance/defaults";

type AdminData = {
  settings: {
    publicEnabled: boolean;
    maxEntries: number;
    engagementPostUrl: string;
    postText: string;
    mintOpensAt: string | null;
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

function shortWallet(wallet: string) {
  return `${wallet.slice(0, 10)}…${wallet.slice(-8)}`;
}

function toLocalDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function LastDanceAdminApp() {
  const router = useRouter();
  const [data, setData] = useState<AdminData | null>(null);
  const [publicEnabled, setPublicEnabled] = useState(false);
  const [maxEntries, setMaxEntries] = useState(100);
  const [engagementPostUrl, setEngagementPostUrl] = useState("");
  const [postText, setPostText] = useState("");
  const [mintOpensAt, setMintOpensAt] = useState("");
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
        setMintOpensAt(toLocalDateTime(next.settings.mintOpensAt));
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
    }, 5_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(refresh);
    };
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await adminRequest("/api/admin/last-dance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          publicEnabled,
          maxEntries,
          engagementPostUrl,
          postText,
          mintOpensAt: mintOpensAt ? new Date(mintOpensAt).toISOString() : null,
        }),
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

  const progress = data && data.settings.maxEntries > 0
    ? Math.min(100, (data.entriesCount / data.settings.maxEntries) * 100)
    : 0;

  return (
    <main className="ld-admin">
      <aside className="lda-sidebar">
        <Link className="lda-brand" href="/"><span>BH</span><b>BUNNY HOOD</b></Link>
        <div className="lda-side-title"><small>PRIVATE TOOL</small><strong>LAST DANCE<br />STUDIO</strong></div>
        <nav>
          <a className="active" href="#overview"><i>01</i><span>Overview</span></a>
          <a href="#campaign"><i>02</i><span>Campaign setup</span></a>
          <a href="#entries"><i>03</i><span>Entry ledger</span></a>
        </nav>
        <div className={`lda-access-card ${publicEnabled ? "live" : "private"}`}>
          <i />
          <span>PUBLIC PAGE</span>
          <strong>{publicEnabled ? "OPEN" : "PRIVATE"}</strong>
          <small>{publicEnabled ? "Accepting eligible entries" : "Visible to admins only"}</small>
        </div>
        <div className="lda-side-links"><Link href="/admin/spin">SPIN ADMIN</Link><Link href="/TheLastDance">VIEW EXPERIENCE ↗</Link></div>
      </aside>

      <section className="lda-workspace">
        <header className="lda-topbar">
          <div><i /><span>SECURE ADMIN SESSION</span></div>
          <p>Robinhood mainnet · Chain 4663</p>
        </header>

        <section className="lda-overview" id="overview">
          <div className="lda-title">
            <p>CAMPAIGN COMMAND CENTER</p>
            <h1>RUN THE<br /><em>FINAL FLOOR.</em></h1>
          </div>
          <div className="lda-live-capacity">
            <div><span>LIVE CAPACITY</span><b>AUTO REFRESH · 5S</b></div>
            <strong>{data?.entriesCount ?? "—"}<small> / {data?.settings.maxEntries ?? maxEntries}</small></strong>
            <p>verified spots claimed</p>
            <div className="lda-meter"><i style={{ width: `${progress}%` }} /></div>
          </div>
        </section>

        <section className="lda-instruments">
          <article className="coral"><span>01 / CLAIMED</span><strong>{data?.entriesCount ?? "—"}</strong><p>Unique X identities and wallets</p><i>↗</i></article>
          <article className="violet"><span>02 / REMAINING</span><strong>{data?.remaining ?? "—"}</strong><p>Until the atomic cap closes</p><i>↘</i></article>
          <article className="cyan"><span>03 / VERIFICATION</span><strong>ANY</strong><p>NFT + any mainnet transaction</p><i>✓</i></article>
        </section>

        <form className="lda-console" id="campaign" onSubmit={save}>
          <header className="lda-console-head">
            <div><span>CAMPAIGN SETUP</span><h2>PROGRAM THE NIGHT.</h2></div>
            <p>Configure the public gate, entry supply, official engagement destination, and the default X post from this private panel.</p>
          </header>

          <label className="lda-toggle">
            <span><strong>PUBLIC ACCESS</strong><small>When off, only an authenticated BunnyHood admin can preview The Last Dance.</small></span>
            <input type="checkbox" checked={publicEnabled} onChange={(event) => setPublicEnabled(event.target.checked)} />
            <i><b /></i>
          </label>

          <div className="lda-field-grid">
            <label className="lda-cap-field">
              <span>MAXIMUM ENTRIES <b>HARD CAP</b></span>
              <div><input type="number" min="1" max="100000" value={maxEntries} onChange={(event) => setMaxEntries(Number(event.target.value))} /><small>SPOTS</small></div>
              <p>New entries stop atomically when this number is reached.</p>
            </label>
            <label>
              <span>OFFICIAL ENGAGEMENT POST</span>
              <input type="url" value={engagementPostUrl} onChange={(event) => setEngagementPostUrl(event.target.value)} placeholder="https://x.com/BunnysHood/status/..." />
              <p>A complete public X post URL is required before you open access.</p>
            </label>
            <label className="lda-time-field">
              <span>OPENSEA MINT OPENS <b>YOUR LOCAL TIME</b></span>
              <input type="datetime-local" value={mintOpensAt} onChange={(event) => setMintOpensAt(event.target.value)} />
              <p>This powers the live countdown on every confirmed GTD pass. The verified OpenSea GTD start is preloaded; edit only if the official schedule changes.</p>
            </label>
          </div>

          <label className="lda-copy">
            <span>DEFAULT CREATE-POST TEXT <b>{postText.length} / {LAST_DANCE_POST_TEXT_MAX_LENGTH}</b></span>
            <textarea value={postText} onChange={(event) => setPostText(event.target.value.slice(0, LAST_DANCE_POST_TEXT_MAX_LENGTH))} rows={9} placeholder="Write the default Last Dance post…" />
            <p>@BunnysHood is required during verification and is appended by the public composer when missing.</p>
          </label>

          <div className="lda-console-actions">
            <span>{data?.settings.updatedAt ? `LAST SAVED ${new Date(data.settings.updatedAt).toLocaleString()}` : "LOADING SAVED SETTINGS…"}</span>
            <button type="submit" disabled={busy}><span>{busy ? "SAVING CONTROL STATE…" : "SAVE CAMPAIGN STATE"}</span><b>↗</b></button>
          </div>
        </form>

        <section className="lda-ledger" id="entries">
          <header className="lda-ledger-head">
            <div><span>VERIFIED ENTRY LEDGER</span><h2>EVERYONE<br />ON THE FLOOR.</h2></div>
            <div className="lda-ledger-actions">
              <button type="button" onClick={copyWallets}>COPY SHOWN WALLETS</button>
              <a href="/api/admin/last-dance/export">DOWNLOAD FULL DATA · CSV <b>↓</b></a>
            </div>
          </header>

          <div className="lda-table-shell">
            <div className="lda-table-meta"><span>{data?.entriesCount ?? 0} VERIFIED ENTRIES</span><small>Full X IDs, post URLs, timestamps, and proof counts are included in the protected CSV.</small></div>
            <div className="lda-table-scroll">
              <table>
                <thead><tr><th>POSITION</th><th>X IDENTITY</th><th>WALLET</th><th>NFTS</th><th>TXS</th><th>ENTERED</th></tr></thead>
                <tbody>{data?.entries.map((entry, index) => (
                  <tr key={entry.id}>
                    <td><span className="lda-position">{String(data.entriesCount - index).padStart(3, "0")}</span></td>
                    <td><strong>@{entry.xUsername}</strong></td>
                    <td><code title={entry.walletAddress}>{shortWallet(entry.walletAddress)}</code></td>
                    <td><b>{entry.nftCount}</b></td>
                    <td><b>{entry.transactionCount}</b></td>
                    <td>{new Date(entry.enteredAt).toLocaleString()}</td>
                  </tr>
                ))}</tbody>
              </table>
              {!data?.entries.length && <div className="lda-empty"><i /><strong>THE FLOOR IS EMPTY</strong><span>Verified entries will arrive here in real time.</span></div>}
            </div>
          </div>
        </section>
      </section>

      {message && <div className="lda-toast" role="status"><i /><span>{message}</span><button type="button" onClick={() => setMessage("")}>×</button></div>}
    </main>
  );
}
