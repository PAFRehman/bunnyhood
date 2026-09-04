import "server-only";

import { getDb, inTransaction } from "@/lib/spin/db";
import { HttpError } from "@/lib/spin/http";

const MIGRATION_ID = "013_wallet_eligibility_checker";
const RESET_MIGRATION_ID = "018_checker_wallet_reset";

const statements = [
  `create table if not exists spin_rate_limits (
    bucket_key char(64) primary key,
    window_started_at timestamptz not null,
    hits integer not null check (hits > 0)
  )`,
  `create table if not exists checker_wallets (
    wallet_address text primary key
      check (wallet_address ~ '^0x[0-9a-f]{40}$'),
    eligibility_type text not null
      check (eligibility_type in ('GTD', 'FCFS')),
    imported_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `create index if not exists checker_wallets_type_updated_idx
    on checker_wallets(eligibility_type, updated_at desc)`,
] as const;

declare global {
  var bunnyHoodCheckerSchema: Promise<void> | undefined;
}

async function schemaIsHealthy(sql: ReturnType<typeof getDb>) {
  const rows = await sql<{ healthy: boolean }[]>`
    select
      to_regclass('checker_wallets') is not null
      and to_regclass('checker_wallets_type_updated_idx') is not null
      and to_regclass('spin_rate_limits') is not null
      as healthy
  `;
  return Boolean(rows[0]?.healthy);
}

async function migrate() {
  const sql = getDb();
  await sql`
    create table if not exists spin_schema_migrations (
      migration_id text primary key,
      applied_at timestamptz not null default now()
    )
  `;
  if (!(await schemaIsHealthy(sql))) {
    await inTransaction(async (transaction) => {
      await transaction`select pg_advisory_xact_lock(hashtext('bunny-hood-checker-schema'))`;
      if (await schemaIsHealthy(transaction)) return;
      for (const statement of statements) await transaction.unsafe(statement);
      await transaction`
        insert into spin_schema_migrations (migration_id)
        values (${MIGRATION_ID})
        on conflict (migration_id) do nothing
      `;
    });
  }

  const resetApplied = await sql<{ applied: boolean }[]>`
    select exists(
      select 1 from spin_schema_migrations
      where migration_id = ${RESET_MIGRATION_ID}
    ) as applied
  `;
  if (resetApplied[0]?.applied) return;

  await inTransaction(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtext('bunny-hood-checker-schema'))`;
    const alreadyApplied = await transaction<{ applied: boolean }[]>`
      select exists(
        select 1 from spin_schema_migrations
        where migration_id = ${RESET_MIGRATION_ID}
      ) as applied
    `;
    if (alreadyApplied[0]?.applied) return;

    // This one-time, narrowly scoped reset was requested before the next list import.
    await transaction`delete from checker_wallets`;
    await transaction`
      insert into spin_schema_migrations (migration_id)
      values (${RESET_MIGRATION_ID})
    `;
  });
}

export async function ensureCheckerSchema() {
  if (!globalThis.bunnyHoodCheckerSchema) {
    globalThis.bunnyHoodCheckerSchema = migrate().catch((error) => {
      globalThis.bunnyHoodCheckerSchema = undefined;
      const message = error instanceof Error ? error.message : "Unknown database error";
      console.error("Wallet checker database initialization failed.", message);
      throw new HttpError(
        503,
        "The eligibility checker is updating. Please try again shortly.",
        "CHECKER_DATABASE_UNAVAILABLE",
      );
    });
  }
  return globalThis.bunnyHoodCheckerSchema;
}
