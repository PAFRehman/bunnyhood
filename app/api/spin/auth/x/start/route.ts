import { createHash } from "node:crypto";
import { ADMIN_COOKIE, getAppUrl, getXConfig, OAUTH_COOKIE } from "@/lib/spin/config";
import { getCookie, HttpError, routeError, secureCookie } from "@/lib/spin/http";
import { randomToken, seal, verifyAdminTicket } from "@/lib/spin/security";
import { assertPublicStorageWritable } from "@/lib/spin/storage-safety";
import { normalizeReferralCode, validReferralCode } from "@/lib/spin/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeReturnTo(value: string | null) {
  return value === "/RabbitHole" ? "/RabbitHole" : "/SpinTheWheel";
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const requestedReferralCode = normalizeReferralCode(requestUrl.searchParams.get("ref") ?? "");
    const returnTo = safeReturnTo(requestUrl.searchParams.get("next"));
    const adminTicket = returnTo === "/RabbitHole" ? getCookie(request, ADMIN_COOKIE) : null;
    if (returnTo === "/RabbitHole" && !verifyAdminTicket(adminTicket ?? undefined)) {
      throw new HttpError(401, "Admin sign-in required.", "ADMIN_AUTH_REQUIRED");
    }
    await assertPublicStorageWritable();
    const state = randomToken(24);
    const verifier = randomToken(48);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const payload = seal({
      state,
      verifier,
      referralCode: validReferralCode(requestedReferralCode) ? requestedReferralCode : null,
      returnTo,
      adminTicket,
      exp: Date.now() + 10 * 60_000,
    });
    const { clientId, redirectUri } = getXConfig();
    const url = new URL("https://x.com/i/oauth2/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", "tweet.read users.read");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");

    const headers = new Headers({
      location: url.toString(),
      "cache-control": "no-store",
    });
    headers.append("set-cookie", secureCookie(OAUTH_COOKIE, payload, {
      maxAge: 10 * 60,
      httpOnly: true,
      sameSite: "Lax",
    }));
    headers.set("content-security-policy", "default-src 'none'");
    headers.set("referrer-policy", "no-referrer");
    return new Response(null, { status: 302, headers });
  } catch (error) {
    return routeError(error);
  }
}

export function POST() {
  return Response.redirect(`${getAppUrl()}/SpinTheWheel`, 303);
}
