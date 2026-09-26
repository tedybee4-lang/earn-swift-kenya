-- ===== Migration 0007: Payment Approval, Notifications, and Enhanced Withdrawals =====
-- Adds payment approval request workflow, customer/admin notifications, registration tracking,
-- and enhanced withdrawal management with proper validation and SMS integration.

-- ===== ENUMS =====
CREATE TYPE public.notification_type AS ENUM (
  'registration',
  'payment_approval_requested',
  'payment_approved',
  'payment_rejected',
  'withdrawal_requested',
  'withdrawal_processing',
  'withdrawal_paid',
  'withdrawal_rejected',
  'referral_commission',
  'account_activated'
);

CREATE TYPE public.withdrawal_status AS ENUM (
  'pending',
  'processing',
  'paid',
  'rejected'
);

CREATE TYPE public.approval_request_status AS ENUM (
  'pending',
  'approved',
  'rejected',
  'expired'
);

-- ===== TABLES =====

-- Payment approval requests: created after successful payment, must be approved by admin within 3 hours
CREATE TABLE public.payment_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  stk_transaction_id uuid NOT NULL REFERENCES public.stk_transactions(id) ON DELETE CASCADE,
  phone text NOT NULL,
  amount numeric(10,2) NOT NULL,
  tier public.account_tier NOT NULL,
  payment_reference text NOT NULL,
  status public.approval_request_status NOT NULL DEFAULT 'pending',
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  rejection_reason text,
  expires_at timestamptz NOT NULL DEFAULT (now() + INTERVAL '3 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stk_transaction_id) -- Prevent duplicate approval requests for same payment
);
GRANT SELECT ON public.payment_approval_requests TO authenticated;
GRANT ALL ON public.payment_approval_requests TO service_role;
ALTER TABLE public.payment_approval_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own approval requests" ON public.payment_approval_requests FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "admin manage approval requests" ON public.payment_approval_requests FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_approval_requests_status_expires ON public.payment_approval_requests (status, expires_at);
CREATE INDEX idx_approval_requests_user ON public.payment_approval_requests (user_id);

-- Registration events: track new customer signups for admin notifications
CREATE TABLE public.registration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  referral_code text NOT NULL,
  referred_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  admin_notified boolean NOT NULL DEFAULT false,
  admin_notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.registration_events TO authenticated;
GRANT ALL ON public.registration_events TO service_role;
ALTER TABLE public.registration_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read registrations" ON public.registration_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_registrations_admin_notified ON public.registration_events (admin_notified);
CREATE INDEX idx_registrations_created_at ON public.registration_events (created_at DESC);

-- Customer notifications: in-app notifications for customers
CREATE TABLE public.customer_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type public.notification_type NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  related_id uuid, -- payment_approval_request_id, withdrawal_id, etc.
  read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.customer_notifications TO authenticated;
GRANT ALL ON public.customer_notifications TO service_role;
ALTER TABLE public.customer_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own notifications" ON public.customer_notifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE INDEX idx_customer_notifications_user ON public.customer_notifications (user_id);
CREATE INDEX idx_customer_notifications_read ON public.customer_notifications (user_id, read);
CREATE INDEX idx_customer_notifications_created_at ON public.customer_notifications (created_at DESC);

-- Admin notifications: in-app notifications for admins
CREATE TABLE public.admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type public.notification_type NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  related_id uuid, -- payment_approval_request_id, registration_event_id, withdrawal_id, etc.
  read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_notifications TO authenticated;
GRANT ALL ON public.admin_notifications TO service_role;
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read notifications" ON public.admin_notifications FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_admin_notifications_read ON public.admin_notifications (read);
CREATE INDEX idx_admin_notifications_created_at ON public.admin_notifications (created_at DESC);

-- Enhanced withdrawal requests with proper validation
-- REPLACES/EXTENDS the existing withdrawals table
ALTER TABLE public.withdrawals 
  ADD COLUMN IF NOT EXISTS status public.withdrawal_status DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS processed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS sms_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sms_status text,
  ADD COLUMN IF NOT EXISTS customer_notification_id uuid REFERENCES public.customer_notifications(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referral_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS request_metadata jsonb;

-- Create index if not exists
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON public.withdrawals (status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON public.withdrawals (user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_created_at ON public.withdrawals (created_at DESC);

-- Withdrawal reservations: track reserved balance to prevent duplicate withdrawals using same balance
CREATE TABLE public.withdrawal_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  withdrawal_id uuid NOT NULL REFERENCES public.withdrawals(id) ON DELETE CASCADE,
  reserved_amount numeric(10,2) NOT NULL,
  status text NOT NULL DEFAULT 'active', -- active, released, consumed
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (withdrawal_id)
);
GRANT SELECT ON public.withdrawal_reservations TO authenticated;
GRANT ALL ON public.withdrawal_reservations TO service_role;
ALTER TABLE public.withdrawal_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own reservations" ON public.withdrawal_reservations FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE INDEX idx_withdrawal_reservations_user_status ON public.withdrawal_reservations (user_id, status);

-- Referral qualification tracking: ensure withdrawal validation can check active referrals
CREATE TABLE IF NOT EXISTS public.referral_stats (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  total_referrals int NOT NULL DEFAULT 0,
  active_referrals int NOT NULL DEFAULT 0, -- status = 'active'
  pending_referrals int NOT NULL DEFAULT 0, -- status = 'pending'
  total_commissions_earned numeric(12,2) NOT NULL DEFAULT 0,
  last_updated timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.referral_stats TO authenticated;
GRANT ALL ON public.referral_stats TO service_role;
ALTER TABLE public.referral_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own referral stats" ON public.referral_stats FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ===== FUNCTIONS =====

-- Create registration event and trigger admin notification
CREATE OR REPLACE FUNCTION public.handle_user_registration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.profiles;
  reg_event public.registration_events;
BEGIN
  -- Get the profile that was just created by handle_new_user
  SELECT * INTO p FROM public.profiles WHERE id = NEW.id LIMIT 1;
  
  IF p.id IS NOT NULL THEN
    -- Insert registration event
    INSERT INTO public.registration_events (user_id, name, phone, email, referral_code, referred_by)
    VALUES (p.id, p.name, p.phone, p.email, p.referral_code, p.referred_by)
    RETURNING * INTO reg_event;
    
    -- Create admin notification
    INSERT INTO public.admin_notifications (type, title, message, related_id)
    VALUES (
      'registration'::public.notification_type,
      'New customer registration',
      'New customer registered: ' || p.name || ' (' || p.phone || ')',
      reg_event.id
    );
  END IF;
  
  RETURN NEW;
END $$;

-- Trigger for new user registration (added to existing trigger chain)
DROP TRIGGER IF EXISTS on_user_registration_event ON auth.users;
CREATE TRIGGER on_user_registration_event AFTER INSERT ON auth.users FOR EACH ROW 
  EXECUTE FUNCTION public.handle_user_registration();

-- Create payment approval request after successful STK transaction
-- Call this from mpesa-callback after payment succeeds and BEFORE auto-activation
CREATE OR REPLACE FUNCTION public.create_payment_approval_request(
  _user_id uuid,
  _stk_transaction_id uuid,
  _phone text,
  _amount numeric,
  _tier public.account_tier,
  _payment_reference text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  approval_id uuid;
  user_profile public.profiles;
  exists_check int;
BEGIN
  -- Verify STK transaction exists and belongs to user
  IF NOT EXISTS (
    SELECT 1 FROM public.stk_transactions 
    WHERE id = _stk_transaction_id AND user_id = _user_id
  ) THEN
    RAISE EXCEPTION 'Invalid STK transaction';
  END IF;
  
  -- Check if approval request already exists for this payment
  SELECT COUNT(*) INTO exists_check FROM public.payment_approval_requests
  WHERE stk_transaction_id = _stk_transaction_id;
  
  IF exists_check > 0 THEN
    RAISE EXCEPTION 'Approval request already exists for this payment';
  END IF;
  
  -- Get user profile for validation
  SELECT * INTO user_profile FROM public.profiles WHERE id = _user_id;
  
  IF user_profile.id IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  
  -- Create approval request
  INSERT INTO public.payment_approval_requests (
    user_id, stk_transaction_id, phone, amount, tier, payment_reference
  ) VALUES (_user_id, _stk_transaction_id, _phone, _amount, _tier, _payment_reference)
  RETURNING id INTO approval_id;
  
  -- Create customer notification
  INSERT INTO public.customer_notifications (user_id, type, title, message, related_id)
  VALUES (
    _user_id,
    'payment_approval_requested'::public.notification_type,
    'Approval requested',
    'Your payment has been received. Your account will be reviewed within 3 hours. You will receive an SMS when approved.',
    approval_id
  );
  
  -- Create admin notification
  INSERT INTO public.admin_notifications (type, title, message, related_id)
  VALUES (
    'payment_approval_requested'::public.notification_type,
    'Payment approval requested',
    user_profile.name || ' (' || _phone || ') has requested payment approval for KSh ' || _amount,
    approval_id
  );
  
  -- Log audit
  INSERT INTO public.admin_audit (actor, action, details)
  VALUES ('system', 'approval_request_created', jsonb_build_object(
    'user_id', _user_id,
    'amount', _amount,
    'tier', _tier,
    'phone', _phone
  ));
  
  RETURN approval_id;
END $$;

REVOKE ALL ON FUNCTION public.create_payment_approval_request(uuid, uuid, text, numeric, public.account_tier, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_payment_approval_request(uuid, uuid, text, numeric, public.account_tier, text) TO service_role;

-- Admin approves payment: activate account, credit referrer, send SMS
CREATE OR REPLACE FUNCTION public.admin_approve_payment(
  _approval_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  approval public.payment_approval_requests;
  stk_txn public.stk_transactions;
  user_profile public.profiles;
  result jsonb;
  c numeric;
  referrer public.profiles;
  notification_id uuid;
BEGIN
  -- Verify admin role
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  
  -- Get and lock approval request
  SELECT * INTO approval FROM public.payment_approval_requests
  WHERE id = _approval_id FOR UPDATE;
  
  IF approval.id IS NULL THEN
    RAISE EXCEPTION 'Approval request not found';
  END IF;
  
  IF approval.status != 'pending' THEN
    RAISE EXCEPTION 'Approval request is not pending: %', approval.status;
  END IF;
  
  -- Get STK transaction
  SELECT * INTO stk_txn FROM public.stk_transactions WHERE id = approval.stk_transaction_id;
  
  -- Get user profile and lock for update
  SELECT * INTO user_profile FROM public.profiles WHERE id = approval.user_id FOR UPDATE;
  
  -- Activate account
  UPDATE public.profiles 
  SET status = 'active', tier = approval.tier, activated_at = now()
  WHERE id = approval.user_id
  RETURNING * INTO user_profile;
  
  -- Update approval request
  UPDATE public.payment_approval_requests
  SET status = 'approved', approved_by = auth.uid(), approved_at = now()
  WHERE id = _approval_id;
  
  -- Process referral commission if referred
  IF user_profile.referred_by IS NOT NULL THEN
    c := CASE approval.tier 
         WHEN 'pro' THEN 250 
         WHEN 'standard' THEN 150 
         ELSE 80 
         END;
    
    INSERT INTO public.commissions (referrer_id, referred_id, amount)
    VALUES (user_profile.referred_by, user_profile.id, c)
    ON CONFLICT (referred_id) DO NOTHING;
    
    IF FOUND THEN
      UPDATE public.profiles SET balance = balance + c WHERE id = user_profile.referred_by
      RETURNING * INTO referrer;
    END IF;
  END IF;
  
  -- Update STK transaction status
  UPDATE public.stk_transactions SET status = 'success' WHERE id = approval.stk_transaction_id;
  
  -- Create customer notification
  INSERT INTO public.customer_notifications (user_id, type, title, message, related_id)
  VALUES (
    approval.user_id,
    'payment_approved'::public.notification_type,
    'Payment approved',
    'Your payment has been approved. Your account is now active.',
    _approval_id
  );
  
  -- Create admin notification
  INSERT INTO public.admin_notifications (type, title, message, related_id)
  VALUES (
    'payment_approved'::public.notification_type,
    'Payment approved',
    user_profile.name || ' (' || approval.phone || ') - KSh ' || approval.amount || ' approved',
    _approval_id
  );
  
  -- Log audit
  INSERT INTO public.admin_audit (actor, action, details)
  VALUES (auth.uid()::text, 'payment_approved', jsonb_build_object(
    'approval_id', _approval_id,
    'user_id', approval.user_id,
    'amount', approval.amount,
    'tier', approval.tier
  ));
  
  result := jsonb_build_object(
    'ok', true,
    'user_id', user_profile.id,
    'name', user_profile.name,
    'phone', user_profile.phone,
    'code', user_profile.referral_code,
    'tier', approval.tier,
    'amount', approval.amount
  );
  
  IF referrer.id IS NOT NULL THEN
    result := result || jsonb_build_object(
      'referrer_id', referrer.id,
      'referrer_name', referrer.name,
      'referrer_phone', referrer.phone,
      'referrer_code', referrer.referral_code,
      'commission', c
    );
  END IF;
  
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.admin_approve_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_approve_payment(uuid) TO authenticated, service_role;

-- Admin rejects payment approval
CREATE OR REPLACE FUNCTION public.admin_reject_payment(
  _approval_id uuid,
  _rejection_reason text DEFAULT 'Payment could not be verified'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  approval public.payment_approval_requests;
  user_profile public.profiles;
BEGIN
  -- Verify admin role
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  
  -- Get and lock approval request
  SELECT * INTO approval FROM public.payment_approval_requests
  WHERE id = _approval_id FOR UPDATE;
  
  IF approval.id IS NULL THEN
    RAISE EXCEPTION 'Approval request not found';
  END IF;
  
  IF approval.status != 'pending' THEN
    RAISE EXCEPTION 'Approval request is not pending: %', approval.status;
  END IF;
  
  -- Get user profile
  SELECT * INTO user_profile FROM public.profiles WHERE id = approval.user_id;
  
  -- Update approval request
  UPDATE public.payment_approval_requests
  SET status = 'rejected', rejection_reason = _rejection_reason, approved_by = auth.uid(), approved_at = now()
  WHERE id = _approval_id;
  
  -- Update STK transaction status
  UPDATE public.stk_transactions SET status = 'failed', failure_reason = _rejection_reason WHERE id = approval.stk_transaction_id;
  
  -- Create customer notification
  INSERT INTO public.customer_notifications (user_id, type, title, message, related_id)
  VALUES (
    approval.user_id,
    'payment_rejected'::public.notification_type,
    'Payment rejected',
    'Your payment could not be verified: ' || _rejection_reason || '. Please contact support.',
    _approval_id
  );
  
  -- Create admin notification
  INSERT INTO public.admin_notifications (type, title, message, related_id)
  VALUES (
    'payment_rejected'::public.notification_type,
    'Payment rejected',
    user_profile.name || ' (' || approval.phone || ') - KSh ' || approval.amount || ' rejected',
    _approval_id
  );
  
  -- Log audit
  INSERT INTO public.admin_audit (actor, action, details)
  VALUES (auth.uid()::text, 'payment_rejected', jsonb_build_object(
    'approval_id', _approval_id,
    'user_id', approval.user_id,
    'amount', approval.amount,
    'reason', _rejection_reason
  ));
END $$;

REVOKE ALL ON FUNCTION public.admin_reject_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reject_payment(uuid, text) TO authenticated, service_role;

-- Enhanced withdrawal request with full validation (server-side only)
CREATE OR REPLACE FUNCTION public.request_withdrawal_v2(
  _amount numeric,
  _phone text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.profiles;
  ref_stats public.referral_stats;
  wid uuid;
  active_referral_count int;
  pending_withdrawal_count int;
  available_balance numeric;
  notification_id uuid;
BEGIN
  -- Get and lock user profile
  SELECT * INTO p FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;
  
  -- Validation 1: Account must be active
  IF p.status != 'active' THEN
    RAISE EXCEPTION 'Account not active. Activate your account to withdraw.';
  END IF;
  
  -- Validation 2: Minimum withdrawal amount
  IF _amount < 650 THEN
    RAISE EXCEPTION 'Minimum withdrawal is KSh 650';
  END IF;
  
  -- Validation 3: Count active referrals (status = 'active')
  SELECT COUNT(*) INTO active_referral_count 
  FROM public.profiles 
  WHERE referred_by = p.id AND status = 'active';
  
  IF active_referral_count < 3 THEN
    RAISE EXCEPTION 'You need at least 3 active referrals to withdraw. Current: %', active_referral_count;
  END IF;
  
  -- Validation 4: Check for pending withdrawals
  SELECT COUNT(*) INTO pending_withdrawal_count
  FROM public.withdrawals
  WHERE user_id = p.id AND status IN ('pending', 'processing');
  
  IF pending_withdrawal_count > 0 THEN
    RAISE EXCEPTION 'You already have a pending withdrawal';
  END IF;
  
  -- Validation 5: Calculate available balance (actual balance minus reserved amounts)
  available_balance := p.balance - COALESCE(
    (SELECT SUM(reserved_amount) FROM public.withdrawal_reservations 
     WHERE user_id = p.id AND status = 'active'),
    0
  );
  
  IF _amount > available_balance THEN
    RAISE EXCEPTION 'Insufficient balance. Available: KSh %', available_balance;
  END IF;
  
  -- All validations passed - create withdrawal
  INSERT INTO public.withdrawals (
    user_id, amount, phone, status, referral_count, request_metadata
  ) VALUES (
    p.id,
    _amount,
    COALESCE(NULLIF(_phone, ''), p.phone),
    'pending'::public.withdrawal_status,
    active_referral_count,
    jsonb_build_object('validation_timestamp', now(), 'referral_count_at_request', active_referral_count)
  ) RETURNING id INTO wid;
  
  -- Create withdrawal reservation to prevent duplicate withdrawals
  INSERT INTO public.withdrawal_reservations (user_id, withdrawal_id, reserved_amount)
  VALUES (p.id, wid, _amount);
  
  -- Deduct from balance
  UPDATE public.profiles SET balance = balance - _amount WHERE id = p.id;
  
  -- Create customer notification
  INSERT INTO public.customer_notifications (user_id, type, title, message, related_id)
  VALUES (
    p.id,
    'withdrawal_requested'::public.notification_type,
    'Withdrawal requested',
    'Your withdrawal request of KSh ' || _amount || ' has been submitted and is awaiting processing.',
    wid
  ) RETURNING id INTO notification_id;
  
  UPDATE public.withdrawals SET customer_notification_id = notification_id WHERE id = wid;
  
  -- Create admin notification
  INSERT INTO public.admin_notifications (type, title, message, related_id)
  VALUES (
    'withdrawal_requested'::public.notification_type,
    'Withdrawal request',
    p.name || ' (' || COALESCE(_phone, p.phone) || ') - KSh ' || _amount || ' withdrawal',
    wid
  );
  
  -- Log audit
  INSERT INTO public.admin_audit (actor, action, details)
  VALUES ('customer', 'withdrawal_requested', jsonb_build_object(
    'user_id', p.id,
    'withdrawal_id', wid,
    'amount', _amount,
    'referrals', active_referral_count,
    'balance_remaining', p.balance - _amount
  ));
  
  RETURN wid;
END $$;

REVOKE EXECUTE ON FUNCTION public.request_withdrawal_v2(numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_withdrawal_v2(numeric, text) TO authenticated;

-- Admin processes withdrawal (approve/pay or reject)
CREATE OR REPLACE FUNCTION public.admin_process_withdrawal_v2(
  _id uuid,
  _action text, -- 'approve', 'reject', 'pay'
  _reason text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w public.withdrawals;
  p public.profiles;
  res public.withdrawal_reservations;
  new_status public.withdrawal_status;
  notification_id uuid;
BEGIN
  -- Verify admin role
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  
  IF _action NOT IN ('approve', 'reject', 'pay') THEN
    RAISE EXCEPTION 'Invalid action: %', _action;
  END IF;
  
  -- Get and lock withdrawal
  SELECT * INTO w FROM public.withdrawals WHERE id = _id FOR UPDATE;
  
  IF w.id IS NULL THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;
  
  IF w.status != 'pending' THEN
    RAISE EXCEPTION 'Withdrawal not pending: %', w.status;
  END IF;
  
  -- Get user profile
  SELECT * INTO p FROM public.profiles WHERE id = w.user_id FOR UPDATE;
  
  -- Get reservation
  SELECT * INTO res FROM public.withdrawal_reservations WHERE withdrawal_id = _id FOR UPDATE;
  
  IF _action = 'approve' THEN
    new_status := 'processing'::public.withdrawal_status;
  ELSIF _action = 'reject' THEN
    new_status := 'rejected'::public.withdrawal_status;
    -- Refund balance and release reservation
    UPDATE public.profiles SET balance = balance + w.amount WHERE id = w.user_id;
    UPDATE public.withdrawal_reservations SET status = 'released' WHERE withdrawal_id = _id;
  ELSIF _action = 'pay' THEN
    new_status := 'paid'::public.withdrawal_status;
    -- Mark reservation as consumed
    UPDATE public.withdrawal_reservations SET status = 'consumed' WHERE withdrawal_id = _id;
  END IF;
  
  -- Update withdrawal
  UPDATE public.withdrawals
  SET status = new_status, processed_by = auth.uid(), processed_at = now(), rejection_reason = _reason
  WHERE id = _id;
  
  -- Create customer notification
  INSERT INTO public.customer_notifications (user_id, type, title, message, related_id)
  VALUES (
    w.user_id,
    CASE new_status
      WHEN 'processing' THEN 'withdrawal_processing'::public.notification_type
      WHEN 'paid' THEN 'withdrawal_paid'::public.notification_type
      WHEN 'rejected' THEN 'withdrawal_rejected'::public.notification_type
      ELSE 'withdrawal_requested'::public.notification_type
    END,
    CASE new_status
      WHEN 'processing' THEN 'Withdrawal processing'
      WHEN 'paid' THEN 'Withdrawal paid'
      WHEN 'rejected' THEN 'Withdrawal rejected'
      ELSE 'Withdrawal updated'
    END,
    CASE new_status
      WHEN 'processing' THEN 'Your withdrawal of KSh ' || w.amount || ' is being processed.'
      WHEN 'paid' THEN 'Your withdrawal of KSh ' || w.amount || ' has been paid to ' || w.phone || '.'
      WHEN 'rejected' THEN 'Your withdrawal of KSh ' || w.amount || ' has been rejected. Reason: ' || COALESCE(_reason, 'Not specified')
      ELSE 'Your withdrawal has been updated.'
    END,
    _id
  ) RETURNING id INTO notification_id;
  
  UPDATE public.withdrawals SET customer_notification_id = notification_id WHERE id = _id;
  
  -- Log audit
  INSERT INTO public.admin_audit (actor, action, details)
  VALUES (auth.uid()::text, 'withdrawal_' || _action, jsonb_build_object(
    'withdrawal_id', _id,
    'user_id', w.user_id,
    'amount', w.amount,
    'reason', _reason
  ));
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_process_withdrawal_v2(uuid, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_process_withdrawal_v2(uuid, text, text) TO service_role;

-- Update referral stats for withdrawal eligibility checks
CREATE OR REPLACE FUNCTION public.update_referral_stats(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  active_cnt int;
  total_cnt int;
  commission_total numeric;
BEGIN
  SELECT COUNT(*) INTO active_cnt FROM public.profiles WHERE referred_by = _user_id AND status = 'active';
  SELECT COUNT(*) INTO total_cnt FROM public.profiles WHERE referred_by = _user_id;
  SELECT COALESCE(SUM(amount), 0) INTO commission_total FROM public.commissions WHERE referrer_id = _user_id;
  
  INSERT INTO public.referral_stats (user_id, active_referrals, total_referrals, total_commissions_earned, last_updated)
  VALUES (_user_id, active_cnt, total_cnt, commission_total, now())
  ON CONFLICT (user_id) DO UPDATE SET
    active_referrals = EXCLUDED.active_referrals,
    total_referrals = EXCLUDED.total_referrals,
    total_commissions_earned = EXCLUDED.total_commissions_earned,
    last_updated = now();
END $$;

REVOKE EXECUTE ON FUNCTION public.update_referral_stats(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_referral_stats(uuid) TO service_role;

-- Helper: Get withdrawal eligibility status for customer dashboard
CREATE OR REPLACE FUNCTION public.get_withdrawal_eligibility()
RETURNS TABLE(
  eligible boolean,
  reason text,
  balance numeric,
  active_referrals int,
  available_to_withdraw numeric
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (p.balance >= 650 AND ref_count >= 3) as eligible,
    CASE
      WHEN p.status != 'active' THEN 'Account not active'
      WHEN p.balance < 650 THEN 'Balance below minimum (KSh 650)'
      WHEN ref_count < 3 THEN 'Need ' || (3 - ref_count) || ' more active referral(s)'
      ELSE 'Eligible to withdraw'
    END as reason,
    p.balance,
    ref_count,
    (p.balance - COALESCE((SELECT SUM(reserved_amount) FROM public.withdrawal_reservations WHERE user_id = auth.uid() AND status = 'active'), 0)) as available_to_withdraw
  FROM public.profiles p
  LEFT JOIN (
    SELECT referred_by, COUNT(*) as ref_count
    FROM public.profiles
    WHERE status = 'active'
    GROUP BY referred_by
  ) refs ON refs.referred_by = p.id
  WHERE p.id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION public.get_withdrawal_eligibility() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_withdrawal_eligibility() TO authenticated;

-- ===== RLS ENHANCEMENTS =====

-- Update existing withdrawal policies for enhanced table
DROP POLICY IF EXISTS "own or admin withdrawals" ON public.withdrawals;
CREATE POLICY "own or admin withdrawals" ON public.withdrawals FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admin update withdrawals" ON public.withdrawals FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ===== TRIGGERS & CRON JOBS =====

-- Trigger to auto-expire approval requests after 3 hours
CREATE OR REPLACE FUNCTION public.expire_pending_approvals()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.payment_approval_requests
  SET status = 'expired'::public.approval_request_status
  WHERE status = 'pending' AND expires_at < now();
END $$;

-- Can be called from cron job or on-demand
REVOKE EXECUTE ON FUNCTION public.expire_pending_approvals() FROM anon;
GRANT EXECUTE ON FUNCTION public.expire_pending_approvals() TO service_role;

-- ===== POLICY GRANTS =====
GRANT SELECT ON public.payment_approval_requests TO authenticated;
GRANT SELECT ON public.customer_notifications TO authenticated;
GRANT SELECT ON public.admin_notifications TO authenticated;
GRANT SELECT ON public.registration_events TO authenticated;
GRANT SELECT ON public.referral_stats TO authenticated;

-- ===== SEED DATA / DEFAULTS =====
-- Insert default app settings if needed
INSERT INTO public.app_settings (key, value) VALUES ('withdrawal_min_amount', '650')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings (key, value) VALUES ('withdrawal_min_referrals', '3')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings (key, value) VALUES ('payment_approval_timeout_hours', '3')
ON CONFLICT (key) DO NOTHING;

-- ===== MIGRATION NOTES =====
-- This migration adds:
-- 1. Payment approval workflow (request → admin review → approve/reject)
-- 2. Customer and admin in-app notifications
-- 3. Registration event tracking with admin SMS notifications
-- 4. Enhanced withdrawal system with full server-side validation:
--    - Minimum KSh 650
--    - Minimum 3 active referrals
--    - Withdrawal reservations to prevent duplicate submissions
--    - Rejection reason tracking
--    - SMS status tracking
-- 5. Referral stats table for quick withdrawal eligibility checks
--
-- To integrate with mpesa-callback:
-- - After STK success, call create_payment_approval_request() instead of activate_stk()
-- - SMS notifications for approval requested/approved are handled via separate Edge Function
-- - Admin must use admin_approve_payment() or admin_reject_payment() functions
--
-- To integrate with frontend:
-- - Use request_withdrawal_v2() for new withdrawal requests (all validation is server-side)
-- - Call get_withdrawal_eligibility() to show dashboard eligibility status
-- - Poll customer_notifications and admin_notifications for in-app updates
-- - Use admin_process_withdrawal_v2() for admin withdrawal management
