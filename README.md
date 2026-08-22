# Bunny Hood

Production Next.js application for Bunny Hood on Vercel.

## Public routes

- `/` — collection website and roadmap
- `/SpinTheWheel` — X-connected rewards, referrals, code redemption, wheel, wins, and wallets
- `/admin/spin` — private live Neon control room and Excel export

Old `/getWL`, `/whitelist`, `/spin`, and lowercase wheel links redirect to `/SpinTheWheel`.

## Production data model

Neon PostgreSQL is the only source of truth. Google Sheets and Apps Script are not part of the request path.

- Points, lifetime spins earned, spins left, spins used, referrals, wins, roles, and current wallets are permanent.
- Every reward changes the spin accounting atomically: `spins earned = spins left + spins used`.
- GTD, FCFS1, and FCFS2 wins remain in `spin_wins`; each user is capped at three of each role.
- Current wallets are stored against their wins. A hash-only registry prevents reuse after replacement or removal.
- Every batch updates 64-way sharded permanent daily totals; no-prize and refunded spins do not create one database row each.
- One compact bitmask row per user/campaign enforces all 60 tasks and 20 code claims instead of creating up to 80 permanent eligibility rows.
- Winning technical events are retained for 72 hours and idempotent batch responses for six hours; the permanent wins and aggregate totals remain.
- Expired task timers, campaign progress, sessions, rate-limit buckets, old batch responses, and the retired Sheet queue are cleaned daily.
- The admin dashboard reads Neon directly every five seconds and cursor-streams current records to `.xlsx` in bounded batches instead of loading the complete dataset into server memory.

The first authenticated request after deployment applies migration `006` automatically and preserves all existing data. The SQL file remains in `db/migrations/006_production_data_platform.sql` for auditing or manual recovery.

## Local checks

```bash
npm install
npm test
npm run dev
```

See [SPIN_THE_WHEEL_SETUP.md](SPIN_THE_WHEEL_SETUP.md) for production configuration. Never commit `.env.local`, database URLs, X secrets, or admin credentials.
