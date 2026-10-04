/**
 * ── Payment terms & credit limit engine ─────────────────────────────────────
 * B2B counterparties are sold on terms, not on receipt: an invoice is due in N
 * days and the customer's total open exposure is capped by a credit limit.
 * Both checks have to agree before an order can be released.
 *
 * Pure module — no database and no ambient clock. Callers pass `as_of` so the
 * aging report and a credit decision always describe the same instant.
 */

import { round2 } from "@/lib/utils";

// ── Calendar helpers (UTC-only; ISO date strings in, ISO date strings out) ───

/** Parse an ISO `YYYY-MM-DD` into a UTC epoch day, ignoring time-of-day. */
function toEpochDay(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new Error(`Invalid ISO date: ${JSON.stringify(iso)} (expected YYYY-MM-DD)`);
  const [, y, mo, d] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ISO date: ${JSON.stringify(iso)}`);
  return Math.floor(ms / 86_400_000);
}

/** Inverse of `toEpochDay` — renders an epoch day back to `YYYY-MM-DD`. */
function fromEpochDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

function dayOfWeek(day: number): number {
  // 0 = Sunday … 6 = Saturday.
  return new Date(day * 86_400_000).getUTCDay();
}

/** Whole days from `from` to `to` (negative when `to` is in the past). */
export function daysBetween(from: string, to: string): number {
  return toEpochDay(to) - toEpochDay(from);
}

export function isWeekend(iso: string): boolean {
  const d = dayOfWeek(toEpochDay(iso));
  return d === 0 || d === 6;
}

// ── Payment terms ───────────────────────────────────────────────────────────

export interface PaymentTerms {
  /** Stable code, e.g. `net_30`. */
  code: string;
  label: string;
  /** Days added to the invoice date. 0 = due on receipt. */
  net_days: number;
}

export const PAYMENT_TERMS: PaymentTerms[] = [
  { code: "due_on_receipt", label: "Due on receipt", net_days: 0 },
  { code: "net_7", label: "Net 7", net_days: 7 },
  { code: "net_15", label: "Net 15", net_days: 15 },
  { code: "net_30", label: "Net 30", net_days: 30 },
  { code: "net_45", label: "Net 45", net_days: 45 },
  { code: "net_60", label: "Net 60", net_days: 60 },
  { code: "net_90", label: "Net 90", net_days: 90 },
];

export const DEFAULT_PAYMENT_TERMS: PaymentTerms = PAYMENT_TERMS[3]; // Net 30

export function getPaymentTerms(code: string): PaymentTerms | undefined {
  return PAYMENT_TERMS.find((t) => t.code === code);
}

/** Like `getPaymentTerms`, but throws — for config paths that must not guess. */
export function parsePaymentTerms(code: string): PaymentTerms {
  const terms = getPaymentTerms(code);
  if (!terms) {
    throw new Error(
      `Unknown payment terms "${code}" — expected one of ${PAYMENT_TERMS.map((t) => t.code).join(", ")}.`,
    );
  }
  return terms;
}

export interface DueDateOptions {
  /**
   * Roll a due date that lands on a weekend or a listed holiday forward to the
   * next business day. Off by default — many contracts specify the raw day
   * count and expect no adjustment.
   */
  roll_to_business_day?: boolean;
  /** ISO dates to treat as non-business days. */
  holidays?: string[];
}

/**
 * Due date = invoice date + net days, optionally rolled off weekends/holidays.
 * Clamped at calendar end-of-month by construction: adding days to an epoch day
 * cannot overflow into the wrong month.
 */
export function computeDueDate(
  invoiceDate: string,
  terms: PaymentTerms | string,
  options: DueDateOptions = {},
): string {
  const resolved = typeof terms === "string" ? parsePaymentTerms(terms) : terms;
  let due = toEpochDay(invoiceDate) + resolved.net_days;

  if (options.roll_to_business_day) {
    const holidays = new Set(options.holidays ?? []);
    // Bounded: a 2-week holiday run cannot spin forever.
    for (let i = 0; i < 14; i += 1) {
      const iso = fromEpochDay(due);
      if (!isWeekend(iso) && !holidays.has(iso)) break;
      due += 1;
    }
  }

  return fromEpochDay(due);
}

// ── Invoices ────────────────────────────────────────────────────────────────

export interface OpenInvoice {
  invoice_number: string;
  customer_id: string;
  customer_name?: string;
  /** ISO date the invoice was issued. */
  issued_at: string;
  /** ISO due date — already resolved through `computeDueDate`. */
  due_at: string;
  /** Invoiced amount. */
  amount: number;
  /** Amount already settled; the open balance is `amount - amount_paid`. */
  amount_paid?: number;
  currency?: string;
}

/** What is still owed on an invoice. */
export function openBalance(invoice: OpenInvoice): number {
  return round2(invoice.amount - (invoice.amount_paid ?? 0));
}

/** Positive once the due date has passed, otherwise 0 (due today is not late). */
export function daysPastDue(invoice: OpenInvoice, asOf: string): number {
  return Math.max(0, daysBetween(invoice.due_at, asOf));
}

export function isOverdue(invoice: OpenInvoice, asOf: string): boolean {
  return daysPastDue(invoice, asOf) > 0;
}

// ── Aging ───────────────────────────────────────────────────────────────────

export type AgingBucket = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";

export const AGING_BUCKETS: AgingBucket[] = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"];

export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  current: "Current",
  d1_30: "1–30 days",
  d31_60: "31–60 days",
  d61_90: "61–90 days",
  d90_plus: "90+ days",
};

export function ageBucket(daysLate: number): AgingBucket {
  if (daysLate <= 0) return "current";
  if (daysLate <= 30) return "d1_30";
  if (daysLate <= 60) return "d31_60";
  if (daysLate <= 90) return "d61_90";
  return "d90_plus";
}

export interface AgingLine {
  bucket: AgingBucket;
  label: string;
  count: number;
  amount: number;
}

export interface AgingReport {
  as_of: string;
  total_count: number;
  total_amount: number;
  overdue_amount: number;
  lines: AgingLine[];
}

/** Standard AR aging across every open invoice, bucketed by days past due. */
export function buildAgingReport(invoices: OpenInvoice[], asOf: string): AgingReport {
  const buckets = new Map<AgingBucket, { count: number; amount: number }>(
    AGING_BUCKETS.map((b) => [b, { count: 0, amount: 0 }]),
  );

  let total_amount = 0;
  let overdue_amount = 0;
  let total_count = 0;

  for (const invoice of invoices) {
    const balance = openBalance(invoice);
    if (balance <= 0) continue; // fully settled — nothing to age
    const late = daysPastDue(invoice, asOf);
    const bucket = ageBucket(late);
    const slot = buckets.get(bucket)!;
    slot.count += 1;
    slot.amount = round2(slot.amount + balance);
    total_amount = round2(total_amount + balance);
    total_count += 1;
    if (late > 0) overdue_amount = round2(overdue_amount + balance);
  }

  return {
    as_of: asOf,
    total_count: total_count,
    total_amount,
    overdue_amount,
    lines: AGING_BUCKETS.map((b) => ({
      bucket: b,
      label: AGING_BUCKET_LABELS[b],
      count: buckets.get(b)!.count,
      amount: buckets.get(b)!.amount,
    })),
  };
}

// ── Credit profiles & policy ────────────────────────────────────────────────

export interface CustomerCreditProfile {
  customer_id: string;
  customer_name: string;
  /** Approved open exposure. `null` means unlimited (e.g. cash customers). */
  credit_limit: number | null;
  /** Default terms code from `PAYMENT_TERMS`. */
  payment_terms_code: string;
  currency: string;
  /** Administrative hold — blocks all orders regardless of limit. */
  credit_hold?: boolean;
  /** Optional payment history; dates of the oldest unpaid invoice. */
  oldest_due_at?: string;
}

export interface CreditPolicy {
  /** Decline when any invoice is past due. Default true. */
  block_on_overdue: boolean;
  /**
   * Past-due days after which the customer is hard-blocked and can no longer be
   * rescued by an override. `null` disables the hard block. Default 30.
   */
  hard_block_after_days: number | null;
  /**
   * Utilization ratio at or above which an otherwise-valid order needs manual
   * approval rather than auto-release. Default 0.9.
   */
  approval_utilization: number;
}

export const DEFAULT_CREDIT_POLICY: CreditPolicy = {
  block_on_overdue: true,
  hard_block_after_days: 30,
  approval_utilization: 0.9,
};

export interface CreditRequest {
  profile: CustomerCreditProfile;
  /** Amount of the order being placed (tax inclusive — it is what they owe). */
  order_amount: number;
  /** Every open invoice for this customer, across all stores in the tenant. */
  open_invoices?: OpenInvoice[];
  /** ISO date the decision is made as of. */
  as_of: string;
  /** Overrides the profile's default terms when the order uses different ones. */
  payment_terms_code?: string;
}

export type CreditDecision = "approved" | "review" | "declined";

export interface CreditCheckResult {
  decision: CreditDecision;
  approved: boolean;
  /** Why — written for a credit controller, not a developer. */
  reason: string;
  /** True when a human may override a decline. */
  overridable: boolean;

  customer_id: string;
  customer_name: string;
  payment_terms_code: string;
  due_date: string;

  order_amount: number;
  outstanding_balance: number;
  /** outstanding + this order — the exposure the limit has to cover. */
  exposure_after_order: number;
  credit_limit: number | null;
  available_credit: number | null;
  /** exposure_after_order ÷ credit_limit, or null when unlimited. */
  utilization: number | null;
  /** How far past the limit the order lands (0 when within). */
  exceeded_by: number;

  overdue_amount: number;
  overdue_invoice_count: number;
  oldest_overdue_days: number;
  aging: AgingReport;
}

/**
 * Decide whether to release an order on credit.
 *
 * The order is the last thing checked, not the first: a customer inside their
 * limit but 45 days overdue is still a bad credit, and a customer over their
 * limit with a clean record may be an approvable exception. Checks run in
 * severity order (hold → hard block → overdue → limit → utilization) so the
 * returned `reason` names the binding constraint.
 */
export function evaluateCreditLimit(
  request: CreditRequest,
  policy: CreditPolicy = DEFAULT_CREDIT_POLICY,
): CreditCheckResult {
  const { profile, order_amount, as_of } = request;
  const invoices = request.open_invoices ?? [];
  const termsCode = request.payment_terms_code ?? profile.payment_terms_code;
  const terms = getPaymentTerms(termsCode);

  const aging = buildAgingReport(invoices, as_of);
  const outstanding_balance = aging.total_amount;
  const exposure_after_order = round2(outstanding_balance + order_amount);

  const credit_limit = profile.credit_limit;
  const available_credit =
    credit_limit === null ? null : round2(credit_limit - outstanding_balance);
  const utilization = credit_limit && credit_limit > 0 ? exposure_after_order / credit_limit : null;
  const exceeded_by = credit_limit === null ? 0 : Math.max(0, round2(exposure_after_order - credit_limit));

  const overdueInvoices = invoices.filter((i) => isOverdue(i, as_of) && openBalance(i) > 0);
  const overdue_amount = aging.overdue_amount;
  const oldest_overdue_days = overdueInvoices.reduce((max, i) => Math.max(max, daysPastDue(i, as_of)), 0);

  const base = {
    customer_id: profile.customer_id,
    customer_name: profile.customer_name,
    payment_terms_code: termsCode,
    // An unknown terms code still needs a due date; fall back to Net 30 rather
    // than throwing mid-check — the misconfiguration is surfaced via the code.
    due_date: computeDueDate(as_of, terms ?? DEFAULT_PAYMENT_TERMS),
    order_amount,
    outstanding_balance,
    exposure_after_order,
    credit_limit,
    available_credit,
    utilization,
    exceeded_by,
    overdue_amount,
    overdue_invoice_count: overdueInvoices.length,
    oldest_overdue_days,
    aging,
  };

  if (!terms) {
    return {
      ...base,
      decision: "review",
      approved: false,
      overridable: true,
      reason: `Payment terms "${termsCode}" are not configured — defaulted to ${DEFAULT_PAYMENT_TERMS.label} for the due date. Verify before releasing.`,
    };
  }

  // 1. Administrative hold — never overridable.
  if (profile.credit_hold) {
    return {
      ...base,
      decision: "declined",
      approved: false,
      overridable: false,
      reason: `${profile.customer_name} is on credit hold — no orders can be released until the hold is lifted.`,
    };
  }

  // 2. Hard block on badly overdue accounts.
  if (policy.hard_block_after_days !== null && oldest_overdue_days >= policy.hard_block_after_days) {
    return {
      ...base,
      decision: "declined",
      approved: false,
      overridable: false,
      reason: `${profile.customer_name} has an invoice ${oldest_overdue_days} days past due (${overdue_amount.toFixed(2)} overdue) — past the ${policy.hard_block_after_days}-day hard block. Collect payment first.`,
    };
  }

  // 3. Any overdue invoice blocks by default.
  if (policy.block_on_overdue && overdueInvoices.length > 0) {
    return {
      ...base,
      decision: "declined",
      approved: false,
      overridable: true,
      reason: `${profile.customer_name} has ${overdueInvoices.length} overdue invoice${overdueInvoices.length === 1 ? "" : "s"} totalling ${overdue_amount.toFixed(2)} (oldest ${oldest_overdue_days} days late).`,
    };
  }

  // 4. Credit limit.
  if (credit_limit !== null && exceeded_by > 0) {
    return {
      ...base,
      decision: "declined",
      approved: false,
      overridable: true,
      reason: `Order would push ${profile.customer_name} ${exceeded_by.toFixed(2)} over their ${credit_limit.toFixed(2)} credit limit (exposure ${exposure_after_order.toFixed(2)}). Raise the limit or collect ${overdue_amount.toFixed(2)} first.`,
    };
  }

  // 5. Utilization warning band — release, but flag for manual approval.
  if (utilization !== null && utilization >= policy.approval_utilization) {
    return {
      ...base,
      decision: "review",
      approved: true,
      overridable: true,
      reason: `${profile.customer_name} would run at ${(utilization * 100).toFixed(0)}% of their ${credit_limit!.toFixed(2)} credit limit after this order — inside the limit but worth a second look.`,
    };
  }

  return {
    ...base,
    decision: "approved",
    approved: true,
    overridable: true,
    reason:
      credit_limit === null
        ? `${profile.customer_name} has no credit limit — released on ${terms.label}, due ${base.due_date}.`
        : `${profile.customer_name} is within their ${credit_limit.toFixed(2)} credit limit (${(utilization! * 100).toFixed(0)}% after this order), due ${base.due_date}.`,
  };
}

// ── Portfolio view ──────────────────────────────────────────────────────────

export interface CreditExposureRow {
  customer_id: string;
  customer_name: string;
  credit_limit: number | null;
  outstanding_balance: number;
  available_credit: number | null;
  utilization: number | null;
  overdue_amount: number;
  oldest_overdue_days: number;
  status: "ok" | "warning" | "blocked";
}

export interface CreditPortfolio {
  as_of: string;
  rows: CreditExposureRow[];
  aging: AgingReport;
  total_outstanding: number;
  total_overdue: number;
  blocked_customers: number;
  warning_customers: number;
}

/**
 * Portfolio-wide exposure across every customer, ordered most-at-risk first.
 * This is the table the daily digest surfaces so the owner knows who to chase
 * before the next invoice goes out.
 */
export function buildCreditPortfolio(
  profiles: CustomerCreditProfile[],
  invoices: OpenInvoice[],
  asOf: string,
  policy: CreditPolicy = DEFAULT_CREDIT_POLICY,
): CreditPortfolio {
  const byCustomer = new Map<string, OpenInvoice[]>();
  for (const invoice of invoices) {
    const list = byCustomer.get(invoice.customer_id) ?? [];
    list.push(invoice);
    byCustomer.set(invoice.customer_id, list);
  }

  const rows = profiles
    .map((profile) => {
      const customerInvoices = byCustomer.get(profile.customer_id) ?? [];
      const result = evaluateCreditLimit(
        { profile, order_amount: 0, open_invoices: customerInvoices, as_of: asOf },
        policy,
      );
      return {
        customer_id: profile.customer_id,
        customer_name: profile.customer_name,
        credit_limit: profile.credit_limit,
        outstanding_balance: result.outstanding_balance,
        available_credit: result.available_credit,
        utilization: result.utilization,
        overdue_amount: result.overdue_amount,
        oldest_overdue_days: result.oldest_overdue_days,
        status:
          profile.credit_hold || result.decision === "declined"
            ? ("blocked" as const)
            : result.decision === "review"
              ? ("warning" as const)
              : ("ok" as const),
      };
    })
    .sort((a, b) => {
      // Risk order: blocked, then warning, then largest utilization.
      const rank = { blocked: 0, warning: 1, ok: 2 };
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      return (b.utilization ?? 0) - (a.utilization ?? 0);
    });

  const aging = buildAgingReport(invoices, asOf);

  return {
    as_of: asOf,
    rows,
    aging,
    total_outstanding: aging.total_amount,
    total_overdue: aging.overdue_amount,
    blocked_customers: rows.filter((r) => r.status === "blocked").length,
    warning_customers: rows.filter((r) => r.status === "warning").length,
  };
}
