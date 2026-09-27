import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight, BadgeCheck, ClipboardList, Eye, FileText, Gamepad2, HeadphonesIcon, LineChart, Lock,
  Megaphone, PenTool, Search, ShieldCheck, ShoppingBag, Smartphone, Users, Video, Wallet, Share2, UserPlus, MousePointerClick, CheckCircle2,
} from "lucide-react";
import heroPhone from "@/assets/hero-phone.png";
import { PublicLayout } from "@/components/site/PublicLayout";
import { LiveTasks } from "@/components/site/LiveTasks";
import { LiveActivity } from "@/components/site/LiveActivity";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SmartEarn — Turn Your Time Into Real Earnings" },
      { name: "description", content: "SmartEarn connects Kenyans with verified online tasks — surveys, videos, app tests and more — with transparent rewards and M-Pesa withdrawals." },
      { property: "og:title", content: "SmartEarn — Turn Your Time Into Real Earnings" },
      { property: "og:description", content: "Complete online tasks, get verified, and withdraw your earnings to M-Pesa." },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "https://smarttearnn.vercel.app/smart-earn-og.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://smarttearnn.vercel.app/smart-earn-og.png" },
    ],
  }),
  component: Home,
});

const categories = [
  { icon: ClipboardList, name: "Surveys" }, { icon: Video, name: "Videos" }, { icon: Smartphone, name: "App Tasks" },
  { icon: Share2, name: "Social Media" }, { icon: FileText, name: "Data Entry" }, { icon: Gamepad2, name: "Gaming" },
  { icon: Users, name: "Referrals" }, { icon: ShoppingBag, name: "Shopping" }, { icon: PenTool, name: "Content Creation" },
  { icon: Search, name: "Research" }, { icon: Megaphone, name: "Promotional" }, { icon: LineChart, name: "More coming" },
];

const steps = [
  { icon: UserPlus, t: "Create account", d: "Sign up with your phone number." },
  { icon: MousePointerClick, t: "Choose a task", d: "Pick from tasks open right now." },
  { icon: CheckCircle2, t: "Complete it", d: "Follow the clear instructions." },
  { icon: Eye, t: "Verification", d: "We check the task was done properly." },
  { icon: Wallet, t: "Get credited", d: "Rewards land in your balance." },
  { icon: ArrowRight, t: "Withdraw", d: "Cash out to M-Pesa once eligible." },
];

const features = [
  { icon: Lock, t: "Secure account", d: "Phone + password login with fraud checks on every account." },
  { icon: BadgeCheck, t: "Transparent rewards", d: "Every task shows its exact reward before you start." },
  { icon: ShieldCheck, t: "Task verification", d: "Proof-based tasks are reviewed so rewards stay fair." },
  { icon: Wallet, t: "M-Pesa withdrawals", d: "Request payouts to your registered M-Pesa number." },
  { icon: HeadphonesIcon, t: "Real support", d: "Reach our team from the Help page any time." },
  { icon: LineChart, t: "Clear activity", d: "See every task, reward and payout status in your dashboard." },
];

const faqs = [
  { q: "Is it free to join?", a: "Creating an account is free. Some tasks are available right away; full access to all tasks and withdrawals requires a one-time account activation." },
  { q: "How much does activation cost?", a: "Starter KSh 200, Standard KSh 350 or Pro KSh 550. Higher plans earn more per task. Activation is paid via M-Pesa from inside your dashboard only." },
  { q: "When can I withdraw?", a: "When your balance is at least KSh 650, you have 3 active referrals and your account is active. A 5% fee (minimum KSh 30) applies and payouts are processed within 24–72 hours." },
  { q: "How are tasks verified?", a: "Simple tasks are credited instantly. Tasks that need proof (like app installs or social shares) are reviewed by our team before crediting." },
  { q: "Can I have more than one account?", a: "No. Each person may have one account per phone number and device. Duplicate accounts are suspended." },
];

function Home() {
  return (
    <PublicLayout>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-glow" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl items-center gap-8 px-4 pb-10 pt-10 md:grid-cols-2 md:pt-16">
          <div>
            <span className="chip border bg-card text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Online tasks for Kenya
            </span>
            <h1 className="mt-4 text-4xl font-extrabold leading-[1.05] md:text-6xl">
              Turn your time into <span className="text-brand">real earnings</span>
            </h1>
            <p className="mt-4 max-w-md text-base text-muted-foreground md:text-lg">
              SmartEarn connects you with available online tasks — surveys, videos, app tests and more. Complete them, get verified, and withdraw to M-Pesa.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link to="/register" className="btn-primary py-3.5">Create Free Account <ArrowRight className="h-4 w-4" /></Link>
              <a href="#tasks" className="btn-outline py-3.5">Explore Tasks</a>
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-sm md:max-w-md">
            <img src={heroPhone} alt="SmartEarn app showing tasks and balance" width={1024} height={1024} className="w-full drop-shadow-2xl" />
          </div>
        </div>
      </section>

      <LiveTasks />
      <LiveActivity />

      {/* Categories */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <p className="eyebrow">Earning categories</p>
        <h2 className="mt-2 text-2xl font-bold md:text-3xl">Many ways to earn</h2>
        <div className="mt-6 grid grid-cols-3 gap-3 md:grid-cols-6">
          {categories.map(({ icon: Icon, name }) => (
            <div key={name} className="card flex flex-col items-center gap-2 p-4 text-center">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-primary"><Icon className="h-5 w-5" /></span>
              <span className="text-xs font-medium">{name}</span>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-card py-14">
        <div className="mx-auto max-w-6xl px-4">
          <p className="eyebrow">How it works</p>
          <h2 className="mt-2 text-2xl font-bold md:text-3xl">From sign-up to M-Pesa in six steps</h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {steps.map(({ icon: Icon, t, d }, i) => (
              <li key={t} className="flex gap-4 rounded-2xl border p-5">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand text-primary-foreground"><Icon className="h-5 w-5" /></span>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground">Step {i + 1}</p>
                  <p className="font-semibold">{t}</p>
                  <p className="text-sm text-muted-foreground">{d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Trust */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <p className="eyebrow">Platform</p>
        <h2 className="mt-2 text-2xl font-bold md:text-3xl">Built to be fair and transparent</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, t, d }) => (
            <div key={t} className="card p-5">
              <Icon className="h-6 w-6 text-accent" />
              <p className="mt-3 font-semibold">{t}</p>
              <p className="mt-1 text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Payments */}
      <section className="mx-auto max-w-6xl px-4 pb-14">
        <div className="grid gap-6 overflow-hidden rounded-3xl bg-navy-gradient p-7 text-navy-foreground md:grid-cols-2 md:p-10">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-electric">Payments & withdrawals</p>
            <h2 className="mt-2 text-2xl font-bold md:text-3xl">Clear rules, official M-Pesa only</h2>
            <p className="mt-3 text-sm opacity-75">Account activation is paid via an M-Pesa prompt sent to your phone from inside your dashboard. We will never ask you to send money to a personal number.</p>
          </div>
          <ul className="space-y-3 text-sm">
            {[
              ["Activation plans", "Starter KSh 200 · Standard KSh 350 · Pro KSh 550"],
              ["Minimum withdrawal", "KSh 650 balance + 3 active referrals"],
              ["Withdrawal fee", "5% (minimum KSh 30)"],
              ["Processing time", "24–72 hours to your M-Pesa"],
            ].map(([k, v]) => (
              <li key={k} className="flex justify-between gap-4 rounded-xl bg-navy-foreground/5 px-4 py-3">
                <span className="opacity-70">{k}</span><span className="text-right font-medium">{v}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 pb-14">
        <h2 className="text-center text-2xl font-bold md:text-3xl">Frequently asked questions</h2>
        <div className="mt-6 space-y-3">
          {faqs.map((f) => (
            <details key={f.q} className="card group p-5">
              <summary className="cursor-pointer list-none font-semibold marker:hidden">{f.q}</summary>
              <p className="mt-2 text-sm text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-16">
        <div className="rounded-3xl bg-brand p-8 text-center text-primary-foreground md:p-12">
          <h2 className="text-2xl font-bold md:text-4xl">Ready to start earning?</h2>
          <p className="mx-auto mt-2 max-w-md opacity-90">Create your free account in under a minute.</p>
          <Link to="/register" className="btn mt-6 bg-card text-foreground hover:bg-secondary">Create Free Account <ArrowRight className="h-4 w-4" /></Link>
        </div>
      </section>
    </PublicLayout>
  );
}
