import { requireSpinAdmin } from "@/lib/spin/admin";
import { requireSessionUser } from "@/lib/spin/auth";
import { assertSameOrigin, json, readJson, routeError } from "@/lib/spin/http";
import { claimRabbitHoleBox } from "@/lib/rabbithole/claims";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    requireSpinAdmin(request);
    const user = await requireSessionUser(request, true);
    const body = await readJson<{ wallet?: string }>(request, 2_048);
    const claim = await claimRabbitHoleBox(user, body.wallet || "");
    return json({ claim }, claim?.status === "CONFIRMED" ? 201 : 202);
  } catch (error) {
    return routeError(error);
  }
}
