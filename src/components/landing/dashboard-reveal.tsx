"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { IconArrowUp, IconCheck, IconSparkles } from "@/components/icons";
import { usePrefersReducedMotion, useScrollProgress } from "./use-scroll-progress";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const range = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));

const SCENES = [
  { id: "overview", n: "01", label: "Overview" },
  { id: "ledger", n: "02", label: "General ledger" },
  { id: "cogs", n: "03", label: "COGS" },
  { id: "pnl", n: "04", label: "Income statement" },
  { id: "ai", n: "05", label: "AI assistant" },
] as const;

type SceneId = (typeof SCENES)[number]["id"];

const SCROLL_START = 0.22; // progress where scene scrubbing begins
const SCROLL_END = 0.97; // progress where scene scrubbing ends

const STATS = [
  { label: "Revenue · 30d", value: "$24,812", delta: "+12.4%" },
  { label: "True net profit", value: "$9,317", delta: "+8.1%" },
  { label: "Orders · 30d", value: "412", delta: "+5.2%" },
  { label: "Net margin", value: "37.6%", delta: "+1.4%" },
];

const LEDGER_ENTRIES = [
  {
    id: "JE-1042",
    meta: "09-28 · Shopify #8412",
    lines: [
      { dr: true, code: "1000", name: "Cash on hand", amount: "1,240.00" },
      { dr: false, code: "4000", name: "Sales revenue", amount: "1,240.00" },
    ],
  },
  {
    id: "JE-1043",
    meta: "09-28 · COGS posting",
    lines: [
      { dr: true, code: "5000", name: "Cost of goods sold", amount: "840.00" },
      { dr: false, code: "1300", name: "Inventory", amount: "840.00" },
    ],
  },
  {
    id: "JE-1044",
    meta: "09-28 · Gateway fee",
    lines: [
      { dr: true, code: "5200", name: "Payment processing fees", amount: "37.20" },
      { dr: false, code: "1000", name: "Cash on hand", amount: "37.20" },
    ],
  },
];

const COGS_ROWS = [
  { name: "Orbit tee", unit: "$8.40", pct: 34 },
  { name: "Halo hoodie", unit: "$21.10", pct: 41 },
  { name: "Nova cap", unit: "$5.20", pct: 25 },
];

const PNL_ROWS = [
  { label: "Revenue", amount: "$24,812.00", strong: false },
  { label: "COGS", amount: "−$8,436.00", strong: false },
  { label: "Gross profit · 65.9%", amount: "$16,376.00", strong: true },
  { label: "Shipping", amount: "−$2,041.00", strong: false },
  { label: "Payment fees", amount: "−$1,387.00", strong: false },
  { label: "Refunds", amount: "−$519.00", strong: false },
];

/**
 * Dashboard reveal — the giant headline hands off to the product. The frame
 * rises from below with a 3D tilt while scroll scrubs through five scenes:
 * Overview → General Ledger → COGS → Income Statement → AI Assistant.
 * Scene switching is the only state change; all motion is transform/opacity.
 */
export function DashboardReveal() {
  const reduced = usePrefersReducedMotion();
  const [scene, setScene] = useState(0);

  const frameRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef<HTMLSpanElement>(null);
  const chipRefs = useRef<(HTMLDivElement | null)[]>([]);

  const rootRef = useScrollProgress((p) => {
    // Rise: frame climbs out of the fold, tilt flattens, scale settles.
    const tr = easeOut(range(p, 0, 0.2));
    if (frameRef.current) {
      frameRef.current.style.transform = `perspective(1400px) translate3d(0, ${((1 - tr) * 34).toFixed(2)}vh, 0) rotateX(${((1 - tr) * 12).toFixed(2)}deg) scale(${(0.9 + 0.1 * tr).toFixed(4)})`;
    }

    // Scene scrub.
    const sp = range(p, SCROLL_START, SCROLL_END);
    const idx = Math.min(SCENES.length - 1, Math.floor(sp * SCENES.length));
    setScene(idx);

    if (barRef.current) {
      barRef.current.style.transform = `scaleX(${sp.toFixed(4)})`;
    }
    if (counterRef.current) {
      counterRef.current.textContent = `${SCENES[idx].n} / 0${SCENES.length}`;
    }

    // Floating chips drift with parallax and fade with the rise.
    chipRefs.current.forEach((chip, i) => {
      if (!chip) return;
      const factor = i % 2 === 0 ? -1 : 1;
      chip.style.transform = `translate3d(0, ${(p * 46 * factor).toFixed(1)}px, 0)`;
      chip.style.opacity = String(clamp01(range(p, 0.06, 0.22)) * (1 - 0.7 * range(p, 0.88, 1)));
    });
  });

  const scrollToScene = (i: number) => {
    const el = rootRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const scrollable = el.offsetHeight - window.innerHeight;
    const p = SCROLL_START + ((i + 0.5) / SCENES.length) * (SCROLL_END - SCROLL_START);
    window.scrollTo({ top: top + scrollable * p, behavior: "smooth" });
  };

  if (reduced) {
    return (
      <section className="border-b border-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
          <p className="type-kicker text-accent">Live product — all five rooms of the engine</p>
          <div className="mt-8 border border-white bg-black">
            <WindowChrome />
            {SCENES.map((s) => (
              <div key={s.id} className="border-t border-white first:border-t-0">
                <div className="border-b border-white bg-black px-4 py-2">
                  <span className="type-kicker text-accent">
                    {s.n} — {s.label}
                  </span>
                </div>
                <SceneContent id={s.id} />
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section ref={rootRef} aria-label="Product preview" className="relative h-[480vh]">
      <div className="sticky top-0 flex h-screen items-center justify-center overflow-hidden px-3 sm:px-6">
        {/* Floating parallax chips */}
        <div
          ref={(el) => {
            chipRefs.current[0] = el;
          }}
          aria-hidden
          className="frame-hair absolute left-[4%] top-[16%] z-10 hidden bg-black px-3 py-2 opacity-0 will-change-transform lg:block"
        >
          <p className="type-kicker text-zinc-500">True net · 30d</p>
          <p className="mt-1 text-sm font-extrabold tabular-nums text-white">+$9,317</p>
        </div>
        <div
          ref={(el) => {
            chipRefs.current[1] = el;
          }}
          aria-hidden
          className="absolute bottom-[18%] right-[3%] z-10 hidden border border-accent bg-black px-3 py-2 opacity-0 will-change-transform lg:block"
        >
          <p className="type-kicker text-accent">Schema</p>
          <p className="mt-1 font-mono text-[11px] font-bold text-white">tenant_9f2c · RLS on</p>
        </div>
        <div
          ref={(el) => {
            chipRefs.current[2] = el;
          }}
          aria-hidden
          className="absolute right-[6%] top-[24%] z-10 hidden bg-accent px-3 py-2 opacity-0 will-change-transform xl:block"
        >
          <p className="type-kicker text-white">Dr = Cr ✓</p>
        </div>

        {/* The product frame */}
        <div ref={frameRef} className="w-full max-w-6xl will-change-transform">
          <div className="border border-white bg-black shadow-[10px_10px_0_0_rgba(255,59,0,0.9)]">
            <WindowChrome />

            <div className="flex">
              {/* Scene rail */}
              <nav aria-label="Product scenes" className="hidden w-48 shrink-0 border-r border-white md:block">
                {SCENES.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => scrollToScene(i)}
                    className={cn(
                      "flex w-full items-baseline gap-3 border-b border-white px-4 py-3.5 text-left transition-colors duration-150",
                      i === SCENES.length - 1 && "border-b-0",
                      scene === i ? "bg-zinc-900 text-white" : "text-zinc-600 hover:text-zinc-300",
                    )}
                  >
                    <span className={cn("font-mono text-[10px] font-bold", scene === i ? "text-accent" : "text-zinc-700")}>
                      {s.n}
                    </span>
                    <span className="type-kicker">{s.label}</span>
                  </button>
                ))}
              </nav>

              {/* Scenes viewport */}
              <div className="relative h-[400px] flex-1 sm:h-[430px]">
                {SCENES.map((s, i) => (
                  <div
                    key={s.id}
                    aria-hidden={scene !== i}
                    className={cn(
                      "absolute inset-0 transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
                      scene === i ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0",
                    )}
                  >
                    <SceneContent id={s.id} />
                  </div>
                ))}
              </div>
            </div>

            {/* Scrub bar */}
            <div className="flex items-center gap-4 border-t border-white px-4 py-2.5">
              <span className="type-kicker text-zinc-500">Scrub</span>
              <div className="h-[3px] flex-1 bg-zinc-800">
                <div ref={barRef} className="h-full w-full origin-left bg-accent will-change-transform" style={{ transform: "scaleX(0)" }} />
              </div>
              <span ref={counterRef} className="font-mono text-[10px] font-bold text-zinc-400">
                01 / 05
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function WindowChrome() {
  return (
    <div className="flex items-center justify-between border-b border-white px-4 py-3">
      <span className="type-kicker text-white">
        Store Accountant <span className="text-zinc-600">/ dashboard</span>
      </span>
      <span className="hidden font-mono text-[10px] text-zinc-600 sm:block">
        app.storeaccountant.com/dashboard · tenant_9f2c
      </span>
    </div>
  );
}

function SceneHeading({ children }: { children: React.ReactNode }) {
  return <p className="type-kicker text-zinc-500">{children}</p>;
}

function SceneContent({ id }: { id: SceneId }) {
  switch (id) {
    case "overview":
      return (
        <div className="flex h-full flex-col">
          <div className="grid grid-cols-2 gap-px bg-white md:grid-cols-4">
            {STATS.map((stat) => (
              <div key={stat.label} className="bg-black p-3 sm:p-4">
                <p className="type-kicker text-zinc-500">{stat.label}</p>
                <p className="mt-1.5 text-lg font-extrabold tracking-tight tabular-nums text-white sm:text-xl">
                  {stat.value}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-[10px] font-bold text-accent">
                  <IconArrowUp className="h-3 w-3" /> {stat.delta}
                </p>
              </div>
            ))}
          </div>
          <div className="flex min-h-0 flex-1 gap-4 p-4 sm:p-5">
            <div className="flex min-h-0 flex-1 items-end gap-1.5 sm:gap-2">
              {[34, 52, 41, 63, 58, 78, 92].map((h, i) => (
                <div key={i} className={cn("flex-1", i === 6 ? "bg-white" : "bg-accent")} style={{ height: `${h}%` }} />
              ))}
            </div>
            <div className="hidden w-40 shrink-0 border-l border-white pl-4 sm:block">
              <SceneHeading>Where money goes</SceneHeading>
              <div className="mt-3 space-y-2.5">
                {[
                  { label: "Net profit 42%", cls: "bg-accent" },
                  { label: "COGS 34%", cls: "bg-white" },
                  { label: "Fees & shipping 24%", cls: "bg-zinc-600" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-2 text-[11px] font-medium text-zinc-300">
                    <span className={cn("h-2.5 w-2.5", item.cls)} /> {item.label}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      );

    case "ledger":
      return (
        <div className="flex h-full flex-col overflow-hidden p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <SceneHeading>General ledger — journal entries</SceneHeading>
            <span className="type-kicker text-accent">In balance</span>
          </div>
          <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-hidden">
            {LEDGER_ENTRIES.map((entry) => (
              <div key={entry.id} className="border border-white/25 p-3 font-mono text-[10px] leading-relaxed sm:text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white">
                    {entry.id} <span className="font-normal text-zinc-500">· {entry.meta}</span>
                  </span>
                  <span className="flex items-center gap-1 font-sans text-[9px] font-bold text-zinc-400">
                    <IconCheck className="h-3 w-3 text-accent" /> BALANCED
                  </span>
                </div>
                {entry.lines.map((line) => (
                  <div key={line.code} className="mt-1.5 flex items-baseline justify-between gap-3">
                    <span className={cn("truncate", line.dr ? "text-white" : "text-accent")}>
                      {line.dr ? "DR" : "CR"} {line.code} · {line.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-zinc-300">{line.amount}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="type-kicker mt-3 text-zinc-600">
            Every sale posts balanced double-entry — Dr Cash, Cr Sales, Dr COGS, Cr Inventory.
          </p>
        </div>
      );

    case "cogs":
      return (
        <div className="flex h-full flex-col p-4 sm:p-5">
          <SceneHeading>Product COGS breakdown</SceneHeading>
          <div className="mt-4 flex min-h-0 flex-1 flex-col items-center gap-6 md:flex-row">
            <svg viewBox="0 0 120 120" className="h-36 w-36 shrink-0 -rotate-90" aria-hidden>
              <circle cx="60" cy="60" r="44" fill="none" stroke="#1f1f1f" strokeWidth="14" />
              <circle cx="60" cy="60" r="44" fill="none" stroke="#ff3b00" strokeWidth="14" strokeDasharray="94 182.8" strokeDashoffset="0" />
              <circle cx="60" cy="60" r="44" fill="none" stroke="#ffffff" strokeWidth="14" strokeDasharray="113.2 163.6" strokeDashoffset="-94" />
              <circle cx="60" cy="60" r="44" fill="none" stroke="#4d4d4d" strokeWidth="14" strokeDasharray="69.6 207.2" strokeDashoffset="-207.2" />
            </svg>
            <div className="w-full max-w-sm flex-1 space-y-3">
              {COGS_ROWS.map((row) => (
                <div key={row.name} className="group border border-white/25 p-3 transition-colors duration-150 hover:border-white">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs font-bold uppercase tracking-[0.06em] text-white">{row.name}</span>
                    <span className="font-mono text-[10px] tabular-nums text-zinc-400">unit cost {row.unit}</span>
                  </div>
                  <div className="mt-2 h-2 bg-zinc-800">
                    <div className="h-full bg-accent" style={{ width: `${row.pct}%` }} />
                  </div>
                  <p className="mt-1 text-right font-mono text-[10px] text-zinc-500">{row.pct}% of COGS</p>
                </div>
              ))}
            </div>
          </div>
          <p className="type-kicker mt-3 text-zinc-600">Item cost × quantity, pulled from the product catalog on every webhook.</p>
        </div>
      );

    case "pnl":
      return (
        <div className="flex h-full flex-col p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <SceneHeading>Income statement — September</SceneHeading>
            <span className="type-kicker text-zinc-500">USD</span>
          </div>
          <div className="mt-3 min-h-0 flex-1 overflow-hidden">
            <dl className="text-[11px] sm:text-xs">
              {PNL_ROWS.map((row) => (
                <div
                  key={row.label}
                  className={cn(
                    "flex items-baseline justify-between gap-4 border-b border-white/15 py-2 tabular-nums",
                    row.strong && "font-bold text-white",
                  )}
                >
                  <dt className="text-zinc-400">{row.label}</dt>
                  <dd className={row.strong ? "text-white" : "text-zinc-200"}>{row.amount}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 flex items-center justify-between bg-accent px-3 py-2.5">
              <span className="text-xs font-extrabold uppercase tracking-[0.08em] text-white">Net profit</span>
              <span className="text-sm font-extrabold tabular-nums text-white">$9,317.00 · 37.6%</span>
            </div>
          </div>
          <p className="type-kicker mt-3 text-zinc-600">Generated from the ledger — margins at every level, drillable by store.</p>
        </div>
      );

    case "ai":
      return (
        <div className="flex h-full flex-col p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <IconSparkles className="h-4 w-4 text-accent" />
            <SceneHeading>AI assistant — grounded in your ledger</SceneHeading>
          </div>
          <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-hidden">
            <div className="border border-white/25 p-3">
              <p className="type-kicker text-zinc-500">You</p>
              <p className="mt-1.5 text-xs text-zinc-200 sm:text-sm">Why did net margin drop last week?</p>
            </div>
            <div className="border border-accent p-3">
              <p className="type-kicker text-accent">Agent</p>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-100 sm:text-sm">
                Refund spike on Orbit tee: 6 refunds vs a 1.2/wk average (z = +3.8), −$519 impact.
                Margin moved 37.6% → 34.1% on affected SKUs. Recommend reviewing the returns before restocking.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {["Anomaly detected", "Cash forecast +$12,400 / 30d", "Every number reconciles"].map((chip) => (
                <span key={chip} className="border border-white/25 px-2.5 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-300">
                  {chip}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 border border-white/25 px-3 py-2.5">
            <span className="flex-1 text-xs text-zinc-500">Ask your books anything…</span>
            <span className="h-3.5 w-2 animate-pulse-dot bg-accent" />
          </div>
        </div>
      );
  }
}
