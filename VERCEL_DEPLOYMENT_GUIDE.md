# Bunny Hood — easy Vercel deployment guide

The public rewards page is `/SpinTheWheel`. Old `/getWL` and `/whitelist` links automatically redirect to it.

## 1. Install the database

1. Open [Vercel Dashboard](https://vercel.com/dashboard), choose `bunnyhood`, then open **Storage**.
2. Add a Neon Postgres database and connect it to the project.
3. Open **Neon Console → SQL Editor**.
4. For a new installation, run migrations `001_spin_wheel.sql`, `002_click_task_timer.sql`, `003_referrals_fair_campaigns.sql`, `004_wallet_permissions_and_sync.sql`, and `005_wallet_submission_control.sql` in order.
5. If migration `004` already succeeded, run only `005_wallet_submission_control.sql` now.

For an upgrade, the previous campaign stays in database history but will no longer be active. After deployment, start a new 20-day campaign from the admin page.

The database is the authoritative source for accounts, points, spins, task timers, code redemptions, wins, and locked wallets.

## 2. Configure X Connect

In the [X Developer Console](https://console.x.com/), configure an OAuth 2.0 Web App with:

```text
Website URL: https://www.bunnyhood.xyz
Callback URL: https://www.bunnyhood.xyz/api/spin/auth/x/callback
Scopes: tweet.read users.read
```

Task completion does not use X API verification. X Connect is used to identify and restore the user account; each task opens the campaign post, waits five seconds, and awards once.

Rotate any credentials that were previously shared in chat. Use only newly generated values in Vercel.

## 3. Configure Google Sheets

1. In the existing Sheet, select **Extensions → Apps Script**.
2. Replace the script with `google-apps-script/Code.gs` from this package.
3. In **Project Settings → Script Properties**, add `BUNNY_HOOD_WEBHOOK_TOKEN` with a long private random value.
4. Select **Deploy → Manage deployments → Edit → New version → Deploy**.
5. Copy the private URL ending in `/exec`.

The browser never receives the Sheet editor URL, Apps Script URL, or webhook token.

## 4. Generate private values

In Windows Command Prompt:

```cmd
cd /d "%USERPROFILE%\Downloads\BunnyHoodSpin"
npm install
npm run generate:secrets
node scripts\hash-admin-password.mjs "YOUR-STRONG-ADMIN-PASSWORD"
```

Save the generated values privately. Do not put them in GitHub.

## 5. Add Vercel environment variables

Open **Vercel → bunnyhood → Settings → Environment Variables** and add these to Production and Preview:

```text
APP_URL=https://www.bunnyhood.xyz
DATABASE_URL=<provided by Neon>
X_CLIENT_ID=<new X OAuth Client ID>
X_CLIENT_SECRET=<new X OAuth Client Secret>
X_REDIRECT_URI=https://www.bunnyhood.xyz/api/spin/auth/x/callback
TOKEN_ENCRYPTION_KEY=<generated value>
CODE_PEPPER=<generated value>
PRIZE_RANDOM_SECRET=<generated value>
RATE_LIMIT_SECRET=<generated value>
ADMIN_SESSION_SECRET=<generated value>
ADMIN_PASSWORD_HASH=<generated scrypt hash>
CRON_SECRET=<generated value>
GOOGLE_SHEETS_WEBHOOK_URL=<private Apps Script /exec URL>
GOOGLE_SHEETS_WEBHOOK_TOKEN=<same Apps Script property value>
```

Never prefix a private variable with `NEXT_PUBLIC_`.

If you switch to a new spreadsheet or token, add the exact token to that Apps Script project's Script Properties and update both private Google variables in Vercel. The next admin Sheet sync detects the changed destination, rebuilds canonical users, referrals, wins, and wallets from Neon, and safely queues available earlier rows again.

## 6. Upload and deploy

From Windows Command Prompt in the extracted folder:

```cmd
cd /d "%USERPROFILE%\Downloads\BunnyHoodSpin"
git add -- app db google-apps-script lib scripts README.md SPIN_THE_WHEEL_SETUP.md VERCEL_DEPLOYMENT_GUIDE.md next.config.ts
git commit -m "Add referrals and fair campaign spins"
git push origin HEAD:main
```

Vercel deploys the GitHub push automatically. If this is the first deployment, import the repository at [vercel.com/new](https://vercel.com/new), keep the detected Next.js defaults, and click **Deploy**.

## 7. Publish a 20-day campaign

1. Open `https://www.bunnyhood.xyz/admin/spin`.
2. Sign in with the admin password.
3. On the first day, paste the X post URL, add the redeem code, set expected users and private GTD/FCFS totals, then click **Start 20-day campaign**. GTD must be lower than both FCFS totals.
4. Leave end time empty for the default 20-day campaign.
5. On each later day, keep **Start a completely new 20-day campaign** off, enter the new post and code, then click **Publish daily update**. This resets user task/code eligibility while preserving the 20-day prize pool.
6. Users click each five-second task once, perform the action on X, redeem the code, share referral links, and spin one-by-one or in a batch.

Each campaign supports 20 daily rounds. The admin panel will require a new campaign after round 20.

## 8. Test

1. Open `https://www.bunnyhood.xyz/SpinTheWheel`.
2. Connect X.
3. Click a task and confirm X opens.
4. Confirm the five-second countdown automatically adds exactly one spin plus one point.
5. Confirm the completion notification disappears after five seconds.
6. Redeem the code and confirm 10–20 spins are added once.
7. Test **Spin all**, animation skipping, and a referral link with a new X test account.
8. Confirm stats appear in `Spin Users`, referrals in `Spin Referrals`, and wins in `Spin Wins`.

For a daily-update test, publish a second post/code from the admin panel without enabling a new campaign. The same user should be eligible for all three tasks and the new code again, while the private claimed/total prize counts remain unchanged.

Task timers are enforced by the server and protected against repeat claims. Because there is no paid X interaction lookup, users are asked to complete each action properly and entries can still be reviewed when necessary.
