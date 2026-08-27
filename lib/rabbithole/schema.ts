import { getDb, inTransaction } from "@/lib/spin/db";
import { ensureProductionSchema } from "@/lib/spin/schema";

const MIGRATION_ID = "009_rabbit_hole_claims";

const statements = [
  `create table if not exists rabbit_hole_allowlist (
    id uuid primary key,
    x_user_id text unique,
    x_username text not null,
    x_username_normalized text not null unique,
    x_name text,
    x_profile_image_url text,
    eligible boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (x_username_normalized ~ '^[a-z0-9_]{1,15}$')
  )`,
  `create index if not exists rabbit_hole_allowlist_status_idx
    on rabbit_hole_allowlist (eligible, updated_at desc)`,
  `create table if not exists rabbit_hole_claims (
    id uuid primary key,
    allowlist_id uuid not null unique references rabbit_hole_allowlist(id) on delete restrict,
    user_id uuid not null unique references spin_users(id) on delete restrict,
    x_user_id text not null unique,
    x_username text not null,
    x_name text not null,
    x_profile_image_url text,
    wallet_address text not null,
    claim_key char(66) not null unique,
    status text not null default 'PENDING'
      check (status in ('PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED')),
    chain_id integer not null check (chain_id in (4663, 46630)),
    contract_address text not null,
    metadata_uri text not null,
    transaction_hash char(66) unique,
    token_id numeric(78, 0) unique,
    mint_attempts integer not null default 0 check (mint_attempts between 0 and 10),
    last_error_code text,
    submitted_at timestamptz,
    confirmed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (wallet_address ~ '^0x[0-9A-Fa-f]{40}$'),
    check (contract_address ~ '^0x[0-9A-Fa-f]{40}$'),
    check (claim_key ~ '^0x[0-9A-Fa-f]{64}$'),
    check (transaction_hash is null or transaction_hash ~ '^0x[0-9A-Fa-f]{64}$'),
    check (token_id is null or token_id > 0),
    check ((status = 'CONFIRMED' and token_id is not null and confirmed_at is not null)
      or status <> 'CONFIRMED')
  )`,
  `create unique index if not exists rabbit_hole_claims_wallet_lower_unique
    on rabbit_hole_claims (lower(wallet_address))`,
  `create index if not exists rabbit_hole_claims_status_idx
    on rabbit_hole_claims (status, updated_at desc)`,
  `create or replace function enforce_rabbit_hole_allowlist_capacity()
    returns trigger language plpgsql as $$
    begin
      if new.eligible then
        perform pg_advisory_xact_lock(hashtext('rabbit-hole-allowlist-capacity'));
        if (select count(*) from rabbit_hole_allowlist where eligible) > 100 then
          raise exception 'Rabbit Hole allowlist is limited to 100 eligible users.';
        end if;
      end if;
      return new;
    end;
    $$`,
  `drop trigger if exists rabbit_hole_allowlist_capacity_trigger on rabbit_hole_allowlist`,
  `create trigger rabbit_hole_allowlist_capacity_trigger
    after insert or update of eligible on rabbit_hole_allowlist
    for each row execute function enforce_rabbit_hole_allowlist_capacity()`,
] as const;

declare global {
  var bunnyHoodRabbitHoleSchema: Promise<void> | undefined;
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
    await transaction`select pg_advisory_xact_lock(hashtext('bunny-hood-production-schema'))`;
    const rechecked = await transaction<{ applied: boolean }[]>`
      select exists(
        select 1 from spin_schema_migrations where migration_id = ${MIGRATION_ID}
      ) as applied
    `;
    if (rechecked[0]?.applied) return;
    for (const statement of statements) await transaction.unsafe(statement);
    await transaction`
      insert into spin_schema_migrations (migration_id)
      values (${MIGRATION_ID})
      on conflict (migration_id) do nothing
    `;
  });
}

export async function ensureRabbitHoleSchema() {
  if (!globalThis.bunnyHoodRabbitHoleSchema) {
    globalThis.bunnyHoodRabbitHoleSchema = migrate().catch((error) => {
      globalThis.bunnyHoodRabbitHoleSchema = undefined;
      throw error;
    });
  }
  return globalThis.bunnyHoodRabbitHoleSchema;
}
