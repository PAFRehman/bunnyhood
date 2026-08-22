import { getDb } from "./db";
import { HttpError } from "./http";

export const STORAGE_SAFETY_LIMIT_BYTES = 490 * 1024 * 1024;
const STORAGE_CHECK_CACHE_MS = 3_000;

export type StorageSafetyState = {
  databaseBytes: number;
  limitBytes: number;
  remainingBytes: number;
  paused: boolean;
};

declare global {
  var bunnyHoodStorageSafetyCache: { value: StorageSafetyState; expiresAt: number } | undefined;
  var bunnyHoodStorageSafetyPending: Promise<StorageSafetyState> | undefined;
}

export async function getStorageSafetyState(forceFresh = false): Promise<StorageSafetyState> {
  const now = Date.now();
  const cached = globalThis.bunnyHoodStorageSafetyCache;
  if (!forceFresh && cached && cached.expiresAt > now) return cached.value;
  if (!forceFresh && globalThis.bunnyHoodStorageSafetyPending) {
    return globalThis.bunnyHoodStorageSafetyPending;
  }

  const pending = (async () => {
    const sql = getDb();
    const rows = await sql<{ database_bytes: number | string }[]>`
      select pg_database_size(current_database())::text as database_bytes
    `;
    const databaseBytes = Number(rows[0]?.database_bytes ?? 0);
    const value = {
      databaseBytes,
      limitBytes: STORAGE_SAFETY_LIMIT_BYTES,
      remainingBytes: Math.max(0, STORAGE_SAFETY_LIMIT_BYTES - databaseBytes),
      paused: databaseBytes >= STORAGE_SAFETY_LIMIT_BYTES,
    };
    globalThis.bunnyHoodStorageSafetyCache = {
      value,
      expiresAt: Date.now() + STORAGE_CHECK_CACHE_MS,
    };
    return value;
  })();

  globalThis.bunnyHoodStorageSafetyPending = pending;
  try {
    return await pending;
  } finally {
    if (globalThis.bunnyHoodStorageSafetyPending === pending) {
      globalThis.bunnyHoodStorageSafetyPending = undefined;
    }
  }
}

export async function assertPublicStorageWritable() {
  const storage = await getStorageSafetyState();
  if (storage.paused) {
    throw new HttpError(
      503,
      "The next spin batch is being prepared. Every saved point, spin, referral, win, and wallet remains secure. Stay connected on X.",
      "STORAGE_SAFETY_PAUSE",
    );
  }
  return storage;
}
