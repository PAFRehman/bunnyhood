begin;

create table if not exists spin_users (
  id uuid primary key,
  x_user_id text not null unique,
  x_username text not null,
  x_name text not null,
  x_profile_image_url text,
  x_account_created_at timestamptz,
  x_access_token_enc text not null,
  x_refresh_token_enc text,
  x_token_expires_at timestamptz not null,
  spins_available integer not null default 0 check (spins_available >= 0),
  spins_used bigint not null default 0 check (spins_used >= 0),
  points integer not null default 0 check (points >= 0),
  total_wins integer not null default 0 check (total_wins between 0 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop index if exists spin_users_username_lower_unique;
create index if not exists spin_users_username_lower_idx
  on spin_users (lower(x_username));

create table if not exists spin_sessions (
  id uuid primary key,
  user_id uuid not null references spin_users(id) on delete cascade,
  token_hash char(64) not null unique,
  csrf_hash char(64) not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists spin_sessions_user_idx on spin_sessions(user_id);
create index if not exists spin_sessions_expiry_idx on spin_sessions(expires_at);

create table if not exists spin_campaigns (
  id uuid primary key,
  title text not null,
  tweet_id text not null,
  tweet_url text not null,
  code_hash char(64) not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create unique index if not exists spin_campaigns_one_active_unique
  on spin_campaigns ((true)) where active = true;
create index if not exists spin_campaigns_active_time_idx
  on spin_campaigns(active, starts_at, ends_at);

create table if not exists spin_task_starts (
  id uuid primary key,
  user_id uuid not null references spin_users(id) on delete cascade,
  campaign_id uuid not null references spin_campaigns(id) on delete cascade,
  task_type text not null check (task_type in ('like', 'repost', 'comment')),
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, campaign_id, task_type)
);

create index if not exists spin_task_starts_campaign_idx on spin_task_starts(campaign_id);

create table if not exists spin_task_claims (
  id uuid primary key,
  user_id uuid not null references spin_users(id) on delete cascade,
  campaign_id uuid not null references spin_campaigns(id) on delete cascade,
  task_type text not null check (task_type in ('like', 'repost', 'comment')),
  awarded_spins integer not null default 1 check (awarded_spins = 1),
  verified_at timestamptz not null default now(),
  unique (user_id, campaign_id, task_type)
);

create index if not exists spin_task_claims_campaign_idx on spin_task_claims(campaign_id);

create table if not exists spin_code_redemptions (
  id uuid primary key,
  user_id uuid not null references spin_users(id) on delete cascade,
  campaign_id uuid not null references spin_campaigns(id) on delete cascade,
  awarded_spins integer not null check (awarded_spins between 10 and 20),
  redeemed_at timestamptz not null default now(),
  unique (user_id, campaign_id)
);

create table if not exists spin_prize_slots (
  id uuid primary key,
  prize_day date not null,
  prize_type text not null check (prize_type in ('GTD', 'FCFS1', 'FCFS2')),
  slot_number integer not null check (slot_number > 0),
  release_at timestamptz not null,
  claim_after integer not null check (claim_after between 1 and 5),
  attempts integer not null default 0 check (attempts >= 0),
  winner_user_id uuid references spin_users(id) on delete restrict,
  spin_event_id uuid unique,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (prize_day, prize_type, slot_number),
  check ((winner_user_id is null and claimed_at is null) or (winner_user_id is not null and claimed_at is not null))
);

create index if not exists spin_prize_slots_release_idx
  on spin_prize_slots(prize_day, release_at) where winner_user_id is null;

create table if not exists spin_events (
  id uuid primary key,
  user_id uuid not null references spin_users(id) on delete cascade,
  idempotency_key uuid not null,
  result text not null check (result in ('NONE', 'GTD', 'FCFS1', 'FCFS2')),
  prize_slot_id uuid references spin_prize_slots(id) on delete restrict,
  spins_before integer not null check (spins_before > 0),
  spins_after integer not null check (spins_after >= 0),
  response jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

alter table spin_prize_slots
  drop constraint if exists spin_prize_slots_spin_event_fk;
alter table spin_prize_slots
  add constraint spin_prize_slots_spin_event_fk
  foreign key (spin_event_id) references spin_events(id) deferrable initially deferred;

create index if not exists spin_events_user_created_idx on spin_events(user_id, created_at desc);

create table if not exists spin_wins (
  id uuid primary key,
  user_id uuid not null references spin_users(id) on delete restrict,
  prize_slot_id uuid not null unique references spin_prize_slots(id) on delete restrict,
  prize_type text not null check (prize_type in ('GTD', 'FCFS1', 'FCFS2')),
  won_at timestamptz not null default now(),
  wallet_address text,
  wallet_submitted_at timestamptz,
  check (wallet_address is null or wallet_address ~ '^0x[0-9A-Fa-f]{40}$'),
  check ((wallet_address is null and wallet_submitted_at is null) or (wallet_address is not null and wallet_submitted_at is not null))
);

create unique index if not exists spin_wins_wallet_lower_unique
  on spin_wins(lower(wallet_address)) where wallet_address is not null;
create index if not exists spin_wins_user_idx on spin_wins(user_id, won_at desc);

create table if not exists spin_rate_limits (
  bucket_key char(64) primary key,
  window_started_at timestamptz not null,
  hits integer not null check (hits > 0)
);

create table if not exists spin_sheet_outbox (
  id bigserial primary key,
  event_type text not null check (event_type in ('spin_user', 'spin_win')),
  dedupe_key text not null unique,
  payload jsonb not null,
  revision integer not null default 1,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table spin_sheet_outbox
  add column if not exists revision integer not null default 1;

create index if not exists spin_sheet_outbox_pending_idx
  on spin_sheet_outbox(next_attempt_at, id) where delivered_at is null;

commit;
