import { randomUUID } from "node:crypto";
import type { SpinUser } from "./auth";
import type { SpinDb } from "./db";
import { getDb, inTransaction } from "./db";
import { HttpError } from "./http";
import {
  hasTaskReward,
  markTaskReward,
  type CompactTaskType,
} from "./progress";
import { enforceRateLimit } from "./rate-limit";
import { ensureProductionSchema } from "./schema";
import { hashRedeemCode } from "./security";
import type { SpinUserRow } from "./users";

export type TaskType = CompactTaskType;

export type CampaignRow = {
  id: string;
  round_id: string;
  round_number: number;
  title: string;
  tweet_id: string;
  tweet_url: string;
  shop_post_text: string;
  code_hash: string;
  starts_at: Date | string;
  ends_at: Date | string;
  expected_users: number;
  expected_spins_per_user: number;
  spins_processed: number;
  created_at: Date | string;
};

type TaskStartRow = {
  started_at: Date | string;
  ready_at: Date | string;
  wait_ms: number;
  ready?: boolean;
};

export function extractTweetId(tweetUrl: string) {
  const match = tweetUrl.trim().match(/^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/(\d{5,25})(?:[/?#].*)?$/i);
  if (!match) throw new HttpError(400, "Enter a complete X post URL.", "BAD_TWEET_URL");
  return match[1];
}

export async function getActiveCampaign(sql: SpinDb = getDb()) {
  const rows = await sql<CampaignRow[]>`
    select campaigns.id, rounds.id as round_id, rounds.round_number,
      rounds.title, rounds.tweet_id, rounds.tweet_url, rounds.code_hash, rounds.shop_post_text,
      campaigns.starts_at, campaigns.ends_at, campaigns.expected_users,
      campaigns.expected_spins_per_user,
      coalesce((
        select sum(counters.spins_processed)::bigint
        from spin_campaign_counters counters
        where counters.campaign_id = campaigns.id
      ), campaigns.spins_processed, 0)::bigint as spins_processed,
      campaigns.created_at
    from spin_campaigns campaigns
    join spin_campaign_rounds rounds
      on rounds.campaign_id = campaigns.id and rounds.active = true
    where campaigns.active = true
      and campaigns.campaign_version = 2
      and campaigns.starts_at <= now()
      and campaigns.ends_at > now()
    order by campaigns.created_at desc
    limit 1
  `;
  return rows[0] ?? null;
}

export async function getLatestPrizeCampaign(sql: SpinDb = getDb()) {
  const rows = await sql<CampaignRow[]>`
    select campaigns.id, rounds.id as round_id, rounds.round_number,
      rounds.title, rounds.tweet_id, rounds.tweet_url, rounds.code_hash, rounds.shop_post_text,
      campaigns.starts_at, campaigns.ends_at, campaigns.expected_users,
      campaigns.expected_spins_per_user,
      coalesce((
        select sum(counters.spins_processed)::bigint
        from spin_campaign_counters counters
        where counters.campaign_id = campaigns.id
      ), campaigns.spins_processed, 0)::bigint as spins_processed,
      campaigns.created_at
    from spin_campaigns campaigns
    join lateral (
      select id, round_number, title, tweet_id, tweet_url, code_hash, shop_post_text
      from spin_campaign_rounds
      where campaign_id = campaigns.id
      order by active desc, round_number desc
      limit 1
    ) rounds on true
    where campaigns.campaign_version = 2
      and (
        select count(*) from spin_campaign_prizes prizes
        where prizes.campaign_id = campaigns.id
      ) = 3
    order by campaigns.created_at desc
    limit 1
  `;
  return rows[0] ?? null;
}

export async function startCampaignTask(user: SpinUser, task: TaskType) {
  const sql = getDb();
  await enforceRateLimit(`task-start:${user.id}`, 15, 60, sql);
  const campaign = await getActiveCampaign(sql);
  if (!campaign) throw new HttpError(404, "No campaign is active right now.", "NO_CAMPAIGN");

  if (await hasTaskReward(sql, user.id, campaign.id, campaign.round_number, task)) {
    return {
      task,
      alreadyClaimed: true,
      tweetUrl: campaign.tweet_url,
      readyAt: new Date().toISOString(),
    };
  }

  return inTransaction(async (transaction) => {
    await transaction`select pg_advisory_xact_lock_shared(hashtext('bunny-hood-active-campaign'))`;
    const liveCampaign = await transaction<{ active: boolean }[]>`
      select campaigns.active
      from spin_campaigns campaigns
      join spin_campaign_rounds rounds
        on rounds.campaign_id = campaigns.id and rounds.id = ${campaign.round_id}::uuid and rounds.active = true
      where campaigns.id = ${campaign.id}::uuid
        and campaigns.active = true and campaigns.starts_at <= now() and campaigns.ends_at > now()
    `;
    if (!liveCampaign[0]) {
      throw new HttpError(409, "The campaign changed. Refresh and open the new tasks.", "CAMPAIGN_CHANGED");
    }
    const inserted = await transaction<TaskStartRow[]>`
      insert into spin_task_starts (id, user_id, campaign_id, round_id, task_type)
      values (${randomUUID()}, ${user.id}::uuid, ${campaign.id}::uuid, ${campaign.round_id}::uuid, ${task})
      on conflict (user_id, round_id, task_type) do nothing
      returning started_at, started_at + interval '5 seconds' as ready_at,
        greatest(0, ceil(extract(epoch from (
          (started_at + interval '5 seconds') - clock_timestamp()
        )) * 1000))::int as wait_ms
    `;
    const starts = inserted[0] ? inserted : await transaction<TaskStartRow[]>`
      select started_at, started_at + interval '5 seconds' as ready_at,
        greatest(0, ceil(extract(epoch from (
          (started_at + interval '5 seconds') - clock_timestamp()
        )) * 1000))::int as wait_ms
      from spin_task_starts
      where user_id = ${user.id}::uuid
        and round_id = ${campaign.round_id}::uuid
        and task_type = ${task}
      limit 1
    `;
    const start = starts[0];
    if (!start) throw new HttpError(500, "The task timer could not start.", "TASK_START_FAILED");
    return {
      task,
      alreadyClaimed: false,
      tweetUrl: campaign.tweet_url,
      startedAt: new Date(start.started_at).toISOString(),
      readyAt: new Date(start.ready_at).toISOString(),
      waitMs: Number(start.wait_ms),
    };
  });
}

export async function claimCampaignTask(user: SpinUser, task: TaskType) {
  const sql = getDb();
  await enforceRateLimit(`task-claim:${user.id}`, 15, 60, sql);
  const campaign = await getActiveCampaign(sql);
  if (!campaign) throw new HttpError(404, "No campaign is active right now.", "NO_CAMPAIGN");

  return inTransaction(async (transaction) => {
    await transaction`select pg_advisory_xact_lock_shared(hashtext('bunny-hood-active-campaign'))`;
    const liveCampaign = await transaction<{ active: boolean }[]>`
      select campaigns.active
      from spin_campaigns campaigns
      join spin_campaign_rounds rounds
        on rounds.campaign_id = campaigns.id and rounds.id = ${campaign.round_id}::uuid and rounds.active = true
      where campaigns.id = ${campaign.id}::uuid
        and campaigns.active = true and campaigns.starts_at <= now() and campaigns.ends_at > now()
    `;
    if (!liveCampaign[0]) {
      throw new HttpError(409, "The campaign changed. Refresh and open the new tasks.", "CAMPAIGN_CHANGED");
    }
    await transaction`select id from spin_users where id = ${user.id}::uuid for update`;
    if (await hasTaskReward(transaction, user.id, campaign.id, campaign.round_number, task)) {
      return { task, alreadyClaimed: true, spinsAwarded: 0 };
    }

    const starts = await transaction<TaskStartRow[]>`
      select started_at,
        started_at + interval '5 seconds' as ready_at,
        now() >= started_at + interval '5 seconds' as ready
      from spin_task_starts
      where user_id = ${user.id}::uuid
        and round_id = ${campaign.round_id}::uuid
        and task_type = ${task}
      limit 1
      for update
    `;
    const start = starts[0];
    if (!start) {
      throw new HttpError(409, "Open the task first to start its reward timer.", "TASK_NOT_STARTED");
    }
    if (!start.ready) {
      throw new HttpError(409, "Please wait for the task timer to finish.", "TASK_TIMER_ACTIVE");
    }

    const inserted = await markTaskReward(
      transaction,
      user.id,
      campaign.id,
      campaign.round_number,
      task,
    );
    await transaction`
      delete from spin_task_starts
      where user_id = ${user.id}::uuid
        and round_id = ${campaign.round_id}::uuid
        and task_type = ${task}
    `;
    if (!inserted) return { task, alreadyClaimed: true, spinsAwarded: 0 };

    const updated = await transaction<SpinUserRow[]>`
      update spin_users
      set spins_available = spins_available + 1,
          spins_earned = spins_earned + 1,
          points = points + 1,
          updated_at = now()
      where id = ${user.id}::uuid
      returning id, x_user_id, x_username, x_name, spins_earned, spins_available, spins_used, points, points_spent, total_wins,
        referral_code, referral_count, referral_spins_earned
    `;
    return {
      task,
      alreadyClaimed: false,
      spinsAwarded: 1,
      spinsAvailable: Number(updated[0].spins_available),
      points: Number(updated[0].points),
    };
  });
}

export async function settleMaturedCampaignTasks(user: SpinUser) {
  const campaign = await getActiveCampaign();
  if (!campaign) return [] as TaskType[];

  return inTransaction(async (sql) => {
    await sql`select pg_advisory_xact_lock_shared(hashtext('bunny-hood-active-campaign'))`;
    await sql`select id from spin_users where id = ${user.id}::uuid for update`;
    const matured = await sql<{ task_type: TaskType }[]>`
      select starts.task_type
      from spin_task_starts starts
      where starts.user_id = ${user.id}::uuid
        and starts.round_id = ${campaign.round_id}::uuid
        and starts.started_at <= now() - interval '5 seconds'
      for update
    `;
    const awarded: TaskType[] = [];
    for (const row of matured) {
      const inserted = await markTaskReward(
        sql,
        user.id,
        campaign.id,
        campaign.round_number,
        row.task_type,
      );
      await sql`
        delete from spin_task_starts
        where user_id = ${user.id}::uuid
          and round_id = ${campaign.round_id}::uuid
          and task_type = ${row.task_type}
      `;
      if (inserted) awarded.push(row.task_type);
    }
    if (!awarded.length) return awarded;

    await sql`
      update spin_users
      set spins_available = spins_available + ${awarded.length},
          spins_earned = spins_earned + ${awarded.length},
          points = points + ${awarded.length},
          updated_at = now()
      where id = ${user.id}::uuid
    `;
    return awarded;
  });
}

function integerInRange(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new HttpError(400, `Enter a whole number between ${minimum} and ${maximum}.`, "BAD_CAMPAIGN_NUMBER");
  }
  return parsed;
}

export async function publishCampaign(input: {
  title: string;
  tweetUrl: string;
  redeemCode: string;
  endsAt?: string;
  expectedUsers?: number;
  gtdCount?: number;
  fcfs1Count?: number;
  fcfs2Count?: number;
  shopPostText?: string;
  startNewCampaign?: boolean;
}) {
  await ensureProductionSchema();
  const title = input.title.trim().slice(0, 80) || "Bunny Hood Drop";
  const tweetUrl = input.tweetUrl.trim();
  const tweetId = extractTweetId(tweetUrl);
  const code = input.redeemCode.trim();
  if (code.length < 4 || code.length > 64) {
    throw new HttpError(400, "Redeem code must be 4–64 characters.", "BAD_CODE");
  }
  const rawShopPostText = (input.shopPostText ?? "").trim();
  const taggedShopPostText = /(^|\s)@BunnysHood\b/i.test(rawShopPostText)
    ? rawShopPostText
    : `${rawShopPostText || "I am earning my way into the Bunny Hood."} @BunnysHood`;
  const shopPostText = taggedShopPostText.slice(0, 260);
  const expectedUsers = integerInRange(input.expectedUsers, 500, 10, 1_000_000);
  const gtdCount = integerInRange(input.gtdCount, 15, 1, 100_000);
  const fcfs1Count = integerInRange(input.fcfs1Count, 20, 1, 100_000);
  const fcfs2Count = integerInRange(input.fcfs2Count, 30, 1, 100_000);
  const totalWinnerSpots = gtdCount + fcfs1Count + fcfs2Count;
  if (totalWinnerSpots > expectedUsers) {
    throw new HttpError(
      400,
      "Total GTD, FCFS1, and FCFS2 spots cannot exceed expected unique users.",
      "TOO_MANY_WINNER_SPOTS",
    );
  }
  const end = input.endsAt ? new Date(input.endsAt) : new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
  if (!Number.isFinite(end.getTime()) || end.getTime() <= Date.now() + 5 * 60_000) {
    throw new HttpError(400, "Campaign end time must be at least five minutes from now.", "BAD_END_TIME");
  }
  const campaignId = randomUUID();
  return inTransaction(async (sql) => {
    await sql`select pg_advisory_xact_lock(hashtext('bunny-hood-active-campaign'))`;
    const activeRows = await sql<{ id: string }[]>`
      select id from spin_campaigns
      where active = true and campaign_version = 2
        and starts_at <= now() and ends_at > now()
      order by created_at desc limit 1 for update
    `;
    const activeCampaignId = activeRows[0]?.id;
    if (activeCampaignId && !input.startNewCampaign) {
      const roundNumbers = await sql<{ next_round: number }[]>`
        select (coalesce(max(round_number), 0) + 1)::int as next_round
        from spin_campaign_rounds where campaign_id = ${activeCampaignId}::uuid
      `;
      const roundNumber = Number(roundNumbers[0]?.next_round ?? 1);
      if (roundNumber > 20) {
        throw new HttpError(409, "This campaign already has all 20 daily rounds. Start a new campaign.", "ROUND_LIMIT_REACHED");
      }
      const roundId = randomUUID();
      await sql`
        update spin_campaign_rounds set active = false
        where campaign_id = ${activeCampaignId}::uuid and active = true
      `;
      await sql`
        insert into spin_campaign_rounds (
          id, campaign_id, round_number, title, tweet_id, tweet_url, code_hash, shop_post_text, active
        ) values (
          ${roundId}, ${activeCampaignId}::uuid, ${roundNumber}, ${title}, ${tweetId},
          ${tweetUrl}, ${hashRedeemCode(activeCampaignId, code)}, ${shopPostText}, true
        )
      `;
      await sql`
        update spin_campaigns
        set title = ${title}, tweet_id = ${tweetId}, tweet_url = ${tweetUrl},
          code_hash = ${hashRedeemCode(activeCampaignId, code)}
        where id = ${activeCampaignId}::uuid
      `;
      const updated = await getActiveCampaign(sql);
      if (!updated) throw new HttpError(500, "The daily round could not be activated.", "ROUND_ACTIVATION_FAILED");
      return { ...updated, dailyRound: true };
    }

    await sql`update spin_campaigns set active = false where active = true`;
    await sql`
      insert into spin_campaigns (
        id, title, tweet_id, tweet_url, code_hash, starts_at, ends_at, active,
        expected_users, expected_spins_per_user, campaign_version
      ) values (
        ${campaignId}, ${title}, ${tweetId}, ${tweetUrl},
        ${hashRedeemCode(campaignId, code)}, now(), ${end.toISOString()}::timestamptz, true,
        ${expectedUsers}, 20, 2
      )
    `;
    const roundId = randomUUID();
    await sql`
      insert into spin_campaign_rounds (
        id, campaign_id, round_number, title, tweet_id, tweet_url, code_hash, shop_post_text, active
      ) values (
        ${roundId}, ${campaignId}, 1, ${title}, ${tweetId}, ${tweetUrl},
        ${hashRedeemCode(campaignId, code)}, ${shopPostText}, true
      )
    `;
    await sql`
      insert into spin_campaign_prizes (campaign_id, prize_type, total_count)
      values
        (${campaignId}, 'GTD', ${gtdCount}),
        (${campaignId}, 'FCFS1', ${fcfs1Count}),
        (${campaignId}, 'FCFS2', ${fcfs2Count})
    `;
    await sql`
      insert into spin_campaign_draw_counters (campaign_id)
      values (${campaignId}::uuid)
      on conflict (campaign_id) do nothing
    `;
    const created = await getActiveCampaign(sql);
    if (!created) throw new HttpError(500, "The campaign could not be activated.", "CAMPAIGN_ACTIVATION_FAILED");
    return { ...created, dailyRound: false };
  });
}
