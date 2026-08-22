import { getActiveCampaign } from "./campaigns";
import { getDb } from "./db";
import { HttpError } from "./http";
import { RAW_SPIN_RETENTION_HOURS } from "./maintenance";
import { ensureProductionSchema } from "./schema";
import { getSpinSettings } from "./settings";
import { STORAGE_SAFETY_LIMIT_BYTES } from "./storage-safety";
import type { PrizeType } from "./wheel";

export type AdminRecordView = "users" | "wins" | "referrals";

function numeric(value: unknown) {
  return Number(value ?? 0);
}

function iso(value: Date | string | null | undefined) {
  return value ? new Date(value).toISOString() : null;
}

export async function getAdminOverview() {
  await ensureProductionSchema();
  const sql = getDb();
  const [campaign, settings] = await Promise.all([
    getActiveCampaign(sql),
    getSpinSettings(sql),
  ]);

  const [totals, inventory, databaseSize, tableStats, retention, daily, integrity] = await Promise.all([
    sql<{
      users: number;
      active_24h: number;
      spins_earned: number | string;
      spins_available: number | string;
      spins_used: number | string;
      points: number | string;
      wins: number;
      pending_wallets: number;
      referrals: number;
      gtd_wins: number;
      fcfs1_wins: number;
      fcfs2_wins: number;
    }[]>`
      select
        count(*)::int as users,
        count(*) filter (where last_seen_at >= now() - interval '24 hours')::int as active_24h,
        coalesce(sum(spins_earned), 0)::text as spins_earned,
        coalesce(sum(spins_available), 0)::text as spins_available,
        coalesce(sum(spins_used), 0)::text as spins_used,
        coalesce(sum(points), 0)::text as points,
        (select count(*)::int from spin_wins) as wins,
        (select count(*)::int from spin_wins where wallet_address is null) as pending_wallets,
        (select count(*)::int from spin_referrals) as referrals,
        (select count(*)::int from spin_wins where prize_type = 'GTD') as gtd_wins,
        (select count(*)::int from spin_wins where prize_type = 'FCFS1') as fcfs1_wins,
        (select count(*)::int from spin_wins where prize_type = 'FCFS2') as fcfs2_wins
      from spin_users
    `,
    campaign ? sql<{ prize_type: PrizeType; claimed: number; total: number }[]>`
      select prize_type, awarded_count::int as claimed, total_count::int as total
      from spin_campaign_prizes
      where campaign_id = ${campaign.id}::uuid
      order by case prize_type when 'GTD' then 1 when 'FCFS1' then 2 else 3 end
    ` : Promise.resolve([]),
    sql<{ bytes: number | string }[]>`
      select pg_database_size(current_database())::text as bytes
    `,
    sql<{ table_name: string; bytes: number | string; estimated_rows: number | string }[]>`
      select relname as table_name,
        pg_total_relation_size(relid)::text as bytes,
        n_live_tup::text as estimated_rows
      from pg_stat_user_tables
      where schemaname = 'public' and relname like 'spin_%'
      order by pg_total_relation_size(relid) desc
      limit 12
    `,
    sql<{
      raw_events: number | string;
      oldest_raw_event: Date | string | null;
      recorded_attempts: number | string;
      last_maintenance_at: Date | string | null;
      last_archived: number | string;
    }[]>`
      select
        (select count(*)::bigint from spin_events)::text as raw_events,
        (select min(created_at) from spin_events) as oldest_raw_event,
        (select coalesce(sum(attempts), 0)::bigint from spin_daily_rollups)::text as recorded_attempts,
        (select completed_at from spin_maintenance_runs order by completed_at desc limit 1) as last_maintenance_at,
        (select raw_events_archived from spin_maintenance_runs order by completed_at desc limit 1)::text as last_archived
    `,
    sql<{
      metric_day: Date | string;
      attempts: number | string;
      spins_consumed: number | string;
      spins_refunded: number | string;
      no_prize: number | string;
      gtd_wins: number | string;
      fcfs1_wins: number | string;
      fcfs2_wins: number | string;
    }[]>`
      select metric_day,
        sum(attempts)::text as attempts,
        sum(spins_consumed)::text as spins_consumed,
        sum(spins_refunded)::text as spins_refunded,
        sum(no_prize)::text as no_prize,
        sum(gtd_wins)::text as gtd_wins,
        sum(fcfs1_wins)::text as fcfs1_wins,
        sum(fcfs2_wins)::text as fcfs2_wins
      from spin_daily_rollups
      group by metric_day
      order by metric_day desc
      limit 14
    `,
    sql<{ accounting_mismatches: number; win_mismatches: number }[]>`
      select
        count(*) filter (
          where spins_earned <> spins_available + spins_used
        )::int as accounting_mismatches,
        count(*) filter (
          where total_wins <> (
            select count(*)::int from spin_wins wins where wins.user_id = users.id
          )
        )::int as win_mismatches
      from spin_users users
    `,
  ]);

  const total = totals[0];
  const retentionRow = retention[0];
  return {
    campaign: campaign ? {
      id: campaign.id,
      title: campaign.title,
      tweetUrl: campaign.tweet_url,
      startsAt: new Date(campaign.starts_at).toISOString(),
      endsAt: new Date(campaign.ends_at).toISOString(),
      roundNumber: Number(campaign.round_number),
      expectedUsers: Number(campaign.expected_users),
      expectedSpinsPerUser: Number(campaign.expected_spins_per_user),
      spinsProcessed: Number(campaign.spins_processed),
    } : null,
    totals: {
      users: numeric(total?.users),
      active24h: numeric(total?.active_24h),
      spinsEarned: numeric(total?.spins_earned),
      spinsAvailable: numeric(total?.spins_available),
      spinsUsed: numeric(total?.spins_used),
      points: numeric(total?.points),
      wins: numeric(total?.wins),
      pendingWallets: numeric(total?.pending_wallets),
      referrals: numeric(total?.referrals),
      roleWins: {
        GTD: numeric(total?.gtd_wins),
        FCFS1: numeric(total?.fcfs1_wins),
        FCFS2: numeric(total?.fcfs2_wins),
      },
    },
    inventory: inventory.map((item) => ({
      prizeType: item.prize_type,
      claimed: Number(item.claimed),
      total: Number(item.total),
    })),
    settings,
    storage: {
      databaseBytes: numeric(databaseSize[0]?.bytes),
      safetyLimitBytes: STORAGE_SAFETY_LIMIT_BYTES,
      remainingBeforePause: Math.max(0, STORAGE_SAFETY_LIMIT_BYTES - numeric(databaseSize[0]?.bytes)),
      safetyPaused: numeric(databaseSize[0]?.bytes) >= STORAGE_SAFETY_LIMIT_BYTES,
      rawEvents: numeric(retentionRow?.raw_events),
      recordedAttempts: numeric(retentionRow?.recorded_attempts),
      rawRetentionHours: RAW_SPIN_RETENTION_HOURS,
      oldestRawEvent: iso(retentionRow?.oldest_raw_event),
      lastMaintenanceAt: iso(retentionRow?.last_maintenance_at),
      lastArchived: numeric(retentionRow?.last_archived),
      tables: tableStats.map((table) => ({
        name: table.table_name,
        bytes: numeric(table.bytes),
        estimatedRows: numeric(table.estimated_rows),
      })),
    },
    integrity: {
      accountingMismatches: numeric(integrity[0]?.accounting_mismatches),
      winMismatches: numeric(integrity[0]?.win_mismatches),
    },
    daily: daily.map((row) => ({
      day: new Date(row.metric_day).toISOString().slice(0, 10),
      attempts: numeric(row.attempts),
      spinsConsumed: numeric(row.spins_consumed),
      spinsRefunded: numeric(row.spins_refunded),
      noPrize: numeric(row.no_prize),
      GTD: numeric(row.gtd_wins),
      FCFS1: numeric(row.fcfs1_wins),
      FCFS2: numeric(row.fcfs2_wins),
    })),
    generatedAt: new Date().toISOString(),
  };
}

function normalizePage(value: number, fallback: number, minimum: number, maximum: number) {
  return Number.isInteger(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

export async function getAdminRecords(input: {
  view: string;
  page: number;
  pageSize: number;
  search: string;
}) {
  await ensureProductionSchema();
  if (!(["users", "wins", "referrals"] as string[]).includes(input.view)) {
    throw new HttpError(400, "Choose users, wins, or referrals.", "BAD_RECORD_VIEW");
  }
  const view = input.view as AdminRecordView;
  const page = normalizePage(input.page, 1, 1, 1_000_000);
  const pageSize = normalizePage(input.pageSize, 25, 10, 100);
  const search = input.search.trim().replace(/^@/, "").slice(0, 80);
  const pattern = `%${search}%`;
  const offset = (page - 1) * pageSize;
  const sql = getDb();

  if (view === "users") {
    const [countRows, rows] = await Promise.all([
      sql<{ count: number }[]>`
        select count(*)::int as count
        from spin_users users
        where ${search} = ''
          or users.x_username ilike ${pattern}
          or users.x_name ilike ${pattern}
          or users.x_user_id ilike ${pattern}
          or coalesce(users.referral_code, '') ilike ${pattern}
      `,
      sql<{
        id: string;
        x_user_id: string;
        x_username: string;
        x_name: string;
        spins_earned: number | string;
        spins_available: number | string;
        spins_used: number | string;
        points: number | string;
        total_wins: number;
        gtd_wins: number;
        fcfs1_wins: number;
        fcfs2_wins: number;
        referral_code: string | null;
        referral_count: number;
        created_at: Date | string;
        last_seen_at: Date | string;
        last_spin_at: Date | string | null;
      }[]>`
        select users.id, users.x_user_id, users.x_username, users.x_name,
          users.spins_earned, users.spins_available, users.spins_used, users.points,
          users.total_wins,
          count(wins.id) filter (where wins.prize_type = 'GTD')::int as gtd_wins,
          count(wins.id) filter (where wins.prize_type = 'FCFS1')::int as fcfs1_wins,
          count(wins.id) filter (where wins.prize_type = 'FCFS2')::int as fcfs2_wins,
          users.referral_code, users.referral_count,
          users.created_at, users.last_seen_at, users.last_spin_at
        from spin_users users
        left join spin_wins wins on wins.user_id = users.id
        where ${search} = ''
          or users.x_username ilike ${pattern}
          or users.x_name ilike ${pattern}
          or users.x_user_id ilike ${pattern}
          or coalesce(users.referral_code, '') ilike ${pattern}
        group by users.id
        order by users.created_at desc, users.id
        limit ${pageSize} offset ${offset}
      `,
    ]);
    return {
      view, page, pageSize, total: Number(countRows[0]?.count ?? 0),
      rows: rows.map((row) => ({
        id: row.id,
        xUserId: row.x_user_id,
        xUsername: row.x_username,
        xName: row.x_name,
        spinsEarned: numeric(row.spins_earned),
        spinsAvailable: numeric(row.spins_available),
        spinsUsed: numeric(row.spins_used),
        points: numeric(row.points),
        totalWins: Number(row.total_wins),
        roleWins: { GTD: Number(row.gtd_wins), FCFS1: Number(row.fcfs1_wins), FCFS2: Number(row.fcfs2_wins) },
        referralCode: row.referral_code,
        referralCount: Number(row.referral_count),
        createdAt: iso(row.created_at),
        lastSeenAt: iso(row.last_seen_at),
        lastSpinAt: iso(row.last_spin_at),
      })),
    };
  }

  if (view === "wins") {
    const [countRows, rows] = await Promise.all([
      sql<{ count: number }[]>`
        select count(*)::int as count
        from spin_wins wins
        join spin_users users on users.id = wins.user_id
        where ${search} = ''
          or users.x_username ilike ${pattern}
          or users.x_user_id ilike ${pattern}
          or coalesce(wins.wallet_address, '') ilike ${pattern}
          or wins.prize_type ilike ${pattern}
      `,
      sql<{
        id: string;
        x_user_id: string;
        x_username: string;
        x_name: string;
        prize_type: PrizeType;
        won_at: Date | string;
        wallet_address: string | null;
        wallet_submitted_at: Date | string | null;
      }[]>`
        select wins.id, users.x_user_id, users.x_username, users.x_name,
          wins.prize_type, wins.won_at, wins.wallet_address, wins.wallet_submitted_at
        from spin_wins wins
        join spin_users users on users.id = wins.user_id
        where ${search} = ''
          or users.x_username ilike ${pattern}
          or users.x_user_id ilike ${pattern}
          or coalesce(wins.wallet_address, '') ilike ${pattern}
          or wins.prize_type ilike ${pattern}
        order by wins.won_at desc, wins.id
        limit ${pageSize} offset ${offset}
      `,
    ]);
    return {
      view, page, pageSize, total: Number(countRows[0]?.count ?? 0),
      rows: rows.map((row) => ({
        id: row.id,
        xUserId: row.x_user_id,
        xUsername: row.x_username,
        xName: row.x_name,
        prizeType: row.prize_type,
        wonAt: iso(row.won_at),
        wallet: row.wallet_address,
        walletSubmittedAt: iso(row.wallet_submitted_at),
        walletStatus: row.wallet_address ? "submitted" : "waiting",
      })),
    };
  }

  const [countRows, rows] = await Promise.all([
    sql<{ count: number }[]>`
      select count(*)::int as count
      from spin_referrals referrals
      join spin_users referrers on referrers.id = referrals.referrer_user_id
      join spin_users referred on referred.id = referrals.referred_user_id
      where ${search} = ''
        or referrers.x_username ilike ${pattern}
        or referred.x_username ilike ${pattern}
        or referrals.referral_code ilike ${pattern}
    `,
    sql<{
      id: string;
      referrer_username: string;
      referrer_x_user_id: string;
      referred_username: string;
      referred_x_user_id: string;
      referral_code: string;
      awarded_spins: number;
      created_at: Date | string;
    }[]>`
      select referrals.id,
        referrers.x_username as referrer_username,
        referrers.x_user_id as referrer_x_user_id,
        referred.x_username as referred_username,
        referred.x_user_id as referred_x_user_id,
        referrals.referral_code, referrals.awarded_spins, referrals.created_at
      from spin_referrals referrals
      join spin_users referrers on referrers.id = referrals.referrer_user_id
      join spin_users referred on referred.id = referrals.referred_user_id
      where ${search} = ''
        or referrers.x_username ilike ${pattern}
        or referred.x_username ilike ${pattern}
        or referrals.referral_code ilike ${pattern}
      order by referrals.created_at desc, referrals.id
      limit ${pageSize} offset ${offset}
    `,
  ]);
  return {
    view, page, pageSize, total: Number(countRows[0]?.count ?? 0),
    rows: rows.map((row) => ({
      id: row.id,
      referrerUsername: row.referrer_username,
      referrerXUserId: row.referrer_x_user_id,
      referredUsername: row.referred_username,
      referredXUserId: row.referred_x_user_id,
      referralCode: row.referral_code,
      awardedSpins: Number(row.awarded_spins),
      createdAt: iso(row.created_at),
    })),
  };
}
