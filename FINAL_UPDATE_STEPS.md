# Bunny Hood final production update

1. Push this version to the GitHub `main` branch.
2. Wait for the connected Vercel deployment to become **Ready**.
3. Open `https://www.bunnyhood.xyz/SpinTheWheel` once. The idempotent production migration runs automatically and preserves existing points, spins, referrals, wins, roles, and wallets.
4. Sign in at `https://www.bunnyhood.xyz/admin/spin`.
5. Confirm the Integrity checks are both zero and the connected-user count matches Neon.
6. Search the live Users, Wins & Wallets, and Referrals tabs.
7. Download **Bunny Hood records.xlsx** as a private backup.
8. Run safe cleanup once; it removes short-lived technical rows while permanent daily totals, balances, and wins remain.

There is no Google Sheet, Apps Script deployment, or webhook token to configure. Neon is the production source of truth.
