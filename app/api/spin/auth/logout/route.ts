import { clearedSessionCookies, requireSessionUser, revokeCurrentSession } from "@/lib/spin/auth";
import { assertSameOrigin, json, routeError } from "@/lib/spin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await requireSessionUser(request, true);
    await revokeCurrentSession(request);
    const headers = new Headers();
    for (const cookie of clearedSessionCookies()) headers.append("set-cookie", cookie);
    return json({ ok: true }, 200, headers);
  } catch (error) {
    return routeError(error);
  }
}

