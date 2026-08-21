# Bunny Hood Spin the Wheel — exact setup

The wheel is at `/SpinTheWheel`. The private campaign page is at `/admin/spin`.

## 1. Rotate the exposed X credentials first

The credentials previously pasted into chat must be treated as compromised. Open [X Developer Console](https://console.x.com/), revoke/regenerate the old API key and secret, bearer token, Client ID, and Client Secret, and never reuse the pasted values.

This website uses only a new OAuth 2.0 **Client ID** and **Client Secret**. It does not need the old consumer key or bearer token.

In the X app:

1. Enable OAuth 2.0.
2. Select **Web App** so the app is a confidential client.
3. Set the website URL to `https://www.bunnyhood.xyz`.
4. Add this exact callback URL:

```text
https://www.bunnyhood.xyz/api/spin/auth/x/callback
```

5. Save the newly generated Client ID and Client Secret privately.

The app requests only `tweet.read` and `users.read`. X requires an exact callback match. X is used to identify the connected account once; task completion does not call the X API.

## 2. Add PostgreSQL through Vercel

1. Open [Vercel Dashboard](https://vercel.com/dashboard) and select the `bunnyhood` project.
2. Open **Storage**.
3. Choose **Create Database / Marketplace Database**.
4. Install [Neon Postgres](https://vercel.com/marketplace/neon) and connect it to the Bunny Hood project.
5. Confirm Vercel created a server-only `DATABASE_URL` environment variable.
6. From Vercel Storage, select **Open in Neon Console → SQL Editor**.
7. Run `db/migrations/001_spin_wheel.sql`, `002_click_task_timer.sql`, `003_referrals_fair_campaigns.sql`, `004_wallet_permissions_and_sync.sql`, and `005_wallet_submission_control.sql` in that order.

If migration `004_wallet_permissions_and_sync.sql` already succeeded, run only `db/migrations/005_wallet_submission_control.sql` now. It adds the separate wallet-submission switch without changing existing users, wins, wallets, spins, or referrals.

After upgrading an existing wheel, the old single-round campaign is kept as history but is not reused. Open the admin page immediately after deployment and start a new 20-day campaign so its private pool and daily-round rules begin cleanly.

The database is the authoritative record for users, points, spins, tasks, code redemptions, prize slots, wins, and locked wallets. Google Sheets is a protected readable mirror, not the transaction database.

## 3. Update Google Apps Script

1. Open the existing Bunny Hood Google Sheet.
2. Select **Extensions → Apps Script**.
3. Replace the old script with the complete contents of `google-apps-script/Code.gs`.
4. Open **Project Settings → Script Properties**.
5. Keep or add:

```text
BUNNY_HOOD_WEBHOOK_TOKEN = your-private-random-token
```

6. Select **Deploy → Manage deployments → Edit → New version → Deploy**.
7. Keep the `/exec` URL private.

The script maintains `Spin Users`, `Spin Wins`, and `Spin Referrals`. It may leave an existing historical `Whitelist` tab untouched. Wallets, spins, points, referrals, and win totals are updated by stable IDs. Wallet replacement follows the permission selected in the private admin page.

After updating `google-apps-script/Code.gs`, deploy a **new Apps Script version** from **Deploy → Manage deployments → Edit → New version → Deploy**. The admin page can rebuild users, referrals, wins, and wallet rows from Neon, repair legacy queued payloads, and send up to 20 records per fast bulk request to avoid Apps Script timeouts. Wallet saves, replacements, and removals immediately update the matching win row, with the protected queue retained for automatic retry. Wallet submission and wallet-change controls remain separate in `/admin/spin`.

## 4. Generate private values on Windows

Open Command Prompt in the extracted project folder:

```cmd
cd /d "%USERPROFILE%\Downloads\BunnyHoodSpin"
npm install
npm run generate:secrets
```

Copy the six generated lines to a temporary private note. Do not commit them.

Generate the admin password hash:

```cmd
node scripts\hash-admin-password.mjs "PUT-A-STRONG-ADMIN-PASSWORD-HERE"
```

Copy the single `scrypt$...` result. The plain password is what you will enter at `/admin/spin`; only its hash goes into Vercel.

## 5. Add Vercel environment variables

Open **Vercel → bunnyhood → Settings → Environment Variables**. Add each value to Production and Preview:

```text
APP_URL=https://www.bunnyhood.xyz
DATABASE_URL=<automatically supplied by Neon>
X_CLIENT_ID=<new rotated OAuth 2.0 Client ID>
X_CLIENT_SECRET=<new rotated OAuth 2.0 Client Secret>
X_REDIRECT_URI=https://www.bunnyhood.xyz/api/spin/auth/x/callback
TOKEN_ENCRYPTION_KEY=<generated value>
CODE_PEPPER=<generated value>
PRIZE_RANDOM_SECRET=<generated value>
RATE_LIMIT_SECRET=<generated value>
ADMIN_SESSION_SECRET=<generated value>
ADMIN_PASSWORD_HASH=<generated scrypt value>
CRON_SECRET=<generated value>
GOOGLE_SHEETS_WEBHOOK_URL=<private Apps Script /exec URL>
GOOGLE_SHEETS_WEBHOOK_TOKEN=<same token as Apps Script property>
```

None of these names may start with `NEXT_PUBLIC_`.

If you switch to a new spreadsheet, add the same token to that new Apps Script project's Script Properties and update the webhook URL in Vercel. The next admin Sheet sync detects the changed URL or token and safely queues earlier rows again.

## 6. Deploy and test

Push the updated source to the existing GitHub repository. Vercel will deploy automatically. Environment variable changes also require a redeployment.

1. Open `https://www.bunnyhood.xyz/SpinTheWheel`.
2. Connect a test X account.
3. Open `https://www.bunnyhood.xyz/admin/spin` and sign in with the admin password.
4. For the first round, paste the complete campaign post URL, enter a fresh code, set the private prize totals and expected user count, and click **Start 20-day campaign**. With no end date, it runs for 20 days.
5. On later days, leave **Start a completely new 20-day campaign** turned off, enter the new post and code, then click **Publish daily update**. This resets task/code eligibility while preserving the same 20-day prize pool.
6. With the test user, click each task once. The post opens and each task automatically adds one spin plus one point after the server-enforced five-second timer.
7. Redeem the code and confirm it awards 10–20 spins.
8. Test one spin, skip animation, and **Spin all**. Confirm refunded cap hits leave the balance unchanged.
9. Connect a new test X account through a referral URL and confirm the inviter receives exactly 3 spins.
10. In `/admin/spin`, click **Sync pending rows now**. Confirm `Spin Users`, `Spin Referrals`, and `Spin Wins` update in Google Sheets. Repeat until the pending count reaches zero. A later wallet submission updates the same win row.

## Rules implemented

- A 20-day campaign owns the private prize pool. Each admin daily update creates a fresh round under that campaign, so users can complete the tasks and redeem the new code again without resetting prize inventory.
- Referral controls stay visible after X connection whether or not a daily campaign is active.
- Saved and referral spins can use the latest configured prize pool between campaign rounds. Before the very first prize pool is created, spin buttons remain safely disabled and no balance is consumed.
- A campaign supports at most 20 reward rounds. After round 20, start a new campaign instead of reusing the old pool.
- Clicking each Like, Retweet, and Comment task once starts a server-backed five-second timer, then automatically awards 1 spin and 1 point once per daily round.
- Task completion makes no paid X API verification request. Users are instructed to perform each action properly, and campaign interactions can still be reviewed operationally.
- The code awards 10–20 spins using server cryptographic randomness and can be used once per daily round per X ID.
- Every newly connected referred X account credits one inviter exactly once and awards the inviter 3 spins. Self-referrals and repeat attribution are blocked.
- Prize totals are private, admin-controlled, and gradually unlocked across the campaign. Default pacing assumes 20 daily rounds, 500 connected users, and about 18 task/code spins per user per round.
- Every spin uses server cryptographic randomness. Live odds, repeat protection, and inventory are omitted from the public API and interface.
- A user can win each role at most three times, for nine total wins. A fourth hit on a capped role refunds the spin.
- Every win needs a different EVM wallet. Wallet uniqueness is enforced across all winners. While changes are enabled, a winner can replace or remove a wallet and the existing Google Sheet row is updated. The admin can independently pause all wallet submissions or lock replacements and removals.
- X tokens are encrypted at rest. Campaign codes are one-way hashed. Google URLs and tokens remain server-only. Raw IP addresses are not stored.
- No internet system is literally unbeatable; this implementation closes duplicate, replay, race-condition, exposed-secret, wallet-edit, and client-side-tampering paths. Multi-account abuse still requires operational review and, if needed, extra identity or account-age rules.
