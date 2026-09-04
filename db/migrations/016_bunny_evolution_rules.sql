begin;

alter table spin_users
  add column if not exists permanent_task_claimed_bits smallint not null default 0;

alter table spin_users
  drop constraint if exists spin_users_permanent_task_claimed_bits_check;

alter table spin_users
  add constraint spin_users_permanent_task_claimed_bits_check
    check (permanent_task_claimed_bits between 0 and 3);

update spin_users users
set permanent_task_claimed_bits = (
  users.permanent_task_claimed_bits
  | case when exists (
      select 1 from spin_user_campaign_progress progress
      where progress.user_id = users.id
        and (progress.extra_task_claimed_bits & 366503875925::bigint) <> 0
    ) or exists (
      select 1 from spin_task_claims claims
      where claims.user_id = users.id and claims.task_type = 'follow'
    ) then 1 else 0 end
  | case when exists (
      select 1 from spin_user_campaign_progress progress
      where progress.user_id = users.id
        and (progress.extra_task_claimed_bits & 733007751850::bigint) <> 0
    ) or exists (
      select 1 from spin_task_claims claims
      where claims.user_id = users.id and claims.task_type = 'notifications'
    ) then 2 else 0 end
)::smallint
where exists (
  select 1 from spin_user_campaign_progress progress
  where progress.user_id = users.id
    and (progress.extra_task_claimed_bits & 1099511627775::bigint) <> 0
) or exists (
  select 1 from spin_task_claims claims
  where claims.user_id = users.id
    and claims.task_type in ('follow', 'notifications')
);

delete from spin_task_starts starts
using spin_users users
where users.id = starts.user_id
  and (
    (starts.task_type = 'follow' and (users.permanent_task_claimed_bits & 1) <> 0)
    or (starts.task_type = 'notifications' and (users.permanent_task_claimed_bits & 2) <> 0)
  );

alter table spin_settings
  add column if not exists bunny_death_on_break boolean not null default false,
  add column if not exists bunny_gtd_enabled boolean not null default false,
  add column if not exists bunny_gtd_requirement_mode text not null default 'both',
  add column if not exists bunny_gtd_streak_days integer not null default 30,
  add column if not exists bunny_gtd_points_required bigint not null default 100;

alter table spin_settings
  drop constraint if exists spin_settings_bunny_gtd_requirement_mode_check,
  drop constraint if exists spin_settings_bunny_gtd_streak_days_check,
  drop constraint if exists spin_settings_bunny_gtd_points_required_check;

alter table spin_settings
  add constraint spin_settings_bunny_gtd_requirement_mode_check
    check (bunny_gtd_requirement_mode in ('days', 'points', 'both')),
  add constraint spin_settings_bunny_gtd_streak_days_check
    check (bunny_gtd_streak_days between 1 and 365),
  add constraint spin_settings_bunny_gtd_points_required_check
    check (bunny_gtd_points_required between 0 and 1000000000);

alter table spin_bunny_profiles
  add column if not exists death_count integer not null default 0,
  add column if not exists last_death_at timestamptz;

alter table spin_bunny_profiles
  drop constraint if exists spin_bunny_profiles_streak_days_check,
  drop constraint if exists spin_bunny_profiles_longest_streak_check,
  drop constraint if exists spin_bunny_profiles_death_count_check;

alter table spin_bunny_profiles
  add constraint spin_bunny_profiles_streak_days_check check (streak_days >= 0),
  add constraint spin_bunny_profiles_longest_streak_check check (longest_streak >= 0),
  add constraint spin_bunny_profiles_death_count_check check (death_count >= 0);

alter table spin_bunny_trades
  add column if not exists points_available_at_trade bigint not null default 0;

alter table spin_bunny_trades
  drop constraint if exists spin_bunny_trades_streak_days_check,
  drop constraint if exists spin_bunny_trades_points_available_at_trade_check;

alter table spin_bunny_trades
  add constraint spin_bunny_trades_streak_days_check check (streak_days >= 1),
  add constraint spin_bunny_trades_points_available_at_trade_check
    check (points_available_at_trade >= 0);

insert into spin_schema_migrations (migration_id)
values ('016_bunny_evolution_rules')
on conflict (migration_id) do nothing;

commit;
