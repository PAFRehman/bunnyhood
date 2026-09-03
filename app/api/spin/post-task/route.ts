import { requireSessionUser } from "@/lib/spin/auth";
import { assertSameOrigin, json, readJson, routeError } from "@/lib/spin/http";
import { submitShopPostTask } from "@/lib/spin/shop";
import { assertPublicStorageWritable } from "@/lib/spin/storage-safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await assertPublicStorageWritable();
    const user = await requireSessionUser(request, true);
    const body = await readJson<{ postUrl?: string }>(request);
    return json(await submitShopPostTask(user, body.postUrl ?? ""));
  } catch (error) {
    return routeError(error);
  }
}
