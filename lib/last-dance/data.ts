import "server-only";

import { randomUUID } from "node:crypto";
import type { SpinUser } from "@/lib/spin/auth";
import { ADMIN_COOKIE } from "@/lib/spin/config";
import { getDb, inTransaction, type SpinDb } from "@/lib/spin/db";
import { getCookie, HttpError } from "@/lib/spin/http";
import { verifyAdminTicket } from "@/lib/spin/security";
import { inspectRobinhoodWallet } from "./chain";
import { LAST_DANCE_POST_TEXT_MAX_LENGTH } from "./defaults";
import { ensureLastDanceSchema } from "./schema";

export const LAST_DANCE_TASK_WAIT_MS = 5_000;
const X_POST = /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})(?:[/?#].*)?$/i;
const X_PROFILE_OR_POST = /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}(?:\/status\/\d{5,25})?(?:[/?#].*)?$/i;
const EVM_WALLET = /^0x[0-9a-fA-F]{40}$/;

type SettingsRow = {
  public_enabled: boolean;
  max_entries: number;
  engagement_post_url: string;
  post_text: string;
  mint_opens_at: Date | string | null;
  updated_at: Date | string;
};

type ProgressRow = {
  engagement_complete: boolean;
  post_complete: boolean;
  post_url: string | null;
};

export type LastDanceSettings = {
  publicEnabled: boolean;
  maxEntries: number;
  engagementPostUrl: string;
  postText: string;
  mintOpensAt: string | null;
  updatedAt: string;
};

export type LastDanceMissingRequirement =
  | "ENGAGEMENT"
  | "X_POST"
  | "ROBINHOOD_NFT"
  | "ROBINHOOD_TRANSACTION";

export class LastDanceRequirementsError extends Error {
  constructor(public readonly missing: LastDanceMissingRequirement[]) {
    super("Complete every Last Dance requirement before entering.");
  }
}

function mapSettings(row: SettingsRow): LastDanceSettings {
  return {
    publicEnabled: Boolean(row.public_enabled),
    maxEntries: Number(row.max_entries),
    engagementPostUrl: row.engagement_post_url,
    postText: row.post_text,
    mintOpensAt: row.mint_opens_at ? new Date(row.mint_opens_at).toISOString() : null,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function getLastDanceSettings(sql: SpinDb = getDb()) {
  await ensureLastDanceSchema();
  const rows = await sql<SettingsRow[]>`
    select public_enabled, max_entries, engagement_post_url, post_text, mint_opens_at, updated_at
    from last_dance_settings where id = 1
  `;
  if (!rows[0]) throw new Error("Last Dance settings are missing.");
  return mapSettings(rows[0]);
}

export async function getLastDanceAccess(request: Request) {
  const settings = await getLastDanceSettings();
  const isAdmin = verifyAdminTicket(getCookie(request, ADMIN_COOKIE));
  return { settings, isAdmin, allowed: settings.publicEnabled || isAdmin };
}

export async function requireLastDanceAccess(request: Request) {
  const access = await getLastDanceAccess(request);
  if (!access.allowed) {
    throw new HttpError(403, "The Last Dance is private right now.", "LAST_DANCE_PRIVATE");
  }
  return access;
}

async function settleEngagement(userId: string, sql: SpinDb = getDb()) {
  await sql`
    update last_dance_engagements
    set completed_at = now()
    where user_id = ${userId}::uuid
      and completed_at is null
      and started_at <= now() - interval '5 seconds'
  `;
}

async function getProgress(userId: string, sql: SpinDb = getDb()) {
  await settleEngagement(userId, sql);
  const rows = await sql<ProgressRow[]>`
    select
      exists(
        select 1 from last_dance_engagements
        where user_id = ${userId}::uuid and completed_at is not null
      ) as engagement_complete,
      exists(
        select 1 from last_dance_posts where user_id = ${userId}::uuid
      ) as post_complete,
      (select post_url from last_dance_posts where user_id = ${userId}::uuid) as post_url
  `;
  return rows[0] ?? { engagement_complete: false, post_complete: false, post_url: null };
}

export async function getLastDanceState(user: SpinUser | null) {
  await ensureLastDanceSchema();
  const sql = getDb();
  const settings = await getLastDanceSettings(sql);
  const countRows = await sql<{ count: number }[]>`select count(*)::integer as count from last_dance_entries`;
  const entriesCount = Number(countRows[0]?.count ?? 0);
  const publicSettings = {
    publicEnabled: settings.publicEnabled,
    engagementPostUrl: settings.engagementPostUrl,
    postText: settings.postText,
    mintOpensAt: settings.mintOpensAt,
  };
  const capacity = {
    claimed: entriesCount,
    total: settings.maxEntries,
    remaining: Math.max(0, settings.maxEntries - entriesCount),
  };
  if (!user) {
    return {
      authenticated: false as const,
      settings: publicSettings,
      capacity,
      closed: entriesCount >= settings.maxEntries,
    };
  }

  const [progress, entryRows] = await Promise.all([
    getProgress(user.id, sql),
    sql<{
      id: string;
      wallet_address: string;
      nft_count: number;
      transaction_count: number;
      entered_at: Date | string;
    }[]>`
      select id, wallet_address, nft_count, transaction_count, entered_at
      from last_dance_entries where user_id = ${user.id}::uuid limit 1
    `,
  ]);
  const entry = entryRows[0];
  return {
    authenticated: true as const,
    settings: publicSettings,
    capacity,
    closed: entriesCount >= settings.maxEntries,
    user: {
      xUsername: user.xUsername,
      xName: user.xName,
      xProfileImageUrl: user.xProfileImageUrl,
    },
    tasks: {
      engagementComplete: Boolean(progress.engagement_complete),
      postComplete: Boolean(progress.post_complete),
      postUrl: progress.post_url,
    },
    entry: entry ? {
      id: entry.id,
      walletAddress: entry.wallet_address,
      nftCount: Number(entry.nft_count),
      transactionCount: Number(entry.transaction_count),
      enteredAt: new Date(entry.entered_at).toISOString(),
    } : null,
  };
}

export async function startLastDanceEngagement(userId: string) {
  await ensureLastDanceSchema();
  const sql = getDb();
  await sql`
    insert into last_dance_engagements (user_id, started_at)
    values (${userId}::uuid, now())
    on conflict (user_id) do nothing
  `;
  await settleEngagement(userId, sql);
  const rows = await sql<{ completed_at: Date | null; wait_ms: number }[]>`
    select completed_at,
      greatest(0, ${LAST_DANCE_TASK_WAIT_MS} - extract(epoch from (now() - started_at)) * 1000)::integer as wait_ms
    from last_dance_engagements where user_id = ${userId}::uuid
  `;
  return {
    completed: Boolean(rows[0]?.completed_at),
    waitMs: Math.max(0, Number(rows[0]?.wait_ms ?? LAST_DANCE_TASK_WAIT_MS)),
  };
}

export async function completeLastDanceEngagement(userId: string) {
  await ensureLastDanceSchema();
  const sql = getDb();
  await settleEngagement(userId, sql);
  const rows = await sql<{ started_at: Date | string; completed_at: Date | null }[]>`
    select started_at, completed_at from last_dance_engagements
    where user_id = ${userId}::uuid
  `;
  if (!rows[0]) throw new HttpError(409, "Open the engagement post first.", "ENGAGEMENT_NOT_STARTED");
  if (!rows[0].completed_at) {
    throw new HttpError(409, "Give the X post a moment, then try again.", "ENGAGEMENT_TIMER_ACTIVE");
  }
  return { completed: true };
}

type XEmbedReply = { author_url?: string; html?: string };

function parsePostUrl(rawValue: string) {
  const match = rawValue.trim().match(X_POST);
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

export async function submitLastDancePost(user: SpinUser, rawPostUrl: string) {
  await ensureLastDanceSchema();
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
    throw new HttpError(502, "X could not verify that post. Try again shortly.", "X_VERIFY_UNAVAILABLE");
  }
  if (response.status === 404) {
    throw new HttpError(400, "That X post is not public or does not exist.", "X_POST_NOT_PUBLIC");
  }
  const data = await response.json().catch(() => ({})) as XEmbedReply;
  if (!response.ok) throw new HttpError(502, "X could not verify that post. Try again shortly.", "X_VERIFY_UNAVAILABLE");
  const xUsername = usernameFromAuthorUrl(data.author_url);
  if (!xUsername || xUsername !== user.xUsername.toLowerCase()) {
    throw new HttpError(
      400,
      `Submit a public post created by your connected @${user.xUsername} account.`,
      "X_AUTHOR_MISMATCH",
    );
  }
  if (!(data.html ?? "").toLowerCase().includes("@bunnyshood")) {
    throw new HttpError(400, "Your post must tag @BunnysHood.", "X_TAG_MISSING");
  }

  return inTransaction(async (sql) => {
    const existing = await sql<{ post_url: string }[]>`
      select post_url from last_dance_posts where user_id = ${user.id}::uuid limit 1
    `;
    if (existing[0]) return { completed: true, postUrl: existing[0].post_url, repeated: true };
    const inserted = await sql<{ post_url: string }[]>`
      insert into last_dance_posts (user_id, post_id, post_url, x_username)
      values (${user.id}::uuid, ${parsed.postId}, ${parsed.postUrl}, ${xUsername})
      on conflict (post_id) do nothing
      returning post_url
    `;
    if (!inserted[0]) {
      throw new HttpError(409, "That X post has already been used for The Last Dance.", "X_POST_ALREADY_USED");
    }
    return { completed: true, postUrl: inserted[0].post_url, repeated: false };
  });
}

function normalizedWallet(rawWallet: string) {
  const wallet = rawWallet.trim();
  if (!EVM_WALLET.test(wallet)) {
    throw new HttpError(400, "Enter a valid EVM wallet address.", "BAD_WALLET");
  }
  return wallet.toLowerCase();
}

export async function enterLastDance(user: SpinUser, rawWallet: string, isAdmin: boolean) {
  await ensureLastDanceSchema();
  const wallet = normalizedWallet(rawWallet);
  const sql = getDb();
  const progress = await getProgress(user.id, sql);
  const missing: LastDanceMissingRequirement[] = [];
  if (!progress.engagement_complete) missing.push("ENGAGEMENT");
  if (!progress.post_complete) missing.push("X_POST");
  if (missing.length) throw new LastDanceRequirementsError(missing);

  const proof = await inspectRobinhoodWallet(wallet);
  if (proof.nftCount < 1) missing.push("ROBINHOOD_NFT");
  if (proof.transactionCount < 1) missing.push("ROBINHOOD_TRANSACTION");
  if (missing.length) throw new LastDanceRequirementsError(missing);

  return inTransaction(async (transaction) => {
    const settingsRows = await transaction<SettingsRow[]>`
      select public_enabled, max_entries, engagement_post_url, post_text, mint_opens_at, updated_at
      from last_dance_settings where id = 1 for update
    `;
    const settings = settingsRows[0];
    if (!settings) throw new Error("Last Dance settings are missing.");
    if (!settings.public_enabled && !isAdmin) {
      throw new HttpError(403, "The Last Dance is private right now.", "LAST_DANCE_PRIVATE");
    }
    const existing = await transaction<{
      id: string;
      wallet_address: string;
      entered_at: Date | string;
    }[]>`
      select id, wallet_address, entered_at from last_dance_entries
      where user_id = ${user.id}::uuid limit 1
    `;
    if (existing[0]) {
      return {
        id: existing[0].id,
        walletAddress: existing[0].wallet_address,
        enteredAt: new Date(existing[0].entered_at).toISOString(),
        repeated: true,
      };
    }
    const countRows = await transaction<{ count: number }[]>`
      select count(*)::integer as count from last_dance_entries
    `;
    if (Number(countRows[0]?.count ?? 0) >= Number(settings.max_entries)) {
      throw new HttpError(409, "GTD is GTD. Form is now closed.", "LAST_DANCE_CLOSED");
    }
    const liveProgress = await getProgress(user.id, transaction);
    if (!liveProgress.engagement_complete || !liveProgress.post_complete) {
      throw new LastDanceRequirementsError([
        ...(!liveProgress.engagement_complete ? ["ENGAGEMENT" as const] : []),
        ...(!liveProgress.post_complete ? ["X_POST" as const] : []),
      ]);
    }
    const usedWallet = await transaction<{ exists: boolean }[]>`
      select exists(
        select 1 from last_dance_entries where lower(wallet_address) = ${wallet}
      ) as exists
    `;
    if (usedWallet[0]?.exists) {
      throw new HttpError(409, "That wallet already has a Last Dance entry.", "WALLET_ALREADY_ENTERED");
    }
    const rows = await transaction<{ id: string; wallet_address: string; entered_at: Date | string }[]>`
      insert into last_dance_entries (
        id, user_id, x_user_id, x_username, wallet_address, nft_count, transaction_count
      ) values (
        ${randomUUID()}, ${user.id}::uuid, ${user.xUserId}, ${user.xUsername.toLowerCase()},
        ${wallet}, ${proof.nftCount}, ${proof.transactionCount}
      )
      returning id, wallet_address, entered_at
    `;
    return {
      id: rows[0].id,
      walletAddress: rows[0].wallet_address,
      enteredAt: new Date(rows[0].entered_at).toISOString(),
      repeated: false,
    };
  });
}

export async function getLastDanceAdminData() {
  await ensureLastDanceSchema();
  const sql = getDb();
  const [settings, countRows, entries] = await Promise.all([
    getLastDanceSettings(sql),
    sql<{ count: number }[]>`select count(*)::integer as count from last_dance_entries`,
    sql<{
      id: string;
      x_username: string;
      wallet_address: string;
      nft_count: number;
      transaction_count: number;
      entered_at: Date | string;
    }[]>`
      select id, x_username, wallet_address, nft_count, transaction_count, entered_at
      from last_dance_entries order by entered_at desc limit 500
    `,
  ]);
  const entriesCount = Number(countRows[0]?.count ?? 0);
  return {
    settings,
    entriesCount,
    remaining: Math.max(0, settings.maxEntries - entriesCount),
    entries: entries.map((entry) => ({
      id: entry.id,
      xUsername: entry.x_username,
      walletAddress: entry.wallet_address,
      nftCount: Number(entry.nft_count),
      transactionCount: Number(entry.transaction_count),
      enteredAt: new Date(entry.entered_at).toISOString(),
    })),
  };
}

export async function updateLastDanceSettings(input: {
  publicEnabled: boolean;
  maxEntries: number;
  engagementPostUrl: string;
  postText: string;
  mintOpensAt: string | null;
}) {
  await ensureLastDanceSchema();
  if (!Number.isInteger(input.maxEntries) || input.maxEntries < 1 || input.maxEntries > 100_000) {
    throw new HttpError(400, "Max entries must be between 1 and 100,000.", "BAD_MAX_ENTRIES");
  }
  const engagementPostUrl = input.engagementPostUrl.trim();
  if (!X_PROFILE_OR_POST.test(engagementPostUrl)) {
    throw new HttpError(400, "Enter a valid public X profile or post URL.", "BAD_ENGAGEMENT_URL");
  }
  if (input.publicEnabled && !X_POST.test(engagementPostUrl)) {
    throw new HttpError(400, "Add the complete official X post URL before opening public access.", "ENGAGEMENT_POST_REQUIRED");
  }
  const postText = input.postText.trim();
  if (!postText || postText.length > LAST_DANCE_POST_TEXT_MAX_LENGTH) {
    throw new HttpError(
      400,
      `Post text must contain 1–${LAST_DANCE_POST_TEXT_MAX_LENGTH} characters.`,
      "BAD_POST_TEXT",
    );
  }
  const mintTimestamp = input.mintOpensAt ? Date.parse(input.mintOpensAt) : Number.NaN;
  if (input.mintOpensAt && !Number.isFinite(mintTimestamp)) {
    throw new HttpError(400, "Enter a valid mint opening time.", "BAD_MINT_TIME");
  }
  const mintOpensAt = input.mintOpensAt ? new Date(mintTimestamp).toISOString() : null;
  const sql = getDb();
  const rows = await sql<SettingsRow[]>`
    update last_dance_settings set
      public_enabled = ${input.publicEnabled},
      max_entries = ${input.maxEntries},
      engagement_post_url = ${engagementPostUrl},
      post_text = ${postText},
      mint_opens_at = ${mintOpensAt}::timestamptz,
      updated_at = now()
    where id = 1
    returning public_enabled, max_entries, engagement_post_url, post_text, mint_opens_at, updated_at
  `;
  return mapSettings(rows[0]);
}

export async function getLastDancePublicPass(rawEntryId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawEntryId)) {
    return null;
  }
  await ensureLastDanceSchema();
  const sql = getDb();
  const rows = await sql<{
    id: string;
    x_username: string;
    wallet_address: string;
    entered_at: Date | string;
    mint_opens_at: Date | string | null;
  }[]>`
    select entries.id, entries.x_username, entries.wallet_address, entries.entered_at,
      settings.mint_opens_at
    from last_dance_entries entries
    cross join last_dance_settings settings
    where entries.id = ${rawEntryId}::uuid and settings.id = 1
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    xUsername: row.x_username,
    maskedWallet: `${row.wallet_address.slice(0, 8)}…${row.wallet_address.slice(-6)}`,
    enteredAt: new Date(row.entered_at).toISOString(),
    mintOpensAt: row.mint_opens_at ? new Date(row.mint_opens_at).toISOString() : null,
  };
}
