begin;

alter table spin_task_starts
  drop constraint if exists spin_task_starts_task_type_check;

alter table spin_task_starts
  add constraint spin_task_starts_task_type_check
  check (task_type in ('follow', 'like', 'repost', 'comment', 'notifications'));

alter table spin_task_claims
  drop constraint if exists spin_task_claims_task_type_check;

alter table spin_task_claims
  add constraint spin_task_claims_task_type_check
  check (task_type in ('follow', 'like', 'repost', 'comment', 'notifications'));

alter table spin_user_campaign_progress
  add column if not exists extra_task_claimed_bits bigint not null default 0
  check (extra_task_claimed_bits >= 0);

alter table spin_user_campaign_progress
  drop constraint if exists spin_user_campaign_progress_task_rewards_earned_check;

alter table spin_user_campaign_progress
  add constraint spin_user_campaign_progress_task_rewards_earned_check
  check (task_rewards_earned between 0 and 100);

insert into spin_user_campaign_progress (
  user_id, campaign_id, extra_task_claimed_bits, task_rewards_earned
)
select
  claims.user_id,
  claims.campaign_id,
  sum(
    1::bigint << (
      (rounds.round_number - 1) * 2
      + case claims.task_type when 'follow' then 0 else 1 end
    )
  )::bigint,
  count(*)::integer
from spin_task_claims claims
join spin_campaign_rounds rounds on rounds.id = claims.round_id
where claims.task_type in ('follow', 'notifications')
group by claims.user_id, claims.campaign_id
on conflict (user_id, campaign_id) do update set
  extra_task_claimed_bits = spin_user_campaign_progress.extra_task_claimed_bits | excluded.extra_task_claimed_bits,
  task_rewards_earned = least(
    100,
    spin_user_campaign_progress.task_rewards_earned + excluded.task_rewards_earned
  ),
  updated_at = now();

delete from spin_task_claims
where task_type in ('follow', 'notifications');

commit;
