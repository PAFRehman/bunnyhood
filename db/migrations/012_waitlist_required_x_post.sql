begin;

alter table waitlist_sessions
  add column if not exists reserved_referral_code text;

create unique index if not exists waitlist_sessions_reserved_referral_unique
  on waitlist_sessions(reserved_referral_code)
  where reserved_referral_code is not null;

create table if not exists waitlist_join_posts (
  session_id uuid primary key references waitlist_sessions(id) on delete cascade,
  x_username text not null check (x_username ~ '^[a-z0-9_]{1,15}$'),
  post_url text not null unique,
  post_id text not null unique check (post_id ~ '^[0-9]{5,30}$'),
  verified_at timestamptz not null default now()
);

create unique index if not exists waitlist_join_posts_username_lower_unique
  on waitlist_join_posts(lower(x_username));

insert into spin_schema_migrations (migration_id)
values ('012_waitlist_required_x_post')
on conflict (migration_id) do nothing;

commit;
