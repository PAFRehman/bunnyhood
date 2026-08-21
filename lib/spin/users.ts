import { randomUUID } from "node:crypto";
import type { SpinDb } from "./db";
import { inTransaction } from "./db";
import { HttpError } from "./http";
import { queueSheetSync } from "./sheets";

export type SpinUserRow = {
  id: string;
  x_user_id: string;
  x_username: string;
  x_name: string;
  spins_available: number;
  spins_used: number;
  points: number;
  total_wins: number;
  referral_code: string | null;
  referral_count: number;
  referral_spins_earned: number;
};

const RESERVED_REFERRAL_CODES = new Set([
  "admin",
  "api",
  "bunnyhood",
  "help",
  "login",
  "official",
  "spin",
  "support",
]);

export function normalizeReferralCode(value: string) {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export function validReferralCode(value: string) {
  return /^[a-z0-9_]{3,24}$/.test(value) && !RESERVED_REFERRAL_CODES.has(value);
}

function defaultReferralCandidates(user: Pick<SpinUserRow, "x_user_id" | "x_username">) {
  const username = normalizeReferralCode(user.x_username).replace(/[^a-z0-9_]/g, "").slice(0, 24);
  const suffix = user.x_user_id.slice(-6);
  const primary = validReferralCode(username) ? username : `hood_${suffix}`;
  return [
    primary,
    `${primary.slice(0, Math.max(3, 23 - suffix.length))}_${suffix}`,
    `hood_${suffix}`,
  ].filter((candidate, index, candidates) => validReferralCode(candidate) && candidates.indexOf(candidate) === index);
}

export function spinUserSheetPayload(user: SpinUserRow) {
  return {
    userId: user.id,
    xUserId: user.x_user_id,
    xUsername: user.x_username,
    xName: user.x_name,
    spinsAvailable: Number(user.spins_available),
    spinsUsed: Number(user.spins_used),
    points: Number(user.points),
    totalWins: Number(user.total_wins),
    referralCode: user.referral_code ?? "",
    referralCount: Number(user.referral_count),
    referralSpinsEarned: Number(user.referral_spins_earned),
    updatedAt: new Date().toISOString(),
  };
}

export async function ensureReferralCode(sql: SpinDb, user: SpinUserRow) {
  if (user.referral_code) {
    const linked = await sql<{ code: string }[]>`
      insert into spin_referral_codes (code, user_id)
      values (${user.referral_code}, ${user.id}::uuid)
      on conflict (code) do update set code = excluded.code
      where spin_referral_codes.user_id = excluded.user_id
      returning code
    `;
    if (!linked[0]) throw new HttpError(409, "Your invite code conflicts with an existing link.", "REFERRAL_CODE_CONFLICT");
    return linked[0].code;
  }
  for (const candidate of defaultReferralCandidates(user)) {
    const reserved = await sql<{ code: string }[]>`
      insert into spin_referral_codes (code, user_id)
      values (${candidate}, ${user.id}::uuid)
      on conflict (code) do update set code = excluded.code
      where spin_referral_codes.user_id = excluded.user_id
      returning code
    `;
    if (!reserved[0]) continue;
    const rows = await sql<{ referral_code: string }[]>`
      update spin_users
      set referral_code = ${candidate}, updated_at = now()
      where id = ${user.id}::uuid
        and referral_code is null
      returning referral_code
    `;
    if (rows[0]) return rows[0].referral_code;
    const current = await sql<{ referral_code: string | null }[]>`
      select referral_code from spin_users where id = ${user.id}::uuid limit 1
    `;
    if (current[0]?.referral_code) return current[0].referral_code;
  }
  throw new HttpError(409, "A unique invite code could not be created. Choose a custom code.", "REFERRAL_CODE_CONFLICT");
}

export async function customizeReferralCode(userId: string, rawCode: string) {
  const code = normalizeReferralCode(rawCode);
  if (!validReferralCode(code)) {
    throw new HttpError(400, "Use 3–24 letters, numbers, or underscores for your invite code.", "BAD_REFERRAL_CODE");
  }

  return inTransaction(async (sql) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`referral-code:${code}`}))`;
    const users = await sql<SpinUserRow[]>`
      select id, x_user_id, x_username, x_name, spins_available, spins_used, points, total_wins,
        referral_code, referral_count, referral_spins_earned
      from spin_users where id = ${userId}::uuid limit 1 for update
    `;
    const current = users[0];
    if (!current) throw new HttpError(401, "Connect X to continue.", "AUTH_REQUIRED");

    const reserved = await sql<{ user_id: string }[]>`
      insert into spin_referral_codes (code, user_id)
      values (${code}, ${userId}::uuid)
      on conflict (code) do update set code = excluded.code
      where spin_referral_codes.user_id = excluded.user_id
      returning user_id
    `;
    if (!reserved[0]) {
      throw new HttpError(409, "That invite code is already taken.", "REFERRAL_CODE_TAKEN");
    }
    const updated = await sql<SpinUserRow[]>`
      update spin_users set referral_code = ${code}, updated_at = now()
      where id = ${userId}::uuid
      returning id, x_user_id, x_username, x_name, spins_available, spins_used, points, total_wins,
        referral_code, referral_count, referral_spins_earned
    `;
    await queueSheetSync(sql, "spin_user", `user:${userId}`, spinUserSheetPayload(updated[0]));
    return {
      referralCode: updated[0].referral_code,
      referralCount: Number(updated[0].referral_count),
      referralSpinsEarned: Number(updated[0].referral_spins_earned),
    };
  });
}

export async function applyNewUserReferral(
  sql: SpinDb,
  referredUser: SpinUserRow,
  rawCode: string | null | undefined,
) {
  const code = normalizeReferralCode(rawCode ?? "");
  if (!validReferralCode(code)) return false;

  await sql`select pg_advisory_xact_lock(hashtext(${`referral-credit:${referredUser.id}`}))`;
  const referrers = await sql<SpinUserRow[]>`
    select users.id, users.x_user_id, users.x_username, users.x_name,
      users.spins_available, users.spins_used, users.points, users.total_wins,
      users.referral_code, users.referral_count, users.referral_spins_earned
    from spin_referral_codes codes
    join spin_users users on users.id = codes.user_id
    where codes.code = ${code}
    limit 1
    for update
  `;
  const referrer = referrers[0];
  if (!referrer || referrer.id === referredUser.id) return false;

  const referralId = randomUUID();
  const inserted = await sql<{ id: string; created_at: Date | string }[]>`
    insert into spin_referrals (
      id, referrer_user_id, referred_user_id, referral_code, awarded_spins
    ) values (
      ${referralId}, ${referrer.id}::uuid, ${referredUser.id}::uuid, ${code}, 3
    )
    on conflict (referred_user_id) do nothing
    returning id, created_at
  `;
  if (!inserted[0]) return false;

  const updated = await sql<SpinUserRow[]>`
    update spin_users
    set spins_available = spins_available + 3,
        referral_count = referral_count + 1,
        referral_spins_earned = referral_spins_earned + 3,
        updated_at = now()
    where id = ${referrer.id}::uuid
    returning id, x_user_id, x_username, x_name, spins_available, spins_used, points, total_wins,
      referral_code, referral_count, referral_spins_earned
  `;
  await queueSheetSync(sql, "spin_user", `user:${referrer.id}`, spinUserSheetPayload(updated[0]));
  await queueSheetSync(sql, "spin_referral", `referral:${referralId}`, {
    referralId,
    referrerUserId: referrer.id,
    referrerXUserId: referrer.x_user_id,
    referrerUsername: referrer.x_username,
    referredUserId: referredUser.id,
    referredXUserId: referredUser.x_user_id,
    referredUsername: referredUser.x_username,
    referralCode: code,
    awardedSpins: 3,
    createdAt: new Date(inserted[0].created_at).toISOString(),
  });
  return true;
}
