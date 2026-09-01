begin;

create table if not exists checker_wallets (
  wallet_address text primary key
    check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  eligibility_type text not null
    check (eligibility_type in ('GTD', 'FCFS')),
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists checker_wallets_type_updated_idx
  on checker_wallets(eligibility_type, updated_at desc);

insert into spin_schema_migrations (migration_id)
values ('013_wallet_eligibility_checker')
on conflict (migration_id) do nothing;

commit;
