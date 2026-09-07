import "server-only";

import ExcelJS from "exceljs";
import { getDb } from "@/lib/spin/db";
import { HttpError } from "@/lib/spin/http";

const LIME = "CAFF00";
const INK = "090B08";
const PAPER = "F7F8F2";
const RULE = "D9DED2";
const TOP_REFERRERS_LIMIT = 50;

type TopReferrerRow = {
  rank: number | string;
  wallet_address: string;
  x_username: string | null;
  referral_count: number | string;
  bonus_points: number | string;
  score: number | string;
  referral_code: string;
  joined_at: Date | string;
};

function safeText(value: unknown) {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function createSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: Partial<ExcelJS.Column>[],
) {
  const sheet = workbook.addWorksheet(name, {
    properties: { defaultRowHeight: 22, tabColor: { argb: LIME } },
    pageSetup: { fitToPage: true, fitToWidth: 1, fitToHeight: 0, orientation: "landscape" },
  });
  sheet.columns = columns;
  sheet.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  const header = sheet.getRow(1);
  header.height = 30;
  header.font = { bold: true, color: { argb: INK }, name: "Arial", size: 10 };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIME } };
  header.alignment = { vertical: "middle" };
  header.eachCell((cell) => {
    cell.border = { bottom: { style: "medium", color: { argb: INK } } };
  });
  return sheet;
}

function styleBody(sheet: ExcelJS.Worksheet, walletColumn: number) {
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.height = 24;
    row.font = { color: { argb: INK }, name: "Arial", size: 10 };
    if (rowNumber % 2 === 0) {
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PAPER } };
    }
    row.eachCell((cell) => {
      cell.alignment = { vertical: "middle" };
      cell.border = { bottom: { style: "thin", color: { argb: RULE } } };
    });
    row.getCell(walletColumn).font = { color: { argb: INK }, name: "Consolas", size: 10 };
  }
}

export async function buildWaitlistTopReferrersWorkbook() {
  const sql = getDb();
  const rows = await sql<TopReferrerRow[]>`
    with ranked as (
      select entries.session_id, entries.wallet_address, entries.referral_code,
        entries.referral_count, entries.bonus_points, entries.joined_at,
        (2 + entries.referral_count + entries.bonus_points)::integer as score,
        row_number() over (
          order by (entries.referral_count + entries.bonus_points) desc,
            entries.joined_at asc, entries.join_number asc
        ) as rank
      from waitlist_entries entries
    )
    select ranked.rank, ranked.wallet_address, posts.x_username,
      ranked.referral_count, ranked.bonus_points, ranked.score,
      ranked.referral_code, ranked.joined_at
    from ranked
    left join waitlist_join_posts posts on posts.session_id = ranked.session_id
    order by ranked.rank
    limit 50
  `;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Bunny Hood Admin";
  workbook.company = "Bunny Hood";
  workbook.subject = "Waitlist Top 50 referral leaderboard wallets";
  workbook.title = "Bunny Hood Waitlist Top 50";
  workbook.created = new Date();
  workbook.modified = new Date();

  const leaderboard = createSheet(workbook, "Top 50 Referrals", [
    { header: "RANK", key: "rank", width: 10 },
    { header: "WALLET ADDRESS", key: "wallet", width: 46 },
    { header: "X USERNAME", key: "xUsername", width: 22 },
    { header: "REFERRALS", key: "referrals", width: 15 },
    { header: "BONUS POINTS", key: "bonusPoints", width: 16 },
    { header: "TOTAL POINTS", key: "points", width: 16 },
    { header: "REFERRAL CODE", key: "referralCode", width: 24 },
    { header: "JOINED AT (UTC)", key: "joinedAt", width: 22 },
  ]);
  const wallets = createSheet(workbook, "Wallets Only", [
    { header: "RANK", key: "rank", width: 10 },
    { header: "WALLET ADDRESS", key: "wallet", width: 46 },
  ]);

  for (const entry of rows) {
    const rank = Number(entry.rank);
    leaderboard.addRow({
      rank,
      wallet: safeText(entry.wallet_address),
      xUsername: entry.x_username ? safeText(entry.x_username) : "",
      referrals: Number(entry.referral_count),
      bonusPoints: Number(entry.bonus_points),
      points: Number(entry.score),
      referralCode: safeText(entry.referral_code),
      joinedAt: new Date(entry.joined_at),
    });
    wallets.addRow({ rank, wallet: safeText(entry.wallet_address) });
  }

  styleBody(leaderboard, 2);
  styleBody(wallets, 2);
  leaderboard.getColumn("joinedAt").numFmt = "yyyy-mm-dd hh:mm";
  for (const key of ["rank", "referrals", "bonusPoints", "points"]) {
    leaderboard.getColumn(key).alignment = { horizontal: "center", vertical: "middle" };
  }
  wallets.getColumn("rank").alignment = { horizontal: "center", vertical: "middle" };

  for (let rowNumber = 2; rowNumber <= Math.min(4, leaderboard.rowCount); rowNumber += 1) {
    const rankCell = leaderboard.getRow(rowNumber).getCell(1);
    rankCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIME } };
    rankCell.font = { bold: true, color: { argb: INK }, name: "Arial", size: 11 };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(buffer);
  const isZip = bytes.length >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && bytes[2] === 0x03
    && bytes[3] === 0x04;
  if (!isZip) {
    throw new HttpError(500, "The Top 50 wallet sheet could not be created. Try again.", "WAITLIST_TOP_50_EXPORT_FAILED");
  }

  return { bytes, recordCount: Math.min(rows.length, TOP_REFERRERS_LIMIT) };
}
