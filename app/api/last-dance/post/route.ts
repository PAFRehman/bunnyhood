import { requireSessionUser } from "@/lib/spin/auth";
import { assertSameOrigin, json, readJson, routeError } from "@/lib/spin/http";
import { enforceRateLimit } from "@/lib/spin/rate-limit";
import { assertPublicStorageWritable } from "@/lib/spin/storage-safety";
import { requireLastDanceAccess, submitLastDancePost } from "@/lib/last-dance/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await requireLastDanceAccess(request);
    await assertPublicStorageWritable();
    const user = await requireSessionUser(request, true);
    await enforceRateLimit(`last-dance-post:${user.id}`, 8, 15 * 60);
    const body = await readJson<{ postUrl?: string }>(request, 2_048);
    return json(await submitLastDancePost(user, body.postUrl ?? ""));
  } catch (error) {
    return routeError(error);
  }
}
