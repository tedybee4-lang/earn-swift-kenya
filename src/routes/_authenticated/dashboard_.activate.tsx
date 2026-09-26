import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, Smartphone, CheckCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { initiateStkPush, checkPaymentStatus } from "@/lib/payments.functions";
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
  const { data: p } = useQuery({ queryKey: ["profile", user.id], queryFn: async () => (await supabase.from("profiles").select("*").eq("id", user.id).single()).data });
  const [tier, setTier] = useState<(typeof plans)[number]["tier"]>("starter");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "waiting" | "submitted" | "failed">("idle");
  const [msg, setMsg] = useState("");
  const [slow, setSlow] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { if (p?.phone && !phone) setPhone("0" + p.phone.slice(3)); }, [p, phone]);
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
    
    setState("waiting"); setMsg("Check your phone and enter your M-Pesa PIN.");
    const start = Date.now();
    
    timer.current = setInterval(async () => {
      if (Date.now() - start > 120000) setSlow(true);
      const s = await check({ data: { ref: r.ref } });
      if (s.status === "success") { 
        if (timer.current) clearInterval(timer.current);
        setState("submitted");
        setMsg("Payment received. Your activation request is with our team for review. You will receive an SMS after approval.");
        qc.invalidateQueries();
        setTimeout(() => nav({ to: "/dashboard" }), 3000);
      }
      else if (["failed", "cancelled", "unknown"].includes(s.status)) { 
        if (timer.current) clearInterval(timer.current); 
        setState("failed"); 
        setMsg(s.message); 
      }
    }, 3000);
  }

  return (
    <div className="mx-auto min-h-screen max-w-md px-4 py-6">
      <Link to="/dashboard" className="btn-ghost -ml-3 px-3 py-2"><ArrowLeft className="h-4 w-4" /> Dashboard</Link>
      <h1 className="mt-4 text-2xl font-bold">Activate your account</h1>
      <p className="mt-1 text-sm text-muted-foreground">Balance {ksh(p?.balance ?? 0)}. Activation unlocks all tasks and withdrawals.</p>
      
      {p?.status === "active" ? (
        <div className="card mt-6 p-5 text-success">Your account is already active.</div>
      ) : state === "submitted" ? (
        <div className="mt-6 rounded-2xl bg-success/10 border border-success/30 p-6 text-center">
          <CheckCircle className="mx-auto h-12 w-12 text-success mb-3" />
          <p className="font-semibold text-success">Request submitted</p>
          <p className="mt-2 text-sm text-success/80">{msg}</p>
          <p className="mt-4 text-xs text-muted-foreground">Redirecting to dashboard...</p>
        </div>
      ) : (
        <>
          {/* Payment selection */}
          {(
            <>
              <div className="mt-6 space-y-3">
                {plans.map((x) => (
                  <button key={x.tier} onClick={() => setTier(x.tier)} disabled={state === "sending" || state === "waiting"} className={`card flex w-full items-center justify-between p-4 text-left transition ${tier === x.tier ? "border-primary ring-4 ring-primary/20" : "border-border"}`}>
                    <div><p className="font-semibold">{x.name}</p><p className="text-xs text-muted-foreground">{x.mult} rewards per task</p></div>
                    <p className="font-display text-lg font-bold">{ksh(x.amount)}</p>
                  </button>
                ))}
              </div>
              <label className="mt-6 block"><span className="text-sm font-medium">M-Pesa number</span>
                <input className="input mt-1" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={state === "sending" || state === "waiting"} /></label>
              <button onClick={pay} disabled={state === "sending" || state === "waiting"} className="btn-primary mt-4 w-full py-4">
                {state === "sending" || state === "waiting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
                {state === "failed" ? "Retry" : "Pay"} {ksh(plan.amount)} → M-Pesa
              </button>
              {msg && <p className={`mt-3 text-center text-sm ${state === "failed" ? "text-destructive" : "text-muted-foreground"}`}>{msg}</p>}
              {slow && state === "waiting" && <p className="mt-2 text-center text-sm">Did you receive the prompt? If not, wait a moment or retry.</p>}
              <div className="card mt-8 p-4 text-sm">
                <p className="font-semibold">Prompt not working?</p>
                <p className="mt-1 text-muted-foreground">Pay manually: M-Pesa → Lipa na M-Pesa → Buy Goods → Till <b>5441898</b> → amount → PIN, then send us your confirmation code via Help.</p>
              </div>
            </>
          )}

        </>
      )}
    </div>
  );
}
