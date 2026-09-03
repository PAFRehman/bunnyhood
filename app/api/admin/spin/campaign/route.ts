import { requireSpinAdmin } from "@/lib/spin/admin";
import { recordAdminAction } from "@/lib/spin/audit";
import { publishCampaign } from "@/lib/spin/campaigns";
import { assertSameOrigin, json, readJson, routeError } from "@/lib/spin/http";
import { assertPublicStorageWritable } from "@/lib/spin/storage-safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    requireSpinAdmin(request);
    await assertPublicStorageWritable();
    const body = await readJson<{
      title?: string;
      tweetUrl?: string;
      redeemCode?: string;
      endsAt?: string;
      expectedUsers?: number;
      gtdCount?: number;
      fcfs1Count?: number;
      fcfs2Count?: number;
      shopPostText?: string;
      startNewCampaign?: boolean;
    }>(request);
    const campaign = await publishCampaign({
      title: body.title ?? "",
      tweetUrl: body.tweetUrl ?? "",
      redeemCode: body.redeemCode ?? "",
      endsAt: body.endsAt,
      expectedUsers: body.expectedUsers,
      gtdCount: body.gtdCount,
      fcfs1Count: body.fcfs1Count,
      fcfs2Count: body.fcfs2Count,
      shopPostText: body.shopPostText,
      startNewCampaign: Boolean(body.startNewCampaign),
    });
    await recordAdminAction("campaign_published", {
      campaignId: campaign.id,
      roundNumber: Number(campaign.round_number),
      startNewCampaign: Boolean(body.startNewCampaign),
    });
    return json({ campaign }, 201);
  } catch (error) {
    return routeError(error);
  }
}
