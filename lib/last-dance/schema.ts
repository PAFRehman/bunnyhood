import "server-only";

import { getDb, inTransaction } from "@/lib/spin/db";
import { ensureProductionSchema } from "@/lib/spin/schema";
import { DEFAULT_LAST_DANCE_POST_TEXT } from "./defaults";

const MIGRATION_ID = "022_last_dance_default_post";
const DEFAULT_POST_SQL = `'${DEFAULT_LAST_DANCE_POST_TEXT.replace(/'/g, "''")}'`;

const statements = [
  `create table if not exists last_dance_settings (
    id smallint primary key default 1 check (id = 1),
    public_enabled boolean not null default false,
    max_entries integer not null default 100 check (max_entries between 1 and 100000),
    engagement_post_url text not null default 'https://x.com/BunnysHood',
    post_text text not null default ${DEFAULT_POST_SQL},
    updated_at timestamptz not null default now()
  )`,
  `insert into last_dance_settings (id) values (1) on conflict (id) do nothing`,
  `create table if not exists last_dance_engagements (
    user_id uuid primary key references spin_users(id) on delete cascade,
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    check (completed_at is null or completed_at >= started_at)
  )`,
  `create table if not exists last_dance_posts (
    user_id uuid primary key references spin_users(id) on delete cascade,
    post_id text not null unique,
    post_url text not null,
    x_username text not null,
    verified_at timestamptz not null default now()
  )`,
  `create table if not exists last_dance_entries (
    id uuid primary key,
    user_id uuid not null unique references spin_users(id) on delete restrict,
    x_user_id text not null unique,
    x_username text not null,
    wallet_address varchar(42) not null,
    nft_count integer not null check (nft_count >= 1),
    transaction_count integer not null check (transaction_count >= 1),
    entered_at timestamptz not null default now(),
    check (wallet_address ~ '^0x[0-9a-f]{40}$')
  )`,
  `create unique index if not exists last_dance_wallet_lower_unique
    on last_dance_entries (lower(wallet_address))`,
  `create index if not exists last_dance_entries_entered_idx
    on last_dance_entries (entered_at desc)`,
  `alter table last_dance_settings
    add column if not exists mint_opens_at timestamptz`,
  `alter table last_dance_settings
    alter column mint_opens_at set default '2026-09-09 15:30:00+00'::timestamptz`,
  `update last_dance_settings
    set mint_opens_at = '2026-09-09 15:30:00+00'::timestamptz,
        updated_at = now()
    where id = 1 and mint_opens_at is null`,
  `alter table last_dance_settings
    alter column post_text set default ${DEFAULT_POST_SQL}`,
  `update last_dance_settings
    set post_text = ${DEFAULT_POST_SQL},
        updated_at = now()
    where id = 1`,
] as const;

declare global {
  var bunnyHoodLastDanceSchema: Promise<void> | undefined;
}

async function migrate() {
  await ensureProductionSchema();
  const sql = getDb();
  const applied = await sql<{ applied: boolean }[]>`
    select exists(
      select 1 from spin_schema_migrations where migration_id = ${MIGRATION_ID}
    ) as applied
  `;
  if (applied[0]?.applied) return;

  await inTransaction(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtext('bunny-hood-last-dance-schema'))`;
    const alreadyApplied = await transaction<{ applied: boolean }[]>`
      select exists(
        select 1 from spin_schema_migrations where migration_id = ${MIGRATION_ID}
      ) as applied
    `;
    if (alreadyApplied[0]?.applied) return;
    for (const statement of statements) await transaction.unsafe(statement);
    await transaction`
      insert into spin_schema_migrations (migration_id)
      values (${MIGRATION_ID})
      on conflict (migration_id) do nothing
    `;
  });
}

export async function ensureLastDanceSchema() {
  if (!globalThis.bunnyHoodLastDanceSchema) {
    globalThis.bunnyHoodLastDanceSchema = migrate().catch((error) => {
      globalThis.bunnyHoodLastDanceSchema = undefined;
      throw error;
    });
  }
  return globalThis.bunnyHoodLastDanceSchema;
}
