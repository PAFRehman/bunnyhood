begin;

create table if not exists spin_settings (
  id smallint primary key default 1 check (id = 1),
  allow_wallet_changes boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into spin_settings (id, allow_wallet_changes)
values (1, true)
on conflict (id) do nothing;

commit;
