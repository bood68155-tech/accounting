import type { Metadata } from "next";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { DemoBanner } from "@/components/demo-banner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TCell, THead, THeadCell, TRow } from "@/components/ui/table";
import { LineChart } from "@/components/charts/line-chart";
import { BarChart } from "@/components/charts/bar-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { ProfitCalculator } from "@/components/profit-calculator";
import { IconArrowUp, IconCoin, IconOrders, IconSparkles, IconWebhook } from "@/components/icons";
import { fetchStoreOverview } from "@/lib/data/repository";
import { computeOrderProfit } from "@/lib/accounting/profitEngine";
import { formatCompactCurrency, formatCurrency, formatPercent, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const data = await fetchStoreOverview();
  const { stats, monthly, orders, recentEvents, mode, store } = data;
  const currency = store?.currency ?? "USD";

  const recentOrders = [...orders].sort((a, b) => b.ordered_at.localeCompare(a.ordered_at)).slice(0, 7);
  const revenueSpark = monthly.map((m) => m.revenue);
  const profitSpark = monthly.map((m) => m.net_profit);

  const allocation = [
    { label: "Net profit", value: stats.total_net_profit, color: "#34d399" },
    { label: "COGS", value: monthly.reduce((s, m) => s + m.cogs, 0), color: "#38bdf8" },
    { label: "Gateway fees", value: monthly.reduce((s, m) => s + m.fees, 0), color: "#fbbf24" },
  ];
  const allocationTotal = allocation.reduce((s, a) => s + a.value, 0);

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <Topbar title="Dashboard" subtitle={`${store?.name ?? "Store"} · ${mode === "demo" ? "Demo workspace" : "Live workspace"}`} />

      <div className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-6 py-6">
        {mode === "demo" && <DemoBanner />}

        {/* Stat cards */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Revenue · 30d"
            value={formatCompactCurrency(stats.period_revenue, currency)}
            delta={12.4}
            sublabel="vs previous"
            spark={revenueSpark}
            accent="#34d399"
            icon={<IconCoin className="h-5 w-5" />}
          />
          <StatCard
            label="True net profit · 30d"
            value={formatCompactCurrency(stats.period_net_profit, currency)}
            delta={8.1}
            sublabel="after all costs"
            spark={profitSpark}
            accent="#2dd4bf"
            icon={<IconArrowUp className="h-5 w-5" />}
          />
          <StatCard
            label="Orders · 30d"
            value={String(stats.period_orders)}
            delta={stats.period_orders > 0 ? 5.2 : 0}
            sublabel="vs previous"
            spark={orders.slice(-30).map((_, i) => i + 1)}
            accent="#38bdf8"
            icon={<IconOrders className="h-5 w-5" />}
          />
          <StatCard
            label="Net margin"
            value={formatPercent(stats.net_margin)}
            delta={1.4}
            sublabel={`AOV ${formatCurrency(stats.aov, currency)}`}
            spark={monthly.map((m) => (m.revenue > 0 ? (m.net_profit / m.revenue) * 100 : 0))}
            accent="#a78bfa"
            icon={<IconSparkles className="h-5 w-5" />}
          />
        </div>

        {/* Charts row */}
        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>Revenue vs. true net profit</CardTitle>
                <CardDescription>Monthly — profit after COGS, fees & shipping</CardDescription>
              </div>
              <div className="flex items-center gap-4 text-xs text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" /> Revenue
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-teal-300" /> Net profit
                </span>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <LineChart
                labels={monthly.map((m) => m.label)}
                currency={currency}
                series={[
                  { name: "Revenue", color: "#34d399", data: monthly.map((m) => m.revenue) },
                  { name: "Net profit", color: "#5eead4", data: monthly.map((m) => m.net_profit) },
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Where the money goes</CardTitle>
              <CardDescription>Last 6 months, from the general ledger</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <DonutChart
                segments={allocation}
                centerValue={formatCompactCurrency(allocationTotal, currency)}
                centerLabel="Gross sales"
              />
            </CardContent>
          </Card>
        </div>

        {/* Monthly bar chart + webhook activity */}
        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>Monthly performance</CardTitle>
                <CardDescription>COGS vs payment fees vs net profit</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <BarChart
                labels={monthly.map((m) => m.label)}
                currency={currency}
                series={[
                  { name: "Net profit", color: "#34d399", values: monthly.map((m) => m.net_profit) },
                  { name: "COGS", color: "#38bdf8", values: monthly.map((m) => m.cogs) },
                  { name: "Fees", color: "#fbbf24", values: monthly.map((m) => m.fees) },
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Webhook activity</CardTitle>
              <IconWebhook className="h-4 w-4 text-zinc-500" />
            </CardHeader>
            <CardContent className="pt-2">
              <ul className="space-y-1">
                {recentEvents.slice(0, 7).map((event, i) => (
                  <li
                    key={`${event.provider}-${i}`}
                    className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-zinc-800/40"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          event.status === "processed" ? "bg-emerald-400" : "bg-red-400"
                        }`}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-zinc-200">
                          {event.provider} · {event.event_type}
                        </p>
                        <p className="truncate text-[11px] text-zinc-500">
                          {relativeTime(event.processed_at)}
                        </p>
                      </div>
                    </div>
                    <Badge variant={event.status === "processed" ? "success" : "danger"}>
                      {event.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* Profit calculator */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <IconSparkles className="h-4.5 w-4.5 text-emerald-400" />
            <h2 className="text-sm font-semibold text-zinc-100">True net profit engine — try it</h2>
            <p className="hidden text-xs text-zinc-500 sm:block">
              Same math the webhooks run: item cost + shipping + gateway fees
            </p>
          </div>
          <ProfitCalculator />
        </div>

        {/* Recent orders */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Recent orders</CardTitle>
              <CardDescription>Every order normalized with item cost & gateway fee</CardDescription>
            </div>
            <Link href="/orders" className="text-xs font-medium text-emerald-400 transition-colors hover:text-emerald-300">
              View all →
            </Link>
          </CardHeader>
          <CardContent className="pt-4">
            <Table>
              <THead>
                <TRow>
                  <THeadCell>Order</THeadCell>
                  <THeadCell>Customer</THeadCell>
                  <THeadCell>Date</THeadCell>
                  <THeadCell className="text-right">Revenue</THeadCell>
                  <THeadCell className="text-right">COGS</THeadCell>
                  <THeadCell className="text-right">Fees</THeadCell>
                  <THeadCell className="text-right">Net profit</THeadCell>
                  <THeadCell>Status</THeadCell>
                </TRow>
              </THead>
              <TBody>
                {recentOrders.map((order) => {
                  const profit = computeOrderProfit(order);
                  const netIsProfit = profit.net_profit >= 0;
                  return (
                    <TRow key={order.external_id}>
                      <TCell className="font-medium text-zinc-100">{order.order_number}</TCell>
                      <TCell className="text-zinc-300">{order.customer_name}</TCell>
                      <TCell className="text-zinc-500">{new Date(order.ordered_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</TCell>
                      <TCell className="text-right text-zinc-100 tabular-nums">{formatCurrency(order.total_amount, order.currency)}</TCell>
                      <TCell className="text-right text-zinc-400 tabular-nums">{formatCurrency(profit.cogs, order.currency)}</TCell>
                      <TCell className="text-right text-zinc-400 tabular-nums">{formatCurrency(profit.payment_fees, order.currency)}</TCell>
                      <TCell className={`text-right font-medium tabular-nums ${netIsProfit ? "text-emerald-400" : "text-red-400"}`}>
                        {netIsProfit ? "+" : "−"}{formatCurrency(Math.abs(profit.net_profit), order.currency)}
                      </TCell>
                      <TCell>
                        <Badge
                          variant={
                            order.status === "paid"
                              ? "success"
                              : order.status === "refunded"
                                ? "danger"
                                : order.status === "partially_refunded"
                                  ? "warning"
                                  : "neutral"
                          }
                        >
                          {order.status.replace("_", " ")}
                        </Badge>
                      </TCell>
                    </TRow>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
