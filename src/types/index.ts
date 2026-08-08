// ─── Store Accountant: shared domain types ────────────────────────────────────

export type Platform = "shopify" | "woocommerce" | "stripe" | "paypal" | "custom";

export type StoreStatus = "connected" | "syncing" | "disconnected";

export type OrderStatus =
  | "paid"
  | "pending"
  | "refunded"
  | "partially_refunded"
  | "cancelled";

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export type NormalBalance = "debit" | "credit";

export type EntrySource = "order" | "refund" | "fee" | "adjustment" | "manual";

export type EntryStatus = "draft" | "posted";

/** A connected e-commerce store. */
export interface Store {
  id: string;
  user_id: string;
  name: string;
  platform: Platform;
  domain: string | null;
  currency: string;
  status: StoreStatus;
  /** Provider-specific configuration (webhook secret, API keys, cost basis…). */
  config: Record<string, unknown>;
  created_at: string;
}

/** A sellable product with its true item cost. */
export interface Product {
  id?: string;
  store_id: string;
  external_id: string | null;
  sku: string;
  name: string;
  unit_cost: number;
  unit_price: number;
  created_at?: string;
}

/** One line of an order, carrying selling price AND true item cost. */
export interface OrderItem {
  id?: string;
  product_id?: string | null;
  sku: string;
  name: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  line_subtotal: number;
  line_cost: number;
}

/** A normalized order coming from any provider webhook/API. */
export interface Order {
  id?: string;
  store_id: string;
  external_id: string;
  order_number: string;
  customer_name: string;
  currency: string;
  /** Subtotal before shipping/discounts/tax. */
  subtotal: number;
  shipping_amount: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  payment_gateway: string;
  /** Fee charged by the payment gateway. */
  payment_fee: number;
  /** Cost the store paid to fulfill & ship. */
  shipping_cost: number;
  refund_amount: number;
  status: OrderStatus;
  ordered_at: string;
  items: OrderItem[];
}

/** True net profit math for a single order or aggregate. */
export interface ProfitBreakdown {
  gross_sales: number; // subtotal + shipping
  discounts: number;
  refunds: number;
  net_sales: number; // gross - discounts - refunds
  cogs: number; // Σ unit_cost × qty (refund-adjusted)
  gross_profit: number;
  gross_margin: number; // 0..1
  payment_fees: number;
  shipping_cost: number;
  other_fees: number;
  net_profit: number;
  net_margin: number; // 0..1
}

export interface LedgerAccount {
  id?: string;
  store_id: string;
  code: string;
  name: string;
  type: AccountType;
  normal_balance: NormalBalance;
  is_system?: boolean;
  description?: string;
}

export interface JournalLine {
  account_code: string;
  account_name: string;
  account_type: AccountType;
  description: string;
  debit: number;
  credit: number;
}

/** A double-entry journal entry (Σ debits === Σ credits). */
export interface JournalEntry {
  id?: string;
  store_id: string;
  entry_number: number;
  entry_date: string; // ISO date
  description: string;
  reference: string;
  source: EntrySource;
  status: EntryStatus;
  lines: JournalLine[];
  created_at?: string;
}

export interface IncomeStatement {
  period: { from: string; to: string };
  revenue: {
    sales: number;
    shipping: number;
    discounts: number;
    refunds: number;
    net_revenue: number;
  };
  cogs: number;
  gross_profit: number;
  gross_margin: number;
  operating_expenses: {
    payment_fees: number;
    shipping_cost: number;
    marketing: number;
    software: number;
    other: number;
    total: number;
  };
  net_profit: number;
  net_margin: number;
}

export interface WebhookEvent {
  id?: string;
  store_id: string;
  provider: string;
  event_type: string;
  payload: Record<string, unknown>;
  status: "processed" | "failed";
  error?: string | null;
  processed_at: string;
}

/** Aggregated KPIs for the dashboard. */
export interface StoreStats {
  store_id: string;
  period_revenue: number;
  period_net_profit: number;
  period_orders: number;
  period_cogs: number;
  period_payment_fees: number;
  period_shipping_cost: number;
  net_margin: number;
  aov: number; // average order value
  total_orders: number;
  total_revenue: number;
  total_net_profit: number;
}

export interface MonthPoint {
  label: string; // "Jan"
  key: string; // "2026-01"
  revenue: number;
  net_profit: number;
  cogs: number;
  fees: number;
}
