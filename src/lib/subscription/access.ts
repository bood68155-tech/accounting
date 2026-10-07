import { eq } from "drizzle-orm";
import { isAdminEmail } from "@/lib/admin/auth";
import { isDatabaseConfigured, requireDb, publicSchema } from "@/lib/db";

// ─── Subscription access ──────────────────────────────────────────────────────
// Decides whether a signed-in account may use the app. The platform admin is
// always allowed; accounts with no subscription record fail open (legacy data);
// a trial that has run out (or a cancelled/past-due subscription) is blocked
// until the admin approves a renewal.

export type SubscriptionAccessReason =
  | "admin"
  | "active"
  | "trial"
  | "no_subscription"
  | "expired"
  | "cancelled"
  | "past_due";

export interface SubscriptionAccess {
  allowed: boolean;
  reason: SubscriptionAccessReason;
  status: string | null;
  periodEnd: string | null;
  trialEndsAt: string | null;
  message: string;
}

export async function resolveSubscriptionAccess(
  userId: string,
  email?: string | null,
): Promise<SubscriptionAccess> {
  const empty = { status: null, periodEnd: null, trialEndsAt: null };

  if (isAdminEmail(email)) {
    return { allowed: true, reason: "admin", ...empty, message: "" };
  }
  if (!isDatabaseConfigured()) {
    // Fail open — never lock users out because the database is misconfigured.
    return { allowed: true, reason: "no_subscription", ...empty, message: "" };
  }

  const { userSubscriptions } = publicSchema;
  const rows = await requireDb()
    .select({
      status: userSubscriptions.status,
      periodEnd: userSubscriptions.periodEnd,
      trialEndsAt: userSubscriptions.trialEndsAt,
    })
    .from(userSubscriptions)
    .where(eq(userSubscriptions.userId, userId))
    .limit(1);

  const sub = rows[0];
  if (!sub) {
    // No subscription record yet (legacy accounts) — fail open.
    return { allowed: true, reason: "no_subscription", ...empty, message: "" };
  }

  const now = Date.now();
  const periodEnd = sub.periodEnd ? new Date(sub.periodEnd) : null;
  const trialEndsAt = sub.trialEndsAt ? new Date(sub.trialEndsAt) : null;
  const info = {
    status: sub.status as string,
    periodEnd: periodEnd ? periodEnd.toISOString() : null,
    trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null,
  };

  if (sub.status === "active" && (!periodEnd || periodEnd.getTime() > now)) {
    return { allowed: true, reason: "active", ...info, message: "" };
  }
  if (sub.status === "trial" && (!trialEndsAt || trialEndsAt.getTime() > now)) {
    return { allowed: true, reason: "trial", ...info, message: "" };
  }

  const reason: SubscriptionAccessReason =
    sub.status === "cancelled" ? "cancelled" : sub.status === "past_due" ? "past_due" : "expired";
  return {
    allowed: false,
    reason,
    ...info,
    message: "Your free trial has ended. Renew your subscription to keep using the platform.",
  };
}
