import { requireSessionUser } from "@/lib/spin/auth";
import { sellBunnyForPoints } from "@/lib/spin/bunny";
import { assertSameOrigin, json, readJson, routeError } from "@/lib/spin/http";
import { assertPublicStorageWritable } from "@/lib/spin/storage-safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await assertPublicStorageWritable();
    const user = await requireSessionUser(request, true);
    const body = await readJson<{ idempotencyKey?: string }>(request);
    return json(await sellBunnyForPoints(user, body.idempotencyKey ?? ""), 201);
  } catch (error) {
    return routeError(error);
  }
}
