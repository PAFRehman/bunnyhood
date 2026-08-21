import { randomBytes } from "node:crypto";

function token(bytes = 48) {
  return randomBytes(bytes).toString("base64url");
}

console.log(`TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`);
console.log(`CODE_PEPPER=${token()}`);
console.log(`PRIZE_RANDOM_SECRET=${token()}`);
console.log(`RATE_LIMIT_SECRET=${token()}`);
console.log(`ADMIN_SESSION_SECRET=${token()}`);
console.log(`CRON_SECRET=${token()}`);
