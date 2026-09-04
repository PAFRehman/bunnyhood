"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { parseCheckerImportDraft } from "@/lib/checker/import";

type CheckerStats = { total: number; gtd: number; fcfs: number };
type CheckerRow = {
  walletAddress: string;
  eligibilityType: "GTD" | "FCFS";
  importedAt: string;
  updatedAt: string;
};
type CheckerAdminData = { stats: CheckerStats; rows: CheckerRow[] };
type CheckerImportPreview = {
  gtd: number;
  fcfs: number;
  validUnique: number;
  fixedPrefixes: number;
  duplicatesRemoved: number;
  ignoredRows: number;
  crossListConflicts: number;
  alreadyExists: number;
  unchanged: number;
  statusChanges: number;
  newWallets: number;
};

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

export function CheckerAdminApp() {
  const router = useRouter();
  const [data, setData] = useState<CheckerAdminData | null>(null);
  const [gtdWallets, setGtdWallets] = useState("");
  const [fcfsWallets, setFcfsWallets] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewState, setPreviewState] = useState<{
    source: string;
    preview: CheckerImportPreview | null;
  } | null>(null);
  const [message, setMessage] = useState("");

  const draft = useMemo(
    () => parseCheckerImportDraft(gtdWallets, fcfsWallets),
    [fcfsWallets, gtdWallets],
  );
  const previewSource = `${gtdWallets}\u0000${fcfsWallets}`;
  const currentPreviewState = previewState?.source === previewSource ? previewState : null;
  const preview = currentPreviewState?.preview ?? null;
  const previewing = draft.validUnique > 0 && currentPreviewState === null;

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

  useEffect(() => {
    if (!draft.validUnique) return;

    const controller = new AbortController();
    const source = previewSource;
    const timer = window.setTimeout(async () => {
      try {
        const result = await adminRequest<{ preview: CheckerImportPreview }>("/api/admin/checker", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operation: "preview", gtdWallets, fcfsWallets }),
          signal: controller.signal,
        });
        setPreviewState({ source, preview: result.preview });
      } catch (error) {
        if (controller.signal.aborted) return;
        if ((error as Error & { status?: number }).status === 401) {
          goToLogin();
          return;
        }
        setPreviewState({ source, preview: null });
        setMessage(error instanceof Error ? error.message : "The import preview could not be checked.");
      }
    }, 400);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [draft.validUnique, fcfsWallets, goToLogin, gtdWallets, previewSource]);

  async function importWallets(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.validUnique) {
      setMessage("Paste at least one valid GTD or FCFS wallet column.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await adminRequest<{
        saved: number;
        stats: CheckerStats;
        preview: CheckerImportPreview;
      }>("/api/admin/checker", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "import", gtdWallets, fcfsWallets }),
      });
      setGtdWallets("");
      setFcfsWallets("");
      setMessage(
        `${numberFormat.format(result.preview.newWallets)} new added · ` +
        `${numberFormat.format(result.preview.alreadyExists)} already existed · ` +
        `${numberFormat.format(result.preview.statusChanges)} status change${result.preview.statusChanges === 1 ? "" : "s"}.`,
      );
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
        <p>Paste raw wallet columns from any sheet. Headers and extra columns are ignored, missing 0x prefixes are repaired, duplicates are removed, and every import is checked against the saved list first.</p>
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
              <p>Paste the complete GTD or FCFS column as-is. CSV rows, tabs, labels, blank cells, and extra columns are safe. If a wallet appears in both boxes, GTD is kept.</p>
            </div>
            <div className="checker-admin-import-grid">
              <label>
                <span><b>GTD WALLET COLUMN</b><i>{numberFormat.format(draft.gtd)} valid</i></span>
                <textarea value={gtdWallets} onChange={(event) => setGtdWallets(event.target.value)} placeholder={"wallet,address,notes\n0x1234…\n7a9f… (0x optional)"} spellCheck={false} disabled={busy} />
              </label>
              <label>
                <span><b>FCFS WALLET COLUMN</b><i>{numberFormat.format(draft.fcfs)} valid</i></span>
                <textarea value={fcfsWallets} onChange={(event) => setFcfsWallets(event.target.value)} placeholder={"Paste one column or full spreadsheet rows\n0x5678…\n9bc1… (0x optional)"} spellCheck={false} disabled={busy} />
              </label>
            </div>
            {(draft.validUnique > 0 || previewing) && (
              <div className="checker-admin-preview" aria-live="polite">
                <article><span>VALID UNIQUE</span><strong>{numberFormat.format(draft.validUnique)}</strong><small>{numberFormat.format(draft.gtd)} GTD · {numberFormat.format(draft.fcfs)} FCFS</small></article>
                <article><span>ALREADY EXISTS</span><strong>{previewing ? "…" : numberFormat.format(preview?.alreadyExists ?? 0)}</strong><small>{preview ? `${numberFormat.format(preview.unchanged)} unchanged` : "Checking full database"}</small></article>
                <article className="new"><span>NEW TO ADD</span><strong>{previewing ? "…" : numberFormat.format(preview?.newWallets ?? 0)}</strong><small>{preview?.statusChanges ? `${numberFormat.format(preview.statusChanges)} status change${preview.statusChanges === 1 ? "" : "s"}` : "No duplicate re-entry"}</small></article>
                <article><span>AUTO-CLEANED</span><strong>{numberFormat.format(draft.fixedPrefixes + draft.duplicatesRemoved + draft.ignoredRows + draft.crossListConflicts)}</strong><small>{numberFormat.format(draft.fixedPrefixes)} prefixes fixed · {numberFormat.format(draft.duplicatesRemoved)} duplicates</small></article>
              </div>
            )}
            {(draft.ignoredRows > 0 || draft.crossListConflicts > 0) && (
              <p className="checker-admin-import-note">
                {draft.ignoredRows > 0 ? `${numberFormat.format(draft.ignoredRows)} row${draft.ignoredRows === 1 ? "" : "s"} without a complete wallet ignored. ` : ""}
                {draft.crossListConflicts > 0 ? `${numberFormat.format(draft.crossListConflicts)} wallet${draft.crossListConflicts === 1 ? "" : "s"} found in both lists and kept as GTD.` : ""}
              </p>
            )}
            <button type="submit" disabled={busy || previewing || !preview || (preview.newWallets === 0 && preview.statusChanges === 0)}>
              {busy
                ? "SAVING PRIVATE INDEX…"
                : previewing
                  ? "CHECKING SAVED WALLETS…"
                  : preview && preview.newWallets === 0 && preview.statusChanges === 0
                    ? "EVERY WALLET ALREADY EXISTS"
                    : preview
                      ? `ADD ${numberFormat.format(preview.newWallets)} NEW${preview.statusChanges ? ` · UPDATE ${numberFormat.format(preview.statusChanges)}` : ""}`
                      : "PASTE WALLETS TO PREVIEW"}
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
