import "server-only";

import { getDb, inTransaction } from "@/lib/spin/db";
import { HttpError } from "@/lib/spin/http";

const MIGRATION_ID = "011_upcoming_products_waitlist";

const statements = [
  `create extension if not exists pgcrypto`,
  `create table if not exists spin_schema_migrations (
    migration_id text primary key,
    applied_at timestamptz not null default now()
  )`,
  `create table if not exists spin_rate_limits (
    bucket_key char(64) primary key,
    window_started_at timestamptz not null,
    hits integer not null check (hits > 0)
  )`,
  `create table if not exists waitlist_sessions (
    id uuid primary key default gen_random_uuid(),
    token_hash char(64) not null unique,
    csrf_hash char(64) not null,
    incoming_referral_code text,
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    check (incoming_referral_code is null or incoming_referral_code ~ '^bh[a-z0-9]{12,22}$')
  )`,
  `create index if not exists waitlist_sessions_expiry_idx on waitlist_sessions(expires_at)`,
  `create table if not exists waitlist_task_progress (
    session_id uuid not null references waitlist_sessions(id) on delete cascade,
    task_type text not null check (task_type in ('follow_notifications', 'engage_post')),
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    primary key (session_id, task_type),
    check (completed_at is null or completed_at >= started_at)
  )`,
  `create table if not exists waitlist_entries (
    id uuid primary key default gen_random_uuid(),
    join_number bigserial not null unique,
    session_id uuid not null unique references waitlist_sessions(id) on delete restrict,
    wallet_address text not null,
    referral_code text not null unique check (referral_code ~ '^bh[a-z0-9]{12,22}$'),
    referred_by_entry_id uuid references waitlist_entries(id) on delete restrict,
    referral_count integer not null default 0 check (referral_count >= 0),
    bonus_points integer not null default 0 check (bonus_points between 0 and 1),
    joined_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (wallet_address ~ '^0x[0-9a-fA-F]{40}$'),
    check (referred_by_entry_id is null or referred_by_entry_id <> id)
  )`,
  `create unique index if not exists waitlist_wallet_lower_unique on waitlist_entries(lower(wallet_address))`,
  `create index if not exists waitlist_rank_idx on waitlist_entries((referral_count + bonus_points) desc, joined_at, join_number)`,
  `create index if not exists waitlist_referrer_idx on waitlist_entries(referred_by_entry_id) where referred_by_entry_id is not null`,
  `create table if not exists waitlist_referrals (
    id uuid primary key default gen_random_uuid(),
    referrer_entry_id uuid not null references waitlist_entries(id) on delete restrict,
    referred_entry_id uuid not null unique references waitlist_entries(id) on delete restrict,
    referral_code text not null,
    points_awarded integer not null default 1 check (points_awarded = 1),
    created_at timestamptz not null default now(),
    check (referrer_entry_id <> referred_entry_id)
  )`,
  `create index if not exists waitlist_referrals_referrer_created_idx on waitlist_referrals(referrer_entry_id, created_at desc)`,
  `create table if not exists waitlist_bonus_posts (
    id uuid primary key default gen_random_uuid(),
    entry_id uuid not null unique references waitlist_entries(id) on delete restrict,
    post_url text not null unique,
    post_id text not null unique check (post_id ~ '^[0-9]{5,30}$'),
    points_awarded integer not null default 1 check (points_awarded = 1),
    submitted_at timestamptz not null default now()
  )`,
  `create table if not exists waitlist_sheet_outbox (
    id bigserial primary key,
    event_type text not null default 'entry_snapshot' check (event_type = 'entry_snapshot'),
    dedupe_key text not null unique,
    payload jsonb not null,
    revision integer not null default 1 check (revision > 0),
    attempts integer not null default 0 check (attempts >= 0),
    next_attempt_at timestamptz not null default now(),
    locked_until timestamptz,
    delivered_at timestamptz,
    last_error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `create index if not exists waitlist_sheet_outbox_pending_idx
    on waitlist_sheet_outbox(next_attempt_at, id) where delivered_at is null`,
] as const;

declare global {
  var bunnyHoodWaitlistSchema: Promise<void> | undefined;
}

async function schemaIsHealthy(sql: ReturnType<typeof getDb>) {
  const rows = await sql<{ count: number }[]>`
    select count(*)::integer as count
    from information_schema.tables
    where table_schema = current_schema()
      and table_name in (
        'spin_rate_limits',
        'waitlist_sessions', 'waitlist_task_progress', 'waitlist_entries',
        'waitlist_referrals', 'waitlist_bonus_posts', 'waitlist_sheet_outbox'
      )
  `;
  return Number(rows[0]?.count ?? 0) === 7;
}

async function migrate() {
  const sql = getDb();
  if (await schemaIsHealthy(sql)) return;
  await inTransaction(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtext('bunny-hood-waitlist-schema'))`;
    if (await schemaIsHealthy(transaction)) return;
    for (const statement of statements) await transaction.unsafe(statement);
    await transaction`
      insert into spin_schema_migrations (migration_id)
      values (${MIGRATION_ID})
      on conflict (migration_id) do nothing
    `;
  });
}

export async function ensureWaitlistSchema() {
  if (!globalThis.bunnyHoodWaitlistSchema) {
    globalThis.bunnyHoodWaitlistSchema = migrate().catch((error) => {
      globalThis.bunnyHoodWaitlistSchema = undefined;
      const message = error instanceof Error ? error.message : "Unknown database error";
      console.error("Waitlist database initialization failed.", message);
      throw new HttpError(
        503,
        message.includes("DATABASE_URL")
          ? "Waitlist storage is not configured. Add DATABASE_URL and redeploy."
          : "Waitlist storage could not be initialized. Verify the Neon connection and retry.",
        "WAITLIST_DATABASE_UNAVAILABLE",
      );
    });
  }
  return globalThis.bunnyHoodWaitlistSchema;
}
