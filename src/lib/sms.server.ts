import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhone } from "./phone";

const FOOTER = "Reply STOP to unsubscribe";

/** SMS gateway rejects emojis: strip pictographs and replace arrows/dashes with plain ASCII. */
export function stripEmoji(s: string): string {
  return s
    .replace(/[→➡]/g, "->").replace(/[—–]/g, "-").replace(/…/g, "...")
    .replace(/[^\x20-\x7E\n]/g, "")
    .replace(/ {2,}/g, " ").trim();
}

export type SmsInput = {
  phone: string;
  message: string;
  trigger: string;
  userId?: string | null;
  dedupeKey?: string;
  marketing?: boolean;
  logMessage?: string;
};

export type SmsResult = { ok: boolean; status: string; httpCode: number | null; response: string; logId?: string; skipped?: string };

/** Sends via iSpLedger, logs to sms_logs, dedupes by key, retries transient failures, respects STOP. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sendSms(db: SupabaseClient<any>, input: SmsInput): Promise<SmsResult> {
  const phone = normalizePhone(input.phone);
  if (!phone) return { ok: false, status: "failed", httpCode: null, response: "Invalid phone number" };

  if (input.marketing && input.userId) {
    const { data } = await db.from("profiles").select("sms_opt_out").eq("id", input.userId).single();
    if (data?.sms_opt_out) return { ok: false, status: "skipped", httpCode: null, response: "User opted out", skipped: "opt_out" };
  }

  const clean = stripEmoji(input.message);
  const text = clean.includes(FOOTER) ? clean : `${clean.trim()} ${FOOTER}`;
  const loggedText = input.logMessage ? stripEmoji(input.logMessage) : text;

  const { data: log, error } = await db
    .from("sms_logs")
    .insert({ phone, message: loggedText, trigger_type: input.trigger, user_id: input.userId ?? null, dedupe_key: input.dedupeKey ?? null })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: true, status: "duplicate", httpCode: null, response: "Already sent", skipped: "duplicate" };
    return { ok: false, status: "failed", httpCode: null, response: error.message };
  }

  const { data: setting } = await db.from("app_settings").select("value").eq("key", "sms_api_token").maybeSingle();
  const token = ((setting?.value as string | undefined) || process.env["SMS_API_TOKEN"] || "").trim();
  const endpoint = (process.env["SMS_ENDPOINT"] ?? "https://sms.ispledger.com/sms/send").trim();
  const sender = (process.env["SMS_SENDER_ID"] ?? "TOPSPEED").trim();
  if (!token) {
    await db.from("sms_logs").update({ status: "failed", response: "SMS_API_TOKEN not configured" }).eq("id", log.id);
    return { ok: false, status: "failed", httpCode: null, response: "SMS token not configured", logId: log.id };
  }

  const url = `${endpoint}?${new URLSearchParams({ api: token, SenderId: sender, msg: text, phone }).toString()}`;
  let httpCode: number | null = null;
  let body = "";
  let attempts = 0;
  for (let i = 0; i < 3; i++) {
    attempts++;
    try {
      const res = await fetch(url, { method: "GET" });
      httpCode = res.status;
      body = (await res.text()).slice(0, 1000);
      if (res.status < 500) break;
    } catch (e) {
      body = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  const ok = httpCode !== null && httpCode >= 200 && httpCode < 300 && !/wrong|invalid|error|fail/i.test(body);
  const status = ok ? "sent" : "failed";
  await db.from("sms_logs").update({ status, http_code: httpCode, response: body, attempts }).eq("id", log.id);
  return { ok, status, httpCode, response: body, logId: log.id };
}
