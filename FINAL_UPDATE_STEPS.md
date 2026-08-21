# Bunny Hood final wallet and Google Sheets update

This final update keeps the existing wheel and campaign behavior. It repairs wallet-update responses, adds wallet removal, immediately updates the matching `Spin Wins` row in Google Sheets, and keeps a retry queue if Google is temporarily unavailable.

## 1. Extract the ZIP

Extract the ZIP in Downloads and rename the inner `bunnyhood-vercel` folder to `BunnyHoodFinal`.

Open Windows Command Prompt and run each command separately:

```cmd
cd /d "%USERPROFILE%\Downloads\BunnyHoodFinal"
dir
```

## 2. Neon database

No new Neon SQL is required for this update. Do not rerun migrations if `001` through `005` already completed successfully.

## 3. Deploy the final Google Apps Script

Copy the complete script:

```cmd
type "google-apps-script\Code.gs" | clip
```

Then:

1. Open the Google Sheet connected to Bunny Hood.
2. Select **Extensions → Apps Script**.
3. Delete the old code, paste with `Ctrl+V`, and save.
4. Open **Project Settings → Script Properties**.
5. Confirm `BUNNY_HOOD_WEBHOOK_TOKEN` is present. Its value must exactly match `GOOGLE_SHEETS_WEBHOOK_TOKEN` in Vercel.
6. Select **Deploy → Manage deployments**.
7. Click the pencil icon, choose **New version**, and click **Deploy**.
8. Keep **Execute as: Me** and **Who has access: Anyone**.

The `/exec` URL normally stays the same. If Google gives you a different `/exec` URL, replace `GOOGLE_SHEETS_WEBHOOK_URL` in Vercel and redeploy.

## 4. Push the final folder to GitHub

Run each command separately:

```cmd
git init
git branch -M main
git remote remove origin
git remote add origin https://github.com/PAFRehman/bunnyhood.git
git add .
git commit -m "Finalize wallet and Google Sheets sync"
git fetch origin main
git push -u origin main --force-with-lease
```

If `git remote remove origin` says that origin does not exist, ignore that one message and continue.

## 5. Wait for Vercel

Open the Bunny Hood project in Vercel and wait until the newest deployment says **Ready**. No Vercel environment variable changes are required when the current Sheet URL and token are unchanged.

## 6. Recover old Sheet rows

Open:

```text
https://www.bunnyhood.xyz/admin/spin
```

Click **Sync pending rows now**. The final version sends at most 20 rows per request to avoid Google Apps Script timeouts. Click again until **updates pending** reaches `0`.

## 7. Test wallet save, update, and removal

1. Keep **Wallet submissions** open in the admin page.
2. Keep **Wallet changes** enabled while testing updates and removals.
3. Open `https://www.bunnyhood.xyz/SpinTheWheel` using a winner account.
4. Save a unique EVM wallet.
5. Confirm the same win row updates in the `Spin Wins` Sheet tab.
6. Replace the wallet and confirm the same row changes instead of creating a duplicate.
7. Click **Remove wallet**, approve the confirmation, and confirm the wallet cells become empty in the same Sheet row.

When **Wallet changes** is locked, saved wallets cannot be replaced or removed. When **Wallet submissions** is paused, no wallet action is allowed. Neon remains the authoritative database; Google Sheets is the protected live mirror.
