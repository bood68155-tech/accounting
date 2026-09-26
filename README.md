# 📒 X

**Automated AI Accounting & Profitability Engine for E-commerce Stores.**

X connects to online stores via webhooks/APIs, computes **true net profit**
(item cost, shipping and payment-gateway fees), automates **double-entry bookkeeping**
(general ledger & COGS), and produces **financial statements** (income statement). It is
**multi-tenant**: every workspace gets its own Postgres schema (schema-per-tenant isolation)
on **Neon Postgres**, with tenant scoping enforced in the data layer.

![stack](https://img.shields.io/badge/Next.js%2016-TypeScript-000000?logo=next.js)
![stack](https://img.shields.io/badge/Tailwind%20CSS%20v4-dark?logo=tailwindcss)
![stack](https://img.shields.io/badge/Neon%20Postgres-00E599?logo=neon)
![stack](https://img.shields.io/badge/Auth-NextAuth%20v5-000000?logo=nextdotorg)

---

## ✨ Features

| Area | What it does |
| --- | --- |
| **Integrations** | HMAC/Stripe-signature/certificate-verified webhooks for **Salla**, Shopify, WooCommerce, Stripe & PayPal (`/api/webhooks/*`) |
| **True net profit** | Per-order profit = net sales − COGS (item cost × qty) − gateway fees − shipping cost − refunds (`src/lib/accounting/profitEngine.ts`) |
| **Double-entry books** | Every sale posts balanced journal entries — Dr Cash, Cr Sales, Dr COGS, Cr Inventory — with a trial balance that always matches (`src/lib/accounting/doubleEntry.ts`) |
| **Statements** | Income statement (P&L) **and balance sheet** (with AR/AP and retained earnings), generated from the ledger (`src/lib/accounting/`) |
| **AR / AP** | Orders that arrive unpaid are booked as credit sales (Dr Accounts Receivable) and settled automatically when a payment event lands (`createCreditSaleEntry` / `createPaymentCollectionEntry`) |
| **Catalog sync** | Pull products + unit costs from the Shopify Admin API and Salla Admin API (`/products`, `POST /api/products/sync`); catalog costs auto-fill COGS on every incoming order |
| **AI engine** | Transaction categorization & ledger mapping, statistical anomaly detection, cash-flow forecasting, natural-language insights, and an embedded AI Financial Assistant chat (`src/lib/ai/`) |
| **Deep store research** | Real-time business analytics (gross/net margins, AOV, fee & COGS share, top SKUs, ROAS-ready ad-spend placeholder), inventory warnings, and a continuous store-health **audit** (missing COGS, below-cost sales, anomalous transactions, refund spikes, catalog coverage, ledger balance) with a 0–100 health score (`src/lib/analytics/storeResearch.ts`, `GET /api/analytics/overview`) |
| **Auth: Google + Email OTP** | "Continue with Google" (NextAuth v5 OAuth — first login auto-provisions the user + tenant schema) and a 6-digit email OTP that must be verified before any signup or password sign-in completes (`src/lib/auth/otp.ts`) |
| **Multi-tenant isolation** | Schema-per-tenant: every workspace owns a dedicated Postgres schema; tenant queries are always schema-qualified in the data layer |
| **Admin console** | Platform-wide `/admin` console aggregating every tenant schema |

## 🧱 Multi-tenant architecture (schema-per-tenant)

```
public schema  (shared metadata only)
├── users            bcrypt credentials (NextAuth), disabled flag
├── profiles         id, full_name, avatar_url
├── tenants          id, owner_id, name, slug, schema_name
├── tenant_users     tenant_id, user_id, role
└── store_registry   store_id → tenant schema

tenant_<uuid-hex> schema  (one per workspace, created on signup)
├── stores, products, orders, order_items
├── ledger_accounts, journal_entries, journal_lines
└── integration_events

src/lib/ai/                    # AI engine (deterministic core, optional LLM)
├── categorizer.ts              # tx categorization → ledger mapping, anomalies, forecast
├── insights.ts                 # grounded natural-language insights
└── agent.ts                    # embedded financial agent (tools + optional OpenAI)
```

- **Provisioning** happens in the signup route: `public.provision_user_tenant()`
  creates the tenant, membership row and the tenant schema
  (`public.create_tenant_schema()` runs the DDL) — atomically with the user row.
- **Routing** is cryptographically bound to the session: the tenant id and schema
  are embedded in the NextAuth JWT at login and validated (shape-checked) before
  every use — never read from client-controlled cookies.
- **Webhooks & admin** resolve the owning schema through `public.store_registry`,
  so writes land in the right tenant schema.
- Every tenant query goes through `lib/db.ts` → `tenantTable(schema, "table")`,
  which validates the identifier (`tenant_<32-hex>` only) before quoting it.

Schema: `db/migrations/20260921000000_neon_init.sql` (single idempotent file).

## 🚀 Quick start

```bash
npm install
cp .env.example .env.local   # add DATABASE_URL + AUTH_SECRET
npm run db:migrate           # applies db/migrations to your Neon database
npm run dev                  # → http://localhost:3000
```

To explore with sample data, seed a demo tenant + store:

```bash
npm run db:seed   # creates a demo workspace for SEED_USER_EMAIL (default: the admin email)
```

The seed generates **8 months of deterministic history with planted anomalies**
(refund-rate spike, an order-value outlier, a below-cost sale, orders missing
COGS, and pending credit-sale orders) so the AI insights, anomaly detection,
cash-flow forecast and balance sheet have meaningful data on day one.

Sign up with that email first (password ≥ 6 chars), then re-run the seed.

## 🗄️ Neon setup

1. Create a project at [console.neon.tech](https://console.neon.tech).
2. Copy the **pooled** connection string (Dashboard → Connection Details) into
   `DATABASE_URL` in `.env.local`. The pooled endpoint is important for
   serverless/webhook bursts.
3. Run the migrations:

   ```bash
   npm run db:migrate
   ```

4. Generate an auth secret: `openssl rand -base64 32` → `AUTH_SECRET`.
5. Set provider secrets: `SHOPIFY_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET`,
   `PAYPAL_WEBHOOK_ID` (webhooks reject unverified payloads when these are unset).
6. *(Optional)* **Google sign-in**: create an OAuth client at
   [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services
   → Credentials, with redirect URI `<APP_URL>/api/auth/callback/google`, and set
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. First login auto-provisions the
   user + tenant schema.
7. *(Optional)* **Email OTP delivery**: set `GMAIL_USER` + `GMAIL_APP_PASSWORD`
   (Gmail app password) or `SMTP_URL` + `SMTP_FROM`. Without a transport, codes
   print to the server console (and are shown in the UI in non-production).

## 🔗 Connecting a store (webhooks)

Each provider has a verified endpoint:

| Provider | Endpoint | Verification |
| --- | --- | --- |
| Salla | `POST /api/webhooks/salla` | HMAC-SHA256 (`X-Salla-Signature`) |
| Shopify | `POST /api/webhooks/shopify` | HMAC-SHA256 (`X-Shopify-Hmac-SHA256`) |
| WooCommerce | `POST /api/webhooks/woocommerce` | HMAC of consumer secret |
| Stripe | `POST /api/webhooks/stripe` | Timestamped HMAC (`Stripe-Signature`) |
| PayPal | `POST /api/webhooks/paypal` | RSA over transmission certificate |

Pass `?store_id=<uuid>` (or `X-Store-Id` header) — it is **required** and routes the
event to the store's tenant schema. Each accepted order:

1. is verified & normalized to a canonical order (with item costs),
2. gets a true net profit computed,
3. posts sale/refund journal entries,
4. records an `integration_events` row.

Try it with the simulator (app running):

```bash
SHOPIFY_WEBHOOK_SECRET=... STORE_ID=<store-uuid> npm run webhook:simulate
```

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
│   ├── login | signup/             # Google OAuth + credentials + email OTP
│   ├── admin/                      # platform-wide console
│   ├── api/auth/                   # NextAuth handlers + signup/signin JSON endpoints
│   └── api/webhooks/{shopify,stripe,paypal,woocommerce}/
├── components/
│   ├── charts/                     # hand-rolled SVG charts (no chart lib)
│   ├── ui/                         # button, card, badge, table, …
│   ├── profit-calculator.tsx       # interactive true-profit demo
│   └── store-connect.tsx           # multi-step connect wizard
├── lib/
│   ├── auth.ts                     # NextAuth v5 config (credentials + JWT tenant context)
│   ├── db.ts                       # Neon serverless driver + identifier validation
│   ├── accounting/                 # chart of accounts, double entry, profit engine, P&L
│   ├── providers/                  # signature verification + payload normalization
│   ├── tenants.ts                  # tenant context from the verified session
│   ├── webhooks/ingest.ts          # persist → profit → journal → event log (tenant-scoped)
│   └── data/repository.ts          # page reads, scoped to the tenant schema
└── types/                          # shared domain types
db/migrations/                      # SQL schema (Neon, plain Postgres)
scripts/seed-demo-data.mjs          # demo tenant + store + orders (npm run db:seed)
```

## 🧰 Tooling

```bash
npm run typecheck   # TypeScript strict check
npm run lint        # ESLint
npm run build       # production build
npm run db:migrate  # apply db/migrations to DATABASE_URL
npm run db:seed     # seed a demo tenant + store (requires SEED_USER_EMAIL account)
npm run webhooks:replay   # replay failed integration events through the real pipeline
```

### 🧪 Testing the Shopify webhook

```bash
npm run test:shopify      # in-process: normalize -> true net profit -> double-entry entries
npm run dev               # start the app, then in a second shell:
SHOPIFY_WEBHOOK_SECRET=... STORE_ID=<store-uuid> npm run webhook:simulate
```

`scripts/verify-shopify-pipeline.ts` exercises the real pipeline (HMAC checks, payload
normalization, profit math, balanced sale/refund journal entries) without a server or
database. `scripts/simulate-shopify-webhook.mjs` sends a realistic `orders/create`
webhook to a running instance and asserts the parsed order + true net profit + HMAC
rejection; set `BASE_URL` to target a different host (e.g. your Vercel URL).

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

## 🛡️ Admin console

`/admin` is a platform-wide console that aggregates data across **every tenant schema**:

| Tab | What it shows |
| --- | --- |
| **Overview** | Users, stores, orders & gateway fee KPIs, webhook health |
| **Users** | Every account: profile (from `profiles`), stores, orders, revenue, disable/enable |
| **Stores** | All stores with owner, platform, status, revenue & fees — update status |
| **Webhooks** | `integration_events` across all stores, filtered by provider/status |
| **Gateway fees** | Fee breakdown per provider: volume, effective rate, monthly series |

### Access control

Only emails listed in `ADMIN_EMAILS` (comma-separated in `.env.local`, plus the
hardcoded platform owner) can open `/admin`; every `/api/admin/*` route enforces the
same check and returns `401`/`403` otherwise. A PIN gate (`ADMIN_PIN`, httpOnly
HMAC-signed cookie) adds a second factor.

### API routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/admin/overview` | GET | Platform-wide KPIs + recent events |
| `/api/admin/users` | GET | All users with profiles & aggregates |
| `/api/admin/users/[id]` | PATCH | Update profile name or disable/enable |
| `/api/admin/stores` | GET | All stores with owner & usage |
| `/api/admin/stores/[id]` | PATCH | Change store status (resolved via `store_registry`) |
| `/api/admin/events` | GET | Webhook events (+ `?provider=&status=`) |
| `/api/admin/fees` | GET | Gateway fee breakdown |
