import { anonymousRequestKey, enforceRateLimit } from "@/lib/spin/rate-limit";
import { sha256 } from "@/lib/spin/security";
import { assertSameOrigin, json, readJson, routeError } from "@/lib/spin/http";
import { assertPublicStorageWritable } from "@/lib/spin/storage-safety";
import { submitWaitlistJoinPost } from "@/lib/waitlist/data";
import { requireWaitlistSession } from "@/lib/waitlist/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await assertPublicStorageWritable();
    const session = await requireWaitlistSession(request, true);
    await enforceRateLimit(anonymousRequestKey(request, "waitlist-join-post"), 8, 60 * 60);
    await enforceRateLimit(sha256(`waitlist-join-post:${session.id}`), 4, 10 * 60);
    const body = await readJson<{ postUrl?: string }>(request, 2_048);
    const proof = await submitWaitlistJoinPost(session.id, body.postUrl ?? "");
    return json({ ok: true, proof });
  } catch (error) {
    return routeError(error);
  }
}
