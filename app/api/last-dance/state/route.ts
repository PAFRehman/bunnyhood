import { getSessionUser } from "@/lib/spin/auth";
import { json, routeError } from "@/lib/spin/http";
import { getLastDanceState, requireLastDanceAccess } from "@/lib/last-dance/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireLastDanceAccess(request);
    const user = await getSessionUser(request, false, false);
    return json(await getLastDanceState(user));
  } catch (error) {
    return routeError(error);
  }
}
