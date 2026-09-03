begin;

alter table spin_settings
  add column if not exists post_task_text text not null default
    'I am earning my way into the Bunny Hood. Join the movement with @BunnysHood',
  add column if not exists post_task_requires_tag boolean not null default true,
  add column if not exists bunny_streak_days integer not null default 7;

alter table spin_settings
  drop constraint if exists spin_settings_post_task_text_check,
  drop constraint if exists spin_settings_bunny_streak_days_check;

alter table spin_settings
  add constraint spin_settings_post_task_text_check
    check (char_length(post_task_text) between 1 and 260),
  add constraint spin_settings_bunny_streak_days_check
    check (bunny_streak_days between 1 and 365);

update spin_settings settings
set post_task_text = coalesce((
  select nullif(left(btrim(rounds.shop_post_text), 260), '')
  from spin_campaigns campaigns
  join spin_campaign_rounds rounds
    on rounds.campaign_id = campaigns.id and rounds.active = true
  where campaigns.active = true and campaigns.campaign_version = 2
  order by campaigns.created_at desc
  limit 1
), settings.post_task_text)
where settings.id = 1;

create table if not exists spin_bunny_profiles (
  user_id uuid primary key references spin_users(id) on delete restrict,
  cycle_number integer not null default 1 check (cycle_number >= 1),
  streak_days integer not null default 0 check (streak_days between 0 and 365),
  longest_streak integer not null default 0 check (longest_streak between 0 and 365),
  total_carrots bigint not null default 0 check (total_carrots >= 0),
  last_fed_day date,
  last_feed_idempotency_key uuid,
  trade_ready boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists spin_bunny_profiles_ready_idx
  on spin_bunny_profiles(trade_ready, streak_days desc);

create table if not exists spin_bunny_feed_months (
  user_id uuid not null references spin_users(id) on delete restrict,
  feed_month date not null check (extract(day from feed_month) = 1),
  feed_bits bigint not null default 0 check (feed_bits >= 0),
  feeds_count smallint not null default 0 check (feeds_count between 0 and 31),
  points_spent integer not null default 0 check (points_spent = feeds_count * 3),
  updated_at timestamptz not null default now(),
  primary key (user_id, feed_month)
);

create index if not exists spin_bunny_feed_months_month_idx
  on spin_bunny_feed_months(feed_month desc);

create table if not exists spin_bunny_trades (
  id uuid primary key,
  user_id uuid not null references spin_users(id) on delete restrict,
  cycle_number integer not null check (cycle_number >= 1),
  reward_type text not null check (reward_type in ('GTD', 'FCFS')),
  streak_days integer not null check (streak_days between 1 and 365),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, cycle_number),
  unique (user_id, idempotency_key)
);

create index if not exists spin_bunny_trades_created_idx
  on spin_bunny_trades(created_at desc);

alter table spin_wins
  add column if not exists bunny_trade_id uuid unique
    references spin_bunny_trades(id) on delete restrict;

alter table spin_wins
  drop constraint if exists spin_wins_source_check,
  drop constraint if exists spin_wins_source_reference_check;

alter table spin_wins
  add constraint spin_wins_source_check check (source in ('wheel', 'shop', 'bunny')),
  add constraint spin_wins_source_reference_check check (
    (source = 'wheel' and prize_slot_id is not null and shop_purchase_id is null and bunny_trade_id is null)
    or (source = 'shop' and prize_slot_id is null and shop_purchase_id is not null and bunny_trade_id is null)
    or (source = 'bunny' and prize_slot_id is null and shop_purchase_id is null and bunny_trade_id is not null)
  );

insert into spin_schema_migrations (migration_id)
values ('015_feed_the_bunny')
on conflict (migration_id) do nothing;

commit;
