import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { getAdminOverview } from "./admin-data";
import { getDb } from "./db";
import { ensureProductionSchema } from "./schema";

const LIME = "CAFF00";
const INK = "090B08";
const MUTED = "6F766A";
const CURSOR_ROWS = 2_000;

type UserExportRow = {
  id: string;
  x_user_id: string;
  x_username: string;
  x_name: string;
  spins_earned: number | string;
  spins_available: number | string;
  spins_used: number | string;
  points: number | string;
  total_wins: number;
  gtd_wins: number;
  fcfs1_wins: number;
  fcfs2_wins: number;
  referral_code: string | null;
  referral_count: number;
  referral_spins_earned: number;
  created_at: Date | string;
  last_seen_at: Date | string;
  last_spin_at: Date | string | null;
};

type WinExportRow = {
  id: string;
  user_id: string;
  x_user_id: string;
  x_username: string;
  x_name: string;
  prize_type: string;
  won_at: Date | string;
  wallet_address: string | null;
  wallet_submitted_at: Date | string | null;
};

type ReferralExportRow = {
  id: string;
  referrer_x_user_id: string;
  referrer_username: string;
  referred_x_user_id: string;
  referred_username: string;
  referral_code: string;
  awarded_spins: number;
  created_at: Date | string;
};

type DailyExportRow = {
  metric_day: Date | string;
  attempts: number | string;
  spins_consumed: number | string;
  spins_refunded: number | string;
  no_prize: number | string;
  gtd_wins: number | string;
  fcfs1_wins: number | string;
  fcfs2_wins: number | string;
};

function safeText(value: unknown) {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function numberValue(value: unknown) {
  return Number(value ?? 0);
}

function startSheet(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  name: string,
  columns: Partial<ExcelJS.Column>[],
  tabColor: string,
) {
  const sheet = workbook.addWorksheet(name, { properties: { tabColor: { argb: tabColor } } });
  sheet.columns = columns;
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  const header = sheet.getRow(1);
  header.height = 27;
  header.font = { bold: true, color: { argb: INK }, size: 10 };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIME } };
  header.alignment = { vertical: "middle" };
  header.eachCell((cell) => {
    cell.border = { bottom: { style: "thin", color: { argb: INK } } };
  });
  header.commit();
  return sheet;
}

function addSummaryRow(sheet: ExcelJS.Worksheet, label: string, value: string | number) {
  const row = sheet.addRow([label, value]);
  row.getCell(1).font = { bold: true, color: { argb: MUTED } };
  row.getCell(2).font = { bold: true, color: { argb: INK } };
  row.commit();
}

async function writeBunnyHoodWorkbook(filename: string) {
  await ensureProductionSchema();
  const sql = getDb();
  const overview = await getAdminOverview();
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename,
    useSharedStrings: false,
    useStyles: true,
  });
  workbook.creator = "Bunny Hood Admin";
  workbook.company = "Bunny Hood";
  workbook.subject = "Secure Neon production records";
  workbook.title = "Bunny Hood Spin Records";
  workbook.created = new Date();
  workbook.modified = new Date();

  const summary = startSheet(workbook, "Summary", [
    { header: "METRIC", key: "metric", width: 34 },
    { header: "VALUE", key: "value", width: 30 },
  ], LIME);
  addSummaryRow(summary, "Generated (UTC)", overview.generatedAt);
  addSummaryRow(summary, "Unique X users", overview.totals.users);
  addSummaryRow(summary, "Active in last 24 hours", overview.totals.active24h);
  addSummaryRow(summary, "Lifetime spins earned", overview.totals.spinsEarned);
  addSummaryRow(summary, "Spins currently available", overview.totals.spinsAvailable);
  addSummaryRow(summary, "Lifetime spins used", overview.totals.spinsUsed);
  addSummaryRow(summary, "Lifetime points", overview.totals.points);
  addSummaryRow(summary, "Total wins", overview.totals.wins);
  addSummaryRow(summary, "GTD wins", overview.totals.roleWins.GTD);
  addSummaryRow(summary, "FCFS1 wins", overview.totals.roleWins.FCFS1);
  addSummaryRow(summary, "FCFS2 wins", overview.totals.roleWins.FCFS2);
  addSummaryRow(summary, "Waiting for wallet", overview.totals.pendingWallets);
  addSummaryRow(summary, "Successful referrals", overview.totals.referrals);
  addSummaryRow(summary, "Database bytes", overview.storage.databaseBytes);
  addSummaryRow(summary, "Raw events retained", overview.storage.rawEvents);
  addSummaryRow(summary, "Permanent rollup attempts", overview.storage.recordedAttempts);
  summary.commit();

  const userSheet = startSheet(workbook, "Users", [
    { header: "USER ID", key: "id", width: 38 },
    { header: "X USER ID", key: "xUserId", width: 22 },
    { header: "X USERNAME", key: "xUsername", width: 20 },
    { header: "X NAME", key: "xName", width: 28 },
    { header: "POINTS", key: "points", width: 13 },
    { header: "SPINS EARNED", key: "spinsEarned", width: 16 },
    { header: "SPINS LEFT", key: "spinsAvailable", width: 14 },
    { header: "SPINS USED", key: "spinsUsed", width: 14 },
    { header: "TOTAL WINS", key: "totalWins", width: 13 },
    { header: "GTD", key: "gtd", width: 9 },
    { header: "FCFS1", key: "fcfs1", width: 9 },
    { header: "FCFS2", key: "fcfs2", width: 9 },
    { header: "REFERRAL CODE", key: "referralCode", width: 22 },
    { header: "REFERRALS", key: "referralCount", width: 13 },
    { header: "REFERRAL SPINS", key: "referralSpins", width: 17 },
    { header: "CONNECTED AT", key: "createdAt", width: 25 },
    { header: "LAST SEEN", key: "lastSeenAt", width: 25 },
    { header: "LAST SPIN", key: "lastSpinAt", width: 25 },
  ], LIME);
  const userCursor = sql<UserExportRow[]>`
    select users.id, users.x_user_id, users.x_username, users.x_name,
      users.spins_earned, users.spins_available, users.spins_used, users.points,
      users.total_wins,
      count(wins.id) filter (where wins.prize_type = 'GTD')::int as gtd_wins,
      count(wins.id) filter (where wins.prize_type = 'FCFS1')::int as fcfs1_wins,
      count(wins.id) filter (where wins.prize_type = 'FCFS2')::int as fcfs2_wins,
      users.referral_code, users.referral_count, users.referral_spins_earned,
      users.created_at, users.last_seen_at, users.last_spin_at
    from spin_users users
    left join spin_wins wins on wins.user_id = users.id
    group by users.id
    order by users.created_at desc, users.id
  `.cursor(CURSOR_ROWS);
  for await (const users of userCursor) {
    for (const user of users) {
      userSheet.addRow({
        id: user.id,
        xUserId: safeText(user.x_user_id),
        xUsername: safeText(user.x_username),
        xName: safeText(user.x_name),
        points: numberValue(user.points),
        spinsEarned: numberValue(user.spins_earned),
        spinsAvailable: numberValue(user.spins_available),
        spinsUsed: numberValue(user.spins_used),
        totalWins: Number(user.total_wins),
        gtd: Number(user.gtd_wins),
        fcfs1: Number(user.fcfs1_wins),
        fcfs2: Number(user.fcfs2_wins),
        referralCode: safeText(user.referral_code),
        referralCount: Number(user.referral_count),
        referralSpins: Number(user.referral_spins_earned),
        createdAt: new Date(user.created_at).toISOString(),
        lastSeenAt: new Date(user.last_seen_at).toISOString(),
        lastSpinAt: user.last_spin_at ? new Date(user.last_spin_at).toISOString() : "",
      }).commit();
    }
  }
  userSheet.commit();

  const winSheet = startSheet(workbook, "Wins & Wallets", [
    { header: "WIN ID", key: "id", width: 38 },
    { header: "USER ID", key: "userId", width: 38 },
    { header: "X USER ID", key: "xUserId", width: 22 },
    { header: "X USERNAME", key: "xUsername", width: 20 },
    { header: "X NAME", key: "xName", width: 28 },
    { header: "ROLE", key: "role", width: 12 },
    { header: "WON AT", key: "wonAt", width: 25 },
    { header: "WALLET STATUS", key: "walletStatus", width: 17 },
    { header: "EVM WALLET", key: "wallet", width: 46 },
    { header: "WALLET SUBMITTED AT", key: "walletSubmittedAt", width: 25 },
  ], "FFD700");
  const winCursor = sql<WinExportRow[]>`
    select wins.id, wins.user_id, users.x_user_id, users.x_username, users.x_name,
      wins.prize_type, wins.won_at, wins.wallet_address, wins.wallet_submitted_at
    from spin_wins wins
    join spin_users users on users.id = wins.user_id
    order by wins.won_at desc, wins.id
  `.cursor(CURSOR_ROWS);
  for await (const wins of winCursor) {
    for (const win of wins) {
      winSheet.addRow({
        id: win.id,
        userId: win.user_id,
        xUserId: safeText(win.x_user_id),
        xUsername: safeText(win.x_username),
        xName: safeText(win.x_name),
        role: win.prize_type,
        wonAt: new Date(win.won_at).toISOString(),
        walletStatus: win.wallet_address ? "SUBMITTED" : "WAITING",
        wallet: safeText(win.wallet_address),
        walletSubmittedAt: win.wallet_submitted_at
          ? new Date(win.wallet_submitted_at).toISOString()
          : "",
      }).commit();
    }
  }
  winSheet.commit();

  const referralSheet = startSheet(workbook, "Referrals", [
    { header: "REFERRAL ID", key: "id", width: 38 },
    { header: "REFERRER X ID", key: "referrerXId", width: 22 },
    { header: "REFERRER", key: "referrer", width: 20 },
    { header: "REFERRED X ID", key: "referredXId", width: 22 },
    { header: "REFERRED USER", key: "referred", width: 20 },
    { header: "CODE", key: "code", width: 22 },
    { header: "SPINS AWARDED", key: "spins", width: 17 },
    { header: "CREATED AT", key: "createdAt", width: 25 },
  ], "8FD400");
  const referralCursor = sql<ReferralExportRow[]>`
    select referrals.id,
      referrers.x_user_id as referrer_x_user_id,
      referrers.x_username as referrer_username,
      referred.x_user_id as referred_x_user_id,
      referred.x_username as referred_username,
      referrals.referral_code, referrals.awarded_spins, referrals.created_at
    from spin_referrals referrals
    join spin_users referrers on referrers.id = referrals.referrer_user_id
    join spin_users referred on referred.id = referrals.referred_user_id
    order by referrals.created_at desc, referrals.id
  `.cursor(CURSOR_ROWS);
  for await (const referrals of referralCursor) {
    for (const referral of referrals) {
      referralSheet.addRow({
        id: referral.id,
        referrerXId: safeText(referral.referrer_x_user_id),
        referrer: safeText(referral.referrer_username),
        referredXId: safeText(referral.referred_x_user_id),
        referred: safeText(referral.referred_username),
        code: safeText(referral.referral_code),
        spins: Number(referral.awarded_spins),
        createdAt: new Date(referral.created_at).toISOString(),
      }).commit();
    }
  }
  referralSheet.commit();

  const dailySheet = startSheet(workbook, "Daily Activity", [
    { header: "UTC DAY", key: "day", width: 15 },
    { header: "ATTEMPTS", key: "attempts", width: 14 },
    { header: "SPINS USED", key: "used", width: 14 },
    { header: "REFUNDS", key: "refunds", width: 13 },
    { header: "NO PRIZE", key: "none", width: 13 },
    { header: "GTD", key: "gtd", width: 10 },
    { header: "FCFS1", key: "fcfs1", width: 10 },
    { header: "FCFS2", key: "fcfs2", width: 10 },
  ], "63A900");
  const dailyCursor = sql<DailyExportRow[]>`
    select metric_day,
      sum(attempts)::text as attempts,
      sum(spins_consumed)::text as spins_consumed,
      sum(spins_refunded)::text as spins_refunded,
      sum(no_prize)::text as no_prize,
      sum(gtd_wins)::text as gtd_wins,
      sum(fcfs1_wins)::text as fcfs1_wins,
      sum(fcfs2_wins)::text as fcfs2_wins
    from spin_daily_rollups
    group by metric_day
    order by metric_day desc
  `.cursor(CURSOR_ROWS);
  for await (const days of dailyCursor) {
    for (const day of days) {
      dailySheet.addRow({
        day: new Date(day.metric_day).toISOString().slice(0, 10),
        attempts: numberValue(day.attempts),
        used: numberValue(day.spins_consumed),
        refunds: numberValue(day.spins_refunded),
        none: numberValue(day.no_prize),
        gtd: numberValue(day.gtd_wins),
        fcfs1: numberValue(day.fcfs1_wins),
        fcfs2: numberValue(day.fcfs2_wins),
      }).commit();
    }
  }
  dailySheet.commit();
  await workbook.commit();
}

export async function createBunnyHoodWorkbookDownload() {
  const filename = join(tmpdir(), `bunnyhood-${randomUUID()}.xlsx`);
  try {
    await writeBunnyHoodWorkbook(filename);
    const fileInfo = await stat(filename);
    if (fileInfo.size < 100) throw new Error("The generated Excel workbook is incomplete.");
    const source = createReadStream(filename);
    source.once("close", () => void unlink(filename).catch(() => undefined));
    return {
      body: Readable.toWeb(source) as ReadableStream<Uint8Array>,
      bytes: fileInfo.size,
    };
  } catch (error) {
    await unlink(filename).catch(() => undefined);
    throw error;
  }
}
