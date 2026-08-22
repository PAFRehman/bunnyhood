import { getSessionUser } from "@/lib/spin/auth";
import { json, routeError } from "@/lib/spin/http";
import { getStorageSafetyState } from "@/lib/spin/storage-safety";
import { getWheelState } from "@/lib/spin/wheel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    const storage = await getStorageSafetyState();
    const user = await getSessionUser(request, false, !storage.paused);
    const state = await getWheelState(user, storage);
    return json(state);
  } catch (error) {
    return routeError(error);
  }
}
