import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/auth";
import { fetchAdminBillingData } from "@/lib/admin/billing-queries";

export const dynamic = "force-dynamic";

// ─── CSV export for the admin console tables ──────────────────────────────────
// GET /api/admin/export?dataset=users|coupons|redemptions|audit
// Returns a text/csv attachment. Guarded by the admin email gate.

function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(","));
  }
  return lines.join("\r\n");
}

export async function GET(request: Request) {
  const access = await requireAdminAccess();
  if (!access.granted) {
    return NextResponse.json({ error: access.message }, { status: access.status });
  }
  if (!requireDbConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 400 });
  }

  const dataset = new URL(request.url).searchParams.get("dataset") ?? "users";
  const data = await fetchAdminBillingData();

  let csv: string;
  switch (dataset) {
    case "coupons":
      csv = toCsv(
        ["code", "discount_type", "discount_value", "scope_user_email", "duration", "duration_months", "starts_at", "expires_at", "max_redemptions", "times_used", "active", "created_at"],
        data.coupons.map((c) => [
          c.code,
          c.discountType,
          c.discountValue,
          c.userEmail ?? "GLOBAL",
          c.duration,
          c.durationMonths ?? "",
          c.startsAt ?? "",
          c.expiresAt ?? "",
          c.maxRedemptions ?? "",
          c.timesUsed,
          c.active,
          c.createdAt,
        ]),
      );
      break;
    case "redemptions":
      csv = toCsv(
        ["code", "user_email", "discount_amount", "redeemed_at"],
        data.redemptions.map((r) => [r.code, r.userEmail ?? "", r.discountAmount, r.redeemedAt]),
      );
      break;
    case "audit":
      csv = toCsv(
        ["timestamp", "actor_email", "action", "target_type", "target_id", "detail"],
        data.auditLog.map((a) => [
          a.createdAt,
          a.actorEmail,
          a.action,
          a.targetType ?? "",
          a.targetId ?? "",
          JSON.stringify(a.detail),
        ]),
      );
      break;
    case "users":
    default:
      csv = toCsv(
        ["email", "name", "subscription_status", "plan", "monthly_price", "first_month_price", "currency", "coupon_code", "trial_ends_at", "stores", "disabled", "created_at", "last_login_at"],
        data.users.map((u) => [
          u.email,
          u.fullName ?? "",
          u.subscription?.status ?? "none",
          u.subscription?.planCode ?? "",
          u.subscription?.monthlyPrice ?? "",
          u.subscription?.firstMonthPrice ?? "",
          u.subscription?.currency ?? "USD",
          u.subscription?.couponCode ?? "",
          u.subscription?.trialEndsAt ?? "",
          u.storeCount,
          u.disabled,
          u.createdAt,
          u.lastLoginAt ?? "",
        ]),
      );
      break;
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="admin-${dataset}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

function requireDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
