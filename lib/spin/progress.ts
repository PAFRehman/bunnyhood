import type { SpinDb } from "./db";

export type CompactTaskType = "follow" | "like" | "repost" | "comment" | "notifications";

const PRIMARY_TASK_INDEX = {
  like: 0,
  repost: 1,
  comment: 2,
} as const;

const EXTRA_TASK_INDEX = {
  follow: 0,
  notifications: 1,
} as const;

type PrimaryTaskType = keyof typeof PRIMARY_TASK_INDEX;
type ExtraTaskType = keyof typeof EXTRA_TASK_INDEX;
type TaskBit = { column: "task_claimed_bits" | "extra_task_claimed_bits"; value: string };

function roundBit(rawRoundNumber: number, tasksPerRound: number, offset = 0) {
  const roundNumber = Number(rawRoundNumber);
  if (!Number.isInteger(roundNumber) || roundNumber < 1 || roundNumber > 20) {
    throw new Error("Campaign round must be between 1 and 20.");
  }
  return (BigInt(1) << BigInt((roundNumber - 1) * tasksPerRound + offset)).toString();
}

export function codeProgressBit(rawRoundNumber: number) {
  const roundNumber = Number(rawRoundNumber);
  if (!Number.isInteger(roundNumber) || roundNumber < 1 || roundNumber > 20) {
    throw new Error("Campaign round must be between 1 and 20.");
  }
  return (BigInt(1) << BigInt(roundNumber - 1)).toString();
}

export function taskProgressBit(roundNumber: number, task: CompactTaskType) {
  if (task in PRIMARY_TASK_INDEX) {
    return {
      column: "task_claimed_bits",
      value: roundBit(roundNumber, 3, PRIMARY_TASK_INDEX[task as PrimaryTaskType]),
    } satisfies TaskBit;
  }
  return {
    column: "extra_task_claimed_bits",
    value: roundBit(roundNumber, 2, EXTRA_TASK_INDEX[task as ExtraTaskType]),
  } satisfies TaskBit;
}

export async function hasTaskReward(
  sql: SpinDb,
  userId: string,
  campaignId: string,
  roundNumber: number,
  task: CompactTaskType,
) {
  const bit = taskProgressBit(roundNumber, task);
  if (bit.column === "extra_task_claimed_bits") {
    const rows = await sql<{ claimed: boolean }[]>`
      select exists(
        select 1 from spin_user_campaign_progress
        where user_id = ${userId}::uuid
          and campaign_id = ${campaignId}::uuid
          and (extra_task_claimed_bits & ${bit.value}::bigint) <> 0
      ) as claimed
    `;
    return Boolean(rows[0]?.claimed);
  }
  const rows = await sql<{ claimed: boolean }[]>`
    select exists(
      select 1 from spin_user_campaign_progress
      where user_id = ${userId}::uuid
        and campaign_id = ${campaignId}::uuid
        and (task_claimed_bits & ${bit.value}::bigint) <> 0
    ) as claimed
  `;
  return Boolean(rows[0]?.claimed);
}

export async function markTaskReward(
  sql: SpinDb,
  userId: string,
  campaignId: string,
  roundNumber: number,
  task: CompactTaskType,
) {
  const bit = taskProgressBit(roundNumber, task);
  if (bit.column === "extra_task_claimed_bits") {
    const rows = await sql<{ inserted: boolean }[]>`
      insert into spin_user_campaign_progress (
        user_id, campaign_id, extra_task_claimed_bits, task_rewards_earned
      ) values (
        ${userId}::uuid, ${campaignId}::uuid, ${bit.value}::bigint, 1
      )
      on conflict (user_id, campaign_id) do update set
        extra_task_claimed_bits = spin_user_campaign_progress.extra_task_claimed_bits | excluded.extra_task_claimed_bits,
        task_rewards_earned = spin_user_campaign_progress.task_rewards_earned + 1,
        updated_at = now()
      where (spin_user_campaign_progress.extra_task_claimed_bits & excluded.extra_task_claimed_bits) = 0
      returning true as inserted
    `;
    return Boolean(rows[0]?.inserted);
  }
  const rows = await sql<{ inserted: boolean }[]>`
    insert into spin_user_campaign_progress (
      user_id, campaign_id, task_claimed_bits, task_rewards_earned
    ) values (
      ${userId}::uuid, ${campaignId}::uuid, ${bit.value}::bigint, 1
    )
    on conflict (user_id, campaign_id) do update set
      task_claimed_bits = spin_user_campaign_progress.task_claimed_bits | excluded.task_claimed_bits,
      task_rewards_earned = spin_user_campaign_progress.task_rewards_earned + 1,
      updated_at = now()
    where (spin_user_campaign_progress.task_claimed_bits & excluded.task_claimed_bits) = 0
    returning true as inserted
  `;
  return Boolean(rows[0]?.inserted);
}

export async function hasCodeReward(
  sql: SpinDb,
  userId: string,
  campaignId: string,
  roundNumber: number,
) {
  const bit = codeProgressBit(roundNumber);
  const rows = await sql<{ claimed: boolean }[]>`
    select exists(
      select 1 from spin_user_campaign_progress
      where user_id = ${userId}::uuid
        and campaign_id = ${campaignId}::uuid
        and (code_redeemed_bits & ${bit}::bigint) <> 0
    ) as claimed
  `;
  return Boolean(rows[0]?.claimed);
}

export async function markCodeReward(
  sql: SpinDb,
  userId: string,
  campaignId: string,
  roundNumber: number,
  awardedSpins: number,
) {
  const bit = codeProgressBit(roundNumber);
  const awardByRound = { [String(roundNumber)]: awardedSpins };
  const rows = await sql<{ inserted: boolean }[]>`
    insert into spin_user_campaign_progress (
      user_id, campaign_id, code_redeemed_bits,
      code_redemptions, code_spins_earned, code_spin_awards
    ) values (
      ${userId}::uuid, ${campaignId}::uuid, ${bit}::bigint, 1, ${awardedSpins},
      ${sql.json(awardByRound)}
    )
    on conflict (user_id, campaign_id) do update set
      code_redeemed_bits = spin_user_campaign_progress.code_redeemed_bits | excluded.code_redeemed_bits,
      code_redemptions = spin_user_campaign_progress.code_redemptions + 1,
      code_spins_earned = spin_user_campaign_progress.code_spins_earned + excluded.code_spins_earned,
      code_spin_awards = spin_user_campaign_progress.code_spin_awards || excluded.code_spin_awards,
      updated_at = now()
    where (spin_user_campaign_progress.code_redeemed_bits & excluded.code_redeemed_bits) = 0
    returning true as inserted
  `;
  return Boolean(rows[0]?.inserted);
}

export async function getRoundProgress(
  sql: SpinDb,
  userId: string,
  campaignId: string,
  roundNumber: number,
) {
  const taskBits = {
    follow: taskProgressBit(roundNumber, "follow").value,
    like: taskProgressBit(roundNumber, "like").value,
    repost: taskProgressBit(roundNumber, "repost").value,
    comment: taskProgressBit(roundNumber, "comment").value,
    notifications: taskProgressBit(roundNumber, "notifications").value,
  };
  const redemptionBit = codeProgressBit(roundNumber);
  const rows = await sql<{
    follow_claimed: boolean;
    like_claimed: boolean;
    repost_claimed: boolean;
    comment_claimed: boolean;
    notifications_claimed: boolean;
    code_redeemed: boolean;
    awarded_spins: number;
  }[]>`
    select
      (extra_task_claimed_bits & ${taskBits.follow}::bigint) <> 0 as follow_claimed,
      (task_claimed_bits & ${taskBits.like}::bigint) <> 0 as like_claimed,
      (task_claimed_bits & ${taskBits.repost}::bigint) <> 0 as repost_claimed,
      (task_claimed_bits & ${taskBits.comment}::bigint) <> 0 as comment_claimed,
      (extra_task_claimed_bits & ${taskBits.notifications}::bigint) <> 0 as notifications_claimed,
      (code_redeemed_bits & ${redemptionBit}::bigint) <> 0 as code_redeemed,
      coalesce((code_spin_awards ->> ${String(roundNumber)})::integer, 0) as awarded_spins
    from spin_user_campaign_progress
    where user_id = ${userId}::uuid and campaign_id = ${campaignId}::uuid
    limit 1
  `;
  const row = rows[0];
  return {
    claimedTasks: ([
      row?.follow_claimed ? "follow" : null,
      row?.like_claimed ? "like" : null,
      row?.repost_claimed ? "repost" : null,
      row?.comment_claimed ? "comment" : null,
      row?.notifications_claimed ? "notifications" : null,
    ].filter(Boolean) as CompactTaskType[]),
    codeAwardedSpins: row?.code_redeemed ? Number(row.awarded_spins) : null,
  };
}
