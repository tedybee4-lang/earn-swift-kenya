CREATE OR REPLACE FUNCTION public.complete_task(_task_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  task_row public.tasks;
  profile_row public.profiles;
  reward_amount numeric;
  completed_count int;
  completed_today int;
BEGIN
  SELECT * INTO profile_row FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  IF profile_row.id IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF profile_row.status = 'suspended' THEN RAISE EXCEPTION 'Account suspended'; END IF;

  SELECT count(*) INTO completed_count FROM public.task_completions WHERE user_id = profile_row.id;
  SELECT count(*) INTO completed_today FROM public.task_completions WHERE user_id = profile_row.id AND created_at::date = now()::date;
  IF profile_row.status <> 'active' AND completed_count >= 3 THEN
    RAISE EXCEPTION 'Free limit reached: complete activation payment to keep earning';
  END IF;
  IF profile_row.status = 'active' AND completed_today >= 4 THEN
    RAISE EXCEPTION 'Daily limit of 4 tasks reached. Come back tomorrow';
  END IF;

  SELECT * INTO task_row FROM public.tasks WHERE id = _task_id AND is_active FOR UPDATE;
  IF task_row.id IS NULL THEN RAISE EXCEPTION 'Task unavailable'; END IF;
  IF task_row.slots_total IS NOT NULL AND task_row.slots_used >= task_row.slots_total THEN RAISE EXCEPTION 'No slots left'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.task_completions
    WHERE user_id = profile_row.id AND task_id = task_row.id AND created_at::date = now()::date
  ) THEN
    RAISE EXCEPTION 'Already completed today';
  END IF;

  reward_amount := GREATEST(50, CASE profile_row.tier
    WHEN 'pro' THEN task_row.reward_pro
    WHEN 'standard' THEN task_row.reward_standard
    ELSE task_row.reward_starter
  END);
  INSERT INTO public.task_completions (user_id, task_id, reward, status)
  VALUES (profile_row.id, task_row.id, reward_amount, 'approved');
  UPDATE public.tasks SET slots_used = slots_used + 1 WHERE id = task_row.id;
  UPDATE public.profiles SET balance = balance + reward_amount, last_task = now() WHERE id = profile_row.id;
  RETURN reward_amount;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_stk(
  _ref text,
  _txid text,
  _amount numeric,
  _payload jsonb,
  _actor text DEFAULT 'callback'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  payment_row public.stk_transactions;
  profile_row public.profiles;
  referrer_row public.profiles;
  commission_amount numeric;
BEGIN
  SELECT * INTO payment_row FROM public.stk_transactions WHERE ref = _ref FOR UPDATE;
  IF payment_row.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unknown_ref'); END IF;

  SELECT * INTO profile_row FROM public.profiles WHERE id = payment_row.user_id FOR UPDATE;
  IF profile_row.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'user_not_found'); END IF;
  IF payment_row.status = 'success' AND profile_row.status = 'active' THEN
    UPDATE public.payment_approval_requests
    SET status = 'approved', approved_at = COALESCE(approved_at, now()), updated_at = now()
    WHERE stk_transaction_id = payment_row.id AND status = 'pending';
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  END IF;
  IF _amount IS DISTINCT FROM payment_row.amount THEN
    UPDATE public.stk_transactions
    SET status = 'failed', failure_reason = 'amount_mismatch', callback_payload = _payload, updated_at = now()
    WHERE id = payment_row.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  END IF;
  IF profile_row.status = 'suspended' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'account_suspended');
  END IF;

  UPDATE public.stk_transactions
  SET status = 'success', transaction_id = COALESCE(_txid, transaction_id),
      callback_payload = COALESCE(_payload, callback_payload), failure_reason = NULL, updated_at = now()
  WHERE id = payment_row.id;
  UPDATE public.profiles
  SET status = 'active', tier = payment_row.tier, activated_at = COALESCE(activated_at, now())
  WHERE id = payment_row.user_id
  RETURNING * INTO profile_row;

  UPDATE public.payment_approval_requests
  SET status = 'approved', approved_at = COALESCE(approved_at, now()), updated_at = now()
  WHERE stk_transaction_id = payment_row.id AND status = 'pending';

  INSERT INTO public.admin_audit(actor, action, details)
  VALUES (_actor, 'activation', jsonb_build_object('ref', _ref, 'user', payment_row.user_id, 'amount', _amount, 'automatic', true));

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
      'code', profile_row.referral_code, 'amount', _amount, 'referrer_id', referrer_row.id,
      'referrer_name', referrer_row.name, 'referrer_phone', referrer_row.phone,
      'referrer_code', referrer_row.referral_code, 'commission', commission_amount
    );
  END IF;
  RETURN jsonb_build_object(
    'ok', true, 'user_id', profile_row.id, 'name', profile_row.name,
    'phone', profile_row.phone, 'code', profile_row.referral_code, 'amount', _amount
  );
END;
$$;
REVOKE ALL ON FUNCTION public.activate_stk(text, text, numeric, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_stk(text, text, numeric, jsonb, text) TO service_role;

DO $$
DECLARE
  pending_payment record;
BEGIN
  FOR pending_payment IN
    SELECT payment.ref, payment.transaction_id, payment.amount, payment.callback_payload
    FROM public.stk_transactions payment
    JOIN public.payment_approval_requests approval ON approval.stk_transaction_id = payment.id
    WHERE payment.status = 'success'
      AND approval.status = 'pending'
      AND payment.transaction_id IS NOT NULL
      AND payment.request_payload ? 'channel_id'
  LOOP
    PERFORM public.activate_stk(
      pending_payment.ref,
      pending_payment.transaction_id,
      pending_payment.amount,
      pending_payment.callback_payload,
      'auto_approval_migration'
    );
  END LOOP;
END;
$$;
