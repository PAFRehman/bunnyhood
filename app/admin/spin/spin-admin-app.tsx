"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Dashboard = {
  campaign: null | {
    id: string;
    title: string;
    tweetUrl: string;
    startsAt: string;
    endsAt: string;
    roundNumber: number;
    expectedUsers: number;
    expectedSpinsPerUser: number;
  };
  totals: { users: number; spins: number; wins: number; pending_wallets: number; referrals: number };
  inventory: Array<{ prize_type: string; claimed: number; total: number }>;
  sheetSyncPending: number;
  settings: { allowWalletChanges: boolean; allowWalletSubmissions: boolean };
};

async function adminRequest<T>(url: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  if (init?.method === "POST") headers.set("content-type", "application/json");
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  const data = await response.json().catch(() => ({})) as T & { error?: string; code?: string };
  if (!response.ok) {
    const error = new Error(data.error || "Request failed.");
    Object.assign(error, { code: data.code, status: response.status });
    throw error;
  }
  return data;
}

export function SpinAdminApp() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [password, setPassword] = useState("");
  const [title, setTitle] = useState("Bunny Hood 20-Day Drop");
  const [tweetUrl, setTweetUrl] = useState("");
  const [redeemCode, setRedeemCode] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [expectedUsers, setExpectedUsers] = useState("500");
  const [gtdCount, setGtdCount] = useState("15");
  const [fcfs1Count, setFcfs1Count] = useState("20");
  const [fcfs2Count, setFcfs2Count] = useState("30");
  const [startNewCampaign, setStartNewCampaign] = useState(false);
  const [busy, setBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState<"changes" | "submissions" | null>(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadDashboard = useCallback(async () => {
    try {
      const data = await adminRequest<Dashboard>("/api/admin/spin/dashboard");
      setDashboard(data);
      setNeedsLogin(false);
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status === 401) setNeedsLogin(true);
      else setMessage(error instanceof Error ? error.message : "Dashboard could not be loaded.");
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadDashboard(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadDashboard]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await adminRequest("/api/admin/spin/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setPassword("");
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Admin sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await adminRequest("/api/admin/spin/campaign", {
        method: "POST",
        body: JSON.stringify({
          title,
          tweetUrl,
          redeemCode,
          endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
          expectedUsers: Number(expectedUsers),
          gtdCount: Number(gtdCount),
          fcfs1Count: Number(fcfs1Count),
          fcfs2Count: Number(fcfs2Count),
          startNewCampaign: !dashboard?.campaign || startNewCampaign,
        }),
      });
      setTweetUrl("");
      setRedeemCode("");
      setEndsAt("");
      setStartNewCampaign(false);
      setMessage(startNewCampaign || !dashboard?.campaign
        ? "New 20-day campaign is live with its private prize pool."
        : "New daily round is live. Task and code eligibility reset without resetting the 20-day prize pool.");
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Campaign could not be published.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await adminRequest("/api/admin/spin/logout", { method: "POST", body: "{}" }).catch(() => undefined);
    setDashboard(null);
    setNeedsLogin(true);
  }

  async function toggleWalletChanges() {
    setSettingsBusy("changes");
    setMessage("");
    const allowWalletChanges = !dashboard?.settings.allowWalletChanges;
    try {
      await adminRequest("/api/admin/spin/settings", {
        method: "POST",
        body: JSON.stringify({ allowWalletChanges }),
      });
      setMessage(allowWalletChanges
        ? "Users can now replace their submitted wallets."
        : "Wallet changes are now locked for every user.");
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Wallet permission could not be updated.");
    } finally {
      setSettingsBusy(null);
    }
  }

  async function toggleWalletSubmissions() {
    setSettingsBusy("submissions");
    setMessage("");
    const allowWalletSubmissions = !dashboard?.settings.allowWalletSubmissions;
    try {
      await adminRequest("/api/admin/spin/settings", {
        method: "POST",
        body: JSON.stringify({ allowWalletSubmissions }),
      });
      setMessage(allowWalletSubmissions
        ? "Winners can now submit wallets. Existing wins remain available."
        : "Wallet submission is paused. Existing wins remain saved.");
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Wallet submission permission could not be updated.");
    } finally {
      setSettingsBusy(null);
    }
  }

  async function retrySheetSync() {
    setSheetBusy(true);
    setMessage("");
    try {
      const result = await adminRequest<{
        configured: boolean;
        attempted: number;
        delivered: number;
        backfill: {
          users: { total: number; queued: number };
          referrals: { total: number; queued: number };
          wins: { total: number; queued: number };
          totalRecords: number;
          repairedRows: number;
          discardedLegacyRows: number;
        };
        errors: string[];
        destinationReset: boolean;
      }>("/api/admin/spin/sheets/retry", {
        method: "POST",
        body: "{}",
      });
      if (!result.configured) {
        setMessage("Google Sheets URL or token is missing in Vercel.");
      } else if (result.errors.includes("UNAUTHORIZED")) {
        setMessage("Google rejected the webhook token. GOOGLE_SHEETS_WEBHOOK_TOKEN in Vercel must exactly match BUNNY_HOOD_WEBHOOK_TOKEN in this Apps Script project.");
      } else if (result.errors.some((code) => code === "NON_JSON_RESPONSE" || code === "HTTP_401" || code === "HTTP_403")) {
        setMessage("Google blocked anonymous access. Deploy the Apps Script web app as yourself and allow Anyone to access it, then retry.");
      } else if (result.errors.length) {
        setMessage(`Google Sheets repaired ${result.backfill.repairedRows} queued records and removed ${result.backfill.discardedLegacyRows} obsolete queue records, but delivery still failed with ${result.errors.join(", ")}. Confirm the latest Code.gs is deployed, then retry.`);
      } else {
        setMessage(`Neon contains ${result.backfill.users.total} users, ${result.backfill.referrals.total} referrals, and ${result.backfill.wins.total} wins. Google Sheets delivered ${result.delivered} of ${result.attempted} processed updates.${result.destinationReset ? " The new Sheet destination was detected, so every available record was queued again." : ""} Continue syncing until the pending count reaches 0.`);
      }
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sheet sync could not be retried.");
    } finally {
      setSheetBusy(false);
    }
  }

  if (needsLogin) {
    return (
      <main className="spin-admin-page">
        <div className="spin-admin-shell">
          <div className="spin-admin-brand"><strong>BUNNY HOOD · SPIN ADMIN</strong><a href="/SpinTheWheel">Open wheel</a></div>
          <section className="admin-login">
            <div className="admin-card">
              <p className="section-kicker">PRIVATE CONTROL ROOM</p>
              <h1>Admin sign in.</h1>
              <p>Publish a new tweet and redeem code without exposing either backend credential or Google Sheet URL.</p>
              <form onSubmit={login}>
                <div className="admin-field"><label htmlFor="admin-password">Admin password</label><input id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" /></div>
                <button className="admin-submit" disabled={busy}>{busy ? "Checking…" : "Enter control room"}</button>
              </form>
              {message && <p className="spin-error">{message}</p>}
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (!dashboard) return <main className="spin-admin-page"><div className="spin-loading">Loading control room…</div></main>;

  return (
    <main className="spin-admin-page">
      <div className="spin-admin-shell">
        <div className="spin-admin-brand"><strong>BUNNY HOOD · SPIN ADMIN</strong><div><a href="/SpinTheWheel">Open wheel</a><button onClick={logout} type="button">Sign out</button></div></div>
        <section className="admin-dashboard">
          <header><div><p className="section-kicker">PRIVATE CONTROL ROOM</p><h1>Run the<br /><em>campaign.</em></h1></div><p>Private inventory · paced server draw</p></header>
          <div className="admin-stats">
            <div><span>UNIQUE X USERS</span><strong>{Number(dashboard.totals.users)}</strong></div>
            <div><span>SPINS USED</span><strong>{Number(dashboard.totals.spins)}</strong></div>
            <div><span>TOTAL WINS</span><strong>{Number(dashboard.totals.wins)}</strong></div>
            <div><span>SUCCESSFUL REFERRALS</span><strong>{Number(dashboard.totals.referrals)}</strong></div>
            <div><span>WAITING FOR WALLET</span><strong>{Number(dashboard.totals.pending_wallets)}</strong></div>
          </div>
          <div className="admin-quick-controls">
            <section className="admin-panel">
              <p className="section-kicker">WALLET SUBMISSIONS</p>
              <h2>{dashboard.settings.allowWalletSubmissions ? "Submissions open" : "Submissions paused"}</h2>
              <p className="admin-note">Control whether winners can submit any wallet. Pausing this never removes a win or an already saved wallet.</p>
              <button className="admin-secondary-button" type="button" disabled={settingsBusy !== null} onClick={toggleWalletSubmissions}>{settingsBusy === "submissions" ? "Updating…" : dashboard.settings.allowWalletSubmissions ? "Pause wallet submissions" : "Allow wallet submissions"}</button>
            </section>
            <section className="admin-panel">
              <p className="section-kicker">WALLET PERMISSION</p>
              <h2>{dashboard.settings.allowWalletChanges ? "Changes enabled" : "Wallets locked"}</h2>
              <p className="admin-note">When enabled, winners can replace their own saved wallet while duplicate-wallet protection remains active.</p>
              <button className="admin-secondary-button" type="button" disabled={settingsBusy !== null} onClick={toggleWalletChanges}>{settingsBusy === "changes" ? "Updating…" : dashboard.settings.allowWalletChanges ? "Lock wallet changes" : "Allow wallet changes"}</button>
            </section>
            <section className="admin-panel">
              <p className="section-kicker">GOOGLE SHEETS</p>
              <h2>{dashboard.sheetSyncPending} updates pending</h2>
              <p className="admin-note">Retry up to 20 queued users, referrals, wins, and wallet changes per click to stay within Google&apos;s time limit.</p>
              <button className="admin-secondary-button" type="button" disabled={sheetBusy} onClick={retrySheetSync}>{sheetBusy ? "Syncing…" : "Sync pending rows now"}</button>
            </section>
          </div>
          <div className="admin-grid">
            <section className="admin-panel">
              <h2>Current campaign</h2>
              {dashboard.campaign ? (
                <div className="admin-campaign-data">
                  <div><span>Title</span><strong>{dashboard.campaign.title}</strong></div>
                  <div><span>Tweet</span><strong>{dashboard.campaign.tweetUrl.replace(/^https:\/\//, "")}</strong></div>
                  <div><span>Expected users</span><strong>{Number(dashboard.campaign.expectedUsers)}</strong></div>
                  <div><span>20-day spins per user</span><strong>{Number(dashboard.campaign.expectedSpinsPerUser)}</strong></div>
                  <div><span>Current daily round</span><strong>#{Number(dashboard.campaign.roundNumber)}</strong></div>
                  <div><span>Ends</span><strong>{new Date(dashboard.campaign.endsAt).toLocaleString()}</strong></div>
                  {dashboard.inventory.map((item) => <div key={item.prize_type}><span>{item.prize_type}</span><strong>{Number(item.claimed)} / {Number(item.total)} claimed</strong></div>)}
                  <div><span>Sheet sync queue</span><strong>{dashboard.sheetSyncPending}</strong></div>
                </div>
              ) : <p className="admin-note">No live campaign. Publish one using the form.</p>}
              <p className="admin-note">Daily updates reset task and code eligibility but preserve this campaign&apos;s private prize pool and end date. Prize totals and draw pacing remain private.</p>
            </section>
            <section className="admin-panel">
              <h2>Publish new campaign</h2>
              <form onSubmit={publish}>
                <div className="admin-field"><label htmlFor="campaign-title">Campaign title</label><input id="campaign-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} required /></div>
                <div className="admin-field"><label htmlFor="campaign-tweet">Full X post URL</label><input id="campaign-tweet" type="url" value={tweetUrl} onChange={(event) => setTweetUrl(event.target.value)} placeholder="https://x.com/BunnysHood/status/..." required /></div>
                <div className="admin-field"><label htmlFor="campaign-code">New redeem code</label><input id="campaign-code" value={redeemCode} onChange={(event) => setRedeemCode(event.target.value)} minLength={4} maxLength={64} placeholder="BUNNY-XXXX" required autoComplete="off" /></div>
                {dashboard.campaign && (
                  <label className="admin-new-campaign-toggle">
                    <input type="checkbox" checked={startNewCampaign} onChange={(event) => setStartNewCampaign(event.target.checked)} />
                    <span><strong>Start a completely new 20-day campaign</strong><small>Leave off for the normal daily tweet/code update. Turning this on replaces the current prize pool.</small></span>
                  </label>
                )}
                <div className="admin-field"><label htmlFor="campaign-users">Expected connected users</label><input id="campaign-users" type="number" min="10" max="1000000" value={expectedUsers} onChange={(event) => setExpectedUsers(event.target.value)} disabled={Boolean(dashboard.campaign) && !startNewCampaign} required /></div>
                <div className="admin-prize-grid">
                  <div className="admin-field"><label htmlFor="campaign-gtd">Total GTD</label><input id="campaign-gtd" type="number" min="1" max="100000" value={gtdCount} onChange={(event) => setGtdCount(event.target.value)} disabled={Boolean(dashboard.campaign) && !startNewCampaign} required /></div>
                  <div className="admin-field"><label htmlFor="campaign-fcfs1">Total FCFS1</label><input id="campaign-fcfs1" type="number" min="1" max="100000" value={fcfs1Count} onChange={(event) => setFcfs1Count(event.target.value)} disabled={Boolean(dashboard.campaign) && !startNewCampaign} required /></div>
                  <div className="admin-field"><label htmlFor="campaign-fcfs2">Total FCFS2</label><input id="campaign-fcfs2" type="number" min="1" max="100000" value={fcfs2Count} onChange={(event) => setFcfs2Count(event.target.value)} disabled={Boolean(dashboard.campaign) && !startNewCampaign} required /></div>
                </div>
                <div className="admin-field"><label htmlFor="campaign-end">Optional end time (new campaigns default to 20 days)</label><input id="campaign-end" type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} disabled={Boolean(dashboard.campaign) && !startNewCampaign} /></div>
                <button className="admin-submit" disabled={busy}>{busy ? "Publishing…" : dashboard.campaign && !startNewCampaign ? "Publish daily update" : "Start 20-day campaign"}</button>
              </form>
            </section>
          </div>
          {message && <div className="spin-message">{message}</div>}
        </section>
      </div>
    </main>
  );
}
