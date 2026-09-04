"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type PrizeType = "GTD" | "FCFS1" | "FCFS2";
type RecordView = "users" | "wins" | "referrals";
type ExportFormat = "xlsx" | "users" | "wins" | "referrals" | "daily";

type Dashboard = {
  campaign: null | {
    id: string;
    title: string;
    tweetUrl: string;
    shopPostText: string;
    startsAt: string;
    endsAt: string;
    roundNumber: number;
    expectedUsers: number;
    expectedSpinsPerUser: number;
    spinsProcessed: number;
    participantsSeen: number;
    winnersSelected: number;
  };
  totals: {
    users: number;
    active24h: number;
    spinsEarned: number;
    spinsAvailable: number;
    spinsUsed: number;
    points: number;
    pointsSpent: number;
    pointsAvailable: number;
    averagePoints: number;
    averageHolderPoints: number;
    pointHolders: number;
    wins: number;
    pendingWallets: number;
    referrals: number;
    roleWins: Record<PrizeType, number>;
  };
  inventory: Array<{ prizeType: PrizeType; claimed: number; total: number }>;
  shop: Array<{ spotType: "GTD" | "FCFS"; pointsPrice: number; totalCount: number; purchasedCount: number; remaining: number }>;
  settings: {
    allowWalletChanges: boolean;
    allowWalletSubmissions: boolean;
    postTaskText: string;
    postTaskRequiresTag: boolean;
    bunnyStreakDays: number;
    bunnyDeathOnBreak: boolean;
    bunnyGtdEnabled: boolean;
    bunnyGtdRequirementMode: "days" | "points" | "both";
    bunnyGtdStreakDays: number;
    bunnyGtdPointsRequired: number;
  };
  bunny: {
    totalFeeds: number;
    fedToday: number;
    tradeReady: number;
    fcfsReady: number;
    gtdReady: number;
    deadBunnies: number;
    totalDeaths: number;
    totalTrades: number;
    gtdTrades: number;
    fcfsTrades: number;
    longestStreak: number;
  };
  storage: {
    databaseBytes: number;
    safetyLimitBytes: number;
    remainingBeforePause: number;
    safetyPaused: boolean;
    rawEvents: number;
    recordedAttempts: number;
    rawRetentionHours: number;
    oldestRawEvent: string | null;
    lastMaintenanceAt: string | null;
    lastArchived: number;
    tables: Array<{ name: string; bytes: number; estimatedRows: number }>;
  };
  integrity: { accountingMismatches: number; winMismatches: number };
  topReferrers: Array<{
    rank: number;
    xUserId: string;
    xUsername: string;
    xName: string;
    referralCode: string | null;
    referralCount: number;
    awardedSpins: number;
    lastReferralAt: string | null;
  }>;
  topPointUsers: Array<{
    rank: number;
    id: string;
    xUserId: string;
    xUsername: string;
    xName: string;
    pointsEarned: number;
    pointsSpent: number;
    pointsAvailable: number;
  }>;
  daily: Array<{
    day: string;
    attempts: number;
    spinsConsumed: number;
    spinsRefunded: number;
    noPrize: number;
    GTD: number;
    FCFS1: number;
    FCFS2: number;
  }>;
  generatedAt: string;
};

type UserRecord = {
  id: string;
  xUserId: string;
  xUsername: string;
  xName: string;
  spinsEarned: number;
  spinsAvailable: number;
  spinsUsed: number;
  points: number;
  pointsSpent: number;
  pointsAvailable: number;
  totalWins: number;
  roleWins: Record<PrizeType, number>;
  referralCode: string | null;
  referralCount: number;
  createdAt: string;
  lastSeenAt: string;
  lastSpinAt: string | null;
};

type WinRecord = {
  id: string;
  xUserId: string;
  xUsername: string;
  xName: string;
  prizeType: PrizeType;
  wonAt: string;
  wallet: string | null;
  walletSubmittedAt: string | null;
  walletStatus: "submitted" | "waiting";
  source: "wheel" | "shop" | "bunny";
  shopSpotType: "GTD" | "FCFS" | null;
  bunnyRewardType: "GTD" | "FCFS" | null;
};

type ReferralRecord = {
  id: string;
  referrerUsername: string;
  referrerXUserId: string;
  referredUsername: string;
  referredXUserId: string;
  referralCode: string;
  awardedSpins: number;
  createdAt: string;
};

type RecordsPage = {
  view: RecordView;
  page: number;
  pageSize: number;
  total: number;
  rows: Array<UserRecord | WinRecord | ReferralRecord>;
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

const numberFormat = new Intl.NumberFormat("en-US");

function formatNumber(value: number) {
  return numberFormat.format(Number(value || 0));
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

export function SpinAdminApp() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [records, setRecords] = useState<RecordsPage | null>(null);
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
  const [shopPostText, setShopPostText] = useState("I am earning my way into the Bunny Hood. @BunnysHood");
  const [postTaskRequiresTag, setPostTaskRequiresTag] = useState(true);
  const [bunnyStreakDays, setBunnyStreakDays] = useState("7");
  const [bunnyDeathOnBreak, setBunnyDeathOnBreak] = useState(false);
  const [bunnyGtdEnabled, setBunnyGtdEnabled] = useState(false);
  const [bunnyGtdRequirementMode, setBunnyGtdRequirementMode] = useState<"days" | "points" | "both">("both");
  const [bunnyGtdStreakDays, setBunnyGtdStreakDays] = useState("30");
  const [bunnyGtdPointsRequired, setBunnyGtdPointsRequired] = useState("100");
  const [engagementBusy, setEngagementBusy] = useState(false);
  const [gtdShopPrice, setGtdShopPrice] = useState("100");
  const [gtdShopPool, setGtdShopPool] = useState("0");
  const [fcfsShopPrice, setFcfsShopPrice] = useState("50");
  const [fcfsShopPool, setFcfsShopPool] = useState("0");
  const [shopBusy, setShopBusy] = useState(false);
  const [startNewCampaign, setStartNewCampaign] = useState(false);
  const [recordView, setRecordView] = useState<RecordView>("users");
  const [recordPage, setRecordPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [recordSearch, setRecordSearch] = useState("");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("wins");
  const [busy, setBusy] = useState(false);
  const [recordsBusy, setRecordsBusy] = useState(false);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState<"changes" | "submissions" | null>(null);
  const [message, setMessage] = useState("");
  const loadedShopCampaign = useRef<string | null>(null);
  const loadedEngagementSettings = useRef(false);

  const loadDashboard = useCallback(async () => {
    try {
      const data = await adminRequest<Dashboard>("/api/admin/spin/dashboard");
      setDashboard(data);
      if (!loadedEngagementSettings.current) {
        loadedEngagementSettings.current = true;
        setShopPostText(data.settings.postTaskText);
        setPostTaskRequiresTag(data.settings.postTaskRequiresTag);
        setBunnyStreakDays(String(data.settings.bunnyStreakDays));
        setBunnyDeathOnBreak(data.settings.bunnyDeathOnBreak);
        setBunnyGtdEnabled(data.settings.bunnyGtdEnabled);
        setBunnyGtdRequirementMode(data.settings.bunnyGtdRequirementMode);
        setBunnyGtdStreakDays(String(data.settings.bunnyGtdStreakDays));
        setBunnyGtdPointsRequired(String(data.settings.bunnyGtdPointsRequired));
      }
      if (data.campaign && loadedShopCampaign.current !== data.campaign.id) {
        loadedShopCampaign.current = data.campaign.id;
        const gtd = data.shop.find((item) => item.spotType === "GTD");
        const fcfs = data.shop.find((item) => item.spotType === "FCFS");
        if (gtd) {
          setGtdShopPrice(String(gtd.pointsPrice));
          setGtdShopPool(String(gtd.totalCount));
        }
        if (fcfs) {
          setFcfsShopPrice(String(fcfs.pointsPrice));
          setFcfsShopPool(String(fcfs.totalCount));
        }
      }
      setNeedsLogin(false);
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status === 401) {
        setDashboard(null);
        setNeedsLogin(true);
      } else {
        setMessage(error instanceof Error ? error.message : "Dashboard could not be loaded.");
      }
    }
  }, []);

  const loadRecords = useCallback(async () => {
    setRecordsBusy(true);
    try {
      const params = new URLSearchParams({ view: recordView, page: String(recordPage), pageSize: "25", search: recordSearch });
      const data = await adminRequest<RecordsPage>(`/api/admin/spin/records?${params.toString()}`);
      setRecords(data);
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status === 401) {
        setDashboard(null);
        setNeedsLogin(true);
      } else {
        setMessage(error instanceof Error ? error.message : "Records could not be loaded.");
      }
    } finally {
      setRecordsBusy(false);
    }
  }, [recordPage, recordSearch, recordView]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadDashboard(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadDashboard]);

  const signedIn = Boolean(dashboard && !needsLogin);
  useEffect(() => {
    if (!signedIn) return;
    const initialRecords = window.setTimeout(() => void loadRecords(), 0);
    const refresh = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadDashboard();
      void loadRecords();
    }, 5_000);
    return () => {
      window.clearTimeout(initialRecords);
      window.clearInterval(refresh);
    };
  }, [loadDashboard, loadRecords, signedIn]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 6_000);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await adminRequest("/api/admin/spin/login", { method: "POST", body: JSON.stringify({ password }) });
      setPassword("");
      const next = new URLSearchParams(window.location.search).get("next");
      if (next === "/RabbitHole" || next === "/admin/rabbit-hole" || next === "/admin/waitlist" || next === "/admin/checker") {
        window.location.assign(next);
        return;
      }
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
          shopPostText,
          startNewCampaign: !dashboard?.campaign || startNewCampaign,
        }),
      });
      setTweetUrl("");
      setRedeemCode("");
      setEndsAt("");
      setStartNewCampaign(false);
      setMessage(startNewCampaign || !dashboard?.campaign
        ? "New 20-day campaign is live with its private prize pool."
        : "New daily round is live. Permanent user balances and the prize pool were preserved.");
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Campaign could not be published.");
    } finally {
      setBusy(false);
    }
  }

  async function saveShop(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShopBusy(true);
    setMessage("");
    try {
      await adminRequest("/api/admin/spin/shop", {
        method: "POST",
        body: JSON.stringify({
          GTD: { pointsPrice: Number(gtdShopPrice), totalCount: Number(gtdShopPool) },
          FCFS: { pointsPrice: Number(fcfsShopPrice), totalCount: Number(fcfsShopPool) },
        }),
      });
      setMessage("Points shop prices and campaign inventory are live.");
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Shop settings could not be saved.");
    } finally {
      setShopBusy(false);
    }
  }

  async function saveEngagementSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEngagementBusy(true);
    setMessage("");
    try {
      const response = await adminRequest<{ settings: Dashboard["settings"] }>("/api/admin/spin/engagement-settings", {
        method: "POST",
        body: JSON.stringify({
          postTaskText: shopPostText,
          postTaskRequiresTag,
          bunnyStreakDays: Number(bunnyStreakDays),
          bunnyDeathOnBreak,
          bunnyGtdEnabled,
          bunnyGtdRequirementMode,
          bunnyGtdStreakDays: Number(bunnyGtdStreakDays),
          bunnyGtdPointsRequired: Number(bunnyGtdPointsRequired),
        }),
      });
      setShopPostText(response.settings.postTaskText);
      setPostTaskRequiresTag(response.settings.postTaskRequiresTag);
      setBunnyStreakDays(String(response.settings.bunnyStreakDays));
      setBunnyDeathOnBreak(response.settings.bunnyDeathOnBreak);
      setBunnyGtdEnabled(response.settings.bunnyGtdEnabled);
      setBunnyGtdRequirementMode(response.settings.bunnyGtdRequirementMode);
      setBunnyGtdStreakDays(String(response.settings.bunnyGtdStreakDays));
      setBunnyGtdPointsRequired(String(response.settings.bunnyGtdPointsRequired));
      setMessage("Daily post and Bunny evolution settings are live.");
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Engagement settings could not be saved.");
    } finally {
      setEngagementBusy(false);
    }
  }

  async function logout() {
    await adminRequest("/api/admin/spin/logout", { method: "POST", body: "{}" }).catch(() => undefined);
    setDashboard(null);
    setRecords(null);
    setNeedsLogin(true);
  }

  async function toggleWalletChanges() {
    setSettingsBusy("changes");
    setMessage("");
    const allowWalletChanges = !dashboard?.settings.allowWalletChanges;
    try {
      await adminRequest("/api/admin/spin/settings", { method: "POST", body: JSON.stringify({ allowWalletChanges }) });
      setMessage(allowWalletChanges ? "Users can now replace or remove submitted wallets." : "Saved wallets are now locked for every user.");
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
      await adminRequest("/api/admin/spin/settings", { method: "POST", body: JSON.stringify({ allowWalletSubmissions }) });
      setMessage(allowWalletSubmissions ? "Winners can now submit wallets. Existing wins remain available." : "Wallet submission is paused. Every win and saved wallet remains permanent.");
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Wallet submission permission could not be updated.");
    } finally {
      setSettingsBusy(null);
    }
  }

  async function runMaintenance() {
    setMaintenanceBusy(true);
    setMessage("");
    try {
      const response = await adminRequest<{ result: { rawEventsArchived: number; batchesRemoved: number } }>("/api/admin/spin/maintenance", { method: "POST", body: "{}" });
      setMessage(`Storage cleanup completed: ${formatNumber(response.result.rawEventsArchived)} raw events archived and ${formatNumber(response.result.batchesRemoved)} expired request batches removed. Permanent balances, referrals, wins, and wallets were untouched.`);
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Storage maintenance could not be completed.");
    } finally {
      setMaintenanceBusy(false);
    }
  }

  function searchRecords(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRecordPage(1);
    setRecordSearch(searchInput.trim());
  }

  function changeRecordView(view: RecordView) {
    setRecordView(view);
    setRecordPage(1);
    setRecords(null);
  }

  const pageCount = useMemo(() => Math.max(1, Math.ceil((records?.total ?? 0) / (records?.pageSize ?? 25))), [records]);
  const exportHref = exportFormat === "xlsx"
    ? "/api/admin/spin/export"
    : `/api/admin/spin/export/csv?view=${exportFormat}`;
  const exportLabel = exportFormat === "xlsx" ? "Download Excel" : "Download CSV";
  const exportControls = (
    <div className="admin-export-controls">
      <label>Export format</label>
      <select aria-label="Export format" value={exportFormat} onChange={(event) => setExportFormat(event.target.value as ExportFormat)}>
        <option value="wins">Wins &amp; wallets · CSV</option>
        <option value="users">All users · CSV</option>
        <option value="referrals">Referrals · CSV</option>
        <option value="daily">Daily activity · CSV</option>
        <option value="xlsx">Complete workbook · Excel</option>
      </select>
      <a className="admin-export-button" href={exportHref}>{exportLabel}</a>
    </div>
  );

  if (needsLogin) {
    return (
      <main className="spin-admin-page"><div className="spin-admin-shell">
        <div className="spin-admin-brand"><strong>BUNNY HOOD · DATA ADMIN</strong><div><a href="/admin/rabbit-hole">Eligibility manager</a><a href="/RabbitHole">Rabbit Hole</a><a href="/SpinTheWheel">Open wheel</a></div></div>
        <section className="admin-login"><div className="admin-card">
          <p className="section-kicker">PRIVATE CONTROL ROOM</p><h1>Admin sign in.</h1>
          <p>Manage campaigns, Rabbit Hole SBT eligibility, wallet permissions, permanent Neon records, storage health, and private exports.</p>
          <form onSubmit={login}><div className="admin-field"><label htmlFor="admin-password">Admin password</label><input id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" /></div><button className="admin-submit" disabled={busy}>{busy ? "Checking…" : "Enter control room"}</button></form>
          {message && <p className="spin-error">{message}</p>}
        </div></section>
      </div></main>
    );
  }

  if (!dashboard) return <main className="spin-admin-page"><div className="spin-loading">Loading secure records…</div></main>;

  const integrityHealthy = dashboard.integrity.accountingMismatches === 0 && dashboard.integrity.winMismatches === 0;

  return (
    <main className="spin-admin-page"><div className="spin-admin-shell">
      <div className="spin-admin-brand"><strong>BUNNY HOOD · DATA ADMIN</strong><div><span className="admin-live"><i /> LIVE · 5S</span><a href="/admin/rabbit-hole">Eligibility manager</a><a href="/RabbitHole">Rabbit Hole</a><a href="/SpinTheWheel">Open wheel</a><button onClick={logout} type="button">Sign out</button></div></div>
      <section className="admin-dashboard">
        <header><div><p className="section-kicker">PRIVATE CONTROL ROOM</p><h1>Run the Hood.<br /><em>Know the data.</em></h1></div><div className="admin-header-actions"><span>Last refresh · {new Date(dashboard.generatedAt).toLocaleTimeString()}</span>{exportControls}</div></header>

        <div className="admin-stats admin-stats-expanded">
          <div><span>UNIQUE X USERS</span><strong>{formatNumber(dashboard.totals.users)}</strong></div><div><span>ACTIVE · 24H</span><strong>{formatNumber(dashboard.totals.active24h)}</strong></div><div><span>SPINS EARNED</span><strong>{formatNumber(dashboard.totals.spinsEarned)}</strong></div><div><span>SPINS LEFT</span><strong>{formatNumber(dashboard.totals.spinsAvailable)}</strong></div><div><span>SPINS USED</span><strong>{formatNumber(dashboard.totals.spinsUsed)}</strong></div><div><span>POINTS EARNED</span><strong>{formatNumber(dashboard.totals.points)}</strong></div><div><span>POINTS SPENT</span><strong>{formatNumber(dashboard.totals.pointsSpent)}</strong></div><div><span>POINTS AVAILABLE</span><strong>{formatNumber(dashboard.totals.pointsAvailable)}</strong></div><div><span>AVG · ALL USERS</span><strong>{formatNumber(Math.round(dashboard.totals.averagePoints))}</strong></div><div><span>AVG · HOLDERS</span><strong>{formatNumber(Math.round(dashboard.totals.averageHolderPoints))}</strong></div><div><span>POINT HOLDERS</span><strong>{formatNumber(dashboard.totals.pointHolders)}</strong></div><div><span>TOTAL WINS</span><strong>{formatNumber(dashboard.totals.wins)}</strong></div><div><span>WAITING FOR WALLET</span><strong>{formatNumber(dashboard.totals.pendingWallets)}</strong></div><div><span>REFERRALS</span><strong>{formatNumber(dashboard.totals.referrals)}</strong></div>
        </div>

        {dashboard.storage.safetyPaused && <div className="admin-storage-pause"><strong>PUBLIC MECHANICS PAUSED</strong><span>The database reached the 490 MB safety limit. Public writes are blocked while every permanent record remains available here. Export records, run cleanup, or increase Neon storage.</span></div>}

        <div className="admin-quick-controls">
          <section className="admin-panel"><p className="section-kicker">WALLET SUBMISSIONS</p><h2>{dashboard.settings.allowWalletSubmissions ? "Submissions open" : "Submissions paused"}</h2><p className="admin-note">Pause or reopen new wallet submissions without changing any permanent win.</p><button className="admin-secondary-button" type="button" disabled={settingsBusy !== null} onClick={toggleWalletSubmissions}>{settingsBusy === "submissions" ? "Updating…" : dashboard.settings.allowWalletSubmissions ? "Pause wallet submissions" : "Allow wallet submissions"}</button></section>
          <section className="admin-panel"><p className="section-kicker">WALLET CHANGES</p><h2>{dashboard.settings.allowWalletChanges ? "Changes enabled" : "Wallets locked"}</h2><p className="admin-note">Removed and replaced wallet hashes remain protected so the same wallet cannot be reused for another win.</p><button className="admin-secondary-button" type="button" disabled={settingsBusy !== null} onClick={toggleWalletChanges}>{settingsBusy === "changes" ? "Updating…" : dashboard.settings.allowWalletChanges ? "Lock wallet changes" : "Allow wallet changes"}</button></section>
          <section className="admin-panel"><p className="section-kicker">DATA RETENTION</p><h2>{formatNumber(dashboard.storage.rawEvents)} raw events</h2><p className="admin-note">Raw technical spin logs are compacted after {dashboard.storage.rawRetentionHours} hours. Permanent totals, points, balances, referrals, roles, and wallets are never deleted.</p><button className="admin-secondary-button" type="button" disabled={maintenanceBusy} onClick={runMaintenance}>{maintenanceBusy ? "Cleaning…" : "Run safe cleanup now"}</button></section>
        </div>

        <div className="admin-health-grid">
          <section className="admin-panel admin-storage-card"><p className="section-kicker">DATABASE HEALTH</p><h2>{formatBytes(dashboard.storage.databaseBytes)}</h2><div className="admin-health-list"><div><span>Automatic safety limit</span><strong>{formatBytes(dashboard.storage.safetyLimitBytes)}</strong></div><div><span>Space before public pause</span><strong className={dashboard.storage.safetyPaused ? "warning" : "healthy"}>{formatBytes(dashboard.storage.remainingBeforePause)}</strong></div><div><span>Permanent attempt totals</span><strong>{formatNumber(dashboard.storage.recordedAttempts)}</strong></div><div><span>Last cleanup</span><strong>{formatDate(dashboard.storage.lastMaintenanceAt)}</strong></div><div><span>Technical rows removed</span><strong>{formatNumber(dashboard.storage.lastArchived)}</strong></div><div><span>Accounting integrity</span><strong className={integrityHealthy ? "healthy" : "warning"}>{integrityHealthy ? "VERIFIED" : "CHECK REQUIRED"}</strong></div></div></section>
          <section className="admin-panel"><p className="section-kicker">PERMANENT ROLE LEDGER</p><h2>{formatNumber(dashboard.totals.wins)} wins stored</h2><div className="admin-role-ledger"><div><span>GTD</span><strong>{formatNumber(dashboard.totals.roleWins.GTD)}</strong></div><div><span>FCFS1</span><strong>{formatNumber(dashboard.totals.roleWins.FCFS1)}</strong></div><div><span>FCFS2</span><strong>{formatNumber(dashboard.totals.roleWins.FCFS2)}</strong></div></div><p className="admin-note">Role ownership is read from permanent win rows, not temporary wheel animation data.</p></section>
        </div>

        <section className="admin-panel admin-engagement-control">
          <div className="admin-panel-heading">
            <div><p className="section-kicker">DAILY ENGAGEMENT SETTINGS</p><h2>Posts, carrots &amp; evolution.</h2><p className="admin-note">These controls update immediately without publishing a new campaign round. Carrots always cost 3 points and each connected user can feed once per UTC day.</p></div>
            <span>RESET · 00:00 UTC</span>
          </div>
          <div className="admin-engagement-layout">
            <form onSubmit={saveEngagementSettings}>
              <div className="admin-field"><label htmlFor="shop-post-text">Default verified X post</label><textarea id="shop-post-text" value={shopPostText} onChange={(event) => setShopPostText(event.target.value)} maxLength={260} rows={5} required /><small>{shopPostText.length}/260 characters · This text opens in the user&apos;s X composer. A verified post still must come from the X account connected to Spin the Wheel.</small></div>
              <label className="admin-new-campaign-toggle"><input type="checkbox" checked={postTaskRequiresTag} onChange={(event) => setPostTaskRequiresTag(event.target.checked)} /><span><strong>Require the @BunnysHood tag</strong><small>When enabled, the tag is appended to your saved text if omitted and must be present in the submitted public post. Turn this off to make the tag optional.</small></span></label>
              <div className="admin-field"><label htmlFor="bunny-streak-days">Evolution days to unlock FCFS</label><input id="bunny-streak-days" type="number" min="1" max="365" value={bunnyStreakDays} onChange={(event) => setBunnyStreakDays(event.target.value)} required /><small>At this evolution day, the user can sell the Bunny for FCFS or keep feeding it. Selling creates a permanent wallet-ready win and starts a new Bunny cycle.</small></div>
              <label className="admin-new-campaign-toggle admin-bunny-danger-toggle"><input type="checkbox" checked={bunnyDeathOnBreak} onChange={(event) => setBunnyDeathOnBreak(event.target.checked)} /><span><strong>Broken UTC streak kills and resets the Bunny</strong><small>When enabled, missing a complete UTC feed day resets that Bunny to day 0. Its next carrot starts a fresh cycle and the user sees a hunger message. Leave disabled to preserve evolution through missed days.</small></span></label>
              <div className="admin-private-gtd">
                <p>PRIVATE FUTURE REWARD</p>
                <label className="admin-new-campaign-toggle"><input type="checkbox" checked={bunnyGtdEnabled} onChange={(event) => setBunnyGtdEnabled(event.target.checked)} /><span><strong>Enable private GTD Bunny exchange</strong><small>Users never see GTD in Feed the Bunny until this is enabled and their own Bunny meets the private rule.</small></span></label>
                <div className="admin-field"><label htmlFor="bunny-gtd-mode">GTD requirement</label><select id="bunny-gtd-mode" value={bunnyGtdRequirementMode} onChange={(event) => setBunnyGtdRequirementMode(event.target.value as "days" | "points" | "both")} disabled={!bunnyGtdEnabled}><option value="days">Evolution days</option><option value="points">Available points</option><option value="both">Evolution days + available points</option></select></div>
                <div className="admin-private-gtd-grid">
                  <div className="admin-field"><label htmlFor="bunny-gtd-days">GTD evolution days</label><input id="bunny-gtd-days" type="number" min="1" max="365" value={bunnyGtdStreakDays} onChange={(event) => setBunnyGtdStreakDays(event.target.value)} disabled={!bunnyGtdEnabled || bunnyGtdRequirementMode === "points"} required /><small>Used for Days or Both.</small></div>
                  <div className="admin-field"><label htmlFor="bunny-gtd-points">Minimum available points</label><input id="bunny-gtd-points" type="number" min="0" max="1000000000" value={bunnyGtdPointsRequired} onChange={(event) => setBunnyGtdPointsRequired(event.target.value)} disabled={!bunnyGtdEnabled || bunnyGtdRequirementMode === "days"} required /><small>Used for Points or Both. Eligibility checks the balance; these points are not deducted.</small></div>
                </div>
              </div>
              <button className="admin-submit" disabled={engagementBusy}>{engagementBusy ? "Saving…" : "Save engagement settings"}</button>
            </form>
            <aside className="admin-bunny-stats">
              <div><span>CARROTS FED · ALL TIME</span><strong>{formatNumber(dashboard.bunny.totalFeeds)}</strong></div>
              <div><span>FED TODAY · UTC</span><strong>{formatNumber(dashboard.bunny.fedToday)}</strong></div>
              <div><span>READY FOR FCFS</span><strong>{formatNumber(dashboard.bunny.fcfsReady)}</strong></div>
              <div><span>READY FOR GTD · PRIVATE</span><strong>{formatNumber(dashboard.bunny.gtdReady)}</strong></div>
              <div><span>DIED FROM BROKEN STREAK</span><strong>{formatNumber(dashboard.bunny.deadBunnies)}</strong></div>
              <div><span>RECORDED BUNNY DEATHS</span><strong>{formatNumber(dashboard.bunny.totalDeaths)}</strong></div>
              <div><span>COMPLETED TRADES</span><strong>{formatNumber(dashboard.bunny.totalTrades)}</strong></div>
              <div><span>GTD / FCFS TRADES</span><strong>{formatNumber(dashboard.bunny.gtdTrades)} / {formatNumber(dashboard.bunny.fcfsTrades)}</strong></div>
              <div><span>LONGEST STREAK</span><strong>{formatNumber(dashboard.bunny.longestStreak)}D</strong></div>
            </aside>
          </div>
        </section>

        <section className="admin-panel admin-shop-control">
          <div className="admin-panel-heading"><div><p className="section-kicker">CAMPAIGN POINTS SHOP</p><h2>Price the access.</h2><p className="admin-note">Pool totals can be raised at any time. They cannot be lowered below completed purchases. A zero pool keeps that product closed.</p></div><span>{dashboard.campaign ? `ROUND ${dashboard.campaign.roundNumber}` : "NO LIVE CAMPAIGN"}</span></div>
          <form className="admin-shop-form" onSubmit={saveShop}>
            <article><strong>GTD · GUARANTEED WL</strong><div className="admin-prize-grid"><div className="admin-field"><label htmlFor="shop-gtd-price">Points price</label><input id="shop-gtd-price" type="number" min="1" max="1000000000" value={gtdShopPrice} onChange={(event) => setGtdShopPrice(event.target.value)} required /></div><div className="admin-field"><label htmlFor="shop-gtd-pool">Campaign pool</label><input id="shop-gtd-pool" type="number" min="0" max="100000" value={gtdShopPool} onChange={(event) => setGtdShopPool(event.target.value)} required /></div></div><small>{dashboard.shop.find((item) => item.spotType === "GTD")?.purchasedCount ?? 0} purchased</small></article>
            <article><strong>FCFS</strong><div className="admin-prize-grid"><div className="admin-field"><label htmlFor="shop-fcfs-price">Points price</label><input id="shop-fcfs-price" type="number" min="1" max="1000000000" value={fcfsShopPrice} onChange={(event) => setFcfsShopPrice(event.target.value)} required /></div><div className="admin-field"><label htmlFor="shop-fcfs-pool">Campaign pool</label><input id="shop-fcfs-pool" type="number" min="0" max="100000" value={fcfsShopPool} onChange={(event) => setFcfsShopPool(event.target.value)} required /></div></div><small>{dashboard.shop.find((item) => item.spotType === "FCFS")?.purchasedCount ?? 0} purchased</small></article>
            <button className="admin-submit" disabled={shopBusy || !dashboard.campaign}>{shopBusy ? "Saving…" : "Publish shop settings"}</button>
          </form>
        </section>

        <section className="admin-panel admin-referral-leaderboard">
          <div className="admin-panel-heading"><div><p className="section-kicker">PRIVATE POINT LEDGER</p><h2>Top 100 point balances</h2><p className="admin-note">Ranked by spendable balance, with earned and spent totals retained for audit.</p></div><span>{formatNumber(dashboard.topPointUsers.length)} shown</span></div>
          <div className="admin-table-wrap"><table className="admin-data-table compact"><thead><tr><th>Rank</th><th>User</th><th>X ID</th><th>Available</th><th>Earned</th><th>Spent</th></tr></thead><tbody>{dashboard.topPointUsers.map((user) => <tr key={user.id}><td><strong>#{user.rank}</strong></td><td><strong>@{user.xUsername}</strong><small>{user.xName}</small></td><td>{user.xUserId}</td><td><strong className="admin-referral-count">{formatNumber(user.pointsAvailable)}</strong></td><td>{formatNumber(user.pointsEarned)}</td><td>{formatNumber(user.pointsSpent)}</td></tr>)}</tbody></table></div>
        </section>

        <section className="admin-panel admin-referral-leaderboard">
          <div className="admin-panel-heading"><div><p className="section-kicker">PRIVATE REFERRAL LEADERBOARD</p><h2>Top 15 referrers</h2><p className="admin-note">Ranked by successful permanent referral records. Ties use the most recent successful referral.</p></div><a className="admin-export-button" href="/api/admin/spin/export/csv?view=referrals">Download all referrals</a></div>
          <div className="admin-table-wrap"><table className="admin-data-table compact"><thead><tr><th>Rank</th><th>User</th><th>X ID</th><th>Referral code</th><th>Successful referrals</th><th>Spins awarded</th><th>Latest referral</th></tr></thead><tbody>{dashboard.topReferrers.map((user) => <tr key={user.xUserId}><td><strong>#{user.rank}</strong></td><td><strong>@{user.xUsername}</strong><small>{user.xName}</small></td><td>{user.xUserId}</td><td>{user.referralCode || "—"}</td><td><strong className="admin-referral-count">{formatNumber(user.referralCount)}</strong></td><td>+{formatNumber(user.awardedSpins)}</td><td>{formatDate(user.lastReferralAt)}</td></tr>)}</tbody></table>{dashboard.topReferrers.length === 0 && <div className="admin-empty">No successful referrals recorded yet.</div>}</div>
        </section>

        <div className="admin-grid">
          <section className="admin-panel"><h2>Current campaign</h2>{dashboard.campaign ? <div className="admin-campaign-data"><div><span>Title</span><strong>{dashboard.campaign.title}</strong></div><div><span>Tweet</span><strong>{dashboard.campaign.tweetUrl.replace(/^https:\/\//, "")}</strong></div><div><span>Expected unique users</span><strong>{formatNumber(dashboard.campaign.expectedUsers)}</strong></div><div><span>Expected spins per user</span><strong>{formatNumber(dashboard.campaign.expectedSpinsPerUser)}</strong></div><div><span>Unique draw entrants</span><strong>{formatNumber(dashboard.campaign.participantsSeen)}</strong></div><div><span>Unique winners selected</span><strong>{formatNumber(dashboard.campaign.winnersSelected)}</strong></div><div><span>Permanent attempts counter</span><strong>{formatNumber(dashboard.campaign.spinsProcessed)}</strong></div><div><span>Current daily round</span><strong>#{dashboard.campaign.roundNumber}</strong></div><div><span>Ends</span><strong>{new Date(dashboard.campaign.endsAt).toLocaleString()}</strong></div>{dashboard.inventory.map((item) => <div key={item.prizeType}><span>{item.prizeType}</span><strong>{formatNumber(item.claimed)} / {formatNumber(item.total)} claimed</strong></div>)}</div> : <p className="admin-note">No live campaign. Publish one using the form.</p>}<p className="admin-note">Daily tweet/code updates preserve every user balance and this campaign&apos;s private prize pool. Prize totals remain visible only here.</p></section>
          <section className="admin-panel"><h2>Publish campaign update</h2><form onSubmit={publish}>
            <div className="admin-field"><label htmlFor="campaign-title">Campaign title</label><input id="campaign-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} required /></div><div className="admin-field"><label htmlFor="campaign-tweet">Full X post URL</label><input id="campaign-tweet" type="url" value={tweetUrl} onChange={(event) => setTweetUrl(event.target.value)} placeholder="https://x.com/BunnysHood/status/..." required /></div><div className="admin-field"><label htmlFor="campaign-code">New redeem code</label><input id="campaign-code" value={redeemCode} onChange={(event) => setRedeemCode(event.target.value)} minLength={4} maxLength={64} placeholder="BUNNY-XXXX" required autoComplete="off" /></div>
            {dashboard.campaign && <label className="admin-new-campaign-toggle"><input type="checkbox" checked={startNewCampaign} onChange={(event) => setStartNewCampaign(event.target.checked)} /><span><strong>Start a completely new 20-day campaign</strong><small>Leave off for a daily tweet/code update. A new pool never resets users, points, referrals, balances, or past wins.</small></span></label>}
            <div className="admin-field"><label htmlFor="campaign-users">Expected unique users</label><input id="campaign-users" type="number" min="10" max="1000000" value={expectedUsers} onChange={(event) => setExpectedUsers(event.target.value)} disabled={Boolean(dashboard.campaign) && !startNewCampaign} required /></div><div className="admin-prize-grid"><div className="admin-field"><label htmlFor="campaign-gtd">Total GTD</label><input id="campaign-gtd" type="number" min="1" max="100000" value={gtdCount} onChange={(event) => setGtdCount(event.target.value)} disabled={Boolean(dashboard.campaign) && !startNewCampaign} required /></div><div className="admin-field"><label htmlFor="campaign-fcfs1">Total FCFS1</label><input id="campaign-fcfs1" type="number" min="1" max="100000" value={fcfs1Count} onChange={(event) => setFcfs1Count(event.target.value)} disabled={Boolean(dashboard.campaign) && !startNewCampaign} required /></div><div className="admin-field"><label htmlFor="campaign-fcfs2">Total FCFS2</label><input id="campaign-fcfs2" type="number" min="1" max="100000" value={fcfs2Count} onChange={(event) => setFcfs2Count(event.target.value)} disabled={Boolean(dashboard.campaign) && !startNewCampaign} required /></div></div><p className="admin-note">Private unique-winner target: <strong>{formatNumber(Number(gtdCount || 0) + Number(fcfs1Count || 0) + Number(fcfs2Count || 0))}</strong>. Across the expected unique users, the draw fills exactly these role totals. Public pages never display inventory numbers.</p><div className="admin-field"><label htmlFor="campaign-end">Optional end time (new campaigns default to 20 days)</label><input id="campaign-end" type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} disabled={Boolean(dashboard.campaign) && !startNewCampaign} /></div><button className="admin-submit" disabled={busy}>{busy ? "Publishing…" : dashboard.campaign && !startNewCampaign ? "Publish daily update" : "Start 20-day campaign"}</button>
          </form></section>
        </div>

        <section className="admin-panel admin-activity-panel"><div className="admin-panel-heading"><div><p className="section-kicker">14-DAY VIEW</p><h2>Daily wheel activity</h2></div><span>UTC</span></div><div className="admin-table-wrap"><table className="admin-data-table compact"><thead><tr><th>Day</th><th>Attempts</th><th>Used</th><th>Returned</th><th>No prize</th><th>GTD</th><th>FCFS1</th><th>FCFS2</th></tr></thead><tbody>{dashboard.daily.map((day) => <tr key={day.day}><td>{day.day}</td><td>{formatNumber(day.attempts)}</td><td>{formatNumber(day.spinsConsumed)}</td><td>{formatNumber(day.spinsRefunded)}</td><td>{formatNumber(day.noPrize)}</td><td>{formatNumber(day.GTD)}</td><td>{formatNumber(day.FCFS1)}</td><td>{formatNumber(day.FCFS2)}</td></tr>)}</tbody></table></div></section>

        <section className="admin-panel admin-records-panel">
          <div className="admin-records-heading"><div><p className="section-kicker">LIVE NEON RECORDS</p><h2>Search the Hood.</h2><p>Choose an individual CSV for reliable large exports and easy viewing in Google Sheets, Excel, mobile, or desktop. The complete Excel workbook combines every table for normal-sized snapshots. X access tokens and private server secrets are never exported.</p></div>{exportControls}</div>
          <div className="admin-record-toolbar"><div className="admin-record-tabs">{(["users", "wins", "referrals"] as RecordView[]).map((view) => <button className={recordView === view ? "active" : ""} type="button" key={view} onClick={() => changeRecordView(view)}>{view}</button>)}</div><form onSubmit={searchRecords}><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={recordView === "wins" ? "Search username, wallet or role" : "Search username, X ID or code"} /><button type="submit">Search</button></form></div>
          <div className={`admin-table-wrap ${recordsBusy ? "loading" : ""}`}>
            {recordView === "users" && <table className="admin-data-table"><thead><tr><th>User</th><th>X ID</th><th>Available pts</th><th>Earned pts</th><th>Spent pts</th><th>Spins earned</th><th>Spins left</th><th>Used</th><th>Roles</th><th>Referrals</th><th>Last seen</th></tr></thead><tbody>{(records?.rows as UserRecord[] | undefined)?.map((user) => <tr key={user.id}><td><strong>@{user.xUsername}</strong><small>{user.xName}</small></td><td>{user.xUserId}</td><td><strong>{formatNumber(user.pointsAvailable)}</strong></td><td>{formatNumber(user.points)}</td><td>{formatNumber(user.pointsSpent)}</td><td>{formatNumber(user.spinsEarned)}</td><td>{formatNumber(user.spinsAvailable)}</td><td>{formatNumber(user.spinsUsed)}</td><td>G {user.roleWins.GTD} · F1 {user.roleWins.FCFS1} · F2 {user.roleWins.FCFS2}</td><td>{formatNumber(user.referralCount)}<small>{user.referralCode || "—"}</small></td><td>{formatDate(user.lastSeenAt)}</td></tr>)}</tbody></table>}
            {recordView === "wins" && <table className="admin-data-table"><thead><tr><th>Winner</th><th>Role</th><th>Source</th><th>Won at</th><th>Wallet status</th><th>Wallet</th><th>Submitted at</th></tr></thead><tbody>{(records?.rows as WinRecord[] | undefined)?.map((win) => <tr key={win.id}><td><strong>@{win.xUsername}</strong><small>{win.xUserId}</small></td><td><strong className="role-value">{win.bunnyRewardType ?? win.shopSpotType ?? win.prizeType}</strong></td><td>{win.source === "shop" ? "POINTS SHOP" : win.source === "bunny" ? "BUNNY TRADE" : "WHEEL"}</td><td>{formatDate(win.wonAt)}</td><td><span className={`admin-status ${win.walletStatus}`}>{win.walletStatus}</span></td><td className="wallet-cell">{win.wallet || "—"}</td><td>{formatDate(win.walletSubmittedAt)}</td></tr>)}</tbody></table>}
            {recordView === "referrals" && <table className="admin-data-table"><thead><tr><th>Referrer</th><th>New user</th><th>Code</th><th>Spins</th><th>Created at</th></tr></thead><tbody>{(records?.rows as ReferralRecord[] | undefined)?.map((referral) => <tr key={referral.id}><td><strong>@{referral.referrerUsername}</strong><small>{referral.referrerXUserId}</small></td><td><strong>@{referral.referredUsername}</strong><small>{referral.referredXUserId}</small></td><td>{referral.referralCode}</td><td>+{referral.awardedSpins}</td><td>{formatDate(referral.createdAt)}</td></tr>)}</tbody></table>}
            {!recordsBusy && records?.rows.length === 0 && <div className="admin-empty">No matching {recordView} found.</div>}
          </div>
          <div className="admin-pagination"><span>{formatNumber(records?.total ?? 0)} records · page {recordPage} of {pageCount}</span><div><button type="button" disabled={recordPage <= 1} onClick={() => setRecordPage((current) => Math.max(1, current - 1))}>Previous</button><button type="button" disabled={recordPage >= pageCount} onClick={() => setRecordPage((current) => Math.min(pageCount, current + 1))}>Next</button></div></div>
        </section>

        <section className="admin-panel admin-table-sizes"><div className="admin-panel-heading"><div><p className="section-kicker">STORAGE BREAKDOWN</p><h2>Largest data tables</h2></div><span>Estimated live rows</span></div><div className="admin-size-grid">{dashboard.storage.tables.map((table) => <div key={table.name}><span>{table.name}</span><strong>{formatBytes(table.bytes)}</strong><small>{formatNumber(table.estimatedRows)} rows</small></div>)}</div></section>
      </section>
    </div>{message && <div className="spin-message" role="status">{message}</div>}</main>
  );
}
