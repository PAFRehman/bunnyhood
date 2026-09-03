import { getDb, inTransaction } from "./db";
import { sha256 } from "./security";

const MIGRATION_ID = "006_production_data_platform";
const UNIQUE_WINNER_MIGRATION_ID = "007_unique_campaign_winners";
const FIVE_TASK_MIGRATION_ID = "008_five_campaign_tasks";
const POINTS_SHOP_MIGRATION_ID = "014_spin_points_shop";
const FEED_THE_BUNNY_MIGRATION_ID = "015_feed_the_bunny";

const statements = [
  `alter table spin_users
    add column if not exists spins_earned bigint not null default 0,
    add column if not exists last_seen_at timestamptz not null default now(),
    add column if not exists last_spin_at timestamptz`,
  `update spin_users
    set spins_earned = spins_available::bigint + spins_used
    where spins_earned <> spins_available::bigint + spins_used`,
  `alter table spin_users
    alter column spins_available type bigint using spins_available::bigint,
    alter column points type bigint using points::bigint`,
  `alter table spin_users drop constraint if exists spin_users_spin_accounting_check`,
  `alter table spin_users add constraint spin_users_spin_accounting_check
    check (spins_earned = spins_available + spins_used)`,
  `create index if not exists spin_users_last_seen_idx on spin_users(last_seen_at desc)`,
  `alter table spin_campaigns
    add column if not exists spins_processed bigint not null default 0`,
  `update spin_campaigns campaigns
    set spins_processed = greatest(
      campaigns.spins_processed,
      (select count(*)::bigint from spin_events events where events.campaign_id = campaigns.id)
    )`,
  `create table if not exists spin_daily_rollups (
    campaign_id uuid not null references spin_campaigns(id) on delete restrict,
    metric_day date not null,
    metric_shard smallint not null default 0 check (metric_shard between 0 and 63),
    attempts bigint not null default 0 check (attempts >= 0),
    spins_consumed bigint not null default 0 check (spins_consumed >= 0),
    spins_refunded bigint not null default 0 check (spins_refunded >= 0),
    no_prize bigint not null default 0 check (no_prize >= 0),
    gtd_wins bigint not null default 0 check (gtd_wins >= 0),
    fcfs1_wins bigint not null default 0 check (fcfs1_wins >= 0),
    fcfs2_wins bigint not null default 0 check (fcfs2_wins >= 0),
    updated_at timestamptz not null default now(),
    primary key (campaign_id, metric_day, metric_shard)
  )`,
  `alter table spin_daily_rollups
    add column if not exists metric_shard smallint not null default 0`,
  `alter table spin_daily_rollups drop constraint if exists spin_daily_rollups_pkey`,
  `alter table spin_daily_rollups add constraint spin_daily_rollups_pkey
    primary key (campaign_id, metric_day, metric_shard)`,
  `create index if not exists spin_daily_rollups_day_idx on spin_daily_rollups(metric_day desc)`,
  `create table if not exists spin_campaign_counters (
    campaign_id uuid not null references spin_campaigns(id) on delete cascade,
    counter_shard smallint not null check (counter_shard between 0 and 63),
    spins_processed bigint not null default 0 check (spins_processed >= 0),
    updated_at timestamptz not null default now(),
    primary key (campaign_id, counter_shard)
  )`,
  `insert into spin_campaign_counters (campaign_id, counter_shard, spins_processed)
    select id, 0, spins_processed from spin_campaigns
    on conflict (campaign_id, counter_shard) do update set
      spins_processed = greatest(
        spin_campaign_counters.spins_processed,
        excluded.spins_processed
      ),
      updated_at = now()`,
  `create table if not exists spin_global_counters (
    id smallint primary key default 1 check (id = 1),
    connected_users bigint not null default 0 check (connected_users >= 0),
    updated_at timestamptz not null default now()
  )`,
  `insert into spin_global_counters (id, connected_users)
    values (1, (select count(*)::bigint from spin_users))
    on conflict (id) do update set
      connected_users = excluded.connected_users,
      updated_at = now()`,
  `create table if not exists spin_connected_user_counters (
    counter_shard smallint primary key check (counter_shard between 0 and 63),
    connected_users bigint not null default 0 check (connected_users >= 0),
    updated_at timestamptz not null default now()
  )`,
  `insert into spin_connected_user_counters (counter_shard, connected_users)
    select (hashtextextended(id::text, 0) & 63::bigint)::smallint,
      count(*)::bigint
    from spin_users
    group by (hashtextextended(id::text, 0) & 63::bigint)::smallint
    on conflict (counter_shard) do update set
      connected_users = excluded.connected_users,
      updated_at = now()`,
  `create or replace function sync_spin_connected_users()
    returns trigger language plpgsql as $$
    declare
      affected_user_id uuid;
      affected_shard smallint;
    begin
      if tg_op = 'INSERT' then
        affected_user_id := new.id;
        affected_shard := (hashtextextended(affected_user_id::text, 0) & 63::bigint)::smallint;
        insert into spin_connected_user_counters (counter_shard, connected_users)
        values (affected_shard, 1)
        on conflict (counter_shard) do update set
          connected_users = spin_connected_user_counters.connected_users + 1,
          updated_at = now();
        return new;
      end if;
      affected_user_id := old.id;
      affected_shard := (hashtextextended(affected_user_id::text, 0) & 63::bigint)::smallint;
      update spin_connected_user_counters
      set connected_users = greatest(0, connected_users - 1), updated_at = now()
      where counter_shard = affected_shard;
      return old;
    end;
    $$`,
  `drop trigger if exists spin_users_connected_counter_trigger on spin_users`,
  `create trigger spin_users_connected_counter_trigger
    after insert or delete on spin_users
    for each row execute function sync_spin_connected_users()`,
  `create table if not exists spin_user_campaign_progress (
    user_id uuid not null references spin_users(id) on delete cascade,
    campaign_id uuid not null references spin_campaigns(id) on delete cascade,
    task_claimed_bits bigint not null default 0 check (task_claimed_bits >= 0),
    extra_task_claimed_bits bigint not null default 0 check (extra_task_claimed_bits >= 0),
    code_redeemed_bits bigint not null default 0 check (code_redeemed_bits >= 0),
    task_rewards_earned integer not null default 0 check (task_rewards_earned between 0 and 100),
    code_redemptions integer not null default 0 check (code_redemptions between 0 and 20),
    code_spins_earned integer not null default 0 check (code_spins_earned between 0 and 400),
    code_spin_awards jsonb not null default '{}'::jsonb check (jsonb_typeof(code_spin_awards) = 'object'),
    updated_at timestamptz not null default now(),
    primary key (user_id, campaign_id)
  )`,
  `create index if not exists spin_user_campaign_progress_campaign_idx
    on spin_user_campaign_progress(campaign_id, updated_at desc)`,
  `alter table spin_user_campaign_progress
    add column if not exists code_spin_awards jsonb not null default '{}'::jsonb`,
  `insert into spin_user_campaign_progress (
      user_id, campaign_id, task_claimed_bits, task_rewards_earned
    )
    select claims.user_id, claims.campaign_id,
      sum(
        1::bigint << (
          (rounds.round_number - 1) * 3
          + case claims.task_type when 'like' then 0 when 'repost' then 1 else 2 end
        )
      )::bigint,
      count(*)::integer
    from spin_task_claims claims
    join spin_campaign_rounds rounds on rounds.id = claims.round_id
    where claims.task_type in ('like', 'repost', 'comment')
    group by claims.user_id, claims.campaign_id
    on conflict (user_id, campaign_id) do update set
      task_claimed_bits = spin_user_campaign_progress.task_claimed_bits | excluded.task_claimed_bits,
      task_rewards_earned = greatest(
        spin_user_campaign_progress.task_rewards_earned,
        excluded.task_rewards_earned
      ),
      updated_at = now()`,
  `insert into spin_user_campaign_progress (
      user_id, campaign_id, code_redeemed_bits, code_redemptions,
      code_spins_earned, code_spin_awards
    )
    select redemptions.user_id, redemptions.campaign_id,
      sum(1::bigint << (rounds.round_number - 1))::bigint,
      count(*)::integer,
      sum(redemptions.awarded_spins)::integer,
      jsonb_object_agg(rounds.round_number::text, redemptions.awarded_spins)
    from spin_code_redemptions redemptions
    join spin_campaign_rounds rounds on rounds.id = redemptions.round_id
    group by redemptions.user_id, redemptions.campaign_id
    on conflict (user_id, campaign_id) do update set
      code_redeemed_bits = spin_user_campaign_progress.code_redeemed_bits | excluded.code_redeemed_bits,
      code_redemptions = greatest(
        spin_user_campaign_progress.code_redemptions,
        excluded.code_redemptions
      ),
      code_spins_earned = greatest(
        spin_user_campaign_progress.code_spins_earned,
        excluded.code_spins_earned
      ),
      code_spin_awards = spin_user_campaign_progress.code_spin_awards || excluded.code_spin_awards,
      updated_at = now()`,
  `delete from spin_task_claims`,
  `delete from spin_code_redemptions`,
  `create table if not exists spin_wallet_registry (
    wallet_hash char(64) primary key,
    first_win_id uuid not null references spin_wins(id) on delete restrict,
    first_user_id uuid not null references spin_users(id) on delete restrict,
    first_seen_at timestamptz not null default now()
  )`,
  `create table if not exists spin_wallet_history (
    id bigserial primary key,
    win_id uuid not null references spin_wins(id) on delete restrict,
    user_id uuid not null references spin_users(id) on delete restrict,
    action text not null check (action in ('submitted', 'replaced', 'removed')),
    wallet_hash char(64) not null,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists spin_wallet_history_win_idx
    on spin_wallet_history(win_id, created_at desc)`,
  `create table if not exists spin_maintenance_runs (
    id bigserial primary key,
    raw_events_archived bigint not null default 0,
    batches_removed bigint not null default 0,
    sessions_removed bigint not null default 0,
    rate_limits_removed bigint not null default 0,
    legacy_outbox_removed bigint not null default 0,
    task_timers_removed bigint not null default 0,
    campaign_progress_removed bigint not null default 0,
    legacy_reward_rows_removed bigint not null default 0,
    completed_at timestamptz not null default now()
  )`,
  `alter table spin_maintenance_runs
    add column if not exists task_timers_removed bigint not null default 0,
    add column if not exists campaign_progress_removed bigint not null default 0,
    add column if not exists legacy_reward_rows_removed bigint not null default 0`,
  `create index if not exists spin_maintenance_runs_completed_idx
    on spin_maintenance_runs(completed_at desc)`,
  `create table if not exists spin_admin_audit_log (
    id bigserial primary key,
    action text not null,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists spin_admin_audit_created_idx
    on spin_admin_audit_log(created_at desc)`,
  `alter table spin_prize_slots drop constraint if exists spin_prize_slots_spin_event_fk`,
  `alter table spin_prize_slots add constraint spin_prize_slots_spin_event_fk
    foreign key (spin_event_id) references spin_events(id)
    on delete set null deferrable initially deferred`,
  `alter table spin_events
    add column if not exists rollup_recorded boolean not null default false`,
  `insert into spin_daily_rollups (
      campaign_id, metric_day, metric_shard, attempts, spins_consumed, spins_refunded,
      no_prize, gtd_wins, fcfs1_wins, fcfs2_wins, updated_at
    )
    select campaign_id, (created_at at time zone 'UTC')::date,
      (hashtextextended(user_id::text, 0) & 63::bigint)::smallint,
      count(*)::bigint,
      count(*) filter (where result <> 'REFUND')::bigint,
      count(*) filter (where result = 'REFUND')::bigint,
      count(*) filter (where result = 'NONE')::bigint,
      count(*) filter (where result = 'GTD')::bigint,
      count(*) filter (where result = 'FCFS1')::bigint,
      count(*) filter (where result = 'FCFS2')::bigint,
      now()
    from spin_events
    where campaign_id is not null and rollup_recorded = false
    group by campaign_id, (created_at at time zone 'UTC')::date,
      (hashtextextended(user_id::text, 0) & 63::bigint)::smallint
    on conflict (campaign_id, metric_day, metric_shard) do update set
      attempts = spin_daily_rollups.attempts + excluded.attempts,
      spins_consumed = spin_daily_rollups.spins_consumed + excluded.spins_consumed,
      spins_refunded = spin_daily_rollups.spins_refunded + excluded.spins_refunded,
      no_prize = spin_daily_rollups.no_prize + excluded.no_prize,
      gtd_wins = spin_daily_rollups.gtd_wins + excluded.gtd_wins,
      fcfs1_wins = spin_daily_rollups.fcfs1_wins + excluded.fcfs1_wins,
      fcfs2_wins = spin_daily_rollups.fcfs2_wins + excluded.fcfs2_wins,
      updated_at = now()`,
  `delete from spin_events where rollup_recorded = false`,
  `create index if not exists spin_events_created_idx on spin_events(created_at)`,
  `create index if not exists spin_wins_wallet_pending_idx
    on spin_wins(won_at desc) where wallet_address is null`,
  `create or replace function sync_spin_user_total_wins()
    returns trigger language plpgsql as $$
    declare affected_user_id uuid;
    begin
      if tg_op = 'DELETE' then
        affected_user_id := old.user_id;
      else
        affected_user_id := new.user_id;
      end if;
      update spin_users
      set total_wins = (
            select count(*)::integer from spin_wins where user_id = affected_user_id
          ),
          updated_at = now()
      where id = affected_user_id;
      if tg_op = 'DELETE' then
        return old;
      end if;
      return new;
    end;
    $$`,
  `drop trigger if exists spin_wins_total_sync_trigger on spin_wins`,
  `create trigger spin_wins_total_sync_trigger
    after insert or delete on spin_wins
    for each row execute function sync_spin_user_total_wins()`,
  `update spin_users users
    set total_wins = (
      select count(*)::integer from spin_wins wins where wins.user_id = users.id
    )
    where total_wins <> (
      select count(*)::integer from spin_wins wins where wins.user_id = users.id
    )`,
] as const;

const uniqueWinnerStatements = [
  `alter table spin_campaigns
    alter column expected_spins_per_user set default 20`,
  `update spin_campaigns
    set expected_spins_per_user = 20
    where campaign_version = 2 and expected_spins_per_user = 360`,
  `create table if not exists spin_campaign_draw_counters (
    campaign_id uuid primary key references spin_campaigns(id) on delete cascade,
    participants_seen integer not null default 0 check (participants_seen >= 0),
    winners_selected integer not null default 0 check (winners_selected >= 0),
    updated_at timestamptz not null default now(),
    check (winners_selected <= participants_seen)
  )`,
  `create table if not exists spin_campaign_participants (
    campaign_id uuid not null references spin_campaigns(id) on delete cascade,
    user_id uuid not null references spin_users(id) on delete cascade,
    participant_number integer not null check (participant_number > 0),
    selected boolean not null default false,
    prize_type text check (prize_type in ('GTD', 'FCFS1', 'FCFS2')),
    prize_ordinal integer check (prize_ordinal > 0),
    created_at timestamptz not null default now(),
    primary key (campaign_id, user_id),
    unique (campaign_id, participant_number),
    check (
      (selected = true and prize_type is not null and prize_ordinal is not null)
      or (selected = false and prize_type is null and prize_ordinal is null)
    )
  )`,
  `create index if not exists spin_campaign_participants_selected_idx
    on spin_campaign_participants(campaign_id, selected, created_at desc)`,
  `with first_campaign_wins as (
      select slots.campaign_id, wins.user_id, wins.prize_type,
        slots.campaign_slot_number as prize_ordinal, wins.won_at,
        row_number() over (
          partition by slots.campaign_id, wins.user_id
          order by wins.won_at, wins.id
        ) as user_win_number
      from spin_wins wins
      join spin_prize_slots slots on slots.id = wins.prize_slot_id
      where slots.campaign_id is not null
        and slots.campaign_slot_number is not null
    ), ranked_existing_winners as (
      select campaign_id, user_id, prize_type, prize_ordinal, won_at,
        row_number() over (
          partition by campaign_id order by won_at, user_id
        )::integer as participant_number
      from first_campaign_wins
      where user_win_number = 1
    )
    insert into spin_campaign_participants (
      campaign_id, user_id, participant_number, selected,
      prize_type, prize_ordinal, created_at
    )
    select campaign_id, user_id, participant_number, true,
      prize_type, prize_ordinal, won_at
    from ranked_existing_winners
    on conflict (campaign_id, user_id) do nothing`,
  `insert into spin_campaign_draw_counters (
      campaign_id, participants_seen, winners_selected, updated_at
    )
    select campaigns.id,
      count(participants.user_id)::integer,
      count(participants.user_id) filter (where participants.selected)::integer,
      now()
    from spin_campaigns campaigns
    left join spin_campaign_participants participants
      on participants.campaign_id = campaigns.id
    group by campaigns.id
    on conflict (campaign_id) do update set
      participants_seen = greatest(
        spin_campaign_draw_counters.participants_seen,
        excluded.participants_seen
      ),
      winners_selected = greatest(
        spin_campaign_draw_counters.winners_selected,
        excluded.winners_selected
      ),
      updated_at = now()`,
] as const;

const fiveTaskStatements = [
  `alter table spin_task_starts
    drop constraint if exists spin_task_starts_task_type_check`,
  `alter table spin_task_starts
    add constraint spin_task_starts_task_type_check
    check (task_type in ('follow', 'like', 'repost', 'comment', 'notifications'))`,
  `alter table spin_task_claims
    drop constraint if exists spin_task_claims_task_type_check`,
  `alter table spin_task_claims
    add constraint spin_task_claims_task_type_check
    check (task_type in ('follow', 'like', 'repost', 'comment', 'notifications'))`,
  `alter table spin_user_campaign_progress
    add column if not exists extra_task_claimed_bits bigint not null default 0
    check (extra_task_claimed_bits >= 0)`,
  `alter table spin_user_campaign_progress
    drop constraint if exists spin_user_campaign_progress_task_rewards_earned_check`,
  `alter table spin_user_campaign_progress
    add constraint spin_user_campaign_progress_task_rewards_earned_check
    check (task_rewards_earned between 0 and 100)`,
  `insert into spin_user_campaign_progress (
      user_id, campaign_id, extra_task_claimed_bits, task_rewards_earned
    )
    select claims.user_id, claims.campaign_id,
      sum(
        1::bigint << (
          (rounds.round_number - 1) * 2
          + case claims.task_type when 'follow' then 0 else 1 end
        )
      )::bigint,
      count(*)::integer
    from spin_task_claims claims
    join spin_campaign_rounds rounds on rounds.id = claims.round_id
    where claims.task_type in ('follow', 'notifications')
    group by claims.user_id, claims.campaign_id
    on conflict (user_id, campaign_id) do update set
      extra_task_claimed_bits = spin_user_campaign_progress.extra_task_claimed_bits | excluded.extra_task_claimed_bits,
      task_rewards_earned = least(
        100,
        spin_user_campaign_progress.task_rewards_earned + excluded.task_rewards_earned
      ),
      updated_at = now()`,
  `delete from spin_task_claims
    where task_type in ('follow', 'notifications')`,
] as const;

const pointsShopStatements = [
  `alter table spin_users add column if not exists points_spent bigint not null default 0`,
  `alter table spin_users drop constraint if exists spin_users_points_spent_check`,
  `alter table spin_users add constraint spin_users_points_spent_check
    check (points_spent >= 0 and points_spent <= points)`,
  `create index if not exists spin_users_points_available_idx
    on spin_users ((points - points_spent) desc, points desc)`,
  `alter table spin_campaign_rounds add column if not exists shop_post_text text not null default
    'I am earning my way into the Bunny Hood. Join the movement with @BunnysHood'`,
  `create table if not exists spin_shop_items (
    campaign_id uuid not null references spin_campaigns(id) on delete cascade,
    spot_type text not null check (spot_type in ('GTD', 'FCFS')),
    points_price bigint not null check (points_price between 1 and 1000000000),
    total_count integer not null default 0 check (total_count between 0 and 100000),
    purchased_count integer not null default 0 check (purchased_count between 0 and total_count),
    updated_at timestamptz not null default now(),
    primary key (campaign_id, spot_type)
  )`,
  `insert into spin_shop_items (campaign_id, spot_type, points_price, total_count)
    select campaigns.id, types.spot_type, types.points_price, 0
    from spin_campaigns campaigns
    cross join (values ('GTD', 100::bigint), ('FCFS', 50::bigint)) types(spot_type, points_price)
    where campaigns.campaign_version = 2
    on conflict (campaign_id, spot_type) do nothing`,
  `create table if not exists spin_shop_purchases (
    id uuid primary key,
    campaign_id uuid not null references spin_campaigns(id) on delete restrict,
    user_id uuid not null references spin_users(id) on delete restrict,
    spot_type text not null check (spot_type in ('GTD', 'FCFS')),
    points_spent bigint not null check (points_spent > 0),
    idempotency_key uuid not null,
    created_at timestamptz not null default now(),
    unique (campaign_id, user_id, spot_type),
    unique (user_id, idempotency_key)
  )`,
  `create index if not exists spin_shop_purchases_campaign_idx
    on spin_shop_purchases(campaign_id, created_at desc)`,
  `create table if not exists spin_post_tasks (
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
  )`,
  `create index if not exists spin_post_tasks_campaign_idx
    on spin_post_tasks(campaign_id, round_id, verified_at desc)`,
  `alter table spin_wins
    add column if not exists source text not null default 'wheel',
    add column if not exists shop_purchase_id uuid unique references spin_shop_purchases(id) on delete restrict`,
  `alter table spin_wins alter column prize_slot_id drop not null`,
  `alter table spin_wins
    drop constraint if exists spin_wins_source_check,
    drop constraint if exists spin_wins_source_reference_check`,
  `alter table spin_wins
    add constraint spin_wins_source_check check (source in ('wheel', 'shop')),
    add constraint spin_wins_source_reference_check check (
      (source = 'wheel' and prize_slot_id is not null and shop_purchase_id is null)
      or (source = 'shop' and prize_slot_id is null and shop_purchase_id is not null)
    )`,
  `create index if not exists spin_wins_source_idx on spin_wins(source, won_at desc)`,
] as const;

const feedTheBunnyStatements = [
  `alter table spin_settings
    add column if not exists post_task_text text not null default
      'I am earning my way into the Bunny Hood. Join the movement with @BunnysHood',
    add column if not exists post_task_requires_tag boolean not null default true,
    add column if not exists bunny_streak_days integer not null default 7`,
  `alter table spin_settings
    drop constraint if exists spin_settings_post_task_text_check,
    drop constraint if exists spin_settings_bunny_streak_days_check`,
  `alter table spin_settings
    add constraint spin_settings_post_task_text_check
      check (char_length(post_task_text) between 1 and 260),
    add constraint spin_settings_bunny_streak_days_check
      check (bunny_streak_days between 1 and 365)`,
  `update spin_settings settings
    set post_task_text = coalesce((
      select nullif(left(btrim(rounds.shop_post_text), 260), '')
      from spin_campaigns campaigns
      join spin_campaign_rounds rounds
        on rounds.campaign_id = campaigns.id and rounds.active = true
      where campaigns.active = true and campaigns.campaign_version = 2
      order by campaigns.created_at desc
      limit 1
    ), settings.post_task_text)
    where settings.id = 1`,
  `create table if not exists spin_bunny_profiles (
    user_id uuid primary key references spin_users(id) on delete restrict,
    cycle_number integer not null default 1 check (cycle_number >= 1),
    streak_days integer not null default 0 check (streak_days between 0 and 365),
    longest_streak integer not null default 0 check (longest_streak between 0 and 365),
    total_carrots bigint not null default 0 check (total_carrots >= 0),
    last_fed_day date,
    last_feed_idempotency_key uuid,
    trade_ready boolean not null default false,
    updated_at timestamptz not null default now()
  )`,
  `create index if not exists spin_bunny_profiles_ready_idx
    on spin_bunny_profiles(trade_ready, streak_days desc)`,
  `create table if not exists spin_bunny_feed_months (
    user_id uuid not null references spin_users(id) on delete restrict,
    feed_month date not null check (extract(day from feed_month) = 1),
    feed_bits bigint not null default 0 check (feed_bits >= 0),
    feeds_count smallint not null default 0 check (feeds_count between 0 and 31),
    points_spent integer not null default 0 check (points_spent = feeds_count * 3),
    updated_at timestamptz not null default now(),
    primary key (user_id, feed_month)
  )`,
  `create index if not exists spin_bunny_feed_months_month_idx
    on spin_bunny_feed_months(feed_month desc)`,
  `create table if not exists spin_bunny_trades (
    id uuid primary key,
    user_id uuid not null references spin_users(id) on delete restrict,
    cycle_number integer not null check (cycle_number >= 1),
    reward_type text not null check (reward_type in ('GTD', 'FCFS')),
    streak_days integer not null check (streak_days between 1 and 365),
    idempotency_key uuid not null,
    created_at timestamptz not null default now(),
    unique (user_id, cycle_number),
    unique (user_id, idempotency_key)
  )`,
  `create index if not exists spin_bunny_trades_created_idx
    on spin_bunny_trades(created_at desc)`,
  `alter table spin_wins
    add column if not exists bunny_trade_id uuid unique
      references spin_bunny_trades(id) on delete restrict`,
  `alter table spin_wins
    drop constraint if exists spin_wins_source_check,
    drop constraint if exists spin_wins_source_reference_check`,
  `alter table spin_wins
    add constraint spin_wins_source_check check (source in ('wheel', 'shop', 'bunny')),
    add constraint spin_wins_source_reference_check check (
      (source = 'wheel' and prize_slot_id is not null and shop_purchase_id is null and bunny_trade_id is null)
      or (source = 'shop' and prize_slot_id is null and shop_purchase_id is not null and bunny_trade_id is null)
      or (source = 'bunny' and prize_slot_id is null and shop_purchase_id is null and bunny_trade_id is not null)
    )`,
] as const;

declare global {
  var bunnyHoodProductionSchema: Promise<void> | undefined;
}

async function migrate() {
  const sql = getDb();
  await sql`
    create table if not exists spin_schema_migrations (
      migration_id text primary key,
      applied_at timestamptz not null default now()
    )
  `;
  const applied = await sql<{ applied: boolean }[]>`
    select exists(
      select 1 from spin_schema_migrations where migration_id = ${MIGRATION_ID}
    ) as applied
  `;
  if (!applied[0]?.applied) {
    await inTransaction(async (transaction) => {
      await transaction`select pg_advisory_xact_lock(hashtext('bunny-hood-production-schema'))`;
      const alreadyApplied = await transaction<{ applied: boolean }[]>`
        select exists(
          select 1 from spin_schema_migrations where migration_id = ${MIGRATION_ID}
        ) as applied
      `;
      if (alreadyApplied[0]?.applied) return;

      for (const statement of statements) await transaction.unsafe(statement);

      const currentWallets = await transaction<{
        id: string;
        user_id: string;
        wallet_address: string;
        wallet_submitted_at: Date | string;
      }[]>`
        select id, user_id, wallet_address, wallet_submitted_at
        from spin_wins
        where wallet_address is not null and wallet_submitted_at is not null
      `;
      for (const wallet of currentWallets) {
        const walletHash = sha256(wallet.wallet_address.toLowerCase());
        await transaction`
          insert into spin_wallet_registry (
            wallet_hash, first_win_id, first_user_id, first_seen_at
          ) values (
            ${walletHash}, ${wallet.id}::uuid, ${wallet.user_id}::uuid,
            ${new Date(wallet.wallet_submitted_at).toISOString()}::timestamptz
          )
          on conflict (wallet_hash) do nothing
        `;
      }

      await transaction`
        insert into spin_schema_migrations (migration_id)
        values (${MIGRATION_ID})
        on conflict (migration_id) do nothing
      `;
    });
  }

  const uniqueWinnerApplied = await sql<{ applied: boolean }[]>`
    select exists(
      select 1 from spin_schema_migrations
      where migration_id = ${UNIQUE_WINNER_MIGRATION_ID}
    ) as applied
  `;
  if (!uniqueWinnerApplied[0]?.applied) {
    await inTransaction(async (transaction) => {
      await transaction`select pg_advisory_xact_lock(hashtext('bunny-hood-production-schema'))`;
      const alreadyApplied = await transaction<{ applied: boolean }[]>`
        select exists(
          select 1 from spin_schema_migrations
          where migration_id = ${UNIQUE_WINNER_MIGRATION_ID}
        ) as applied
      `;
      if (alreadyApplied[0]?.applied) return;

      for (const statement of uniqueWinnerStatements) await transaction.unsafe(statement);
      await transaction`
        insert into spin_schema_migrations (migration_id)
        values (${UNIQUE_WINNER_MIGRATION_ID})
        on conflict (migration_id) do nothing
      `;
    });
  }

  const fiveTaskApplied = await sql<{ applied: boolean }[]>`
    select exists(
      select 1 from spin_schema_migrations
      where migration_id = ${FIVE_TASK_MIGRATION_ID}
    ) as applied
  `;
  if (!fiveTaskApplied[0]?.applied) {
    await inTransaction(async (transaction) => {
      await transaction`select pg_advisory_xact_lock(hashtext('bunny-hood-production-schema'))`;
      const alreadyApplied = await transaction<{ applied: boolean }[]>`
        select exists(
          select 1 from spin_schema_migrations
          where migration_id = ${FIVE_TASK_MIGRATION_ID}
        ) as applied
      `;
      if (alreadyApplied[0]?.applied) return;

      for (const statement of fiveTaskStatements) await transaction.unsafe(statement);
      await transaction`
        insert into spin_schema_migrations (migration_id)
        values (${FIVE_TASK_MIGRATION_ID})
        on conflict (migration_id) do nothing
      `;
    });
  }

  const pointsShopApplied = await sql<{ applied: boolean }[]>`
    select exists(
      select 1 from spin_schema_migrations
      where migration_id = ${POINTS_SHOP_MIGRATION_ID}
    ) as applied
  `;
  if (!pointsShopApplied[0]?.applied) {
    await inTransaction(async (transaction) => {
      await transaction`select pg_advisory_xact_lock(hashtext('bunny-hood-production-schema'))`;
      const alreadyApplied = await transaction<{ applied: boolean }[]>`
        select exists(
          select 1 from spin_schema_migrations
          where migration_id = ${POINTS_SHOP_MIGRATION_ID}
        ) as applied
      `;
      if (alreadyApplied[0]?.applied) return;

      for (const statement of pointsShopStatements) await transaction.unsafe(statement);
      await transaction`
        insert into spin_schema_migrations (migration_id)
        values (${POINTS_SHOP_MIGRATION_ID})
        on conflict (migration_id) do nothing
      `;
    });
  }

  const feedTheBunnyApplied = await sql<{ applied: boolean }[]>`
    select exists(
      select 1 from spin_schema_migrations
      where migration_id = ${FEED_THE_BUNNY_MIGRATION_ID}
    ) as applied
  `;
  if (feedTheBunnyApplied[0]?.applied) return;

  await inTransaction(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtext('bunny-hood-production-schema'))`;
    const alreadyApplied = await transaction<{ applied: boolean }[]>`
      select exists(
        select 1 from spin_schema_migrations
        where migration_id = ${FEED_THE_BUNNY_MIGRATION_ID}
      ) as applied
    `;
    if (alreadyApplied[0]?.applied) return;

    for (const statement of feedTheBunnyStatements) await transaction.unsafe(statement);
    await transaction`
      insert into spin_schema_migrations (migration_id)
      values (${FEED_THE_BUNNY_MIGRATION_ID})
      on conflict (migration_id) do nothing
    `;
  });
}

export async function ensureProductionSchema() {
  if (!globalThis.bunnyHoodProductionSchema) {
    globalThis.bunnyHoodProductionSchema = migrate().catch((error) => {
      globalThis.bunnyHoodProductionSchema = undefined;
      throw error;
    });
  }
  return globalThis.bunnyHoodProductionSchema;
}
