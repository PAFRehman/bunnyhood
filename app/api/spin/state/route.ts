import { after } from "next/server";
import { getSessionUser } from "@/lib/spin/auth";
import { json, routeError } from "@/lib/spin/http";
import { flushSheetOutbox } from "@/lib/spin/sheets";
import { getWheelState } from "@/lib/spin/wheel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    const state = await getWheelState(user);
    after(() => flushSheetOutbox());
    return json(state);
  } catch (error) {
    return routeError(error);
  }
}
