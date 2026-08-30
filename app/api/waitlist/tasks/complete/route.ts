import { assertSameOrigin, HttpError, json, readJson, routeError } from "@/lib/spin/http";
import { enforceRateLimit } from "@/lib/spin/rate-limit";
import { sha256 } from "@/lib/spin/security";
import { assertPublicStorageWritable } from "@/lib/spin/storage-safety";
import { completeWaitlistTask, type WaitlistTaskType } from "@/lib/waitlist/data";
import { requireWaitlistSession } from "@/lib/waitlist/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validTask(value: string): value is WaitlistTaskType {
  return value === "follow_notifications" || value === "engage_post";
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await assertPublicStorageWritable();
    const session = await requireWaitlistSession(request, true);
    await enforceRateLimit(sha256(`waitlist-task-complete:${session.id}`), 20, 60);
    const body = await readJson<{ task?: string }>(request);
    if (!body.task || !validTask(body.task)) {
      throw new HttpError(400, "Choose a valid waitlist task.", "BAD_WAITLIST_TASK");
    }
    return json(await completeWaitlistTask(session.id, body.task));
  } catch (error) {
    return routeError(error);
  }
}
