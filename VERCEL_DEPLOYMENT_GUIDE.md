# Bunny Hood — Vercel deployment

## Existing live project

1. Confirm the GitHub repository is connected to the `bunnyhood` Vercel project.
2. Keep the existing pooled Neon `DATABASE_URL` (the hostname should use Neon’s pooler).
3. Remove obsolete `GOOGLE_SHEETS_WEBHOOK_URL` and `GOOGLE_SHEETS_WEBHOOK_TOKEN` variables; they are no longer used.
4. Confirm every variable listed in `.env.example` exists for Production.
5. Push to `main` and wait for the Vercel deployment to show **Ready**.
6. Open `/SpinTheWheel`; the production schema upgrade runs automatically.
7. Open `/admin/spin` to verify live totals and download either the complete Excel snapshot or a mobile-friendly CSV. Use individual CSV files for large datasets.
8. Open `/RabbitHole` from the admin panel. It remains admin-only until the page guard is intentionally removed.

Rabbit Hole claims stay disabled until its separately deployed SBT contract, deployment block, private RPC, and dedicated low-balance minter are configured. Follow `docs/RABBIT_HOLE_DEPLOYMENT.md`; never reuse or upload the offline owner/deployer key.

## First deployment

Import the repository at [vercel.com/new](https://vercel.com/new), keep the detected Next.js defaults, connect Neon, add the private environment values, and deploy. For a brand-new empty database, run migrations `001` through `005` in order before opening the wheel.

## Campaign operation

- First day: set the post, redeem code, expected users, and private GTD/FCFS inventory, then start a new 20-day campaign.
- Later days: publish a daily update without selecting a new campaign. Daily task/code eligibility resets while balances and inventory remain.
- Wallet submission and wallet-change permissions are separate controls.
- Google Sheets is not required. The private `.xlsx` and CSV exports come directly from Neon; CSV can be imported into Google Sheets with no webhook.
- The public experience automatically pauses writes at 490 MiB. If that happens, use the admin export, run safe cleanup, and increase Neon capacity before reopening automatically by dropping below the threshold.
