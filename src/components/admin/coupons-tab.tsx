"use client";

// ─── Coupons tab: discount codes + usage history ──────────────────────────────
// Create percent/fixed coupons (global or per-user), set active promotional
// windows, toggle/delete codes, and review redemption history. shadcn-style
// searchable table over the repo's brutalist primitives.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TBody, TCell, THead, THeadCell, TRow } from "@/components/ui/table";
import {
  deleteCoupon,
  recordCouponRedemption,
  toggleCoupon,
  upsertCoupon,
} from "@/lib/admin/billing-actions";
import type { AdminBillingData, AdminCoupon, CouponDuration, DiscountType } from "@/lib/admin/billing-types";
import { downloadCsv, useTableFilters } from "@/components/admin/table-filters";
import { formatCurrency, formatDate, relativeTime } from "@/lib/utils";

const EMPTY_FORM = {
  code: "",
  description: "",
  discountType: "percent" as DiscountType,
  discountValue: "10",
  userId: "",
  expiresAt: "",
  maxRedemptions: "",
  duration: "once" as CouponDuration,
  durationMonths: "1",
};

export function CouponsTab({ data }: { data: AdminBillingData }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState(EMPTY_FORM);
  const [message, setMessage] = useState<string | null>(null);

  const { filtered, filterBar } = useTableFilters<AdminCoupon>(
    data.coupons,
    (c) => `${c.code} ${c.description ?? ""} ${c.userEmail ?? "global"}`,
    [
      { key: "state", label: "State", options: ["active", "inactive"], value: (c) => (c.active ? "active" : "inactive") },
      { key: "type", label: "Type", options: ["percent", "fixed"], value: (c) => c.discountType },
      { key: "scope", label: "Scope", options: ["global", "user"], value: (c) => (c.userId ? "user" : "global") },
    ],
  );

  async function createCoupon() {
    setMessage(null);
    const value = Number.parseFloat(form.discountValue);
    if (!Number.isFinite(value) || value < 0) {
      setMessage("Discount value must be a non-negative number.");
      return;
    }
    const result = await upsertCoupon({
      code: form.code,
      description: form.description || null,
      discountType: form.discountType,
      discountValue: value,
      userId: form.userId || null,
      expiresAt: form.expiresAt || null,
      maxRedemptions: form.maxRedemptions ? Number.parseInt(form.maxRedemptions, 10) : null,
      duration: form.duration,
      durationMonths: form.duration === "repeating" ? Number.parseInt(form.durationMonths, 10) || 1 : null,
      active: true,
    });
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setForm(EMPTY_FORM);
    setMessage(`Coupon created.`);
    startTransition(() => router.refresh());
  }

  async function onToggle(coupon: AdminCoupon) {
    const result = await toggleCoupon(coupon.id, !coupon.active);
    if (!result.ok) setMessage(result.error);
    startTransition(() => router.refresh());
  }

  async function onDelete(coupon: AdminCoupon) {
    const result = await deleteCoupon(coupon.id);
    if (!result.ok) setMessage(result.error);
    else setMessage(`Coupon ${coupon.code} deleted.`);
    startTransition(() => router.refresh());
  }

  async function onRedeem(coupon: AdminCoupon) {
    if (!coupon.userId) {
      setMessage("Pick a specific user above to record a redemption for a per-user coupon.");
      return;
    }
    const amount =
      coupon.discountType === "percent"
        ? 0 // percent redeemed against an invoice — amount logged at payment time
        : coupon.discountValue;
    const result = await recordCouponRedemption(coupon.id, coupon.userId, amount);
    if (!result.ok) setMessage(result.error);
    startTransition(() => router.refresh());
  }

  function exportCsv() {
    downloadCsv(
      `admin-coupons-${new Date().toISOString().slice(0, 10)}.csv`,
      ["code", "type", "value", "scope", "duration", "expires_at", "max", "used", "active"],
      filtered.map((c) => [
        c.code,
        c.discountType,
        c.discountValue,
        c.userEmail ?? "GLOBAL",
        c.duration,
        c.expiresAt ?? "",
        c.maxRedemptions ?? "",
        c.timesUsed,
        c.active,
      ]),
    );
  }

  return (
    <div className="space-y-6">
      {/* Create coupon */}
      <Card>
        <CardHeader>
          <CardTitle>New discount code</CardTitle>
          <CardDescription>
            Percent or fixed-amount discounts — global, or bound to one user. Promotional period via
            expiry + redemption cap.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 pt-2 sm:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="coupon-code">Code</Label>
            <Input
              id="coupon-code"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              placeholder="LAUNCH20"
              className="h-9 font-mono text-xs uppercase"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="coupon-type">Type</Label>
            <Select
              id="coupon-type"
              value={form.discountType}
              onChange={(e) => setForm({ ...form, discountType: e.target.value as DiscountType })}
              className="h-9 text-xs"
            >
              <option value="percent">Percent (%)</option>
              <option value="fixed">Fixed ($)</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="coupon-value">Value</Label>
            <Input
              id="coupon-value"
              value={form.discountValue}
              onChange={(e) => setForm({ ...form, discountValue: e.target.value })}
              inputMode="decimal"
              className="h-9 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="coupon-user">Scope</Label>
            <Select
              id="coupon-user"
              value={form.userId}
              onChange={(e) => setForm({ ...form, userId: e.target.value })}
              className="h-9 text-xs"
            >
              <option value="">Global — all users</option>
              {data.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.email}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="coupon-duration">Duration</Label>
            <Select
              id="coupon-duration"
              value={form.duration}
              onChange={(e) => setForm({ ...form, duration: e.target.value as CouponDuration })}
              className="h-9 text-xs"
            >
              <option value="once">Once</option>
              <option value="repeating">Repeating months</option>
              <option value="forever">Forever</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="coupon-months">Months</Label>
            <Input
              id="coupon-months"
              value={form.durationMonths}
              onChange={(e) => setForm({ ...form, durationMonths: e.target.value })}
              disabled={form.duration !== "repeating"}
              inputMode="numeric"
              className="h-9 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="coupon-expires">Expires</Label>
            <Input
              id="coupon-expires"
              type="date"
              value={form.expiresAt}
              onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
              className="h-9 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="coupon-max">Max redemptions</Label>
            <Input
              id="coupon-max"
              value={form.maxRedemptions}
              onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value })}
              inputMode="numeric"
              placeholder="∞"
              className="h-9 text-xs"
            />
          </div>
          <div className="flex items-end sm:col-span-2 xl:col-span-4">
            <Button onClick={createCoupon} disabled={isPending || !form.code.trim()}>
              Create coupon
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Coupon table */}
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Coupons ({data.coupons.length})</CardTitle>
            <CardDescription>Active promotions, scope and usage counters</CardDescription>
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
                <THeadCell>Code</THeadCell>
                <THeadCell>Discount</THeadCell>
                <THeadCell>Scope</THeadCell>
                <THeadCell>Period</THeadCell>
                <THeadCell className="text-right">Used</THeadCell>
                <THeadCell>State</THeadCell>
                <THeadCell className="text-right">Actions</THeadCell>
              </TRow>
            </THead>
            <TBody>
              {filtered.length === 0 ? (
                <TRow>
                  <TCell colSpan={7} className="py-8 text-center text-sm text-zinc-500">
                    No coupons yet — create one above.
                  </TCell>
                </TRow>
              ) : (
                filtered.map((coupon) => (
                  <TRow key={coupon.id}>
                    <TCell>
                      <p className="font-mono text-xs font-bold text-white">{coupon.code}</p>
                      {coupon.description && (
                        <p className="truncate text-[11px] text-zinc-500">{coupon.description}</p>
                      )}
                    </TCell>
                    <TCell className="text-sm tabular-nums text-zinc-100">{coupon.discountLabel}</TCell>
                    <TCell className="text-xs">
                      {coupon.userId ? (
                        <Badge variant="info">{coupon.userEmail ?? "user"}</Badge>
                      ) : (
                        <Badge variant="neutral">global</Badge>
                      )}
                    </TCell>
                    <TCell className="text-xs text-zinc-400">
                      {coupon.expiresAt ? `until ${formatDate(coupon.expiresAt)}` : "no expiry"}
                      {coupon.duration === "repeating" && coupon.durationMonths
                        ? ` · ${coupon.durationMonths}mo`
                        : ""}
                    </TCell>
                    <TCell className="text-right tabular-nums text-zinc-300">
                      {coupon.timesUsed}
                      {coupon.maxRedemptions ? ` / ${coupon.maxRedemptions}` : ""}
                    </TCell>
                    <TCell>
                      <Badge variant={coupon.active ? "success" : "neutral"}>
                        {coupon.active ? "active" : "inactive"}
                      </Badge>
                    </TCell>
                    <TCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {coupon.userId && (
                          <Button size="sm" variant="secondary" onClick={() => onRedeem(coupon)} disabled={isPending}>
                            Redeem
                          </Button>
                        )}
                        <Button size="sm" variant="secondary" onClick={() => onToggle(coupon)} disabled={isPending}>
                          {coupon.active ? "Pause" : "Resume"}
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => onDelete(coupon)} disabled={isPending}>
                          Delete
                        </Button>
                      </div>
                    </TCell>
                  </TRow>
                ))
              )}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      {/* Redemption history */}
      <Card>
        <CardHeader>
          <CardTitle>Discount usage history</CardTitle>
          <CardDescription>Latest {data.redemptions.length} redemptions across the platform</CardDescription>
        </CardHeader>
        <CardContent className="pt-2">
          <Table>
            <THead>
              <TRow>
                <THeadCell>Code</THeadCell>
                <THeadCell>User</THeadCell>
                <THeadCell className="text-right">Discount</THeadCell>
                <THeadCell>When</THeadCell>
              </TRow>
            </THead>
            <TBody>
              {data.redemptions.length === 0 ? (
                <TRow>
                  <TCell colSpan={4} className="py-6 text-center text-sm text-zinc-500">
                    No redemptions recorded yet.
                  </TCell>
                </TRow>
              ) : (
                data.redemptions.map((r) => (
                  <TRow key={r.id}>
                    <TCell className="font-mono text-xs font-bold text-white">{r.code}</TCell>
                    <TCell className="text-xs text-zinc-300">{r.userEmail ?? r.id}</TCell>
                    <TCell className="text-right tabular-nums text-zinc-100">
                      {formatCurrency(r.discountAmount)}
                    </TCell>
                    <TCell className="text-xs text-zinc-500">{relativeTime(r.redeemedAt)}</TCell>
                  </TRow>
                ))
              )}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
