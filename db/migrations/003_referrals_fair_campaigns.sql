begin;

alter table spin_users
  drop constraint if exists spin_users_total_wins_check;

alter table spin_users
  add constraint spin_users_total_wins_check
  check (total_wins between 0 and 9);

alter table spin_users
  add column if not exists referral_code text,
  add column if not exists referral_count integer not null default 0 check (referral_count >= 0),
  add column if not exists referral_spins_earned integer not null default 0 check (referral_spins_earned >= 0);

alter table spin_users
  drop constraint if exists spin_users_referral_code_check;

alter table spin_users
  add constraint spin_users_referral_code_check
  check (referral_code is null or referral_code ~ '^[a-z0-9_]{3,24}$');

create unique index if not exists spin_users_referral_code_lower_unique
  on spin_users(lower(referral_code)) where referral_code is not null;

create table if not exists spin_referral_codes (
  code text primary key check (code ~ '^[a-z0-9_]{3,24}$'),
  user_id uuid not null references spin_users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists spin_referral_codes_user_idx
  on spin_referral_codes(user_id, created_at desc);

insert into spin_referral_codes (code, user_id)
select lower(referral_code), id from spin_users where referral_code is not null
on conflict (code) do nothing;

create table if not exists spin_referrals (
  id uuid primary key,
  referrer_user_id uuid not null references spin_users(id) on delete restrict,
  referred_user_id uuid not null unique references spin_users(id) on delete restrict,
  referral_code text not null,
  awarded_spins integer not null default 3 check (awarded_spins = 3),
  created_at timestamptz not null default now(),
  check (referrer_user_id <> referred_user_id)
);

create index if not exists spin_referrals_referrer_created_idx
  on spin_referrals(referrer_user_id, created_at desc);

alter table spin_campaigns
  add column if not exists expected_users integer not null default 500 check (expected_users between 10 and 1000000),
  add column if not exists expected_spins_per_user integer not null default 360 check (expected_spins_per_user between 1 and 10000),
  add column if not exists campaign_version integer not null default 1 check (campaign_version in (1, 2));

create table if not exists spin_campaign_rounds (
  id uuid primary key,
  campaign_id uuid not null references spin_campaigns(id) on delete cascade,
  round_number integer not null check (round_number between 1 and 20),
  title text not null,
  tweet_id text not null,
  tweet_url text not null,
  code_hash char(64) not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (campaign_id, round_number)
);

create unique index if not exists spin_campaign_rounds_one_active_unique
  on spin_campaign_rounds(campaign_id) where active = true;

insert into spin_campaign_rounds (
  id, campaign_id, round_number, title, tweet_id, tweet_url, code_hash, active, created_at
)
select
  gen_random_uuid(), campaigns.id, 1, campaigns.title, campaigns.tweet_id,
  campaigns.tweet_url, campaigns.code_hash, true, campaigns.created_at
from spin_campaigns campaigns
where not exists (
  select 1 from spin_campaign_rounds rounds where rounds.campaign_id = campaigns.id
);

alter table spin_task_starts
  add column if not exists round_id uuid references spin_campaign_rounds(id) on delete cascade;

alter table spin_task_claims
  add column if not exists round_id uuid references spin_campaign_rounds(id) on delete cascade;

alter table spin_code_redemptions
  add column if not exists round_id uuid references spin_campaign_rounds(id) on delete cascade;

update spin_task_starts starts
set round_id = rounds.id
from spin_campaign_rounds rounds
where starts.round_id is null
  and rounds.campaign_id = starts.campaign_id
  and rounds.round_number = 1;

update spin_task_claims claims
set round_id = rounds.id
from spin_campaign_rounds rounds
where claims.round_id is null
  and rounds.campaign_id = claims.campaign_id
  and rounds.round_number = 1;

update spin_code_redemptions redemptions
set round_id = rounds.id
from spin_campaign_rounds rounds
where redemptions.round_id is null
  and rounds.campaign_id = redemptions.campaign_id
  and rounds.round_number = 1;

alter table spin_task_starts alter column round_id set not null;
alter table spin_task_claims alter column round_id set not null;
alter table spin_code_redemptions alter column round_id set not null;

alter table spin_task_starts
  drop constraint if exists spin_task_starts_user_id_campaign_id_task_type_key,
  drop constraint if exists spin_task_starts_user_round_task_unique;

alter table spin_task_starts
  add constraint spin_task_starts_user_round_task_unique
  unique (user_id, round_id, task_type);

alter table spin_task_claims
  drop constraint if exists spin_task_claims_user_id_campaign_id_task_type_key,
  drop constraint if exists spin_task_claims_user_round_task_unique;

alter table spin_task_claims
  add constraint spin_task_claims_user_round_task_unique
  unique (user_id, round_id, task_type);

alter table spin_code_redemptions
  drop constraint if exists spin_code_redemptions_user_id_campaign_id_key,
  drop constraint if exists spin_code_redemptions_user_round_unique;

alter table spin_code_redemptions
  add constraint spin_code_redemptions_user_round_unique
  unique (user_id, round_id);

create index if not exists spin_task_starts_round_idx on spin_task_starts(round_id);
create index if not exists spin_task_claims_round_idx on spin_task_claims(round_id);
create index if not exists spin_code_redemptions_round_idx on spin_code_redemptions(round_id);

create table if not exists spin_campaign_prizes (
  campaign_id uuid not null references spin_campaigns(id) on delete cascade,
  prize_type text not null check (prize_type in ('GTD', 'FCFS1', 'FCFS2')),
  total_count integer not null check (total_count between 0 and 100000),
  awarded_count integer not null default 0 check (awarded_count >= 0 and awarded_count <= total_count),
  updated_at timestamptz not null default now(),
  primary key (campaign_id, prize_type)
);

insert into spin_campaign_prizes (campaign_id, prize_type, total_count)
select id, prize_type, total_count
from spin_campaigns
cross join (values ('GTD', 15), ('FCFS1', 20), ('FCFS2', 30)) as defaults(prize_type, total_count)
on conflict (campaign_id, prize_type) do nothing;

alter table spin_prize_slots
  add column if not exists campaign_id uuid references spin_campaigns(id) on delete restrict,
  add column if not exists campaign_slot_number integer;

alter table spin_prize_slots
  drop constraint if exists spin_prize_slots_prize_day_prize_type_slot_number_key;

create unique index if not exists spin_prize_slots_campaign_day_type_number_unique
  on spin_prize_slots(
    coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid),
    prize_day,
    prize_type,
    slot_number
  );

create unique index if not exists spin_prize_slots_campaign_type_ordinal_unique
  on spin_prize_slots(campaign_id, prize_type, campaign_slot_number)
  where campaign_id is not null and campaign_slot_number is not null;

alter table spin_events
  add column if not exists campaign_id uuid references spin_campaigns(id) on delete restrict;

alter table spin_events
  drop constraint if exists spin_events_result_check;

alter table spin_events
  add constraint spin_events_result_check
  check (result in ('NONE', 'REFUND', 'GTD', 'FCFS1', 'FCFS2'));

create index if not exists spin_events_campaign_created_idx
  on spin_events(campaign_id, created_at desc) where campaign_id is not null;

create table if not exists spin_batches (
  id uuid primary key,
  user_id uuid not null references spin_users(id) on delete cascade,
  campaign_id uuid not null references spin_campaigns(id) on delete restrict,
  idempotency_key uuid not null,
  requested_count integer not null check (requested_count between 1 and 100),
  response jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index if not exists spin_batches_campaign_created_idx
  on spin_batches(campaign_id, created_at desc);

alter table spin_sheet_outbox
  drop constraint if exists spin_sheet_outbox_event_type_check;

alter table spin_sheet_outbox
  add constraint spin_sheet_outbox_event_type_check
  check (event_type in ('spin_user', 'spin_win', 'spin_referral'));

create or replace function enforce_spin_win_role_cap()
returns trigger
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtext('spin-role-cap:' || new.user_id::text || ':' || new.prize_type));
  if exists (
    select 1
    from spin_wins
    where user_id = new.user_id and prize_type = new.prize_type
    offset 2 limit 1
  ) then
    raise exception 'A user cannot win the same Bunny Hood role more than three times.';
  end if;
  return new;
end;
$$;

drop trigger if exists spin_wins_role_cap_trigger on spin_wins;

create trigger spin_wins_role_cap_trigger
before insert on spin_wins
for each row execute function enforce_spin_win_role_cap();

commit;
