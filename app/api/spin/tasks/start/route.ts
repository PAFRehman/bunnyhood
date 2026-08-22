import { requireSessionUser } from "@/lib/spin/auth";
import { startCampaignTask, type TaskType } from "@/lib/spin/campaigns";
import { assertSameOrigin, HttpError, json, readJson, routeError } from "@/lib/spin/http";
import { assertPublicStorageWritable } from "@/lib/spin/storage-safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await assertPublicStorageWritable();
    const user = await requireSessionUser(request, true);
    const body = await readJson<{ task?: string }>(request);
    if (!body.task || !["like", "repost", "comment"].includes(body.task)) {
      throw new HttpError(400, "Choose a valid campaign task.", "BAD_TASK");
    }
    const task = body.task as TaskType;
    const started = await startCampaignTask(user, task);
    if (started.alreadyClaimed) {
      return json({ ...started, completed: true, spinsAwarded: 0 });
    }
    return json({ ...started, completed: false, spinsAwarded: 0 });
  } catch (error) {
    return routeError(error);
  }
}
