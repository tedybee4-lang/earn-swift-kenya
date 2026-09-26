-- Allow authenticated admin users to invoke approval RPCs.
-- Each function still verifies the caller with has_role(auth.uid(), 'admin').
REVOKE ALL ON FUNCTION public.create_payment_approval_request(uuid, uuid, text, numeric, public.account_tier, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_payment_approval_request(uuid, uuid, text, numeric, public.account_tier, text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_approve_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_approve_payment(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_reject_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reject_payment(uuid, text) TO authenticated;