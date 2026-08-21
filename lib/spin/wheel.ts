import { createHmac, randomInt, randomUUID } from "node:crypto";
import type { SpinUser } from "./auth";
import type { CampaignRow, TaskType } from "./campaigns";
import { getActiveCampaign, getLatestPrizeCampaign, settleMaturedCampaignTasks } from "./campaigns";
import { requireStrongSecret } from "./config";
import { getDb, inTransaction } from "./db";
import { HttpError } from "./http";
import { enforceRateLimit } from "./rate-limit";
import { hashRedeemCode, normalizeRedeemCode, safeEqual } from "./security";
import { queueSheetSync } from "./sheets";
import { getSpinSettings } from "./settings";
import { ensureReferralCode, spinUserSheetPayload, type SpinUserRow } from "./users";

export type PrizeType = "GTD" | "FCFS1" | "FCFS2";
export type SpinResult = PrizeType | "NONE" | "REFUND";

const PRIZE_TYPES: PrizeType[] = ["GTD", "FCFS1", "FCFS2"];
const MAX_ROLE_WINS = 3;
const MAX_BATCH_SPINS = 100;
const MAX_TYPE_PROBABILITY = 0.18;
const MAX_COMBINED_PROBABILITY = 0.55;
const PROBABILITY_SCALE = 1_000_000_000;

type CampaignPrize = {
  campaign_id: string;
  prize_type: PrizeType;
  total_count: number;
  awarded_count: number;
};

type RoleWinCounts = Record<PrizeType, number>;

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

function deterministicNumber(campaignId: string, prizeType: PrizeType, ordinal: number) {
  const bytes = createHmac("sha256", requireStrongSecret("PRIZE_RANDOM_SECRET"))
    .update(`${campaignId}:${prizeType}:release:${ordinal}`)
    .digest();
  return bytes.readUInt32BE(0) / 0x1_0000_0000;
}

function releasedPrizeCount(campaign: CampaignRow, prize: CampaignPrize, now = Date.now()) {
  const total = Number(prize.total_count);
  if (total <= 0) return 0;
  const start = new Date(campaign.starts_at).getTime();
  const end = new Date(campaign.ends_at).getTime();
  if (now <= start) return 0;
  if (now >= end) return total;
  const elapsed = (now - start) / Math.max(1, end - start);
  const releaseFraction = (index: number) => (
    index + 0.2 + deterministicNumber(campaign.id, prize.prize_type, index) * 0.6
  ) / total;

  let low = 0;
  let high = total;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (releaseFraction(middle - 1) <= elapsed) low = middle;
    else high = middle - 1;
  }
  return low;
}

function choosePrize(
  campaign: CampaignRow,
  prizes: CampaignPrize[],
  observedCampaignSpins: number,
  roleWins: RoleWinCounts,
) {
  const expectedTotalSpins = Math.max(
    1,
    Number(campaign.expected_users) * Number(campaign.expected_spins_per_user),
  );
  const start = new Date(campaign.starts_at).getTime();
  const end = new Date(campaign.ends_at).getTime();
  const elapsed = Math.min(0.999_999, Math.max(0.000_001, (Date.now() - start) / Math.max(1, end - start)));
  const paceProjection = observedCampaignSpins > 0
    ? Math.max(observedCampaignSpins, observedCampaignSpins / elapsed)
    : expectedTotalSpins;
  const paceConfidence = Math.min(1, observedCampaignSpins / Math.max(1, expectedTotalSpins * 0.1));
  const projectedTotalSpins = expectedTotalSpins * (1 - paceConfidence) + paceProjection * paceConfidence;
  const expectedRemainingSpins = Math.max(1, Math.ceil(projectedTotalSpins - observedCampaignSpins));
  const weighted = PRIZE_TYPES.map((type) => {
    const prize = prizes.find((item) => item.prize_type === type);
    if (!prize) return { type, probability: 0 };
    const total = Number(prize.total_count);
    const awarded = Number(prize.awarded_count);
    const released = releasedPrizeCount(campaign, prize);
    if (awarded >= total || awarded >= released) return { type, probability: 0 };
    const remaining = total - awarded;
    const repeatMultiplier = 0.5 ** Math.min(MAX_ROLE_WINS, roleWins[type]);
    return {
      type,
      probability: Math.min(MAX_TYPE_PROBABILITY, remaining / expectedRemainingSpins) * repeatMultiplier,
    };
  });

  const combined = weighted.reduce((sum, item) => sum + item.probability, 0);
  if (combined <= 0) return null;
  const scale = combined > MAX_COMBINED_PROBABILITY
    ? MAX_COMBINED_PROBABILITY / combined
    : 1;
  const draw = randomInt(PROBABILITY_SCALE) / PROBABILITY_SCALE;
  let cursor = 0;
  for (const item of weighted) {
    cursor += item.probability * scale;
    if (draw < cursor) return item.type;
  }
  return null;
}

function emptyRoleCounts(): RoleWinCounts {
  return { GTD: 0, FCFS1: 0, FCFS2: 0 };
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
    const existing = await transaction<{ awarded_spins: number }[]>`
      select awarded_spins from spin_code_redemptions
      where user_id = ${user.id}::uuid and round_id = ${campaign.round_id}::uuid
      limit 1
    `;
    if (existing[0]) {
      throw new HttpError(409, "You already redeemed this campaign code.", "CODE_ALREADY_REDEEMED");
    }
    const awarded = randomInt(10, 21);
    await transaction`
      insert into spin_code_redemptions (id, user_id, campaign_id, round_id, awarded_spins)
      values (${randomUUID()}, ${user.id}::uuid, ${campaign.id}::uuid, ${campaign.round_id}::uuid, ${awarded})
    `;
    const updated = await transaction<SpinUserRow[]>`
      update spin_users
      set spins_available = spins_available + ${awarded}, updated_at = now()
      where id = ${user.id}::uuid
      returning id, x_user_id, x_username, x_name, spins_available, spins_used, points, total_wins,
        referral_code, referral_count, referral_spins_earned
    `;
    await queueSheetSync(transaction, "spin_user", `user:${user.id}`, spinUserSheetPayload(updated[0]));
    return { awardedSpins: awarded, spinsAvailable: Number(updated[0].spins_available) };
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
  const database = getDb();
  await enforceRateLimit(`spin:${user.id}`, 60, 60, database);

  return inTransaction(async (sql) => {
    await sql`select pg_advisory_xact_lock_shared(hashtext('bunny-hood-active-campaign'))`;
    const locked = await sql<SpinUserRow[]>`
      select id, x_user_id, x_username, x_name, spins_available, spins_used, points, total_wins,
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

    const prizes = await sql<CampaignPrize[]>`
      select campaign_id, prize_type, total_count, awarded_count
      from spin_campaign_prizes
      where campaign_id = ${campaign.id}::uuid
      order by case prize_type when 'GTD' then 1 when 'FCFS1' then 2 else 3 end
    `;
    if (prizes.length !== 3) {
      throw new HttpError(503, "Campaign prizes are not configured yet.", "PRIZES_NOT_CONFIGURED");
    }
    const observedRows = await sql<{ count: number }[]>`
      select count(*)::int as count from spin_events where campaign_id = ${campaign.id}::uuid
    `;
    let observedCampaignSpins = Number(observedRows[0]?.count ?? 0);
    const roleRows = await sql<{ prize_type: PrizeType; count: number }[]>`
      select prize_type, count(*)::int as count
      from spin_wins where user_id = ${user.id}::uuid group by prize_type
    `;
    const roleWins = emptyRoleCounts();
    for (const row of roleRows) roleWins[row.prize_type] = Number(row.count);

    let spinsAvailable = availableAtStart;
    let spinsUsed = Number(current.spins_used);
    let totalWins = Number(current.total_wins);
    const outcomes: SpinOutcome[] = [];
    const newWins: Array<{ winId: string; prizeType: PrizeType; wonAt: string }> = [];

    for (let index = 0; index < processed; index += 1) {
      const selectedType = choosePrize(campaign, prizes, observedCampaignSpins, roleWins);
      const eventId = randomUUID();
      const eventKey = randomUUID();
      const spinsBefore = spinsAvailable;
      let result: SpinResult = "NONE";
      let prizeSlotId: string | null = null;
      let winId: string | undefined;

      if (selectedType && roleWins[selectedType] >= MAX_ROLE_WINS) {
        result = "REFUND";
      } else if (selectedType) {
        const prize = prizes.find((item) => item.prize_type === selectedType)!;
        const released = releasedPrizeCount(campaign, prize);
        if (Number(prize.awarded_count) < Number(prize.total_count)
          && Number(prize.awarded_count) < released) {
          const reserved = await sql<{ awarded_count: number }[]>`
            update spin_campaign_prizes
            set awarded_count = awarded_count + 1, updated_at = now()
            where campaign_id = ${campaign.id}::uuid
              and prize_type = ${selectedType}
              and awarded_count < total_count
              and awarded_count < ${released}
            returning awarded_count
          `;
          if (reserved[0]) {
            const ordinal = Number(reserved[0].awarded_count);
            result = selectedType;
            prize.awarded_count = ordinal;
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
              values (${winId}, ${user.id}::uuid, ${prizeSlotId}::uuid, ${selectedType}, ${wonAt}::timestamptz)
            `;
            newWins.push({ winId, prizeType: selectedType, wonAt });
          }
        }
      }

      if (result !== "REFUND") {
        spinsAvailable -= 1;
        spinsUsed += 1;
      }
      observedCampaignSpins += 1;
      const outcome: SpinOutcome = {
        eventId,
        result,
        spinsLeft: spinsAvailable,
        spinsUsed,
        totalWins,
        ...(winId ? { winId } : {}),
      };
      outcomes.push(outcome);
      await sql`
        insert into spin_events (
          id, user_id, campaign_id, idempotency_key, result, prize_slot_id,
          spins_before, spins_after, response
        ) values (
          ${eventId}, ${user.id}::uuid, ${campaign.id}::uuid, ${eventKey}::uuid,
          ${result}, ${prizeSlotId}::uuid, ${spinsBefore}, ${spinsAvailable},
          ${JSON.stringify(outcome)}::jsonb
        )
      `;
    }

    const updatedRows = await sql<SpinUserRow[]>`
      update spin_users
      set spins_available = ${spinsAvailable},
          spins_used = ${spinsUsed},
          total_wins = ${totalWins},
          updated_at = now()
      where id = ${user.id}::uuid
      returning id, x_user_id, x_username, x_name, spins_available, spins_used, points, total_wins,
        referral_code, referral_count, referral_spins_earned
    `;

    const summary = {
      none: outcomes.filter((outcome) => outcome.result === "NONE").length,
      refunded: outcomes.filter((outcome) => outcome.result === "REFUND").length,
      GTD: outcomes.filter((outcome) => outcome.result === "GTD").length,
      FCFS1: outcomes.filter((outcome) => outcome.result === "FCFS1").length,
      FCFS2: outcomes.filter((outcome) => outcome.result === "FCFS2").length,
    };
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
    await queueSheetSync(sql, "spin_user", `user:${user.id}`, spinUserSheetPayload(updatedRows[0]));
    for (const win of newWins) {
      await queueSheetSync(sql, "spin_win", `win:${win.winId}`, {
        winId: win.winId,
        userId: user.id,
        xUserId: current.x_user_id,
        xUsername: current.x_username,
        xName: current.x_name,
        prizeType: win.prizeType,
        wonAt: win.wonAt,
        wallet: "",
        walletSubmittedAt: "",
      });
    }
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
      await sql`
        update spin_wins
        set wallet_address = null, wallet_submitted_at = null
        where id = ${win.id}::uuid
      `;
      await queueSheetSync(sql, "spin_win", `win:${win.id}`, {
        winId: win.id,
        userId: user.id,
        xUserId: user.xUserId,
        xUsername: user.xUsername,
        xName: user.xName,
        prizeType: win.prize_type,
        wonAt: new Date(win.won_at).toISOString(),
        wallet: "",
        walletSubmittedAt: "",
        walletChangeAllowed: settings.allowWalletChanges,
      });
      return {
        wallet: null,
        alreadySubmitted: false,
        walletUpdated: false,
        walletRemoved: Boolean(win.wallet_address),
      };
    }

    await sql`select pg_advisory_xact_lock(hashtext(${`winner-wallet:${wallet.toLowerCase()}`}))`;
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
    const updated = await sql<{ wallet_address: string; wallet_submitted_at: Date | string }[]>`
      update spin_wins
      set wallet_address = ${wallet}, wallet_submitted_at = now()
      where id = ${win.id}::uuid
      returning wallet_address, wallet_submitted_at
    `;
    await queueSheetSync(sql, "spin_win", `win:${win.id}`, {
      winId: win.id,
      userId: user.id,
      xUserId: user.xUserId,
      xUsername: user.xUsername,
      xName: user.xName,
      prizeType: win.prize_type,
      wonAt: new Date(win.won_at).toISOString(),
      wallet: updated[0].wallet_address,
      walletSubmittedAt: new Date(updated[0].wallet_submitted_at).toISOString(),
      walletChangeAllowed: settings.allowWalletChanges,
    });
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

export async function getWheelState(user: SpinUser | null) {
  if (user) await settleMaturedCampaignTasks(user);
  const sql = getDb();
  const campaign = await getActiveCampaign(sql);
  const prizeCampaign = await getLatestPrizeCampaign(sql);
  const settings = await getSpinSettings(sql);
  const communityRows = await sql<{ connected_users: number }[]>`
    select count(distinct x_user_id)::int as connected_users from spin_users
  `;
  const community = { connectedUsers: Number(communityRows[0]?.connected_users ?? 0) };

  if (!user) {
    return {
      authenticated: false,
      campaign: publicCampaign(campaign),
      wheelAvailable: Boolean(prizeCampaign),
      walletChangesAllowed: settings.allowWalletChanges,
      walletSubmissionsAllowed: settings.allowWalletSubmissions,
      community,
    };
  }
  const currentUsers = await sql<SpinUserRow[]>`
    select id, x_user_id, x_username, x_name, spins_available, spins_used, points, total_wins,
      referral_code, referral_count, referral_spins_earned
    from spin_users where id = ${user.id}::uuid limit 1
  `;
  const current = currentUsers[0];
  if (!current) {
    return {
      authenticated: false,
      campaign: publicCampaign(campaign),
      wheelAvailable: Boolean(prizeCampaign),
      walletChangesAllowed: settings.allowWalletChanges,
      walletSubmissionsAllowed: settings.allowWalletSubmissions,
      community,
    };
  }
  current.referral_code = await ensureReferralCode(sql, current);

  const claims = campaign ? await sql<{ task_type: TaskType }[]>`
    select task_type from spin_task_claims
    where user_id = ${user.id}::uuid and round_id = ${campaign.round_id}::uuid
  ` : [];
  const taskStarts = campaign ? await sql<{ task_type: TaskType; ready_at: Date | string }[]>`
    select task_type, started_at + interval '5 seconds' as ready_at
    from spin_task_starts starts
    where user_id = ${user.id}::uuid
      and round_id = ${campaign.round_id}::uuid
      and not exists (
        select 1 from spin_task_claims claims
        where claims.user_id = starts.user_id
          and claims.round_id = starts.round_id
          and claims.task_type = starts.task_type
      )
  ` : [];
  const redemptions = campaign ? await sql<{ awarded_spins: number }[]>`
    select awarded_spins from spin_code_redemptions
    where user_id = ${user.id}::uuid and round_id = ${campaign.round_id}::uuid limit 1
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
    user: {
      id: current.id,
      xUserId: current.x_user_id,
      xUsername: current.x_username,
      xName: current.x_name,
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
    claimedTasks: claims.map((claim) => claim.task_type),
    taskStarts: taskStarts.map((start) => ({
      taskType: start.task_type,
      readyAt: new Date(start.ready_at).toISOString(),
    })),
    codeRedemption: redemptions[0] ? { awardedSpins: Number(redemptions[0].awarded_spins) } : null,
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

export async function getAdminDashboard() {
  const sql = getDb();
  const campaign = await getActiveCampaign(sql);
  const settings = await getSpinSettings(sql);
  const [totals, inventory, outbox] = await Promise.all([
    sql<{ users: number; spins: number; wins: number; pending_wallets: number; referrals: number }[]>`
      select
        (select count(distinct x_user_id)::int from spin_users) as users,
        (select coalesce(sum(spins_used), 0)::int from spin_users) as spins,
        (select count(*)::int from spin_wins) as wins,
        (select count(*)::int from spin_wins where wallet_address is null) as pending_wallets,
        (select count(*)::int from spin_referrals) as referrals
    `,
    campaign ? sql<{ prize_type: PrizeType; claimed: number; total: number }[]>`
      select prize_type, awarded_count::int as claimed, total_count::int as total
      from spin_campaign_prizes
      where campaign_id = ${campaign.id}::uuid
      order by case prize_type when 'GTD' then 1 when 'FCFS1' then 2 else 3 end
    ` : Promise.resolve([]),
    sql<{ pending: number }[]>`
      select count(*)::int as pending from spin_sheet_outbox where delivered_at is null
    `,
  ]);
  return {
    campaign: campaign ? {
      ...publicCampaign(campaign),
      expectedUsers: Number(campaign.expected_users),
      expectedSpinsPerUser: Number(campaign.expected_spins_per_user),
    } : null,
    totals: totals[0],
    inventory,
    sheetSyncPending: Number(outbox[0]?.pending ?? 0),
    settings,
  };
}
