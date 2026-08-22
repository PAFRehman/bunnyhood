import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const skipped = new Set([".git", ".next", "node_modules"]);
const textExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".sql", ".example", ".gs"]);

function filesIn(directory) {
  return readdirSync(directory).flatMap((name) => {
    if (skipped.has(name)) return [];
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesIn(path) : [path];
  });
}

const files = filesIn(root).filter((path) => {
  if (relative(root, path) === "scripts/security-check.mjs") return false;
  const name = path.slice(path.lastIndexOf("/"));
  const extension = path.slice(path.lastIndexOf("."));
  return name === "/.env.example" || textExtensions.has(extension);
});
const source = files.map((path) => `\nFILE:${relative(root, path)}\n${readFileSync(path, "utf8")}`).join("\n");
const migration = [
  "001_spin_wheel.sql",
  "002_click_task_timer.sql",
  "003_referrals_fair_campaigns.sql",
  "004_wallet_permissions_and_sync.sql",
  "005_wallet_submission_control.sql",
  "006_production_data_platform.sql",
].map((name) => readFileSync(join(root, "db/migrations", name), "utf8")).join("\n");
const wheel = readFileSync(join(root, "lib/spin/wheel.ts"), "utf8");
const campaigns = readFileSync(join(root, "lib/spin/campaigns.ts"), "utf8");
const users = readFileSync(join(root, "lib/spin/users.ts"), "utf8");
const wheelApp = readFileSync(join(root, "app/SpinTheWheel/spin-wheel-app.tsx"), "utf8");
const taskStartRoute = readFileSync(join(root, "app/api/spin/tasks/start/route.ts"), "utf8");
const taskClaimRoute = readFileSync(join(root, "app/api/spin/tasks/claim/route.ts"), "utf8");
const walletRoute = readFileSync(join(root, "app/api/spin/wins/[winId]/wallet/route.ts"), "utf8");
const adminApp = readFileSync(join(root, "app/admin/spin/spin-admin-app.tsx"), "utf8");
const adminData = readFileSync(join(root, "lib/spin/admin-data.ts"), "utf8");
const maintenance = readFileSync(join(root, "lib/spin/maintenance.ts"), "utf8");
const progress = readFileSync(join(root, "lib/spin/progress.ts"), "utf8");
const excel = readFileSync(join(root, "lib/spin/excel.ts"), "utf8");
const csv = readFileSync(join(root, "lib/spin/csv.ts"), "utf8");
const storageSafety = readFileSync(join(root, "lib/spin/storage-safety.ts"), "utf8");
const homepage = readFileSync(join(root, "app/page.tsx"), "utf8");
const xIntegration = readFileSync(join(root, "lib/spin/x.ts"), "utf8");
const xStart = readFileSync(join(root, "app/api/spin/auth/x/start/route.ts"), "utf8");
const storageGatedRoutes = [
  "app/api/spin/auth/x/start/route.ts",
  "app/api/spin/auth/x/callback/route.ts",
  "app/api/spin/play/route.ts",
  "app/api/spin/redeem/route.ts",
  "app/api/spin/referral/code/route.ts",
  "app/api/spin/tasks/start/route.ts",
  "app/api/spin/tasks/claim/route.ts",
  "app/api/spin/wins/[winId]/wallet/route.ts",
  "app/api/admin/spin/campaign/route.ts",
].map((name) => ({ name, source: readFileSync(join(root, name), "utf8") }));
const failures = [];

if (/NEXT_PUBLIC_(?:X_|DATABASE|TOKEN_|CODE_|PRIZE_|RATE_|ADMIN_|CRON_|GOOGLE_)/.test(source)) {
  failures.push("A private environment variable was exposed with NEXT_PUBLIC_.");
}
if (/script\.google\.com\/macros\/s\/(?!REPLACE_ME)[A-Za-z0-9_-]{20,}\/exec/.test(source)) {
  failures.push("A real Google Apps Script URL appears in tracked source.");
}
if (!/total_wins between 0 and 9/.test(migration)) failures.push("Nine-win database constraint is missing.");
if (!/enforce_spin_win_role_cap/.test(migration)) failures.push("Three-per-role database enforcement is missing.");
if (!/spin_wins_wallet_lower_unique/.test(migration)) failures.push("Global wallet uniqueness is missing.");
if (!/create table if not exists spin_settings/.test(migration) || !/allow_wallet_changes boolean not null default true/.test(migration)) failures.push("Admin-controlled wallet permissions are missing.");
if (!/allow_wallet_submissions boolean not null default true/.test(migration) || !/WALLET_SUBMISSIONS_PAUSED/.test(wheel)) failures.push("Admin-controlled wallet submission pause is missing.");
if (!/spin_campaign_rounds/.test(migration)) failures.push("Daily campaign rounds are missing.");
if (!/round_number integer not null check \(round_number between 1 and 20\)/.test(migration) || !/roundNumber > 20/.test(campaigns)) failures.push("Twenty-round campaign cap is missing.");
if (!/campaign_version integer not null default 1/.test(migration) || !/campaign_version = 2/.test(campaigns)) failures.push("Legacy campaign isolation is missing.");
if (!/unique \(user_id, round_id, task_type\)/.test(migration)) failures.push("Per-round task claim uniqueness is missing.");
if (!/create table if not exists spin_task_starts/.test(migration)) failures.push("Server-backed task timers are missing.");
if (!/interval '5 seconds'/.test(campaigns)) failures.push("Five-second task enforcement is missing.");
if (!/startCampaignTask/.test(campaigns) || !/scheduleTaskRecovery/.test(wheelApp) || !/claimCampaignTask/.test(taskClaimRoute)) failures.push("Five-second automatic task completion is missing.");
if (/claimCampaignTask|await wait/.test(taskStartRoute)) failures.push("Task start blocks instead of returning the visible countdown immediately.");
if (!/settleMaturedCampaignTasks/.test(`${wheel}\n${campaigns}`)) failures.push("Interrupted automatic task recovery is missing.");
if (/Open once · auto reward|Securing reward/.test(wheelApp) || !/action: "Like"/.test(wheelApp) || !/action: "Retweet"/.test(wheelApp) || !/action: "Comment"/.test(wheelApp)) failures.push("Task buttons do not use the requested direct action labels.");
if (!/setTimeout\(\(\) => setMessage\(""\), 5_000\)/.test(wheelApp)) failures.push("Five-second task notification dismissal is missing.");
if (!/bunny-hood-logo\.png/.test(wheelApp)) failures.push("The new Bunny Hood hero logo is missing.");
if (/liked_tweets|referenced_tweets|tasks\/verify|verifyOnX/.test(`${campaigns}\n${xIntegration}`)) failures.push("Paid X task verification code is still present.");
if (/like\.read|offline\.access/.test(xStart)) failures.push("Unneeded X task-verification scopes are still requested.");
if (!/unique \(user_id, round_id\)/.test(migration)) failures.push("Per-round code redemption uniqueness is missing.");
if (!/randomInt\(10, 21\)/.test(wheel)) failures.push("Secure 10–20 code-spin allocation is missing.");
if (!/create table if not exists spin_campaign_prizes/.test(migration)) failures.push("Private campaign prize inventory is missing.");
if (!/expected_users integer not null default 500/.test(migration)) failures.push("Five-hundred-user campaign pacing is missing.");
if (!/expected_spins_per_user integer not null default 360/.test(migration) || !/\$\{expectedUsers\}, 360, 2/.test(campaigns)) failures.push("Twenty-round spin pacing is missing.");
if (!/20 \* 24 \* 60 \* 60 \* 1000/.test(campaigns)) failures.push("Twenty-day campaign default is missing.");
if (!/0\.5 \*\*/.test(wheel)) failures.push("Repeat-role probability reduction is missing.");
if (!/paceProjection/.test(wheel) || !/paceConfidence/.test(wheel)) failures.push("Turnout-adaptive campaign pacing is missing.");
if (!/spin_batches/.test(migration) || !/playSpins/.test(wheel)) failures.push("Idempotent batch spinning is missing.");
if (!/spin_referrals/.test(migration) || !/awarded_spins integer not null default 3/.test(migration)) failures.push("Three-spin referral rewards are missing.");
if (!/spin_referral_codes/.test(migration) || !/from spin_referral_codes/.test(users)) failures.push("Persistent referral-link aliases are missing.");
if (!/applyNewUserReferral/.test(`${users}\n${xIntegration}`)) failures.push("New-user referral attribution is missing.");
if (/state\.campaign && \(\s*<>\s*<section className="daily-campaign"/.test(wheelApp)) failures.push("Referral tools are still hidden behind the active-campaign gate.");
if (!/getLatestPrizeCampaign/.test(campaigns) || !/wheelAvailable/.test(`${wheel}\n${wheelApp}`) || !/NO_PRIZE_POOL/.test(wheel)) failures.push("Between-campaign spinning is missing or can consume unconfigured spins.");
if (!/Share referral link on X/.test(wheelApp) || !/Share win on X/.test(wheelApp)) failures.push("X referral and win sharing are missing.");
if (/20 DAYS|PRIVATE PACED CAMPAIGN DRAW|hero-mini-wheel/.test(wheelApp)) failures.push("Removed hero campaign copy or dummy wheel is still rendered.");
if (/flushSheetOutbox|queueSheetSync|sheetSynced|Google Sheets will retry/.test(source)) failures.push("The retired Google Sheets write path is still coupled to production requests.");
if (!/spins_earned = spins_available \+ spins_used/.test(migration) || !/spins_earned = spins_earned \+/.test(`${campaigns}\n${users}\n${wheel}`)) failures.push("Permanent lifetime spin accounting is missing.");
if (!/spins_processed bigint not null default 0/.test(migration) || !/campaign\.spins_processed/.test(wheel)) failures.push("Permanent campaign attempt pacing is missing.");
if (!/spin_daily_rollups/.test(migration) || !/RAW_SPIN_RETENTION_HOURS = 72/.test(maintenance)) failures.push("Bounded raw-event retention and permanent rollups are missing.");
if (!/spin_user_campaign_progress/.test(migration) || !/task_claimed_bits bigint/.test(migration) || !/code_redeemed_bits bigint/.test(migration)) failures.push("Compact per-campaign reward eligibility is missing.");
if (/insert into spin_task_claims|insert into spin_code_redemptions/.test(`${campaigns}\n${wheel}`) || !/markTaskReward/.test(progress) || !/markCodeReward/.test(progress)) failures.push("Runtime rewards still create one permanent row per task or code claim.");
if (!/metric_shard smallint/.test(migration) || !/spin_campaign_counters/.test(migration) || !/userMetricShard/.test(wheel)) failures.push("High-concurrency campaign counters are not sharded.");
if (!/insert into spin_daily_rollups/.test(wheel) || !/rollup_recorded/.test(wheel) || !/if \(winId\)/.test(wheel)) failures.push("Spin attempts are not written directly to compact permanent rollups.");
if (!/spin_connected_user_counters/.test(migration) || !/from spin_connected_user_counters/.test(wheel)) failures.push("Connected-user reads still require a full public table count.");
if (!/spin_wallet_registry/.test(migration) || !/spin_wallet_history/.test(migration) || !/walletHash/.test(wheel)) failures.push("Wallet anti-reuse history is missing.");
if (!/Complete workbook · Excel/.test(adminApp) || !/createBunnyHoodWorkbookDownload/.test(excel)) failures.push("Protected direct Excel export is missing.");
if (!/\.cursor\(CURSOR_ROWS\)/.test(excel)) failures.push("Large admin Excel exports are not cursor-streamed.");
if (!/streamBunnyHoodCsv/.test(csv) || !/\\uFEFF/.test(csv) || !/Wins &amp; wallets · CSV/.test(adminApp)) failures.push("Mobile-friendly CSV export choices are missing.");
if (!/490 \* 1024 \* 1024/.test(storageSafety) || !/STORAGE_SAFETY_PAUSE/.test(storageSafety) || !/storageSafetyPaused/.test(wheelApp)) failures.push("The automatic 490 MB public safety pause is missing.");
for (const route of storageGatedRoutes) {
  if (!/assertPublicStorageWritable/.test(route.source)) failures.push(`Storage safety is missing from ${route.name}.`);
}
if (/ONE HOOD[\s\S]{0,80}More utility\. More experiments\./.test(homepage) || !/roadmap-close"><strong>More, more and more soon\.<\/strong>/.test(homepage)) failures.push("The requested roadmap closing copy is not applied.");
if (!/getAdminRecords/.test(adminData) || !/LIVE NEON RECORDS/.test(adminApp)) failures.push("The live admin data explorer is missing.");
if (!/Lock wallet changes/.test(adminApp)) failures.push("Admin wallet-change permission is missing.");
if (!/setWalletSubmissionsAllowed/.test(source) || !/Pause wallet submissions/.test(adminApp)) failures.push("Admin wallet-submission permission is missing.");
if (!/export async function DELETE/.test(walletRoute) || !/removeWinWallet/.test(`${walletRoute}\n${wheel}`) || !/Remove wallet/.test(wheelApp)) failures.push("User wallet removal is missing.");
if (!/xShareUrl\([\s\S]{0,180}referralLink/.test(wheelApp)) failures.push("Referral links are not attached to X shares.");
if (/GTD LEFT|FCFS1 LEFT|FCFS2 LEFT|Daily prize inventory/.test(wheelApp)) failures.push("Private prize counts are exposed in the public UI.");
if (!/Total GTD/.test(adminApp) || !/Expected connected users/.test(adminApp)) failures.push("Admin campaign controls are incomplete.");

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

console.log("Security invariants and secret-boundary checks passed.");
