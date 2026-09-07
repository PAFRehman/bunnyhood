begin;

select pg_advisory_xact_lock(hashtext('bunny-hood-last-dance-schema'));

alter table last_dance_settings
  add column if not exists mint_opens_at timestamptz;

insert into spin_schema_migrations (migration_id)
values ('020_last_dance_mint_schedule')
on conflict (migration_id) do nothing;

commit;
