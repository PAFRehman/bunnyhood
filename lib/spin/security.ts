import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { getTokenEncryptionKey, requireStrongSecret } from "./config";

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function hmacHex(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

export function seal(value: unknown) {
  const key = getTokenEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function unseal<T>(value: string): T | null {
  try {
    const [ivValue, tagValue, encryptedValue] = value.split(".");
    if (!ivValue || !tagValue || !encryptedValue) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      getTokenEncryptionKey(),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function normalizeRedeemCode(value: string) {
  return value.trim().replace(/\s+/g, "-").toUpperCase();
}

export function hashRedeemCode(campaignId: string, code: string) {
  return hmacHex(
    requireStrongSecret("CODE_PEPPER"),
    `${campaignId}:${normalizeRedeemCode(code)}`,
  );
}

export async function verifyAdminPassword(password: string) {
  const encoded = process.env.ADMIN_PASSWORD_HASH?.trim();
  if (!encoded) return false;
  const [kind, costValue, blockValue, parallelValue, saltValue, hashValue] = encoded.split("$");
  if (kind !== "scrypt" || !costValue || !blockValue || !parallelValue || !saltValue || !hashValue) {
    return false;
  }

  const cost = Number(costValue);
  const blockSize = Number(blockValue);
  const parallelization = Number(parallelValue);
  if (!Number.isInteger(cost) || !Number.isInteger(blockSize) || !Number.isInteger(parallelization)) {
    return false;
  }

  try {
    const expected = Buffer.from(hashValue, "base64url");
    const actual = await new Promise<Buffer>((resolve, reject) => {
      scryptCallback(password, Buffer.from(saltValue, "base64url"), expected.byteLength, {
        N: cost,
        r: blockSize,
        p: parallelization,
        maxmem: 64 * 1024 * 1024,
      }, (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      });
    });
    return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

type AdminTicket = { exp: number; nonce: string };

export function createAdminTicket() {
  const payload: AdminTicket = {
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8,
    nonce: randomToken(18),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = hmacHex(requireStrongSecret("ADMIN_SESSION_SECRET"), body);
  return `${body}.${signature}`;
}

export function verifyAdminTicket(ticket: string | undefined) {
  if (!ticket) return false;
  const [body, signature] = ticket.split(".");
  if (!body || !signature) return false;
  const expected = hmacHex(requireStrongSecret("ADMIN_SESSION_SECRET"), body);
  if (!safeEqual(signature, expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AdminTicket;
    return Number.isInteger(payload.exp) && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
