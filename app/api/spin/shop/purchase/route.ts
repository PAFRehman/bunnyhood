import { requireSessionUser } from "@/lib/spin/auth";
import { assertSameOrigin, json, readJson, routeError } from "@/lib/spin/http";
import { purchaseShopSpot } from "@/lib/spin/shop";
import { assertPublicStorageWritable } from "@/lib/spin/storage-safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await assertPublicStorageWritable();
    const user = await requireSessionUser(request, true);
    const body = await readJson<{ spotType?: string; idempotencyKey?: string }>(request);
    return json(await purchaseShopSpot(user, body.spotType ?? "", body.idempotencyKey ?? ""), 201);
  } catch (error) {
    return routeError(error);
  }
}
