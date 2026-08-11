import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PinGate } from "@/components/admin/pin-gate";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DemoBanner } from "@/components/demo-banner";
import {
  IconActivity,
  IconCoin,
  IconOrders,
  IconShield,
  IconStore,
  IconUsers,
  IconWebhook,
} from "@/components/icons";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TBody, TCell, THead, THeadCell, TRow } from "@/components/ui/table";
import { isAdminEmail } from "@/lib/admin/auth";
import { ADMIN_PIN_COOKIE, pinTokenMatches } from "@/lib/admin/pin";
import { fetchAdminData } from "@/lib/admin/queries";
import { isSupabaseConfigured } from "@/lib/data/config";
import { createClient } from "@/lib/supabase/server";
import { cn, formatCompactCurrency, formatNumber, formatPercent, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin console" };

const CURRENCY = "USD";

const STORE_STATUS_BADGE: Record<string, "success" | "warning" | "neutral" | "danger"> = {
  connected: "success",
  syncing: "warning",
  disconnected: "neutral",
};

const SUBSCRIPTION_BADGE: Record<string, "success" | "warning" | "neutral" | "danger" | "info"> = {
  active: "success",
  trial: "info",
  inactive: "neutral",
  expired: "danger",
};

const SUBSCRIPTION_LABEL: Record<string, string> = {
  active: "Active",
  trial: "Trial",
  inactive: "Inactive",
  expired: "Expired",
};

export default async function AdminPage() {
  const demo = !isSupabaseConfigured();

  // ─── Email gate ─────────────────────────────────────────────────────────────
  // Strict guard: only the platform owner (bood68155@gmail.com) can access.
  // Live mode checks the Supabase session; demo mode skips (no signed-in user).
  if (!demo) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/login");
    if (!isAdminEmail(user.email)) redirect("/dashboard");
  }

  // ─── PIN gate ───────────────────────────────────────────────────────────────
  // The cookie is httpOnly, holds an HMAC token keyed by the PIN (unforgeable
  // without it), and is only issued by the server action after verification.
  const cookieStore = await cookies();
  if (!pinTokenMatches(cookieStore.get(ADMIN_PIN_COOKIE)?.value)) {
    return <PinGate />;
  }

  const data = await fetchAdminData();
  const { overview, stores, fees, clients, mode } = data;
  const failureRate =
    overview.event_count > 0 ? overview.failed_events / overview.event_count : 0;
  const healthy = failureRate <= 0.05;
  const topStores = [...stores].sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      {/* Page header */}
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-zinc-800/70 px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-700/70 bg-zinc-900 text-emerald-400">
            <IconShield className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold tracking-tight text-zinc-50">
              Admin console
            </h1>
            <p className="truncate text-xs text-zinc-500">
              Platform-wide users, stores, orders &amp; gateway fees
            </p>
          </div>
        </div>
        <Badge variant={demo ? "warning" : "success"}>
          {demo ? "Demo data" : "Live platform"}
        </Badge>
      </header>

      <div className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-6 py-6">
        {demo && <DemoBanner />}

        {/* System stats */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Users"
            value={formatNumber(overview.user_count)}
            sublabel={`${formatNumber(overview.store_count)} stores total`}
            icon={<IconUsers className="h-5 w-5" />}
            accent="#34d399"
          />
          <StatCard
            label="Connected stores"
            value={formatNumber(overview.connected_stores)}
            sublabel={`${formatNumber(overview.store_count - overview.connected_stores)} not connected`}
            icon={<IconStore className="h-5 w-5" />}
            accent="#38bdf8"
          />
          <StatCard
            label="Orders"
            value={formatNumber(overview.order_count)}
            sublabel={`${formatCompactCurrency(overview.total_revenue, CURRENCY)} volume`}
            icon={<IconOrders className="h-5 w-5" />}
            accent="#a78bfa"
          />
          <StatCard
            label="Gateway fees"
            value={formatCompactCurrency(overview.total_fees, CURRENCY)}
            sublabel={`${formatPercent(fees.totals.effective_rate)} effective rate`}
            icon={<IconCoin className="h-5 w-5" />}
            accent="#fbbf24"
          />
        </div>

        {/* Registered clients / subscribers */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Registered clients &amp; subscribers</CardTitle>
              <CardDescription>
                All {clients.length} registered users — subscription status, stores, and latest activity
              </CardDescription>
            </div>
            <IconUsers className="h-4 w-4 text-zinc-500" />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TRow>
                    <THeadCell>Client</THeadCell>
                    <THeadCell>Subscription</THeadCell>
                    <THeadCell>Stores</THeadCell>
                    <THeadCell className="text-right">Orders</THeadCell>
                    <THeadCell className="text-right">Revenue</THeadCell>
                    <THeadCell>Latest activity</THeadCell>
                    <THeadCell className="text-right">Joined</THeadCell>
                  </TRow>
                </THead>
                <TBody>
                  {clients.length === 0 ? (
                    <TRow>
                      <TCell colSpan={7} className="py-8 text-center text-sm text-zinc-500">
                        No registered clients yet.
                      </TCell>
                    </TRow>
                  ) : (
                    clients.map((client) => (
                      <TRow key={client.id}>
                        <TCell>
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-700/70 bg-zinc-800 text-[11px] font-semibold text-zinc-400">
                              {client.full_name
                                ? client.full_name
                                    .split(" ")
                                    .map((n) => n[0])
                                    .join("")
                                    .toUpperCase()
                                    .slice(0, 2)
                                : client.email[0].toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-zinc-100">
                                {client.full_name ?? "—"}
                              </p>
                              <p className="truncate text-xs text-zinc-500">{client.email}</p>
                            </div>
                          </div>
                        </TCell>
                        <TCell>
                          <Badge variant={SUBSCRIPTION_BADGE[client.subscription_status] ?? "neutral"}>
                            {SUBSCRIPTION_LABEL[client.subscription_status] ?? client.subscription_status}
                          </Badge>
                        </TCell>
                        <TCell>
                          {client.store_names.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {client.store_names.slice(0, 2).map((name) => (
                                <Badge key={name} variant="neutral">
                                  {name}
                                </Badge>
                              ))}
                              {client.store_names.length > 2 && (
                                <Badge variant="neutral">+{client.store_names.length - 2}</Badge>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-zinc-600">No stores</span>
                          )}
                        </TCell>
                        <TCell className="text-right text-zinc-300 tabular-nums">
                          {formatNumber(client.order_count)}
                        </TCell>
                        <TCell className="text-right text-zinc-100 tabular-nums">
                          {client.total_revenue > 0
                            ? formatCompactCurrency(client.total_revenue, CURRENCY)
                            : "—"}
                        </TCell>
                        <TCell>
                          {client.latest_activity ? (
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium text-zinc-300">
                                {relativeTime(client.latest_activity)}
                              </p>
                              {client.latest_activity_detail && (
                                <p className="truncate text-[11px] text-zinc-500">
                                  {client.latest_activity_detail}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-zinc-600">No activity</span>
                          )}
                        </TCell>
                        <TCell className="text-right text-xs text-zinc-500 tabular-nums">
                          {relativeTime(client.created_at)}
                        </TCell>
                      </TRow>
                    ))
                  )}
                </TBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Top stores + system health */}
        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>Top stores by revenue</CardTitle>
                <CardDescription>All stores, ranked by net revenue</CardDescription>
              </div>
              <IconStore className="h-4 w-4 text-zinc-500" />
            </CardHeader>
            <CardContent className="pt-4">
              <Table>
                <THead>
                  <TRow>
                    <THeadCell>Store</THeadCell>
                    <THeadCell>Platform</THeadCell>
                    <THeadCell>Status</THeadCell>
                    <THeadCell className="text-right">Orders</THeadCell>
                    <THeadCell className="text-right">Revenue</THeadCell>
                  </TRow>
                </THead>
                <TBody>
                  {topStores.map((store) => (
                    <TRow key={store.id}>
                      <TCell>
                        <p className="font-medium text-zinc-100">{store.name}</p>
                        <p className="text-xs text-zinc-500">{store.domain ?? "—"}</p>
                      </TCell>
                      <TCell>
                        <Badge variant="neutral">{store.platform}</Badge>
                      </TCell>
                      <TCell>
                        <Badge variant={STORE_STATUS_BADGE[store.status] ?? "neutral"}>
                          {store.status}
                        </Badge>
                      </TCell>
                      <TCell className="text-right text-zinc-300 tabular-nums">
                        {formatNumber(store.order_count)}
                      </TCell>
                      <TCell className="text-right text-zinc-100 tabular-nums">
                        {formatCompactCurrency(store.revenue, CURRENCY)}
                      </TCell>
                    </TRow>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>System health</CardTitle>
                <CardDescription>Webhooks &amp; integration pipeline</CardDescription>
              </div>
              <IconActivity className="h-4 w-4 text-zinc-500" />
            </CardHeader>
            <CardContent className="pt-4">
              <div className="mb-4 flex h-2 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="bg-emerald-400 transition-all duration-500"
                  style={{ width: `${(1 - failureRate) * 100}%` }}
                />
                <div
                  className="bg-red-400 transition-all duration-500"
                  style={{ width: `${failureRate * 100}%` }}
                />
              </div>
              <dl className="space-y-2">
                <div className="flex items-center justify-between rounded-lg bg-zinc-800/40 px-3 py-2">
                  <dt className="text-xs text-zinc-500">Status</dt>
                  <dd>
                    <Badge variant={healthy ? "success" : "danger"}>
                      {healthy ? "Healthy" : "Needs attention"}
                    </Badge>
                  </dd>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-zinc-800/40 px-3 py-2">
                  <dt className="text-xs text-zinc-500">Mode</dt>
                  <dd className="text-xs font-medium text-zinc-200">
                    {mode === "demo" ? "Demo" : "Live"}
                  </dd>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-zinc-800/40 px-3 py-2">
                  <dt className="text-xs text-zinc-500">Events processed</dt>
                  <dd className="text-xs font-medium text-zinc-200 tabular-nums">
                    {formatNumber(overview.event_count)}
                  </dd>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-zinc-800/40 px-3 py-2">
                  <dt className="text-xs text-zinc-500">Failed events</dt>
                  <dd className="text-xs font-medium text-zinc-200 tabular-nums">
                    {formatNumber(overview.failed_events)}
                  </dd>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-zinc-800/40 px-3 py-2">
                  <dt className="text-xs text-zinc-500">Failure rate</dt>
                  <dd
                    className={cn(
                      "text-xs font-medium tabular-nums",
                      healthy ? "text-emerald-400" : "text-red-400",
                    )}
                  >
                    {formatPercent(failureRate)}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>

        {/* Recent webhook activity */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Recent webhook activity</CardTitle>
              <CardDescription>Latest integration events across the platform</CardDescription>
            </div>
            <IconWebhook className="h-4 w-4 text-zinc-500" />
          </CardHeader>
          <CardContent className="pt-2">
            <ul className="space-y-1">
              {overview.recent_events.slice(0, 6).map((event, i) => (
                <li
                  key={`${event.id}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-zinc-800/40"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        event.status === "processed" ? "bg-emerald-400" : "bg-red-400",
                      )}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-zinc-200">
                        {event.provider} · {event.event_type}
                      </p>
                      <p className="truncate text-[11px] text-zinc-500">
                        {event.store_name} · {relativeTime(event.processed_at)}
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
    </main>
  );
}
