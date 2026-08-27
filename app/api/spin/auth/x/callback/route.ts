import { createSession } from "@/lib/spin/auth";
import {
  ADMIN_COOKIE,
  ADMIN_MAX_AGE_SECONDS,
  getAppUrl,
  OAUTH_COOKIE,
} from "@/lib/spin/config";
import { getCookie, secureCookie } from "@/lib/spin/http";
import { safeEqual, unseal, verifyAdminTicket } from "@/lib/spin/security";
import { assertPublicStorageWritable } from "@/lib/spin/storage-safety";
import { exchangeAuthorizationCode, fetchXMe, upsertXUser } from "@/lib/spin/x";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type OAuthPayload = {
  state: string;
  verifier: string;
  referralCode?: string | null;
  returnTo?: "/SpinTheWheel" | "/RabbitHole";
  adminTicket?: string | null;
  exp: number;
};

function redirectWithError(code: string, returnTo = "/SpinTheWheel") {
  return Response.redirect(`${getAppUrl()}${returnTo}?auth_error=${encodeURIComponent(code)}`, 303);
}

export async function GET(request: Request) {
  let failureReturnTo = "/SpinTheWheel";
  try {
    await assertPublicStorageWritable();
    const url = new URL(request.url);
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const cookie = getCookie(request, OAUTH_COOKIE) ?? "";
    const payload = unseal<OAuthPayload>(cookie);
    const rabbitHoleReturn = payload?.returnTo === "/RabbitHole"
      && verifyAdminTicket(payload.adminTicket ?? undefined);
    const returnTo = rabbitHoleReturn ? "/RabbitHole" : "/SpinTheWheel";
    failureReturnTo = returnTo;
    if (url.searchParams.get("error")) return redirectWithError("x_denied", returnTo);
    if (!code || !state || !payload || payload.exp < Date.now() || !safeEqual(state, payload.state)) {
      return redirectWithError("invalid_state", returnTo);
    }
    const token = await exchangeAuthorizationCode(code, payload.verifier);
    const profile = await fetchXMe(token.access_token);
    const account = await upsertXUser(profile, token, payload.referralCode);
    const session = await createSession(account.userId);
    const headers = new Headers({
      location: `${getAppUrl()}${returnTo}?connected=1${account.referralApplied ? "&referral=accepted" : ""}`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });
    for (const cookieHeader of session.headers) headers.append("set-cookie", cookieHeader);
    headers.append("set-cookie", secureCookie(OAUTH_COOKIE, "", {
      maxAge: 0,
      httpOnly: true,
      sameSite: "Lax",
    }));
    if (returnTo === "/RabbitHole" && payload.adminTicket) {
      headers.append("set-cookie", secureCookie(ADMIN_COOKIE, payload.adminTicket, {
        maxAge: ADMIN_MAX_AGE_SECONDS,
        httpOnly: true,
        sameSite: "Strict",
      }));
    }
    return new Response(null, { status: 303, headers });
  } catch {
    return redirectWithError("x_connection_failed", failureReturnTo);
  }
}
