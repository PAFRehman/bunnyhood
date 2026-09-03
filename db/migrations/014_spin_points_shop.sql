begin;

alter table spin_users
  add column if not exists points_spent bigint not null default 0;

alter table spin_users
  drop constraint if exists spin_users_points_spent_check;

alter table spin_users
  add constraint spin_users_points_spent_check
  check (points_spent >= 0 and points_spent <= points);

create index if not exists spin_users_points_available_idx
  on spin_users ((points - points_spent) desc, points desc);

alter table spin_campaign_rounds
  add column if not exists shop_post_text text not null default
    'I am earning my way into the Bunny Hood. Join the movement with @BunnysHood';

create table if not exists spin_shop_items (
  campaign_id uuid not null references spin_campaigns(id) on delete cascade,
  spot_type text not null check (spot_type in ('GTD', 'FCFS')),
  points_price bigint not null check (points_price between 1 and 1000000000),
  total_count integer not null default 0 check (total_count between 0 and 100000),
  purchased_count integer not null default 0 check (purchased_count between 0 and total_count),
  updated_at timestamptz not null default now(),
  primary key (campaign_id, spot_type)
);

insert into spin_shop_items (campaign_id, spot_type, points_price, total_count)
select campaigns.id, types.spot_type, types.points_price, 0
from spin_campaigns campaigns
cross join (values ('GTD', 100::bigint), ('FCFS', 50::bigint)) types(spot_type, points_price)
where campaigns.campaign_version = 2
on conflict (campaign_id, spot_type) do nothing;

create table if not exists spin_shop_purchases (
  id uuid primary key,
  campaign_id uuid not null references spin_campaigns(id) on delete restrict,
  user_id uuid not null references spin_users(id) on delete restrict,
  spot_type text not null check (spot_type in ('GTD', 'FCFS')),
  points_spent bigint not null check (points_spent > 0),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique (campaign_id, user_id, spot_type),
  unique (user_id, idempotency_key)
);

create index if not exists spin_shop_purchases_campaign_idx
  on spin_shop_purchases(campaign_id, created_at desc);

create table if not exists spin_post_tasks (
  id uuid primary key,
  campaign_id uuid not null references spin_campaigns(id) on delete restrict,
  round_id uuid not null references spin_campaign_rounds(id) on delete restrict,
  user_id uuid not null references spin_users(id) on delete restrict,
  post_id text not null unique,
  post_url text not null,
  x_username text not null,
  points_awarded integer not null default 3 check (points_awarded = 3),
  verified_at timestamptz not null default now(),
  unique (user_id, round_id)
);

create index if not exists spin_post_tasks_campaign_idx
  on spin_post_tasks(campaign_id, round_id, verified_at desc);

alter table spin_wins
  add column if not exists source text not null default 'wheel',
  add column if not exists shop_purchase_id uuid unique references spin_shop_purchases(id) on delete restrict;

alter table spin_wins
  alter column prize_slot_id drop not null;

alter table spin_wins
  drop constraint if exists spin_wins_source_check,
  drop constraint if exists spin_wins_source_reference_check;

alter table spin_wins
  add constraint spin_wins_source_check check (source in ('wheel', 'shop')),
  add constraint spin_wins_source_reference_check check (
    (source = 'wheel' and prize_slot_id is not null and shop_purchase_id is null)
    or (source = 'shop' and prize_slot_id is null and shop_purchase_id is not null)
  );

create index if not exists spin_wins_source_idx on spin_wins(source, won_at desc);

insert into spin_schema_migrations (migration_id)
values ('014_spin_points_shop')
on conflict (migration_id) do nothing;

commit;
