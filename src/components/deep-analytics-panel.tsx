import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IconActivity, IconPackage, IconSparkles, IconZap } from "@/components/icons";
import { RoasCard } from "@/components/roas-card";
import { formatCompactCurrency, formatCurrency, formatPercent } from "@/lib/utils";
import type { StoreAnalytics, StoreAuditReport, AuditSeverity } from "@/lib/analytics/storeResearch";

/**
 * ── Deep analytics & audit panel (dashboard) ──────────────────────────────────
 * Server component: renders the deterministic output of
 * `runDeepStoreResearch` — deep business KPIs (margins, ROAS-ready ad-spend
 * placeholder, top SKUs), inventory warnings, and the continuous audit
 * checklist with a 0–100 store-health score.
 */

const SEVERITY_BADGE: Record<Exclude<AuditSeverity, "neutral">, "success" | "info" | "warning" | "danger"> = {
  pass: "success",
  info: "info",
  warning: "warning",
  critical: "danger",
};

const SEVERITY_LABEL: Record<Exclude<AuditSeverity, "neutral">, string> = {
  pass: "pass",
  info: "info",
  warning: "watch",
  critical: "critical",
};

function HealthRing({ score, grade }: { score: number; grade: StoreAuditReport["healthGrade"] }) {
  const color = grade === "A" ? "#34d399" : grade === "B" ? "#38bdf8" : grade === "C" ? "#fbbf24" : "#f87171";
  const circumference = 2 * Math.PI * 34;
  const dash = (score / 100) * circumference;

  return (
    <div className="relative flex h-24 w-24 shrink-0 items-center justify-center">
      <svg viewBox="0 0 80 80" className="h-24 w-24 -rotate-90">
        <circle cx="40" cy="40" r="34" fill="none" stroke="#27272a" strokeWidth="8" />
        <circle
          cx="40"
          cy="40"
          r="34"
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
        />
      </svg>
      <div className="absolute text-center">
        <p className="text-xl font-bold leading-none text-zinc-50 tabular-nums">{score}</p>
        <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color }}>
          {grade}
        </p>
      </div>
    </div>
  );
}

export function DeepAnalyticsPanel({
  analytics,
  audit,
}: {
  analytics: StoreAnalytics;
  audit: StoreAuditReport;
}) {
  const cur = analytics.currency;
  const passed = audit.findings.filter((f) => f.severity === "pass").length;

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      {/* ── Deep business analytics ─────────────────────────────────────────── */}
      <Card className="xl:col-span-2">
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <IconActivity className="h-4.5 w-4.5 text-emerald-400" />
              Deep business analytics
            </CardTitle>
            <CardDescription>
              Last {analytics.periodDays} days · {analytics.ordersAnalyzed} orders analyzed · reconciles with the ledger
            </CardDescription>
          </div>
          <Link href="/assistant" className="text-xs font-medium text-emerald-400 hover:text-emerald-300">
            Ask the AI →
          </Link>
        </CardHeader>

        <CardContent className="space-y-5 pt-2">
          {/* KPI row */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Gross margin</p>
              <p className="mt-1 text-lg font-bold text-zinc-50 tabular-nums">{formatPercent(analytics.grossMargin)}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Net margin</p>
              <p className="mt-1 text-lg font-bold text-zinc-50 tabular-nums">{formatPercent(analytics.netMargin)}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">AOV</p>
              <p className="mt-1 text-lg font-bold text-zinc-50 tabular-nums">{formatCompactCurrency(analytics.aov, cur)}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Refund rate</p>
              <p className={`mt-1 text-lg font-bold tabular-nums ${analytics.refundRate > 0.1 ? "text-amber-400" : "text-zinc-50"}`}>
                {formatPercent(analytics.refundRate)}
              </p>
            </div>
          </div>

          {/* Cost-structure + ROAS row */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3.5">
              <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
                <IconZap className="h-3.5 w-3.5 text-sky-400" /> Cost structure
              </p>
              <div className="mt-2.5 space-y-1.5 text-xs text-zinc-300">
                <div className="flex justify-between">
                  <span className="text-zinc-500">COGS share</span>
                  <span className="tabular-nums">{formatPercent(analytics.cogsRate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Gateway fee share</span>
                  <span className="tabular-nums">{formatPercent(analytics.feeRate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Avg shipping / order</span>
                  <span className="tabular-nums">{formatCurrency(analytics.avgShippingCost, cur)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Avg payment fee / order</span>
                  <span className="tabular-nums">{formatCurrency(analytics.avgPaymentFee, cur)}</span>
                </div>
              </div>
            </div>

            <RoasCard
              key={`${analytics.storeId}:${analytics.adSpend.amount ?? "none"}`}
              storeId={analytics.storeId}
              roas={analytics.roas}
              adSpend={analytics.adSpend}
              netSales={analytics.netSales}
              currency={cur}
            />
          </div>

          {/* Top SKUs */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
              <IconPackage className="h-3.5 w-3.5 text-emerald-400" /> Top performing SKUs
              {analytics.lossMakingSkus.length > 0 && (
                <span className="text-[11px] text-amber-400/80">· {analytics.lossMakingSkus.length} loss-maker{analytics.lossMakingSkus.length === 1 ? "" : "s"} flagged</span>
              )}
            </p>
            {analytics.topSkus.length === 0 ? (
              <p className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-4 text-center text-xs text-zinc-500">
                No item-level sales yet — top SKUs appear as orders sync in.
              </p>
            ) : (
              <div className="space-y-1.5">
                {analytics.topSkus.slice(0, 5).map((sku) => (
                  <div key={sku.sku || sku.name} className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-zinc-800/40">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-zinc-200">{sku.name}</p>
                      <p className="text-[10px] text-zinc-600">{sku.units} units · {sku.sku || "no SKU"}</p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-zinc-100 tabular-nums">{formatCurrency(sku.revenue, cur)}</span>
                    <span className={`w-16 shrink-0 text-right text-xs font-semibold tabular-nums ${sku.profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {sku.profit >= 0 ? "+" : "−"}{formatCurrency(Math.abs(sku.profit), cur)}
                    </span>
                    <Badge variant={sku.margin >= 0.3 ? "success" : sku.margin >= 0.1 ? "warning" : "danger"} className="w-14 justify-center">
                      {formatPercent(sku.margin, 0)}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Store health audit ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Store health audit</CardTitle>
            <CardDescription>
              Continuous · {passed}/{audit.findings.length} checks passing
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          <div className="flex items-center gap-4">
            <HealthRing score={audit.healthScore} grade={audit.healthGrade} />
            <ul className="min-w-0 flex-1 space-y-1.5">
              {audit.signals.length === 0 ? (
                <li className="text-xs text-emerald-400">✓ All checks passing — the books look healthy.</li>
              ) : (
                audit.signals.map((signal) => (
                  <li key={signal.label} className="flex items-start gap-1.5 text-xs leading-snug text-zinc-300">
                    <span
                      className={
                        signal.severity === "critical"
                          ? "text-red-400"
                          : signal.severity === "warning"
                            ? "text-amber-400"
                            : "text-sky-400"
                      }
                    >
                      ●
                    </span>
                    <span className="min-w-0">{signal.label}</span>
                  </li>
                ))
              )}
            </ul>
          </div>

          <div className="mt-4 space-y-2">
            {audit.findings.map((f) => (
              <details key={f.id} className="group rounded-xl border border-zinc-800 bg-zinc-900/40 open:border-zinc-700">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-xs [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0 truncate font-medium text-zinc-200">{f.title}</span>
                  <Badge variant={SEVERITY_BADGE[f.severity]}>{SEVERITY_LABEL[f.severity]}</Badge>
                </summary>
                <div className="border-t border-zinc-800/70 px-3 py-2.5">
                  <p className="text-[11px] leading-relaxed text-zinc-400">{f.detail}</p>
                  {f.recommendation && f.severity !== "pass" && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-emerald-300/90">→ {f.recommendation}</p>
                  )}
                </div>
              </details>
            ))}
          </div>

          <p className="mt-3 text-[10px] text-zinc-600">
            Audited {new Date(audit.auditedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ·
            deterministic checks over {audit.ordersAudited} orders, {audit.productsAudited} products, {audit.journalEntriesAudited} journal entries
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export function DeepAnalyticsCardSkeleton() {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <IconSparkles className="h-4.5 w-4.5 text-emerald-400" />
            Deep analytics
          </CardTitle>
          <CardDescription>Compiling store research…</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="h-24 animate-pulse rounded-xl bg-zinc-900" />
      </CardContent>
    </Card>
  );
}
