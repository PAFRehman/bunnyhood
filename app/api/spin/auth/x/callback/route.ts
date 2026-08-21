import { after } from "next/server";
import { createSession } from "@/lib/spin/auth";
import { getAppUrl, OAUTH_COOKIE } from "@/lib/spin/config";
import { getCookie, secureCookie } from "@/lib/spin/http";
import { safeEqual, unseal } from "@/lib/spin/security";
import { exchangeAuthorizationCode, fetchXMe, upsertXUser } from "@/lib/spin/x";
import { flushSheetOutbox } from "@/lib/spin/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type OAuthPayload = { state: string; verifier: string; referralCode?: string | null; exp: number };

function redirectWithError(code: string) {
  return Response.redirect(`${getAppUrl()}/SpinTheWheel?auth_error=${encodeURIComponent(code)}`, 303);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("error")) return redirectWithError("x_denied");
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const cookie = getCookie(request, OAUTH_COOKIE) ?? "";
    const payload = unseal<OAuthPayload>(cookie);
    if (!code || !state || !payload || payload.exp < Date.now() || !safeEqual(state, payload.state)) {
      return redirectWithError("invalid_state");
    }
    const token = await exchangeAuthorizationCode(code, payload.verifier);
    const profile = await fetchXMe(token.access_token);
    const account = await upsertXUser(profile, token, payload.referralCode);
    const session = await createSession(account.userId);
    after(() => flushSheetOutbox());
    const headers = new Headers({
      location: `${getAppUrl()}/SpinTheWheel?connected=1${account.referralApplied ? "&referral=accepted" : ""}`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });
    for (const cookieHeader of session.headers) headers.append("set-cookie", cookieHeader);
    headers.append("set-cookie", secureCookie(OAUTH_COOKIE, "", {
      maxAge: 0,
      httpOnly: true,
      sameSite: "Lax",
    }));
    return new Response(null, { status: 303, headers });
  } catch {
    return redirectWithError("x_connection_failed");
  }
}
