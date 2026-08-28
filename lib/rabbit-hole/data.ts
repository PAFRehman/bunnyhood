import "server-only";

import { randomUUID } from "node:crypto";
import type { SpinUser } from "@/lib/spin/auth";
import { getDb, inTransaction, type SpinDb } from "@/lib/spin/db";
import { HttpError } from "@/lib/spin/http";
import {
  isValidXUsername,
  MAX_RABBIT_HOLE_ELIGIBLE,
  normalizeXUsername,
} from "./config";
import { ipfsGatewayUrl } from "./pinata";
import { ensureRabbitHoleSchema } from "./schema";

export type RabbitHoleClaimStatus = "eligible" | "minting" | "claimed" | "failed";

export type EligibilityRow = {
  id: string;
  x_username: string;
  x_username_normalized: string;
  x_user_id: string | null;
  x_name: string | null;
  x_profile_image_url: string | null;
  pfp_content_type: string | null;
  pfp_base64: string | null;
  status: RabbitHoleClaimStatus;
  wallet_address: string | null;
  active_attempt_id: string | null;
  transaction_hash: string | null;
  token_id: string | null;
  claim_key: string | null;
  contract_address: string | null;
  chain_id: string | number | null;
  metadata_url: string | null;
  image_cid: string | null;
  metadata_cid: string | null;
  image_url: string | null;
  pinned_at: Date | string | null;
  failure_reason: string | null;
  connected_at: Date | string | null;
  claim_started_at: Date | string | null;
  claimed_at: Date | string | null;
  imported_at: Date | string;
  updated_at: Date | string;
};

export type EligibilityImport = { username: string; xUserId: string | null };

export const ELIGIBILITY_COLUMNS = `
  id, x_username, x_username_normalized, x_user_id, x_name,
  x_profile_image_url, pfp_content_type, pfp_base64, status,
  wallet_address, active_attempt_id, transaction_hash,
  token_id::text as token_id, claim_key, contract_address, chain_id,
  metadata_url, image_cid, metadata_cid, image_url, pinned_at,
  failure_reason, connected_at, claim_started_at,
  claimed_at, imported_at, updated_at
`;

function iso(value: Date | string | null) {
  return value ? new Date(value).toISOString() : null;
}

export function publicEligibility(row: EligibilityRow | null) {
  if (!row) return { eligible: false as const, status: "not_eligible" as const };
  return {
    eligible: true as const,
    id: row.id,
    username: row.x_username,
    xIdentityBound: Boolean(row.x_user_id),
    status: row.status,
    claimed: row.status === "claimed",
    wallet: row.wallet_address,
    transactionHash: row.transaction_hash,
    tokenId: row.token_id,
    contractAddress: row.contract_address,
    chainId: row.chain_id === null ? null : Number(row.chain_id),
    metadataUrl: row.metadata_url,
    imageUrl: row.image_url,
    imageCid: row.image_cid,
    metadataCid: row.metadata_cid,
    imageGatewayUrl: ipfsGatewayUrl(row.image_cid),
    metadataGatewayUrl: ipfsGatewayUrl(row.metadata_cid),
    pinnedAt: iso(row.pinned_at),
    claimedAt: iso(row.claimed_at),
    updatedAt: iso(row.updated_at),
  };
}

async function selectByUsername(sql: SpinDb, username: string, forUpdate = false) {
  const normalized = normalizeXUsername(username);
  if (!isValidXUsername(normalized)) return null;
  const lock = forUpdate ? " for update" : "";
  const rows = await sql.unsafe<EligibilityRow[]>(
    `select ${ELIGIBILITY_COLUMNS}
     from rabbit_hole_eligibility
     where x_username_normalized = $1
     limit 1${lock}`,
    [normalized],
  );
  return rows[0] ?? null;
}

export async function findEligibilityByUsername(username: string) {
  await ensureRabbitHoleSchema();
  return selectByUsername(getDb(), username);
}

export async function getEligibilityById(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return null;
  }
  await ensureRabbitHoleSchema();
  const rows = await getDb().unsafe<EligibilityRow[]>(
    `select ${ELIGIBILITY_COLUMNS}
     from rabbit_hole_eligibility where id = $1::uuid limit 1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function bindAuthenticatedEligibility(user: SpinUser) {
  await ensureRabbitHoleSchema();
  const normalized = normalizeXUsername(user.xUsername);
  return inTransaction(async (sql) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`rabbit-hole-x:${user.xUserId}`}))`;
    const bound = await sql.unsafe<EligibilityRow[]>(
      `select ${ELIGIBILITY_COLUMNS}
       from rabbit_hole_eligibility where x_user_id = $1 limit 1 for update`,
      [user.xUserId],
    );
    let row: EligibilityRow | null = bound[0] ?? null;
    if (!row) row = await selectByUsername(sql, normalized, true);
    if (!row || (row.x_user_id && row.x_user_id !== user.xUserId)) return null;

    const updated = await sql.unsafe<EligibilityRow[]>(
      `update rabbit_hole_eligibility
       set x_user_id = $1,
           x_name = $2,
           x_profile_image_url = $3,
           connected_at = coalesce(connected_at, now()),
           updated_at = now()
       where id = $4::uuid
       returning ${ELIGIBILITY_COLUMNS}`,
      [user.xUserId, user.xName, user.xProfileImageUrl, row.id],
    );
    return updated[0] ?? null;
  });
}

export async function getEligibilityStats() {
  await ensureRabbitHoleSchema();
  const rows = await getDb()<{
    total: number;
    eligible: number;
    minting: number;
    claimed: number;
    failed: number;
  }[]>`
    select count(*)::integer as total,
      count(*) filter (where status = 'eligible')::integer as eligible,
      count(*) filter (where status = 'minting')::integer as minting,
      count(*) filter (where status = 'claimed')::integer as claimed,
      count(*) filter (where status = 'failed')::integer as failed
    from rabbit_hole_eligibility
  `;
  return rows[0] ?? { total: 0, eligible: 0, minting: 0, claimed: 0, failed: 0 };
}

export async function listEligibility(search = "") {
  await ensureRabbitHoleSchema();
  const pattern = `%${search.trim().replace(/^@/, "").slice(0, 40)}%`;
  const rows = await getDb().unsafe<EligibilityRow[]>(
    `select ${ELIGIBILITY_COLUMNS}
     from rabbit_hole_eligibility
     where $1 = '%%'
        or x_username ilike $1
        or coalesce(x_user_id, '') ilike $1
        or coalesce(wallet_address, '') ilike $1
        or coalesce(transaction_hash, '') ilike $1
     order by
       case status when 'minting' then 0 when 'failed' then 1 when 'claimed' then 2 else 3 end,
       imported_at asc
     limit 100`,
    [pattern],
  );
  return rows.map((row) => ({
    id: row.id,
    username: row.x_username,
    xUserId: row.x_user_id,
    xName: row.x_name,
    status: row.status,
    wallet: row.wallet_address,
    transactionHash: row.transaction_hash,
    tokenId: row.token_id,
    contractAddress: row.contract_address,
    chainId: row.chain_id === null ? null : Number(row.chain_id),
    imageCid: row.image_cid,
    metadataCid: row.metadata_cid,
    metadataGatewayUrl: ipfsGatewayUrl(row.metadata_cid),
    claimedAt: iso(row.claimed_at),
    updatedAt: iso(row.updated_at),
  }));
}

function usernameFromInput(value: string) {
  const cleaned = value.trim().replace(/^['"]|['"]$/g, "");
  try {
    const url = new URL(cleaned);
    if (url.hostname === "x.com" || url.hostname === "twitter.com" || url.hostname.endsWith(".x.com")) {
      return url.pathname.split("/").filter(Boolean)[0] ?? "";
    }
  } catch {
    // Normal handles are not URLs.
  }
  return cleaned;
}

export function parseEligibilityImport(value: string): EligibilityImport[] {
  const entries: EligibilityImport[] = [];
  const usernames = new Set<string>();
  const xUserIds = new Set<string>();
  const lines = value.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/[\t,]/).map((part) => part.trim());
    if (index === 0 && /^(?:x_?)?username$/i.test(parts[0]?.replace(/^@/, "") ?? "")) continue;
    const username = normalizeXUsername(usernameFromInput(parts[0] ?? ""));
    const xUserId = (parts[1] ?? "").replace(/^['"]|['"]$/g, "") || null;
    if (!isValidXUsername(username)) {
      throw new HttpError(400, `Line ${index + 1} has an invalid X username.`, "BAD_ELIGIBILITY_USERNAME");
    }
    if (xUserId && !/^\d{1,30}$/.test(xUserId)) {
      throw new HttpError(400, `Line ${index + 1} has an invalid numeric X user ID.`, "BAD_X_USER_ID");
    }
    if (usernames.has(username)) {
      throw new HttpError(400, `@${username} appears more than once.`, "DUPLICATE_USERNAME");
    }
    if (xUserId && xUserIds.has(xUserId)) {
      throw new HttpError(400, `X user ID ${xUserId} appears more than once.`, "DUPLICATE_X_USER_ID");
    }
    usernames.add(username);
    if (xUserId) xUserIds.add(xUserId);
    entries.push({ username, xUserId });
  }
  if (!entries.length) throw new HttpError(400, "Paste at least one X username.", "EMPTY_ELIGIBILITY_LIST");
  if (entries.length > MAX_RABBIT_HOLE_ELIGIBLE) {
    throw new HttpError(400, `The Rabbit Hole is limited to ${MAX_RABBIT_HOLE_ELIGIBLE} users.`, "ELIGIBILITY_LIMIT");
  }
  return entries;
}

export async function replaceEligibility(entries: EligibilityImport[]) {
  await ensureRabbitHoleSchema();
  return inTransaction(async (sql) => {
    await sql`select pg_advisory_xact_lock(hashtext('rabbit-hole-eligibility-import'))`;
    const existing = await sql.unsafe<EligibilityRow[]>(
      `select ${ELIGIBILITY_COLUMNS} from rabbit_hole_eligibility for update`,
    );
    const byUsername = new Map(existing.map((row) => [row.x_username_normalized, row]));
    const desired = new Set(entries.map((entry) => entry.username));
    const protectedRows = existing.filter((row) =>
      (row.status === "claimed" || row.status === "minting") && !desired.has(row.x_username_normalized)
    );
    if (entries.length + protectedRows.length > MAX_RABBIT_HOLE_ELIGIBLE) {
      throw new HttpError(
        409,
        "The replacement plus protected claimed/minting records would exceed 100 users.",
        "ELIGIBILITY_LIMIT",
      );
    }

    for (const entry of entries) {
      const current = byUsername.get(entry.username);
      if (current?.x_user_id && entry.xUserId && current.x_user_id !== entry.xUserId) {
        throw new HttpError(409, `@${entry.username} is already bound to a different X identity.`, "X_ID_CONFLICT");
      }
      if (current) {
        await sql`
          update rabbit_hole_eligibility
          set x_username = ${entry.username},
              x_user_id = coalesce(x_user_id, ${entry.xUserId}),
              imported_at = now(),
              updated_at = now()
          where id = ${current.id}::uuid
        `;
      } else {
        await sql`
          insert into rabbit_hole_eligibility (
            id, x_username, x_username_normalized, x_user_id
          ) values (
            ${randomUUID()}, ${entry.username}, ${entry.username}, ${entry.xUserId}
          )
        `;
      }
    }

    for (const row of existing) {
      if (desired.has(row.x_username_normalized)) continue;
      if (row.status === "claimed" || row.status === "minting") continue;
      await sql`delete from rabbit_hole_eligibility where id = ${row.id}::uuid`;
    }
    return getEligibilityStatsWithSql(sql);
  });
}

async function getEligibilityStatsWithSql(sql: SpinDb) {
  const rows = await sql<{
    total: number;
    eligible: number;
    minting: number;
    claimed: number;
    failed: number;
  }[]>`
    select count(*)::integer as total,
      count(*) filter (where status = 'eligible')::integer as eligible,
      count(*) filter (where status = 'minting')::integer as minting,
      count(*) filter (where status = 'claimed')::integer as claimed,
      count(*) filter (where status = 'failed')::integer as failed
    from rabbit_hole_eligibility
  `;
  return rows[0] ?? { total: 0, eligible: 0, minting: 0, claimed: 0, failed: 0 };
}
