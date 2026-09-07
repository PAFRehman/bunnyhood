import { requireSessionUser } from "@/lib/spin/auth";
import { assertSameOrigin, HttpError, json, readJson, routeError } from "@/lib/spin/http";
import { enforceRateLimit } from "@/lib/spin/rate-limit";
import { assertPublicStorageWritable } from "@/lib/spin/storage-safety";
import {
  completeLastDanceEngagement,
  requireLastDanceAccess,
  startLastDanceEngagement,
} from "@/lib/last-dance/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await requireLastDanceAccess(request);
    await assertPublicStorageWritable();
    const user = await requireSessionUser(request, true);
    await enforceRateLimit(`last-dance-engagement:${user.id}`, 12, 15 * 60);
    const body = await readJson<{ action?: string }>(request, 1_024);
    if (body.action === "start") return json(await startLastDanceEngagement(user.id));
    if (body.action === "complete") return json(await completeLastDanceEngagement(user.id));
    throw new HttpError(400, "Choose a valid engagement action.", "BAD_ENGAGEMENT_ACTION");
  } catch (error) {
    return routeError(error);
  }
}
