# Run SmartEarn on GitHub + Vercel + your own Supabase

All backend code already reads its connection from environment variables, so
pointing it at your own Supabase needs no code changes: set the variables below.

Your project details (already filled in):
- Supabase URL: `https://exisbpugnwmhclnjpqru.supabase.co`
- Supabase project ref: `exisbpugnwmhclnjpqru`
- Publishable key: `sb_publishable_bLXXpq6QR9PMZpgsRzF2vQ_TX-fZqKP`
- Vercel site: `https://smarttearnn.vercel.app`

## Backend pieces (all included)
| Piece | Where it lives |
| --- | --- |
| Tables, enums, RLS, grants | `supabase/setup.sql` |
| DB functions: `has_role`, `complete_task` (instant rewards), `activate_stk` (activation + tier + referral commission), `recent_activity`, `handle_new_user` | `supabase/setup.sql` |
| Trigger `on_auth_user_created` | `supabase/setup.sql` |
| Realtime on `tasks` | `supabase/setup.sql` |
| Payment request (PayHero STK) | server function `src/lib/payments.functions.ts` (runs on Vercel) |
| Payment callback webhook | `src/routes/api/public/mpesa-callback.ts` -> `/api/public/mpesa-callback` |
| SMS (iSpLedger) | `src/lib/sms.server.ts` (runs on Vercel) |
| Admin actions (delete user, SMS key, manual activate) | `src/lib/payments.functions.ts` |
| Storage buckets | none used |
| Supabase Edge Functions | none - nothing to deploy |
| Cron jobs | none currently |

## 1. Supabase setup
1. SQL Editor -> paste `supabase/setup.sql` -> Run. (You said you already did this.)
2. If not already applied, run `supabase/migrations/0007_payment_approval_notifications_withdrawal.sql` after `setup.sql`; then run `supabase/migrations/0008_admin_payment_approval_access.sql` to enable role-checked admin approval actions.
3. Authentication -> Providers -> Email: enabled; turn OFF "Confirm email"
   (members sign in with phone numbers mapped to internal emails).
4. Authentication -> URL Configuration -> Site URL = `https://smarttearnn.vercel.app`.
5. Create the admin: sign up in the app with your admin phone, then in SQL Editor:
   ```sql
   insert into public.user_roles (user_id, role)
   select id, 'admin' from public.profiles where phone = '254713824135';
   update public.profiles set status = 'active' where phone = '254713824135';
   ```
6. Add your live tasks from the admin dashboard (each needs an https link).

## 2. Vercel environment variables
Vercel -> Project -> Settings -> Environment Variables (enable Production):
| Name | Value |
| --- | --- |
| VITE_SUPABASE_URL | `https://exisbpugnwmhclnjpqru.supabase.co` |
| VITE_SUPABASE_PUBLISHABLE_KEY | `sb_publishable_bLXXpq6QR9PMZpgsRzF2vQ_TX-fZqKP` |
| VITE_SUPABASE_PROJECT_ID | `exisbpugnwmhclnjpqru` |
| SUPABASE_URL | `https://exisbpugnwmhclnjpqru.supabase.co` |
| SUPABASE_PUBLISHABLE_KEY | `sb_publishable_bLXXpq6QR9PMZpgsRzF2vQ_TX-fZqKP` |
| SUPABASE_PROJECT_ID | `exisbpugnwmhclnjpqru` |
| SUPABASE_SERVICE_ROLE_KEY | service_role key (Supabase -> Project Settings -> API; server only, never VITE_, never in GitHub) |
| PAYHERO_AUTH_TOKEN | Basic authorization token from PayHero's API Keys menu |
| PAYHERO_CHANNEL_ID | Registered PayHero M-Pesa payment channel ID |
| SMS_API_TOKEN | NEW iSpLedger token (the old one was exposed) |
| PAYHERO_STK_ENDPOINT | optional; defaults to `https://backend.payhero.co.ke/api/v2/payments` |
| PAYHERO_CALLBACK_URL | optional; defaults to `https://smarttearnn.vercel.app/api/public/mpesa-callback` |
| SMS_SENDER_ID | optional (default TOPSPEED) |

Redeploy after adding them (Vercel -> Deployments -> Redeploy).

## 3. PayHero callback URL
In the PayHero payment channel settings, set the callback URL to:
`https://smarttearnn.vercel.app/api/public/mpesa-callback`

## Moving existing members
Existing data lives in the Lovable backend. Export tables as CSV there
(Cloud -> Advanced -> Export data) and import into the same tables in your
Supabase. Members must reset their passwords (passwords cannot be exported).

## 4. Update v2 (task limits, KSh 50 minimum, withdrawals, referrals)
If you already ran `setup.sql` before, run `supabase/update_v2_limits_withdrawals.sql` once in the SQL Editor.

## 5. Automatic SMS (reminders, motivation, promotions, warnings)
Add `CRON_SECRET` (any long random text) in Vercel env vars. `vercel.json` schedules
`/api/public/cron/sms` at 8AM, 1PM, 7PM and 10PM Kenya time.
