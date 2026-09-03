import { requireSpinAdmin } from "@/lib/spin/admin";
import { recordAdminAction } from "@/lib/spin/audit";
import { assertSameOrigin, json, readJson, routeError } from "@/lib/spin/http";
import { updateShopInventory } from "@/lib/spin/shop";
import { assertPublicStorageWritable } from "@/lib/spin/storage-safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    requireSpinAdmin(request);
    await assertPublicStorageWritable();
    const body = await readJson<{
      GTD?: { pointsPrice?: number; totalCount?: number };
      FCFS?: { pointsPrice?: number; totalCount?: number };
    }>(request);
    const result = await updateShopInventory({
      GTD: { pointsPrice: Number(body.GTD?.pointsPrice), totalCount: Number(body.GTD?.totalCount) },
      FCFS: { pointsPrice: Number(body.FCFS?.pointsPrice), totalCount: Number(body.FCFS?.totalCount) },
    });
    await recordAdminAction("points_shop_updated", { campaignId: result.campaignId, items: result.items });
    return json(result);
  } catch (error) {
    return routeError(error);
  }
}
