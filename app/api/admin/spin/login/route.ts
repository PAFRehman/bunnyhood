import { ADMIN_COOKIE, ADMIN_MAX_AGE_SECONDS } from "@/lib/spin/config";
import { assertSameOrigin, HttpError, json, readJson, routeError, secureCookie } from "@/lib/spin/http";
import { anonymousRequestKey, enforceRateLimit } from "@/lib/spin/rate-limit";
import { createAdminTicket, verifyAdminPassword } from "@/lib/spin/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit(anonymousRequestKey(request, "admin-login"), 6, 15 * 60);
    const body = await readJson<{ password?: string }>(request, 2_048);
    const password = body.password ?? "";
    if (password.length > 256 || !(await verifyAdminPassword(password))) {
      throw new HttpError(401, "Incorrect admin password.", "BAD_ADMIN_PASSWORD");
    }
    return json({ ok: true }, 200, {
      "set-cookie": secureCookie(ADMIN_COOKIE, createAdminTicket(), {
        maxAge: ADMIN_MAX_AGE_SECONDS,
        httpOnly: true,
        sameSite: "Strict",
      }),
    });
  } catch (error) {
    return routeError(error);
  }
}

