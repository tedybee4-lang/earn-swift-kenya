import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SITE_URL } from "@/lib/site";
import { normalizePhone } from "./phone";

const TIER_AMOUNT = { starter: 200, standard: 350, pro: 550 } as const;

export const initiateStkPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ tier: z.enum(["starter", "standard", "pro"]), phone: z.string().min(9).max(16) }).parse(d))
  .handler(async ({ data, context }) => {
    const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "PAYHERO_AUTH_TOKEN", "PAYHERO_CHANNEL_ID"].filter((k) => !process.env[k]);
    if (missing.length) {
      console.error("Payment config missing", missing);
      return { success: false as const, error: `Payments are not configured on this server. Missing setting(s): ${missing.join(", ")}. Please use manual payment.` };
    }
    const channelId = Number(process.env["PAYHERO_CHANNEL_ID"]);
    if (!Number.isInteger(channelId) || channelId < 1) {
      return { success: false as const, error: "PayHero payment channel is not configured correctly. Please use manual payment." };
    }
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { sendSms } = await import("./sms.server");
    const phone = normalizePhone(data.phone);
    if (!phone) return { success: false as const, error: "Enter a valid Safaricom number." };

    const { data: user } = await db.from("profiles").select("*").eq("id", context.userId).single();
    if (!user) return { success: false as const, error: "Account not found." };
    if (user.status === "active") return { success: false as const, error: "Your account is already active." };
    if (user.status === "suspended") return { success: false as const, error: "Account suspended." };
    const { count: completedTasks, error: taskCountError } = await db.from("task_completions").select("id", { count: "exact", head: true }).eq("user_id", context.userId);
    if (taskCountError) {
      console.error("Could not verify free task eligibility", { userId: context.userId, error: taskCountError.message });
      return { success: false as const, error: "We couldn't verify your free-task progress. Please refresh and try again." };
    }
    if ((completedTasks ?? 0) < 3) return { success: false as const, error: `Complete your ${3 - (completedTasks ?? 0)} remaining free task${3 - (completedTasks ?? 0) === 1 ? "" : "s"} before activation payment.` };

    const now = Date.now();
    const { data: recent } = await db.from("stk_transactions").select("id,status,created_at,phone,user_id")
      .or(`user_id.eq.${context.userId},phone.eq.${phone}`).gte("created_at", new Date(now - 86400000).toISOString());
    const mine = (recent ?? []).filter((r) => r.user_id === context.userId);
    if (mine.some((r) => ["initiated", "pending"].includes(r.status) && now - Date.parse(r.created_at) < 120000))
      return { success: false as const, error: "A payment prompt is already in progress. Check your phone." };
    // REMOVED: Daily limit of 3 attempts - now allowing unlimited attempts per day
    if ((recent ?? []).filter((r) => r.phone === phone && now - Date.parse(r.created_at) < 300000).length >= 3)
      return { success: false as const, error: "Too many prompts to this number. Wait 5 minutes." };

    const amount = TIER_AMOUNT[data.tier];
    const ref = `SMARTERN-${context.userId.slice(0, 8)}-${now}`;
    const payload = {
      amount,
      phone_number: `0${phone.slice(3)}`,
      channel_id: channelId,
      provider: "m-pesa",
      external_reference: ref,
      customer_name: user.name,
      callback_url: process.env["PAYHERO_CALLBACK_URL"] || `${SITE_URL}/api/public/mpesa-callback`,
    };
    await db.from("stk_transactions").insert({ user_id: context.userId, phone, amount, tier: data.tier, ref, request_payload: payload });

    const token = (process.env["PAYHERO_AUTH_TOKEN"] ?? "").trim();
    const endpoint = process.env["PAYHERO_STK_ENDPOINT"] || "https://backend.payhero.co.ke/api/v2/payments";
    let resBody: Record<string, unknown> = {};
    let okRes = false;
    let httpStatus = 0;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      if (!token) throw new Error("PayHero API token is not configured");
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Basic ${token.replace(/^Basic\s+/i, "")}` },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      httpStatus = res.status;
      const text = await res.text();
      try { resBody = JSON.parse(text); } catch { resBody = { raw: text }; }
      okRes = res.ok && resBody["success"] !== false;
    } catch (e) {
      resBody = { error: e instanceof Error && e.name === "AbortError" ? "PayHero request timed out" : e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(timeout);
    }
    const d = (resBody["response"] as Record<string, unknown> | undefined) ?? (resBody["data"] as Record<string, unknown> | undefined) ?? resBody;
    const checkout = (d["CheckoutRequestID"] ?? d["checkout_request_id"]) as string | undefined;
    const merchant = (d["merchant_request_id"] ?? d["MerchantRequestID"]) as string | undefined;
    okRes = okRes && Boolean(checkout);

    if (!okRes) {
      const responseSummary = JSON.stringify(resBody);
      const reason = [d["message"], d["error"], d["errors"], d["detail"], d["details"], d["error_description"], d["error_message"], d["validation_errors"], d["ResultDesc"], d["result_desc"], resBody["message"], resBody["error"], resBody["errors"], resBody["detail"], resBody["details"], resBody["error_description"], resBody["ResultDesc"], resBody["result_desc"], resBody["raw"]]
        .map((value) => typeof value === "string" ? value : value == null ? undefined : JSON.stringify(value))
        .find((value) => Boolean(value?.trim())) ?? (responseSummary && responseSummary !== "{}" ? responseSummary : `PayHero returned HTTP ${httpStatus || "error"} without a validation message (empty or unsupported response).`);
      const errorCode = String(d["error_code"] ?? resBody["error_code"] ?? "");
      const cleanReason = reason.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
      const safeReason = (token ? cleanReason.split(token).join("[redacted]") : cleanReason).slice(0, 180);
      await db.from("stk_transactions").update({ status: "failed", failure_reason: reason, response_payload: resBody as never, updated_at: new Date().toISOString() }).eq("ref", ref);
      console.error("STK push failed", { httpStatus, response: resBody });
      return { success: false as const, error: errorCode === "LIMIT_REACHED"
        ? "M-Pesa prompts are temporarily unavailable because the payment service limit has been reached. Please use manual payment."
        : httpStatus === 401 || httpStatus === 403
        ? "PayHero rejected the payment connection. Please use manual payment while support checks it."
        : httpStatus >= 400
        ? `PayHero rejected the request (HTTP ${httpStatus}): ${safeReason}`
        : httpStatus > 0
        ? "PayHero did not return a checkout ID. Please verify the payment channel configuration."
        : `Could not reach PayHero: ${safeReason}` };
    }
    await db.from("stk_transactions").update({ status: "pending", checkout_request_id: checkout ?? null, merchant_request_id: merchant ?? null, response_payload: resBody as never, updated_at: new Date().toISOString() }).eq("ref", ref);
    await sendSms(db, { phone, userId: context.userId, trigger: "stk_sent", dedupeKey: `stk_sent:${ref}`,
      message: `${user.name}, we've sent an M-Pesa prompt to ${phone}. Enter your PIN to activate. Ref: ${ref}` });
    return { success: true as const, ref, stkTransactionId: (await db.from("stk_transactions").select("id").eq("ref", ref).single()).data?.id };
  });

export const checkPaymentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ ref: z.string().min(5).max(80) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: t } = await db.from("stk_transactions").select("*").eq("ref", data.ref).eq("user_id", context.userId).single();
    if (!t) return { status: "unknown", tier: null, transaction_id: null, message: "Transaction not found." };
    if (["initiated", "pending"].includes(t.status) && Date.now() - Date.parse(t.created_at) > 300000) {
      await db.from("stk_transactions").update({ status: "failed", failure_reason: "timeout", updated_at: new Date().toISOString() }).eq("id", t.id).in("status", ["initiated", "pending"]);
      return { status: "failed", tier: t.tier, transaction_id: null, message: "The prompt expired. Please try again." };
    }
    const msg: Record<string, string> = { success: "Payment confirmed. Enter the activation code sent to your phone.", failed: t.failure_reason ?? "Payment failed.", cancelled: "Payment was cancelled.", pending: "Waiting for payment confirmation.", initiated: "STK prompt sent." };
    return { status: t.status, tier: t.tier, transaction_id: t.transaction_id, message: msg[t.status] ?? t.status };
  });

export const activatePaymentWithCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ ref: z.string().min(5).max(80), code: z.string().regex(/^\d{6}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: payment, error: paymentError } = await context.supabase.from("stk_transactions")
      .select("id,status").eq("ref", data.ref).eq("user_id", context.userId).single();
    if (paymentError || !payment || payment.status !== "success") return { success: false as const, error: "This payment is not confirmed yet." };
    const pepper = process.env["SUPABASE_SERVICE_ROLE_KEY"];
    if (!pepper) return { success: false as const, error: "Activation is temporarily unavailable. Please try again." };
    const { createHmac } = await import("node:crypto");
    const codeHash = createHmac("sha256", pepper).update(`${payment.id}:${data.code}`).digest("hex");
    const { data: result, error } = await context.supabase.rpc("activate_payment_with_code", { _ref: data.ref, _code_hash: codeHash });
    if (error) throw new Error(error.message);
    const activation = result as Record<string, unknown>;
    if (activation["ok"] !== true) {
      const reason = String(activation["reason"] ?? "invalid_code");
      const message = reason === "code_expired" ? "That code expired. Request a new code by SMS."
        : reason === "too_many_attempts" ? "Too many incorrect attempts. Request a new code by SMS."
        : reason === "account_suspended" ? "This account is suspended. Please contact support."
        : reason === "payment_not_confirmed" ? "Payment is not confirmed yet. Keep this page open and retry shortly."
        : "That code is incorrect. Check the SMS and try again.";
      return { success: false as const, error: message };
    }
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { notifyActivation } = await import("./activation.server");
    const { data: user } = await db.from("profiles").select("referral_code").eq("id", String(activation["user_id"] ?? context.userId)).single();
    const { data: referrer } = activation["referrer_id"]
      ? await db.from("profiles").select("phone,referral_code").eq("id", String(activation["referrer_id"])).single()
      : { data: null };
    await notifyActivation(db, { ...activation, code: user?.referral_code, referrer_phone: referrer?.phone, referrer_code: referrer?.referral_code });
    return { success: true as const };
  });

export const resendPaymentActivationCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ ref: z.string().min(5).max(80) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: payment, error: paymentError } = await context.supabase.from("stk_transactions")
      .select("id,status,phone,amount,tier").eq("ref", data.ref).eq("user_id", context.userId).single();
    if (paymentError || !payment || payment.status !== "success") return { success: false as const, error: "Payment is not confirmed yet." };
    const { data: profile } = await context.supabase.from("profiles").select("name,status").eq("id", context.userId).single();
    if (profile?.status === "active") return { success: false as const, error: "This account is already active." };
    const pepper = process.env["SUPABASE_SERVICE_ROLE_KEY"];
    if (!pepper) return { success: false as const, error: "Code delivery is temporarily unavailable." };
    const { randomInt, createHmac } = await import("node:crypto");
    const code = String(randomInt(100000, 1000000));
    const codeHash = createHmac("sha256", pepper).update(`${payment.id}:${code}`).digest("hex");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: refreshResult, error: refreshError } = await db.rpc("refresh_payment_activation_code", {
      _user_id: context.userId,
      _ref: data.ref,
      _code_hash: codeHash,
      _expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
    if (refreshError) throw new Error(refreshError.message);
    const refresh = refreshResult as Record<string, unknown>;
    if (refresh["ok"] !== true) {
      const reason = String(refresh["reason"] ?? "unavailable");
      return { success: false as const, error: reason === "wait_before_resend" ? "Wait 30 seconds before requesting another code." : reason === "resend_limit" ? "You have used all code resend attempts. Please contact support." : "A new code cannot be sent for this payment." };
    }
    const { sendSms } = await import("./sms.server");
    const sms = await sendSms(db, {
      phone: payment.phone,
      userId: context.userId,
      trigger: "payment_activation_code",
      dedupeKey: `payment_activation_code:${payment.id}:${String(refresh["resend_count"] ?? 1)}`,
      message: `${profile?.name ?? "Hello"}, your new activation code is ${code}. Enter it within 15 minutes to activate your ${payment.tier} plan. Do not share this code.`,
      logMessage: "Replacement payment activation code sent by SMS.",
    });
    return sms.ok
      ? { success: true as const, message: "A new activation code was sent by SMS." }
      : { success: false as const, error: "We could not send the SMS right now. Wait 30 seconds and try again." };
  });

async function assertAdmin(ctx: { supabase: { rpc: (f: "has_role", a: { _user_id: string; _role: "admin" }) => PromiseLike<{ data: boolean | null }> }; userId: string }) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (!data) throw new Error("Forbidden");
}

export const adminSendTestSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ phone: z.string().min(9).max(16), message: z.string().min(1).max(400) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { sendSms } = await import("./sms.server");
    const r = await sendSms(db, { phone: data.phone, message: data.message, trigger: "admin_test" });
    await db.from("admin_audit").insert({ actor: context.userId, action: "sms_test", details: { phone: data.phone, status: r.status } });
    return { ...r, at: new Date().toISOString() };
  });

export const adminManualActivate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ ref: z.string().min(5).max(80) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: t } = await db.from("stk_transactions").select("amount").eq("ref", data.ref).single();
    if (!t) return { ok: false, reason: "not_found" };
    const { data: r } = await db.rpc("activate_stk", { _ref: data.ref, _txid: `MANUAL-${Date.now()}`, _amount: t.amount, _payload: { manual_override: context.userId }, _actor: context.userId });
    const { notifyActivation } = await import("./activation.server");
    await notifyActivation(db, r as Record<string, unknown>);
    return r as { ok: boolean };
  });

export const adminApprovePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ approvalId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: result, error } = await context.supabase.rpc("admin_approve_payment", { _approval_id: data.approvalId });
    if (error) throw new Error(error.message);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { notifyActivation } = await import("./activation.server");
    const activation = result as Record<string, unknown>;
    const { data: user } = await db.from("profiles").select("referral_code").eq("id", String(activation["user_id"])).single();
    const { data: referrer } = activation["referrer_id"]
      ? await db.from("profiles").select("phone,referral_code").eq("id", String(activation["referrer_id"])).single()
      : { data: null };
    await notifyActivation(db, {
      ...activation,
      code: user?.referral_code,
      referrer_phone: referrer?.phone,
      referrer_code: referrer?.referral_code,
    });
    return { ok: true };
  });

export const adminRejectPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ approvalId: z.string().uuid(), reason: z.string().trim().min(3).max(250) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: approval, error: lookupError } = await db.from("payment_approval_requests").select("user_id,phone").eq("id", data.approvalId).single();
    if (lookupError || !approval) throw new Error(lookupError?.message ?? "Payment approval request not found.");
    const { error } = await context.supabase.rpc("admin_reject_payment", { _approval_id: data.approvalId, _rejection_reason: data.reason });
    if (error) throw new Error(error.message);
    const { data: user } = await db.from("profiles").select("name").eq("id", approval.user_id).single();
    const { sendSms } = await import("./sms.server");
    await sendSms(db, {
      phone: approval.phone,
      userId: approval.user_id,
      trigger: "payment_rejected",
      dedupeKey: `payment_rejected:${data.approvalId}`,
      message: `${user?.name ?? "Hi"}, your activation request was rejected: ${data.reason}. Contact support for help with your payment.`,
    });
    return { ok: true };
  });

export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) throw new Error("You cannot delete your own admin account.");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    await db.from("profiles").update({ referred_by: null }).eq("referred_by", data.userId);
    await db.from("user_roles").delete().eq("user_id", data.userId);
    const { error: pErr } = await db.from("profiles").delete().eq("id", data.userId);
    if (pErr) throw new Error(pErr.message);
    const { error } = await db.auth.admin.deleteUser(data.userId);
    if (error && !/not found/i.test(error.message)) throw new Error(error.message);
    await db.from("admin_audit").insert({ actor: context.userId, action: "delete_user", details: { user: data.userId } });
    return { ok: true };
  });

export const adminGetSmsKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data } = await db.from("app_settings").select("value,updated_at").eq("key", "sms_api_token").maybeSingle();
    const v = data?.value || process.env["SMS_API_TOKEN"] || "";
    return { masked: v ? `${v.slice(0, 4)}••••${v.slice(-4)}` : "Not set", source: data ? "dashboard" : "default", updatedAt: data?.updated_at ?? null };
  });

export const adminSetSmsKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ key: z.string().trim().min(8).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { error } = await db.from("app_settings").upsert({ key: "sms_api_token", value: data.key, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    await db.from("admin_audit").insert({ actor: context.userId, action: "sms_key_updated", details: {} });
    return { ok: true };
  });
