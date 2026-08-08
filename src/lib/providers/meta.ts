export interface PlatformMeta {
  id: string;
  name: string;
  mark: string;
  color: string;
  blurb: string;
  events: string;
}

export const PLATFORM_META: PlatformMeta[] = [
  {
    id: "shopify",
    name: "Shopify",
    mark: "S",
    color: "#95bf47",
    blurb: "Orders, refunds & Shopify Payments fee capture via HMAC-verified webhooks.",
    events: "orders/create · orders/refund",
  },
  {
    id: "woocommerce",
    name: "WooCommerce",
    mark: "W",
    color: "#7f54b3",
    blurb: "WordPress store orders and refunds normalized from REST webhooks.",
    events: "order.completed · order.refunded",
  },
  {
    id: "stripe",
    name: "Stripe",
    mark: "ƒ",
    color: "#635bff",
    blurb: "Payment gateway fees & payouts captured from verified charge events.",
    events: "charge.succeeded · charge.refunded",
  },
  {
    id: "paypal",
    name: "PayPal",
    mark: "P",
    color: "#ffc439",
    blurb: "Checkout orders and transaction fees verified with PayPal's certificate chain.",
    events: "CHECKOUT.ORDER.APPROVED · PAYMENT.SALE",
  },
];
