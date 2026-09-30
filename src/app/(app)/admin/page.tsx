import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PinGate } from "@/components/admin/pin-gate";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { BillingTab } from "@/components/admin/billing-tab";
import { CouponsTab } from "@/components/admin/coupons-tab";
import { AuditTab } from "@/components/admin/audit-tab";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { fetchAdminBillingData } from "@/lib/admin/billing-queries";
import { auth } from "@/lib/auth";
import { cn, formatCompactCurrency, formatNumber, formatPercent, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin Panel" };

const CURRENCY = "USD";

const STORE_STATUS_BADGE: Record<string, "success" | "warning" | "neutral" | "danger"> = {
  connected: "success",
  syncing: "warning",
  disconnected: "neutral",
};

export default async function AdminPage() {
  // ─── Email gate ─────────────────────────────────────────────────────────────
  // Strict guard: only the platform owner (bood68155@gmail.com) can access.
  // (The admin layout re-checks this too — defense in depth.)
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!isAdminEmail(session.user.email)) redirect("/dashboard");

  // ─── PIN gate ───────────────────────────────────────────────────────────────
  // The cookie is httpOnly, holds an HMAC token keyed by the PIN (unforgeable
  // without it), and is only issued by the server action after verification.
  const cookieStore = await cookies();
  if (!pinTokenMatches(cookieStore.get(ADMIN_PIN_COOKIE)?.value)) {
    return <PinGate />;
  }

  const [data, billing] = await Promise.all([fetchAdminData(), fetchAdminBillingData()]);
  const { overview, stores, fees, clients } = data;
  const failureRate =
    overview.event_count > 0 ? overview.failed_events / overview.event_count : 0;
  const healthy = failureRate <= 0.05;
  const topStores = [...stores].sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  // ─── Tab contents (server-rendered slots) ───────────────────────────────────

  const overviewTab = (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Users"
          value={formatNumber(overview.user_count)}
          sublabel={`${formatNumber(overview.store_count)} stores total`}
          icon={<IconUsers className="h-5 w-5" />}
        />
        <StatCard
          label="Connected stores"
          value={formatNumber(overview.connected_stores)}
          sublabel={`${formatNumber(overview.store_count - overview.connected_stores)} not connected`}
          icon={<IconStore className="h-5 w-5" />}
        />
        <StatCard
          label="Orders"
          value={formatNumber(overview.order_count)}
          sublabel={`${formatCompactCurrency(overview.total_revenue, CURRENCY)} volume`}
          icon={<IconOrders className="h-5 w-5" />}
        />
        <StatCard
          label="Gateway fees"
          value={formatCompactCurrency(overview.total_fees, CURRENCY)}
          sublabel={`${formatPercent(fees.totals.effective_rate)} effective rate`}
          icon={<IconCoin className="h-5 w-5" />}
        />
      </div>

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
            <div className="mb-4 flex h-2 overflow-hidden">
              <div className="bg-emerald-400" style={{ width: `${(1 - failureRate) * 100}%` }} />
              <div className="bg-red-400" style={{ width: `${failureRate * 100}%` }} />
            </div>
            <dl className="space-y-2">
              <div className="flex items-center justify-between border border-zinc-800 px-3 py-2">
                <dt className="text-xs text-zinc-500">Status</dt>
                <dd>
                  <Badge variant={healthy ? "success" : "danger"}>
                    {healthy ? "Healthy" : "Needs attention"}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-center justify-between border border-zinc-800 px-3 py-2">
                <dt className="text-xs text-zinc-500">Isolation</dt>
                <dd className="text-xs font-medium text-zinc-200">Schema-per-tenant</dd>
              </div>
              <div className="flex items-center justify-between border border-zinc-800 px-3 py-2">
                <dt className="text-xs text-zinc-500">Events processed</dt>
                <dd className="text-xs font-medium text-zinc-200 tabular-nums">
                  {formatNumber(overview.event_count)}
                </dd>
              </div>
              <div className="flex items-center justify-between border border-zinc-800 px-3 py-2">
                <dt className="text-xs text-zinc-500">Failed events</dt>
                <dd className="text-xs font-medium text-zinc-200 tabular-nums">
                  {formatNumber(overview.failed_events)}
                </dd>
              </div>
              <div className="flex items-center justify-between border border-zinc-800 px-3 py-2">
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
                className="flex items-center justify-between gap-2 px-2 py-2 transition-colors hover:bg-zinc-900"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0",
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

      {/* Registered clients snapshot (full management lives in Billing) */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Registered clients</CardTitle>
            <CardDescription>
              Snapshot of all {clients.length} users — subscription status and activity
            </CardDescription>
          </div>
          <IconUsers className="h-4 w-4 text-zinc-500" />
        </CardHeader>
        <CardContent className="pt-2">
          <Table>
            <THead>
              <TRow>
                <THeadCell>Client</THeadCell>
                <THeadCell>Subscription</THeadCell>
                <THeadCell>Stores</THeadCell>
                <THeadCell className="text-right">Orders</THeadCell>
                <THeadCell className="text-right">Revenue</THeadCell>
                <THeadCell>Latest activity</THeadCell>
              </TRow>
            </THead>
            <TBody>
              {clients.length === 0 ? (
                <TRow>
                  <TCell colSpan={6} className="py-8 text-center text-sm text-zinc-500">
                    No registered clients yet.
                  </TCell>
                </TRow>
              ) : (
                clients.map((client) => (
                  <TRow key={client.id}>
                    <TCell>
                      <p className="truncate font-medium text-zinc-100">
                        {client.full_name ?? "—"}
                      </p>
                      <p className="truncate text-xs text-zinc-500">{client.email}</p>
                    </TCell>
                    <TCell>
                      <Badge variant="neutral">{client.subscription_status}</Badge>
                    </TCell>
                    <TCell className="text-zinc-300 tabular-nums">{client.store_count}</TCell>
                    <TCell className="text-right text-zinc-300 tabular-nums">
                      {formatNumber(client.order_count)}
                    </TCell>
                    <TCell className="text-right text-zinc-100 tabular-nums">
                      {client.total_revenue > 0
                        ? formatCompactCurrency(client.total_revenue, CURRENCY)
                        : "—"}
                    </TCell>
                    <TCell className="text-xs text-zinc-500">
                      {client.latest_activity ? relativeTime(client.latest_activity) : "No activity"}
                    </TCell>
                  </TRow>
                ))
              )}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );

  const billingTab = <BillingTab data={billing} />;
  const couponsTab = <CouponsTab data={billing} />;
  const auditTab = <AuditTab entries={billing.auditLog} />;

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      {/* Page header */}
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-white px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="frame-icon h-9 w-9">
            <IconShield className="h-4.5 w-4.5 text-accent" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-bold uppercase tracking-[0.04em] text-white">
              Admin Panel
            </h1>
            <p className="type-kicker truncate text-zinc-500">
              Platform · billing · promotions · audit
            </p>
          </div>
        </div>
        <Badge variant="default">Restricted</Badge>
      </header>

      <div className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-6 py-6">
        <AdminTabs
          tabs={[
            { id: "overview", label: "Overview", content: overviewTab },
            { id: "billing", label: "Billing", content: billingTab },
            { id: "coupons", label: "Coupons", content: couponsTab },
            { id: "audit", label: "Audit log", content: auditTab },
          ]}
        />
      </div>
    </main>
  );
}
