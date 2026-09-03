import { requireSpinAdmin } from "@/lib/spin/admin";
import { recordAdminAction } from "@/lib/spin/audit";
import { assertSameOrigin, HttpError, json, readJson, routeError } from "@/lib/spin/http";
import { ensureProductionSchema } from "@/lib/spin/schema";
import { setEngagementSettings } from "@/lib/spin/settings";
import { assertPublicStorageWritable } from "@/lib/spin/storage-safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    requireSpinAdmin(request);
    await assertPublicStorageWritable();
    await ensureProductionSchema();
    const body = await readJson<{
      postTaskText?: unknown;
      postTaskRequiresTag?: unknown;
      bunnyStreakDays?: unknown;
    }>(request);
    if (typeof body.postTaskText !== "string" || typeof body.postTaskRequiresTag !== "boolean") {
      throw new HttpError(400, "Enter the post text and choose whether its Bunny Hood tag is required.", "BAD_ENGAGEMENT_SETTING");
    }
    const settings = await setEngagementSettings({
      postTaskText: body.postTaskText,
      postTaskRequiresTag: body.postTaskRequiresTag,
      bunnyStreakDays: Number(body.bunnyStreakDays),
    });
    await recordAdminAction("engagement_settings_updated", {
      postTaskRequiresTag: settings.postTaskRequiresTag,
      bunnyStreakDays: settings.bunnyStreakDays,
      postTextLength: settings.postTaskText.length,
    });
    return json({ settings });
  } catch (error) {
    return routeError(error);
  }
}
