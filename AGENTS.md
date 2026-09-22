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
  - `chartOfAccounts.ts` — account codes 1000–5900
- The AI engine lives in `src/lib/ai/`:
  - `categorizer.ts` — `categorizeTransaction` (rule cascade → account code + confidence), `detectAnomalies` (z-scores, margin floors, refund spikes), `forecastCashFlow` (deterministic trend + momentum)
  - `insights.ts` — `generateInsights` (grounded NL insights; numbers always reconcile with the ledger)
  - `agent.ts` — `askFinancialAgent`: tool-using agent (phidata-style); deterministic router by default, optional OpenAI phrasing when `OPENAI_API_KEY` is set — the LLM only rephrases deterministic tool output, it never computes numbers
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
