// ─── X: admin billing domain types ────────────────────────────────────────────
// Subscriptions, plan pricing and discount coupons for the admin console.

/** Subscription lifecycle (DB enum: subscription_status). */
export type BillingSubscriptionStatus = "trial" | "active" | "past_due" | "cancelled";

/** Discount mechanics (DB enum: discount_type). */
export type DiscountType = "percent" | "fixed";

/** How long a coupon lasts (DB enum: coupon_duration). */
export type CouponDuration = "once" | "repeating" | "forever";

export interface PendingPayment {
  id: string;
  userId: string;
  payId: string;
  txId: string;
  amountUsd: number;
  planCode: string | null;
  requestedAt: string;
  status: "pending" | "approved" | "rejected";
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
}

/** A plan tier: first month + recurring monthly price. */
export interface AdminPlan {
  id: string;
  code: string;
  name: string;
  firstMonthPrice: number;
  monthlyPrice: number;
  currency: string;
  trialDays: number;
  isDefault: boolean;
}

/** One row of the users table: identity + subscription + usage. */
export interface AdminBillingUser {
  id: string;
  email: string;
  fullName: string | null;
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  storeCount: number;
  // Subscription (null = no subscription record yet)
  subscription: {
    status: BillingSubscriptionStatus;
    planCode: string | null;
    planName: string | null;
    /** Effective monthly price: override if set, else the plan price. */
    monthlyPrice: number;
    /** Effective first-month price (0 = first month free). */
    firstMonthPrice: number;
    currency: string;
    periodStart: string | null;
    periodEnd: string | null;
    trialEndsAt: string | null;
    couponCode: string | null;
    notes: string | null;
  } | null;
}

/** A discount coupon with scope + usage counters. */
export interface AdminCoupon {
  id: string;
  code: string;
  description: string | null;
  discountType: DiscountType;
  discountValue: number;
  /** Formatted, e.g. "20% off" or "$10 off". */
  discountLabel: string;
  /** Null = global (all users). */
  userId: string | null;
  userEmail: string | null;
  startsAt: string | null;
  expiresAt: string | null;
  maxRedemptions: number | null;
  timesUsed: number;
  duration: CouponDuration;
  durationMonths: number | null;
  active: boolean;
  createdAt: string;
}

/** One row of coupon usage history. */
export interface AdminCouponRedemption {
  id: string;
  code: string;
  userEmail: string | null;
  discountAmount: number;
  redeemedAt: string;
}

/** One audit-trail entry. */
export interface AdminAuditEntry {
  id: string;
  actorEmail: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

/** Everything the billing tab renders. */
export interface AdminBillingData {
  plans: AdminPlan[];
  users: AdminBillingUser[];
  coupons: AdminCoupon[];
  redemptions: AdminCouponRedemption[];
  auditLog: AdminAuditEntry[];
  pendingPayments: PendingPayment[];
  totals: {
    activeSubscriptions: number;
    trialSubscriptions: number;
    pastDue: number;
    cancelled: number;
    /** Sum of effective monthly prices over active subscriptions. */
    mrr: number;
    currency: string;
  };
}
