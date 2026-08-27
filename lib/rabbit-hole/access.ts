import "server-only";

import { isRabbitHolePublic } from "./config";
import { requireSpinAdmin } from "@/lib/spin/admin";

export function requireRabbitHoleAccess(request: Request) {
  if (!isRabbitHolePublic()) requireSpinAdmin(request);
}
