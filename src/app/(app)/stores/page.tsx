import type { Metadata } from "next";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConnectStoreButton } from "@/components/connect-store-button";
import { IconChevronRight, IconExternal, IconShield, IconWebhook } from "@/components/icons";
import { fetchStoreOverview } from "@/lib/data/repository";
import { formatCompactCurrency, formatPercent } from "@/lib/utils";
import { PLATFORM_META } from "@/lib/providers/meta";

export const metadata: Metadata = { title: "Stores" };

export default async function StoresPage() {
  const data = await fetchStoreOverview();
  const stats = data.stats;

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <Topbar title="Stores" subtitle="Connect your e-commerce platforms and payment gateways" />
      <div className="mx-auto w-full max-w-7xl flex-1 space-y-8 px-6 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">Your stores</h2>
            <p className="text-xs text-zinc-500">Webhooks are verified, orders normalized, profit computed.</p>
          </div>
          <ConnectStoreButton />
        </div>

        {/* Connected store */}
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-5 p-6 md:flex-row md:items-center">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 text-lg font-bold text-emerald-950">
              AO
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-zinc-50">{data.store?.name ?? "Aurora & Oak"}</h3>
                <Badge variant="success">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse-dot" /> Connected
                </Badge>
                <Badge variant="neutral">{data.store?.platform}</Badge>
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">
                <IconExternal className="h-3.5 w-3.5" /> {data.store?.domain ?? "demo store"}
                <span className="text-zinc-700">·</span>
                Webhook verified {stats.period_orders}× in the last 30 days
              </p>
            </div>
            <div className="flex items-center gap-8">
              <div className="text-right">
                <p className="text-xs text-zinc-500">30d revenue</p>
                <p className="text-lg font-bold text-zinc-50 tabular-nums">{formatCompactCurrency(stats.period_revenue)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-zinc-500">30d net profit</p>
                <p className="text-lg font-bold text-emerald-400 tabular-nums">{formatCompactCurrency(stats.period_net_profit)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-zinc-500">Net margin</p>
                <p className="text-lg font-bold text-zinc-50 tabular-nums">{formatPercent(stats.net_margin)}</p>
              </div>
              <Link
                href={`/stores/${data.store?.id ?? "demo-aurora-oak"}`}
                className="flex h-10 items-center gap-1.5 rounded-xl border border-zinc-700 px-4 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800/60"
              >
                Open <IconChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </Card>

        {/* Integration catalog */}
        <div>
          <h2 className="mb-3 text-base font-semibold text-zinc-100">Integrations</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {PLATFORM_META.map((platform) => (
              <Card key={platform.id} className="group p-5 transition-colors hover:border-zinc-700">
                <div className="flex items-center justify-between">
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-xl border text-lg"
                    style={{ borderColor: `${platform.color}40`, background: `${platform.color}14`, color: platform.color }}
                  >
                    {platform.mark}
                  </span>
                  <Badge variant="neutral">Supported</Badge>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-zinc-100">{platform.name}</h3>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">{platform.blurb}</p>
                <p className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
                  <IconWebhook className="h-3.5 w-3.5" /> {platform.events}
                </p>
              </Card>
            ))}
          </div>
        </div>

        {/* How it works */}
        <Card>
          <CardHeader>
            <CardTitle>From webhook to income statement</CardTitle>
            <CardDescription>What happens when an order event arrives</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid gap-4 md:grid-cols-4">
              {[
                { n: "01", title: "Verify & normalize", body: "HMAC / signature verification, then payload → canonical order with item costs." },
                { n: "02", title: "Compute true profit", body: "Item cost × qty, shipping, gateway fees, discounts & refunds — per order." },
                { n: "03", title: "Post journal entries", body: "Dr Cash, Cr Sales, Dr COGS, Cr Inventory… every entry stays balanced." },
                { n: "04", title: "Report", body: "General ledger, chart of accounts and income statement update instantly." },
              ].map((step) => (
                <div key={step.n} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                  <span className="font-mono text-xs font-bold text-emerald-500/70">{step.n}</span>
                  <h4 className="mt-1.5 text-sm font-semibold text-zinc-100">{step.title}</h4>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500">{step.body}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Security note */}
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-3">
          <IconShield className="mt-0.5 h-4.5 w-4.5 shrink-0 text-emerald-400" />
          <p className="text-xs leading-relaxed text-emerald-200/80">
            Every webhook payload is cryptographically verified before touching your books, and Supabase Row Level
            Security ensures each user only ever sees their own stores, orders and ledger.
          </p>
        </div>
      </div>
    </main>
  );
}
