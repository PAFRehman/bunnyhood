import { json, routeError } from "@/lib/spin/http";
import { anonymousRequestKey, enforceRateLimit } from "@/lib/spin/rate-limit";
import { assertPublicStorageWritable } from "@/lib/spin/storage-safety";
import { getWaitlistXPostUrl, getWaitlistXProfileUrl } from "@/lib/waitlist/config";
import { getWaitlistState } from "@/lib/waitlist/data";
import { ensureWaitlistSchema } from "@/lib/waitlist/schema";
import { getOrCreateWaitlistSession } from "@/lib/waitlist/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await assertPublicStorageWritable();
    await ensureWaitlistSchema();
    await enforceRateLimit(anonymousRequestKey(request, "waitlist-state"), 120, 60);
    const url = new URL(request.url);
    const context = await getOrCreateWaitlistSession(request, url.searchParams.get("ref") ?? "");
    const state = await getWaitlistState(context.session.id);
    const postUrl = getWaitlistXPostUrl();
    const headers = new Headers();
    for (const cookie of context.setCookies) headers.append("set-cookie", cookie);
    return json({
      ...state,
      csrfToken: context.session.csrfToken,
      incomingReferralCode: context.session.incomingReferralCode,
      serverNow: new Date().toISOString(),
      actions: {
        profileUrl: getWaitlistXProfileUrl(),
        postUrl,
      },
    }, 200, headers);
  } catch (error) {
    return routeError(error);
  }
}
