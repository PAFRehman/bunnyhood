# Bunny Hood upcoming-products waitlist

The public waitlist lives at `/waitlist`. It does not connect X and does not ask for a wallet signature or transaction. A browser completes two self-confirmed launch tasks, submits one unique EVM wallet, receives an immutable join number, and gets a referral link. Live rank is ordered by points, then earliest join time:

```text
points = successful referrals + one-time post bonus
```

Each new wallet that joins through a referral link adds one point to the referrer. A joined wallet can submit one unique `x.com/{user}/status/{id}` link for one extra point. The link is not matched to an X account because the waitlist intentionally has no X authentication.

## Required Vercel variables

The waitlist reuses the existing `DATABASE_URL`, `RATE_LIMIT_SECRET`, `ADMIN_SESSION_SECRET`, `ADMIN_PASSWORD_HASH`, and `CRON_SECRET` values. Add:

| Variable | Required | Purpose |
| --- | --- | --- |
| `WAITLIST_X_POST_URL` | Yes for public joining | Exact official X status URL opened by task 2 |
| `WAITLIST_X_PROFILE_URL` | No | Task 1 profile; defaults to `https://x.com/BunnysHood` |
| `WAITLIST_GOOGLE_SHEETS_WEBHOOK_URL` | For Sheets sync | Deployed Apps Script web-app `/exec` URL |
| `WAITLIST_GOOGLE_SHEETS_SECRET` | For Sheets sync | Random server-only secret with at least 32 characters |

Never prefix these variables with `NEXT_PUBLIC_`. Redeploy after adding or changing them.

Without the two Google variables, every signup is still saved safely in Neon and the private admin ledger works; only the Sheets mirror remains disabled. Without `WAITLIST_X_POST_URL`, task 2 is visibly disabled and new users cannot complete the join flow.

## Create the Google Sheet mirror

1. Create a new Google Sheet, for example **Bunny Hood Waitlist**.
2. Open **Extensions → Apps Script**.
3. Replace the editor contents with the script below.
4. Open **Project Settings → Script Properties**, add `WAITLIST_WEBHOOK_SECRET`, and give it the exact same value as Vercel's `WAITLIST_GOOGLE_SHEETS_SECRET`.
5. Choose **Deploy → New deployment → Web app**.
6. Set **Execute as** to yourself and **Who has access** to **Anyone**. The random body secret is still required before the script writes anything.
7. Copy the URL ending in `/exec` into `WAITLIST_GOOGLE_SHEETS_WEBHOOK_URL` in Vercel and redeploy.
8. Open `/admin/waitlist` and select **SYNC GOOGLE SHEETS**. Verify the counters return to zero and a `Waitlist` tab is created.

```javascript
const SHEET_NAME = "Waitlist";
const SECRET_PROPERTY = "WAITLIST_WEBHOOK_SECRET";
const HEADERS = [
  "Entry ID", "Join Number", "Live Rank", "Wallet", "Referral Code",
  "Referred By", "Referral Count", "Bonus Points", "Follow + Bell Confirmed",
  "Engagement Confirmed", "Points", "Bonus Post", "Joined At",
  "Bonus Submitted At", "Synced At", "Revision"
];

function jsonReply(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(event) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const body = JSON.parse((event && event.postData && event.postData.contents) || "{}");
    const expected = PropertiesService.getScriptProperties().getProperty(SECRET_PROPERTY);
    if (!expected || body.secret !== expected) return jsonReply({ ok: false, error: "Unauthorized" });
    if (!Array.isArray(body.events) || body.events.length > 100) {
      return jsonReply({ ok: false, error: "Invalid events" });
    }

    const workbook = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = workbook.getSheetByName(SHEET_NAME) || workbook.insertSheet(SHEET_NAME);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
    }

    const lastRow = sheet.getLastRow();
    const existing = {};
    if (lastRow > 1) {
      const values = sheet.getRange(2, 1, lastRow - 1, 16).getValues();
      values.forEach((row, index) => {
        if (row[0]) existing[String(row[0])] = { row: index + 2, revision: Number(row[15] || 0) };
      });
    }

    body.events.forEach((eventItem) => {
      const data = eventItem.data || {};
      if (!data.entryId) return;
      const old = existing[String(data.entryId)];
      const revision = Number(eventItem.revision || 0);
      if (old && old.revision > revision) return;
      const rowNumber = old ? old.row : sheet.getLastRow() + 1;
      const row = [[
        data.entryId,
        Number(data.joinNumber || 0),
        "",
        data.walletAddress || "",
        data.referralCode || "",
        data.referredByCode || "",
        Number(data.referralCount || 0),
        Number(data.bonusPoints || 0),
        data.followNotificationsCompletedAt || "",
        data.engagePostCompletedAt || "",
        Number(data.score || 0),
        data.bonusPostUrl || "",
        data.joinedAt || "",
        data.bonusSubmittedAt || "",
        new Date().toISOString(),
        revision
      ]];
      sheet.getRange(rowNumber, 1, 1, 16).setValues(row);
      sheet.getRange(rowNumber, 3).setFormula(
        `=RANK(K${rowNumber},$K$2:$K,0)+COUNTIFS($K$2:$K,K${rowNumber},$B$2:$B,"<"&B${rowNumber})`
      );
      existing[String(data.entryId)] = { row: rowNumber, revision: revision };
    });

    sheet.autoResizeColumns(1, HEADERS.length);
    return jsonReply({ ok: true });
  } catch (error) {
    return jsonReply({ ok: false, error: String(error && error.message || error) });
  } finally {
    lock.releaseLock();
  }
}
```

Vercel calls `/api/cron/waitlist-sheets` every ten minutes. Failed deliveries remain in `waitlist_sheet_outbox` and retry with bounded exponential backoff. A successful Neon signup never depends on Google being available. The private `/admin/waitlist` page can trigger the same sync manually and shows pending or retrying rows.

## User flow

1. Open `/waitlist`, optionally with `?ref=bh…`. The first valid referral code seen by that browser is retained until it joins.
2. Open **Follow + turn notifications on**, perform the action on X, return after five seconds, and confirm.
3. Open the official post, like/repost/comment, return after five seconds, and confirm.
4. Enter a valid EVM wallet. The server accepts one entry per wallet and one entry per browser waitlist session.
5. Receive the permanent join number, live rank, points, and referral link.
6. Optionally create a BunnyHood post and submit its unique X status URL for one point.
7. Search public rank by complete wallet address or referral code. Public results and the leaderboard mask wallet addresses; the admin ledger and Google Sheet retain the complete wallet.

## Important trust boundary

The required X actions are self-confirmed. X does not expose notification settings through the standard API, and this waitlist deliberately has no X login. The bonus validates URL shape and global uniqueness, not authorship or post content. Also, entering a wallet does not prove wallet ownership because no signature is requested. Treat the waitlist as an early-access registration and ranking system—not as proof of identity, social engagement, or wallet control.

## Admin and data model

`/admin/waitlist` is absent from public navigation and requires the same signed admin cookie as the existing control rooms. It shows full wallets, current rank, join number, tasks, referrals, bonus links, and Sheets status, and can copy the displayed wallets.

Migration `011_upcoming_products_waitlist` creates:

- `waitlist_sessions`: hashed anonymous session and CSRF tokens plus first-touch referral attribution;
- `waitlist_task_progress`: server start/completion timestamps for the two required tasks;
- `waitlist_entries`: unique wallet, immutable join number, referral code, and point counters;
- `waitlist_referrals`: one immutable referrer attribution per referred entry;
- `waitlist_bonus_posts`: one unique post and point per entry;
- `waitlist_sheet_outbox`: durable, revisioned Google delivery queue.

The schema applies lazily on first use under a PostgreSQL advisory lock. Neon is authoritative; deleting or editing rows directly can corrupt rank and referral accounting.
