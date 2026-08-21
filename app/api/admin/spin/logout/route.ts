import { ADMIN_COOKIE } from "@/lib/spin/config";
import { assertSameOrigin, json, routeError, secureCookie } from "@/lib/spin/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return json({ ok: true }, 200, {
      "set-cookie": secureCookie(ADMIN_COOKIE, "", {
        maxAge: 0,
        httpOnly: true,
        sameSite: "Strict",
      }),
    });
  } catch (error) {
    return routeError(error);
  }
}

