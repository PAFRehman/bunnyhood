import "server-only";

import { randomUUID } from "node:crypto";
import type { SpinUser } from "./auth";
import { getActiveCampaign } from "./campaigns";
import type { SpinDb } from "./db";
import { getDb, inTransaction } from "./db";
import { HttpError } from "./http";
import { enforceRateLimit } from "./rate-limit";
import { ensureProductionSchema } from "./schema";
import { getSpinSettings } from "./settings";

export type ShopSpotType = "GTD" | "FCFS";

type ShopItemRow = {
  spot_type: ShopSpotType;
  points_price: number | string;
  total_count: number;
  purchased_count: number;
  purchased_by_user: boolean;
  win_id: string | null;
};

const DEFAULT_SHOP_ITEMS: Record<ShopSpotType, { pointsPrice: number; totalCount: number }> = {
  GTD: { pointsPrice: 100, totalCount: 0 },
  FCFS: { pointsPrice: 50, totalCount: 0 },
};

function validShopSpotType(value: string): value is ShopSpotType {
  return value === "GTD" || value === "FCFS";
}

function integerInRange(value: number, minimum: number, maximum: number, label: string) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new HttpError(400, `${label} must be a whole number between ${minimum} and ${maximum}.`, "BAD_SHOP_SETTING");
  }
  return value;
}

export async function getShopState(sql: SpinDb, campaignId: string, userId: string) {
  const rows = await sql<ShopItemRow[]>`
    select items.spot_type, items.points_price, items.total_count, items.purchased_count,
      (purchases.id is not null) as purchased_by_user,
      wins.id as win_id
    from spin_shop_items items
    left join spin_shop_purchases purchases
      on purchases.campaign_id = items.campaign_id
      and purchases.user_id = ${userId}::uuid
      and purchases.spot_type = items.spot_type
    left join spin_wins wins on wins.shop_purchase_id = purchases.id
    where items.campaign_id = ${campaignId}::uuid
    order by case items.spot_type when 'GTD' then 1 else 2 end
  `;
  return rows.map((row) => ({
    spotType: row.spot_type,
    pointsPrice: Number(row.points_price),
    totalCount: Number(row.total_count),
    purchasedCount: Number(row.purchased_count),
    remaining: Math.max(0, Number(row.total_count) - Number(row.purchased_count)),
    purchasedByUser: Boolean(row.purchased_by_user),
    winId: row.win_id,
  }));
}

export async function updateShopInventory(input: {
  GTD: { pointsPrice: number; totalCount: number };
  FCFS: { pointsPrice: number; totalCount: number };
}) {
  await ensureProductionSchema();
  const settings = (Object.keys(DEFAULT_SHOP_ITEMS) as ShopSpotType[]).map((spotType) => ({
    spotType,
    pointsPrice: integerInRange(Number(input[spotType]?.pointsPrice), 1, 1_000_000_000, `${spotType} price`),
    totalCount: integerInRange(Number(input[spotType]?.totalCount), 0, 100_000, `${spotType} pool`),
  }));

  return inTransaction(async (sql) => {
    await sql`select pg_advisory_xact_lock(hashtext('bunny-hood-active-campaign'))`;
    const campaign = await getActiveCampaign(sql);
    if (!campaign) throw new HttpError(409, "Start a campaign before opening its points shop.", "NO_CAMPAIGN");

    for (const setting of settings) {
      const current = await sql<{ purchased_count: number }[]>`
        select purchased_count from spin_shop_items
        where campaign_id = ${campaign.id}::uuid and spot_type = ${setting.spotType}
        for update
      `;
      const purchased = Number(current[0]?.purchased_count ?? 0);
      if (setting.totalCount < purchased) {
        throw new HttpError(409, `${setting.spotType} pool cannot be lower than ${purchased} completed purchases.`, "SHOP_POOL_BELOW_PURCHASES");
      }
      await sql`
        insert into spin_shop_items (campaign_id, spot_type, points_price, total_count)
        values (${campaign.id}::uuid, ${setting.spotType}, ${setting.pointsPrice}, ${setting.totalCount})
        on conflict (campaign_id, spot_type) do update set
          points_price = excluded.points_price,
          total_count = excluded.total_count,
          updated_at = now()
      `;
    }
    return { campaignId: campaign.id, items: await getShopState(sql, campaign.id, "00000000-0000-0000-0000-000000000000") };
  });
}

export async function purchaseShopSpot(user: SpinUser, rawSpotType: string, idempotencyKey: string) {
  if (!validShopSpotType(rawSpotType)) {
    throw new HttpError(400, "Choose a GTD or FCFS shop spot.", "BAD_SHOP_SPOT");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    throw new HttpError(400, "Refresh the page and try the purchase again.", "BAD_IDEMPOTENCY_KEY");
  }
  await ensureProductionSchema();
  const database = getDb();
  await enforceRateLimit(`shop-purchase:${user.id}`, 10, 60, database);

  return inTransaction(async (sql) => {
    await sql`select pg_advisory_xact_lock_shared(hashtext('bunny-hood-active-campaign'))`;
    const campaign = await getActiveCampaign(sql);
    if (!campaign) throw new HttpError(409, "The shop is between campaigns right now.", "NO_CAMPAIGN");

    const users = await sql<{ points: number | string; points_spent: number | string; total_wins: number }[]>`
      select points, points_spent, total_wins from spin_users
      where id = ${user.id}::uuid for update
    `;
    const current = users[0];
    if (!current) throw new HttpError(401, "Connect X to continue.", "AUTH_REQUIRED");

    const repeated = await sql<{
      id: string;
      spot_type: ShopSpotType;
      points_spent: number | string;
      win_id: string;
      points_available: number | string;
    }[]>`
      select purchases.id, purchases.spot_type, purchases.points_spent,
        wins.id as win_id, (users.points - users.points_spent)::bigint as points_available
      from spin_shop_purchases purchases
      join spin_users users on users.id = purchases.user_id
      join spin_wins wins on wins.shop_purchase_id = purchases.id
      where purchases.user_id = ${user.id}::uuid
        and purchases.idempotency_key = ${idempotencyKey}::uuid
      limit 1
    `;
    if (repeated[0]) return {
      purchased: true,
      spotType: repeated[0].spot_type,
      pointsSpent: Number(repeated[0].points_spent),
      pointsAvailable: Number(repeated[0].points_available),
      winId: repeated[0].win_id,
      repeated: true,
    };

    const existing = await sql<{ id: string }[]>`
      select id from spin_shop_purchases
      where campaign_id = ${campaign.id}::uuid
        and user_id = ${user.id}::uuid and spot_type = ${rawSpotType}
      limit 1
    `;
    if (existing[0]) throw new HttpError(409, `You already secured this campaign's ${rawSpotType} spot.`, "SHOP_ALREADY_PURCHASED");

    const items = await sql<{ points_price: number | string; total_count: number; purchased_count: number }[]>`
      select points_price, total_count, purchased_count from spin_shop_items
      where campaign_id = ${campaign.id}::uuid and spot_type = ${rawSpotType}
      for update
    `;
    const item = items[0];
    if (!item || Number(item.purchased_count) >= Number(item.total_count)) {
      throw new HttpError(409, `${rawSpotType} is sold out for this campaign.`, "SHOP_SOLD_OUT");
    }

    const prizeType = rawSpotType === "GTD" ? "GTD" : "FCFS1";
    const roleRows = await sql<{ count: number }[]>`
      select count(*)::int as count from spin_wins
      where user_id = ${user.id}::uuid and prize_type = ${prizeType}
    `;
    if (Number(current.total_wins) >= 9 || Number(roleRows[0]?.count ?? 0) >= 3) {
      throw new HttpError(409, "Your permanent role limit is already full.", "ROLE_LIMIT_REACHED");
    }

    const price = Number(item.points_price);
    const available = Number(current.points) - Number(current.points_spent);
    if (available < price) {
      throw new HttpError(409, `You need ${price - available} more points for this spot.`, "NOT_ENOUGH_POINTS");
    }

    const purchaseId = randomUUID();
    const winId = randomUUID();
    await sql`
      insert into spin_shop_purchases (
        id, campaign_id, user_id, spot_type, points_spent, idempotency_key
      ) values (
        ${purchaseId}, ${campaign.id}::uuid, ${user.id}::uuid, ${rawSpotType}, ${price}, ${idempotencyKey}::uuid
      )
    `;
    const updatedItems = await sql<{ remaining: number }[]>`
      update spin_shop_items set purchased_count = purchased_count + 1, updated_at = now()
      where campaign_id = ${campaign.id}::uuid and spot_type = ${rawSpotType}
        and purchased_count < total_count
      returning (total_count - purchased_count)::int as remaining
    `;
    if (!updatedItems[0]) throw new HttpError(409, `${rawSpotType} just sold out. Your points were not spent.`, "SHOP_SOLD_OUT");
    const updatedUsers = await sql<{ points_available: number | string }[]>`
      update spin_users set points_spent = points_spent + ${price}, updated_at = now()
      where id = ${user.id}::uuid and points - points_spent >= ${price}
      returning (points - points_spent)::bigint as points_available
    `;
    if (!updatedUsers[0]) throw new HttpError(409, "Your point balance changed. Refresh and try again.", "POINT_BALANCE_CHANGED");
    await sql`
      insert into spin_wins (id, user_id, prize_slot_id, prize_type, source, shop_purchase_id, won_at)
      values (${winId}, ${user.id}::uuid, null, ${prizeType}, 'shop', ${purchaseId}::uuid, now())
    `;
    return {
      purchased: true,
      spotType: rawSpotType,
      pointsSpent: price,
      pointsAvailable: Number(updatedUsers[0].points_available),
      remaining: Number(updatedItems[0].remaining),
      winId,
      repeated: false,
    };
  });
}

type XEmbedReply = { author_url?: string; html?: string };

function parsePostUrl(rawValue: string) {
  const match = rawValue.trim().match(/^https:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})(?:[/?#].*)?$/i);
  if (!match) throw new HttpError(400, "Enter the complete public X post URL.", "BAD_X_POST_URL");
  return { postId: match[2], postUrl: `https://x.com/${match[1]}/status/${match[2]}` };
}

function usernameFromAuthorUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname.toLowerCase())) return null;
    return url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/)?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export async function submitShopPostTask(user: SpinUser, rawPostUrl: string) {
  await ensureProductionSchema();
  const database = getDb();
  await enforceRateLimit(`shop-post:${user.id}`, 8, 15 * 60, database);
  const parsed = parsePostUrl(rawPostUrl);
  const endpoint = new URL("https://publish.x.com/oembed");
  endpoint.searchParams.set("url", parsed.postUrl);
  endpoint.searchParams.set("omit_script", "1");
  endpoint.searchParams.set("dnt", "true");
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new HttpError(502, "X could not verify that post. Try again in a moment.", "X_VERIFY_UNAVAILABLE");
  }
  if (response.status === 404) throw new HttpError(400, "That X post is not public or does not exist.", "X_POST_NOT_PUBLIC");
  const data = await response.json().catch(() => ({})) as XEmbedReply;
  if (!response.ok) throw new HttpError(502, "X could not verify that post. Try again in a moment.", "X_VERIFY_UNAVAILABLE");
  const xUsername = usernameFromAuthorUrl(data.author_url);
  if (!xUsername || xUsername !== user.xUsername.toLowerCase()) {
    throw new HttpError(400, `Submit a public post created by your connected @${user.xUsername} account.`, "X_AUTHOR_MISMATCH");
  }
  return inTransaction(async (sql) => {
    await sql`select pg_advisory_xact_lock_shared(hashtext('bunny-hood-active-campaign'))`;
    const liveSettings = await getSpinSettings(sql);
    if (liveSettings.postTaskRequiresTag && !(data.html ?? "").toLowerCase().includes("@bunnyshood")) {
      throw new HttpError(400, "Your post must tag @BunnysHood.", "X_TAG_MISSING");
    }
    const campaign = await getActiveCampaign(sql);
    if (!campaign) throw new HttpError(409, "No campaign task is active right now.", "NO_CAMPAIGN");
    await sql`select id from spin_users where id = ${user.id}::uuid for update`;
    const existing = await sql<{ post_url: string; points_awarded: number }[]>`
      select post_url, points_awarded from spin_post_tasks
      where user_id = ${user.id}::uuid and round_id = ${campaign.round_id}::uuid
      limit 1
    `;
    if (existing[0]) return {
      completed: true,
      alreadyCompleted: true,
      pointsAwarded: Number(existing[0].points_awarded),
      postUrl: existing[0].post_url,
    };
    const inserted = await sql<{ id: string }[]>`
      insert into spin_post_tasks (
        id, campaign_id, round_id, user_id, post_id, post_url, x_username, points_awarded
      ) values (
        ${randomUUID()}, ${campaign.id}::uuid, ${campaign.round_id}::uuid, ${user.id}::uuid,
        ${parsed.postId}, ${parsed.postUrl}, ${xUsername}, 3
      )
      on conflict (post_id) do nothing
      returning id
    `;
    if (!inserted[0]) throw new HttpError(409, "That X post has already been used for a Bunny Hood reward.", "X_POST_ALREADY_USED");
    const updated = await sql<{ points_available: number | string }[]>`
      update spin_users set points = points + 3, updated_at = now()
      where id = ${user.id}::uuid
      returning (points - points_spent)::bigint as points_available
    `;
    return {
      completed: true,
      alreadyCompleted: false,
      pointsAwarded: 3,
      pointsAvailable: Number(updated[0].points_available),
      postUrl: parsed.postUrl,
    };
  });
}
