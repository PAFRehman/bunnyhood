import { json, routeError } from "@/lib/spin/http";
import { anonymousRequestKey, enforceRateLimit } from "@/lib/spin/rate-limit";
import { searchWaitlistRank } from "@/lib/waitlist/data";
import { ensureWaitlistSchema } from "@/lib/waitlist/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await ensureWaitlistSchema();
    await enforceRateLimit(anonymousRequestKey(request, "waitlist-rank"), 30, 60);
    const query = new URL(request.url).searchParams.get("query") ?? "";
    const entry = await searchWaitlistRank(query);
    return json({ entry });
  } catch (error) {
    return routeError(error);
  }
}
