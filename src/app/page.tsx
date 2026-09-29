import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
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
    title: "Schema-per-tenant isolation",
    body: "Every workspace gets its own Postgres schema with RLS — tenants can never see each other's stores, orders or books.",
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

const INTEGRATIONS = ["Shopify", "WooCommerce", "Stripe", "PayPal", "Custom webhooks"];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-app text-white">
      {/* ─── Nav: solid 1px rule ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-white bg-black/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <nav className="type-kicker hidden items-center gap-8 text-zinc-400 md:flex">
            <a href="#features" className="transition-colors duration-100 hover:text-white">Features</a>
            <a href="#how" className="transition-colors duration-100 hover:text-white">Playbook</a>
            <a href="#integrations" className="transition-colors duration-100 hover:text-white">Integrations</a>
          </nav>
          <div className="flex items-center gap-4">
            <Link
              href="/login"
              className="type-kicker text-zinc-300 transition-colors duration-100 hover:text-white"
            >
              Sign in
            </Link>
            <Button href="/dashboard" size="sm" className="hidden sm:inline-flex">
              Open dashboard
            </Button>
          </div>
        </div>
      </header>

      {/* ─── Hero: high-impact editorial statement ──────────────────────────── */}
      <section className="border-b border-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-24">
          <p className="type-kicker text-accent">
            00 — Automated AI accounting for e-commerce
          </p>
          <h1 className="type-display mt-6 text-[13vw] leading-[0.92] sm:text-6xl md:text-7xl lg:text-8xl">
            Revenue is vanity.
            <br />
            <span className="bg-accent px-2 box-decoration-clone">
              True net profit
            </span>{" "}
            is sanity.
          </h1>
          <div className="mt-10 grid gap-8 md:grid-cols-2 md:items-end">
            <p className="max-w-xl text-base leading-relaxed text-zinc-400 md:text-lg">
              X connects to your online store, computes profit after item cost, shipping and
              payment fees, and runs your double-entry bookkeeping — general ledger, COGS and
              income statements included.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row md:justify-end">
              <Button href="/dashboard" size="lg">
                <IconZap className="h-4.5 w-4.5" /> Get started
              </Button>
              <Button href="/signup" size="lg" variant="outline">
                Create free account
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Dashboard preview: joined 1px grid, flat bars ──────────────────── */}
      <section className="border-b border-white bg-zinc-950">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 md:py-20">
          <div className="border border-white bg-black">
            {/* window chrome */}
            <div className="flex items-center justify-between border-b border-white px-4 py-3">
              <span className="type-kicker text-zinc-500">X / Dashboard</span>
              <span className="hidden font-mono text-[10px] text-zinc-600 sm:block">
                app.x-accounting.com/dashboard
              </span>
            </div>
            {/* stat cells */}
            <div className="grid-join grid-cols-2 md:grid-cols-4">
              {[
                { label: "Revenue · 30d", value: "$24,812", delta: "+12.4%" },
                { label: "True net profit", value: "$9,317", delta: "+8.1%" },
                { label: "Orders · 30d", value: "412", delta: "+5.2%" },
                { label: "Net margin", value: "37.6%", delta: "+1.4%" },
              ].map((stat) => (
                <div key={stat.label} className="!p-4 sm:!p-5">
                  <p className="type-kicker text-zinc-500">{stat.label}</p>
                  <p className="mt-2 text-xl font-extrabold tracking-tight text-white tabular-nums sm:text-2xl">
                    {stat.value}
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-accent">
                    <IconArrowUp className="h-3 w-3" /> {stat.delta}
                  </p>
                </div>
              ))}
            </div>
            {/* chart strip */}
            <div className="grid gap-px border-t border-white bg-white md:grid-cols-[1fr_220px]">
              <div className="flex h-40 items-end gap-1.5 bg-black p-5 sm:h-48 sm:gap-2">
                {[34, 52, 41, 63, 58, 78, 92].map((h, i) => (
                  <div
                    key={i}
                    className={`flex-1 ${i === 6 ? "bg-white" : "bg-accent"}`}
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
              <div className="hidden border-l border-white bg-black p-5 md:block">
                <p className="type-kicker text-zinc-500">Where money goes</p>
                <div className="mt-4 space-y-3">
                  {[
                    { label: "Net profit 42%", cls: "bg-accent" },
                    { label: "COGS 34%", cls: "bg-white" },
                    { label: "Fees & shipping 24%", cls: "bg-zinc-600" },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-2.5 text-xs font-medium text-zinc-300">
                      <span className={`h-2.5 w-2.5 ${item.cls}`} /> {item.label}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Integrations: solid strip, joined cells ────────────────────────── */}
      <section id="integrations" className="border-b border-white">
        <div className="grid-join grid-cols-2 md:grid-cols-5">
          {INTEGRATIONS.map((name) => (
            <div key={name} className="!flex !items-center !justify-center !py-5">
              <span className="text-sm font-bold uppercase tracking-[0.1em] text-white">{name}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Features: 01 — Capabilities ────────────────────────────────────── */}
      <section id="features" className="border-b border-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-24">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <p className="type-kicker text-accent">01 — Capabilities</p>
              <h2 className="type-display mt-4 text-3xl sm:text-4xl md:text-5xl">
                Built like a ledger.
                <br />
                Sharp as a knife.
              </h2>
            </div>
            <p className="max-w-md text-sm leading-relaxed text-zinc-400">
              X turns messy platform data into clean, double-entry books — so you always know
              what you&apos;re really making.
            </p>
          </div>

          <div className="mt-12 grid-join grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="group transition-colors duration-100 hover:bg-accent">
                <div className="frame-icon">
                  <feature.icon className="h-5 w-5 text-white" />
                </div>
                <h3 className="mt-5 text-sm font-bold uppercase tracking-[0.06em] text-white">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400 group-hover:text-white/90">
                  {feature.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Playbook: 02 — numbered editorial steps ────────────────────────── */}
      <section id="how" className="border-b border-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-24">
          <p className="type-kicker text-accent">02 — The playbook</p>
          <h2 className="type-display mt-4 text-3xl sm:text-4xl md:text-5xl">
            From webhook
            <br />
            to income statement
          </h2>

          <div className="mt-12 grid-join grid-cols-1 sm:grid-cols-2 md:grid-cols-4">
            {STEPS.map((step) => (
              <div key={step.n}>
                <p className="font-mono text-4xl font-bold text-accent">{step.n}</p>
                <h3 className="mt-4 text-sm font-bold uppercase tracking-[0.06em] text-white">
                  {step.title}
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-zinc-400">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA: full-bleed signal-red block ───────────────────────────────── */}
      <section className="block-accent">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 md:py-28">
          <p className="type-kicker text-white/70">03 — Start</p>
          <h2 className="type-display mt-4 text-4xl sm:text-5xl md:text-6xl">
            Start seeing your
            <br />
            real numbers today.
          </h2>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-white/85">
            Sign up free, connect your store, and your first webhook posts the books — profit,
            ledger and income statement included.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="inline-flex h-12 items-center justify-center gap-2 border border-black bg-black px-7 text-[15px] font-semibold uppercase tracking-[0.08em] text-white transition-colors duration-100 hover:bg-white hover:text-black"
            >
              <IconSparkles className="h-4.5 w-4.5" /> Get started
            </Link>
            <Link
              href="/login"
              className="inline-flex h-12 items-center justify-center border border-white bg-transparent px-7 text-[15px] font-semibold uppercase tracking-[0.08em] text-white transition-colors duration-100 hover:bg-white hover:text-black"
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="bg-app">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center">
          <Logo size={24} />
          <p className="type-kicker text-zinc-600">
            X — Automated AI Accounting &amp; Profitability Engine
          </p>
          <div className="type-kicker flex gap-6 text-zinc-500">
            <a href="#features" className="transition-colors duration-100 hover:text-white">Features</a>
            <a href="#how" className="transition-colors duration-100 hover:text-white">Playbook</a>
            <Link href="/login" className="transition-colors duration-100 hover:text-white">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
