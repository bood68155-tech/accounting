import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import {
  IconCoin,
  IconDatabase,
  IconLedger,
  IconReport,
  IconShield,
  IconSparkles,
  IconWebhook,
} from "@/components/icons";
import { KineticHero } from "@/components/landing/kinetic-hero";
import { DashboardReveal } from "@/components/landing/dashboard-reveal";
import { Marquee, ValueSections } from "@/components/landing/value-sections";
import { Reveal } from "@/components/landing/reveal";

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

      {/* ─── Kinetic hero: scroll-scrubbed manifesto ─────────────────────────── */}
      <KineticHero />

      {/* ─── Dashboard reveal: scroll scrubs through the product ─────────────── */}
      <DashboardReveal />

      {/* ─── Marquee: kinetic strip ──────────────────────────────────────────── */}
      <Marquee />

      {/* ─── Value sections: 01–04 high-impact capabilities ──────────────────── */}
      <ValueSections />

      {/* ─── Capabilities grid ───────────────────────────────────────────────── */}
      <section id="features" className="border-b border-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-24">
          <Reveal>
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <div>
                <p className="type-kicker text-accent">05 — Under the hood</p>
                <h2 className="type-display mt-4 text-3xl sm:text-4xl md:text-5xl">
                  Built like a ledger.
                  <br />
                  Sharp as a knife.
                </h2>
              </div>
              <p className="max-w-md text-sm leading-relaxed text-zinc-400">
                Store Accountant turns messy platform data into clean, double-entry books — so you
                always know what you&apos;re really making.
              </p>
            </div>
          </Reveal>

          <div className="mt-12 grid-join grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature, i) => (
              <Reveal
                key={feature.title}
                delay={(i % 3) * 80}
                className="group transition-colors duration-100 hover:bg-accent"
              >
                <div className="frame-icon transition-colors duration-100 group-hover:border-black">
                  <feature.icon className="h-5 w-5 text-white transition-colors duration-100 group-hover:text-black" />
                </div>
                <h3 className="mt-5 text-sm font-bold uppercase tracking-[0.06em] text-white transition-colors duration-100 group-hover:text-black">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400 transition-colors duration-100 group-hover:text-black/80">
                  {feature.body}
                </p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Playbook: numbered editorial steps ──────────────────────────────── */}
      <section id="how" className="border-b border-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-24">
          <Reveal>
            <p className="type-kicker text-accent">06 — The playbook</p>
            <h2 className="type-display mt-4 text-3xl sm:text-4xl md:text-5xl">
              From webhook
              <br />
              to income statement
            </h2>
          </Reveal>

          <div className="mt-12 grid-join grid-cols-1 sm:grid-cols-2 md:grid-cols-4">
            {STEPS.map((step, i) => (
              <Reveal key={step.n} delay={i * 90}>
                <p className="font-mono text-4xl font-bold text-accent">{step.n}</p>
                <h3 className="mt-4 text-sm font-bold uppercase tracking-[0.06em] text-white">
                  {step.title}
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-zinc-400">{step.body}</p>
              </Reveal>
            ))}
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

      {/* ─── CTA: full-bleed signal-red block ───────────────────────────────── */}
      <section className="block-accent">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 md:py-28">
          <p className="type-kicker text-white/70">07 — Start</p>
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
            Store Accountant — Automated AI Accounting &amp; Profitability Engine
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
