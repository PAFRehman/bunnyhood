import { requireSessionUser } from "@/lib/spin/auth";
import { assertSameOrigin, json, readJson, routeError } from "@/lib/spin/http";
import { assertPublicStorageWritable } from "@/lib/spin/storage-safety";
import { redeemCampaignCode } from "@/lib/spin/wheel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await assertPublicStorageWritable();
    const user = await requireSessionUser(request, true);
    const body = await readJson<{ code?: string }>(request);
    const result = await redeemCampaignCode(user, body.code ?? "");
    return json(result, 201);
  } catch (error) {
    return routeError(error);
  }
}
