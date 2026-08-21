const MIN_SECRET_LENGTH = 32;

export function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function requireStrongSecret(name: string) {
  const value = requireEnv(name);
  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(`${name} must contain at least ${MIN_SECRET_LENGTH} characters.`);
  }
  return value;
}

export function getAppUrl() {
  const value = requireEnv("APP_URL");
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("APP_URL must use HTTPS outside local development.");
  }
  return url.origin;
}

export function getXConfig() {
  return {
    clientId: requireEnv("X_CLIENT_ID"),
    clientSecret: requireEnv("X_CLIENT_SECRET"),
    redirectUri: process.env.X_REDIRECT_URI?.trim()
      || `${getAppUrl()}/api/spin/auth/x/callback`,
  };
}

export function getTokenEncryptionKey() {
  const encoded = requireEnv("TOKEN_ENCRYPTION_KEY");
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

export function getSheetConfig() {
  const url = process.env.GOOGLE_SHEETS_WEBHOOK_URL?.trim();
  const token = process.env.GOOGLE_SHEETS_WEBHOOK_TOKEN?.trim();
  return url && token ? { url, token } : null;
}

export const SPIN_COOKIE = "bh_spin_session";
export const CSRF_COOKIE = "bh_spin_csrf";
export const OAUTH_COOKIE = "bh_x_oauth";
export const ADMIN_COOKIE = "bh_spin_admin";

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const ADMIN_MAX_AGE_SECONDS = 60 * 60 * 8;

