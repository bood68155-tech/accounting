import type { AccountType, LedgerAccount, NormalBalance } from "@/types";

/**
 * Default chart of accounts for an e-commerce store.
 * Follows standard double-entry accounting codes:
 *   1xxx Assets · 2xxx Liabilities · 3xxx Equity · 4xxx Revenue · 5xxx Expenses
 */
export const CHART_OF_ACCOUNTS: Array<Omit<LedgerAccount, "store_id">> = [
  {
    code: "1000",
    name: "Cash",
    type: "asset",
    normal_balance: "debit",
    is_system: true,
    description: "Checking / operating cash account where sales proceeds land.",
  },
  {
    code: "1100",
    name: "Accounts Receivable",
    type: "asset",
    normal_balance: "debit",
    is_system: true,
    description: "Money owed to the business by customers.",
  },
  {
    code: "1200",
    name: "Inventory",
    type: "asset",
    normal_balance: "debit",
    is_system: true,
    description: "Merchandise held for sale, valued at item cost (COGS basis).",
  },
  {
    code: "2000",
    name: "Accounts Payable",
    type: "liability",
    normal_balance: "credit",
    is_system: true,
    description: "Money owed to suppliers and vendors.",
  },
  {
    code: "2100",
    name: "Sales Tax Payable",
    type: "liability",
    normal_balance: "credit",
    is_system: true,
    description: "Sales tax collected from customers, owed to tax authorities.",
  },
  {
    code: "3000",
    name: "Owner's Equity",
    type: "equity",
    normal_balance: "credit",
    is_system: true,
    description: "Capital contributed by the owner(s).",
  },
  {
    code: "4000",
    name: "Sales Revenue",
    type: "revenue",
    normal_balance: "credit",
    is_system: true,
    description: "Product sales before discounts and taxes.",
  },
  {
    code: "4100",
    name: "Shipping Revenue",
    type: "revenue",
    normal_balance: "credit",
    is_system: true,
    description: "Shipping fees charged to customers.",
  },
  {
    code: "4200",
    name: "Other Revenue",
    type: "revenue",
    normal_balance: "credit",
    description: "Miscellaneous income (gift cards, tips, interest…).",
  },
  {
    code: "4400",
    name: "Discounts Given",
    type: "revenue",
    normal_balance: "debit",
    is_system: true,
    description: "Contra-revenue: promotional discounts and coupons.",
  },
  {
    code: "4500",
    name: "Refunds Given",
    type: "revenue",
    normal_balance: "debit",
    is_system: true,
    description: "Contra-revenue: money returned to customers.",
  },
  {
    code: "5000",
    name: "Cost of Goods Sold",
    type: "expense",
    normal_balance: "debit",
    is_system: true,
    description: "True item cost of products sold.",
  },
  {
    code: "5100",
    name: "Shipping Expense",
    type: "expense",
    normal_balance: "debit",
    is_system: true,
    description: "Cost the store pays to fulfill and ship orders.",
  },
  {
    code: "5200",
    name: "Payment Processing Fees",
    type: "expense",
    normal_balance: "debit",
    is_system: true,
    description: "Stripe / PayPal / Shopify Payments gateway fees.",
  },
  {
    code: "5300",
    name: "Marketing & Advertising",
    type: "expense",
    normal_balance: "debit",
    description: "Paid ads, influencer, and marketing spend.",
  },
  {
    code: "5400",
    name: "Software & Subscriptions",
    type: "expense",
    normal_balance: "debit",
    description: "SaaS tools and recurring subscriptions.",
  },
  {
    code: "5900",
    name: "Miscellaneous Expenses",
    type: "expense",
    normal_balance: "debit",
    description: "Other operating expenses.",
  },
];

export const ACCOUNT_TYPES: AccountType[] = [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
];

export function getAccount(code: string): (typeof CHART_OF_ACCOUNTS)[number] | undefined {
  return CHART_OF_ACCOUNTS.find((a) => a.code === code);
}

export function accountLabel(account: Pick<LedgerAccount, "code" | "name">): string {
  return `${account.code} · ${account.name}`;
}

/** Balance-direction-aware helpers. */
export const balanceSide = (type: AccountType): NormalBalance =>
  type === "asset" || type === "expense" ? "debit" : "credit";
