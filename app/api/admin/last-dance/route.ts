import { getLastDanceAdminData, updateLastDanceSettings } from "@/lib/last-dance/data";
import { requireSpinAdmin } from "@/lib/spin/admin";
import { recordAdminAction } from "@/lib/spin/audit";
import { assertSameOrigin, HttpError, json, readJson, routeError } from "@/lib/spin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireSpinAdmin(request);
    return json(await getLastDanceAdminData());
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    requireSpinAdmin(request);
    const body = await readJson<{
      publicEnabled?: unknown;
      maxEntries?: unknown;
      engagementPostUrl?: unknown;
      postText?: unknown;
    }>(request, 4_096);
    if (
      typeof body.publicEnabled !== "boolean"
      || typeof body.engagementPostUrl !== "string"
      || typeof body.postText !== "string"
    ) {
      throw new HttpError(400, "Complete every Last Dance setting.", "BAD_LAST_DANCE_SETTINGS");
    }
    const settings = await updateLastDanceSettings({
      publicEnabled: body.publicEnabled,
      maxEntries: Number(body.maxEntries),
      engagementPostUrl: body.engagementPostUrl,
      postText: body.postText,
    });
    await recordAdminAction("last_dance_settings_updated", {
      publicEnabled: settings.publicEnabled,
      maxEntries: settings.maxEntries,
      engagementPostUrl: settings.engagementPostUrl,
      postTextLength: settings.postText.length,
    });
    return json({ settings });
  } catch (error) {
    return routeError(error);
  }
}
