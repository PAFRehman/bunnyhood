import { requireSessionUser } from "@/lib/spin/auth";
import { assertSameOrigin, json, readJson, routeError } from "@/lib/spin/http";
import { assertPublicStorageWritable } from "@/lib/spin/storage-safety";
import { playSpins } from "@/lib/spin/wheel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await assertPublicStorageWritable();
    const user = await requireSessionUser(request, true);
    const body = await readJson<{ idempotencyKey?: string; count?: number }>(request);
    const result = await playSpins(user, body.idempotencyKey ?? "", Number(body.count ?? 1));
    return json(result, 201);
  } catch (error) {
    return routeError(error);
  }
}
