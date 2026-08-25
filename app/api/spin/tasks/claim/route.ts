import { requireSessionUser } from "@/lib/spin/auth";
import { claimCampaignTask, type TaskType } from "@/lib/spin/campaigns";
import { assertSameOrigin, HttpError, json, readJson, routeError } from "@/lib/spin/http";
import { assertPublicStorageWritable } from "@/lib/spin/storage-safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await assertPublicStorageWritable();
    const user = await requireSessionUser(request, true);
    const body = await readJson<{ task?: string }>(request);
    if (!body.task || !["follow", "like", "repost", "comment", "notifications"].includes(body.task)) {
      throw new HttpError(400, "Choose a valid campaign task.", "BAD_TASK");
    }
    const result = await claimCampaignTask(user, body.task as TaskType);
    return json(result);
  } catch (error) {
    return routeError(error);
  }
}
