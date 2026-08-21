import { ADMIN_COOKIE } from "./config";
import { getCookie, HttpError } from "./http";
import { verifyAdminTicket } from "./security";

export function requireSpinAdmin(request: Request) {
  if (!verifyAdminTicket(getCookie(request, ADMIN_COOKIE))) {
    throw new HttpError(401, "Admin sign-in required.", "ADMIN_AUTH_REQUIRED");
  }
}

