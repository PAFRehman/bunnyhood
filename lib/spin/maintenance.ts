import { inTransaction } from "./db";
import { ensureProductionSchema } from "./schema";

export const RAW_SPIN_RETENTION_HOURS = 72;
export const BATCH_RETENTION_HOURS = 6;

type CountRow = { count: number | string };

function count(row: CountRow | undefined) {
  return Number(row?.count ?? 0);
}

export async function runSpinMaintenance() {
  await ensureProductionSchema();

  return inTransaction(async (sql) => {
    await sql`select pg_advisory_xact_lock(hashtext('bunny-hood-spin-maintenance'))`;

    await sql`
      insert into spin_daily_rollups (
        campaign_id, metric_day, metric_shard, attempts, spins_consumed,
        spins_refunded, no_prize, gtd_wins, fcfs1_wins, fcfs2_wins, updated_at
      )
      select campaign_id, (created_at at time zone 'UTC')::date,
        (hashtextextended(user_id::text, 0) & 63::bigint)::smallint,
        count(*)::bigint,
        count(*) filter (where result <> 'REFUND')::bigint,
        count(*) filter (where result = 'REFUND')::bigint,
        count(*) filter (where result = 'NONE')::bigint,
        count(*) filter (where result = 'GTD')::bigint,
        count(*) filter (where result = 'FCFS1')::bigint,
        count(*) filter (where result = 'FCFS2')::bigint,
        now()
      from spin_events
      where campaign_id is not null and rollup_recorded = false
      group by campaign_id, (created_at at time zone 'UTC')::date,
        (hashtextextended(user_id::text, 0) & 63::bigint)::smallint
      on conflict (campaign_id, metric_day, metric_shard) do update set
        attempts = spin_daily_rollups.attempts + excluded.attempts,
        spins_consumed = spin_daily_rollups.spins_consumed + excluded.spins_consumed,
        spins_refunded = spin_daily_rollups.spins_refunded + excluded.spins_refunded,
        no_prize = spin_daily_rollups.no_prize + excluded.no_prize,
        gtd_wins = spin_daily_rollups.gtd_wins + excluded.gtd_wins,
        fcfs1_wins = spin_daily_rollups.fcfs1_wins + excluded.fcfs1_wins,
        fcfs2_wins = spin_daily_rollups.fcfs2_wins + excluded.fcfs2_wins,
        updated_at = now()
    `;
    await sql`
      insert into spin_campaign_counters (
        campaign_id, counter_shard, spins_processed, updated_at
      )
      select campaign_id,
        (hashtextextended(user_id::text, 0) & 63::bigint)::smallint,
        count(*)::bigint,
        now()
      from spin_events
      where campaign_id is not null and rollup_recorded = false
      group by campaign_id,
        (hashtextextended(user_id::text, 0) & 63::bigint)::smallint
      on conflict (campaign_id, counter_shard) do update set
        spins_processed = spin_campaign_counters.spins_processed + excluded.spins_processed,
        updated_at = now()
    `;
    await sql`update spin_events set rollup_recorded = true where rollup_recorded = false`;

    await sql`
      insert into spin_user_campaign_progress (
        user_id, campaign_id, task_claimed_bits, task_rewards_earned
      )
      select claims.user_id, claims.campaign_id,
        sum(
          1::bigint << (
            (rounds.round_number - 1) * 3
            + case claims.task_type when 'like' then 0 when 'repost' then 1 else 2 end
          )
        )::bigint,
        count(*)::integer
      from spin_task_claims claims
      join spin_campaign_rounds rounds on rounds.id = claims.round_id
      where claims.task_type in ('like', 'repost', 'comment')
      group by claims.user_id, claims.campaign_id
      on conflict (user_id, campaign_id) do update set
        task_claimed_bits = spin_user_campaign_progress.task_claimed_bits | excluded.task_claimed_bits,
        task_rewards_earned = greatest(
          spin_user_campaign_progress.task_rewards_earned,
          excluded.task_rewards_earned
        ),
        updated_at = now()
    `;
    await sql`
      insert into spin_user_campaign_progress (
        user_id, campaign_id, code_redeemed_bits, code_redemptions,
        code_spins_earned, code_spin_awards
      )
      select redemptions.user_id, redemptions.campaign_id,
        sum(1::bigint << (rounds.round_number - 1))::bigint,
        count(*)::integer,
        sum(redemptions.awarded_spins)::integer,
        jsonb_object_agg(rounds.round_number::text, redemptions.awarded_spins)
      from spin_code_redemptions redemptions
      join spin_campaign_rounds rounds on rounds.id = redemptions.round_id
      group by redemptions.user_id, redemptions.campaign_id
      on conflict (user_id, campaign_id) do update set
        code_redeemed_bits = spin_user_campaign_progress.code_redeemed_bits | excluded.code_redeemed_bits,
        code_redemptions = greatest(
          spin_user_campaign_progress.code_redemptions,
          excluded.code_redemptions
        ),
        code_spins_earned = greatest(
          spin_user_campaign_progress.code_spins_earned,
          excluded.code_spins_earned
        ),
        code_spin_awards = spin_user_campaign_progress.code_spin_awards || excluded.code_spin_awards,
        updated_at = now()
    `;

    const archivedRows = await sql<CountRow[]>`
      with deleted as (
        delete from spin_events
        where created_at < now() - (${RAW_SPIN_RETENTION_HOURS} * interval '1 hour')
        returning 1
      )
      select count(*)::bigint as count from deleted
    `;
    const batchRows = await sql<CountRow[]>`
      with deleted as (
        delete from spin_batches
        where created_at < now() - (${BATCH_RETENTION_HOURS} * interval '1 hour')
        returning 1
      )
      select count(*)::bigint as count from deleted
    `;
    const sessionRows = await sql<CountRow[]>`
      with deleted as (
        delete from spin_sessions where expires_at < now() returning 1
      )
      select count(*)::bigint as count from deleted
    `;
    const rateRows = await sql<CountRow[]>`
      with deleted as (
        delete from spin_rate_limits
        where window_started_at < now() - interval '2 days'
        returning 1
      )
      select count(*)::bigint as count from deleted
    `;
    const outboxRows = await sql<CountRow[]>`
      with deleted as (
        delete from spin_sheet_outbox returning 1
      )
      select count(*)::bigint as count from deleted
    `;
    const timerRows = await sql<CountRow[]>`
      with deleted as (
        delete from spin_task_starts starts
        where starts.created_at < now() - interval '1 day'
          or not exists (
            select 1
            from spin_campaign_rounds rounds
            join spin_campaigns campaigns on campaigns.id = rounds.campaign_id
            where rounds.id = starts.round_id
              and rounds.active = true
              and campaigns.active = true
              and campaigns.starts_at <= now()
              and campaigns.ends_at > now()
          )
        returning 1
      )
      select count(*)::bigint as count from deleted
    `;
    const progressRows = await sql<CountRow[]>`
      with deleted as (
        delete from spin_user_campaign_progress progress
        using spin_campaigns campaigns
        where campaigns.id = progress.campaign_id
          and (campaigns.active = false or campaigns.ends_at <= now())
        returning 1
      )
      select count(*)::bigint as count from deleted
    `;
    const legacyRewardRows = await sql<CountRow[]>`
      with task_deleted as (
        delete from spin_task_claims returning 1
      ), code_deleted as (
        delete from spin_code_redemptions returning 1
      )
      select (
        (select count(*) from task_deleted)
        + (select count(*) from code_deleted)
      )::bigint as count
    `;

    await sql`delete from spin_maintenance_runs where completed_at < now() - interval '1 year'`;
    await sql`delete from spin_admin_audit_log where created_at < now() - interval '1 year'`;

    const result = {
      rawEventsArchived: count(archivedRows[0]),
      batchesRemoved: count(batchRows[0]),
      sessionsRemoved: count(sessionRows[0]),
      rateLimitsRemoved: count(rateRows[0]),
      legacyOutboxRemoved: count(outboxRows[0]),
      taskTimersRemoved: count(timerRows[0]),
      campaignProgressRemoved: count(progressRows[0]),
      legacyRewardRowsRemoved: count(legacyRewardRows[0]),
    };
    await sql`
      insert into spin_maintenance_runs (
        raw_events_archived, batches_removed, sessions_removed,
        rate_limits_removed, legacy_outbox_removed, task_timers_removed,
        campaign_progress_removed, legacy_reward_rows_removed
      ) values (
        ${result.rawEventsArchived}, ${result.batchesRemoved}, ${result.sessionsRemoved},
        ${result.rateLimitsRemoved}, ${result.legacyOutboxRemoved},
        ${result.taskTimersRemoved}, ${result.campaignProgressRemoved},
        ${result.legacyRewardRowsRemoved}
      )
    `;
    return result;
  });
}
