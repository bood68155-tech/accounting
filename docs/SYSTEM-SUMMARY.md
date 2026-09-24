# X — Automated AI Accounting & Profitability Engine

**System summary & architecture reference** — updated September 24, 2026.

X is a multi-tenant, double-entry accounting engine for e-commerce stores. Orders arrive as platform
webhooks (Shopify, Salla, Stripe, PayPal, WooCommerce), are normalized, enriched with true item
costs from the product catalog, posted as balanced journal entries into an **immutable ledger**,
and power dashboards, P&L, balance sheet and AI insights. Corrections are **reversing entries** —
history is never rewritten.

- **Stack**: Next.js 16 (App Router) + React 19 + TypeScript (strict), Tailwind v4,
  Drizzle ORM over Neon Postgres (serverless HTTP driver), NextAuth v5.
- **Live**: `accounting-c1cg9x6qz-abood-s-projects4.vercel.app` (project `accounting`, Git-deploy from `main`).
- **Repo**: `github.com/bood68155-tech/accounting` (branch `main`).

---

## 1. Multi-tenancy & data model

Schema-per-tenant isolation. Every tenant owns a Postgres schema `tenant_<uuid-hex>` containing:

| Table | Purpose |
|---|---|
| `stores` | Connected platforms; `config` jsonb holds tokens, `merchant` (Salla id), etc. |
| `products` | Cost catalog (SKU → cost/selling price) — feeds COGS enrichment |
| `orders` / `order_items` | Normalized orders with totals, refunds, status, `entry_numbers` |
| `ledger_accounts` | Chart of accounts 1000–5900, seeded per store |
| `journal_entries` / `journal_lines` | The immutable GL; `reversal_of`/`reversal_reason` audit links |
| `integration_events` | Full webhook payloads + processing status (audit/replay) |

The `public` schema holds only shared metadata (`tenants`, `tenant_users`, `store_registry`,
`users`). Webhooks resolve the owning schema via `store_registry`; user sessions carry the schema
in the NextAuth JWT (regex-validated on every read).

---

## 2. The ledger: guarantees

**Append-only, enforced by the database** (migration `20260924000000_immutable_journal_ledger.sql`,
inspired by ERPNext v13's immutable GL and medici's append-only books):

- `journal_lines`: UPDATE/DELETE rejected (row-level triggers); TRUNCATE blocked.
- `journal_entries`: posted rows frozen; drafts editable; deletion always blocked.
- Corrections = **reversing entries**: a NEW entry swaps every line (Dr↔Cr), linked via
  `reversal_of` + mandatory `reversal_reason`. Original + reversal net to zero in every report.
- Reversing a reversal is rejected. Reversal is idempotent (second call is a no-op).
- Maintenance bypass (ops scripts only): `set local app.ledger_guard = 'off'` inside a
  transaction (see `scripts/ledger-guard.mjs`); auto-restores on commit.

**Entry validation** (`doubleEntry.ts`): Σ debits === Σ credits (±0.005), no negative amounts,
no two-sided lines, no empty entries. `validateEntry` throws before anything is persisted.

**Chart of accounts (order posting):**

```
Dr  Cash (1000)                    total − gateway fee
Dr  Payment Processing Fees (5200) gateway fee
Dr  Discounts Given (4400)         discounts
Cr  Sales Revenue (4000)           subtotal
Cr  Shipping Revenue (4100)        shipping charged
Cr  Sales Tax Payable (2100)       tax collected
Dr  Cost of Goods Sold (5000)      Σ unit_cost × qty
Cr  Inventory (1200)               Σ unit_cost × qty
```

Pending (unpaid) orders book as **credit sales** (Dr 1100 Accounts Receivable); the payment
event later settles the receivable (Dr Cash + fees, Cr AR) — revenue is recognized once, at
sale time.

---

## 3. Ingestion pipeline (all providers)

```
Webhook POST → signature verify (timing-safe, raw body) → payload guard
  → normalize to NormalizedOrder (provider adapter)
  → resolve tenant schema (store_registry / domain / Salla merchant)
  → enrich zero-cost lines from catalog (true COGS)
  → persist order + items (idempotent by (store_id, external_id))
  → post journal entries (immutably) → integration_events log
```

Lifecycle handling in `processOrderWebhook`:

| Event on a synced order | Behaviour |
|---|---|
| duplicate redelivery | idempotent skip |
| paid after pending | settle receivable (no P&L double-count) |
| refund with amounts | append refund entry (Dr Refunds 4500, Cr Cash; COGS reversed pro-rata); **idempotent by amount delta** — gateway retries never double-post |
| cancelled / order.deleted | **auto-reverse every entry referencing the order** (sale + AR settlement + refunds) so all accounts net to zero |

**Fee-only payment events** (Stripe/PayPal) check the journal by payment id before posting —
no duplicate fees on webhook retries.

---

## 4. Platform integrations

### Shopify
- Webhooks `orders/create|paid|updated|cancelled|refund`; HMAC-SHA256 **base64** via
  `X-Shopify-Hmac-SHA256`; payload guard for malformed orders; store resolution by
  `?store_id` or `X-Shopify-Shop-Domain`.
- Manual sync (`/orders` → "Sync Shopify Orders", `scripts/sync-store.ts`): Admin REST pull
  (shpat_ token; prefers `stores.config.accessToken`, falls back to `SHOPIFY_ADMIN_TOKEN`),
  429 Retry-After handling, Link-header pagination.
- **Auth handling**: `ShopifyAuthError` (401 dead token / 403 missing `read_orders`).
  Pre-flight scope validation (`oauth/access_scopes.json`; 404-tolerant for admin-created
  custom apps). The UI shows a **ReconnectStorePrompt** (missing scopes, step-by-step fix,
  retry) instead of a raw error. Token validation CLI: `npm run stores:validate-tokens`.

### Salla (docs.salla.dev v2)
- Webhook envelope `{ event, merchant, data: {…order} }` unwrapped by `extractSallaWebhook`
  (legacy top-level supported).
- Events: `order.created`, `order.updated`, `order.refunded`, `order.status.updated`,
  `order.cancelled`, `order.deleted` — verified via `X-Salla-Signature`
  (HMAC-SHA256 **hex**, timing-safe).
- **Merchant-based store resolution**: `stores.config.merchant` (from the connect wizard or
  config) maps the webhook to the tenant without URL params.
- Status mapping by **slug** (`under_review`→pending, `completed/delivered/paid`→paid,
  `canceled`→cancelled, `restored`→refunded); nested tax `{percent, amount:{amount}}`;
  `discounts[]` array; `refunds[]` → refund flow; Arabic/localized names + store-timezone
  dates normalized.
- Catalog sync via Salla Admin API v2 (`products.read`, `SALLA_ACCESS_TOKEN`).

### Stripe / PayPal / WooCommerce
Payment fee capture & receivable settlement (Stripe/PayPal); WooCommerce order webhooks
(consumer-key auth). Same pipeline, same guarantees.

---

## 5. Reversal API (order corrections)

| Layer | Where |
|---|---|
| Pure builder `buildReversalEntry()` | `src/lib/accounting/doubleEntry.ts` |
| Engine: `reverseEntry`, `reverseEntriesForOrder`, persistence | `src/lib/accounting/ledger.ts` |
| Server action + **Reverse** UI on `/ledger` (reason dialog, audit badge) | `src/app/(app)/ledger/actions.ts`, `src/components/reversal-button.tsx` |
| Auto-reversal on cancelled orders | `src/lib/webhooks/ingest.ts` |

Rules: only posted entries; reason mandatory (audit trail); idempotent; chain guard (no
reversing reversals); both entries stay in the ledger and net to zero — trial balance, GL,
P&L and balance sheet all reconcile automatically.

---

## 6. AI layer

`categorizer` (rule cascade → account code + confidence), `detectAnomalies` (z-scores, margin
floors, refund spikes), `forecastCashFlow` (deterministic trend+momentum), `generateInsights`
(grounded in ledger numbers), `askFinancialAgent` (tool-using agent; optional OpenAI only
rephrases deterministic tool output — it never computes numbers).

---

## 7. Verification & operations

| Command | What it does |
|---|---|
| `npm run test:shopify` | 70 checks: HMAC, normalization, profit, entries, guards, reversal builder |
| `npm run test:salla` | 29 checks: signature, v2 envelope, slugs, nested tax, discounts, refunds |
| `npm run webhook:simulate` | Live E2E vs dev server (Shopify: rich/minimal/tampered/malformed) |
| `npm run webhook:simulate-salla` | Live E2E (created → paid → refunded → cancelled) |
| `npm run stores:validate-tokens` | Live token liveness + scope check per connected store |
| `npm run db:migrate` / `db:push` | Apply `db/migrations/*.sql` (tracked in `public._migrations`) |
| `npm run db:purge-demo` | Purge mock/demo transactional data (guard-bypassed, dry-run default) |
| `npm run db:seed` | Demo tenant + deterministic anomaly-rich dataset (re-seeds via bypass) |
| `npm run lint` / `typecheck` / `build` | ESLint, `tsc --noEmit`, production build |

**Migrations**: `20260921000000_neon_init.sql` (schema-per-tenant DDL),
`20260922000000_product_columns_rename.sql`, `20260922000001_platform_salla.sql`,
`20260924000000_immutable_journal_ledger.sql`, `20260924000001_reversal_columns.sql`.

### Live E2E evidence (Neon, September 24, 2026)

Salla lifecycle on the real dev server + DB — 8/8 simulator checks, then direct ledger audit:

```
JE-0001 Credit sale      Dr AR 218.90 / Cr Sales 186.00 + Shipping 15.00 + Tax 27.90, Dr Discounts 10.00
JE-0002 Payment settled  Dr Cash 218.90 / Cr AR 218.90
JE-0003 Refund           Dr Refunds Given 218.90 / Cr Cash 218.90
JE-0004–06 Reversals     exact Dr↔Cr swaps of JE-1..3
NET across all entries: 1,333.40 − 1,333.40 = 0.00
Order row: sub 186 / ship 15 / disc 10 / tax 27.90 / total 218.90 / refund 218.90 ✓
```

### Known operational notes
- Neon direct-TCP (5432) occasionally times out from the local network; the app's neon-http
  driver (443) is unaffected. Retry once on `ETIMEDOUT` in ops scripts.
- Salla/Shopify retry webhooks on non-200; all flows are idempotent (redelivery-safe).
- Webhook URLs must NOT use SSO-protected Vercel preview URLs — point them at the production
  domain (or disable Vercel Authentication: Project → Settings → Deployment Protection → Off).
- The demo store "Aurora & Oak" can be disconnected once no longer needed; its token is dead (401).
