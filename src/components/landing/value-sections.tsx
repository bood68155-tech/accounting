import { cn } from "@/lib/utils";
import {
  IconCheck,
  IconCoin,
  IconDatabase,
  IconShield,
  IconZap,
} from "@/components/icons";
import { Parallax, Reveal } from "./reveal";

/* ─── Marquee ─────────────────────────────────────────────────────────────── */

const MARQUEE_ITEMS = [
  "True net profit",
  "Double-entry ledger",
  "Product COGS",
  "Multi-tenant isolation",
  "CSV / audit export",
  "AI assistant",
];

export function Marquee() {
  const row = (
    <div className="flex shrink-0 items-center">
      {MARQUEE_ITEMS.map((item) => (
        <span key={item} className="flex items-center">
          <span className="px-6 text-sm font-extrabold uppercase tracking-[0.14em] text-black">
            {item}
          </span>
          <span aria-hidden className="text-black">
            {"///"}
          </span>
        </span>
      ))}
    </div>
  );
  return (
    <div aria-hidden className="overflow-hidden border-b border-white bg-accent py-3.5">
      <div className="animate-marquee flex w-max">
        {row}
        {row}
      </div>
    </div>
  );
}

/* ─── Value sections ──────────────────────────────────────────────────────── */

type ValueSectionProps = {
  index: string;
  kicker: string;
  title: React.ReactNode;
  body: string;
  bullets: string[];
  icon: React.ComponentType<{ className?: string }>;
  visual: React.ReactNode;
  flip?: boolean;
};

function ValueSection({ index, kicker, title, body, bullets, icon: Icon, visual, flip }: ValueSectionProps) {
  return (
    <section className="relative overflow-hidden border-b border-white">
      {/* Giant parallax numeral */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 hidden w-1/2 md:block",
          flip ? "left-0" : "right-0",
        )}
      >
        <div className={cn("flex h-full items-center", flip ? "justify-start" : "justify-end")}>
          <Parallax speed={0.12}>
            <span className="type-display text-outline-faint select-none text-[15rem] leading-none lg:text-[21rem]">
              {index}
            </span>
          </Parallax>
        </div>
      </div>

      <div className="relative mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 md:grid-cols-2 md:py-28 lg:gap-16">
        <Reveal className={cn(flip && "md:order-2")}>
          <p className="type-kicker flex items-center gap-3 text-accent">
            <Icon className="h-4 w-4" />
            {index} — {kicker}
          </p>
          <h2 className="type-display mt-5 text-4xl sm:text-5xl md:text-6xl">{title}</h2>
          <p className="mt-6 max-w-md text-sm leading-relaxed text-zinc-400 md:text-base">{body}</p>
          <ul className="mt-8 space-y-3">
            {bullets.map((bullet) => (
              <li key={bullet} className="flex items-start gap-3 border-b border-white/15 pb-3">
                <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <span className="text-sm font-medium text-zinc-200">{bullet}</span>
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal
          delay={140}
          className={cn("w-full max-w-md self-center", flip ? "md:order-1 md:justify-self-end" : "md:justify-self-start")}
        >
          {visual}
        </Reveal>
      </div>
    </section>
  );
}

/* ─── Mini visuals: static product vignettes with hover kinetics ──────────── */

function FrameHeader({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white px-3.5 py-2.5">
      <span className="type-kicker text-white">{title}</span>
      <span className="font-mono text-[9px] text-zinc-600">{meta}</span>
    </div>
  );
}

function MiniPL() {
  return (
    <div className="group border border-white bg-black transition-shadow duration-150 hover:shadow-[8px_8px_0_0_#ff3b00]">
      <FrameHeader title="True P&L — September" meta="auto-posted" />
      <div className="p-3.5 text-[11px] sm:text-xs">
        {[
          { label: "Gross sales", amount: "$24,812.00" },
          { label: "COGS", amount: "−$8,436.00" },
          { label: "Payment fees", amount: "−$1,387.00" },
          { label: "Shipping", amount: "−$2,041.00" },
          { label: "Refunds", amount: "−$519.00" },
        ].map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between border-b border-white/15 py-1.5 tabular-nums transition-colors duration-100 hover:bg-zinc-900"
          >
            <span className="text-zinc-400">{row.label}</span>
            <span className="text-zinc-200">{row.amount}</span>
          </div>
        ))}
        <div className="mt-3 flex items-center justify-between bg-accent px-2.5 py-2 transition-transform duration-150 group-hover:translate-x-0.5">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-white">Net profit</span>
          <span className="text-xs font-extrabold tabular-nums text-white">$9,317.00 · 37.6%</span>
        </div>
        <div className="mt-4 flex h-14 items-end gap-1">
          {[38, 52, 44, 61, 57, 74, 69, 88].map((h, i) => (
            <div key={i} className={cn("flex-1", i === 7 ? "bg-white" : "bg-accent/80")} style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MiniCOGS() {
  return (
    <div className="border border-white bg-black transition-shadow duration-150 hover:shadow-[8px_8px_0_0_#ff3b00]">
      <FrameHeader title="COGS per product" meta="catalog-synced" />
      <div className="space-y-3 p-3.5">
        {[
          { name: "Orbit tee", unit: "$8.40", pct: 34, color: "bg-accent" },
          { name: "Halo hoodie", unit: "$21.10", pct: 41, color: "bg-white" },
          { name: "Nova cap", unit: "$5.20", pct: 25, color: "bg-zinc-600" },
        ].map((row) => (
          <div key={row.name} className="border border-white/25 p-2.5 transition-colors duration-100 hover:bg-zinc-900">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-white">{row.name}</span>
              <span className="font-mono text-[9px] tabular-nums text-zinc-400">unit {row.unit}</span>
            </div>
            <div className="mt-1.5 h-1.5 bg-zinc-800">
              <div className={cn("h-full transition-all duration-300", row.color)} style={{ width: `${row.pct}%` }} />
            </div>
          </div>
        ))}
        <p className="font-mono text-[9px] leading-relaxed text-zinc-600">
          margin_floor: 22% — 1 SKU flagged below floor by anomaly engine
        </p>
      </div>
    </div>
  );
}

function MiniTenants() {
  const tenants = [
    { id: "tenant_a91f", you: false },
    { id: "tenant_9f2c", you: true },
    { id: "tenant_b04e", you: false },
  ];
  return (
    <div className="border border-white bg-black transition-shadow duration-150 hover:shadow-[8px_8px_0_0_#ff3b00]">
      <FrameHeader title="Schema-per-tenant" meta="RLS enforced" />
      <div className="grid grid-cols-3 gap-px bg-white">
        {tenants.map((tenant) => (
          <div
            key={tenant.id}
            className={cn(
              "bg-black p-2.5 transition-colors duration-100 hover:bg-zinc-900",
              tenant.you && "bg-accent hover:bg-accent",
            )}
          >
            <p className={cn("font-mono text-[8px] font-bold sm:text-[9px]", tenant.you ? "text-white" : "text-zinc-400")}>
              {tenant.id}
            </p>
            <div className="mt-2 space-y-1">
              {["orders", "ledger", "products"].map((table) => (
                <div
                  key={table}
                  className={cn(
                    "border px-1 py-0.5 text-center font-mono text-[7px] uppercase sm:text-[8px]",
                    tenant.you ? "border-white/60 text-white" : "border-white/25 text-zinc-500",
                  )}
                >
                  {table}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between px-3.5 py-2.5">
        <span className="type-kicker text-zinc-600">No shared rows</span>
        <span className="type-kicker text-accent">Isolated by design</span>
      </div>
    </div>
  );
}

function MiniExport() {
  return (
    <div className="border border-white bg-black transition-shadow duration-150 hover:shadow-[8px_8px_0_0_#ff3b00]">
      <FrameHeader title="Export / audit" meta="signed · instant" />
      <div className="space-y-1.5 p-3.5 font-mono text-[10px] sm:text-[11px]">
        <p className="text-zinc-500">$ store-accountant export --period 2026-09</p>
        {[
          { file: "journal_entries.csv", rows: "4,212 rows" },
          { file: "orders_normalized.csv", rows: "1,908 rows" },
          { file: "cogs_per_product.csv", rows: "312 rows" },
          { file: "trial_balance.csv", rows: "48 rows" },
        ].map((row) => (
          <div key={row.file} className="flex items-center justify-between text-zinc-300 transition-colors duration-100 hover:text-white">
            <span>
              <span className="text-accent">✓</span> {row.file}
            </span>
            <span className="tabular-nums text-zinc-600">{row.rows}</span>
          </div>
        ))}
        <div className="mt-3 flex items-center justify-between bg-white px-2.5 py-2 text-black transition-colors duration-100 hover:bg-accent hover:text-white">
          <span className="text-[10px] font-extrabold uppercase tracking-[0.1em]">Download .zip</span>
          <span className="text-[10px] font-bold tabular-nums">SHA-256 signed</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Composed section stack ──────────────────────────────────────────────── */

export function ValueSections() {
  return (
    <>
      <ValueSection
        index="01"
        kicker="Automated profit / loss"
        title={
          <>
            Every order knows
            <br />
            what it earns.
          </>
        }
        body="Revenue is vanity. Store Accountant nets out item cost, shipping, gateway fees, discounts and refunds — per order, per SKU, per day — and posts it to your books automatically."
        bullets={[
          "True net profit computed on every webhook, in real time",
          "Refunds, partial refunds and fee reversals handled for you",
          "Profit engine runs the same math as your journal entries",
        ]}
        icon={IconZap}
        visual={<MiniPL />}
      />
      <ValueSection
        index="02"
        kicker="Product COGS breakdown"
        title={
          <>
            Know your unit
            <br />
            economics cold.
          </>
        }
        body="Item costs sync from your catalog and attach to every line item. See exactly which products carry the margin — and which quietly bleed it."
        bullets={[
          "Per-product, per-unit cost breakdown across every order",
          "Margin floors with automatic anomaly flags",
          "COGS posted to the ledger on every sale — inventory stays honest",
        ]}
        icon={IconCoin}
        visual={<MiniCOGS />}
        flip
      />
      <ValueSection
        index="03"
        kicker="Multi-tenant isolation"
        title={
          <>
            Your books.
            <br />
            Nobody else&apos;s.
          </>
        }
        body="Every workspace gets its own Postgres schema with row-level security. Stores, orders and ledgers are walled off — tenants can never see each other's numbers."
        bullets={[
          "Dedicated schema per tenant — no shared rows, ever",
          "Row-level security keyed to workspace membership",
          "Store registry maps every webhook to the right books",
        ]}
        icon={IconDatabase}
        visual={<MiniTenants />}
      />
      <ValueSection
        index="04"
        kicker="Instant CSV / audit export"
        title={
          <>
            Audit-ready,
            <br />
            on demand.
          </>
        }
        body="Journal entries can't go out of balance and every source event is recorded. When your accountant calls, export the whole ledger — signed and complete — in seconds."
        bullets={[
          "One-click export: ledger, orders, COGS, trial balance",
          "Immutable event log ties every entry back to its source",
          "Signed archives your CPA can open without a login",
        ]}
        icon={IconShield}
        visual={<MiniExport />}
        flip
      />
    </>
  );
}
