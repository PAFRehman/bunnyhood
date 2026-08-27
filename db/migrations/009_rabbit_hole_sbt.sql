-- Bunny Hood Rabbit Hole eligibility and permanent soulbound claim ledger.

create extension if not exists pgcrypto;

create table if not exists rabbit_hole_eligibility (
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
);

create unique index if not exists rabbit_hole_active_wallet_unique
  on rabbit_hole_eligibility(lower(wallet_address))
  where wallet_address is not null and status in ('minting', 'claimed');

create index if not exists rabbit_hole_status_updated_idx
  on rabbit_hole_eligibility(status, updated_at desc);

create table if not exists rabbit_hole_claim_attempts (
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
);

create index if not exists rabbit_hole_attempts_eligibility_idx
  on rabbit_hole_claim_attempts(eligibility_id, created_at desc);
