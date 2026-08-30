import "server-only";

import type { SpinDb } from "@/lib/spin/db";
import { getDb } from "@/lib/spin/db";
import { getWaitlistSheetsConfig } from "./config";
import { ensureWaitlistSchema } from "./schema";

type SnapshotRow = {
  entry_id: string;
  join_number: number | string;
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
  bonus_submitted_at: Date | string | null;
};

function iso(value: Date | string | null) {
  return value ? new Date(value).toISOString() : null;
}

export async function queueWaitlistEntrySnapshot(sql: SpinDb, entryId: string) {
  const rows = await sql<SnapshotRow[]>`
    select
      entries.id as entry_id,
      entries.join_number,
      entries.wallet_address,
      entries.referral_code,
      referrer.referral_code as referred_by_code,
      entries.referral_count,
      entries.bonus_points,
      (2 + entries.referral_count + entries.bonus_points)::integer as score,
      entries.joined_at,
      max(tasks.completed_at) filter (where tasks.task_type = 'follow_notifications') as follow_completed_at,
      max(tasks.completed_at) filter (where tasks.task_type = 'engage_post') as engage_completed_at,
      bonus.post_url as bonus_post_url,
      bonus.submitted_at as bonus_submitted_at
    from waitlist_entries entries
    left join waitlist_entries referrer on referrer.id = entries.referred_by_entry_id
    left join waitlist_task_progress tasks on tasks.session_id = entries.session_id
    left join waitlist_bonus_posts bonus on bonus.entry_id = entries.id
    where entries.id = ${entryId}::uuid
    group by entries.id, referrer.referral_code, bonus.post_url, bonus.submitted_at
  `;
  const row = rows[0];
  if (!row) return;
  const payload = {
    entryId: row.entry_id,
    joinNumber: Number(row.join_number),
    walletAddress: row.wallet_address,
    referralCode: row.referral_code,
    referredByCode: row.referred_by_code,
    referralCount: Number(row.referral_count),
    bonusPoints: Number(row.bonus_points),
    score: Number(row.score),
    joinedAt: iso(row.joined_at),
    followNotificationsCompletedAt: iso(row.follow_completed_at),
    engagePostCompletedAt: iso(row.engage_completed_at),
    bonusPostUrl: row.bonus_post_url,
    bonusSubmittedAt: iso(row.bonus_submitted_at),
  };
  await sql`
    insert into waitlist_sheet_outbox (event_type, dedupe_key, payload)
    values ('entry_snapshot', ${`waitlist-entry:${entryId}`}, ${sql.json(payload)})
    on conflict (dedupe_key) do update set
      payload = excluded.payload,
      revision = waitlist_sheet_outbox.revision + 1,
      attempts = 0,
      next_attempt_at = now(),
      locked_until = null,
      delivered_at = null,
      last_error = null,
      updated_at = now()
  `;
}

type OutboxRow = {
  id: string;
  dedupe_key: string;
  payload: Record<string, unknown>;
  revision: number;
};

export async function flushWaitlistSheetOutbox(limit = 50) {
  await ensureWaitlistSchema();
  const config = getWaitlistSheetsConfig();
  if (!config) return { configured: false, delivered: 0, pending: 0 };
  const sql = getDb();
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const rows = await sql<OutboxRow[]>`
    with picked as (
      select id
      from waitlist_sheet_outbox
      where delivered_at is null
        and next_attempt_at <= now()
        and (locked_until is null or locked_until < now())
      order by id
      limit ${safeLimit}
      for update skip locked
    )
    update waitlist_sheet_outbox outbox
    set locked_until = now() + interval '2 minutes', updated_at = now()
    from picked
    where outbox.id = picked.id
    returning outbox.id::text, outbox.dedupe_key, outbox.payload, outbox.revision
  `;
  if (!rows.length) {
    const pending = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from waitlist_sheet_outbox where delivered_at is null
    `;
    return { configured: true, delivered: 0, pending: Number(pending[0]?.count ?? 0) };
  }

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: config.secret,
        events: rows.map((row) => ({
          key: row.dedupe_key,
          revision: Number(row.revision),
          data: row.payload,
        })),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const reply = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
    if (!response.ok || reply.ok !== true) {
      throw new Error(reply.error || `Google Sheets webhook returned HTTP ${response.status}.`);
    }
    for (const row of rows) {
      await sql`
        update waitlist_sheet_outbox
        set delivered_at = now(), locked_until = null, last_error = null, updated_at = now()
        where id = ${row.id}::bigint and revision = ${Number(row.revision)}
      `;
    }
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Google Sheets sync failed").slice(0, 500);
    for (const row of rows) {
      await sql`
        update waitlist_sheet_outbox
        set attempts = attempts + 1,
            next_attempt_at = now() + (least(3600, greatest(30, power(2, least(attempts, 7))::integer * 30)) * interval '1 second'),
            locked_until = null,
            last_error = ${message},
            updated_at = now()
        where id = ${row.id}::bigint and revision = ${Number(row.revision)}
      `;
    }
    throw error;
  }

  const pending = await sql<{ count: number }[]>`
    select count(*)::integer as count
    from waitlist_sheet_outbox where delivered_at is null
  `;
  return { configured: true, delivered: rows.length, pending: Number(pending[0]?.count ?? 0) };
}
