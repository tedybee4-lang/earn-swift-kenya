import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { SITE_URL } from "@/lib/site";
import { Clock, LogOut, Wallet, Users, Flame, Copy, ExternalLink, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMyRole } from "@/lib/auth";
import { ksh } from "@/lib/phone";
import { Logo } from "@/components/site/Logo";
import { useActiveTasks } from "@/components/site/LiveTasks";

export const Route = createFileRoute("/_authenticated/dashboard")({
  beforeLoad: async () => {
    if ((await getMyRole()) === "admin") throw redirect({ to: "/admin" });
  },
  head: () => ({ meta: [
    { title: "Dashboard — SmartEarn" },
    { name: "description", content: "Manage your SmartEarn tasks, rewards, and account activity." },
    { property: "og:title", content: "Dashboard — SmartEarn" },
    { property: "og:description", content: "Manage SmartEarn tasks, rewards, and account activity." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex" },
  ] }),
  component: Dashboard,
});

function Dashboard() {
  const { user } = Route.useRouteContext();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [msg, setMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  const profile = useQuery({
    queryKey: ["profile", user.id],
    queryFn: async () => (await supabase.from("profiles").select("*").eq("id", user.id).single()).data,
  });
  
  const withdrawalEligibility = useQuery({
    queryKey: ["withdrawal-eligibility", user.id],
    queryFn: async () => (await supabase.rpc("get_withdrawal_eligibility")).data?.[0],
  });

  const history = useQuery({
    queryKey: ["completions", user.id],
    queryFn: async () =>
      (await supabase.from("task_completions").select("id,reward,status,created_at,tasks(title)").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10)).data ?? [],
  });
  const taskProgress = useQuery({
    queryKey: ["task-count", user.id],
    queryFn: async () => {
      const { count, error } = await supabase.from("task_completions").select("id", { count: "exact", head: true }).eq("user_id", user.id);
      if (error) throw error;
      return count ?? 0;
    },
  });
  const p = profile.data;
  const completedTasks = taskProgress.data ?? 0;
  const freeTasksRemaining = Math.max(0, 3 - completedTasks);
  const tasks = useActiveTasks();
  const refs = useQuery({ queryKey: ["refs", user.id], queryFn: async () => (await supabase.rpc("my_referrals")).data ?? [] });
  const wds = useQuery({ queryKey: ["wds", user.id], queryFn: async () => (await supabase.from("withdrawals").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10)).data ?? [] });
  const [open, setOpen] = useState<null | { id: string; title: string; url: string | null; instructions: string | null; mins: number }>(null);
  const [left, setLeft] = useState(0);
  useEffect(() => { if (left <= 0) return; const t = setTimeout(() => setLeft(left - 1), 1000); return () => clearTimeout(t); }, [left]);
  const [wAmt, setWAmt] = useState("");
  const [wMsg, setWMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  async function withdraw(e: React.FormEvent) {
    e.preventDefault();
    setWMsg(null);
    setWithdrawing(true);
    
    const { data, error } = await supabase.rpc("request_withdrawal_v2", { _amount: Number(wAmt), _phone: p?.phone ?? "" });
    
    setWithdrawing(false);
    setWMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Withdrawal requested successfully. It will be paid to your M-Pesa within 24-72 hours." });
    if (!error) {
      setWAmt("");
      qc.invalidateQueries();
    }
  }
  
  const refLink = p ? `${SITE_URL}/register?ref=${p.referral_code}` : "";

  async function doTask(id: string) {
    setMsg(null);
    const { data, error } = await supabase.rpc("complete_task", { _task_id: id });
    setMsg({ id, ok: !error, text: error ? error.message : `Done! ${ksh(data as number)} added to your balance.` });
    setOpen(null);
    qc.invalidateQueries();
  }

  async function logout() {
    await supabase.auth.signOut();
    qc.clear();
    nav({ to: "/" });
  }

  const elig = withdrawalEligibility.data;

  return (
    <div className="min-h-screen pb-10">
      <header className="sticky top-0 z-30 border-b bg-card/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4">
          <Logo />
          <button onClick={logout} className="btn-ghost px-3 py-2"><LogOut className="h-4 w-4" /> Log out</button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-4 pt-6">
        <section className="overflow-hidden rounded-3xl bg-navy-gradient p-6 text-navy-foreground">
          <p className="text-sm opacity-70">Hi {p?.name ?? "there"}</p>
          <p className="mt-3 text-xs uppercase tracking-widest opacity-60">Balance</p>
          <p className="font-display text-4xl font-bold">{ksh(p?.balance ?? 0)}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className={`chip ${p?.status === "active" ? "bg-success/20 text-success" : "bg-warning/20 text-warning"}`}>
              {p?.status === "active" ? "Active" : p?.status === "suspended" ? "Suspended" : "Not yet activated"}
            </span>
            <span className="chip bg-navy-foreground/10 capitalize">{p?.tier} plan</span>
          </div>
        </section>

        <div className="grid grid-cols-3 gap-3">
          <Stat icon={Flame} label="Streak" value={`${p?.streak ?? 0} days`} />
          <Stat icon={Wallet} label="Tasks done" value={String(completedTasks)} />
          <Stat icon={Users} label="Your code" value={p?.referral_code ?? "—"} copy />
        </div>

        {p?.status !== "active" && (
          <div className="card border-primary/30 p-5">
            <div className="flex items-start justify-between gap-4">
              <div><p className="font-semibold">{freeTasksRemaining ? "Your free tasks" : "Free tasks complete"}</p><p className="mt-1 text-sm text-muted-foreground">{freeTasksRemaining ? `Complete ${freeTasksRemaining} more free task${freeTasksRemaining === 1 ? "" : "s"} before activation payment.` : "Your 3 free tasks are complete. Activate to unlock daily earning and withdrawals."}</p></div>
              <span className="chip shrink-0 bg-primary/10 text-primary">{Math.min(completedTasks, 3)}/3</span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-success transition-[width]" style={{ width: `${Math.min(completedTasks, 3) / 3 * 100}%` }} /></div>
            {freeTasksRemaining === 0 && <Link to="/dashboard/activate" className="btn-primary mt-4 w-full">Continue with M-Pesa</Link>}
          </div>
        )}

        <section>
          <h2 className="text-lg font-bold">Available tasks</h2>
          <div className="mt-3 space-y-3">
            {tasks.data?.map((t) => (
              <div key={t.id} className="card flex items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{t.title}</p>
                  {t.sponsor_name && <p className="text-xs font-medium text-primary">By {t.sponsor_name}</p>}
                  <p className="flex items-center gap-2 text-xs text-muted-foreground"><span>{t.category}</span><Clock className="h-3 w-3" />~{t.est_minutes} min</p>
                  {msg?.id === t.id && <p className={`mt-1 text-xs ${msg.ok ? "text-success" : "text-destructive"}`}>{msg.text}</p>}
                </div>
                <div className="flex shrink-0 flex-col gap-2">
                  <button disabled={p?.status !== "active" && freeTasksRemaining === 0} onClick={() => { setOpen({ id: t.id, title: t.title, url: t.action_url, instructions: t.instructions ?? null, mins: t.est_minutes }); setLeft(Math.min(60, Math.max(15, t.est_minutes * 60))); }} className="btn-primary px-3 py-1 text-xs">{p?.status !== "active" && freeTasksRemaining === 0 ? "Activate" : "Start"}</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="refer" className="card p-5">
          <h2 className="text-lg font-bold">Refer and earn</h2>
          <p className="mt-1 text-sm text-muted-foreground">Earn KSh 80, 150 or 250 when someone you invite activates.</p>
          <div className="mt-3 flex gap-2">
            <input readOnly value={refLink} className="input flex-1 text-xs" />
            <button onClick={() => navigator.clipboard.writeText(refLink)} className="btn-outline px-3"><Copy className="h-4 w-4" /></button>
            <a href={`https://wa.me/?text=${encodeURIComponent("Join SmartEarn and earn from simple tasks: " + refLink)}`} target="_blank" rel="noopener noreferrer" className="btn-primary px-3">WhatsApp</a>
          </div>
          <div className="mt-4 divide-y text-sm">
            {refs.data?.length === 0 && <p className="text-muted-foreground">No referrals yet.</p>}
            {refs.data?.map((r, i) => (
              <div key={i} className="flex justify-between py-2"><span>{r.name} <span className="text-xs capitalize text-muted-foreground">({r.status})</span></span><span className="font-semibold text-success">{r.earned > 0 ? ksh(r.earned) : "—"}</span></div>
            ))}
          </div>
        </section>

        <section id="withdraw" className="card p-5">
          <div className="mb-4">
            <h2 className="text-lg font-bold">Withdraw earnings</h2>
            <p className="mt-1 text-sm text-muted-foreground">Minimum KSh 650 • Requires 3 active referrals • Paid to {p?.phone} via M-Pesa</p>
          </div>

          {elig && !elig.eligible && (
            <div className="mb-4 rounded-lg bg-warning/10 p-4 border border-warning/30 flex gap-3">
              <AlertCircle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-warning">Withdrawal unavailable</p>
                <p className="text-sm text-warning/80 mt-1">{elig.reason}</p>
              </div>
            </div>
          )}

          {elig && elig.eligible && (
            <div className="mb-4 rounded-lg bg-success/10 p-4 border border-success/30 flex gap-3">
              <div className="flex-1">
                <p className="font-semibold text-success">Ready to withdraw</p>
                <p className="text-sm text-success/80 mt-1">Available balance: {ksh(elig.available_to_withdraw)} • {elig.active_referrals} active referrals</p>
              </div>
            </div>
          )}

          <form onSubmit={withdraw} className="space-y-3">
            <div>
              <label className="text-sm font-medium">Withdrawal amount (KSh)</label>
              <input
                type="number"
                min={650}
                max={elig?.available_to_withdraw || 0}
                step={50}
                required
                disabled={!elig?.eligible || withdrawing}
                value={wAmt}
                onChange={(e) => setWAmt(e.target.value)}
                placeholder="Minimum KSh 650"
                className="input mt-2 w-full"
              />
              {elig && <p className="text-xs text-muted-foreground mt-1">Available: {ksh(elig.available_to_withdraw)}</p>}
            </div>
            <button
              type="submit"
              disabled={!elig?.eligible || withdrawing || !wAmt}
              className="btn-primary w-full"
            >
              {withdrawing ? "Processing..." : "Request withdrawal"}
            </button>
          </form>

          {wMsg && (
            <div className={`mt-3 p-3 rounded-lg text-sm ${wMsg.ok ? "bg-success/10 text-success border border-success/30" : "bg-destructive/10 text-destructive border border-destructive/30"}`}>
              {wMsg.text}
            </div>
          )}

          <div className="mt-6">
            <h3 className="font-semibold mb-3">Withdrawal history</h3>
            <div className="divide-y text-sm">
              {wds.data?.length === 0 && <p className="text-muted-foreground py-3">No withdrawals yet.</p>}
              {wds.data?.map((w) => (
                <div key={w.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium">{new Date(w.created_at).toLocaleDateString()}</p>
                    <p className={`text-xs capitalize font-medium ${w.status === "paid" ? "text-success" : w.status === "rejected" ? "text-destructive" : "text-warning"}`}>
                      {w.status}
                    </p>
                  </div>
                  <p className="font-semibold">{ksh(w.amount)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-bold">Recent activity</h2>
          <div className="card mt-3 divide-y">
            {history.data?.length === 0 && <p className="p-5 text-sm text-muted-foreground">No tasks completed yet.</p>}
            {history.data?.map((h) => (
              <div key={h.id} className="flex items-center justify-between p-4 text-sm">
                <div>
                  <p className="font-medium">{(h.tasks as { title: string } | null)?.title}</p>
                  <p className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{ksh(h.reward)}</p>
                  <p className={`text-xs capitalize ${h.status === "approved" ? "text-success" : h.status === "rejected" ? "text-destructive" : "text-warning"}`}>{h.status}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b p-3">
            <p className="truncate font-semibold">{open.title}</p>
            <button onClick={() => setOpen(null)} className="btn-ghost px-3 py-1">Close</button>
          </div>
          {open.url ? <iframe src={open.url} title={open.title} className="w-full flex-1" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" /> : <div className="flex-1" />}
          <div className="space-y-2 border-t p-4">
            {open.instructions && <p className="text-xs text-muted-foreground">{open.instructions}</p>}
            {open.url && <a href={open.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">Page not showing? Open it here <ExternalLink className="inline h-3 w-3" /></a>}
            {msg?.id === open.id && !msg.ok && <p className="text-sm text-destructive">{msg.text}</p>}
            <button onClick={() => doTask(open.id)} disabled={left > 0} className="btn-primary w-full">{left > 0 ? `Complete in ${left}s` : "Complete task"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, copy }: { icon: typeof Flame; label: string; value: string; copy?: boolean }) {
  return (
    <div className="card p-3">
      <Icon className="h-4 w-4 text-accent" />
      <p className="mt-2 text-[11px] text-muted-foreground">{label}</p>
      <p className="flex items-center gap-1 truncate text-sm font-bold">
        {value}
        {copy && value !== "—" && (
          <button aria-label="Copy" onClick={() => navigator.clipboard.writeText(value)}><Copy className="h-3 w-3 text-muted-foreground" /></button>
        )}
      </p>
    </div>
  );
}
