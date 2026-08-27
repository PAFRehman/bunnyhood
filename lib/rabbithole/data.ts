import { randomUUID } from "node:crypto";
import type { Hex } from "viem";
import type { SpinUser } from "@/lib/spin/auth";
import { recordAdminAction } from "@/lib/spin/audit";
import { getDb, inTransaction, type SpinDb } from "@/lib/spin/db";
import { HttpError } from "@/lib/spin/http";
import { ensureRabbitHoleSchema } from "./schema";

export type RabbitHoleClaimStatus = "PENDING" | "SUBMITTED" | "CONFIRMED" | "FAILED";

export type RabbitHoleAllowlistRow = {
  id: string;
  x_user_id: string | null;
  x_username: string;
  x_username_normalized: string;
  x_name: string | null;
  x_profile_image_url: string | null;
  eligible: boolean;
  status: RabbitHoleClaimStatus | null;
  wallet_address: string | null;
  claim_key: Hex | null;
  chain_id: number | null;
  contract_address: string | null;
  transaction_hash: Hex | null;
  token_id: string | null;
  submitted_at: Date | string | null;
  confirmed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type RabbitHoleClaimRow = {
  id: string;
  allowlist_id: string;
  user_id: string;
  x_user_id: string;
  x_username: string;
  x_name: string;
  x_profile_image_url: string | null;
  wallet_address: string;
  claim_key: Hex;
  status: RabbitHoleClaimStatus;
  chain_id: number;
  contract_address: string;
  metadata_uri: string;
  transaction_hash: Hex | null;
  token_id: string | null;
  mint_attempts: number;
  last_error_code: string | null;
  submitted_at: Date | string | null;
  confirmed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type SpinProfileRow = {
  x_user_id: string;
  x_username: string;
  x_name: string;
  x_profile_image_url: string | null;
};

export function normalizeXUsername(value: string) {
  const normalized = value.trim().replace(/^@+/, "").toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(normalized)) {
    throw new HttpError(400, "Enter a valid X username.", "BAD_X_USERNAME");
  }
  return normalized;
}

function serializeAllowlist(row: RabbitHoleAllowlistRow) {
  return {
    id: row.id,
    xUserId: row.x_user_id,
    xUsername: row.x_username,
    xName: row.x_name,
    xProfileImageUrl: row.x_profile_image_url,
    eligible: row.eligible,
    claim: row.status ? {
      status: row.status,
      wallet: row.wallet_address,
      claimKey: row.claim_key,
      chainId: row.chain_id,
      contractAddress: row.contract_address,
      transactionHash: row.transaction_hash,
      tokenId: row.token_id,
      submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
      confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null,
    } : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function serializeClaim(row: RabbitHoleClaimRow | null | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    wallet: row.wallet_address,
    claimKey: row.claim_key,
    chainId: Number(row.chain_id),
    contractAddress: row.contract_address,
    metadataUri: row.metadata_uri,
    transactionHash: row.transaction_hash,
    tokenId: row.token_id,
    mintAttempts: Number(row.mint_attempts),
    submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const allowlistSelect = `
  select
    allowlist.id,
    allowlist.x_user_id,
    allowlist.x_username,
    allowlist.x_username_normalized,
    allowlist.x_name,
    allowlist.x_profile_image_url,
    allowlist.eligible,
    claims.status,
    claims.wallet_address,
    claims.claim_key,
    claims.chain_id,
    claims.contract_address,
    claims.transaction_hash,
    claims.token_id::text,
    claims.submitted_at,
    claims.confirmed_at,
    allowlist.created_at,
    allowlist.updated_at
  from rabbit_hole_allowlist allowlist
  left join rabbit_hole_claims claims on claims.allowlist_id = allowlist.id
`;

export async function getRabbitHoleAllowlist(search = "") {
  await ensureRabbitHoleSchema();
  const sql = getDb();
  const query = search.trim().replace(/^@/, "").toLowerCase().slice(0, 30);
  const rows = query
    ? await sql.unsafe<RabbitHoleAllowlistRow[]>(`${allowlistSelect}
        where allowlist.x_username_normalized like $1
          or lower(coalesce(allowlist.x_name, '')) like $1
          or coalesce(allowlist.x_user_id, '') = $2
        order by allowlist.eligible desc, allowlist.updated_at desc
        limit 100`, [`%${query}%`, query])
    : await sql.unsafe<RabbitHoleAllowlistRow[]>(`${allowlistSelect}
        order by allowlist.eligible desc, allowlist.updated_at desc
        limit 100`);
  return rows.map(serializeAllowlist);
}

export async function getRabbitHoleTotals() {
  await ensureRabbitHoleSchema();
  const sql = getDb();
  const rows = await sql<{
    eligible: number;
    claimed: number;
    pending: number;
  }[]>`
    select
      count(*) filter (where allowlist.eligible)::integer as eligible,
      count(claims.id) filter (where claims.status = 'CONFIRMED')::integer as claimed,
      count(claims.id) filter (where claims.status in ('PENDING', 'SUBMITTED'))::integer as pending
    from rabbit_hole_allowlist allowlist
    left join rabbit_hole_claims claims on claims.allowlist_id = allowlist.id
  `;
  return {
    eligible: Number(rows[0]?.eligible ?? 0),
    claimed: Number(rows[0]?.claimed ?? 0),
    pending: Number(rows[0]?.pending ?? 0),
    capacity: 100,
  };
}

async function linkedSpinProfile(sql: SpinDb, username: string) {
  const rows = await sql<SpinProfileRow[]>`
    select x_user_id, x_username, x_name, x_profile_image_url
    from spin_users
    where lower(x_username) = ${username}
    order by last_seen_at desc
    limit 1
  `;
  return rows[0] ?? null;
}

export async function importRabbitHoleAllowlist(
  rawUsernames: string[],
  mode: "merge" | "replace",
) {
  const usernames = [...new Set(rawUsernames.map(normalizeXUsername))];
  if (!usernames.length) {
    throw new HttpError(400, "Add at least one X username.", "EMPTY_ALLOWLIST");
  }
  if (usernames.length > 100) {
    throw new HttpError(400, "Rabbit Hole accepts a maximum of 100 eligible users.", "ALLOWLIST_TOO_LARGE");
  }
  await ensureRabbitHoleSchema();

  const result = await inTransaction(async (sql) => {
    await sql`select pg_advisory_xact_lock(hashtext('rabbit-hole-allowlist-admin'))`;
    if (mode === "replace") {
      await sql`
        update rabbit_hole_allowlist
        set eligible = false, updated_at = now()
        where eligible = true
      `;
    } else {
      const current = await sql<{ x_username_normalized: string }[]>`
        select x_username_normalized from rabbit_hole_allowlist where eligible = true
      `;
      const combined = new Set(current.map((row) => row.x_username_normalized));
      for (const username of usernames) combined.add(username);
      if (combined.size > 100) {
        throw new HttpError(409, "This import would exceed the 100-user Rabbit Hole limit.", "ALLOWLIST_FULL");
      }
    }

    for (const username of usernames) {
      const profile = await linkedSpinProfile(sql, username);
      if (profile) {
        const linked = await sql<{ id: string }[]>`
          select id from rabbit_hole_allowlist
          where x_user_id = ${profile.x_user_id}
          limit 1
          for update
        `;
        if (linked[0]) {
          await sql`
            update rabbit_hole_allowlist
            set x_username = ${profile.x_username},
                x_username_normalized = ${profile.x_username.toLowerCase()},
                x_name = ${profile.x_name},
                x_profile_image_url = ${profile.x_profile_image_url},
                eligible = true,
                updated_at = now()
            where id = ${linked[0].id}::uuid
          `;
          continue;
        }
      }

      await sql`
        insert into rabbit_hole_allowlist (
          id, x_user_id, x_username, x_username_normalized,
          x_name, x_profile_image_url, eligible
        ) values (
          ${randomUUID()}, ${profile?.x_user_id ?? null}, ${profile?.x_username ?? username},
          ${profile?.x_username.toLowerCase() ?? username}, ${profile?.x_name ?? null},
          ${profile?.x_profile_image_url ?? null}, true
        )
        on conflict (x_username_normalized) do update set
          x_user_id = coalesce(rabbit_hole_allowlist.x_user_id, excluded.x_user_id),
          x_username = excluded.x_username,
          x_name = coalesce(excluded.x_name, rabbit_hole_allowlist.x_name),
          x_profile_image_url = coalesce(excluded.x_profile_image_url, rabbit_hole_allowlist.x_profile_image_url),
          eligible = true,
          updated_at = now()
      `;
    }

    const count = await sql<{ count: number }[]>`
      select count(*)::integer as count from rabbit_hole_allowlist where eligible = true
    `;
    return Number(count[0]?.count ?? 0);
  });

  await recordAdminAction("rabbit_hole_allowlist_import", {
    mode,
    submitted: usernames.length,
    eligibleAfter: result,
  });
  return { eligible: result, capacity: 100 };
}

export async function findRabbitHoleEligibility(rawUsername: string) {
  const username = normalizeXUsername(rawUsername);
  await ensureRabbitHoleSchema();
  const sql = getDb();
  const rows = await sql.unsafe<RabbitHoleAllowlistRow[]>(`${allowlistSelect}
    where allowlist.x_username_normalized = $1
    limit 1`, [username]);
  const row = rows[0];
  return row ? serializeAllowlist(row) : null;
}

export async function bindRabbitHoleUser(user: SpinUser) {
  await ensureRabbitHoleSchema();
  return inTransaction(async (sql) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`rabbit-hole-user:${user.xUserId}`}))`;
    let rows = await sql.unsafe<RabbitHoleAllowlistRow[]>(`${allowlistSelect}
      where allowlist.x_user_id = $1
      limit 1
      for update of allowlist`, [user.xUserId]);
    if (!rows[0]) {
      rows = await sql.unsafe<RabbitHoleAllowlistRow[]>(`${allowlistSelect}
        where allowlist.x_username_normalized = $1
        limit 1
        for update of allowlist`, [user.xUsername.toLowerCase()]);
      const candidate = rows[0];
      if (candidate?.x_user_id && candidate.x_user_id !== user.xUserId) return null;
    }
    const match = rows[0];
    if (!match || !match.eligible) return match ? serializeAllowlist(match) : null;

    await sql`
      update rabbit_hole_allowlist
      set x_user_id = ${user.xUserId},
          x_username = ${user.xUsername},
          x_username_normalized = ${user.xUsername.toLowerCase()},
          x_name = ${user.xName},
          x_profile_image_url = ${user.xProfileImageUrl},
          updated_at = now()
      where id = ${match.id}::uuid
    `;
    const refreshed = await sql.unsafe<RabbitHoleAllowlistRow[]>(`${allowlistSelect}
      where allowlist.id = $1::uuid limit 1`, [match.id]);
    return refreshed[0] ? serializeAllowlist(refreshed[0]) : null;
  });
}

export async function getRabbitHoleClaimByKey(claimKey: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(claimKey)) return null;
  await ensureRabbitHoleSchema();
  const sql = getDb();
  const rows = await sql<RabbitHoleClaimRow[]>`
    select id, allowlist_id, user_id, x_user_id, x_username, x_name,
      x_profile_image_url, wallet_address, claim_key, status, chain_id,
      contract_address, metadata_uri, transaction_hash, token_id::text,
      mint_attempts, last_error_code, submitted_at, confirmed_at,
      created_at, updated_at
    from rabbit_hole_claims
    where claim_key = ${claimKey}
      and status in ('PENDING', 'SUBMITTED', 'CONFIRMED')
    limit 1
  `;
  return rows[0] ?? null;
}

export async function getRabbitHoleClaimByUser(userId: string) {
  await ensureRabbitHoleSchema();
  const sql = getDb();
  const rows = await sql<RabbitHoleClaimRow[]>`
    select id, allowlist_id, user_id, x_user_id, x_username, x_name,
      x_profile_image_url, wallet_address, claim_key, status, chain_id,
      contract_address, metadata_uri, transaction_hash, token_id::text,
      mint_attempts, last_error_code, submitted_at, confirmed_at,
      created_at, updated_at
    from rabbit_hole_claims
    where user_id = ${userId}::uuid
    limit 1
  `;
  return rows[0] ?? null;
}

export function publicRabbitHoleClaim(row: RabbitHoleClaimRow | null | undefined) {
  return serializeClaim(row);
}
