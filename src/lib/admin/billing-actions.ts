"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { requireAdminAccess } from "@/lib/admin/auth";
import { isDatabaseConfigured, requireDb, publicSchema } from "@/lib/db";
import type { BillingSubscriptionStatus, CouponDuration, DiscountType } from "@/lib/admin/billing-types";

// ─── Admin billing actions (server-only mutations) ────────────────────────────
// Every mutation is guarded by requireAdminAccess() (email gate) and writes an
// entry to the admin audit log. Rate-limiting / PIN gating happens in the UI
// layer (see app/(app)/admin) and the API routes.

export type ActionResult = { ok: true } | { ok: false; error: string };

const STATUSES: BillingSubscriptionStatus[] = ["trial", "active", "past_due", "cancelled"];
const DURATIONS: CouponDuration[] = ["once", "repeating", "forever"];

async function audit(
  action: string,
  targetType: string,
  targetId: string,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    const session = await auth();
    const db = requireDb();
    await db.insert(publicSchema.adminAuditLog).values({
      actorEmail: session?.user?.email ?? "unknown",
      action,
      targetType,
      targetId,
      detail,
    });
  } catch {
    // Audit logging must never break the primary mutation.
  }
}

/** Guard shared by every action: returns the error message when blocked. */
async function guard(): Promise<string | null> {
  const access = await requireAdminAccess();
  if (!access.granted) return access.message;
  if (!isDatabaseConfigured()) return "Writes require a live database (DATABASE_URL).";
  return null;
}

// ── Subscriptions ─────────────────────────────────────────────────────────────

export interface UpdateSubscriptionInput {
  userId: string;
  status?: BillingSubscriptionStatus;
  /** Per-user monthly override; omit to clear (inherit plan). */
  monthlyPrice?: number | null;
  /** Per-user first-month override; omit to clear (inherit plan). */
  firstMonthPrice?: number | null;
  planId?: string | null;
  notes?: string | null;
}

export async function updateSubscription(input: UpdateSubscriptionInput): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };

  const db = requireDb();
  const { userSubscriptions, subscriptionPlans } = publicSchema;

  const planId =
    input.planId === undefined ? undefined : input.planId === null ? null : input.planId;

  const values: Partial<typeof userSubscriptions.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.status && STATUSES.includes(input.status)) {
    values.status = input.status;
    if (input.status === "cancelled") values.cancelledAt = new Date();
  }
  if (input.monthlyPrice !== undefined) {
    values.monthlyPrice = input.monthlyPrice === null ? null : input.monthlyPrice;
  }
  if (input.firstMonthPrice !== undefined) {
    values.firstMonthPrice = input.firstMonthPrice === null ? null : input.firstMonthPrice;
  }
  if (planId !== undefined) values.planId = planId;
  if (input.notes !== undefined) values.notes = input.notes;

  // Validate plan exists when provided.
  if (typeof planId === "string") {
    const plan = await db
      .select({ id: subscriptionPlans.id })
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId))
      .limit(1);
    if (plan.length === 0) return { ok: false, error: "Unknown plan." };
  }

  const existing = await db
    .select({ id: userSubscriptions.id })
    .from(userSubscriptions)
    .where(eq(userSubscriptions.userId, input.userId))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(userSubscriptions).values({
      userId: input.userId,
      ...values,
    } as typeof userSubscriptions.$inferInsert);
  } else {
    await db
      .update(userSubscriptions)
      .set(values)
      .where(eq(userSubscriptions.userId, input.userId));
  }

  await audit("subscription.update", "user_subscription", input.userId, {
    status: values.status ?? null,
    monthlyPrice: values.monthlyPrice ?? null,
    firstMonthPrice: values.firstMonthPrice ?? null,
    planId: values.planId ?? null,
  });

  revalidatePath("/admin");
  return { ok: true };
}

// ── Coupons ───────────────────────────────────────────────────────────────────
// ── Manual Binance Pay payments ────────────────────────────────────────────────
// Pending payments submitted via /admin/renew are reviewed by the super admin.
// On approval the subscription is renewed/extended and the pending row is
// marked approved so it can never be re-approved.

export interface CreatePendingPaymentInput {
  userId: string;
  payId: string;
  txId: string;
  amountUsd: number;
  planCode: string | null;
}
async function insertPendingPayment(
  userId: string,
  input: { payId: string; txId: string; amountUsd: number; planCode: string | null },
): Promise<ActionResult> {
  if (!input.payId || !input.txId) return { ok: false, error: "Pay ID and TxID are required." };
  if (!Number.isFinite(input.amountUsd) || input.amountUsd <= 0) {
    return { ok: false, error: "Amount must be a positive number." };
  }

  const db = requireDb();
  const { pendingPayments } = publicSchema;

  const existing = await db
    .select({ id: pendingPayments.id })
    .from(pendingPayments)
    .where(and(eq(pendingPayments.userId, userId), eq(pendingPayments.txId, input.txId)))
    .limit(1);
  if (existing.length > 0) return { ok: false, error: "This TxID was already submitted." };

  await db.insert(pendingPayments).values({
    userId,
    payId: input.payId,
    txId: input.txId,
    amountUsd: input.amountUsd,
    planCode: input.planCode ?? null,
    requestedAt: new Date(),
    status: "pending",
  });

  await audit("payment.pending", "pending_payment", input.txId, {
    userId,
    payId: input.payId,
    amountUsd: input.amountUsd,
    planCode: input.planCode,
  });

  revalidatePath("/admin");
  revalidatePath("/renew");
  return { ok: true };
}

/** Admin-only: file a pending payment on behalf of a user. */
export async function createPendingPayment(input: CreatePendingPaymentInput): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  return insertPendingPayment(input.userId, input);
}

/**
 * ── Self-serve renewal request (any signed-in user) ───────────────────────────
 * Lets the account owner file a Binance Pay TxID against their own subscription;
 * the admin still approves it. The user id comes from the session, never the
 * caller, so a user can only submit for themselves.
 */
export async function submitRenewalRequest(input: {
  payId: string;
  txId: string;
  amountUsd: number;
  planCode: string | null;
}): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in to submit a payment." };
  if (!isDatabaseConfigured()) return { ok: false, error: "Writes require a live database (DATABASE_URL)." };
  return insertPendingPayment(userId, input);
}

export interface ApprovePaymentInput {
  paymentId: string;
  monthlyPrice?: number | null;
  planId?: string | null;
  notes?: string | null;
}
export async function approvePayment(input: ApprovePaymentInput): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };

  const db = requireDb();
  const { pendingPayments, userSubscriptions, subscriptionPlans } = publicSchema;

  const payment = await db
    .select()
    .from(pendingPayments)
    .where(eq(pendingPayments.id, input.paymentId))
    .limit(1);
  if (payment.length === 0) return { ok: false, error: "Pending payment not found." };
  if (payment[0].status !== "pending") return { ok: false, error: "Payment is not pending." };

  const p = payment[0];
  const now = new Date();

  // Determine the subscription values to apply on approval.
  const planId =
    input.planId === undefined ? undefined : input.planId === null ? null : input.planId;
  const values: Partial<typeof userSubscriptions.$inferInsert> = {
    updatedAt: now,
    status: "active",
    periodStart: now,
    periodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    cancelledAt: null,
  };
  if (input.monthlyPrice !== undefined) {
    values.monthlyPrice = input.monthlyPrice === null ? null : input.monthlyPrice;
  }
  if (planId !== undefined) values.planId = planId;
  if (input.notes !== undefined) values.notes = input.notes;

  // Validate plan if provided.
  if (typeof planId === "string") {
    const plan = await db
      .select({ id: subscriptionPlans.id })
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId))
      .limit(1);
    if (plan.length === 0) return { ok: false, error: "Unknown plan." };
  }

  // Upsert the user subscription (renew/extend).
  const existing = await db
    .select({ id: userSubscriptions.id })
    .from(userSubscriptions)
    .where(eq(userSubscriptions.userId, p.userId))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(userSubscriptions).values({
      userId: p.userId,
      ...values,
    } as typeof userSubscriptions.$inferInsert);
  } else {
    await db
      .update(userSubscriptions)
      .set(values)
      .where(eq(userSubscriptions.userId, p.userId));
  }

  // Mark the pending payment approved.
  await db
    .update(pendingPayments)
    .set({
      status: "approved",
      reviewedBy: "bood68155@gmail.com",
      reviewedAt: now,
    })
    .where(eq(pendingPayments.id, input.paymentId));

  await audit("payment.approve", "pending_payment", input.paymentId, {
    userId: p.userId,
    payId: p.payId,
    txId: p.txId,
    amountUsd: p.amountUsd,
    planCode: p.planCode,
    monthlyPrice: values.monthlyPrice ?? null,
    planId: values.planId ?? null,
  });

  revalidatePath("/admin");
  return { ok: true };
}

export async function rejectPayment(paymentId: string, reason: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!reason.trim()) return { ok: false, error: "Rejection reason is required." };

  const db = requireDb();
  const { pendingPayments } = publicSchema;

  const payment = await db
    .select()
    .from(pendingPayments)
    .where(eq(pendingPayments.id, paymentId))
    .limit(1);
  if (payment.length === 0) return { ok: false, error: "Pending payment not found." };
  if (payment[0].status !== "pending") return { ok: false, error: "Payment is not pending." };

  await db
    .update(pendingPayments)
    .set({
      status: "rejected",
      reviewedBy: "bood68155@gmail.com",
      reviewedAt: new Date(),
      rejectionReason: reason.trim(),
    })
    .where(eq(pendingPayments.id, paymentId));

  await audit("payment.reject", "pending_payment", paymentId, {
    userId: payment[0].userId,
    payId: payment[0].payId,
    txId: payment[0].txId,
    reason,
  });

  revalidatePath("/admin");
  return { ok: true };
}

// ── Manual subscription extension ──────────────────────────────────────────────
// Extends the current period by `months` (default 1) for a user, without a
// payment record. Used by the admin quick-action "Extend subscription".

export interface ExtendSubscriptionInput {
  userId: string;
  months?: number;
  notes?: string | null;
}
export async function extendSubscription(input: ExtendSubscriptionInput): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };

  const months = Math.max(1, input.months ?? 1);
  const db = requireDb();
  const { userSubscriptions } = publicSchema;

  const sub = await db
    .select()
    .from(userSubscriptions)
    .where(eq(userSubscriptions.userId, input.userId))
    .limit(1);
  if (sub.length === 0) return { ok: false, error: "No subscription found for this user." };

  const currentEnd = sub[0].periodEnd;
  const base = currentEnd instanceof Date ? currentEnd : currentEnd ? new Date(currentEnd) : new Date();
  const newEnd = new Date(base.getTime() + months * 30 * 24 * 60 * 60 * 1000);

  await db
    .update(userSubscriptions)
    .set({
      periodEnd: newEnd,
      periodStart: new Date(),
      status: "active",
      updatedAt: new Date(),
      notes: input.notes !== undefined ? input.notes : sub[0].notes,
    })
    .where(eq(userSubscriptions.userId, input.userId));

  await audit("subscription.extend", "user_subscription", input.userId, {
    months,
    newPeriodEnd: newEnd.toISOString(),
  });

  revalidatePath("/admin");
  return { ok: true };
}

export interface UpsertCouponInput {
  id?: string;
  code: string;
  description?: string | null;
  discountType: DiscountType;
  discountValue: number;
  /** Null/undefined = global; otherwise per-user. */
  userId?: string | null;
  startsAt?: string | null;
  expiresAt?: string | null;
  maxRedemptions?: number | null;
  duration?: CouponDuration;
  durationMonths?: number | null;
  active?: boolean;
}

export async function upsertCoupon(input: UpsertCouponInput): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };

  const code = input.code.trim().toUpperCase();
  if (!code) return { ok: false, error: "Coupon code is required." };
  if (!Number.isFinite(input.discountValue) || input.discountValue < 0) {
    return { ok: false, error: "Discount value must be a non-negative number." };
  }
  if (input.discountType === "percent" && input.discountValue > 100) {
    return { ok: false, error: "Percent discount cannot exceed 100." };
  }

  const duration = input.duration && DURATIONS.includes(input.duration) ? input.duration : "once";
  const db = requireDb();
  const { coupons } = publicSchema;

  const values = {
    code,
    description: input.description ?? null,
    discountType: input.discountType,
    discountValue: input.discountValue,
    userId: input.userId || null,
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    maxRedemptions: input.maxRedemptions ?? null,
    duration,
    durationMonths: duration === "repeating" ? (input.durationMonths ?? 1) : null,
    active: input.active ?? true,
    updatedAt: new Date(),
  };

  try {
    if (input.id) {
      await db.update(coupons).set(values).where(eq(coupons.id, input.id));
      await audit("coupon.update", "coupon", input.id, { ...values });
    } else {
      await db.insert(coupons).values(values);
      await audit("coupon.create", "coupon", code, { ...values });
    }
  } catch {
    return { ok: false, error: `Could not save coupon "${code}" — the code may already exist.` };
  }

  revalidatePath("/admin");
  return { ok: true };
}

export async function toggleCoupon(id: string, active: boolean): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };

  const db = requireDb();
  const { coupons } = publicSchema;
  await db.update(coupons).set({ active, updatedAt: new Date() }).where(eq(coupons.id, id));
  await audit("coupon.toggle", "coupon", id, { active });
  revalidatePath("/admin");
  return { ok: true };
}

export async function deleteCoupon(id: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };

  const db = requireDb();
  const { coupons } = publicSchema;
  await db.delete(coupons).where(eq(coupons.id, id));
  await audit("coupon.delete", "coupon", id, {});
  revalidatePath("/admin");
  return { ok: true };
}

/** Record a manual redemption (usage history row + counter bump). */
export async function recordCouponRedemption(
  couponId: string,
  userId: string,
  discountAmount: number,
): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };

  if (!Number.isFinite(discountAmount) || discountAmount < 0) {
    return { ok: false, error: "Discount amount must be a non-negative number." };
  }

  const db = requireDb();
  const { coupons, couponRedemptions } = publicSchema;

  const rows = await db
    .select({ code: coupons.code, active: coupons.active, userId: coupons.userId })
    .from(coupons)
    .where(and(eq(coupons.id, couponId)))
    .limit(1);
  const coupon = rows[0];
  if (!coupon) return { ok: false, error: "Unknown coupon." };
  if (!coupon.active) return { ok: false, error: "Coupon is inactive." };
  if (coupon.userId && coupon.userId !== userId) {
    return { ok: false, error: "Coupon is bound to a different user." };
  }

  await db.batch([
    db.insert(couponRedemptions).values({ couponId, userId, code: coupon.code, discountAmount }),
    db
      .update(coupons)
      .set({ timesUsed: sql`${coupons.timesUsed} + 1`, updatedAt: new Date() })
      .where(eq(coupons.id, couponId)),
  ] as never);

  await audit("coupon.redeem", "coupon", coupon.code, { userId, discountAmount });
  revalidatePath("/admin");
  return { ok: true };
}

// ── Plans ─────────────────────────────────────────────────────────────────────

export interface UpsertPlanInput {
  id?: string;
  code: string;
  name: string;
  firstMonthPrice: number;
  monthlyPrice: number;
  trialDays?: number;
  isDefault?: boolean;
}

export async function upsertPlan(input: UpsertPlanInput): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };

  const code = input.code.trim().toLowerCase();
  if (!code || !input.name.trim()) return { ok: false, error: "Plan code and name are required." };
  if (!Number.isFinite(input.monthlyPrice) || input.monthlyPrice < 0) {
    return { ok: false, error: "Monthly price must be a non-negative number." };
  }

  const db = requireDb();
  const { subscriptionPlans } = publicSchema;

  // Only one default plan at a time.
  if (input.isDefault) {
    await db
      .update(subscriptionPlans)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(subscriptionPlans.isDefault, true));
  }

  const values = {
    code,
    name: input.name.trim(),
    firstMonthPrice: input.firstMonthPrice,
    monthlyPrice: input.monthlyPrice,
    trialDays: input.trialDays ?? 14,
    isDefault: input.isDefault ?? false,
    updatedAt: new Date(),
  };

  try {
    if (input.id) {
      await db.update(subscriptionPlans).set(values).where(eq(subscriptionPlans.id, input.id));
      await audit("plan.update", "plan", input.id, { ...values });
    } else {
      await db.insert(subscriptionPlans).values(values);
      await audit("plan.create", "plan", code, { ...values });
    }
  } catch {
    return { ok: false, error: `Could not save plan "${code}" — the code may already exist.` };
  }

  revalidatePath("/admin");
  return { ok: true };
}
