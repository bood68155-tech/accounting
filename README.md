# 📒 Store Accountant

**Automated AI Accounting & Profitability Engine for E-commerce Stores.**

Store Accountant connects to online stores via webhooks/APIs, computes **true net profit**
(item cost, shipping and payment-gateway fees), automates **double-entry bookkeeping**
(general ledger & COGS), and produces **financial statements** (income statement) — all
scoped per user with Supabase Row Level Security.

![stack](https://img.shields.io/badge/Next.js%2016-TypeScript-000000?logo=next.js)
![stack](https://img.shields.io/badge/Tailwind%20CSS%20v4-dark?logo=tailwindcss)
![stack](https://img.shields.io/badge/Supabase-RLS-3FCF8E?logo=supabase)

---

## ✨ Features

| Area | What it does |
| --- | --- |
| **Integrations** | HMAC/Stripe-signature/certificate-verified webhooks for Shopify, WooCommerce, Stripe & PayPal (`/api/webhooks/*`) |
| **True net profit** | Per-order profit = net sales − COGS (item cost × qty) − gateway fees − shipping cost − refunds (`src/lib/accounting/profitEngine.ts`) |
| **Double-entry books** | Every sale posts balanced journal entries — Dr Cash, Cr Sales, Dr COGS, Cr Inventory — with a trial balance that always matches (`src/lib/accounting/doubleEntry.ts`) |
| **Statements** | Income statement (P&L), chart of accounts and journal, generated from the ledger (`src/lib/accounting/incomeStatement.ts`) |
| **Security** | Supabase RLS on every table; users only ever see their own stores, orders and books |
| **Demo mode** | Runs fully on deterministic sample data until Supabase credentials are added — explore everything with `npm run dev` |

## 🚀 Quick start

```bash
npm install
cp .env.example .env.local   # add your Supabase credentials
npm run dev                  # → http://localhost:3000
```

Without credentials the app runs in **demo mode** with sample data for
"Aurora & Oak" — dashboard, orders, ledger, income statement and webhook
endpoints all work, so you can evaluate the product immediately.

## 🗄️ Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Copy the API URL + anon key from **Project Settings → API** into `.env.local`.
3. Run the migration (tables, triggers, functions & RLS):

   ```bash
   supabase link --project-ref <your-ref>
   supabase db push
   # or paste supabase/migrations/20260808000000_init.sql into the SQL editor
   ```

4. Optional: add `SUPABASE_SERVICE_ROLE_KEY` (server-only) so webhook routes can write orders & journal entries.
5. Set provider secrets: `SHOPIFY_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET`, `PAYPAL_WEBHOOK_ID`.

## 🔗 Connecting a store (webhooks)

Each provider has a verified endpoint:

| Provider | Endpoint | Verification |
| --- | --- | --- |
| Shopify | `POST /api/webhooks/shopify` | HMAC-SHA256 (`X-Shopify-Hmac-SHA256`) |
| WooCommerce | `POST /api/webhooks/woocommerce` | HMAC of consumer secret |
| Stripe | `POST /api/webhooks/stripe` | Timestamped HMAC (`Stripe-Signature`) |
| PayPal | `POST /api/webhooks/paypal` | RSA over transmission certificate |

Pass `?store_id=<uuid>` (or `X-Store-Id` header) to route events to a store;
it defaults to the demo store in demo mode. Each accepted order:

1. is verified & normalized to a canonical order (with item costs),
2. gets a true net profit computed,
3. posts sale/refund journal entries,
4. records an `integration_events` row.

Try it in demo mode:

```bash
curl -X POST http://localhost:3000/api/webhooks/shopify \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Hmac-SHA256: any" \
  -d '{"id": 9001, "name": "#9001", "email": "a@b.co", "subtotal_price": "48.00",
       "total_tax": "3.48", "total_shipping": "6.95", "total_price": "58.43",
       "financial_status": "paid", "line_items": [
         {"title": "Amber + Cedar Candle (8oz)", "sku": "AUR-101", "price": "24.00",
          "quantity": 2, "cost": "4.60"}]}'
```

> Demo mode accepts the payload and returns the computed profit + journal entries
> without persisting. In live mode the same request writes to Supabase.

## 📁 Project structure

```
src/
├── app/
│   ├── page.tsx                    # landing page
│   ├── (app)/                      # authenticated shell (sidebar + topbar)
│   │   ├── dashboard/              # KPIs, charts, profit calculator
│   │   ├── stores/                 # store cards, connect wizard, detail
│   │   ├── orders/                 # normalized orders with true profit
│   │   ├── ledger/                 # journal entries + chart of accounts
│   │   └── reports/income-statement/
│   ├── login | signup/             # Supabase auth
│   └── api/webhooks/{shopify,stripe,paypal,woocommerce}/
├── components/
│   ├── charts/                     # hand-rolled SVG charts (no chart lib)
│   ├── ui/                         # button, card, badge, table, …
│   ├── profit-calculator.tsx       # interactive true-profit demo
│   └── store-connect.tsx           # multi-step connect wizard
├── lib/
│   ├── accounting/                 # chart of accounts, double entry, profit engine, P&L
│   ├── providers/                  # signature verification + payload normalization
│   ├── supabase/                   # client / server / admin / middleware
│   ├── webhooks/ingest.ts          # persist → profit → journal → event log
│   └── data/                       # demo dataset + repository (demo ⇄ live)
└── types/                          # shared domain types
supabase/migrations/                # SQL schema with RLS
```

## 🧰 Tooling

```bash
npm run typecheck   # TypeScript strict check
npm run lint        # ESLint
npm run build       # production build
```

## 🧮 The accounting model

Every order generates a balanced journal entry:

```
Dr  Cash                      total − gateway fee
Dr  Payment Processing Fees   gateway fee
Dr  Discounts Given           discounts
Cr  Sales Revenue             subtotal
Cr  Shipping Revenue          shipping charged
Cr  Sales Tax Payable         tax collected
Dr  Cost of Goods Sold        Σ item cost × qty
Cr  Inventory                 Σ item cost × qty
```

The income statement is derived from those accounts, so revenue − COGS − fees −
shipping always equals the true net profit shown on the dashboard.
