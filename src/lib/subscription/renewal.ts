import { eq } from "drizzle-orm";
import { isDatabaseConfigured, requireDb, publicSchema } from "@/lib/db";
import type { PendingPaymentRow } from "@/lib/db/schema";

// ─── Subscription renewal core (shared) ───────────────────────────────────────
// The actual "mark paid → activate subscription" logic lives here, outside the
// admin-guarded server actions, so both the manual admin approval and the fully
// automated crypto webhook approve payments through the exact same code path.

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface ApprovePendingPaymentInput {
  paymentId: string;
  /** Who approved it — admin email or a gateway marker (e.g. "crypto-gateway"). */
  reviewedBy: string;
  notes?: string | null;
  planId?: string | null;
  monthlyPrice?: number | null;
}

export type ApprovePendingPaymentResult =
  | { ok: true; alreadyApproved: boolean; userId: string | null }
  | { ok: false; error: string };

/**
 * Approve one pending payment and activate/renew the owner's subscription.
 * Idempotent: a payment already `approved` is a no-op success, so gateway
 * redeliveries never double-apply.
 */
export async function approvePendingPayment(
  input: ApprovePendingPaymentInput,
): Promise<ApprovePendingPaymentResult> {
  if (!isDatabaseConfigured()) {
    return { ok: false, error: "Writes require a live database (DATABASE_URL)." };
  }

  const db = requireDb();
  const { pendingPayments, userSubscriptions } = publicSchema;

  const rows = await db
    .select()
    .from(pendingPayments)
    .where(eq(pendingPayments.id, input.paymentId))
    .limit(1);
  const payment = rows[0];
  if (!payment) return { ok: false, error: "Pending payment not found." };
  if (payment.status === "approved") {
    return { ok: true, alreadyApproved: true, userId: payment.userId };
  }
  if (payment.status !== "pending") {
    return { ok: false, error: `Payment is ${payment.status}, not pending.` };
  }

  const now = new Date();
  const values: Partial<typeof userSubscriptions.$inferInsert> = {
    updatedAt: now,
    status: "active",
    periodStart: now,
    periodEnd: new Date(now.getTime() + THIRTY_DAYS_MS),
    cancelledAt: null,
  };
  if (input.monthlyPrice !== undefined) {
    values.monthlyPrice = input.monthlyPrice === null ? null : input.monthlyPrice;
  }
  if (input.planId !== undefined) {
    values.planId = input.planId === null ? null : input.planId;
  }
  if (input.notes !== undefined) values.notes = input.notes;

  const existing = await db
    .select({ id: userSubscriptions.id })
    .from(userSubscriptions)
    .where(eq(userSubscriptions.userId, payment.userId))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(userSubscriptions).values({
      userId: payment.userId,
      ...values,
    } as typeof userSubscriptions.$inferInsert);
  } else {
    await db
      .update(userSubscriptions)
      .set(values)
      .where(eq(userSubscriptions.userId, payment.userId));
  }

  await db
    .update(pendingPayments)
    .set({ status: "approved", reviewedBy: input.reviewedBy, reviewedAt: now })
    .where(eq(pendingPayments.id, input.paymentId));

  return { ok: true, alreadyApproved: false, userId: payment.userId };
}

/** Look up a pending payment by the external transaction/order id. */
export async function findPendingPaymentByTxId(txId: string): Promise<PendingPaymentRow | null> {
  if (!isDatabaseConfigured() || !txId) return null;
  const { pendingPayments } = publicSchema;
  const rows = await requireDb()
    .select()
    .from(pendingPayments)
    .where(eq(pendingPayments.txId, txId))
    .limit(1);
  return rows[0] ?? null;
}

/** Record a gateway-created payment as pending so the webhook can match it. */
export async function recordCryptoPendingPayment(input: {
  userId: string;
  orderId: string;
  amountUsd: number;
  planCode: string | null;
  payId?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) {
    return { ok: false, error: "Writes require a live database (DATABASE_URL)." };
  }
  const { pendingPayments } = publicSchema;
  const existing = await findPendingPaymentByTxId(input.orderId);
  if (existing) return { ok: true };

  await requireDb().insert(pendingPayments).values({
    userId: input.userId,
    payId: input.payId ?? "crypto-gateway",
    txId: input.orderId,
    amountUsd: input.amountUsd,
    planCode: input.planCode ?? null,
    requestedAt: new Date(),
    status: "pending",
  });
  return { ok: true };
}
