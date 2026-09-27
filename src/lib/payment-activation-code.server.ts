import { createHmac, randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { sendSms } from "./sms.server";

type PaymentForCode = Pick<Database["public"]["Tables"]["stk_transactions"]["Row"], "id" | "user_id" | "phone" | "amount" | "tier" | "ref">;

export async function issuePaymentActivationCode(db: SupabaseClient<Database>, payment: PaymentForCode) {
  const { data: existing, error: lookupError } = await db.from("payment_activation_codes")
    .select("id").eq("stk_transaction_id", payment.id).maybeSingle();
  if (lookupError) return { ok: false as const, reason: "code_store_unavailable", error: lookupError.message };
  if (existing) return { ok: true as const, sent: false as const, reason: "already_issued" };

  const pepper = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!pepper) return { ok: false as const, reason: "code_secret_missing" };
  const code = String(randomInt(100000, 1000000));
  const codeHash = createHmac("sha256", pepper).update(`${payment.id}:${code}`).digest("hex");
  const { error: insertError } = await db.from("payment_activation_codes").insert({
    user_id: payment.user_id,
    stk_transaction_id: payment.id,
    code_hash: codeHash,
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });
  if (insertError) {
    if (insertError.code === "23505") return { ok: true as const, sent: false as const, reason: "already_issued" };
    return { ok: false as const, reason: "code_store_unavailable", error: insertError.message };
  }

  const { data: user } = await db.from("profiles").select("name").eq("id", payment.user_id).single();
  const sms = await sendSms(db, {
    phone: payment.phone,
    userId: payment.user_id,
    trigger: "payment_activation_code",
    dedupeKey: `payment_activation_code:${payment.id}`,
    message: `${user?.name ?? "Hello"}, your KSh ${payment.amount} payment is confirmed. Your activation code is ${code}. Enter it on the activation page within 15 minutes to activate your ${payment.tier} plan. Do not share this code.`,
    logMessage: "Payment activation code sent by SMS.",
  });
  return sms.ok
    ? { ok: true as const, sent: true as const }
    : { ok: false as const, reason: "sms_delivery_failed", status: sms.status, response: sms.response };
}
