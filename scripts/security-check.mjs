import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";

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
  "007_unique_campaign_winners.sql",
  "008_five_campaign_tasks.sql",
  "009_rabbit_hole_sbt.sql",
  "010_rabbit_hole_ipfs_art.sql",
  "011_upcoming_products_waitlist.sql",
  "012_waitlist_required_x_post.sql",
  "013_wallet_eligibility_checker.sql",
  "014_spin_points_shop.sql",
  "015_feed_the_bunny.sql",
  "016_bunny_evolution_rules.sql",
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
const spinShop = readFileSync(join(root, "lib/spin/shop.ts"), "utf8");
const shopPurchaseRoute = readFileSync(join(root, "app/api/spin/shop/purchase/route.ts"), "utf8");
const shopPostRoute = readFileSync(join(root, "app/api/spin/post-task/route.ts"), "utf8");
const shopAdminRoute = readFileSync(join(root, "app/api/admin/spin/shop/route.ts"), "utf8");
const bunny = readFileSync(join(root, "lib/spin/bunny.ts"), "utf8");
const bunnyApp = readFileSync(join(root, "app/SpinTheWheel/feed-the-bunny.tsx"), "utf8");
const bunnyFeedRoute = readFileSync(join(root, "app/api/spin/bunny/feed/route.ts"), "utf8");
const bunnyTradeRoute = readFileSync(join(root, "app/api/spin/bunny/trade/route.ts"), "utf8");
const engagementAdminRoute = readFileSync(join(root, "app/api/admin/spin/engagement-settings/route.ts"), "utf8");
const rabbitContract = readFileSync(join(root, "contracts/BunnyHoodRabbitHoleSBT.sol"), "utf8");
const rabbitClaim = readFileSync(join(root, "lib/rabbit-hole/claim.ts"), "utf8");
const rabbitData = readFileSync(join(root, "lib/rabbit-hole/data.ts"), "utf8");
const rabbitPage = readFileSync(join(root, "app/RabbitHole/page.tsx"), "utf8");
const rabbitApp = readFileSync(join(root, "app/RabbitHole/rabbit-hole-app.tsx"), "utf8");
const rabbitConfig = readFileSync(join(root, "lib/rabbit-hole/config.ts"), "utf8");
const rabbitAdminPage = readFileSync(join(root, "app/admin/rabbit-hole/page.tsx"), "utf8");
const rabbitAdminApp = readFileSync(join(root, "app/admin/rabbit-hole/rabbit-hole-admin-app.tsx"), "utf8");
const rabbitEligibilityRoute = readFileSync(join(root, "app/api/admin/rabbit-hole/eligibility/route.ts"), "utf8");
const rabbitRefetchRoute = readFileSync(join(root, "app/api/admin/rabbit-hole/refetch-metadata/route.ts"), "utf8");
const rabbitArt = readFileSync(join(root, "lib/rabbit-hole/art.ts"), "utf8");
const rabbitExplorer = readFileSync(join(root, "lib/rabbit-hole/explorer.ts"), "utf8");
const rabbitPinata = readFileSync(join(root, "lib/rabbit-hole/pinata.ts"), "utf8");
const rabbitMasterArt = readFileSync(join(root, "public/assets/rabbit-hole-box-original.png"));
const waitlistData = readFileSync(join(root, "lib/waitlist/data.ts"), "utf8");
const waitlistSession = readFileSync(join(root, "lib/waitlist/session.ts"), "utf8");
const waitlistSheets = readFileSync(join(root, "lib/waitlist/sheets.ts"), "utf8");
const waitlistApp = readFileSync(join(root, "app/waitlist/waitlist-app.tsx"), "utf8");
const waitlistAdminPage = readFileSync(join(root, "app/admin/waitlist/page.tsx"), "utf8");
const waitlistAdminRoute = readFileSync(join(root, "app/api/admin/waitlist/route.ts"), "utf8");
const waitlistJoinRoute = readFileSync(join(root, "app/api/waitlist/join/route.ts"), "utf8");
const waitlistJoinPostRoute = readFileSync(join(root, "app/api/waitlist/join-post/route.ts"), "utf8");
const waitlistBonusRoute = readFileSync(join(root, "app/api/waitlist/bonus-post/route.ts"), "utf8");
const waitlistXPost = readFileSync(join(root, "lib/waitlist/x-post.ts"), "utf8");
const checkerData = readFileSync(join(root, "lib/checker/data.ts"), "utf8");
const checkerPage = readFileSync(join(root, "app/Checker/checker-app.tsx"), "utf8");
const checkerAdminPage = readFileSync(join(root, "app/admin/checker/page.tsx"), "utf8");
const checkerAdminApp = readFileSync(join(root, "app/admin/checker/checker-admin-app.tsx"), "utf8");
const checkerPublicRoute = readFileSync(join(root, "app/api/checker/route.ts"), "utf8");
const checkerAdminRoute = readFileSync(join(root, "app/api/admin/checker/route.ts"), "utf8");
const storageGatedRoutes = [
  "app/api/spin/auth/x/start/route.ts",
  "app/api/spin/auth/x/callback/route.ts",
  "app/api/spin/play/route.ts",
  "app/api/spin/redeem/route.ts",
  "app/api/spin/referral/code/route.ts",
  "app/api/spin/tasks/start/route.ts",
  "app/api/spin/tasks/claim/route.ts",
  "app/api/spin/post-task/route.ts",
  "app/api/spin/shop/purchase/route.ts",
  "app/api/spin/bunny/feed/route.ts",
  "app/api/spin/bunny/trade/route.ts",
  "app/api/spin/wins/[winId]/wallet/route.ts",
  "app/api/admin/spin/campaign/route.ts",
  "app/api/admin/spin/engagement-settings/route.ts",
  "app/api/rabbit-hole/auth/x/start/route.ts",
  "app/api/rabbit-hole/claim/route.ts",
  "app/api/waitlist/state/route.ts",
  "app/api/waitlist/tasks/start/route.ts",
  "app/api/waitlist/tasks/complete/route.ts",
  "app/api/waitlist/join-post/route.ts",
  "app/api/waitlist/join/route.ts",
  "app/api/waitlist/bonus-post/route.ts",
].map((name) => ({ name, source: readFileSync(join(root, name), "utf8") }));
const failures = [];

if (/NEXT_PUBLIC_(?:X_|DATABASE|TOKEN_|CODE_|PRIZE_|RATE_|ADMIN_|CRON_|GOOGLE_)/.test(source)) {
  failures.push("A private environment variable was exposed with NEXT_PUBLIC_.");
}
if (/NEXT_PUBLIC_(?:RABBIT_HOLE|ROBINHOOD)/.test(source)) failures.push("A Rabbit Hole contract, RPC, or signer setting was exposed to browser code.");
if (/NEXT_PUBLIC_(?:PINATA|IPFS)/.test(source)) failures.push("A private Pinata or IPFS setting was exposed to browser code.");
if (/AUCTION_(?:MAINNET|TESTNET)|USDG_(?:MAINNET|TESTNET)|api\/admin\/auction/.test(source)) failures.push("Retired auction configuration or API code remains in the repository.");
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
if (!/wait_ms/.test(campaigns) || !/serverWaitMs/.test(wheelApp) || !/TASK_TIMER_ACTIVE/.test(wheelApp)) failures.push("One-click tasks are not protected from client clock skew or early claim timing.");
if (/Open once · auto reward|Securing reward/.test(wheelApp) || !/action: "Follow"/.test(wheelApp) || !/action: "Like"/.test(wheelApp) || !/action: "Retweet"/.test(wheelApp) || !/action: "Comment"/.test(wheelApp) || !/action: "Turn notifications on"/.test(wheelApp)) failures.push("Task buttons do not use the requested direct action labels.");
if (!/setTimeout\(\(\) => setMessage\(""\), 5_000\)/.test(wheelApp)) failures.push("Five-second task notification dismissal is missing.");
if (!/bunny-hood-logo\.png/.test(wheelApp)) failures.push("The new Bunny Hood hero logo is missing.");
if (/liked_tweets|referenced_tweets|tasks\/verify|verifyOnX/.test(`${campaigns}\n${xIntegration}`)) failures.push("Paid X task verification code is still present.");
if (/like\.read|offline\.access/.test(xStart)) failures.push("Unneeded X task-verification scopes are still requested.");
if (!/unique \(user_id, round_id\)/.test(migration)) failures.push("Per-round code redemption uniqueness is missing.");
if (!/randomInt\(10, 21\)/.test(wheel)) failures.push("Secure 10–20 code-spin allocation is missing.");
if (!/awardByRound/.test(progress) || !/sql\.json\(awardByRound\)/.test(progress) || /jsonb_build_object\(\$\{String\(roundNumber\)\}/.test(progress)) failures.push("Redeem-code JSON persistence can fail PostgreSQL parameter inference.");
if (!/create table if not exists spin_campaign_prizes/.test(migration)) failures.push("Private campaign prize inventory is missing.");
if (!/expected_users integer not null default 500/.test(migration)) failures.push("Five-hundred-user campaign pacing is missing.");
if (!/alter column expected_spins_per_user set default 20/.test(migration) || !/\$\{expectedUsers\}, 20, 2/.test(campaigns)) failures.push("Per-user spin pacing is missing.");
if (!/20 \* 24 \* 60 \* 60 \* 1000/.test(campaigns)) failures.push("Twenty-day campaign default is missing.");
if (!/2 \*\* \(MAX_ROLE_WINS - roleWins/.test(wheel)) failures.push("Repeat-role probability reduction is missing.");
if (!/spin_campaign_participants/.test(migration) || !/spin_campaign_draw_counters/.test(migration) || !/remainingParticipantCapacity/.test(wheel) || !/randomInt\(remainingParticipantCapacity\) < eligiblePrizeCount/.test(wheel)) failures.push("Unique-user campaign allocation is missing.");
if (!/totalWinnerSpots > expectedUsers/.test(campaigns) || !/TOO_MANY_WINNER_SPOTS/.test(campaigns)) failures.push("Campaign winner targets can exceed the unique-user draw capacity.");
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
if (!/spins_processed bigint not null default 0/.test(migration) || !/spin_campaign_draw_counters/.test(`${wheel}\n${adminData}`) || !/spin_campaign_counters/.test(wheel)) failures.push("Permanent campaign attempt and participant pacing is missing.");
if (!/spin_daily_rollups/.test(migration) || !/RAW_SPIN_RETENTION_HOURS = 72/.test(maintenance)) failures.push("Bounded raw-event retention and permanent rollups are missing.");
if (!/spin_user_campaign_progress/.test(migration) || !/task_claimed_bits bigint/.test(migration) || !/extra_task_claimed_bits bigint/.test(migration) || !/code_redeemed_bits bigint/.test(migration)) failures.push("Compact per-campaign reward eligibility is missing.");
if (!/task_type in \('follow', 'like', 'repost', 'comment', 'notifications'\)/.test(migration) || !/task_rewards_earned between 0 and 100/.test(migration)) failures.push("Five-task campaign reward storage is missing.");
if (/insert into spin_task_claims|insert into spin_code_redemptions/.test(`${campaigns}\n${wheel}`) || !/markTaskReward/.test(progress) || !/markCodeReward/.test(progress)) failures.push("Runtime rewards still create one permanent row per task or code claim.");
if (!/metric_shard smallint/.test(migration) || !/spin_campaign_counters/.test(migration) || !/userMetricShard/.test(wheel)) failures.push("High-concurrency campaign counters are not sharded.");
if (!/insert into spin_daily_rollups/.test(wheel) || !/rollup_recorded/.test(wheel) || !/if \(winId\)/.test(wheel)) failures.push("Spin attempts are not written directly to compact permanent rollups.");
if (!/spin_connected_user_counters/.test(migration) || !/from spin_connected_user_counters/.test(wheel)) failures.push("Connected-user reads still require a full public table count.");
if (!/spin_wallet_registry/.test(migration) || !/spin_wallet_history/.test(migration) || !/walletHash/.test(wheel)) failures.push("Wallet anti-reuse history is missing.");
if (!/Complete workbook · Excel/.test(adminApp) || !/buildBunnyHoodWorkbook/.test(excel)) failures.push("Protected direct Excel export is missing.");
if (!/EXCEL_MAX_EXPORT_ROWS = 50_000/.test(excel) || !/workbook\.xlsx\.writeBuffer/.test(excel) || !/EXCEL_EXPORT_TOO_LARGE/.test(excel)) failures.push("Excel exports are not bounded and validated for serverless delivery.");
if (!/\.cursor\(CURSOR_ROWS\)/.test(csv)) failures.push("Large CSV exports are not cursor-streamed.");
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
if (!/Total GTD/.test(adminApp) || !/Expected unique users/.test(adminApp) || !/Unique winners selected/.test(adminApp)) failures.push("Admin campaign controls are incomplete.");
if (!/Top 15 referrers/.test(adminApp) || !/topReferrers/.test(adminData) || !/limit 15/.test(adminData) || /Top 15 referrers/.test(wheelApp)) failures.push("The private top-15 referral leaderboard is missing or exposed publicly.");
if (/GTD_NOT_RAREST|GTD must be lower than both FCFS/.test(campaigns)) failures.push("Admin still forces GTD totals below both FCFS totals.");
if (!/function locked\(uint256 tokenId\)/.test(rabbitContract) || !/0xb45a3c0e/.test(rabbitContract)) failures.push("Rabbit Hole contract is missing EIP-5192 locking support.");
if (!/function approve\([^)]*\) external pure[\s\S]*?revert Soulbound\(\)/.test(rabbitContract) || !/function transferFrom\([^)]*\) external pure[\s\S]*?revert Soulbound\(\)/.test(rabbitContract) || (rabbitContract.match(/function safeTransferFrom/g) ?? []).length !== 2) failures.push("Rabbit Hole SBT exposes a transferable or approvable ERC-721 path.");
if (/function burn\(/.test(rabbitContract)) failures.push("Rabbit Hole SBT unexpectedly contains a burn path.");
if (!/AlreadyMinted\(bytes32 claimKey\)/.test(rabbitContract) || !/AlreadyOwnsSoulboundToken/.test(rabbitContract) || !/tokenOfClaim/.test(rabbitClaim)) failures.push("Onchain duplicate X and wallet claim protection is incomplete.");
if (!/MAX_RABBIT_HOLE_ELIGIBLE = 100/.test(source) || !/rabbit_hole_active_wallet_unique/.test(migration)) failures.push("The 100-user cap or permanent wallet uniqueness is missing.");
if (!/x_user_id = \$1/.test(rabbitData) || !/bindAuthenticatedEligibility/.test(rabbitClaim)) failures.push("Eligible usernames are not bound to authenticated X identities.");
if (!/verifyAdminTicket/.test(rabbitPage) || !/isRabbitHolePublic/.test(rabbitPage)) failures.push("Rabbit Hole emergency-pause admin recovery gate is missing.");
if (!/RABBIT_HOLE_PAUSED/.test(rabbitConfig) || !/!== "true"/.test(rabbitConfig)) failures.push("Rabbit Hole is not public by default with an explicit emergency pause.");
if (!/process\.env\.NODE_ENV === "production"/.test(rabbitConfig) || !/\? "mainnet"/.test(rabbitConfig)) failures.push("Production Rabbit Hole runtime is not pinned to Robinhood Chain mainnet.");
if (!/opensea\.io\/item\/robinhood/.test(rabbitApp) || !/VIEW ON OPENSEA/.test(rabbitApp) || /VIEW IPFS/.test(rabbitApp)) failures.push("Public claimed-token actions do not prefer OpenSea over an IPFS link.");
if (!/source: "\/RabitHole\/:path\*"/.test(readFileSync(join(root, "next.config.ts"), "utf8"))) failures.push("The common /RabitHole spelling does not redirect to the canonical public route.");
if (!/verifyAdminTicket/.test(rabbitAdminPage) || !/\/admin\/spin\?next=\/admin\/rabbit-hole/.test(rabbitAdminPage)) failures.push("Dedicated Rabbit Hole admin gate is missing.");
if (!/ADD USERS/.test(rabbitAdminApp) || !/full claimed wallet/i.test(rabbitAdminApp) || !/export async function PUT/.test(rabbitEligibilityRoute) || !/addEligibility/.test(rabbitEligibilityRoute)) failures.push("Rabbit Hole add-user admin controls are incomplete.");
if (!/ALLOWED_PFP_HOSTS/.test(rabbitArt) || !/MAX_PFP_BYTES/.test(rabbitArt)) failures.push("X profile image snapshot fetching is not host and size bounded.");
if (!/rabbit-hole-box-original\.png/.test(rabbitArt) || !/renderRabbitHoleSbtPng/.test(rabbitArt) || !/clipPathUnits="userSpaceOnUse"/.test(rabbitArt)) failures.push("The supplied Rabbit Hole master art or perspective-clipped PNG renderer is missing.");
if (createHash("sha256").update(rabbitMasterArt).digest("hex") !== "90e50c91697496100d92c6365ac7567995e8ceabfe8255064fb0752fbfee6e38" || rabbitMasterArt.readUInt32BE(16) !== 1254 || rabbitMasterArt.readUInt32BE(20) !== 1254) failures.push("The user-supplied 1254px Rabbit Hole master artwork was modified.");
if (!/pinFileToIPFS/.test(rabbitPinata) || !/pinJSONToIPFS/.test(rabbitPinata) || !/PINATA_JWT/.test(rabbitPinata) || !/pinRabbitHoleSbt/.test(rabbitClaim)) failures.push("Rabbit Hole artwork and metadata are not pinned to IPFS before minting.");
if (rabbitClaim.indexOf("const pinned = await pinRabbitHoleSbt") < 0 || rabbitClaim.indexOf("const pinned = await pinRabbitHoleSbt") > rabbitClaim.indexOf("walletClient.writeContract")) failures.push("The Rabbit Hole mint can be submitted before its IPFS assets are pinned.");
if (!/image: publicIpfsGatewayUrl\(input\.imageCid\)/.test(rabbitPinata) || !/const uri = pinned\.metadataGatewayUrl/.test(rabbitClaim)) failures.push("New Rabbit Hole metadata is not exposed through explorer-compatible immutable HTTPS CID URLs.");
if (!/using the public Pinata gateway/.test(rabbitPinata) || /throw new Error\("PINATA_GATEWAY_URL/.test(rabbitPinata)) failures.push("An optional malformed Pinata gateway can still break Rabbit Hole reads.");
if (!/requireSpinAdmin/.test(rabbitRefetchRoute) || !/assertSameOrigin/.test(rabbitRefetchRoute) || !/requestExplorerMetadataRefresh/.test(`${rabbitRefetchRoute}\n${rabbitExplorer}`) || !/REFRESH EXPLORER/.test(rabbitAdminApp)) failures.push("Admin-only Blockscout metadata recovery is incomplete.");
if (!/image_cid/.test(migration) || !/metadata_cid/.test(migration) || !/rabbit_hole_claimed_wallet_idx/.test(migration)) failures.push("Rabbit Hole IPFS identifiers or claimed-wallet ledger index are missing.");
if (!/create table if not exists waitlist_entries/.test(migration) || !/waitlist_wallet_lower_unique/.test(migration) || !/session_id uuid not null unique/.test(migration)) failures.push("Waitlist one-session and one-wallet uniqueness is missing.");
if (!/create table if not exists waitlist_referrals/.test(migration) || !/referred_entry_id uuid not null unique/.test(migration) || !/points_awarded integer not null default 1/.test(migration)) failures.push("Waitlist referral point accounting is missing.");
if (!/create table if not exists waitlist_bonus_posts/.test(migration) || !/entry_id uuid not null unique/.test(migration) || !/post_id text not null unique/.test(migration) || !/bonus_points between 0 and 1/.test(migration)) failures.push("One-time unique waitlist post bonuses are missing.");
if (!/create table if not exists waitlist_join_posts/.test(migration) || !/waitlist_join_posts_username_lower_unique/.test(migration) || !/reserved_referral_code/.test(migration)) failures.push("The required pre-wallet X post or reserved referral code schema is missing.");
if (!/publish\.x\.com\/oembed/.test(waitlistXPost) || !/author_url/.test(waitlistXPost) || !/WAITLIST_X_POST_CONTENT_MISMATCH/.test(waitlistXPost) || !/verifyWaitlistPost/.test(waitlistData)) failures.push("Waitlist X post existence, canonical author, or session-code verification is missing.");
if (!/WAITLIST_POST_REQUIRED/.test(waitlistData) || !/waitlist_join_posts/.test(waitlistData) || !/CREATE POST WITH REFERRAL LINK/.test(waitlistApp) || !/state\.postProof/.test(waitlistApp)) failures.push("A verified unique X post is not enforced before wallet submission.");
if (!/anonymousRequestKey/.test(waitlistJoinPostRoute) || !/WAITLIST_X_ACCOUNT_USED/.test(waitlistData)) failures.push("The X post gate lacks IP throttling or one-account uniqueness enforcement.");
if (!/WAITLIST_TASK_WAIT_MS = 5_000/.test(source) || !/Number\(row\.elapsed_ms\) < WAITLIST_TASK_WAIT_MS/.test(waitlistData) || !/started_at <= now\(\) - interval '5 seconds'/.test(waitlistData)) failures.push("Waitlist task completion is missing the server-side timer or automatic settlement.");
if (!/1 \/ 1 POINT/.test(waitlistApp) || !/2 \+ entries\.referral_count \+ entries\.bonus_points/.test(waitlistData)) failures.push("Waitlist required-task points are missing from the UI or leaderboard score.");
if (!/@BunnysHood[\s\S]{0,180}referralLink/.test(waitlistApp)) failures.push("The optional BunnyHood post does not include the account tag and referral link.");
if (!/YOUR REFERRAL LINK/.test(waitlistApp) || !/COPY REFERRAL LINK/.test(waitlistApp) || !/TOP 50/.test(waitlistApp) || !/limit 50/.test(waitlistData)) failures.push("Waitlist referral-link recovery or Top 50 GTD leaderboard messaging is incomplete.");
if (/These actions are confirmed by you after a short server timer|no X account connection or username match is required/.test(waitlistApp)) failures.push("Removed waitlist task or X-account copy is still public.");
if (!/WAITLIST_SESSION_COOKIE/.test(waitlistSession) || !/csrf_hash/.test(waitlistSession) || !/BAD_WAITLIST_CSRF/.test(waitlistSession) || !/token_hash/.test(waitlistSession)) failures.push("Anonymous waitlist sessions are not protected by hashed tokens and CSRF.");
if (/requireSessionUser|getSessionUser|\/auth\/x/.test(`${waitlistData}\n${waitlistApp}`) || !/NO X LOGIN/.test(waitlistApp)) failures.push("The waitlist unexpectedly requires X authentication.");
if (!/create table if not exists waitlist_sheet_outbox/.test(migration) || !/queueWaitlistEntrySnapshot/.test(`${waitlistData}\n${waitlistSheets}`) || !/revision = waitlist_sheet_outbox\.revision \+ 1/.test(waitlistSheets)) failures.push("Durable revisioned waitlist Google Sheets sync is missing.");
if (!/from "next\/server"/.test(`${waitlistJoinRoute}\n${waitlistBonusRoute}`) || !/after\(async \(\) =>/.test(waitlistJoinRoute) || !/after\(async \(\) =>/.test(waitlistBonusRoute)) failures.push("Waitlist Sheets updates are not flushed after the user response.");
if (!/requireSpinAdmin/.test(waitlistAdminRoute) || !/verifyAdminTicket/.test(waitlistAdminPage) || /admin\/waitlist/.test(waitlistApp)) failures.push("Waitlist admin data is not private or the public page exposes its route.");
if (!/maskWallet/.test(waitlistData) || !/includePrivate \? row\.wallet_address : maskWallet/.test(waitlistData)) failures.push("Public waitlist rankings can expose complete wallets.");
if (!/create table if not exists checker_wallets/.test(migration) || !/eligibility_type in \('GTD', 'FCFS'\)/.test(migration)) failures.push("The GTD/FCFS wallet checker schema is missing or accepts unknown statuses.");
if (!/requireCheckerWallet/.test(checkerData) || !/on conflict \(\s*wallet_address,\s*eligibility_type\s*\)\s*do update/.test(checkerData)) failures.push("Checker wallet validation or idempotent bulk import is missing.");

if (!/create table if not exists spin_shop_items/.test(migration) || !/create table if not exists spin_shop_purchases/.test(migration) || !/points_spent >= 0 and points_spent <= points/.test(migration)) failures.push("The points shop ledger or spendable-balance constraint is missing.");
if (!/unique \(campaign_id, user_id, spot_type\)/.test(migration) || !/purchased_count < total_count/.test(spinShop) || !/points - points_spent >=/.test(spinShop)) failures.push("Shop purchases are not protected against duplicate claims, overselling, or overspending.");
if (!/source in \('wheel', 'shop'\)/.test(migration) || !/shop_purchase_id/.test(`${migration}\n${wheel}`)) failures.push("Shop purchases do not create permanent wallet-ready win records.");
if (!/create table if not exists spin_post_tasks/.test(migration) || !/unique \(user_id, round_id\)/.test(migration) || !/points_awarded integer not null default 3/.test(migration)) failures.push("The per-round three-point X-post task ledger is missing.");
if (!/xUsername !== user\.xUsername\.toLowerCase/.test(spinShop) || !/@bunnyshood/.test(spinShop) || !/on conflict \(post_id\) do nothing/.test(spinShop)) failures.push("X-post rewards are not bound to the connected account, required tag, and unique post.");
if (!/requireSessionUser\(request, true\)/.test(shopPurchaseRoute) || !/requireSessionUser\(request, true\)/.test(shopPostRoute) || !/assertSameOrigin/.test(`${shopPurchaseRoute}\n${shopPostRoute}`)) failures.push("Public shop mutations are missing authenticated CSRF protection.");
if (!/requireSpinAdmin/.test(shopAdminRoute) || !/assertSameOrigin/.test(shopAdminRoute) || !/recordAdminAction/.test(shopAdminRoute)) failures.push("Points-shop controls are not protected and audited in admin.");
if (!/Top 100 point balances/.test(adminApp) || !/topPointUsers/.test(adminData) || !/limit 100/.test(adminData)) failures.push("Private point analytics and top-100 balances are missing.");
if (!/post_task_text/.test(migration) || !/post_task_requires_tag/.test(migration) || !/setEngagementSettings/.test(source) || !/Require the @BunnysHood tag/.test(adminApp)) failures.push("Admin X-post text or tag-requirement controls are incomplete.");
if (!/(?:settings|liveSettings)\.postTaskRequiresTag/.test(spinShop) || !/X_TAG_MISSING/.test(spinShop)) failures.push("The verified X-post task does not honor the admin tag requirement.");
if (!/create table if not exists spin_bunny_profiles/.test(migration) || !/create table if not exists spin_bunny_feed_months/.test(migration) || !/create table if not exists spin_bunny_trades/.test(migration)) failures.push("Permanent Bunny evolution ledgers are missing.");
if (!/primary key \(user_id, feed_month\)/.test(migration) || !/feed_bits bigint/.test(migration) || !/points_spent = feeds_count \* 3/.test(migration) || !/clock_timestamp\(\) at time zone 'UTC'/.test(bunny)) failures.push("Compact daily UTC carrot history is not protected against duplicates or incorrect pricing.");
if (!/points - points_spent >=/.test(bunny) || !/BUNNY_CARROT_COST = 3/.test(bunny) || !/idempotency_key/.test(`${migration}\n${bunny}`)) failures.push("Bunny feeding can overspend, misprice, or replay.");
if (!/source in \('wheel', 'shop', 'bunny'\)/.test(migration) || !/bunny_trade_id/.test(`${migration}\n${bunny}`) || !/ROLE_LIMIT_REACHED/.test(bunny)) failures.push("Evolved Bunny trades do not create capped permanent wallet-ready wins.");
if (!/requireSessionUser\(request, true\)/.test(bunnyFeedRoute) || !/requireSessionUser\(request, true\)/.test(bunnyTradeRoute) || !/assertSameOrigin/.test(`${bunnyFeedRoute}\n${bunnyTradeRoute}`)) failures.push("Bunny mutations are missing authenticated CSRF protection.");
if (!/requireSpinAdmin/.test(engagementAdminRoute) || !/assertSameOrigin/.test(engagementAdminRoute) || !/recordAdminAction/.test(engagementAdminRoute)) failures.push("Bunny and post settings are not protected and audited in admin.");
if (!/permanent_task_claimed_bits/.test(migration) || !/PERMANENT_TASK_BITS/.test(progress) || !/366503875925/.test(migration) || !/733007751850/.test(migration)) failures.push("Follow and notification rewards are not permanent or historical claims are not backfilled.");
if (!/visibleTasks/.test(wheelApp) || !/task\.id === "follow" \|\| task\.id === "notifications"/.test(wheelApp)) failures.push("Completed one-time X tasks are not hidden from returning users.");
if (!/shop-carrot/.test(wheelApp) || !/BUY CARROT & FEED NOW/.test(wheelApp) || !/BUNNY_CARROT_COST = 3/.test(bunny)) failures.push("The daily three-point carrot is not available from Hood Shop.");
if (!/bunny_death_on_break/.test(migration) || !/diedFromHunger/.test(bunny) || !/startedNewCycleAfterDeath/.test(bunny) || !/died from hunger/i.test(bunnyApp)) failures.push("The optional broken-streak Bunny death and reset flow is incomplete.");
if (!/canFeed: !fedToday/.test(bunny) || !/KEEP EVOLVING/.test(bunnyApp) || !/SELL BUNNY FOR FCFS/.test(bunnyApp)) failures.push("Users cannot keep evolving or sell an eligible Bunny for FCFS.");
if (!/bunny_gtd_requirement_mode/.test(migration) || !/qualifiesForGtd/.test(bunny) || !/bunnyGtdPointsRequired/.test(adminApp) || !/bunny\.gtdEligible && <button/.test(bunnyApp)) failures.push("Private GTD day/point rules are missing or exposed before eligibility.");
if (!/FEED THE/.test(source) || !/SELL BUNNY FOR GTD/.test(source) || !/SELL BUNNY FOR FCFS/.test(source) || !/00:00 UTC/.test(source)) failures.push("The live Bunny feeding, evolution, or role-sale experience is incomplete.");
if (!/totalFeeds/.test(adminData) || !/READY FOR FCFS/.test(adminApp) || !/READY FOR GTD · PRIVATE/.test(adminApp) || !/totalDeaths/.test(adminData) || /dashboard\.bunny/.test(wheelApp)) failures.push("Bunny analytics are not complete and private to the admin panel.");
if (!/anonymousRequestKey/.test(checkerPublicRoute) || !/enforceRateLimit/.test(checkerPublicRoute) || /getCheckerStats|listCheckerWallets/.test(checkerPublicRoute)) failures.push("The public checker is not throttled or exposes private counts/list data.");
if (!/requireSpinAdmin/.test(checkerAdminRoute) || !/assertSameOrigin/.test(checkerAdminRoute) || !/verifyAdminTicket/.test(checkerAdminPage)) failures.push("The checker admin page or mutation API is not protected by the existing admin session.");
if (!/GTD WALLETS ADDED/.test(checkerAdminApp) || !/FCFS WALLETS ADDED/.test(checkerAdminApp) || !/stats\.gtd/.test(checkerAdminApp) || !/stats\.fcfs/.test(checkerAdminApp)) failures.push("Private GTD/FCFS wallet counts are missing from the checker admin.");
if (!/EVERY WALLET · PUBLIC ELIGIBLE/.test(checkerPage) || !/status: eligibility \?\? "PUBLIC"/.test(checkerPublicRoute)) failures.push("Every valid wallet is not guaranteed Public-round eligibility.");
if (!/CONGRATULATIONS!/.test(checkerPage) || !/GTD/.test(checkerPage) || !/FCFS/.test(checkerPage) || !/PUBLIC/.test(checkerPage) || !/eligibleRounds\.map/.test(checkerPage) || !/<span>ELIGIBLE<\/span>/.test(checkerPage)) failures.push("The Checker eligible-round congratulations result is incomplete.");
if (!/className="page-intro"/.test(checkerPage) || !/ENTER THE HOOD/.test(checkerPage) || !/<SiteNav \/>/.test(checkerPage)) failures.push("The Checker does not reuse the official BunnyHood intro and navigation.");
if (!/SHARE ON X/.test(checkerPage) || !/x\.com\/intent\/post/.test(checkerPage) || !/@BunnysHood/.test(checkerPage) || !/eligibleRounds\.map/.test(checkerPage)) failures.push("The Checker result cannot share its exact eligible rounds on X.");
if (/WALLET INDEX · LIVE|01 \/ GUARANTEED|RH-CHAIN \/ 143|CHECKER UPDATES DAILY|waiting for the next list update|ELIGIBILITY CHECKER|No wallet connection or signature required|TBA/.test(checkerPage)) failures.push("Removed Checker labels remain public.");
if (/admin\/checker/.test(checkerPage) || /href=["']\/admin\/checker/.test(adminApp)) failures.push("The hidden checker admin URL leaked into public or main-admin navigation.");
if (/debug:\s*stack|Internal Error:/.test(readFileSync(join(root, "lib/spin/http.ts"), "utf8"))) failures.push("Internal server stack details are exposed to clients.");

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

console.log("Security invariants and secret-boundary checks passed.");
