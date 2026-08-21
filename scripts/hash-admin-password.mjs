import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];
if (!password || password.length < 12) {
  console.error("Usage: node scripts/hash-admin-password.mjs \"a-password-with-at-least-12-characters\"");
  process.exit(1);
}

const cost = 16384;
const blockSize = 8;
const parallelization = 1;
const salt = randomBytes(18);
const hash = scryptSync(password, salt, 32, {
  N: cost,
  r: blockSize,
  p: parallelization,
  maxmem: 64 * 1024 * 1024,
});

console.log([
  "scrypt",
  cost,
  blockSize,
  parallelization,
  salt.toString("base64url"),
  hash.toString("base64url"),
].join("$"));
