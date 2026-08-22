import { requireSessionUser } from "@/lib/spin/auth";
import { assertSameOrigin, json, readJson, routeError } from "@/lib/spin/http";
import { removeWinWallet, submitWinWallet } from "@/lib/spin/wheel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(
  request: Request,
  context: { params: Promise<{ winId: string }> },
) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser(request, true);
    const { winId } = await context.params;
    const body = await readJson<{ wallet?: string }>(request);
    const result = await submitWinWallet(user, winId, body.wallet ?? "");
    return json({ ...result, stored: true });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ winId: string }> },
) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser(request, true);
    const { winId } = await context.params;
    const result = await removeWinWallet(user, winId);
    return json({ ...result, stored: true });
  } catch (error) {
    return routeError(error);
  }
}
