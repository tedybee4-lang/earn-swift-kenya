# SmartEarn roadmap

## Phase 1 — done
- [x] Blue/purple design system, new homepage with live tasks from database
- [x] Phone + password sign up / login, role-based routing (customer → /dashboard, admin → /admin)
- [x] Customer dashboard: balance, tasks, activity; atomic task completion
- [x] Admin: overview stats, task management, user status
- [x] About, Terms, Privacy, Refund, Help pages

## Phase 2 — payments (connected, needs a small real test)
- [x] stk_transactions + payments tables, initiate STK push, callback, status polling
- [x] PayHero STK Push request, callback validation, and authenticated transaction-status verification
- [x] SMS activation code after verified PayHero payment; account activates when user enters the code
- [x] Three free tasks before payment; four tasks daily after activation
- [x] Responsive admin dashboard navigation and overview refresh
- [x] /dashboard/activate page + manual Till 5441898 fallback
- [x] Referral commissions (80/150/250), admin STK transactions page + CSV

## Phase 3 — SMS
- [x] sms_logs, send helper (normalize, STOP footer, dedupe, retry)
- [~] Event SMS (done: signup, referral signup, STK sent/success/fail, commission; todo: tasks, milestones, streaks)
- [ ] Event SMS remaining (, tasks, milestones, referrals, streaks)
- [ ] Scheduled SMS via cron (8AM, 1PM, 7PM, 10PM, Sunday, Monday), real numbers only
- [x] Admin SMS test + provider logs

## Phase 4
- [ ] Withdrawals (650 min, 3 active refs, 5% fee min 30, 7-day hold), admin payouts
- [ ] Proof task review, streak/login bonuses, anti-fraud (IP/device), admin audit log
- [ ] Referrals page, profile page, leaderboard

## Open items
- [x] First admin account securely provisioned and granted the admin role
- [x] Generic sample tasks paused; only tasks with a verified HTTPS destination can now be made live
- Add sponsor-provided task links and instructions through Admin before publishing tasks
- Support contact details for Help page
- Register the PayHero callback URL in the payment channel settings: https://smarttearnn.vercel.app/api/public/mpesa-callback
- Run migrations 0009 and 0010 in Supabase and complete a low-value end-to-end test

## Migration to own Supabase (2026-09-24)
- User Supabase: exisbpugnwmhclnjpqru.supabase.co; Vercel: smarttearnn.vercel.app; values wired into .env.example + DEPLOY.md
- User must still: add SUPABASE_SERVICE_ROLE_KEY + PAYHERO_AUTH_TOKEN + PAYHERO_CHANNEL_ID + SMS_API_TOKEN in Vercel; register the PayHero callback; apply migrations 0007, 0008, 0009 and 0010 if needed; turn off Confirm email; create admin via SQL; redeploy; test a small payment and SMS
