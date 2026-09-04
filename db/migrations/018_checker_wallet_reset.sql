begin;

select pg_advisory_xact_lock(hashtext('bunny-hood-checker-schema'));

delete from checker_wallets;

insert into spin_schema_migrations (migration_id)
values ('018_checker_wallet_reset')
on conflict (migration_id) do nothing;

commit;
