import { after } from "next/server";
import { requireSessionUser } from "@/lib/spin/auth";
import { claimCampaignTask, type TaskType } from "@/lib/spin/campaigns";
import { assertSameOrigin, HttpError, json, readJson, routeError } from "@/lib/spin/http";
import { flushSheetOutbox } from "@/lib/spin/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser(request, true);
    const body = await readJson<{ task?: string }>(request);
    if (!body.task || !["like", "repost", "comment"].includes(body.task)) {
      throw new HttpError(400, "Choose a valid campaign task.", "BAD_TASK");
    }
    const result = await claimCampaignTask(user, body.task as TaskType);
    after(() => flushSheetOutbox());
    return json(result);
  } catch (error) {
    return routeError(error);
  }
}
