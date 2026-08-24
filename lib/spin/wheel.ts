import { randomInt, randomUUID } from "node:crypto";
import type { SpinUser } from "./auth";
import type { CampaignRow, TaskType } from "./campaigns";
import { getActiveCampaign, getLatestPrizeCampaign, settleMaturedCampaignTasks } from "./campaigns";
import { getDb, inTransaction, type SpinDb } from "./db";
import { HttpError } from "./http";
import { getRoundProgress, hasCodeReward, markCodeReward } from "./progress";
import { enforceRateLimit } from "./rate-limit";
import { ensureProductionSchema } from "./schema";
import { hashRedeemCode, normalizeRedeemCode, safeEqual, sha256 } from "./security";
import { getSpinSettings } from "./settings";
import { getStorageSafetyState, type StorageSafetyState } from "./storage-safety";
import { ensureReferralCode, type SpinUserRow } from "./users";

export type PrizeType = "GTD" | "FCFS1" | "FCFS2";
export type SpinResult = PrizeType | "NONE" | "REFUND";

const MAX_ROLE_WINS = 3;
const MAX_BATCH_SPINS = 100;

type CampaignPrize = {
  campaign_id: string;
  prize_type: PrizeType;
  total_count: number;
  awarded_count: number;
};

type RoleWinCounts = Record<PrizeType, number>;

type CampaignDrawCounter = {
  participants_seen: number;
  winners_selected: number;
};

type ParticipantPrize = {
  prizeType: PrizeType;
  ordinal: number;
};

export type SpinOutcome = {
  eventId: string;
  result: SpinResult;
  spinsLeft: number;
  spinsUsed: number;
  totalWins: number;
  winId?: string;
};

export type SpinBatchResponse = {
  batchId: string;
  requested: number;
  processed: number;
  consumedSpins: number;
  spinsLeft: number;
  spinsUsed: number;
  totalWins: number;
  results: SpinOutcome[];
  summary: {
    none: number;
    refunded: number;
    GTD: number;
    FCFS1: number;
    FCFS2: number;
  };
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function utcPrizeDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function userMetricShard(userId: string) {
  return Number.parseInt(userId.replace(/-/g, "").slice(0, 8), 16) % 64;
}

function emptyRoleCounts(): RoleWinCounts {
  return { GTD: 0, FCFS1: 0, FCFS2: 0 };
}

function chooseParticipantPrize(prizes: CampaignPrize[], roleWins: RoleWinCounts) {
  const weighted = prizes.flatMap((prize) => {
    const remaining = Number(prize.total_count) - Number(prize.awarded_count);
    if (remaining <= 0 || roleWins[prize.prize_type] >= MAX_ROLE_WINS) return [];
    return [{
      prize,
      weight: remaining * (2 ** (MAX_ROLE_WINS - roleWins[prize.prize_type])),
    }];
  });
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return null;
  const draw = randomInt(totalWeight);
  let cursor = 0;
  for (const item of weighted) {
    cursor += item.weight;
    if (draw < cursor) return item.prize;
  }
  return weighted.at(-1)?.prize ?? null;
}

async function drawUniqueParticipantPrize(
  sql: SpinDb,
  campaign: CampaignRow,
  prizes: CampaignPrize[],
  userId: string,
  roleWins: RoleWinCounts,
): Promise<ParticipantPrize | null> {
  const existing = await sql<{ selected: boolean }[]>`
    select selected
    from spin_campaign_participants
    where campaign_id = ${campaign.id}::uuid and user_id = ${userId}::uuid
    limit 1
  `;
  if (existing[0]) return null;

  await sql`select pg_advisory_xact_lock(hashtext(${`bunny-hood-campaign-draw:${campaign.id}`}))`;
  const rechecked = await sql<{ selected: boolean }[]>`
    select selected
    from spin_campaign_participants
    where campaign_id = ${campaign.id}::uuid and user_id = ${userId}::uuid
    limit 1
  `;
  if (rechecked[0]) return null;

  await sql`
    insert into spin_campaign_draw_counters (campaign_id)
    values (${campaign.id}::uuid)
    on conflict (campaign_id) do nothing
  `;
  const counters = await sql<CampaignDrawCounter[]>`
    select participants_seen, winners_selected
    from spin_campaign_draw_counters
    where campaign_id = ${campaign.id}::uuid
    for update
  `;
  const counter = counters[0];
  if (!counter) throw new Error("Campaign draw counter is unavailable.");

  const participantsSeen = Number(counter.participants_seen);
  const participantNumber = participantsSeen + 1;
  const remainingParticipantCapacity = Math.max(1, Number(campaign.expected_users) - participantsSeen);
  const eligiblePrizeCount = prizes.reduce((sum, prize) => {
    if (roleWins[prize.prize_type] >= MAX_ROLE_WINS) return sum;
    return sum + Math.max(0, Number(prize.total_count) - Number(prize.awarded_count));
  }, 0);
  const selected = eligiblePrizeCount > 0 && (
    eligiblePrizeCount >= remainingParticipantCapacity
    || randomInt(remainingParticipantCapacity) < eligiblePrizeCount
  );

  let awarded: ParticipantPrize | null = null;
  if (selected) {
    const chosen = chooseParticipantPrize(prizes, roleWins);
    if (chosen) {
      const reserved = await sql<{ awarded_count: number }[]>`
        update spin_campaign_prizes
        set awarded_count = awarded_count + 1, updated_at = now()
        where campaign_id = ${campaign.id}::uuid
          and prize_type = ${chosen.prize_type}
          and awarded_count < total_count
        returning awarded_count
      `;
      if (reserved[0]) {
        const ordinal = Number(reserved[0].awarded_count);
        chosen.awarded_count = ordinal;
        awarded = { prizeType: chosen.prize_type, ordinal };
      }
    }
  }

  await sql`
    insert into spin_campaign_participants (
      campaign_id, user_id, participant_number, selected, prize_type, prize_ordinal
    ) values (
      ${campaign.id}::uuid, ${userId}::uuid, ${participantNumber}, ${Boolean(awarded)},
      ${awarded?.prizeType ?? null}::text, ${awarded?.ordinal ?? null}::integer
    )
  `;
  await sql`
    update spin_campaign_draw_counters
    set participants_seen = ${participantNumber},
        winners_selected = winners_selected + ${awarded ? 1 : 0},
        updated_at = now()
    where campaign_id = ${campaign.id}::uuid
  `;
  return awarded;
}

export async function redeemCampaignCode(user: SpinUser, rawCode: string) {
  const code = normalizeRedeemCode(rawCode);
  if (code.length < 4 || code.length > 64) {
    throw new HttpError(400, "Enter the current Bunny Hood code.", "BAD_CODE");
  }
  const sql = getDb();
  await enforceRateLimit(`redeem:${user.id}`, 8, 10 * 60, sql);
  const campaign = await getActiveCampaign(sql);
  if (!campaign) throw new HttpError(404, "No campaign is active right now.", "NO_CAMPAIGN");
  const submittedHash = hashRedeemCode(campaign.id, code);
  if (!safeEqual(submittedHash, campaign.code_hash)) {
    throw new HttpError(400, "That code is not valid for the current campaign.", "INVALID_CODE");
  }

  return inTransaction(async (transaction) => {
    await transaction`select pg_advisory_xact_lock_shared(hashtext('bunny-hood-active-campaign'))`;
    const liveCampaign = await transaction<{ active: boolean; code_hash: string }[]>`
      select campaigns.active, rounds.code_hash
      from spin_campaigns campaigns
      join spin_campaign_rounds rounds
        on rounds.campaign_id = campaigns.id
        and rounds.id = ${campaign.round_id}::uuid
        and rounds.active = true
      where campaigns.id = ${campaign.id}::uuid
        and campaigns.active = true
        and campaigns.starts_at <= now()
        and campaigns.ends_at > now()
    `;
    if (!liveCampaign[0] || !safeEqual(submittedHash, liveCampaign[0].code_hash)) {
      throw new HttpError(409, "The campaign changed. Refresh and use the new code.", "CAMPAIGN_CHANGED");
    }
    await transaction`select id from spin_users where id = ${user.id}::uuid for update`;
    if (await hasCodeReward(
      transaction,
      user.id,
      campaign.id,
      campaign.round_number,
    )) {
      throw new HttpError(409, "You already redeemed this campaign code.", "CODE_ALREADY_REDEEMED");
    }
    const awarded = randomInt(10, 21);
    const recorded = await markCodeReward(
      transaction,
      user.id,
      campaign.id,
      campaign.round_number,
      awarded,
    );
    if (!recorded) {
      throw new HttpError(409, "You already redeemed this campaign code.", "CODE_ALREADY_REDEEMED");
    }
    const updated = await transaction<SpinUserRow[]>`
      update spin_users
      set spins_available = spins_available + ${awarded},
          spins_earned = spins_earned + ${awarded},
          updated_at = now()
      where id = ${user.id}::uuid
      returning id, x_user_id, x_username, x_name, spins_earned, spins_available, spins_used, points, total_wins,
        referral_code, referral_count, referral_spins_earned
    `;
    const updatedUser = updated[0];
    if (!updatedUser) {
      throw new HttpError(409, "Your X session changed. Refresh and redeem the code again.", "USER_STATE_CHANGED");
    }
    return { awardedSpins: awarded, spinsAvailable: Number(updatedUser.spins_available) };
  });
}

export async function playSpins(
  user: SpinUser,
  idempotencyKey: string,
  requestedCount: number,
): Promise<SpinBatchResponse> {
  if (!isUuid(idempotencyKey)) {
    throw new HttpError(400, "Invalid spin request. Refresh and try again.", "BAD_IDEMPOTENCY_KEY");
  }
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > MAX_BATCH_SPINS) {
    throw new HttpError(400, `Choose between 1 and ${MAX_BATCH_SPINS} spins.`, "BAD_SPIN_COUNT");
  }
  await ensureProductionSchema();
  const database = getDb();
  await enforceRateLimit(`spin:${user.id}`, 60, 60, database);

  return inTransaction(async (sql) => {
    await sql`select pg_advisory_xact_lock_shared(hashtext('bunny-hood-active-campaign'))`;
    const locked = await sql<SpinUserRow[]>`
      select id, x_user_id, x_username, x_name, spins_earned, spins_available, spins_used, points, total_wins,
        referral_code, referral_count, referral_spins_earned
      from spin_users where id = ${user.id}::uuid for update
    `;
    const current = locked[0];
    if (!current) throw new HttpError(401, "Connect X to continue.", "AUTH_REQUIRED");

    const duplicate = await sql<{ response: SpinBatchResponse }[]>`
      select response from spin_batches
      where user_id = ${user.id}::uuid and idempotency_key = ${idempotencyKey}::uuid
      limit 1
    `;
    if (duplicate[0]) return duplicate[0].response;

    const campaign = await getLatestPrizeCampaign(sql);
    if (!campaign) {
      throw new HttpError(
        409,
        "A prize pool has not been configured yet. Your spins were not used.",
        "NO_PRIZE_POOL",
      );
    }
    const availableAtStart = Number(current.spins_available);
    if (availableAtStart < 1) {
      throw new HttpError(409, "You do not have a spin available.", "NO_SPINS");
    }
    const processed = Math.min(requestedCount, availableAtStart);
    const metricShard = userMetricShard(user.id);

    const prizes = await sql<CampaignPrize[]>`
      select campaign_id, prize_type, total_count, awarded_count
      from spin_campaign_prizes
      where campaign_id = ${campaign.id}::uuid
      order by case prize_type when 'GTD' then 1 when 'FCFS1' then 2 else 3 end
    `;
    if (prizes.length !== 3) {
      throw new HttpError(503, "Campaign prizes are not configured yet.", "PRIZES_NOT_CONFIGURED");
    }
    const roleRows = await sql<{ prize_type: PrizeType; count: number }[]>`
      select prize_type, count(*)::int as count
      from spin_wins where user_id = ${user.id}::uuid group by prize_type
    `;
    const roleWins = emptyRoleCounts();
    for (const row of roleRows) roleWins[row.prize_type] = Number(row.count);
    const participantPrize = await drawUniqueParticipantPrize(
      sql,
      campaign,
      prizes,
      user.id,
      roleWins,
    );

    let spinsAvailable = availableAtStart;
    let spinsUsed = Number(current.spins_used);
    let totalWins = Number(current.total_wins);
    const outcomes: SpinOutcome[] = [];

    for (let index = 0; index < processed; index += 1) {
      const selectedType = index === 0 ? participantPrize?.prizeType ?? null : null;
      const eventId = randomUUID();
      const eventKey = randomUUID();
      const spinsBefore = spinsAvailable;
      let result: SpinResult = "NONE";
      let prizeSlotId: string | null = null;
      let winId: string | undefined;

      if (selectedType && roleWins[selectedType] >= MAX_ROLE_WINS) {
        result = "REFUND";
      } else if (selectedType) {
        const ordinal = participantPrize?.ordinal;
        if (!ordinal) throw new Error("Campaign prize reservation is missing its ordinal.");
        result = selectedType;
        roleWins[selectedType] += 1;
        totalWins += 1;
        winId = randomUUID();
        prizeSlotId = randomUUID();
        const wonAt = new Date().toISOString();
        await sql`
          insert into spin_prize_slots (
            id, prize_day, prize_type, slot_number, release_at, claim_after, attempts,
            winner_user_id, spin_event_id, claimed_at, campaign_id, campaign_slot_number
          ) values (
            ${prizeSlotId}, ${utcPrizeDay()}::date, ${selectedType}, ${ordinal},
            now(), 1, 1, ${user.id}::uuid, ${eventId}::uuid, now(),
            ${campaign.id}::uuid, ${ordinal}
          )
        `;
        await sql`
          insert into spin_wins (id, user_id, prize_slot_id, prize_type, won_at)
          values (${winId as string}, ${user.id}::uuid, ${prizeSlotId as string}, ${selectedType}, ${wonAt}::timestamptz)
        `;
      }

      if (result !== "REFUND") {
        spinsAvailable -= 1;
        spinsUsed += 1;
      }
      const outcome: SpinOutcome = {
        eventId,
        result,
        spinsLeft: spinsAvailable,
        spinsUsed,
        totalWins,
        ...(winId ? { winId } : {}),
      };
      outcomes.push(outcome);
      if (winId) {
        await sql`
          insert into spin_events (
            id, user_id, campaign_id, idempotency_key, result, prize_slot_id,
            spins_before, spins_after, response, rollup_recorded
          ) values (
            ${eventId}, ${user.id}::uuid, ${campaign.id}::uuid, ${eventKey}::uuid,
            ${result}, ${prizeSlotId}::uuid, ${spinsBefore}, ${spinsAvailable},
            ${JSON.stringify(outcome)}::jsonb, true
          )
        `;
      }
    }

    await sql`
      update spin_users
      set spins_available = ${spinsAvailable},
          spins_used = ${spinsUsed},
          total_wins = ${totalWins},
          last_spin_at = now(),
          last_seen_at = now(),
          updated_at = now()
      where id = ${user.id}::uuid
    `;
    await sql`
      insert into spin_campaign_counters (
        campaign_id, counter_shard, spins_processed, updated_at
      ) values (
        ${campaign.id}::uuid, ${metricShard}, ${processed}, now()
      )
      on conflict (campaign_id, counter_shard) do update set
        spins_processed = spin_campaign_counters.spins_processed + excluded.spins_processed,
        updated_at = now()
    `;

    const summary = {
      none: outcomes.filter((outcome) => outcome.result === "NONE").length,
      refunded: outcomes.filter((outcome) => outcome.result === "REFUND").length,
      GTD: outcomes.filter((outcome) => outcome.result === "GTD").length,
      FCFS1: outcomes.filter((outcome) => outcome.result === "FCFS1").length,
      FCFS2: outcomes.filter((outcome) => outcome.result === "FCFS2").length,
    };
    await sql`
      insert into spin_daily_rollups (
        campaign_id, metric_day, metric_shard, attempts, spins_consumed, spins_refunded,
        no_prize, gtd_wins, fcfs1_wins, fcfs2_wins, updated_at
      ) values (
        ${campaign.id}::uuid, ${utcPrizeDay()}::date, ${metricShard}, ${processed},
        ${processed - summary.refunded}, ${summary.refunded}, ${summary.none},
        ${summary.GTD}, ${summary.FCFS1}, ${summary.FCFS2}, now()
      )
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
    const batchId = randomUUID();
    const response: SpinBatchResponse = {
      batchId,
      requested: requestedCount,
      processed,
      consumedSpins: availableAtStart - spinsAvailable,
      spinsLeft: spinsAvailable,
      spinsUsed,
      totalWins,
      results: outcomes,
      summary,
    };
    await sql`
      insert into spin_batches (
        id, user_id, campaign_id, idempotency_key, requested_count, response
      ) values (
        ${batchId}, ${user.id}::uuid, ${campaign.id}::uuid,
        ${idempotencyKey}::uuid, ${requestedCount}, ${JSON.stringify(response)}::jsonb
      )
    `;
    return response;
  });
}

async function changeWinWallet(user: SpinUser, winId: string, walletValue: string | null) {
  const removing = walletValue === null;
  const wallet = walletValue?.trim() ?? "";
  if (!removing && !/^(?:0x)[a-fA-F0-9]{40}$/.test(wallet)) {
    throw new HttpError(400, "Enter a valid EVM wallet beginning with 0x.", "BAD_WALLET");
  }
  return inTransaction(async (sql) => {
    const settings = await getSpinSettings(sql);
    if (!settings.allowWalletSubmissions) {
      throw new HttpError(403, "Wallet submissions are temporarily paused by Bunny Hood.", "WALLET_SUBMISSIONS_PAUSED");
    }
    const wins = await sql<{
      id: string;
      prize_type: PrizeType;
      won_at: Date | string;
      wallet_address: string | null;
    }[]>`
      select id, prize_type, won_at, wallet_address
      from spin_wins
      where id = ${winId}::uuid and user_id = ${user.id}::uuid
      limit 1
      for update
    `;
    const win = wins[0];
    if (!win) throw new HttpError(404, "Win not found.", "WIN_NOT_FOUND");
    if (removing) {
      if (win.wallet_address && !settings.allowWalletChanges) {
        throw new HttpError(409, "Wallet changes are currently locked by Bunny Hood.", "WALLET_LOCKED");
      }
      if (!win.wallet_address) {
        return {
          wallet: null,
          alreadySubmitted: false,
          walletUpdated: false,
          walletRemoved: false,
        };
      }
      const previousWalletHash = sha256(win.wallet_address.toLowerCase());
      await sql`
        update spin_wins
        set wallet_address = null, wallet_submitted_at = null
        where id = ${win.id}::uuid
      `;
      await sql`
        insert into spin_wallet_history (win_id, user_id, action, wallet_hash)
        values (${win.id}::uuid, ${user.id}::uuid, 'removed', ${previousWalletHash})
      `;
      return {
        wallet: null,
        alreadySubmitted: false,
        walletUpdated: false,
        walletRemoved: Boolean(win.wallet_address),
      };
    }

    const walletHash = sha256(wallet.toLowerCase());
    await sql`select pg_advisory_xact_lock(hashtext(${`winner-wallet:${walletHash}`}))`;
    const sameWallet = win.wallet_address?.toLowerCase() === wallet.toLowerCase();
    if (win.wallet_address) {
      if (!sameWallet && !settings.allowWalletChanges) {
        throw new HttpError(409, "Wallet changes are currently locked by Bunny Hood.", "WALLET_LOCKED");
      }
    }
    const duplicate = await sql<{ id: string }[]>`
      select id from spin_wins
      where lower(wallet_address) = lower(${wallet}) and id <> ${win.id}::uuid
      limit 1
    `;
    if (duplicate[0]) {
      throw new HttpError(409, "That wallet is already attached to another win.", "WALLET_ALREADY_USED");
    }
    const registered = await sql<{ first_win_id: string }[]>`
      select first_win_id from spin_wallet_registry
      where wallet_hash = ${walletHash}
      limit 1
    `;
    if (registered[0] && registered[0].first_win_id !== win.id) {
      throw new HttpError(409, "That wallet has already been used for another win.", "WALLET_ALREADY_USED");
    }
    await sql`
      insert into spin_wallet_registry (wallet_hash, first_win_id, first_user_id)
      values (${walletHash}, ${win.id}::uuid, ${user.id}::uuid)
      on conflict (wallet_hash) do nothing
    `;
    const updated = await sql<{ wallet_address: string; wallet_submitted_at: Date | string }[]>`
      update spin_wins
      set wallet_address = ${wallet}, wallet_submitted_at = now()
      where id = ${win.id}::uuid
      returning wallet_address, wallet_submitted_at
    `;
    if (!sameWallet) {
      await sql`
        insert into spin_wallet_history (win_id, user_id, action, wallet_hash)
        values (
          ${win.id}::uuid, ${user.id}::uuid,
          ${win.wallet_address ? "replaced" : "submitted"}, ${walletHash}
        )
      `;
    }
    return {
      wallet: updated[0].wallet_address,
      alreadySubmitted: Boolean(sameWallet),
      walletUpdated: Boolean(win.wallet_address && !sameWallet),
      walletRemoved: false,
    };
  });
}

export async function submitWinWallet(user: SpinUser, winId: string, walletValue: string) {
  return changeWinWallet(user, winId, walletValue);
}

export async function removeWinWallet(user: SpinUser, winId: string) {
  return changeWinWallet(user, winId, null);
}

export async function getWheelState(user: SpinUser | null, knownStorage?: StorageSafetyState) {
  await ensureProductionSchema();
  const sql = getDb();
  const storage = knownStorage ?? await getStorageSafetyState();
  const communityRows = await sql<{ connected_users: number }[]>`
    select coalesce(sum(connected_users), 0)::bigint as connected_users
    from spin_connected_user_counters
  `;
  const community = { connectedUsers: Number(communityRows[0]?.connected_users ?? 0) };

  if (storage.paused) {
    return {
      authenticated: Boolean(user),
      storageSafetyPaused: true,
      campaign: null,
      wheelAvailable: false,
      walletChangesAllowed: false,
      walletSubmissionsAllowed: false,
      community,
    };
  }

  if (user) await settleMaturedCampaignTasks(user);
  const campaign = await getActiveCampaign(sql);
  const prizeCampaign = await getLatestPrizeCampaign(sql);
  const settings = await getSpinSettings(sql);

  if (!user) {
    return {
      authenticated: false,
      storageSafetyPaused: false,
      campaign: publicCampaign(campaign),
      wheelAvailable: Boolean(prizeCampaign),
      walletChangesAllowed: settings.allowWalletChanges,
      walletSubmissionsAllowed: settings.allowWalletSubmissions,
      community,
    };
  }
  const currentUsers = await sql<SpinUserRow[]>`
    select id, x_user_id, x_username, x_name, spins_earned, spins_available, spins_used, points, total_wins,
      referral_code, referral_count, referral_spins_earned
    from spin_users where id = ${user.id}::uuid limit 1
  `;
  const current = currentUsers[0];
  if (!current) {
    return {
      authenticated: false,
      storageSafetyPaused: false,
      campaign: publicCampaign(campaign),
      wheelAvailable: Boolean(prizeCampaign),
      walletChangesAllowed: settings.allowWalletChanges,
      walletSubmissionsAllowed: settings.allowWalletSubmissions,
      community,
    };
  }
  current.referral_code = await ensureReferralCode(sql, current);

  const progress = campaign
    ? await getRoundProgress(sql, user.id, campaign.id, campaign.round_number)
    : { claimedTasks: [] as TaskType[], codeAwardedSpins: null as number | null };
  const taskStarts = campaign ? await sql<{ task_type: TaskType; ready_at: Date | string; remaining_ms: number }[]>`
    select task_type, started_at + interval '5 seconds' as ready_at,
      greatest(0, ceil(extract(epoch from (
        (started_at + interval '5 seconds') - clock_timestamp()
      )) * 1000))::int as remaining_ms
    from spin_task_starts starts
    where user_id = ${user.id}::uuid
      and round_id = ${campaign.round_id}::uuid
  ` : [];
  const wins = await sql<{
    id: string;
    prize_type: PrizeType;
    won_at: Date | string;
    wallet_address: string | null;
    wallet_submitted_at: Date | string | null;
  }[]>`
    select id, prize_type, won_at, wallet_address, wallet_submitted_at
    from spin_wins
    where user_id = ${user.id}::uuid
    order by won_at desc
  `;
  const roleWins = emptyRoleCounts();
  for (const win of wins) roleWins[win.prize_type] += 1;

  return {
    authenticated: true,
    storageSafetyPaused: false,
    user: {
      id: current.id,
      xUserId: current.x_user_id,
      xUsername: current.x_username,
      xName: current.x_name,
      spinsEarned: Number(current.spins_earned),
      spinsAvailable: Number(current.spins_available),
      spinsUsed: Number(current.spins_used),
      points: Number(current.points),
      totalWins: Number(current.total_wins),
      roleWins,
    },
    referral: {
      code: current.referral_code,
      successfulReferrals: Number(current.referral_count),
      spinsEarned: Number(current.referral_spins_earned),
    },
    community,
    campaign: publicCampaign(campaign),
    wheelAvailable: Boolean(prizeCampaign),
    walletChangesAllowed: settings.allowWalletChanges,
    walletSubmissionsAllowed: settings.allowWalletSubmissions,
    claimedTasks: progress.claimedTasks,
    taskStarts: taskStarts.filter((start) => !progress.claimedTasks.includes(start.task_type)).map((start) => ({
      taskType: start.task_type,
      readyAt: new Date(start.ready_at).toISOString(),
      waitMs: Number(start.remaining_ms),
    })),
    codeRedemption: progress.codeAwardedSpins === null
      ? null
      : { awardedSpins: progress.codeAwardedSpins },
    wins: wins.map((win) => ({
      id: win.id,
      prizeType: win.prize_type,
      wonAt: new Date(win.won_at).toISOString(),
      wallet: win.wallet_address,
      walletSubmittedAt: win.wallet_submitted_at ? new Date(win.wallet_submitted_at).toISOString() : null,
    })),
  };
}

function publicCampaign(campaign: CampaignRow | null) {
  return campaign ? {
    id: campaign.id,
    title: campaign.title,
    roundNumber: Number(campaign.round_number),
    tweetUrl: campaign.tweet_url,
    startsAt: new Date(campaign.starts_at).toISOString(),
    endsAt: new Date(campaign.ends_at).toISOString(),
  } : null;
}
