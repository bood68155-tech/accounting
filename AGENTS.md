# AGENTS.md — X

Guidance for AI coding agents working in this repository.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript** (strict)
- **Tailwind CSS v4** (CSS-first config in `src/app/globals.css` via `@theme inline`)
- **Supabase** (`@supabase/supabase-js`, `@supabase/ssr`) — auth, Postgres, RLS
- Charts and UI primitives are **hand-rolled** (SVG + Tailwind) — no chart/UI libraries

## Conventions

- Path alias `@/*` → `src/*`.
- Server components fetch data through `src/lib/data/repository.ts`, which reads from
  the signed-in user's **tenant schema** (resolved by middleware via cookies — see
  `src/lib/tenants.ts`). There is **no demo mode / demo fallback**; the app always
  talks to Supabase.
- The accounting engine lives in `src/lib/accounting/`:
  - `doubleEntry.ts` — `createSaleEntry`, `createCreditSaleEntry` (AR), `createPaymentCollectionEntry`, `createRefundEntry`, `createFeeEntry`, `validateEntry`
  - `profitEngine.ts` — `computeOrderProfit`, `computeStats`, `computeMonthlySeries`
  - `incomeStatement.ts` — P&L builders (from orders and from journal entries)
  - `balanceSheet.ts` — `buildBalanceSheet` (GL-derived, retained earnings close)
  - `cashFlow.ts` — `buildCashFlowStatement` (direct method from Cash-account lines; operating/investing/financing)
  - `ratios.ts` — `computeFinancialRatios` (liquidity/profitability/efficiency/leverage + 0–100 health score, cash-conversion cycle)
  - `trialBalance.ts` — `buildTrialBalance` + `trialBalanceToCsv` (Σ debits = Σ credits control report)
  - `chartOfAccounts.ts` — account codes 1000–5900
  - `taxEngine.ts` — sales tax / VAT and **Account 2100**: `taxFromExclusive` /
    `taxFromInclusive` (the inclusive split is exact to the cent), `computeOrderTax`
    (re-derives an order's tax against the store's configured rate),
    `classifyTaxMovement` (collected / reversed / paid, by what the 2100 leg is
    offset against), `buildTaxPeriodReport`, `buildVatReturn`
  - `creditTerms.ts` — `PAYMENT_TERMS` + `computeDueDate` (with optional
    weekend/holiday roll), `buildAgingReport` (0/1–30/31–60/61–90/90+),
    `evaluateCreditLimit` (hold → hard block → overdue → limit → utilization, so
    `reason` always names the binding constraint), `buildCreditPortfolio`
- The AI engine lives in `src/lib/ai/`:
  - `categorizer.ts` — `categorizeTransaction` (rule cascade → account code + confidence), `detectAnomalies` (z-scores, margin floors, refund spikes), `forecastCashFlow` (deterministic trend + momentum)
  - `insights.ts` — `generateInsights` (grounded NL insights; numbers always reconcile with the ledger)
  - `agent.ts` — `askFinancialAgent`: tool-using agent (phidata-style); deterministic router by default, optional OpenAI phrasing when `OPENAI_API_KEY` is set — the LLM only rephrases deterministic tool output, it never computes numbers. Tools include profitability, balance, forecast, anomalies, ledger, categorization, analytics, audit, ratios and cashflow.
- Provider adapters in `src/lib/providers/*` verify signatures and normalize
  payloads to `NormalizedOrder`; webhook routes in `src/app/api/webhooks/*` call
  `src/lib/webhooks/ingest.ts` (resolve tenant schema → enrich item costs from
  the catalog → persist → profit → journal entries → event log). Pending orders
  post credit-sale entries (Dr AR); payment events settle the receivable.
- Salla webhooks verify `X-Salla-Signature` (HMAC-SHA256 hex of the raw body
  against `SALLA_WEBHOOK_SECRET`), per docs.salla.dev.
- **Never** import `src/lib/supabase/admin.ts` (service role) into client code.
- Every UI change should be validated with `npm run typecheck` and `npm run build`.

## Multi-tenant model (schema-per-tenant)

- `public` schema holds **only** shared metadata: `tenants`, `tenant_users`,
  `store_registry`, `profiles` and the shared enums.
- Every tenant owns a dedicated Postgres schema `tenant_<uuid-hex>` created by
  `public.create_tenant_schema()` (security-definer DDL, service-role only). It
  contains `stores`, `products`, `orders`, `order_items`, `ledger_accounts`,
  `journal_entries`, `journal_lines`, `integration_events` — all with RLS keyed to
  membership in `public.tenant_users`.
- New auth users are auto-provisioned: the `handle_new_user` trigger creates the
  tenant, membership and schema.
- **Client selection:** pass the schema name to `createClient(schema)` /
  `createAdminClient(schema)` (`db.schema`). The middleware stores `tenant-id` /
  `tenant-schema` cookies after login; server code reads them via `getTenantSchema()`.
- **Webhooks & admin** look up the owning schema in `public.store_registry`
  (store_id → schema) using the service role.
- Schema: `supabase/migrations/20260808000000_init.sql` +
  `supabase/migrations/20260815000000_multi_tenant.sql`.

## Data flow rules

- **Never** query tenant tables (stores/orders/journal_*) from the `public` schema.
- **Never** call `create_tenant_schema` from the browser — it is revoked for
  anon/authenticated and runs only via the service role (trigger or seed script).
- The webhook `store_id` parameter is required and must be a real store in the
  tenant's schema — the registry maps it to the right schema.

## Daily digest notifications (WhatsApp / Telegram)

- `src/lib/notifications/` — `types.ts` (settings + `DigestSettings`,
  `digestIdempotencyKey`), `channels.ts` (Telegram Bot API + WhatsApp Cloud API
  adapters, injectable `fetch`, HTML vs `*bold*` rendering), `digest.ts`
  (`buildDailyDigest` + per-channel renderers), `delivery.ts` (retry, per-target
  isolation, idempotency), `runner.ts` (timezone-aware period + `isDueForSend`).
- Digest numbers are **derived from the journal through the accounting engines** —
  never recomputed — so the message always ties to the dashboard and trial balance.
- Credentials come from `TELEGRAM_BOT_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` +
  `WHATSAPP_ACCESS_TOKEN`. A channel with no credentials is reported as
  **skipped**, never as a failure.
- `POST /api/notifications/daily-digest` — cron entry point (`vercel.json` runs it
  hourly; `isDueForSend` gates each store to its own local `send_hour`). Requires
  `Authorization: Bearer $CRON_SECRET`. Supports `?store=`, `?dry_run=1`, `?force=1`.
- A digest covers the **previous local day**, and its idempotency key is
  `store:date:channel:destination`, backed by a UNIQUE constraint on
  `digest_deliveries` — a retried or overlapping cron run cannot double-send.
  Transient failures are **not** logged, so the next run retries them.
- Per-tenant tables `digest_settings` and `digest_deliveries` live in every tenant
  schema (`db/migrations/20261004000000_daily_digest.sql`), provisioned for new
  tenants via `create_tenant_schema_guarded()`. Access is via `tenantDb(schema)`.

## Admin utilities

- `src/lib/admin/integrity.ts` — `fetchPlatformIntegrity()` reconciles every
  tenant schema (Σ debits = Σ credits per entry), surfaced at
  `GET /api/admin/integrity` and the admin **Integrity** tab.
