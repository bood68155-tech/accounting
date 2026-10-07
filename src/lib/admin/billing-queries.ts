import { desc } from "drizzle-orm";
import { isDatabaseConfigured, requireDb, publicSchema } from "@/lib/db";
import type {
  AdminAuditEntry,
  AdminBillingData,
  AdminBillingUser,
  AdminCoupon,
  AdminCouponRedemption,
  AdminPlan,
  PendingPayment,
} from "@/lib/admin/billing-types";

// ─── Admin billing repository ─────────────────────────────────────────────────
// Reads the shared billing tables (plans, subscriptions, coupons, audit log)
// from the public schema and aggregates store counts per user across tenant
// schemas. Server-only module.

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function money(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** "20% off" / "$10 off" label for coupon rows. */
function discountLabel(type: "percent" | "fixed", value: number): string {
  return type === "percent" ? `${value}% off` : `$${value} off`;
}

/**
 * Fetch everything the billing section needs in one round of queries.
 * Store counts require walking tenant schemas (same approach as queries.ts).
 */
export async function fetchAdminBillingData(): Promise<AdminBillingData> {
  if (!isDatabaseConfigured()) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const db = requireDb();
  const {
    users,
    profiles,
    subscriptionPlans,
    userSubscriptions,
    coupons,
    couponRedemptions,
    adminAuditLog,
    pendingPayments,
  } = publicSchema;

  const [userRows, profileRows, planRows, subRows, couponRows, redemptionRows, auditRows, pendingPaymentDbRows] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        disabled: users.disabled,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt)),
    db.select({ id: profiles.id, fullName: profiles.fullName }).from(profiles),
    db.select().from(subscriptionPlans).orderBy(subscriptionPlans.monthlyPrice),
    db
      .select({
        id: userSubscriptions.id,
        userId: userSubscriptions.userId,
        planId: userSubscriptions.planId,
        status: userSubscriptions.status,
        monthlyPrice: userSubscriptions.monthlyPrice,
        firstMonthPrice: userSubscriptions.firstMonthPrice,
        periodStart: userSubscriptions.periodStart,
        periodEnd: userSubscriptions.periodEnd,
        trialEndsAt: userSubscriptions.trialEndsAt,
        couponCode: userSubscriptions.couponCode,
        notes: userSubscriptions.notes,
      })
      .from(userSubscriptions),
    db
      .select({
        id: coupons.id,
        code: coupons.code,
        description: coupons.description,
        discountType: coupons.discountType,
        discountValue: coupons.discountValue,
        userId: coupons.userId,
        startsAt: coupons.startsAt,
        expiresAt: coupons.expiresAt,
        maxRedemptions: coupons.maxRedemptions,
        timesUsed: coupons.timesUsed,
        duration: coupons.duration,
        durationMonths: coupons.durationMonths,
        active: coupons.active,
        createdAt: coupons.createdAt,
      })
      .from(coupons)
      .orderBy(desc(coupons.createdAt)),
    db
      .select({
        id: couponRedemptions.id,
        code: couponRedemptions.code,
        userId: couponRedemptions.userId,
        discountAmount: couponRedemptions.discountAmount,
        redeemedAt: couponRedemptions.redeemedAt,
      })
      .from(couponRedemptions)
      .orderBy(desc(couponRedemptions.redeemedAt))
      .limit(200),
    db
      .select({
        id: adminAuditLog.id,
        actorEmail: adminAuditLog.actorEmail,
        action: adminAuditLog.action,
        targetType: adminAuditLog.targetType,
        targetId: adminAuditLog.targetId,
        detail: adminAuditLog.detail,
        createdAt: adminAuditLog.createdAt,
      })
      .from(adminAuditLog)
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(100),
    db
      .select({
        id: pendingPayments.id,
        userId: pendingPayments.userId,
        payId: pendingPayments.payId,
        txId: pendingPayments.txId,
        amountUsd: pendingPayments.amountUsd,
        planCode: pendingPayments.planCode,
        requestedAt: pendingPayments.requestedAt,
        status: pendingPayments.status,
        reviewedBy: pendingPayments.reviewedBy,
        reviewedAt: pendingPayments.reviewedAt,
        rejectionReason: pendingPayments.rejectionReason,
      })
      .from(pendingPayments)
      .orderBy(desc(pendingPayments.requestedAt)),
  ]);

  // Lookups
  const planById = new Map(planRows.map((p) => [p.id, p]));
  const defaultPlan = planRows.find((p) => p.isDefault) ?? planRows[0] ?? null;
  const nameById = new Map(profileRows.map((p) => [p.id, p.fullName ?? null]));
  const subByUser = new Map(subRows.map((s) => [s.userId, s]));
  const emailById = new Map(userRows.map((u) => [u.id, u.email]));

  // Per-user store counts (tenant schemas).
  const storeCounts = new Map<string, number>();
  const { tenants } = publicSchema;
  const tenantRows = await db.select({ schemaName: tenants.schemaName }).from(tenants);
  const { isTenantSchema, getTenantTables, tenantDb } = await import("@/lib/db");
  for (const tenant of tenantRows) {
    const schema = tenant.schemaName;
    if (!schema || !isTenantSchema(schema)) continue;
    const t = getTenantTables(schema);
    const rows = await tenantDb(schema)
      .select({ userId: t.stores.userId, id: t.stores.id })
      .from(t.stores);
    for (const row of rows) {
      storeCounts.set(row.userId, (storeCounts.get(row.userId) ?? 0) + 1);
    }
  }

  const currency = defaultPlan?.currency ?? "USD";

  // Pending binance pay invoices (normalized) grouped by the submitting user.
  const pendingPaymentList: PendingPayment[] = pendingPaymentDbRows.map((p) => ({
    id: p.id,
    userId: p.userId,
    payId: p.payId,
    txId: p.txId,
    amountUsd: Number(p.amountUsd),
    planCode: p.planCode,
    requestedAt: toIso(p.requestedAt) ?? new Date().toISOString(),
    status: p.status as PendingPayment["status"],
    reviewedBy: p.reviewedBy,
    reviewedAt: toIso(p.reviewedAt),
    rejectionReason: p.rejectionReason,
  }));

  const pendingByUser = new Map<string, PendingPayment[]>();
  for (const payment of pendingPaymentList) {
    const list = pendingByUser.get(payment.userId) ?? [];
    pendingByUser.set(payment.userId, [...list, payment]);
  }

  const billingUsers: AdminBillingUser[] = userRows.map((u) => {
    const sub = subByUser.get(u.id);
    const plan = sub?.planId ? planById.get(sub.planId) : undefined;
    const effectivePlan = plan ?? defaultPlan;
    return {
      id: u.id,
      email: u.email,
      fullName: nameById.get(u.id) ?? null,
      disabled: u.disabled,
      createdAt: toIso(u.createdAt) ?? new Date().toISOString(),
      lastLoginAt: toIso(u.lastLoginAt),
      storeCount: storeCounts.get(u.id) ?? 0,
      subscription: sub
        ? {
            status: sub.status,
            planCode: effectivePlan?.code ?? null,
            planName: effectivePlan?.name ?? null,
            monthlyPrice: money(sub.monthlyPrice, effectivePlan?.monthlyPrice ?? 0),
            firstMonthPrice: money(sub.firstMonthPrice, effectivePlan?.firstMonthPrice ?? 0),
            currency: effectivePlan?.currency ?? currency,
            periodStart: toIso(sub.periodStart),
            periodEnd: toIso(sub.periodEnd),
            trialEndsAt: toIso(sub.trialEndsAt),
            couponCode: sub.couponCode,
            notes: sub.notes,
          }
        : null,
    };
  });

  const adminCoupons: AdminCoupon[] = couponRows.map((c) => ({
    id: c.id,
    code: c.code,
    description: c.description,
    discountType: c.discountType,
    discountValue: c.discountValue,
    discountLabel: discountLabel(c.discountType, c.discountValue),
    userId: c.userId,
    userEmail: c.userId ? (emailById.get(c.userId) ?? null) : null,
    startsAt: toIso(c.startsAt),
    expiresAt: toIso(c.expiresAt),
    maxRedemptions: c.maxRedemptions,
    timesUsed: c.timesUsed,
    duration: c.duration,
    durationMonths: c.durationMonths,
    active: c.active,
    createdAt: toIso(c.createdAt) ?? new Date().toISOString(),
  }));

  const redemptions: AdminCouponRedemption[] = redemptionRows.map((r) => ({
    id: r.id,
    code: r.code,
    userEmail: emailById.get(r.userId) ?? null,
    discountAmount: r.discountAmount,
    redeemedAt: toIso(r.redeemedAt) ?? new Date().toISOString(),
  }));

  const auditLog: AdminAuditEntry[] = auditRows.map((a) => ({
    id: a.id,
    actorEmail: a.actorEmail,
    action: a.action,
    targetType: a.targetType,
    targetId: a.targetId,
    detail: a.detail ?? {},
    createdAt: toIso(a.createdAt) ?? new Date().toISOString(),
  }));

  const plans: AdminPlan[] = planRows.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    firstMonthPrice: p.firstMonthPrice,
    monthlyPrice: p.monthlyPrice,
    currency: p.currency,
    trialDays: p.trialDays,
    isDefault: p.isDefault,
  }));

  const totals = {
    activeSubscriptions: billingUsers.filter((u) => u.subscription?.status === "active").length,
    trialSubscriptions: billingUsers.filter((u) => u.subscription?.status === "trial").length,
    pastDue: billingUsers.filter((u) => u.subscription?.status === "past_due").length,
    cancelled: billingUsers.filter((u) => u.subscription?.status === "cancelled").length,
    mrr: billingUsers.reduce(
      (sum, u) => (u.subscription?.status === "active" ? sum + u.subscription.monthlyPrice : sum),
      0,
    ),
    currency,
  };

  return {
    plans,
    users: billingUsers,
    coupons: adminCoupons,
    redemptions,
    auditLog,
    pendingPayments: pendingPaymentList,
    totals,
  };
}
