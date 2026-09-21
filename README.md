# 📒 X

**Automated AI Accounting & Profitability Engine for E-commerce Stores.**

X connects to online stores via webhooks/APIs, computes **true net profit**
(item cost, shipping and payment-gateway fees), automates **double-entry bookkeeping**
(general ledger & COGS), and produces **financial statements** (income statement). It is
**multi-tenant**: every workspace gets its own Postgres schema (schema-per-tenant isolation)
with Row Level Security, so tenants can never see each other's data.

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
| **Multi-tenant isolation** | Schema-per-tenant: every workspace owns a dedicated Postgres schema with RLS; the shared `public` schema holds only tenant metadata |
| **Admin console** | Platform-wide `/admin` console (service-role) aggregating every tenant schema |

## 🧱 Multi-tenant architecture (schema-per-tenant)

```
public schema  (shared metadata only)
├── tenants          id, owner_id, name, slug, schema_name
├── tenant_users     tenant_id, user_id, role          ← RLS: users see their own rows
└── store_registry   store_id → tenant schema           ← service-role only

tenant_<uuid-hex> schema  (one per workspace, created on signup)
├── stores, products, orders, order_items
├── ledger_accounts, journal_entries, journal_lines
└── integration_events
    RLS: membership in public.tenant_users for this tenant
```

- **Provisioning** is automatic: `public.handle_new_user()` (trigger on `auth.users`)
  creates the tenant, membership row and calls `public.create_tenant_schema()`
  (security-definer DDL owned by postgres, executable by the service role only).
- **Routing** happens in middleware: after login it resolves the user's tenant and
  stores `tenant-id` / `tenant-schema` cookies. Every page, server action and webhook
  scopes its queries to that schema (`createClient(schema)` → `db.schema`).
- **Webhooks & admin** resolve the owning schema through `public.store_registry` using
  the service role, so writes land in the right tenant schema.
- The migration also **backfills tenants** for users who signed up before it ran.

Schema: `supabase/migrations/20260808000000_init.sql` (enums, profiles, helpers) and
`supabase/migrations/20260815000000_multi_tenant.sql` (tenants + schema provisioning).

## 🚀 Quick start

```bash
npm install
cp .env.example .env.local   # add your Supabase credentials
npm run dev                  # → http://localhost:3000
```

The app requires a live Supabase project (no in-app demo mode). To explore with sample
data, seed a demo tenant + store:

```bash
supabase link --project-ref <your-ref>
supabase db push              # applies the migrations
npm run db:seed               # creates a demo tenant + "Aurora & Oak" store with ~6 months of orders
```

`npm run db:seed` provisions a demo workspace for `SEED_USER_EMAIL` (defaults to the
platform admin email) — sign up with that account first, then seed.

## 🗄️ Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Copy the API URL + anon key from **Project Settings → API** into `.env.local`.
3. Run the migrations (tables, triggers, functions & RLS):

   ```bash
   supabase link --project-ref <your-ref>
   supabase db push
   # or paste the migration files into the SQL editor, in order
   ```

4. Add `SUPABASE_SERVICE_ROLE_KEY` (server-only) so webhook routes can write orders & journal entries.
5. Set provider secrets: `SHOPIFY_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET`, `PAYPAL_WEBHOOK_ID` (webhooks reject unverified payloads when these are unset).

## 🔗 Connecting a store (webhooks)

Each provider has a verified endpoint:

| Provider | Endpoint | Verification |
| --- | --- | --- |
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
│   ├── login | signup/             # Supabase auth
│   ├── admin/                      # platform-wide console (service-role)
│   └── api/webhooks/{shopify,stripe,paypal,woocommerce}/
├── components/
│   ├── charts/                     # hand-rolled SVG charts (no chart lib)
│   ├── ui/                         # button, card, badge, table, …
│   ├── profit-calculator.tsx       # interactive true-profit demo
│   └── store-connect.tsx           # multi-step connect wizard
├── lib/
│   ├── accounting/                 # chart of accounts, double entry, profit engine, P&L
│   ├── providers/                  # signature verification + payload normalization
│   ├── supabase/                   # client / server / admin / middleware (schema-aware)
│   ├── tenants.ts                  # tenant context helpers (cookies → schema)
│   ├── webhooks/ingest.ts          # persist → profit → journal → event log (tenant-scoped)
│   └── data/repository.ts          # page reads, scoped to the tenant schema
└── types/                          # shared domain types
supabase/migrations/                # SQL schema: shared metadata + schema-per-tenant provisioning
scripts/seed-demo-data.mjs          # demo tenant + store + orders (npm run db:seed)
```

## 🧰 Tooling

```bash
npm run typecheck   # TypeScript strict check
npm run lint        # ESLint
npm run build       # production build
npm run db:seed     # seed a demo tenant + store (requires service role + SEED_USER_EMAIL)
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
rejection; set `BASE_URL` to target a different host.

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

`/admin` is a platform-wide console (service-role, bypasses RLS) that aggregates data
across **every tenant schema**:

| Tab | What it shows |
| --- | --- |
| **Overview** | Users, stores, orders & gateway fee KPIs, webhook health |
| **Users** | Every account: profile (from `profiles`), stores, orders, revenue, ban/unban |
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
| `/api/admin/users/[id]` | PATCH | Update profile name or ban/unban |
| `/api/admin/stores` | GET | All stores with owner & usage |
| `/api/admin/stores/[id]` | PATCH | Change store status (resolved via `store_registry`) |
| `/api/admin/events` | GET | Webhook events (+ `?provider=&status=`) |
| `/api/admin/fees` | GET | Gateway fee breakdown |

> Live data requires `SUPABASE_SERVICE_ROLE_KEY`.
