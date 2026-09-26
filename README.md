# Smart Earn Kenya

Build production-ready SMART EARN, a Kenyan task/affiliate earning platform.

STACK: Next.js 14 App Router + TypeScript + Tailwind/shadcn; Supabase Postgres/Auth/Edge Functions/Deno/Cron(pg_cron); deploy Vercel + Netlify. Mobile-first (95% Android), KSh currency.

BRAND: SmartEarn — “Earn Smart. Withdraw Fast.” M-Pesa Till 5441898; SMS iSpLedger/TopSpeed. Phone-only login; email optional recovery. Admin: brian / 1234567891, hidden /panel-x7k9, separate 2-hour session + IP checks.

DB: users(id,name,phone,email,referral_code,referred_by,balance,tier,status,mpesa_code,streak,last_login,last_task,device_id,signup_ip,fraud_score,milestone_sms,created_at); tasks; task_completions; payments; commissions; withdrawals; activities; sms_logs; admin_audit; leaderboard. Use RLS: users/tasks/task-completions self access, activities public, other tables service-role only.

FUNCTIONS: send-sms, register-user, submit-payment, verify-payment, complete-task, request-withdrawal, approve-task, mark-withdrawal-paid, mpesa-webhook, admin-login. SMS normalizes 07/+254→2547, logs messages. M-Pesa webhook verifies/activates users and credits referrals.

TASKS: Video 2/4/8; WhatsApp 10/20/40; social 7/14/28; survey 15/30/60; app 30/60/120; referral 80/150/250 (Starter/Standard/Pro). Login 2; streak 7d=50,30d=300; spin 5–500. Pre-payment: videos15+survey10+share10+profile10=KSh45.

WITHDRAW: balance≥650 + ≥3 ACTIVE referrals + active account; fee 5% (min30), 24–72h. Anti-fraud: unique phone/IP/device, fraud≥100 suspend, 7-day hold.

PAGES: public home/how/pricing/register/login/trust/contact/about/terms/privacy/refund; dashboard/tasks/referrals/withdraw/confirm-payment/profile; admin payments/tasks/users/withdrawals/SMS/audit.

HOME: trust-first fintech design, live earnings, tasks, KSh45 bonus, testimonials, payout wall, counter, leaderboard, FAQ, CTA. Inter; green #0B6E4F/gold #F4B400; no scammy MLM style.

CRON: hourly reminders; 8AM greeting; midnight reset/streaks; Monday leaderboard. Deliver schema+RLS, 10 functions, cron, complete frontend, admin, SMS/M-Pesa, legal pages, .env.example, README, deployment configs. Prioritize auth, tasks, withdrawals, admin verification, SMS, trust design. START BUILDING.REDESIGN AND CORRECT THE SMART EARN PUBLIC LANDING PAGE.

This is the public homepage of a real online earning platform, NOT an advertisement page. Make it look like a modern, premium fintech/task platform similar to a professional mobile app. It must be mobile-first, fast, clean, trustworthy and visually impressive.

IMPORTANT: REMOVE the large green advertising-style hero, excessive green branding, fake-looking promotional claims, and the M-Pesa Till number from the top of the homepage. NEVER place payment/Till details in the hero or header. Payment instructions should only appear inside the appropriate Payment/Activation section and clearly identify the official payment method.

COLOUR SYSTEM:

Use a completely different visual identity from the current green design:

- Deep navy: #07152F

- Royal blue: #2563EB

- Electric blue: #38BDF8

- Purple: #7C3AED

- Violet: #A855F7

- White: #FFFFFF

- Soft background: #F5F7FB

Use blue/purple gradients for primary buttons and important highlights. Green should only be used for success/status indicators, not as the main brand colour.

PUBLIC HOMEPAGE STRUCTURE:

1. Clean SmartEarn logo/header with Login and Create Account buttons plus a menu.

2. Premium hero section:

   “Turn Your Time Into Real Earnings”

   Explain briefly that SmartEarn connects users with available online tasks and earning opportunities.

   Buttons: “Create Free Account” and “Explore Tasks”.

   Use a modern phone/app illustration rather than an advertising photo.

3. LIVE TASKS section prominently visible near the top:

   Display real tasks dynamically from the database, not hard-coded fake tasks.

   Each task card should show task name, category, reward, estimated completion time, remaining availability and Start/View button.

   Add “Live”, “Available Now” and refresh indicators where appropriate.

4. EARNING CATEGORIES:

   Surveys, Videos, App Tasks, Social Media, Data Entry, Gaming, Referrals, Shopping, Content Creation, Research, Promotional Tasks and other configured task types.

5. HOW IT WORKS:

   Create account → Choose task → Complete task → Verification → Earnings → Withdraw.

6. TRUST & PLATFORM FEATURES:

   Secure account, transparent rewards, task verification, withdrawal options, support and activity/status information.

7. Payment/withdrawal information should be presented professionally in its own section, NOT at the top.

8. FAQ section.

9. Final Create Account CTA.

10. Professional footer containing About, Terms, Privacy, Refund/Payout Policy, Help/Contact and other legal links.

Do NOT invent payout totals, user numbers, testimonials, “verified” claims or other statistics. If these values are not actually available from the database, don't display them.

AUTHENTICATION:

Use one customer/admin login entry point. Customers log in normally with their registered phone number and password. Admins use a separate authorized admin login number and password through the same login interface. Authentication MUST be role-based on the backend:

- CUSTOMER → customer dashboard only.

- ADMIN → admin dashboard only.

Never expose or redirect admin users to the customer dashboard.

Do not hard-code admin credentials in frontend code.

ADMIN DASHBOARD:

Create a separate secure admin dashboard with task management, users, earnings, withdrawals, transactions, referrals, platform statistics, notifications and system settings.

Add an “SMS SERVICE TEST” section in the admin dashboard where an authorized admin can enter/select a test phone number, send a test SMS, see Sending/Sent/Failed status, provider response/error, timestamp and delivery result when available. Keep SMS credentials/API keys server-side and never expose them in the frontend.

Make the entire design responsive, polished, consistent and production-ready.Build the complete SmartEarn SMS messaging system using Supabase Edge Functions + pg_cron + iSpLedger API. The iSpLedger test server accepts the API key, but automatic user SMS currently returns “wrong API key”; use the exact same verified API configuration/server credentials for automated sending and keep the API key server-side only.

GATEWAY

Provider: iSpLedger

GET https://sms.ispledger.com/sms/send

Params: api=TOKEN&SenderId=TOPSPEED&msg=TEXT&phone=2547XXXXXXXX

Sender ID: TOPSPEED (or SMARTERN if registered)

Normalize: 0712345678→254712345678; +254712345678→254712345678; 712345678→254712345678.

All SMS must end with “Reply STOP to unsubscribe”.

Log every SMS in sms_logs: id, phone, message, response, http_code, sent_at, trigger_type.

Support delivery/error logging and prevent duplicate scheduled messages.

AUTOMATED SMS TRIGGERS

1. WELCOME/ONBOARDING

1.1 Immediately after signup: “🎉 Welcome {name}! Your KSh 45 FREE bonus is ready. Login → smartearn.co.ke/login (use your phone number). Reply STOP to unsubscribe”

1.2 +1h if onboarding tasks incomplete: “⏰ {name}, don't lose your KSh 45! Complete 4 quick tasks in 5 minutes → smartearn.co.ke/dashboard”

1.3 +6h if status=pending: “💰 {name}, your KSh 45 is waiting! Activate for KSh 200 to unlock KSh 650+ weekly. Pay → Till 5441898. Reply STOP to unsubscribe”

1.4 +24h if pending: “🔥 847 Kenyans joined this week! Don't miss out. Activate KSh 200 → Till 5441898. Login → smartearn.co.ke”

1.5 +48h if pending: “💪 {name}, Mary just earned KSh 320 today! You could too. Activate KSh 200 → Till 5441898. Reply STOP to unsubscribe”

1.6 +72h if pending: “⚠️ LAST CHANCE: {name}, your bonus tasks expire tomorrow! Activate KSh 200 → Till 5441898”

1.7 +96h if pending: “🚀 {name}, join thousands of Kenyans earning daily. Activate now → Till 5441898. Reply STOP to unsubscribe”

1.8 +7d if pending: “😢 We miss you {name}! Activate anytime. Till 5441898 → smartearn.co.ke”

2. PAYMENT

2.1 Immediately when M-Pesa code submitted: “📥 {name}, we received your payment code {mpesa_code}. Verification in progress (max 30 min). We'll SMS you once active. Reply STOP to unsubscribe”

2.2 +30m if payment still pending: “⏳ {name}, your payment is being verified. Please wait a few more minutes. We'll SMS you soon!”

2.3 +2h if still pending: “🔍 {name}, verification taking longer than usual. Our team is on it. You'll be active shortly! Support: WhatsApp +254 XXX XXX XXX”

3. ACTIVATION

3.1 Immediately when admin verifies payment/status→active: “✅ ACTIVE! Welcome {name} to SmartEarn! Your referral link: smartearn.co.ke/ref/{code} Start earning now → smartearn.co.ke/dashboard Reply STOP to unsubscribe”

3.2 Immediately when referred user activates: “💰 {name}, you earned KSh {commission} from {referred_name}! Keep sharing → smartearn.co.ke/ref/{your_code} Reply STOP to unsubscribe”

3.3 +1h after activation if no task: “🎬 {name}, you're ACTIVE! Complete your first task now → KSh 4 waiting. Login → smartearn.co.ke/dashboard”

3.4 +24h active with no completed task: “⚠️ {name}, you haven't earned today! 12 new tasks waiting → smartearn.co.ke/dashboard”

4. DAILY ENGAGEMENT

4.1 8:00 AM daily, active users: “☀️ Good morning {name}! {X} new tasks waiting today. Log in → smartearn.co.ke/dashboard Reply STOP to unsubscribe”

4.2 1:00 PM, active user with zero tasks today: “⚡ {name}, you've earned KSh 0 today. Don't miss out! 12 tasks waiting → smartearn.co.ke/dashboard”

4.3 7:00 PM, active user below daily goal: “🌙 {name}, {X} hours left today! Earn more before midnight → smartearn.co.ke/dashboard”

4.4 Sunday 8:00 PM, active users: “⏰ {name}, weekly reset in 4 hours! Complete today's tasks or lose today's bonus. → smartearn.co.ke”

5. TASKS

5.1 Immediately after task completion: “✅ Task done! You earned KSh {reward}. Balance: KSh {balance}. Keep going → smartearn.co.ke/dashboard”

5.2 Immediately after proof-task approval: “✅ {name}, your task was approved! KSh {reward} added. Balance: KSh {balance}”

5.3 Immediately after rejection: “❌ {name}, your task was rejected. Reason: {reason}. Please follow instructions → smartearn.co.ke/dashboard”

5.4 First task of day: “🎉 First task done! +KSh 5 bonus. Keep earning today → smartearn.co.ke/dashboard”

5.5 Daily task limit reached: “🏆 {name}, you completed ALL daily tasks! +KSh 40 bonus. Come back tomorrow → smartearn.co.ke”

6. BALANCE MILESTONES (send only first time each threshold)

6.1 ≥KSh100: “🎊 {name}, first KSh 100 earned! Keep going — KSh 500 unlocks withdrawal. → smartearn.co.ke/dashboard”

6.2 ≥KSh300: “💪 KSh 300! Just KSh 350 more to withdrawal. Keep earning → smartearn.co.ke/dashboard”

6.3 ≥KSh550: “🔥 {name}, only KSh 100 to withdrawal! You're so close. Log in now → smartearn.co.ke/dashboard”

6.4 ≥KSh640: “⚡ KSh 10 more and you can WITHDRAW! 1 quick task → done. Go! → smartearn.co.ke/dashboard”

6.5 ≥KSh650 and active_refs<3: “🎯 {name}, you have KSh {balance}! Just need {needed} more referrals to withdraw. Share → smartearn.co.ke/ref/{code}”

7. REFERRALS

7.1 New referral registers: “👥 {name}, someone just registered using your link! They'll earn you KSh 80-250 once they activate. Keep sharing → smartearn.co.ke/ref/{code}”

7.2 Exactly 1 active referral: “👥 1/3 referrals! Just 2 more friends to unlock withdrawal. Share → smartearn.co.ke/ref/{code}”

7.3 Exactly 2 active referrals: “🚀 2/3! ONE more friend and your KSh {balance} is ready to withdraw. Send your link now → smartearn.co.ke/ref/{code}”

7.4 ≥3 active referrals + balance≥650: “🎉 UNLOCKED! {name}, you can withdraw KSh {balance} now! Request → smartearn.co.ke/dashboard/withdraw”

7.5 Referral pending payment for 24h+: “⏳ {name}, {referred_name} registered but hasn't paid yet. Remind them → Till 5441898. Once they pay, you get KSh {commission}!”

7.6 Monday 9:00 AM, users with referrals: “📊 {name}, this week you got {count} new referrals and earned KSh {amount}! Keep going → smartearn.co.ke”

8. STREAKS

8.1 Day 3: “🔥 3-day streak {name}! You're on fire. Keep it up → smartearn.co.ke/dashboard”

8.2 Day 7: “🏆 7-day streak! +KSh 50 bonus added. You're a champion! Keep going → smartearn.co.ke/dashboard”

8.3 Day 30: “👑 30-day streak! +KSh 300 bonus! You're a legend! → smartearn.co.ke/dashboard”

8.4 10:00 PM daily if user had a streak but no task today: “⚠️ {name}, don't break your {n}-day streak! Complete 1 task to keep it → smartearn.co.ke/dashboard”

8.5 After streak is lost: “😢 Your {n}-day streak ended. Start fresh today — you can do it! → smartearn.co.ke/dashboard”

9. UPGRADES

9.1 7 days after Starter activation if still Starter: “📈 {name}, you earned KSh {amount} this week! Upgrade to Standard → earn 2x per task. Pay KSh 150 more → Till 5441898”

9.2 14 days after activation if still Starter/Standard: “💰 {name}, upgrade to Pro (KSh 550) → earn 4x per task + KSh 250 per referral! Pay difference → Till 5441898”

SYSTEM REQUIREMENTS

- Use database-driven triggers; never rely on frontend timers.

- pg_cron checks scheduled triggers automatically.

- Edge Functions handle SMS sending.

- Use the verified iSpLedger API key/configuration that works on the test server; investigate why the automatic environment reports “wrong API key” and ensure production/Edge Function secrets contain the correct key without exposing it.

- Add retry handling for temporary failures, but prevent duplicate SMS.

- Respect STOP/unsubscribe status and never send marketing/engagement SMS to opted-out users.

- Add admin SMS testing: admin can enter a test number/message, send through the exact production Edge Function, and see API response, HTTP code, success/failure and timestamp.

- Add SMS provider status/error logs to the admin dashboard.ADDON: AUTOMATED M-PESA STK PUSH FOR SMARTEARN

This payment integration uses automated PayHero STK Push. A provider-verified payment creates an admin approval request; account activation and referral commissions happen only after an admin approves it. Keep all existing SmartEarn features.

PAYMENT GATEWAY
Provider: PayHero
Endpoint: https://backend.payhero.co.ke/api/v2/payments
POST, JSON, Basic PAYHERO_AUTH_TOKEN. Set PAYHERO_CHANNEL_ID to the registered M-Pesa channel.
Use amount, phone_number, channel_id, provider: "m-pesa", external_reference, customer_name and callback_url. Store the response including the gateway reference and checkout ID. Never expose the token.

CALLBACK:
https://YOUR-DOMAIN/api/public/mpesa-callback

PAYMENT FLOW
User selects Starter=KSh200, Standard=KSh350, Pro=KSh550. Phone is prefilled and normalized. The server sends the PayHero STK request; the user enters their PIN; the callback is cross-checked against PayHero's authenticated transaction-status API and matched against reference, amount, phone and M-Pesa receipt. A payment approval request is then created for admin review. Only admin approval activates the account and credits any referral commission.

DATABASE
Add to payments:
gateway, checkout_request_id, transaction_id, callback_payload, failure_reason, phone, tier and status. Status must be initiated/pending/success/failed/cancelled.

Create stk_transactions:
id uuid PK, user_id FK users, phone, amount, tier, unique ref, checkout_request_id, transaction_id, status, request_payload, response_payload, callback_payload, created_at, updated_at.
Index ref, checkout_request_id and status.

initiate-stk-push
File: src/lib/payments.functions.ts

Authenticate the user and reject active accounts. Map tier to amount. Generate:
SMARTERN-{userId.slice(0,8)}-{Date.now()}
Validate phone. Save the transaction as initiated. Call PayHero with phone_number, amount, channel_id, provider, external_reference and callback_url. Save the request, response and gateway IDs. Return {success:true,ref}. Send:
"📲 {name}, we've sent an M-Pesa prompt to {phone}. Enter your PIN to activate. Ref: {ref}"
On gateway failure mark failed. Prevent duplicate attempts and limit repeated prompts to the same phone.

mpesa-callback
File: src/routes/api/public/mpesa-callback.ts

Receive the PayHero callback. Parse response fields including CheckoutRequestID, ExternalReference, ResultCode, Amount, MpesaReceiptNumber and Phone. Locate by checkout/reference; validate reference, transaction ID, phone and exact amount. Confirm success with PayHero's authenticated transaction-status API and store the full callback.

If ResultCode=0:

Create a payment approval request. Admin reviews the request in the Payments tab. Approval activates the user and processes the referral commission; activation and referrer SMS messages are sent after approval.

If failed/cancelled, update status and send the appropriate failure/cancellation SMS.

Make callback processing idempotent: duplicate callbacks must never create multiple approval requests or activate/credit twice. Reject unknown or mismatched transactions. Return a retryable error if PayHero status verification or database processing is unavailable.

/dashboard/activate
Mobile-first page:
ACTIVATE YOUR ACCOUNT
Balance and activation message.
Starter KSh200 → 1x
Standard KSh350 → 2x
Pro KSh550 → 4x
M-Pesa Number [prefilled]
[ PAY KSH {amount} → M-PESA ]

After click: "Sending STK Push..." Poll check-payment-status every 3 seconds. Verified payment → show that the activation request is under review, then return to /dashboard. Failure → retry. After 2 minutes show "Did you receive the prompt?" Prevent duplicate requests.

check-payment-status
File: supabase/functions/check-payment-status/index.ts
Input {ref}. Return status,tier,transaction_id,message. If still initiated after 5 minutes mark failed. Polling is only fallback; verified webhook is primary.

SUPABASE SECRETS
PAYHERO_AUTH_TOKEN
PAYHERO_CHANNEL_ID
PAYHERO_STK_ENDPOINT=https://backend.payhero.co.ke/api/v2/payments
PAYHERO_CALLBACK_URL=https://YOUR-DOMAIN/api/public/mpesa-callback
SMS_API_TOKEN
SMS_SENDER_ID=TOPSPEED
SMS_ENDPOINT=https://sms.ispledger.com/sms/send

SMS
T1 immediate: STK prompt sent + PIN instruction + ref.
T2 +2 min: prompt not completed + retry link.
T3 success: payment received, ACTIVE + referral link.
T4 commission: referrer earned commission.
T5 failed: payment failed + reason + retry.
T6 cancelled: cancelled/no deduction + retry.
T7 +30 min inactive: activation reminder.
Keep messages concise.

ADMIN
Route /panel-x7k9/stk-transactions.
Table: User, Phone, Amount, Tier, Ref, Status, Time, Actions.
Filters: status/date/tier.
Actions: callback JSON, retry STK, manual success override, CSV export.
Stats: pushes today, success rate, revenue today, failures.

MANUAL FALLBACK
Keep /dashboard/activate/manual with Till 5441898:
M-Pesa → Lipa na M-Pesa → Buy Goods → Till 5441898 → amount → PIN → submit confirmation code.
Existing admin verification remains ONLY for manual fallback.

SECURITY/COST
Never expose gateway secrets. Validate phone, amount, tier, reference and transaction identity. Log every request, response, callback and result. Maximum 3 user attempts/day plus gateway limits. Never activate failed/cancelled/mismatched/unverified payments. Use atomic database operations for activation and commissions.

BUILD ORDER
Database → initiate-stk-push → callback → status check → secrets → callback registration → activation UI → SMS → admin page → manual fallback → small-value real test → production.

TEST
Test successful payment, approval request, admin approval/activation, user and referrer SMS, rejection, cancellation, failure, duplicate callback, invalid callback, wrong amount, unknown ref, idempotency, polling fallback, manual mode, admin visibility, CSV and retry limits.

IMPORTANT
Verify the live PayHero API and complete a low-value end-to-end test before production. The callback is checked against PayHero's transaction-status endpoint before a payment is recorded.

Do not remove existing SmartEarn authentication, dashboard, earnings, referrals or other functionality. STK Push is the primary automated activation method; Till 5441898 remains the backup.

START BUILDING NOW.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://earn-swift-kenya.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/7135d1a6-507a-47ce-b4c8-2f404af01cf0).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
