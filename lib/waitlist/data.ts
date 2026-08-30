import "server-only";

import { randomBytes } from "node:crypto";
import { getAddress, isAddress } from "viem";
import type { SpinDb } from "@/lib/spin/db";
import { getDb, inTransaction } from "@/lib/spin/db";
import { HttpError } from "@/lib/spin/http";
import { getWaitlistXPostUrl, parseWaitlistPostUrl, WAITLIST_TASK_WAIT_MS } from "./config";
import { ensureWaitlistSchema } from "./schema";
import { queueWaitlistEntrySnapshot } from "./sheets";

export type WaitlistTaskType = "follow_notifications" | "engage_post";

type RankedEntryRow = {
  id: string;
  join_number: number | string;
  wallet_address: string;
  referral_code: string;
  referral_count: number;
  bonus_points: number;
  score: number;
  rank: number | string;
  joined_at: Date | string;
  bonus_post_url: string | null;
};

function iso(value: Date | string | null) {
  return value ? new Date(value).toISOString() : null;
}

function maskWallet(wallet: string) {
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

function mapEntry(row: RankedEntryRow, includePrivate = true) {
  return {
    id: row.id,
    joinNumber: Number(row.join_number),
    walletAddress: includePrivate ? row.wallet_address : maskWallet(row.wallet_address),
    referralCode: row.referral_code,
    referralCount: Number(row.referral_count),
    bonusPoints: Number(row.bonus_points),
    points: Number(row.score),
    rank: Number(row.rank),
    joinedAt: iso(row.joined_at) as string,
    bonusPostUrl: includePrivate ? row.bonus_post_url : null,
  };
}

async function rankedEntryBySession(sessionId: string) {
  const sql = getDb();
  const rows = await sql<RankedEntryRow[]>`
    with ranked as (
      select entries.*,
        (entries.referral_count + entries.bonus_points)::integer as score,
        row_number() over (
          order by (entries.referral_count + entries.bonus_points) desc,
            entries.joined_at asc, entries.join_number asc
        ) as rank
      from waitlist_entries entries
    )
    select ranked.*, bonus.post_url as bonus_post_url
    from ranked
    left join waitlist_bonus_posts bonus on bonus.entry_id = ranked.id
    where ranked.session_id = ${sessionId}::uuid
    limit 1
  `;
  return rows[0] ? mapEntry(rows[0]) : null;
}

async function rankedEntryById(entryId: string) {
  const sql = getDb();
  const rows = await sql<RankedEntryRow[]>`
    with ranked as (
      select entries.*,
        (entries.referral_count + entries.bonus_points)::integer as score,
        row_number() over (
          order by (entries.referral_count + entries.bonus_points) desc,
            entries.joined_at asc, entries.join_number asc
        ) as rank
      from waitlist_entries entries
    )
    select ranked.*, bonus.post_url as bonus_post_url
    from ranked
    left join waitlist_bonus_posts bonus on bonus.entry_id = ranked.id
    where ranked.id = ${entryId}::uuid
    limit 1
  `;
  return rows[0] ? mapEntry(rows[0]) : null;
}

export async function getWaitlistState(sessionId: string) {
  await ensureWaitlistSchema();
  const sql = getDb();
  const [taskRows, entry, totalRows, leaderboardRows] = await Promise.all([
    sql<{ task_type: WaitlistTaskType; started_at: Date | string; completed_at: Date | string | null }[]>`
      select task_type, started_at, completed_at
      from waitlist_task_progress where session_id = ${sessionId}::uuid
    `,
    rankedEntryBySession(sessionId),
    sql<{ count: number }[]>`select count(*)::integer as count from waitlist_entries`,
    sql<RankedEntryRow[]>`
      with ranked as (
        select entries.*,
          (entries.referral_count + entries.bonus_points)::integer as score,
          row_number() over (
            order by (entries.referral_count + entries.bonus_points) desc,
              entries.joined_at asc, entries.join_number asc
          ) as rank
        from waitlist_entries entries
      )
      select ranked.*, null::text as bonus_post_url
      from ranked order by rank limit 10
    `,
  ]);
  const progress = new Map(taskRows.map((row) => [row.task_type, row]));
  const task = (type: WaitlistTaskType) => {
    const row = progress.get(type);
    return {
      startedAt: row ? iso(row.started_at) : null,
      completedAt: row ? iso(row.completed_at) : null,
    };
  };
  return {
    tasks: {
      followNotifications: task("follow_notifications"),
      engagePost: task("engage_post"),
    },
    entry,
    totalEntries: Number(totalRows[0]?.count ?? 0),
    leaderboard: leaderboardRows.map((row) => mapEntry(row, false)),
  };
}

export async function startWaitlistTask(sessionId: string, taskType: WaitlistTaskType) {
  await ensureWaitlistSchema();
  if (taskType === "engage_post" && !getWaitlistXPostUrl()) {
    throw new HttpError(503, "The BunnyHood campaign post has not been configured yet.", "WAITLIST_POST_NOT_CONFIGURED");
  }
  const sql = getDb();
  const rows = await sql<{ started_at: Date | string; completed_at: Date | string | null }[]>`
    insert into waitlist_task_progress (session_id, task_type)
    values (${sessionId}::uuid, ${taskType})
    on conflict (session_id, task_type) do update set task_type = excluded.task_type
    returning started_at, completed_at
  `;
  return {
    startedAt: iso(rows[0].started_at),
    completedAt: iso(rows[0].completed_at),
    waitMs: rows[0].completed_at ? 0 : WAITLIST_TASK_WAIT_MS,
  };
}

export async function completeWaitlistTask(sessionId: string, taskType: WaitlistTaskType) {
  await ensureWaitlistSchema();
  return inTransaction(async (sql) => {
    const rows = await sql<{
      started_at: Date | string;
      completed_at: Date | string | null;
      elapsed_ms: number | string;
    }[]>`
      select started_at, completed_at,
        extract(epoch from (now() - started_at)) * 1000 as elapsed_ms
      from waitlist_task_progress
      where session_id = ${sessionId}::uuid and task_type = ${taskType}
      for update
    `;
    const row = rows[0];
    if (!row) throw new HttpError(409, "Open the task first, then confirm it.", "WAITLIST_TASK_NOT_STARTED");
    if (!row.completed_at && Number(row.elapsed_ms) < WAITLIST_TASK_WAIT_MS) {
      const remaining = Math.ceil((WAITLIST_TASK_WAIT_MS - Number(row.elapsed_ms)) / 1_000);
      throw new HttpError(409, `Return after ${remaining} second${remaining === 1 ? "" : "s"} to confirm.`, "WAITLIST_TASK_TIMER_ACTIVE");
    }
    const completed = await sql<{ completed_at: Date | string }[]>`
      update waitlist_task_progress
      set completed_at = coalesce(completed_at, now())
      where session_id = ${sessionId}::uuid and task_type = ${taskType}
      returning completed_at
    `;
    return { completedAt: iso(completed[0].completed_at) };
  });
}

function normalizeWallet(value: string) {
  const wallet = value.trim();
  if (!isAddress(wallet)) {
    throw new HttpError(400, "Enter a valid EVM wallet address.", "BAD_WALLET");
  }
  return getAddress(wallet);
}

async function createReferralCode(sql: SpinDb) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `bh${randomBytes(8).toString("hex")}`;
    const existing = await sql<{ exists: boolean }[]>`
      select exists(select 1 from waitlist_entries where referral_code = ${candidate}) as exists
    `;
    if (!existing[0]?.exists) return candidate;
  }
  throw new HttpError(503, "A referral code could not be created. Try again.", "REFERRAL_CODE_FAILED");
}

export async function joinWaitlist(sessionId: string, rawWallet: string, incomingReferralCode: string | null) {
  await ensureWaitlistSchema();
  const wallet = normalizeWallet(rawWallet);
  const result = await inTransaction(async (sql) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`waitlist-session:${sessionId}`}))`;
    await sql`select pg_advisory_xact_lock(hashtext(${`waitlist-wallet:${wallet.toLowerCase()}`}))`;
    const existing = await sql<{ id: string; wallet_address: string }[]>`
      select id, wallet_address from waitlist_entries
      where session_id = ${sessionId}::uuid limit 1 for update
    `;
    if (existing[0]) {
      if (existing[0].wallet_address.toLowerCase() !== wallet.toLowerCase()) {
        throw new HttpError(409, "This browser session already joined with another wallet.", "WAITLIST_ALREADY_JOINED");
      }
      return { entryId: existing[0].id };
    }

    const completed = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from waitlist_task_progress
      where session_id = ${sessionId}::uuid
        and task_type in ('follow_notifications', 'engage_post')
        and completed_at is not null
    `;
    if (Number(completed[0]?.count ?? 0) !== 2) {
      throw new HttpError(409, "Complete both required tasks before joining.", "WAITLIST_TASKS_INCOMPLETE");
    }

    const walletOwner = await sql<{ id: string }[]>`
      select id from waitlist_entries where lower(wallet_address) = ${wallet.toLowerCase()} limit 1 for update
    `;
    if (walletOwner[0]) {
      throw new HttpError(409, "This wallet is already on the waitlist. Use rank search to find it.", "WAITLIST_WALLET_EXISTS");
    }

    let referrer: { id: string; referral_code: string } | undefined;
    if (incomingReferralCode) {
      const referrerRows = await sql<{ id: string; referral_code: string }[]>`
        select id, referral_code from waitlist_entries
        where referral_code = ${incomingReferralCode}
        limit 1 for update
      `;
      referrer = referrerRows[0];
    }
    const referralCode = await createReferralCode(sql);
    const inserted = await sql<{ id: string }[]>`
      insert into waitlist_entries (
        session_id, wallet_address, referral_code, referred_by_entry_id
      ) values (
        ${sessionId}::uuid, ${wallet}, ${referralCode}, ${referrer?.id ?? null}::uuid
      )
      returning id
    `;
    const entryId = inserted[0].id;
    if (referrer) {
      await sql`
        insert into waitlist_referrals (
          referrer_entry_id, referred_entry_id, referral_code
        ) values (${referrer.id}::uuid, ${entryId}::uuid, ${referrer.referral_code})
      `;
      await sql`
        update waitlist_entries
        set referral_count = referral_count + 1, updated_at = now()
        where id = ${referrer.id}::uuid
      `;
      await queueWaitlistEntrySnapshot(sql, referrer.id);
    }
    await queueWaitlistEntrySnapshot(sql, entryId);
    return { entryId };
  });
  return rankedEntryById(result.entryId);
}

export async function submitWaitlistBonusPost(sessionId: string, rawPostUrl: string) {
  await ensureWaitlistSchema();
  const { postId, postUrl } = parseWaitlistPostUrl(rawPostUrl);
  const result = await inTransaction(async (sql) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`waitlist-bonus:${postId}`}))`;
    const entries = await sql<{ id: string }[]>`
      select id from waitlist_entries where session_id = ${sessionId}::uuid limit 1 for update
    `;
    const entry = entries[0];
    if (!entry) throw new HttpError(409, "Join the waitlist before claiming the bonus point.", "WAITLIST_JOIN_REQUIRED");
    const existing = await sql<{ post_url: string }[]>`
      select post_url from waitlist_bonus_posts where entry_id = ${entry.id}::uuid limit 1
    `;
    if (existing[0]) {
      if (existing[0].post_url !== postUrl) {
        throw new HttpError(409, "This wallet already received its one post bonus.", "WAITLIST_BONUS_EXISTS");
      }
      return entry.id;
    }
    const reused = await sql<{ exists: boolean }[]>`
      select exists(select 1 from waitlist_bonus_posts where post_id = ${postId}) as exists
    `;
    if (reused[0]?.exists) {
      throw new HttpError(409, "That X post was already used for a waitlist bonus.", "WAITLIST_POST_USED");
    }
    await sql`
      insert into waitlist_bonus_posts (entry_id, post_url, post_id)
      values (${entry.id}::uuid, ${postUrl}, ${postId})
    `;
    await sql`
      update waitlist_entries set bonus_points = 1, updated_at = now()
      where id = ${entry.id}::uuid
    `;
    await queueWaitlistEntrySnapshot(sql, entry.id);
    return entry.id;
  });
  return rankedEntryById(result);
}

export async function searchWaitlistRank(rawQuery: string) {
  await ensureWaitlistSchema();
  const query = rawQuery.trim().toLowerCase();
  if (!query || query.length > 80) throw new HttpError(400, "Enter a wallet address or referral code.", "BAD_WAITLIST_SEARCH");
  const walletQuery = isAddress(query) ? getAddress(query).toLowerCase() : null;
  const referralQuery = /^bh[a-z0-9]{12,22}$/.test(query) ? query : null;
  if (!walletQuery && !referralQuery) {
    throw new HttpError(400, "Enter a complete EVM wallet address or BunnyHood referral code.", "BAD_WAITLIST_SEARCH");
  }
  const sql = getDb();
  const rows = walletQuery ? await sql<RankedEntryRow[]>`
    with ranked as (
      select entries.*,
        (entries.referral_count + entries.bonus_points)::integer as score,
        row_number() over (
          order by (entries.referral_count + entries.bonus_points) desc,
            entries.joined_at asc, entries.join_number asc
        ) as rank
      from waitlist_entries entries
    )
    select ranked.*, null::text as bonus_post_url from ranked
    where lower(wallet_address) = ${walletQuery} limit 1
  ` : await sql<RankedEntryRow[]>`
    with ranked as (
      select entries.*,
        (entries.referral_count + entries.bonus_points)::integer as score,
        row_number() over (
          order by (entries.referral_count + entries.bonus_points) desc,
            entries.joined_at asc, entries.join_number asc
        ) as rank
      from waitlist_entries entries
    )
    select ranked.*, null::text as bonus_post_url from ranked
    where referral_code = ${referralQuery} limit 1
  `;
  return rows[0] ? mapEntry(rows[0], false) : null;
}

export async function getWaitlistAdminData(search = "") {
  await ensureWaitlistSchema();
  const sql = getDb();
  const term = search.trim().toLowerCase().slice(0, 100);
  const [stats, rows] = await Promise.all([
    sql<{
      entries: number;
      referrals: number;
      bonus_posts: number;
      pending_sync: number;
      failed_sync: number;
    }[]>`
      select
        (select count(*)::integer from waitlist_entries) as entries,
        (select count(*)::integer from waitlist_referrals) as referrals,
        (select count(*)::integer from waitlist_bonus_posts) as bonus_posts,
        (select count(*)::integer from waitlist_sheet_outbox where delivered_at is null) as pending_sync,
        (select count(*)::integer from waitlist_sheet_outbox where delivered_at is null and attempts > 0) as failed_sync
    `,
    sql<{
      id: string;
      join_number: number | string;
      rank: number | string;
      wallet_address: string;
      referral_code: string;
      referred_by_code: string | null;
      referral_count: number;
      bonus_points: number;
      score: number;
      joined_at: Date | string;
      follow_completed_at: Date | string | null;
      engage_completed_at: Date | string | null;
      bonus_post_url: string | null;
    }[]>`
      with ranked as (
        select entries.*,
          (entries.referral_count + entries.bonus_points)::integer as score,
          row_number() over (
            order by (entries.referral_count + entries.bonus_points) desc,
              entries.joined_at asc, entries.join_number asc
          ) as rank
        from waitlist_entries entries
      )
      select ranked.id, ranked.join_number, ranked.rank, ranked.wallet_address,
        ranked.referral_code, referrer.referral_code as referred_by_code,
        ranked.referral_count, ranked.bonus_points, ranked.score, ranked.joined_at,
        max(tasks.completed_at) filter (where tasks.task_type = 'follow_notifications') as follow_completed_at,
        max(tasks.completed_at) filter (where tasks.task_type = 'engage_post') as engage_completed_at,
        bonus.post_url as bonus_post_url
      from ranked
      left join waitlist_entries referrer on referrer.id = ranked.referred_by_entry_id
      left join waitlist_task_progress tasks on tasks.session_id = ranked.session_id
      left join waitlist_bonus_posts bonus on bonus.entry_id = ranked.id
      where ${term} = ''
        or lower(ranked.wallet_address) like ${`%${term}%`}
        or ranked.referral_code like ${`%${term}%`}
        or coalesce(bonus.post_url, '') like ${`%${term}%`}
      group by ranked.id, ranked.join_number, ranked.rank, ranked.wallet_address,
        ranked.referral_code, referrer.referral_code, ranked.referral_count,
        ranked.bonus_points, ranked.score, ranked.joined_at, bonus.post_url
      order by ranked.rank limit 500
    `,
  ]);
  return {
    stats: {
      entries: Number(stats[0]?.entries ?? 0),
      referrals: Number(stats[0]?.referrals ?? 0),
      bonusPosts: Number(stats[0]?.bonus_posts ?? 0),
      pendingSync: Number(stats[0]?.pending_sync ?? 0),
      failedSync: Number(stats[0]?.failed_sync ?? 0),
    },
    rows: rows.map((row) => ({
      id: row.id,
      joinNumber: Number(row.join_number),
      rank: Number(row.rank),
      walletAddress: row.wallet_address,
      referralCode: row.referral_code,
      referredByCode: row.referred_by_code,
      referralCount: Number(row.referral_count),
      bonusPoints: Number(row.bonus_points),
      points: Number(row.score),
      joinedAt: iso(row.joined_at),
      followCompletedAt: iso(row.follow_completed_at),
      engageCompletedAt: iso(row.engage_completed_at),
      bonusPostUrl: row.bonus_post_url,
    })),
  };
}
