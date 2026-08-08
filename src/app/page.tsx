import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  IconArrowUp,
  IconCoin,
  IconDatabase,
  IconLedger,
  IconReport,
  IconShield,
  IconSparkles,
  IconWebhook,
  IconZap,
} from "@/components/icons";

const FEATURES = [
  {
    icon: IconWebhook,
    title: "Webhook & API integrations",
    body: "Connect Shopify, WooCommerce, Stripe and PayPal in minutes. Payloads are signature-verified and normalized automatically.",
  },
  {
    icon: IconCoin,
    title: "True net profit, per order",
    body: "Item cost × quantity, shipping, gateway fees, discounts and refunds — the engine shows what each order actually earns you.",
  },
  {
    icon: IconLedger,
    title: "Automated double-entry",
    body: "Every sale posts balanced journal entries: Dr Cash, Cr Sales, Dr COGS, Cr Inventory. Your general ledger stays perfect.",
  },
  {
    icon: IconReport,
    title: "Financial statements",
    body: "Income statement, chart of accounts and trial balance — generated from the ledger with margins at every level.",
  },
  {
    icon: IconDatabase,
    title: "Supabase & RLS",
    body: "Postgres with row-level security means every user can only ever see their own stores, orders and books.",
  },
  {
    icon: IconShield,
    title: "Audit-ready books",
    body: "Journal entries can't go out of balance, every source event is recorded, and everything ties back to revenue.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Connect your store",
    body: "Add a store and point its webhook at your endpoint. We verify every payload's signature.",
  },
  {
    n: "02",
    title: "The engine computes profit",
    body: "Gross sales → COGS → gateway fees → shipping → refunds. True net profit per order, automatically.",
  },
  {
    n: "03",
    title: "Books post themselves",
    body: "Balanced double-entry journal entries update the general ledger and chart of accounts.",
  },
  {
    n: "04",
    title: "Read your income statement",
    body: "Revenue, gross profit and net profit — drillable by store, period and product.",
  },
];

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0b0d10]">
      {/* Backdrop */}
      <div className="pointer-events-none absolute inset-0">
        <div className="bg-grid bg-grid-fade absolute inset-0" />
        <div className="glow-emerald absolute -top-32 left-1/4 h-96 w-96 rounded-full blur-3xl" />
        <div className="glow-sky absolute -right-24 top-40 h-80 w-80 rounded-full blur-3xl" />
        <div className="glow-amber absolute bottom-0 left-1/2 h-72 w-[40rem] -translate-x-1/2 rounded-full blur-3xl" />
      </div>

      {/* Nav */}
      <header className="relative z-10 mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Logo />
        <nav className="hidden items-center gap-8 text-sm text-zinc-400 md:flex">
          <a href="#features" className="transition-colors hover:text-zinc-100">Features</a>
          <a href="#how" className="transition-colors hover:text-zinc-100">How it works</a>
          <a href="#integrations" className="transition-colors hover:text-zinc-100">Integrations</a>
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm font-medium text-zinc-300 transition-colors hover:text-zinc-100">
            Sign in
          </Link>
          <Button href="/dashboard" size="sm">Open dashboard</Button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-24 pt-20 text-center">
        <div className="animate-fade-up">
          <Badge variant="default" className="mb-6 px-3 py-1 text-xs">
            <IconSparkles className="h-3.5 w-3.5" /> Automated AI accounting for e-commerce
          </Badge>
          <h1 className="mx-auto max-w-3xl text-5xl font-bold leading-[1.08] tracking-tight text-zinc-50 md:text-6xl">
            Know your{" "}
            <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">
              true net profit
            </span>
            , not just revenue.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-zinc-400">
            Store Accountant connects to your online store, computes profit after item cost, shipping and payment
            fees, and runs your double-entry bookkeeping — general ledger, COGS and income statements included.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button href="/dashboard" size="lg">
              <IconZap className="h-4.5 w-4.5" /> Explore the live demo
            </Button>
            <Button href="/login" size="lg" variant="outline">
              Create free account
            </Button>
          </div>
          <p className="mt-4 text-xs text-zinc-600">No credit card · Supabase-backed · Webhook-first</p>
        </div>

        {/* Dashboard preview */}
        <div className="relative mx-auto mt-16 max-w-4xl animate-fade-up" style={{ animationDelay: "0.15s" }}>
          <div className="absolute -inset-x-8 -top-8 h-40 rounded-[3rem] bg-emerald-500/10 blur-3xl" />
          <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/80 shadow-2xl backdrop-blur">
            <div className="flex items-center gap-1.5 border-b border-zinc-800 px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
              <span className="ml-3 rounded-md bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-500">
                app.store-accountant.com/dashboard
              </span>
            </div>
            <div className="grid grid-cols-2 gap-px bg-zinc-800/60 md:grid-cols-4">
              {[
                { label: "Revenue · 30d", value: "$24,812", delta: "+12.4%", up: true },
                { label: "True net profit", value: "$9,317", delta: "+8.1%", up: true },
                { label: "Orders · 30d", value: "412", delta: "+5.2%", up: true },
                { label: "Net margin", value: "37.6%", delta: "+1.4%", up: true },
              ].map((stat) => (
                <div key={stat.label} className="bg-zinc-900/90 p-5 text-left">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{stat.label}</p>
                  <p className="mt-1.5 text-xl font-bold text-zinc-50 tabular-nums">{stat.value}</p>
                  <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                    <IconArrowUp className="h-3 w-3" /> {stat.delta}
                  </p>
                </div>
              ))}
            </div>
            <div className="flex items-end gap-6 bg-zinc-900/90 p-6">
              <div className="flex h-32 flex-1 items-end gap-2">
                {[34, 52, 41, 63, 58, 78, 92].map((h, i) => (
                  <div key={i} className="flex-1 rounded-t-md bg-gradient-to-t from-emerald-600/60 to-emerald-400/90" style={{ height: `${h}%` }} />
                ))}
              </div>
              <div className="hidden w-44 rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 text-left sm:block">
                <p className="text-[10px] uppercase tracking-wider text-zinc-500">Where money goes</p>
                <div className="mt-3 space-y-2">
                  {[
                    { label: "Net profit 42%", color: "bg-emerald-400" },
                    { label: "COGS 34%", color: "bg-sky-400" },
                    { label: "Fees & shipping 24%", color: "bg-amber-400" },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-2 text-[11px] text-zinc-400">
                      <span className={`h-2 w-2 rounded-sm ${item.color}`} /> {item.label}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Integrations */}
      <section id="integrations" className="relative z-10 border-t border-zinc-800/60 py-14">
        <div className="mx-auto max-w-6xl px-6">
          <p className="text-center text-xs font-medium uppercase tracking-[0.2em] text-zinc-600">
            Connects to the platforms you already sell on
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {[
              { name: "Shopify", color: "text-[#95bf47]" },
              { name: "WooCommerce", color: "text-[#9b7edb]" },
              { name: "Stripe", color: "text-[#8b84ff]" },
              { name: "PayPal", color: "text-[#ffc439]" },
              { name: "Custom webhooks", color: "text-zinc-300" },
            ].map((p) => (
              <span key={p.name} className={`rounded-full border border-zinc-800 bg-zinc-900/60 px-4 py-1.5 text-sm font-semibold ${p.color}`}>
                {p.name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="relative z-10 mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-zinc-50 md:text-4xl">
            Revenue is vanity. <span className="text-emerald-400">Profit is sanity.</span>
          </h2>
          <p className="mt-4 text-zinc-400">
            Store Accountant turns messy platform data into clean, double-entry books — so you always know what
            you&apos;re really making.
          </p>
        </div>
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="group rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-500/40 hover:bg-zinc-900/70"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-emerald-400 transition-transform duration-200 group-hover:scale-110">
                <feature.icon className="h-5.5 w-5.5" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-zinc-100">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-500">{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="relative z-10 border-t border-zinc-800/60 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-zinc-50 md:text-4xl">From webhook to income statement</h2>
            <p className="mt-4 text-zinc-400">No CSV imports. No manual journal entries. Just connect and watch the books post themselves.</p>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-4">
            {STEPS.map((step, i) => (
              <div key={step.n} className="relative rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-emerald-500">{step.n}</span>
                  {i < STEPS.length - 1 && (
                    <span className="hidden h-px flex-1 bg-gradient-to-r from-emerald-500/40 to-transparent md:block" />
                  )}
                </div>
                <h3 className="mt-3 text-sm font-semibold text-zinc-100">{step.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-zinc-500">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-24">
        <div className="relative overflow-hidden rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.08] to-teal-500/[0.03] px-8 py-14 text-center">
          <div className="glow-emerald absolute -top-20 left-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full blur-3xl" />
          <h2 className="relative text-3xl font-bold tracking-tight text-zinc-50 md:text-4xl">
            Start seeing your real numbers today
          </h2>
          <p className="relative mx-auto mt-4 max-w-xl text-zinc-400">
            Explore the fully-working demo with sample data, then connect your store and your first webhook.
          </p>
          <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button href="/dashboard" size="lg">
              <IconSparkles className="h-4.5 w-4.5" /> Explore the demo
            </Button>
            <Button href="/login" size="lg" variant="outline">
              Sign in
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-zinc-800/60 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 md:flex-row">
          <Logo size={24} />
          <p className="text-xs text-zinc-600">
            Store Accountant · Automated AI Accounting &amp; Profitability Engine for E-commerce
          </p>
          <div className="flex gap-6 text-xs text-zinc-500">
            <a href="#features" className="transition-colors hover:text-zinc-300">Features</a>
            <a href="#how" className="transition-colors hover:text-zinc-300">How it works</a>
            <Link href="/login" className="transition-colors hover:text-zinc-300">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
