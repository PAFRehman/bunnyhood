begin;

select pg_advisory_xact_lock(hashtext('bunny-hood-last-dance-schema'));

alter table last_dance_settings
  alter column post_text set default $last_dance_post$Been watching @BunnysHood for a while and mint is finally getting close 🐰

→ Mint: Sept 9 ( 3:30 PM UTC )
→ Robinhood Chain
→ 30-day Burn Window after mint
→ Hold it, explore the Hood, or burn within 30 days and claim refund

Mint details 👇
https://opensea.io/collection/bunnyhoodxyz/overview$last_dance_post$;

update last_dance_settings
set post_text = $last_dance_post$Been watching @BunnysHood for a while and mint is finally getting close 🐰

→ Mint: Sept 9 ( 3:30 PM UTC )
→ Robinhood Chain
→ 30-day Burn Window after mint
→ Hold it, explore the Hood, or burn within 30 days and claim refund

Mint details 👇
https://opensea.io/collection/bunnyhoodxyz/overview$last_dance_post$,
    updated_at = now()
where id = 1;

insert into spin_schema_migrations (migration_id)
values ('022_last_dance_default_post')
on conflict (migration_id) do nothing;

commit;
