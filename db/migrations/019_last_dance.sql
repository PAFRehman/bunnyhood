create table if not exists last_dance_settings (
  id smallint primary key default 1 check (id = 1),
  public_enabled boolean not null default false,
  max_entries integer not null default 100 check (max_entries between 1 and 100000),
  engagement_post_url text not null default 'https://x.com/BunnysHood',
  post_text text not null default 'The Last Dance is here. @BunnysHood',
  updated_at timestamptz not null default now()
);

insert into last_dance_settings (id)
values (1)
on conflict (id) do nothing;

create table if not exists last_dance_engagements (
  user_id uuid primary key references spin_users(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  check (completed_at is null or completed_at >= started_at)
);

create table if not exists last_dance_posts (
  user_id uuid primary key references spin_users(id) on delete cascade,
  post_id text not null unique,
  post_url text not null,
  x_username text not null,
  verified_at timestamptz not null default now()
);

create table if not exists last_dance_entries (
  id uuid primary key,
  user_id uuid not null unique references spin_users(id) on delete restrict,
  x_user_id text not null unique,
  x_username text not null,
  wallet_address varchar(42) not null,
  nft_count integer not null check (nft_count >= 1),
  transaction_count integer not null check (transaction_count >= 1),
  entered_at timestamptz not null default now(),
  check (wallet_address ~ '^0x[0-9a-f]{40}$')
);

create unique index if not exists last_dance_wallet_lower_unique
  on last_dance_entries (lower(wallet_address));
create index if not exists last_dance_entries_entered_idx
  on last_dance_entries (entered_at desc);
