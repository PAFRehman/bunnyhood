import { createHash } from "node:crypto";
import { requireRabbitHoleAccess } from "@/lib/rabbit-hole/access";
import { getXConfig, OAUTH_COOKIE } from "@/lib/spin/config";
import { routeError, secureCookie } from "@/lib/spin/http";
import { randomToken, seal } from "@/lib/spin/security";
import { assertPublicStorageWritable } from "@/lib/spin/storage-safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireRabbitHoleAccess(request);
    await assertPublicStorageWritable();
    const state = randomToken(24);
    const verifier = randomToken(48);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const payload = seal({
      state,
      verifier,
      referralCode: null,
      returnTo: "/RabbitHole",
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
      "content-security-policy": "default-src 'none'",
      "referrer-policy": "no-referrer",
    });
    headers.append("set-cookie", secureCookie(OAUTH_COOKIE, payload, {
      maxAge: 10 * 60,
      httpOnly: true,
      sameSite: "Lax",
    }));
    return new Response(null, { status: 302, headers });
  } catch (error) {
    return routeError(error);
  }
}
