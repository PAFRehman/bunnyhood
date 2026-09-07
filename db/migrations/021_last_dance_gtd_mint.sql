begin;

select pg_advisory_xact_lock(hashtext('bunny-hood-last-dance-schema'));

alter table last_dance_settings
  alter column mint_opens_at set default '2026-09-09 15:30:00+00'::timestamptz;

update last_dance_settings
set mint_opens_at = '2026-09-09 15:30:00+00'::timestamptz,
    updated_at = now()
where id = 1 and mint_opens_at is null;

insert into spin_schema_migrations (migration_id)
values ('021_last_dance_gtd_mint')
on conflict (migration_id) do nothing;

commit;
