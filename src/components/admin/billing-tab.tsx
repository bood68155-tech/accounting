"use client";

// ─── Billing tab: subscriptions + per-user pricing ────────────────────────────
// Tremor-style KPI strip + shadcn-style searchable/filterable data table with
// inline subscription editing (status, plan, price overrides), rendered with
// the repo's hand-rolled brutalist primitives.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TBody, TCell, THead, THeadCell, TRow } from "@/components/ui/table";
import { StatCard } from "@/components/ui/stat-card";
import { IconCoin, IconRefresh, IconTag, IconUsers } from "@/components/icons";
import { updateSubscription } from "@/lib/admin/billing-actions";
import type { AdminBillingData, AdminBillingUser, BillingSubscriptionStatus } from "@/lib/admin/billing-types";
import { downloadCsv, useTableFilters } from "@/components/admin/table-filters";
import { formatCurrency, formatCompactCurrency, relativeTime } from "@/lib/utils";

const STATUS_BADGE: Record<BillingSubscriptionStatus, "success" | "info" | "warning" | "danger"> = {
  active: "success",
  trial: "info",
  past_due: "warning",
  cancelled: "danger",
};

const STATUS_OPTIONS: BillingSubscriptionStatus[] = ["trial", "active", "past_due", "cancelled"];

export function BillingTab({ data }: { data: AdminBillingData }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    status: BillingSubscriptionStatus;
    monthlyPrice: string;
    firstMonthPrice: string;
    planId: string;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const { filtered, filterBar } = useTableFilters<AdminBillingUser>(
    data.users,
    (u) => `${u.email} ${u.fullName ?? ""} ${u.subscription?.planName ?? ""} ${u.subscription?.couponCode ?? ""}`,
    [
      {
        key: "status",
        label: "Status",
        options: [...STATUS_OPTIONS, "none"],
        value: (u) => u.subscription?.status ?? "none",
      },
      {
        key: "plan",
        label: "Plan",
        options: data.plans.map((p) => p.code),
        value: (u) => u.subscription?.planCode ?? "none",
      },
    ],
  );

  function startEdit(user: AdminBillingUser) {
    setEditingId(user.id);
    setDraft({
      status: user.subscription?.status ?? "trial",
      monthlyPrice: user.subscription ? String(user.subscription.monthlyPrice) : "",
      firstMonthPrice: user.subscription ? String(user.subscription.firstMonthPrice) : "",
      planId: user.subscription?.planCode ?? "",
    });
  }

  async function saveEdit(user: AdminBillingUser) {
    if (!draft) return;
    setMessage(null);

    const plan = data.plans.find((p) => p.code === draft.planId);
    const parse = (v: string): number | null | undefined => {
      if (v.trim() === "") return undefined; // clear override
      const n = Number.parseFloat(v);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const monthly = parse(draft.monthlyPrice);
    const firstMonth = parse(draft.firstMonthPrice);
    if (monthly === null || firstMonth === null) {
      setMessage("Prices must be non-negative numbers (empty = inherit plan price).");
      return;
    }

    const result = await updateSubscription({
      userId: user.id,
      status: draft.status,
      monthlyPrice: monthly === undefined ? null : monthly,
      firstMonthPrice: firstMonth === undefined ? null : firstMonth,
      planId: plan?.id ?? null,
    });

    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setEditingId(null);
    setDraft(null);
    setMessage(`Saved billing for ${user.email}.`);
    startTransition(() => router.refresh());
  }

  function exportCsv() {
    downloadCsv(
      `admin-subscriptions-${new Date().toISOString().slice(0, 10)}.csv`,
      ["email", "name", "status", "plan", "monthly_price", "first_month_price", "currency", "trial_ends_at", "stores", "created_at"],
      filtered.map((u) => [
        u.email,
        u.fullName ?? "",
        u.subscription?.status ?? "none",
        u.subscription?.planCode ?? "",
        u.subscription?.monthlyPrice ?? "",
        u.subscription?.firstMonthPrice ?? "",
        u.subscription?.currency ?? "USD",
        u.subscription?.trialEndsAt ?? "",
        u.storeCount,
        u.createdAt,
      ]),
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI strip (Tremor-style stats) */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active"
          value={String(data.totals.activeSubscriptions)}
          sublabel={`${formatCompactCurrency(data.totals.mrr, data.totals.currency)} MRR`}
          icon={<IconCoin className="h-5 w-5" />}
        />
        <StatCard label="In trial" value={String(data.totals.trialSubscriptions)} icon={<IconUsers className="h-5 w-5" />} />
        <StatCard label="Past due" value={String(data.totals.pastDue)} icon={<IconRefresh className="h-5 w-5" />} />
        <StatCard label="Cancelled" value={String(data.totals.cancelled)} icon={<IconTag className="h-5 w-5" />} />
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Users &amp; subscriptions</CardTitle>
            <CardDescription>
              Set monthly rates per user or plan tier — first month free, then the recurring price
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            Export CSV
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          {filterBar}
          {message && (
            <p role="status" className="border border-accent px-3 py-2 text-xs font-medium text-accent">
              {message}
            </p>
          )}
          <Table>
            <THead>
              <TRow>
                <THeadCell>User</THeadCell>
                <THeadCell>Status</THeadCell>
                <THeadCell>Plan</THeadCell>
                <THeadCell className="text-right">Monthly</THeadCell>
                <THeadCell className="text-right">First month</THeadCell>
                <THeadCell>Stores</THeadCell>
                <THeadCell>Last login</THeadCell>
                <THeadCell className="text-right">Edit</THeadCell>
              </TRow>
            </THead>
            <TBody>
              {filtered.length === 0 ? (
                <TRow>
                  <TCell colSpan={8} className="py-8 text-center text-sm text-zinc-500">
                    No users match the current filters.
                  </TCell>
                </TRow>
              ) : (
                filtered.map((user) => {
                  const editing = editingId === user.id;
                  const sub = user.subscription;
                  return (
                    <TRow key={user.id}>
                      <TCell>
                        <p className="truncate font-medium text-zinc-100">{user.fullName ?? "—"}</p>
                        <p className="truncate text-xs text-zinc-500">{user.email}</p>
                      </TCell>
                      <TCell>
                        {editing && draft ? (
                          <Select
                            value={draft.status}
                            onChange={(e) => setDraft({ ...draft, status: e.target.value as BillingSubscriptionStatus })}
                            className="h-8 w-32 text-xs"
                          >
                            {STATUS_OPTIONS.map((s) => (
                              <option key={s} value={s}>
                                {s.replace(/_/g, " ")}
                              </option>
                            ))}
                          </Select>
                        ) : sub ? (
                          <Badge variant={STATUS_BADGE[sub.status] ?? "neutral"}>{sub.status.replace(/_/g, " ")}</Badge>
                        ) : (
                          <Badge variant="neutral">none</Badge>
                        )}
                      </TCell>
                      <TCell className="text-xs text-zinc-300">
                        {editing && draft ? (
                          <Select
                            value={draft.planId}
                            onChange={(e) => setDraft({ ...draft, planId: e.target.value })}
                            className="h-8 w-32 text-xs"
                          >
                            <option value="">— inherit —</option>
                            {data.plans.map((p) => (
                              <option key={p.id} value={p.code}>
                                {p.name}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          (sub?.planName ?? "—")
                        )}
                      </TCell>
                      <TCell className="text-right tabular-nums">
                        {editing && draft ? (
                          <Input
                            value={draft.monthlyPrice}
                            onChange={(e) => setDraft({ ...draft, monthlyPrice: e.target.value })}
                            inputMode="decimal"
                            placeholder={sub ? String(sub.monthlyPrice) : "30"}
                            className="h-8 w-24 text-right text-xs"
                          />
                        ) : sub ? (
                          formatCurrency(sub.monthlyPrice, sub.currency)
                        ) : (
                          "—"
                        )}
                      </TCell>
                      <TCell className="text-right tabular-nums">
                        {editing && draft ? (
                          <Input
                            value={draft.firstMonthPrice}
                            onChange={(e) => setDraft({ ...draft, firstMonthPrice: e.target.value })}
                            inputMode="decimal"
                            placeholder={sub ? String(sub.firstMonthPrice) : "0"}
                            className="h-8 w-24 text-right text-xs"
                          />
                        ) : sub ? (
                          sub.firstMonthPrice === 0 ? (
                            <span className="text-accent">Free</span>
                          ) : (
                            formatCurrency(sub.firstMonthPrice, sub.currency)
                          )
                        ) : (
                          "—"
                        )}
                      </TCell>
                      <TCell className="tabular-nums text-zinc-300">{user.storeCount}</TCell>
                      <TCell className="text-xs text-zinc-500">
                        {user.lastLoginAt ? relativeTime(user.lastLoginAt) : "never"}
                      </TCell>
                      <TCell className="text-right">
                        {editing ? (
                          <div className="flex justify-end gap-1.5">
                            <Button size="sm" onClick={() => saveEdit(user)} disabled={isPending}>
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditingId(null);
                                setDraft(null);
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button size="sm" variant="secondary" onClick={() => startEdit(user)}>
                            Edit
                          </Button>
                        )}
                      </TCell>
                    </TRow>
                  );
                })
              )}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
