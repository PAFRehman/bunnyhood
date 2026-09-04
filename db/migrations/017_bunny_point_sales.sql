begin;

alter table spin_bunny_trades
  add column if not exists points_awarded bigint not null default 0;

alter table spin_bunny_trades
  drop constraint if exists spin_bunny_trades_reward_type_check,
  drop constraint if exists spin_bunny_trades_points_awarded_check;

alter table spin_bunny_trades
  add constraint spin_bunny_trades_reward_type_check
    check (reward_type in ('GTD', 'FCFS', 'POINTS')),
  add constraint spin_bunny_trades_points_awarded_check check (
    (reward_type = 'POINTS'
      and points_awarded = streak_days::bigint * 3
      and points_awarded > 0)
    or (reward_type in ('GTD', 'FCFS') and points_awarded = 0)
  );

insert into spin_schema_migrations (migration_id)
values ('017_bunny_point_sales')
on conflict (migration_id) do nothing;

commit;
