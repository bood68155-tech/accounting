-- ── Manual Binance Pay pending payments ───────────────────────────────────────
-- Users submit a USDT transfer + TxID on /admin/renew; the super admin reviews
-- and approves/rejects. On approval the user's subscription is renewed.
-- Mirrors the `pendingPayments` table in src/lib/db/schema.ts.

create table if not exists public.pending_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  pay_id text not null,
  tx_id text not null unique,
  amount_usd numeric(12,2) not null,
  plan_code text,
  requested_at timestamptz not null default now(),
  status text not null default 'pending',
  reviewed_by text,
  reviewed_at timestamptz,
  rejection_reason text,
  constraint pending_payments_status_check
    check (status in ('pending', 'approved', 'rejected'))
);

create index if not exists pending_payments_user_idx
  on public.pending_payments (user_id);

create index if not exists pending_payments_tx_idx
  on public.pending_payments (tx_id);
