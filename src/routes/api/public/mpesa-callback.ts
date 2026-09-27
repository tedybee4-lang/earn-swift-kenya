import { createHmac, randomInt } from "node:crypto";
import { SITE_URL } from "@/lib/site";
import { normalizePhone } from "@/lib/phone";
import { createFileRoute } from "@tanstack/react-router";

type Json = Record<string, unknown>;

function parse(body: Json) {
  const response = (body["response"] as Json | undefined) ?? (body["data"] as Json | undefined) ?? body;
  const stk = ((response["Body"] as Json | undefined)?.["stkCallback"] as Json | undefined) ?? response;
  const items = ((stk["CallbackMetadata"] as Json | undefined)?.["Item"] as { Name: string; Value?: unknown }[] | undefined) ?? [];
  const meta = Object.fromEntries(items.map((i) => [i.Name, i.Value]));
  return {
    checkout: (stk["CheckoutRequestID"] ?? stk["checkout_request_id"]) as string | undefined,
    ref: (stk["ExternalReference"] ?? stk["external_reference"] ?? stk["account_reference"] ?? stk["AccountReference"] ?? meta["AccountReference"]) as string | undefined,
    code: Number(stk["ResultCode"] ?? stk["result_code"] ?? (String(stk["Status"]).toLowerCase() === "success" ? 0 : -1)),
    desc: String(stk["ResultDesc"] ?? stk["result_desc"] ?? ""),
    amount: Number(meta["Amount"] ?? stk["Amount"] ?? stk["amount"] ?? NaN),
    txid: (meta["MpesaReceiptNumber"] ?? stk["MpesaReceiptNumber"] ?? stk["transaction_id"] ?? stk["mpesa_receipt"]) as string | undefined,
    phone: String(meta["PhoneNumber"] ?? stk["Phone"] ?? stk["phone"] ?? ""),
  };
}

export const Route = createFileRoute("/api/public/mpesa-callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Json;
        try { body = (await request.json()) as Json; } catch { return Response.json({ ok: false }, { status: 400 }); }
        const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
        const p = parse(body);

        let q = db.from("stk_transactions").select("*");
        q = p.checkout ? q.eq("checkout_request_id", p.checkout) : p.ref ? q.eq("ref", p.ref) : q.eq("ref", "__none__");
        const { data: t } = await q.maybeSingle();
        if (!t) {
          console.warn("Unknown STK callback", p);
          return Response.json({ ok: false, reason: "unknown" }, { status: 200 });
        }
        if (p.ref && p.ref !== t.ref) return Response.json({ ok: false, reason: "ref_mismatch" }, { status: 200 });

        if (p.code === 0) {
          if (!p.txid || !Number.isFinite(p.amount) || p.amount !== Number(t.amount) || normalizePhone(p.phone) !== normalizePhone(t.phone)) {
            const reason = !p.txid ? "missing_txid" : !Number.isFinite(p.amount) || p.amount !== Number(t.amount) ? "amount_mismatch" : "phone_mismatch";
            await db.from("stk_transactions").update({ callback_payload: body as never, failure_reason: reason, updated_at: new Date().toISOString() }).eq("id", t.id);
            return Response.json({ ok: false }, { status: 200 });
          }
          const requestPayload = t.request_payload as Json | null;
          const responsePayload = (t.response_payload as Json | null) ?? {};
          const gatewayResponse = (responsePayload["response"] as Json | undefined) ?? (responsePayload["data"] as Json | undefined) ?? responsePayload;
          const gatewayReference = gatewayResponse["reference"];
          const token = (process.env["PAYHERO_AUTH_TOKEN"] ?? "").trim().replace(/^Basic\s+/i, "");
          if (!requestPayload || !("channel_id" in requestPayload) || typeof gatewayReference !== "string" || !gatewayReference || !token) {
            console.error("PayHero transaction cannot be verified", { ref: t.ref });
            return Response.json({ ok: false, reason: "verification_unavailable" }, { status: 503 });
          }
          let verification: Json;
          try {
            const verifyResponse = await fetch(`https://backend.payhero.co.ke/api/v2/transaction-status?reference=${encodeURIComponent(gatewayReference)}`, {
              headers: { Accept: "application/json", Authorization: `Basic ${token}` },
              signal: AbortSignal.timeout(10000),
            });
            if (!verifyResponse.ok) throw new Error(`PayHero status returned HTTP ${verifyResponse.status}`);
            verification = await verifyResponse.json() as Json;
          } catch (error) {
            console.error("PayHero transaction verification failed", { ref: t.ref, error: error instanceof Error ? error.message : String(error) });
            return Response.json({ ok: false, reason: "verification_unavailable" }, { status: 503 });
          }
          const verifiedPayment = (verification["data"] as Json | undefined) ?? (verification["response"] as Json | undefined) ?? verification;
          const providerTransactionId = verifiedPayment["third_party_reference"] ?? verifiedPayment["provider_reference"];
          if (String(verifiedPayment["status"] ?? "").toUpperCase() !== "SUCCESS" || (providerTransactionId && providerTransactionId !== p.txid)) {
            console.warn("PayHero callback does not match verified transaction status", { ref: t.ref, status: verifiedPayment["status"] });
            return Response.json({ ok: false, reason: "verification_mismatch" }, { status: 503 });
          }
          const { data: existingCode, error: codeLookupError } = await db.from("payment_activation_codes")
            .select("id").eq("stk_transaction_id", t.id).maybeSingle();
          if (codeLookupError) {
            console.error("Could not check existing payment activation code", { ref: t.ref, error: codeLookupError.message });
            return Response.json({ ok: false }, { status: 500 });
          }

          let activationCode: string | null = null;
          if (!existingCode) {
            const pepper = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
            if (!pepper) return Response.json({ ok: false }, { status: 503 });
            activationCode = String(randomInt(100000, 1000000));
            const codeHash = createHmac("sha256", pepper).update(`${t.id}:${activationCode}`).digest("hex");
            const { error: codeInsertError } = await db.from("payment_activation_codes").insert({
              user_id: t.user_id,
              stk_transaction_id: t.id,
              code_hash: codeHash,
              expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
            });
            if (codeInsertError && codeInsertError.code !== "23505") {
              console.error("Could not create payment activation code", { ref: t.ref, error: codeInsertError.message });
              return Response.json({ ok: false }, { status: 500 });
            }
            if (codeInsertError) activationCode = null;
          }

          const { error: updateError } = await db.from("stk_transactions").update({
            status: "success",
            transaction_id: p.txid,
            callback_payload: body as never,
            updated_at: new Date().toISOString(),
          }).eq("id", t.id);
          if (updateError) {
            console.error("Could not record verified PayHero payment", { ref: t.ref, error: updateError.message });
            return Response.json({ ok: false }, { status: 500 });
          }

          if (activationCode) {
            const { sendSms } = await import("@/lib/sms.server");
            const { data: user } = await db.from("profiles").select("name").eq("id", t.user_id).single();
            const sms = await sendSms(db, {
              phone: t.phone,
              userId: t.user_id,
              trigger: "payment_activation_code",
              dedupeKey: `payment_activation_code:${t.id}`,
              message: `${user?.name ?? "Hello"}, your KSh ${t.amount} payment is confirmed. Your activation code is ${activationCode}. Enter it on the activation page within 15 minutes to activate your ${t.tier} plan. Do not share this code.`,
              logMessage: "Payment activation code sent by SMS.",
            });
            if (!sms.ok) console.error("Payment activation code SMS failed", { ref: t.ref, status: sms.status, response: sms.response });
          }
          return Response.json({ ok: true });
        }

        if (t.status !== "success") {
          const cancelled = p.code === 1032;
          await db.from("stk_transactions").update({ status: cancelled ? "cancelled" : "failed", failure_reason: p.desc, callback_payload: body as never, updated_at: new Date().toISOString() }).eq("id", t.id).neq("status", "success");
          const { data: u } = await db.from("profiles").select("name").eq("id", t.user_id).single();
          const { sendSms } = await import("@/lib/sms.server");
          await sendSms(db, {
            phone: t.phone, userId: t.user_id, trigger: cancelled ? "stk_cancelled" : "stk_failed", dedupeKey: `stk_result:${t.ref}`,
            message: cancelled
              ? `${u?.name ?? "Hi"}, your M-Pesa payment was cancelled. No money was deducted. Retry -> ${SITE_URL}/dashboard/activate`
              : `${u?.name ?? "Hi"}, your payment failed: ${p.desc.slice(0, 60)}. Retry -> ${SITE_URL}/dashboard/activate`,
          });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
