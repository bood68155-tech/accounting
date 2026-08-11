import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TBody, TCell, THead, THeadCell, TRow } from "@/components/ui/table";
import { IconChevronRight, IconCoin, IconOrders, IconPackage, IconSparkles, IconTruck, IconWebhook } from "@/components/icons";
import { fetchStoreOverview } from "@/lib/data/repository";
import { computeOrderProfit, computeStats } from "@/lib/accounting/profitEngine";
import { formatCompactCurrency, formatCurrency, formatPercent, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Store" };

export default async function StoreDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await fetchStoreOverview(id);
  if (!data.store) notFound();

  const store = data.store;
  const stats = computeStats(store.id, data.orders);
  const currency = store.currency ?? "USD";
  const recentOrders = [...data.orders].sort((a, b) => b.ordered_at.localeCompare(a.ordered_at)).slice(0, 6);
  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.store-accountant.com"}/api/webhooks/${store.platform}`;
  const productCount = data.products.length;

  // Quick product stats
  const avgMargin =
    productCount > 0
      ? data.products.reduce((s, p) => {
          const margin = p.unit_price > 0 ? (p.unit_price - p.unit_cost) / p.unit_price : 0;
          return s + margin;
        }, 0) / productCount
      : 0;

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <Topbar title={store.name} subtitle={`${store.platform} · ${store.domain ?? "no domain"}`} />

      <div className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-6 py-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse-dot" /> Connected
          </Badge>
          <Badge variant="neutral">{store.currency}</Badge>
          <Badge variant="info">Webhook {store.platform}</Badge>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="All-time revenue" value={formatCompactCurrency(stats.total_revenue, currency)} icon={<IconCoin className="h-5 w-5" />} accent="#34d399" />
          <StatCard label="All-time net profit" value={formatCompactCurrency(stats.total_net_profit, currency)} icon={<IconSparkles className="h-5 w-5" />} accent="#2dd4bf" />
          <StatCard label="Orders" value={String(stats.total_orders)} icon={<IconOrders className="h-5 w-5" />} accent="#38bdf8" />
          <StatCard label="Avg net margin" value={formatPercent(stats.net_margin)} icon={<IconTruck className="h-5 w-5" />} accent="#a78bfa" />
        </div>

        {/* Products quick access */}
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-5 p-6 md:flex-row md:items-center">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-emerald-500/25 bg-emerald-500/10 text-emerald-400">
              <IconPackage className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-zinc-50">Products &amp; inventory</h3>
                <Badge variant="success">{productCount} products</Badge>
                {productCount > 0 && (
                  <Badge variant="info">Avg margin {formatPercent(avgMargin)}</Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                Manage cost prices (سعر الشراء), selling prices (سعر البيع), and track profit margins for each product.
              </p>
            </div>
            <Link
              href={`/stores/${store.id}/products`}
              className="flex h-10 items-center gap-1.5 rounded-xl border border-zinc-700 px-4 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800/60"
            >
              Manage products <IconChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </Card>

        <div className="grid gap-6 xl:grid-cols-2">
          {/* Webhook configuration */}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>Webhook configuration</CardTitle>
                <CardDescription>Point your {store.platform} webhook at this endpoint</CardDescription>
              </div>
              <IconWebhook className="h-4.5 w-4.5 text-emerald-400" />
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div>
                <p className="mb-1.5 text-xs text-zinc-500">Endpoint URL</p>
                <code className="block truncate rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 font-mono text-[11px] text-emerald-300">
                  {webhookUrl}
                </code>
              </div>
              <div>
                <p className="mb-1.5 text-xs text-zinc-500">Signature verification</p>
                <p className="text-sm text-zinc-300">
                  {store.platform === "shopify" && "HMAC-SHA256 via X-Shopify-Hmac-SHA256 header"}
                  {store.platform === "stripe" && "Stripe-Signature timestamped HMAC"}
                  {store.platform === "paypal" && "RSA-SHA256 with PayPal transmission certificate"}
                  {store.platform === "woocommerce" && "Shared secret header / REST API credentials"}
                  {store.platform === "custom" && "Bearer token from store config"}
                </p>
              </div>
              <div>
                <p className="mb-1.5 text-xs text-zinc-500">Events subscribed</p>
                <div className="flex flex-wrap gap-2">
                  {["orders/create", "orders/refund", "charge.succeeded", "checkout.order.approved"].slice(0, store.platform === "shopify" ? 2 : store.platform === "stripe" ? 1 : 2).map((event) => (
                    <span key={event} className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 font-mono text-[11px] text-zinc-400">
                      {event}
                    </span>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Recent webhook events */}
          <Card>
            <CardHeader>
              <CardTitle>Recent integration events</CardTitle>
              <CardDescription>Every payload recorded with status</CardDescription>
            </CardHeader>
            <CardContent className="pt-2">
              <ul className="space-y-1">
                {data.recentEvents.slice(0, 8).map((event, i) => (
                  <li key={`${event.provider}-${i}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-zinc-800/40">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${event.status === "processed" ? "bg-emerald-400" : "bg-red-400"}`} />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-zinc-200">
                          {event.provider} · {event.event_type}
                        </p>
                        <p className="text-[11px] text-zinc-500">{relativeTime(event.processed_at)}</p>
                      </div>
                    </div>
                    <Badge variant={event.status === "processed" ? "success" : "danger"}>{event.status}</Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* Recent orders */}
        <Card>
          <CardHeader>
            <CardTitle>Recent orders</CardTitle>
            <CardDescription>Normalized with item cost, gateway fee and true profit</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <Table>
              <THead>
                <TRow>
                  <THeadCell>Order</THeadCell>
                  <THeadCell>Customer</THeadCell>
                  <THeadCell className="text-right">Revenue</THeadCell>
                  <THeadCell className="text-right">Net profit</THeadCell>
                  <THeadCell>Status</THeadCell>
                  <THeadCell>Date</THeadCell>
                </TRow>
              </THead>
              <TBody>
                {recentOrders.map((order) => {
                  const profit = computeOrderProfit(order);
                  return (
                    <TRow key={order.external_id}>
                      <TCell className="font-medium text-zinc-100">{order.order_number}</TCell>
                      <TCell className="text-zinc-300">{order.customer_name}</TCell>
                      <TCell className="text-right text-zinc-100 tabular-nums">{formatCurrency(order.total_amount, order.currency)}</TCell>
                      <TCell className={`text-right font-medium tabular-nums ${profit.net_profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {profit.net_profit >= 0 ? "+" : "−"}{formatCurrency(Math.abs(profit.net_profit), order.currency)}
                      </TCell>
                      <TCell>
                        <Badge variant={order.status === "paid" ? "success" : order.status === "refunded" ? "danger" : order.status === "partially_refunded" ? "warning" : "neutral"}>
                          {order.status.replace("_", " ")}
                        </Badge>
                      </TCell>
                      <TCell className="whitespace-nowrap text-zinc-500">{new Date(order.ordered_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</TCell>
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
