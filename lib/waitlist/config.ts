import "server-only";

import { HttpError } from "@/lib/spin/http";

export const WAITLIST_SESSION_COOKIE = "bh_waitlist_session";
export const WAITLIST_CSRF_COOKIE = "bh_waitlist_csrf";
export const WAITLIST_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;
export const WAITLIST_TASK_WAIT_MS = 5_000;

const DEFAULT_PROFILE_URL = "https://x.com/BunnysHood";

function safeHttpsUrl(value: string | undefined) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function getWaitlistXProfileUrl() {
  const url = safeHttpsUrl(process.env.WAITLIST_X_PROFILE_URL) ?? new URL(DEFAULT_PROFILE_URL);
  if (!["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname.toLowerCase())) {
    return DEFAULT_PROFILE_URL;
  }
  return url.toString();
}

export function getWaitlistXPostUrl() {
  const url = safeHttpsUrl(process.env.WAITLIST_X_POST_URL);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  if (!["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(host)) return null;
  if (!/^\/[A-Za-z0-9_]{1,15}\/status\/[0-9]{5,30}\/?$/.test(url.pathname)) return null;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function parseWaitlistPostUrl(value: string) {
  const url = safeHttpsUrl(value);
  if (!url) {
    throw new HttpError(400, "Enter a valid X post link.", "BAD_POST_URL");
  }
  const host = url.hostname.toLowerCase();
  if (!["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(host)) {
    throw new HttpError(400, "The bonus link must be an x.com post.", "BAD_POST_URL");
  }
  const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/([0-9]{5,30})\/?$/);
  if (!match) {
    throw new HttpError(400, "Paste the complete x.com post URL.", "BAD_POST_URL");
  }
  return {
    postId: match[2],
    postUrl: `https://x.com/${match[1]}/status/${match[2]}`,
    xUsername: match[1].toLowerCase(),
  };
}

export function waitlistSheetsConfigured() {
  return Boolean(
    process.env.WAITLIST_GOOGLE_SHEETS_WEBHOOK_URL?.trim()
    && process.env.WAITLIST_GOOGLE_SHEETS_SECRET?.trim(),
  );
}

export function getWaitlistSheetsConfig() {
  const rawUrl = process.env.WAITLIST_GOOGLE_SHEETS_WEBHOOK_URL?.trim();
  const secret = process.env.WAITLIST_GOOGLE_SHEETS_SECRET?.trim();
  if (!rawUrl && !secret) return null;
  if (!rawUrl || !secret || secret.length < 32) {
    throw new Error("Set both WAITLIST_GOOGLE_SHEETS_WEBHOOK_URL and a 32+ character WAITLIST_GOOGLE_SHEETS_SECRET.");
  }
  const url = safeHttpsUrl(rawUrl);
  if (!url || url.hostname !== "script.google.com" || !url.pathname.endsWith("/exec")) {
    throw new Error("WAITLIST_GOOGLE_SHEETS_WEBHOOK_URL must be the HTTPS /exec URL of a deployed Google Apps Script web app.");
  }
  return { url: url.toString(), secret };
}
