import "server-only";

import { randomUUID } from "node:crypto";
import type { SpinUser } from "./auth";
import type { SpinDb } from "./db";
import { getDb, inTransaction } from "./db";
import { HttpError } from "./http";
import { enforceRateLimit } from "./rate-limit";
import { ensureProductionSchema } from "./schema";
import { getSpinSettings, type SpinSettings } from "./settings";

export const BUNNY_CARROT_COST = 3;
export type BunnyRewardType = "GTD" | "FCFS";

type BunnyClock = { today: string; yesterday: string; tomorrow: string; month: string; day_index: number };
type BunnyProfileRow = {
  cycle_number: number;
  streak_days: number;
  longest_streak: number;
  total_carrots: number | string;
  last_fed_day: string | null;
  last_feed_idempotency_key: string | null;
  trade_ready: boolean;
  total_trades: number;
};

export type BunnyState = {
  carrotCost: number;
  cycleNumber: number;
  streakDays: number;
  longestStreak: number;
  totalCarrots: number;
  totalTrades: number;
  targetDays: number;
  daysUntilEvolution: number;
  evolutionLevel: number;
  evolutionName: string;
  progressPercent: number;
  fedToday: boolean;
  canFeed: boolean;
  tradeReady: boolean;
  lastFedDay: string | null;
  nextFeedAt: string;
};

const EVOLUTION_NAMES = ["NEW ARRIVAL", "AWAKE", "GROWING", "HOOD RISING", "FULLY EVOLVED"] as const;

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function getBunnyClock(sql: SpinDb): Promise<BunnyClock> {
  const rows = await sql<BunnyClock[]>`
    select
      to_char((clock_timestamp() at time zone 'UTC')::date, 'YYYY-MM-DD') as today,
      to_char((clock_timestamp() at time zone 'UTC')::date - 1, 'YYYY-MM-DD') as yesterday,
      to_char((clock_timestamp() at time zone 'UTC')::date + 1, 'YYYY-MM-DD') as tomorrow,
      to_char(date_trunc('month', clock_timestamp() at time zone 'UTC')::date, 'YYYY-MM-DD') as month,
      (extract(day from clock_timestamp() at time zone 'UTC')::int - 1) as day_index
  `;
  return rows[0];
}

function currentStreak(profile: BunnyProfileRow | undefined, clock: BunnyClock) {
  if (!profile) return 0;
  if (profile.trade_ready) return Number(profile.streak_days);
  if (profile.last_fed_day === clock.today || profile.last_fed_day === clock.yesterday) {
    return Number(profile.streak_days);
  }
  return 0;
}

function evolutionLevel(streakDays: number, targetDays: number, tradeReady: boolean) {
  if (tradeReady || streakDays >= targetDays) return 4;
  if (streakDays < 1) return 0;
  const progress = streakDays / targetDays;
  if (progress >= 2 / 3) return 3;
  if (progress >= 1 / 3) return 2;
  return 1;
}

async function readBunnyProfile(sql: SpinDb, userId: string) {
  const rows = await sql<BunnyProfileRow[]>`
    select profiles.cycle_number, profiles.streak_days, profiles.longest_streak,
      profiles.total_carrots, profiles.last_fed_day::text, profiles.last_feed_idempotency_key::text,
      profiles.trade_ready,
      (select count(*)::int from spin_bunny_trades trades where trades.user_id = profiles.user_id) as total_trades
    from spin_bunny_profiles profiles
    where profiles.user_id = ${userId}::uuid
    limit 1
  `;
  return rows[0];
}

export async function getBunnyState(
  sql: SpinDb,
  userId: string,
  knownSettings?: SpinSettings,
): Promise<BunnyState> {
  const [clock, settings, profile] = await Promise.all([
    getBunnyClock(sql),
    knownSettings ? Promise.resolve(knownSettings) : getSpinSettings(sql),
    readBunnyProfile(sql, userId),
  ]);
  const streakDays = currentStreak(profile, clock);
  const tradeReady = Boolean(profile?.trade_ready) || streakDays >= settings.bunnyStreakDays;
  const fedToday = profile?.last_fed_day === clock.today;
  const level = evolutionLevel(streakDays, settings.bunnyStreakDays, tradeReady);
  return {
    carrotCost: BUNNY_CARROT_COST,
    cycleNumber: Number(profile?.cycle_number ?? 1),
    streakDays,
    longestStreak: Number(profile?.longest_streak ?? 0),
    totalCarrots: Number(profile?.total_carrots ?? 0),
    totalTrades: Number(profile?.total_trades ?? 0),
    targetDays: settings.bunnyStreakDays,
    daysUntilEvolution: Math.max(0, settings.bunnyStreakDays - streakDays),
    evolutionLevel: level,
    evolutionName: EVOLUTION_NAMES[level],
    progressPercent: Math.min(100, Math.round((streakDays / settings.bunnyStreakDays) * 100)),
    fedToday,
    canFeed: !fedToday && !tradeReady,
    tradeReady,
    lastFedDay: profile?.last_fed_day ?? null,
    nextFeedAt: `${clock.tomorrow}T00:00:00.000Z`,
  };
}

export async function feedBunny(user: SpinUser, idempotencyKey: string) {
  if (!validUuid(idempotencyKey)) {
    throw new HttpError(400, "Refresh the page and try feeding again.", "BAD_IDEMPOTENCY_KEY");
  }
  await ensureProductionSchema();
  const database = getDb();
  await enforceRateLimit(`bunny-feed:${user.id}`, 8, 60, database);

  return inTransaction(async (sql) => {
    const settings = await getSpinSettings(sql);
    const clock = await getBunnyClock(sql);
    const users = await sql<{ points: number | string; points_spent: number | string }[]>`
      select points, points_spent from spin_users
      where id = ${user.id}::uuid for update
    `;
    const currentUser = users[0];
    if (!currentUser) throw new HttpError(401, "Connect X to continue.", "AUTH_REQUIRED");

    await sql`
      insert into spin_bunny_profiles (user_id)
      values (${user.id}::uuid)
      on conflict (user_id) do nothing
    `;
    const profiles = await sql<BunnyProfileRow[]>`
      select profiles.cycle_number, profiles.streak_days, profiles.longest_streak,
        profiles.total_carrots, profiles.last_fed_day::text, profiles.last_feed_idempotency_key::text,
        profiles.trade_ready,
        (select count(*)::int from spin_bunny_trades trades where trades.user_id = profiles.user_id) as total_trades
      from spin_bunny_profiles profiles
      where profiles.user_id = ${user.id}::uuid
      for update
    `;
    const profile = profiles[0];
    if (profile.last_feed_idempotency_key === idempotencyKey) {
      return {
        fed: true,
        repeated: true,
        pointsSpent: BUNNY_CARROT_COST,
        pointsAvailable: Number(currentUser.points) - Number(currentUser.points_spent),
        bunny: await getBunnyState(sql, user.id, settings),
      };
    }
    const activeStreak = currentStreak(profile, clock);
    if (profile.trade_ready || activeStreak >= settings.bunnyStreakDays) {
      throw new HttpError(409, "Your Bunny is fully evolved. Trade it before starting a new cycle.", "BUNNY_TRADE_READY");
    }
    if (profile.last_fed_day === clock.today) {
      throw new HttpError(409, "Your Bunny has already eaten today. The next carrot opens at 00:00 UTC.", "BUNNY_ALREADY_FED");
    }

    const pointsAvailable = Number(currentUser.points) - Number(currentUser.points_spent);
    if (pointsAvailable < BUNNY_CARROT_COST) {
      throw new HttpError(409, `You need ${BUNNY_CARROT_COST - pointsAvailable} more points for today's carrot.`, "NOT_ENOUGH_POINTS");
    }
    const newStreak = profile.last_fed_day === clock.yesterday
      ? Number(profile.streak_days) + 1
      : 1;
    const updatedUsers = await sql<{ points_available: number | string }[]>`
      update spin_users
      set points_spent = points_spent + ${BUNNY_CARROT_COST}, updated_at = now()
      where id = ${user.id}::uuid and points - points_spent >= ${BUNNY_CARROT_COST}
      returning (points - points_spent)::bigint as points_available
    `;
    if (!updatedUsers[0]) {
      throw new HttpError(409, "Your point balance changed. Refresh and try again.", "POINT_BALANCE_CHANGED");
    }
    const dayMask = 2 ** Number(clock.day_index);
    const monthlyFeeds = await sql<{ feeds_count: number }[]>`
      insert into spin_bunny_feed_months (
        user_id, feed_month, feed_bits, feeds_count, points_spent, updated_at
      ) values (
        ${user.id}::uuid, ${clock.month}::date, ${dayMask}::bigint, 1, ${BUNNY_CARROT_COST}, now()
      )
      on conflict (user_id, feed_month) do update set
        feed_bits = spin_bunny_feed_months.feed_bits | excluded.feed_bits,
        feeds_count = spin_bunny_feed_months.feeds_count + 1,
        points_spent = spin_bunny_feed_months.points_spent + ${BUNNY_CARROT_COST},
        updated_at = now()
      where (spin_bunny_feed_months.feed_bits & excluded.feed_bits) = 0
      returning feeds_count
    `;
    if (!monthlyFeeds[0]) {
      throw new HttpError(409, "Your Bunny has already eaten today. The next carrot opens at 00:00 UTC.", "BUNNY_ALREADY_FED");
    }
    await sql`
      update spin_bunny_profiles
      set streak_days = ${newStreak},
          longest_streak = greatest(longest_streak, ${newStreak}),
          total_carrots = total_carrots + 1,
          last_fed_day = ${clock.today}::date,
          last_feed_idempotency_key = ${idempotencyKey}::uuid,
          trade_ready = trade_ready or ${newStreak >= settings.bunnyStreakDays},
          updated_at = now()
      where user_id = ${user.id}::uuid
    `;
    return {
      fed: true,
      repeated: false,
      pointsSpent: BUNNY_CARROT_COST,
      pointsAvailable: Number(updatedUsers[0].points_available),
      bunny: await getBunnyState(sql, user.id, settings),
    };
  });
}

export async function tradeBunny(user: SpinUser, rawRewardType: string, idempotencyKey: string) {
  if (rawRewardType !== "GTD" && rawRewardType !== "FCFS") {
    throw new HttpError(400, "Choose a GTD or FCFS reward.", "BAD_BUNNY_REWARD");
  }
  if (!validUuid(idempotencyKey)) {
    throw new HttpError(400, "Refresh the page and try the trade again.", "BAD_IDEMPOTENCY_KEY");
  }
  await ensureProductionSchema();
  const database = getDb();
  await enforceRateLimit(`bunny-trade:${user.id}`, 8, 60, database);

  return inTransaction(async (sql) => {
    const settings = await getSpinSettings(sql);
    const clock = await getBunnyClock(sql);
    const users = await sql<{ total_wins: number }[]>`
      select total_wins from spin_users where id = ${user.id}::uuid for update
    `;
    const currentUser = users[0];
    if (!currentUser) throw new HttpError(401, "Connect X to continue.", "AUTH_REQUIRED");

    const repeated = await sql<{ trade_id: string; win_id: string; reward_type: BunnyRewardType }[]>`
      select trades.id as trade_id, wins.id as win_id, trades.reward_type
      from spin_bunny_trades trades
      join spin_wins wins on wins.bunny_trade_id = trades.id
      where trades.user_id = ${user.id}::uuid
        and trades.idempotency_key = ${idempotencyKey}::uuid
      limit 1
    `;
    if (repeated[0]) {
      return {
        traded: true,
        repeated: true,
        rewardType: repeated[0].reward_type,
        winId: repeated[0].win_id,
        bunny: await getBunnyState(sql, user.id, settings),
      };
    }

    const profiles = await sql<BunnyProfileRow[]>`
      select profiles.cycle_number, profiles.streak_days, profiles.longest_streak,
        profiles.total_carrots, profiles.last_fed_day::text, profiles.last_feed_idempotency_key::text,
        profiles.trade_ready,
        (select count(*)::int from spin_bunny_trades trades where trades.user_id = profiles.user_id) as total_trades
      from spin_bunny_profiles profiles
      where profiles.user_id = ${user.id}::uuid
      for update
    `;
    const profile = profiles[0];
    const activeStreak = currentStreak(profile, clock);
    if (!profile || (!profile.trade_ready && activeStreak < settings.bunnyStreakDays)) {
      throw new HttpError(409, "Keep the daily feeding streak alive before trading your Bunny.", "BUNNY_NOT_EVOLVED");
    }

    const prizeType = rawRewardType === "GTD" ? "GTD" : "FCFS1";
    const roleRows = await sql<{ count: number }[]>`
      select count(*)::int as count from spin_wins
      where user_id = ${user.id}::uuid and prize_type = ${prizeType}
    `;
    if (Number(currentUser.total_wins) >= 9 || Number(roleRows[0]?.count ?? 0) >= 3) {
      throw new HttpError(409, "Your permanent limit for that role is already full.", "ROLE_LIMIT_REACHED");
    }

    const tradeId = randomUUID();
    const winId = randomUUID();
    await sql`
      insert into spin_bunny_trades (
        id, user_id, cycle_number, reward_type, streak_days, idempotency_key
      ) values (
        ${tradeId}, ${user.id}::uuid, ${profile.cycle_number}, ${rawRewardType},
        ${profile.streak_days}, ${idempotencyKey}::uuid
      )
    `;
    await sql`
      insert into spin_wins (
        id, user_id, prize_slot_id, prize_type, source, shop_purchase_id, bunny_trade_id, won_at
      ) values (
        ${winId}, ${user.id}::uuid, null, ${prizeType}, 'bunny', null, ${tradeId}::uuid, now()
      )
    `;
    await sql`
      update spin_bunny_profiles
      set cycle_number = cycle_number + 1,
          streak_days = 0,
          trade_ready = false,
          updated_at = now()
      where user_id = ${user.id}::uuid
    `;
    return {
      traded: true,
      repeated: false,
      rewardType: rawRewardType as BunnyRewardType,
      winId,
      bunny: await getBunnyState(sql, user.id, settings),
    };
  });
}
