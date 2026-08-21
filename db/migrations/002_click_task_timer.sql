begin;

create table if not exists spin_task_starts (
  id uuid primary key,
  user_id uuid not null references spin_users(id) on delete cascade,
  campaign_id uuid not null references spin_campaigns(id) on delete cascade,
  task_type text not null check (task_type in ('like', 'repost', 'comment')),
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, campaign_id, task_type)
);

create index if not exists spin_task_starts_campaign_idx on spin_task_starts(campaign_id);

commit;
