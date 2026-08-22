# Bunny Hood production setup

The public wheel is `/SpinTheWheel`; the private data and campaign console is `/admin/spin`.

## 1. Rotate exposed credentials

Any X credentials or plain admin password previously pasted into chat must be replaced. In the [X Developer Console](https://console.x.com/), create fresh OAuth 2.0 Client ID and Client Secret values. Configure a confidential Web App with:

```text
Website: https://www.bunnyhood.xyz
Callback: https://www.bunnyhood.xyz/api/spin/auth/x/callback
Scopes: tweet.read users.read
```

Task rewards use a server-backed five-second timer and do not require paid X interaction verification.

## 2. Neon database

Keep the existing `DATABASE_URL` connected to the Vercel project. Neon is the sole durable record for users, balances, points, referrals, campaigns, wins, roles, and wallets.

- Existing installations: no SQL paste is required. Migration `006` runs automatically on the first wheel/admin request after deployment and preserves existing rows.
- New installations: run migrations `001` through `005` once in Neon SQL Editor. Migration `006` will then run automatically, or may be pasted manually.
- Never reset or recreate Neon during an application deployment.

## 3. Vercel environment variables

Add these server-only values to Production and Preview in **Vercel → bunnyhood → Settings → Environment Variables**:

```text
APP_URL=https://www.bunnyhood.xyz
DATABASE_URL=<pooled Neon connection URL>
X_CLIENT_ID=<new OAuth Client ID>
X_CLIENT_SECRET=<new OAuth Client Secret>
X_REDIRECT_URI=https://www.bunnyhood.xyz/api/spin/auth/x/callback
TOKEN_ENCRYPTION_KEY=<private generated value>
CODE_PEPPER=<private generated value>
PRIZE_RANDOM_SECRET=<private generated value>
RATE_LIMIT_SECRET=<private generated value>
ADMIN_SESSION_SECRET=<private generated value>
ADMIN_PASSWORD_HASH=<scrypt hash>
CRON_SECRET=<private generated value>
```

Generate private values locally with `npm run generate:secrets`. Generate the password hash with:

```cmd
node scripts\hash-admin-password.mjs "YOUR-NEW-STRONG-ADMIN-PASSWORD"
```

Do not add Google webhook variables. Do not prefix any private variable with `NEXT_PUBLIC_`.

## 4. Deploy

Push this folder to the repository connected to Vercel:

```cmd
git add .
git commit -m "Add permanent Neon data and roadmap"
git push origin HEAD:main
```

Vercel builds and deploys automatically. Its daily cron calls `/api/cron/spin-maintenance` using `CRON_SECRET` and removes short-lived technical rows without deleting permanent totals or wins.

## 5. Verify production

1. Open `https://www.bunnyhood.xyz/SpinTheWheel` and connect a test X account.
2. Confirm one task click opens X, counts down five seconds, and awards exactly one point plus one spin.
3. Confirm the code awards 10–20 spins only once per round.
4. Spin and confirm lifetime earned, left, used, points, and wins remain after reconnecting.
5. Open `https://www.bunnyhood.xyz/admin/spin` and sign in with the plain password corresponding to `ADMIN_PASSWORD_HASH`.
6. Confirm **Integrity** shows zero accounting and win mismatches.
7. Search Users, Wins & Wallets, and Referrals; download the complete Excel export.
8. Use **Run safe cleanup now** once. Permanent totals and wins must remain unchanged.

## Permanent versus compacted records

Permanent: user identity, points, lifetime spins earned/left/used, referral attribution, referral totals, campaign inventory, wins, roles, current wallets, wallet anti-reuse hashes, and daily activity totals.

Compact operational records: all 60 task claims and 20 code claims for a campaign use one bitmask row per user. No-prize and refunded attempts go directly into 64-way sharded daily totals instead of individual rows. Winning technical events remain for 72 hours, retryable batch responses for six hours, and task timers for at most 24 hours. Completed-campaign eligibility rows are removed only after points and spin balances are permanent.

For high traffic, `DATABASE_URL` must be Neon’s pooled connection string. The application limits each warm serverless instance to five connections and shards the busiest campaign counters across 64 rows to prevent one database row becoming a global lock.
