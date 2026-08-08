# AGENTS.md — Store Accountant

Guidance for AI coding agents working in this repository.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript** (strict)
- **Tailwind CSS v4** (CSS-first config in `src/app/globals.css` via `@theme inline`)
- **Supabase** (`@supabase/supabase-js`, `@supabase/ssr`) — auth, Postgres, RLS
- Charts and UI primitives are **hand-rolled** (SVG + Tailwind) — no chart/UI libraries

## Conventions

- Path alias `@/*` → `src/*`.
- Server components fetch data through `src/lib/data/repository.ts`; it uses the
  live Supabase database when `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`
  are set, otherwise it returns the deterministic demo dataset (`src/lib/data/demo.ts`).
- The accounting engine lives in `src/lib/accounting/`:
  - `doubleEntry.ts` — `createSaleEntry`, `createRefundEntry`, `createFeeEntry`, `validateEntry`
  - `profitEngine.ts` — `computeOrderProfit`, `computeStats`, `computeMonthlySeries`
  - `incomeStatement.ts` — P&L builders (from orders and from journal entries)
  - `chartOfAccounts.ts` — account codes 1000–5900
- Provider adapters in `src/lib/providers/*` verify signatures and normalize
  payloads to `NormalizedOrder`; webhook routes in `src/app/api/webhooks/*` call
  `src/lib/webhooks/ingest.ts` (persist → profit → journal entries → event log).
- **Never** import `src/lib/supabase/admin.ts` (service role) into client code.
- Every UI change should be validated with `npm run typecheck` and `npm run build`.

## Data model (Supabase)

`stores.user_id` owns everything. RLS policies on all tables resolve ownership
through the parent store (`exists (select 1 from stores where id = … and user_id = auth.uid())`).
Schema: `supabase/migrations/20260808000000_init.sql`.
