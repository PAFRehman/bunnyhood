import { after } from "next/server";
import { requireSessionUser } from "@/lib/spin/auth";
import { assertSameOrigin, json, readJson, routeError } from "@/lib/spin/http";
import { flushSheetOutbox } from "@/lib/spin/sheets";
import { redeemCampaignCode } from "@/lib/spin/wheel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser(request, true);
    const body = await readJson<{ code?: string }>(request);
    const result = await redeemCampaignCode(user, body.code ?? "");
    after(() => flushSheetOutbox());
    return json(result, 201);
  } catch (error) {
    return routeError(error);
  }
}
