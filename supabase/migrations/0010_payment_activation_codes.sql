CREATE TABLE public.payment_activation_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  stk_transaction_id uuid NOT NULL UNIQUE REFERENCES public.stk_transactions(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  resend_count smallint NOT NULL DEFAULT 0 CHECK (resend_count BETWEEN 0 AND 3),
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_activation_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_activation_codes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.payment_activation_codes TO service_role;
CREATE INDEX idx_payment_activation_codes_user ON public.payment_activation_codes (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.refresh_payment_activation_code(
  _user_id uuid,
  _ref text,
  _code_hash text,
  _expires_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  payment_row public.stk_transactions;
  code_row public.payment_activation_codes;
BEGIN
  SELECT * INTO payment_row FROM public.stk_transactions
  WHERE ref = _ref AND user_id = _user_id FOR UPDATE;
  IF payment_row.id IS NULL OR payment_row.status <> 'success' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'payment_not_confirmed');
  END IF;

  SELECT * INTO code_row FROM public.payment_activation_codes
  WHERE stk_transaction_id = payment_row.id FOR UPDATE;
  IF code_row.id IS NULL THEN
    INSERT INTO public.payment_activation_codes (user_id, stk_transaction_id, code_hash, expires_at)
    VALUES (_user_id, payment_row.id, _code_hash, _expires_at)
    RETURNING * INTO code_row;
    RETURN jsonb_build_object('ok', true, 'resend_count', code_row.resend_count);
  END IF;
  IF code_row.verified_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_activated');
  END IF;
  IF code_row.resend_count >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'resend_limit');
  END IF;
  IF code_row.last_sent_at > now() - interval '30 seconds' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'wait_before_resend');
  END IF;

  UPDATE public.payment_activation_codes
  SET code_hash = _code_hash, expires_at = _expires_at, attempts = 0,
      resend_count = resend_count + 1, last_sent_at = now(), created_at = now()
  WHERE id = code_row.id
  RETURNING * INTO code_row;
  RETURN jsonb_build_object('ok', true, 'resend_count', code_row.resend_count);
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_payment_activation_code(uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_payment_activation_code(uuid, text, text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.activate_payment_with_code(_ref text, _code_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  payment_row public.stk_transactions;
  code_row public.payment_activation_codes;
  profile_row public.profiles;
  referrer_row public.profiles;
  commission_amount numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;

  SELECT * INTO payment_row FROM public.stk_transactions
  WHERE ref = _ref AND user_id = auth.uid() FOR UPDATE;
  IF payment_row.id IS NULL OR payment_row.status <> 'success' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'payment_not_confirmed');
  END IF;
  SELECT * INTO code_row FROM public.payment_activation_codes
  WHERE stk_transaction_id = payment_row.id FOR UPDATE;
  IF code_row.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'code_not_found'); END IF;
  IF code_row.verified_at IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'duplicate', true); END IF;
  IF code_row.attempts >= 5 THEN RETURN jsonb_build_object('ok', false, 'reason', 'too_many_attempts'); END IF;
  IF code_row.expires_at <= now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'code_expired'); END IF;

  IF code_row.code_hash IS DISTINCT FROM _code_hash THEN
    UPDATE public.payment_activation_codes SET attempts = attempts + 1 WHERE id = code_row.id RETURNING * INTO code_row;
    IF code_row.attempts >= 5 THEN RETURN jsonb_build_object('ok', false, 'reason', 'too_many_attempts'); END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code', 'attempts_remaining', 5 - code_row.attempts);
  END IF;

  SELECT * INTO profile_row FROM public.profiles WHERE id = payment_row.user_id FOR UPDATE;
  IF profile_row.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'user_not_found'); END IF;
  IF profile_row.status = 'suspended' THEN RETURN jsonb_build_object('ok', false, 'reason', 'account_suspended'); END IF;
  IF profile_row.status = 'active' THEN
    UPDATE public.payment_activation_codes SET verified_at = now() WHERE id = code_row.id;
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  END IF;

  UPDATE public.payment_activation_codes SET verified_at = now() WHERE id = code_row.id;
  UPDATE public.profiles
  SET status = 'active', tier = payment_row.tier, activated_at = COALESCE(activated_at, now())
  WHERE id = payment_row.user_id
  RETURNING * INTO profile_row;

  UPDATE public.payment_approval_requests
  SET status = 'approved', approved_at = COALESCE(approved_at, now()), updated_at = now()
  WHERE stk_transaction_id = payment_row.id AND status = 'pending';

  INSERT INTO public.admin_audit(actor, action, details)
  VALUES (auth.uid()::text, 'payment_code_activation', jsonb_build_object('ref', payment_row.ref, 'user', profile_row.id, 'amount', payment_row.amount));
  INSERT INTO public.customer_notifications (user_id, type, title, message, related_id)
  VALUES (profile_row.id, 'payment_approved', 'Account activated', 'Your payment code was verified and your account is now active.', code_row.id);

  IF profile_row.referred_by IS NOT NULL THEN
    commission_amount := CASE payment_row.tier WHEN 'pro' THEN 250 WHEN 'standard' THEN 150 ELSE 80 END;
    INSERT INTO public.commissions(referrer_id, referred_id, amount)
    VALUES (profile_row.referred_by, profile_row.id, commission_amount)
    ON CONFLICT (referred_id) DO NOTHING;
    IF FOUND THEN
      UPDATE public.profiles SET balance = balance + commission_amount
      WHERE id = profile_row.referred_by
      RETURNING * INTO referrer_row;
    END IF;
  END IF;

  IF referrer_row.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'user_id', profile_row.id, 'name', profile_row.name, 'phone', profile_row.phone,
      'code', profile_row.referral_code, 'amount', payment_row.amount, 'referrer_id', referrer_row.id,
      'referrer_name', referrer_row.name, 'referrer_phone', referrer_row.phone,
      'referrer_code', referrer_row.referral_code, 'commission', commission_amount
    );
  END IF;
  RETURN jsonb_build_object(
    'ok', true, 'user_id', profile_row.id, 'name', profile_row.name,
    'phone', profile_row.phone, 'code', profile_row.referral_code, 'amount', payment_row.amount
  );
END;
$$;
REVOKE ALL ON FUNCTION public.activate_payment_with_code(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_payment_with_code(text, text) TO authenticated;
