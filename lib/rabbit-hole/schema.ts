import "server-only";

import { getDb, inTransaction } from "@/lib/spin/db";
import { HttpError } from "@/lib/spin/http";

const rabbitHoleMigrations = [
  {
    id: "009_rabbit_hole_sbt",
    statements: [
  `create extension if not exists pgcrypto`,
  `create table if not exists rabbit_hole_eligibility (
    id uuid primary key default gen_random_uuid(),
    x_username text not null,
    x_username_normalized text not null unique
      check (x_username_normalized ~ '^[a-z0-9_]{1,15}$'),
    x_user_id text unique,
    x_name text,
    x_profile_image_url text,
    pfp_content_type text check (
      pfp_content_type is null or pfp_content_type in ('image/jpeg', 'image/png', 'image/webp')
    ),
    pfp_base64 text,
    status text not null default 'eligible'
      check (status in ('eligible', 'minting', 'claimed', 'failed')),
    wallet_address text,
    active_attempt_id uuid,
    transaction_hash text unique,
    token_id numeric(78, 0),
    claim_key text unique,
    contract_address text,
    chain_id bigint,
    metadata_url text,
    failure_reason text,
    imported_at timestamptz not null default now(),
    connected_at timestamptz,
    claim_started_at timestamptz,
    claimed_at timestamptz,
    updated_at timestamptz not null default now(),
    check (wallet_address is null or wallet_address ~ '^0x[0-9a-f]{40}$'),
    check (transaction_hash is null or transaction_hash ~ '^0x[0-9a-f]{64}$'),
    check (claim_key is null or claim_key ~ '^0x[0-9a-f]{64}$'),
    check (contract_address is null or contract_address ~ '^0x[0-9a-f]{40}$'),
    check (
      status <> 'claimed'
      or (
        wallet_address is not null
        and token_id is not null
        and claim_key is not null
        and contract_address is not null
        and chain_id is not null
        and claimed_at is not null
      )
    )
  )`,
  `create unique index if not exists rabbit_hole_active_wallet_unique
    on rabbit_hole_eligibility(lower(wallet_address))
    where wallet_address is not null and status in ('minting', 'claimed')`,
  `create index if not exists rabbit_hole_status_updated_idx
    on rabbit_hole_eligibility(status, updated_at desc)`,
  `create table if not exists rabbit_hole_claim_attempts (
    id uuid primary key,
    eligibility_id uuid not null references rabbit_hole_eligibility(id) on delete restrict,
    wallet_address text not null check (wallet_address ~ '^0x[0-9a-f]{40}$'),
    status text not null default 'processing'
      check (status in ('processing', 'submitted', 'confirmed', 'failed', 'reconciled')),
    transaction_hash text unique,
    token_id numeric(78, 0),
    error_code text,
    error_message text,
    created_at timestamptz not null default now(),
    submitted_at timestamptz,
    completed_at timestamptz,
    updated_at timestamptz not null default now(),
    check (transaction_hash is null or transaction_hash ~ '^0x[0-9a-f]{64}$')
  )`,
  `create index if not exists rabbit_hole_attempts_eligibility_idx
    on rabbit_hole_claim_attempts(eligibility_id, created_at desc)`,
    ],
  },
  {
    id: "010_rabbit_hole_ipfs_art",
    statements: [
      `alter table rabbit_hole_eligibility
        add column if not exists image_cid text,
        add column if not exists metadata_cid text,
        add column if not exists image_url text,
        add column if not exists pinned_at timestamptz`,
      `create unique index if not exists rabbit_hole_metadata_cid_unique
        on rabbit_hole_eligibility(metadata_cid)
        where metadata_cid is not null`,
      `create index if not exists rabbit_hole_claimed_wallet_idx
        on rabbit_hole_eligibility(claimed_at desc, lower(wallet_address))
        where status = 'claimed'`,
    ],
  },
] as const;

declare global {
  var bunnyHoodRabbitHoleSchema: Promise<void> | undefined;
}

const requiredEligibilityColumns = [
  "id",
  "x_username",
  "x_username_normalized",
  "x_user_id",
  "status",
  "wallet_address",
  "transaction_hash",
  "token_id",
  "claim_key",
  "contract_address",
  "chain_id",
  "metadata_url",
  "image_cid",
  "metadata_cid",
  "image_url",
  "pinned_at",
  "claimed_at",
] as const;

async function schemaIsHealthy(sql: ReturnType<typeof getDb>) {
  const tables = await sql<{ table_name: string }[]>`
    select table_name
    from information_schema.tables
    where table_schema = current_schema()
      and table_name in ('rabbit_hole_eligibility', 'rabbit_hole_claim_attempts')
  `;
  if (tables.length !== 2) return false;

  const columns = await sql<{ column_name: string }[]>`
    select column_name
    from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'rabbit_hole_eligibility'
  `;
  const names = new Set(columns.map((column) => column.column_name));
  if (!requiredEligibilityColumns.every((column) => names.has(column))) return false;

  const indexes = await sql<{ index_name: string }[]>`
    select indexname as index_name
    from pg_indexes
    where schemaname = current_schema()
      and indexname in (
        'rabbit_hole_active_wallet_unique',
        'rabbit_hole_status_updated_idx',
        'rabbit_hole_attempts_eligibility_idx',
        'rabbit_hole_metadata_cid_unique',
        'rabbit_hole_claimed_wallet_idx'
      )
  `;
  return indexes.length === 5;
}

async function migrate() {
  const sql = getDb();
  await sql`
    create table if not exists spin_schema_migrations (
      migration_id text primary key,
      applied_at timestamptz not null default now()
    )
  `;
  if (await schemaIsHealthy(sql)) return;

  await inTransaction(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtext('bunny-hood-rabbit-hole-schema'))`;
    if (await schemaIsHealthy(transaction)) return;

    // Run every structural statement idempotently. This repairs databases where
    // a migration marker exists but its table/columns were never fully created.
    for (const migration of rabbitHoleMigrations) {
      for (const statement of migration.statements) await transaction.unsafe(statement);
      await transaction`
        insert into spin_schema_migrations (migration_id)
        values (${migration.id})
        on conflict (migration_id) do nothing
      `;
    }
  });
}

export async function ensureRabbitHoleSchema() {
  if (!globalThis.bunnyHoodRabbitHoleSchema) {
    globalThis.bunnyHoodRabbitHoleSchema = migrate().catch((error) => {
      globalThis.bunnyHoodRabbitHoleSchema = undefined;
      const message = error instanceof Error ? error.message : "Unknown database error";
      console.error("Rabbit Hole database initialization failed.", message);
      if (message.includes("Missing required environment variable: DATABASE_URL")) {
        throw new HttpError(
          503,
          "Rabbit Hole storage is not configured. Add DATABASE_URL to this Vercel environment and redeploy.",
          "RABBIT_HOLE_DATABASE_NOT_CONFIGURED",
        );
      }
      throw new HttpError(
        503,
        "Rabbit Hole storage could not be initialized. Verify DATABASE_URL and the Neon database connection, then retry.",
        "RABBIT_HOLE_DATABASE_UNAVAILABLE",
      );
    });
  }
  return globalThis.bunnyHoodRabbitHoleSchema;
}
