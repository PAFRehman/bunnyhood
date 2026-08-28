import { recordAdminAction } from "@/lib/spin/audit";
import { requireSpinAdmin } from "@/lib/spin/admin";
import { assertSameOrigin, HttpError, json, readJson, routeError } from "@/lib/spin/http";
import { getEligibilityById } from "@/lib/rabbit-hole/data";
import { requestExplorerMetadataRefresh } from "@/lib/rabbit-hole/explorer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    requireSpinAdmin(request);
    assertSameOrigin(request);
    const body = await readJson<{ eligibilityId?: string }>(request, 2_048);
    const row = await getEligibilityById(body.eligibilityId ?? "");
    if (
      !row
      || row.status !== "claimed"
      || !row.contract_address
      || row.chain_id === null
      || !row.token_id
      || !row.metadata_cid
    ) {
      throw new HttpError(409, "Only a confirmed IPFS-backed SBT can be refreshed.", "SBT_NOT_REFRESHABLE");
    }

    await requestExplorerMetadataRefresh({
      chainId: Number(row.chain_id),
      contractAddress: row.contract_address,
      tokenId: row.token_id,
    });
    await recordAdminAction("rabbit_hole_explorer_metadata_refreshed", {
      eligibilityId: row.id,
      contractAddress: row.contract_address,
      tokenId: row.token_id,
    });
    return json({ ok: true, tokenId: row.token_id });
  } catch (error) {
    return routeError(error);
  }
}
