import "server-only";

import { getDb } from "@/lib/spin/db";
import { getCookie, HttpError, secureCookie } from "@/lib/spin/http";
import { randomToken, safeEqual, sha256 } from "@/lib/spin/security";
import {
  WAITLIST_CSRF_COOKIE,
  WAITLIST_SESSION_COOKIE,
  WAITLIST_SESSION_MAX_AGE_SECONDS,
} from "./config";
import { ensureWaitlistSchema } from "./schema";

type SessionRow = {
  id: string;
  csrf_hash: string;
  incoming_referral_code: string | null;
};

export type WaitlistSession = {
  id: string;
  csrfToken: string;
  incomingReferralCode: string | null;
};

export function normalizeWaitlistReferralCode(value: string) {
  return value.trim().toLowerCase();
}

export function isWaitlistReferralCode(value: string) {
  return /^bh[a-z0-9]{12,22}$/.test(value);
}

function cookieHeaders(sessionToken: string, csrfToken: string) {
  return [
    secureCookie(WAITLIST_SESSION_COOKIE, sessionToken, {
      maxAge: WAITLIST_SESSION_MAX_AGE_SECONDS,
      httpOnly: true,
      sameSite: "Strict",
    }),
    secureCookie(WAITLIST_CSRF_COOKIE, csrfToken, {
      maxAge: WAITLIST_SESSION_MAX_AGE_SECONDS,
      httpOnly: false,
      sameSite: "Strict",
    }),
  ];
}

export async function getOrCreateWaitlistSession(request: Request, requestedReferralCode = "") {
  await ensureWaitlistSchema();
  const sql = getDb();
  const existingToken = getCookie(request, WAITLIST_SESSION_COOKIE) ?? "";
  const requestedCode = normalizeWaitlistReferralCode(requestedReferralCode);
  let incomingCode: string | null = null;
  if (isWaitlistReferralCode(requestedCode)) {
    const matches = await sql<{ exists: boolean }[]>`
      select exists(
        select 1 from waitlist_entries where referral_code = ${requestedCode}
        union all
        select 1 from waitlist_sessions where reserved_referral_code = ${requestedCode}
      ) as exists
    `;
    if (matches[0]?.exists) incomingCode = requestedCode;
  }

  if (existingToken) {
    const rows = await sql<SessionRow[]>`
      select id, csrf_hash, incoming_referral_code
      from waitlist_sessions
      where token_hash = ${sha256(existingToken)}
        and expires_at > now()
      limit 1
    `;
    const row = rows[0];
    if (row) {
      let csrfToken = getCookie(request, WAITLIST_CSRF_COOKIE) ?? "";
      const setCookies: string[] = [];
      if (!csrfToken || !safeEqual(sha256(csrfToken), row.csrf_hash)) {
        csrfToken = randomToken(28);
        await sql`
          update waitlist_sessions
          set csrf_hash = ${sha256(csrfToken)}, last_seen_at = now()
          where id = ${row.id}::uuid
        `;
        setCookies.push(secureCookie(WAITLIST_CSRF_COOKIE, csrfToken, {
          maxAge: WAITLIST_SESSION_MAX_AGE_SECONDS,
          httpOnly: false,
          sameSite: "Strict",
        }));
      } else {
        await sql`
          update waitlist_sessions
          set last_seen_at = now()
          where id = ${row.id}::uuid
            and last_seen_at < now() - interval '5 minutes'
        `;
      }

      let savedIncomingCode = row.incoming_referral_code;
      if (!savedIncomingCode && incomingCode) {
        const updated = await sql<{ incoming_referral_code: string | null }[]>`
          update waitlist_sessions sessions
          set incoming_referral_code = ${incomingCode}
          where sessions.id = ${row.id}::uuid
            and sessions.incoming_referral_code is null
            and not exists (
              select 1 from waitlist_entries entries where entries.session_id = sessions.id
            )
          returning incoming_referral_code
        `;
        savedIncomingCode = updated[0]?.incoming_referral_code ?? savedIncomingCode;
      }

      return {
        session: { id: row.id, csrfToken, incomingReferralCode: savedIncomingCode } satisfies WaitlistSession,
        setCookies,
      };
    }
  }

  const sessionToken = randomToken(40);
  const csrfToken = randomToken(28);
  const expiresAt = new Date(Date.now() + WAITLIST_SESSION_MAX_AGE_SECONDS * 1_000);
  const rows = await sql<{ id: string }[]>`
    insert into waitlist_sessions (
      token_hash, csrf_hash, incoming_referral_code, expires_at
    ) values (
      ${sha256(sessionToken)}, ${sha256(csrfToken)}, ${incomingCode},
      ${expiresAt.toISOString()}::timestamptz
    )
    returning id
  `;
  return {
    session: {
      id: rows[0].id,
      csrfToken,
      incomingReferralCode: incomingCode,
    } satisfies WaitlistSession,
    setCookies: cookieHeaders(sessionToken, csrfToken),
  };
}

export async function requireWaitlistSession(request: Request, requireCsrf = false) {
  await ensureWaitlistSchema();
  const token = getCookie(request, WAITLIST_SESSION_COOKIE) ?? "";
  if (!token) throw new HttpError(401, "Open the waitlist page again to restore your session.", "WAITLIST_SESSION_REQUIRED");
  const sql = getDb();
  const rows = await sql<SessionRow[]>`
    select id, csrf_hash, incoming_referral_code
    from waitlist_sessions
    where token_hash = ${sha256(token)}
      and expires_at > now()
    limit 1
  `;
  const row = rows[0];
  if (!row) throw new HttpError(401, "Your waitlist session expired. Refresh and try again.", "WAITLIST_SESSION_EXPIRED");

  const csrfToken = getCookie(request, WAITLIST_CSRF_COOKIE) ?? "";
  if (requireCsrf) {
    const header = request.headers.get("x-csrf-token") ?? "";
    if (!csrfToken || !header || !safeEqual(header, csrfToken) || !safeEqual(sha256(header), row.csrf_hash)) {
      throw new HttpError(403, "Refresh the waitlist page and try again.", "BAD_WAITLIST_CSRF");
    }
  }
  return {
    id: row.id,
    csrfToken,
    incomingReferralCode: row.incoming_referral_code,
  } satisfies WaitlistSession;
}
