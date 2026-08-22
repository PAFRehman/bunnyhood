import { once } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { getDb } from "./db";
import { HttpError } from "./http";
import { ensureProductionSchema } from "./schema";

export type CsvExportView = "users" | "wins" | "referrals" | "daily";

const CURSOR_ROWS = 2_000;

function csvCell(value: unknown) {
  const original = String(value ?? "");
  const safe = /^[=+\-@]/.test(original) ? `'${original}` : original;
  return `"${safe.replace(/"/g, '""')}"`;
}

function csvLine(values: unknown[]) {
  return `${values.map(csvCell).join(",")}\r\n`;
}

async function write(output: PassThrough, value: string) {
  if (!output.write(value)) await once(output, "drain");
}

async function writeUsers(output: PassThrough) {
  const sql = getDb();
  await write(output, csvLine([
    "User ID", "X User ID", "X Username", "X Name", "Points", "Spins Earned",
    "Spins Left", "Spins Used", "Total Wins", "GTD", "FCFS1", "FCFS2",
    "Referral Code", "Successful Referrals", "Referral Spins", "Connected At",
    "Last Seen", "Last Spin",
  ]));
  const cursor = sql<{
    id: string;
    x_user_id: string;
    x_username: string;
    x_name: string;
    points: number | string;
    spins_earned: number | string;
    spins_available: number | string;
    spins_used: number | string;
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
  }[]>`
    select users.id, users.x_user_id, users.x_username, users.x_name,
      users.points, users.spins_earned, users.spins_available, users.spins_used,
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
  for await (const rows of cursor) {
    for (const row of rows) {
      await write(output, csvLine([
        row.id, row.x_user_id, row.x_username, row.x_name, row.points,
        row.spins_earned, row.spins_available, row.spins_used, row.total_wins,
        row.gtd_wins, row.fcfs1_wins, row.fcfs2_wins, row.referral_code,
        row.referral_count, row.referral_spins_earned,
        new Date(row.created_at).toISOString(), new Date(row.last_seen_at).toISOString(),
        row.last_spin_at ? new Date(row.last_spin_at).toISOString() : "",
      ]));
    }
  }
}

async function writeWins(output: PassThrough) {
  const sql = getDb();
  await write(output, csvLine([
    "Win ID", "User ID", "X User ID", "X Username", "X Name", "Role", "Won At",
    "Wallet Status", "EVM Wallet", "Wallet Submitted At",
  ]));
  const cursor = sql<{
    id: string;
    user_id: string;
    x_user_id: string;
    x_username: string;
    x_name: string;
    prize_type: string;
    won_at: Date | string;
    wallet_address: string | null;
    wallet_submitted_at: Date | string | null;
  }[]>`
    select wins.id, wins.user_id, users.x_user_id, users.x_username, users.x_name,
      wins.prize_type, wins.won_at, wins.wallet_address, wins.wallet_submitted_at
    from spin_wins wins
    join spin_users users on users.id = wins.user_id
    order by wins.won_at desc, wins.id
  `.cursor(CURSOR_ROWS);
  for await (const rows of cursor) {
    for (const row of rows) {
      await write(output, csvLine([
        row.id, row.user_id, row.x_user_id, row.x_username, row.x_name,
        row.prize_type, new Date(row.won_at).toISOString(),
        row.wallet_address ? "SUBMITTED" : "WAITING", row.wallet_address,
        row.wallet_submitted_at ? new Date(row.wallet_submitted_at).toISOString() : "",
      ]));
    }
  }
}

async function writeReferrals(output: PassThrough) {
  const sql = getDb();
  await write(output, csvLine([
    "Referral ID", "Referrer X ID", "Referrer Username", "Referred X ID",
    "Referred Username", "Referral Code", "Spins Awarded", "Created At",
  ]));
  const cursor = sql<{
    id: string;
    referrer_x_user_id: string;
    referrer_username: string;
    referred_x_user_id: string;
    referred_username: string;
    referral_code: string;
    awarded_spins: number;
    created_at: Date | string;
  }[]>`
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
  for await (const rows of cursor) {
    for (const row of rows) {
      await write(output, csvLine([
        row.id, row.referrer_x_user_id, row.referrer_username,
        row.referred_x_user_id, row.referred_username, row.referral_code,
        row.awarded_spins, new Date(row.created_at).toISOString(),
      ]));
    }
  }
}

async function writeDaily(output: PassThrough) {
  const sql = getDb();
  await write(output, csvLine([
    "UTC Day", "Attempts", "Spins Used", "Spins Returned", "No Prize",
    "GTD", "FCFS1", "FCFS2",
  ]));
  const cursor = sql<{
    metric_day: Date | string;
    attempts: number | string;
    spins_consumed: number | string;
    spins_refunded: number | string;
    no_prize: number | string;
    gtd_wins: number | string;
    fcfs1_wins: number | string;
    fcfs2_wins: number | string;
  }[]>`
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
  for await (const rows of cursor) {
    for (const row of rows) {
      await write(output, csvLine([
        new Date(row.metric_day).toISOString().slice(0, 10), row.attempts,
        row.spins_consumed, row.spins_refunded, row.no_prize,
        row.gtd_wins, row.fcfs1_wins, row.fcfs2_wins,
      ]));
    }
  }
}

async function produceCsv(view: CsvExportView, output: PassThrough) {
  await ensureProductionSchema();
  await write(output, "\uFEFF");
  if (view === "users") await writeUsers(output);
  else if (view === "wins") await writeWins(output);
  else if (view === "referrals") await writeReferrals(output);
  else await writeDaily(output);
  output.end();
}

export function parseCsvExportView(value: string | null): CsvExportView {
  if (value === "users" || value === "wins" || value === "referrals" || value === "daily") {
    return value;
  }
  throw new HttpError(400, "Choose users, wins, referrals, or daily activity.", "BAD_CSV_VIEW");
}

export function streamBunnyHoodCsv(view: CsvExportView) {
  const output = new PassThrough();
  const body = Readable.toWeb(output) as ReadableStream<Uint8Array>;
  const completed = produceCsv(view, output).catch((error) => {
    output.destroy(error instanceof Error ? error : new Error("CSV export failed."));
    throw error;
  });
  return { body, completed };
}
