begin;

alter table spin_settings
  add column if not exists allow_wallet_submissions boolean not null default true;

update spin_settings
set allow_wallet_submissions = true
where id = 1 and allow_wallet_submissions is null;

commit;
