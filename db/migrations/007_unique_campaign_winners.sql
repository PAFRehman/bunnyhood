begin;

alter table spin_campaigns
  alter column expected_spins_per_user set default 20;

update spin_campaigns
set expected_spins_per_user = 20
where campaign_version = 2 and expected_spins_per_user = 360;

create table if not exists spin_campaign_draw_counters (
  campaign_id uuid primary key references spin_campaigns(id) on delete cascade,
  participants_seen integer not null default 0 check (participants_seen >= 0),
  winners_selected integer not null default 0 check (winners_selected >= 0),
  updated_at timestamptz not null default now(),
  check (winners_selected <= participants_seen)
);

create table if not exists spin_campaign_participants (
  campaign_id uuid not null references spin_campaigns(id) on delete cascade,
  user_id uuid not null references spin_users(id) on delete cascade,
  participant_number integer not null check (participant_number > 0),
  selected boolean not null default false,
  prize_type text check (prize_type in ('GTD', 'FCFS1', 'FCFS2')),
  prize_ordinal integer check (prize_ordinal > 0),
  created_at timestamptz not null default now(),
  primary key (campaign_id, user_id),
  unique (campaign_id, participant_number),
  check (
    (selected = true and prize_type is not null and prize_ordinal is not null)
    or (selected = false and prize_type is null and prize_ordinal is null)
  )
);

create index if not exists spin_campaign_participants_selected_idx
  on spin_campaign_participants(campaign_id, selected, created_at desc);

with first_campaign_wins as (
  select
    slots.campaign_id,
    wins.user_id,
    wins.prize_type,
    slots.campaign_slot_number as prize_ordinal,
    wins.won_at,
    row_number() over (
      partition by slots.campaign_id, wins.user_id
      order by wins.won_at, wins.id
    ) as user_win_number
  from spin_wins wins
  join spin_prize_slots slots on slots.id = wins.prize_slot_id
  where slots.campaign_id is not null
    and slots.campaign_slot_number is not null
), ranked_existing_winners as (
  select
    campaign_id,
    user_id,
    prize_type,
    prize_ordinal,
    won_at,
    row_number() over (
      partition by campaign_id
      order by won_at, user_id
    )::integer as participant_number
  from first_campaign_wins
  where user_win_number = 1
)
insert into spin_campaign_participants (
  campaign_id, user_id, participant_number, selected,
  prize_type, prize_ordinal, created_at
)
select
  campaign_id, user_id, participant_number, true,
  prize_type, prize_ordinal, won_at
from ranked_existing_winners
on conflict (campaign_id, user_id) do nothing;

insert into spin_campaign_draw_counters (
  campaign_id, participants_seen, winners_selected, updated_at
)
select
  campaigns.id,
  count(participants.user_id)::integer,
  count(participants.user_id) filter (where participants.selected)::integer,
  now()
from spin_campaigns campaigns
left join spin_campaign_participants participants
  on participants.campaign_id = campaigns.id
group by campaigns.id
on conflict (campaign_id) do update set
  participants_seen = greatest(
    spin_campaign_draw_counters.participants_seen,
    excluded.participants_seen
  ),
  winners_selected = greatest(
    spin_campaign_draw_counters.winners_selected,
    excluded.winners_selected
  ),
  updated_at = now();

insert into spin_schema_migrations (migration_id)
values ('007_unique_campaign_winners')
on conflict (migration_id) do nothing;

commit;
