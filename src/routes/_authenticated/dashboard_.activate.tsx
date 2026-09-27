import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, Smartphone, CircleCheck, ShieldCheck, KeyRound, RotateCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { initiateStkPush, checkPaymentStatus, activatePaymentWithCode, resendPaymentActivationCode } from "@/lib/payments.functions";
import { ksh } from "@/lib/phone";

export const Route = createFileRoute("/_authenticated/dashboard_/activate")({
  head: () => ({ meta: [
    { title: "Activate account — SmartEarn" },
    { name: "description", content: "Activate your SmartEarn account securely through M-Pesa." },
    { property: "og:title", content: "Activate account — SmartEarn" },
    { property: "og:description", content: "Activate your SmartEarn account securely through M-Pesa." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex" },
  ] }),
  component: Activate,
});

const plans = [
  { tier: "starter", name: "Starter", amount: 200, mult: "1x" },
  { tier: "standard", name: "Standard", amount: 350, mult: "2x" },
  { tier: "pro", name: "Pro", amount: 550, mult: "4x" },
] as const;

function Activate() {
  const { user } = Route.useRouteContext();
  const nav = useNavigate();
  const qc = useQueryClient();
  const push = useServerFn(initiateStkPush);
  const check = useServerFn(checkPaymentStatus);
  const activate = useServerFn(activatePaymentWithCode);
  const resend = useServerFn(resendPaymentActivationCode);
  const { data: p } = useQuery({ queryKey: ["profile", user.id], queryFn: async () => (await supabase.from("profiles").select("*").eq("id", user.id).single()).data });
  const { data: pendingActivationPayment } = useQuery({
    queryKey: ["pending-payment-activation", user.id],
    enabled: Boolean(p && p.status !== "active"),
    queryFn: async () => {
      const { data, error } = await supabase.from("stk_transactions").select("ref,tier,phone")
        .eq("user_id", user.id).eq("status", "success").order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const [tier, setTier] = useState<(typeof plans)[number]["tier"]>("starter");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "waiting" | "code" | "activating" | "success" | "failed">("idle");
  const [msg, setMsg] = useState("");
  const [codeMessage, setCodeMessage] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [paymentRef, setPaymentRef] = useState<string | null>(null);
  const [resendingCode, setResendingCode] = useState(false);
  const [slow, setSlow] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { if (p?.phone && !phone) setPhone("0" + p.phone.slice(3)); }, [p, phone]);
  useEffect(() => {
    if (!pendingActivationPayment || p?.status === "active" || state !== "idle") return;
    setPaymentRef(pendingActivationPayment.ref);
    setTier(pendingActivationPayment.tier);
    setPhone(pendingActivationPayment.phone.startsWith("254") ? `0${pendingActivationPayment.phone.slice(3)}` : pendingActivationPayment.phone);
    setMsg("Payment confirmed. Enter the SMS activation code to finish activating your plan.");
    setState("code");
  }, [pendingActivationPayment, p?.status, state]);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const plan = plans.find((x) => x.tier === tier) ?? plans[0];

  async function pay() {
    if (state === "sending" || state === "waiting") return;
    setState("sending"); setMsg("Sending STK Push…"); setSlow(false);
    let r: Awaited<ReturnType<typeof push>>;
    try {
      r = await push({ data: { tier, phone } });
    } catch {
      setState("failed"); setMsg("Payment service could not be reached. Please retry or use manual payment."); return;
    }
    if (!r.success) { setState("failed"); setMsg(r.error); return; }
    setPaymentRef(r.ref);
    setState("waiting"); setMsg("Check your phone and enter your M-Pesa PIN.");
    const start = Date.now();
    
    timer.current = setInterval(async () => {
      if (Date.now() - start > 120000) setSlow(true);
      const s = await check({ data: { ref: r.ref } });
      if (s.status === "success") { 
        if (timer.current) clearInterval(timer.current);
        const paidPlan = plans.find((item) => item.tier === s.tier);
        if (paidPlan) setTier(paidPlan.tier);
        setState("code");
        setMsg(s.message);
      }
      else if (["failed", "cancelled", "unknown"].includes(s.status)) { 
        if (timer.current) clearInterval(timer.current); 
        setState("failed"); 
        setMsg(s.message); 
      }
    }, 3000);
  }

  async function submitActivationCode(event: React.FormEvent) {
    event.preventDefault();
    if (!paymentRef || activationCode.length !== 6 || state === "activating") return;
    setState("activating");
    setCodeMessage("");
    try {
      const result = await activate({ data: { ref: paymentRef, code: activationCode } });
      if (!result.success) {
        setState("code");
        setCodeMessage(result.error);
        return;
      }
      setState("success");
      setMsg("Your code is verified. Your selected plan is active and you can start earning now.");
      setActivationCode("");
      qc.invalidateQueries();
      setTimeout(() => nav({ to: "/dashboard" }), 7000);
    } catch {
      setState("code");
      setCodeMessage("We couldn't verify that code just now. Please retry.");
    }
  }

  async function resendActivationCode() {
    if (!paymentRef || resendingCode) return;
    setResendingCode(true);
    setCodeMessage("");
    try {
      const result = await resend({ data: { ref: paymentRef } });
      setCodeMessage(result.success ? result.message : result.error);
      if (result.success) setActivationCode("");
    } catch {
      setCodeMessage("We couldn't send a new code. Please try again shortly.");
    } finally {
      setResendingCode(false);
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-md px-4 py-6">
      <Link to="/dashboard" className="btn-ghost -ml-3 px-3 py-2"><ArrowLeft className="h-4 w-4" /> Dashboard</Link>
      <h1 className="mt-4 text-2xl font-bold">Activate your account</h1>
      <p className="mt-1 text-sm text-muted-foreground">Balance {ksh(p?.balance ?? 0)}. Activation unlocks all tasks and withdrawals.</p>
      
      {state === "success" ? (
        <div className="mt-8 space-y-5 rounded-2xl border border-success/30 bg-success/5 p-7 text-center shadow-card">
          <CircleCheck className="mx-auto h-14 w-14 text-success" />
          <div><p className="text-xl font-bold text-success">Activation complete</p><p className="mt-2 text-sm text-muted-foreground">{msg}</p></div>
          <div className="flex items-center justify-center gap-2 text-sm font-medium text-success"><ShieldCheck className="h-4 w-4" /> {plan.name} plan is active</div>
          <Link to="/dashboard" className="btn-primary w-full">Start earning</Link>
          <p className="text-xs text-muted-foreground">Returning to your dashboard shortly…</p>
        </div>
      ) : p?.status === "active" ? (
        <div className="card mt-6 space-y-3 p-6 text-center">
          <CircleCheck className="mx-auto h-12 w-12 text-success" />
          <p className="font-semibold text-success">Your account is active</p>
          <Link to="/dashboard" className="btn-primary mt-2 w-full">Go to dashboard</Link>
        </div>
      ) : state === "code" || state === "activating" ? (
        <div className="mt-8 space-y-5 rounded-2xl border border-primary/20 bg-card p-6 shadow-card sm:p-7">
          <div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><KeyRound className="h-5 w-5" /></span><div><p className="text-lg font-bold">Confirm your activation</p><p className="mt-1 text-sm text-muted-foreground">Your {plans.find((item) => item.tier === tier)?.name} payment is confirmed. Activation usually takes 1-15 minutes. Enter the six-digit code we sent to {phone} to finish.</p></div></div>
          <form onSubmit={submitActivationCode} className="space-y-4">
            <label className="block text-sm font-medium" htmlFor="activation-code">SMS activation code</label>
            <input id="activation-code" className="input text-center font-mono text-2xl tracking-normal" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={activationCode} onChange={(event) => setActivationCode(event.target.value.replace(/\D/g, "").slice(0, 6))} disabled={state === "activating"} placeholder="000000" />
            <button type="submit" disabled={activationCode.length !== 6 || state === "activating"} className="btn-primary w-full py-3.5">{state === "activating" ? <><Loader2 className="h-4 w-4 animate-spin" /> Verifying code…</> : "Verify code and activate"}</button>
          </form>
          {codeMessage && <p aria-live="polite" className="rounded-lg bg-muted p-3 text-center text-sm text-muted-foreground">{codeMessage}</p>}
          <div className="flex flex-col items-center gap-2 border-t pt-4 text-center"><p className="text-xs text-muted-foreground">Code expires 15 minutes after it is sent.</p><button type="button" onClick={resendActivationCode} disabled={resendingCode || state === "activating"} className="btn-ghost px-3 py-2 text-sm"><RotateCw className={`h-4 w-4 ${resendingCode ? "animate-spin" : ""}`} />{resendingCode ? "Sending new code…" : "Resend code by SMS"}</button></div>
        </div>
      ) : state === "sending" || state === "waiting" ? (
        <div className="mt-8 space-y-6 rounded-2xl border bg-card p-7 text-center shadow-card">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-primary/10 text-primary">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
          <div><p className="text-xl font-bold">{state === "sending" ? "Connecting to M-Pesa" : "Approve the prompt on your phone"}</p><p className="mt-2 text-sm text-muted-foreground">{state === "sending" ? "We're sending your secure payment request." : `Enter your M-Pesa PIN on the prompt sent to ${phone}. Keep this page open; once payment is confirmed, we'll text you a code to activate your plan.`}</p></div>
          <div className="space-y-3 text-left">
            <div className="flex items-center gap-3 rounded-lg bg-success/10 p-3 text-sm"><CircleCheck className="h-5 w-5 text-success" /><span>Payment request sent securely</span></div>
            <div className="flex items-center gap-3 rounded-lg bg-muted p-3 text-sm"><Loader2 className="h-5 w-5 animate-spin text-primary" /><span>Waiting for M-Pesa confirmation</span></div>
            <div className="flex items-center gap-3 rounded-lg bg-muted p-3 text-sm text-muted-foreground"><ShieldCheck className="h-5 w-5" /><span>We'll send a one-time activation code by SMS</span></div>
          </div>
          {slow && <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">Still waiting for confirmation. Check for the M-Pesa prompt and enter your PIN. This page will update automatically.</p>}
          <p className="text-xs text-muted-foreground">Do not send another payment while this request is in progress.</p>
        </div>
      ) : (
        <>
          <>
              <div className="mt-6 space-y-3">
                {plans.map((x) => (
                  <button key={x.tier} onClick={() => setTier(x.tier)} className={`card flex w-full items-center justify-between p-4 text-left transition ${tier === x.tier ? "border-primary ring-4 ring-primary/20" : "border-border"}`}>
                    <div><p className="font-semibold">{x.name}</p><p className="text-xs text-muted-foreground">{x.mult} rewards per task</p></div>
                    <p className="font-display text-lg font-bold">{ksh(x.amount)}</p>
                  </button>
                ))}
              </div>
              <label className="mt-6 block"><span className="text-sm font-medium">M-Pesa number</span>
                <input className="input mt-1" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
              <button onClick={pay} className="btn-primary mt-4 w-full py-4">
                <Smartphone className="h-4 w-4" />
                {state === "failed" ? "Retry" : "Pay"} {ksh(plan.amount)} → M-Pesa
              </button>
              {msg && <p className={`mt-3 text-center text-sm ${state === "failed" ? "text-destructive" : "text-muted-foreground"}`}>{msg}</p>}
              <div className="card mt-8 p-4 text-sm">
                <p className="font-semibold">Prompt not working?</p>
                <p className="mt-1 text-muted-foreground">Pay manually: M-Pesa → Lipa na M-Pesa → Buy Goods → Till <b>5441898</b> → amount → PIN, then send us your confirmation code via Help.</p>
              </div>
          </>

        </>
      )}
    </div>
  );
}
