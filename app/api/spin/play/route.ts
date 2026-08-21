import { after } from "next/server";
import { requireSessionUser } from "@/lib/spin/auth";
import { assertSameOrigin, json, readJson, routeError } from "@/lib/spin/http";
import { flushSheetOutbox } from "@/lib/spin/sheets";
import { playSpins } from "@/lib/spin/wheel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser(request, true);
    const body = await readJson<{ idempotencyKey?: string; count?: number }>(request);
    const result = await playSpins(user, body.idempotencyKey ?? "", Number(body.count ?? 1));
    after(() => flushSheetOutbox());
    return json(result, 201);
  } catch (error) {
    return routeError(error);
  }
}
