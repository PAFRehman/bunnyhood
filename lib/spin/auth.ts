import { randomUUID } from "node:crypto";
import {
  CSRF_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  SPIN_COOKIE,
} from "./config";
import { getDb } from "./db";
import { getCookie, HttpError, secureCookie } from "./http";
import { ensureProductionSchema } from "./schema";
import { randomToken, safeEqual, sha256 } from "./security";

export type SpinUser = {
  id: string;
  xUserId: string;
  xUsername: string;
  xName: string;
  xProfileImageUrl: string | null;
  spinsEarned: number;
  spinsAvailable: number;
  spinsUsed: number;
  points: number;
  pointsEarned: number;
  pointsSpent: number;
  totalWins: number;
};

type SessionRow = {
  session_id: string;
  csrf_hash: string;
  user_id: string;
  x_user_id: string;
  x_username: string;
  x_name: string;
  x_profile_image_url: string | null;
  spins_earned: number;
  spins_available: number;
  spins_used: number;
  points: number;
  points_spent: number;
  total_wins: number;
};

function mapUser(row: SessionRow): SpinUser {
  return {
    id: row.user_id,
    xUserId: row.x_user_id,
    xUsername: row.x_username,
    xName: row.x_name,
    xProfileImageUrl: row.x_profile_image_url,
    spinsEarned: Number(row.spins_earned),
    spinsAvailable: Number(row.spins_available),
    spinsUsed: Number(row.spins_used),
    points: Number(row.points) - Number(row.points_spent),
    pointsEarned: Number(row.points),
    pointsSpent: Number(row.points_spent),
    totalWins: Number(row.total_wins),
  };
}

export async function getSessionUser(request: Request, requireCsrf = false, touchLastSeen = true) {
  await ensureProductionSchema();
  const token = getCookie(request, SPIN_COOKIE);
  if (!token) return null;
  const sql = getDb();
  const rows = await sql<SessionRow[]>`
    select
      s.id as session_id,
      s.csrf_hash,
      u.id as user_id,
      u.x_user_id,
      u.x_username,
      u.x_name,
      u.x_profile_image_url,
      u.spins_earned,
      u.spins_available,
      u.spins_used,
      u.points,
      u.points_spent,
      u.total_wins
    from spin_sessions s
    join spin_users u on u.id = s.user_id
    where s.token_hash = ${sha256(token)}
      and s.expires_at > now()
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;

  if (touchLastSeen) {
    await sql`
      update spin_users
      set last_seen_at = now()
      where id = ${row.user_id}::uuid
        and last_seen_at < now() - interval '5 minutes'
    `;
  }

  if (requireCsrf) {
    const header = request.headers.get("x-csrf-token") ?? "";
    const cookie = getCookie(request, CSRF_COOKIE) ?? "";
    if (!header || !cookie || !safeEqual(header, cookie) || !safeEqual(sha256(header), row.csrf_hash)) {
      throw new HttpError(403, "Your secure session token is missing. Refresh and try again.", "BAD_CSRF");
    }
  }

  return mapUser(row);
}

export async function requireSessionUser(request: Request, requireCsrf = false) {
  const user = await getSessionUser(request, requireCsrf);
  if (!user) throw new HttpError(401, "Connect X to continue.", "AUTH_REQUIRED");
  return user;
}

export async function createSession(userId: string) {
  const sql = getDb();
  const sessionToken = randomToken(40);
  const csrfToken = randomToken(28);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  await sql`
    insert into spin_sessions (id, user_id, token_hash, csrf_hash, expires_at)
    values (
      ${randomUUID()},
      ${userId}::uuid,
      ${sha256(sessionToken)},
      ${sha256(csrfToken)},
      ${expiresAt.toISOString()}::timestamptz
    )
  `;
  return {
    headers: [
      secureCookie(SPIN_COOKIE, sessionToken, {
        maxAge: SESSION_MAX_AGE_SECONDS,
        httpOnly: true,
        sameSite: "Lax",
      }),
      secureCookie(CSRF_COOKIE, csrfToken, {
        maxAge: SESSION_MAX_AGE_SECONDS,
        httpOnly: false,
        sameSite: "Lax",
      }),
    ],
  };
}

export async function revokeCurrentSession(request: Request) {
  const token = getCookie(request, SPIN_COOKIE);
  if (token) {
    const sql = getDb();
    await sql`delete from spin_sessions where token_hash = ${sha256(token)}`;
  }
}

export function clearedSessionCookies() {
  return [
    secureCookie(SPIN_COOKIE, "", { maxAge: 0, httpOnly: true, sameSite: "Lax" }),
    secureCookie(CSRF_COOKIE, "", { maxAge: 0, httpOnly: false, sameSite: "Lax" }),
  ];
}
