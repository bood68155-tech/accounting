-- ─────────────────────────────────────────────────────────────────────────────
-- Store Accountant — initial schema
-- Automated AI Accounting & Profitability Engine for E-commerce Stores
--
-- Everything is scoped to the authenticated user via Row Level Security:
--   stores.user_id = auth.uid()
--   child tables resolve ownership through their store.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ── Enums ────────────────────────────────────────────────────────────────────

create type public.platform as enum ('shopify', 'woocommerce', 'stripe', 'paypal', 'custom');
create type public.store_status as enum ('connected', 'syncing', 'disconnected');
create type public.order_status as enum ('paid', 'pending', 'refunded', 'partially_refunded', 'cancelled');
create type public.account_type as enum ('asset', 'liability', 'equity', 'revenue', 'expense');
create type public.normal_balance as enum ('debit', 'credit');
create type public.entry_source as enum ('order', 'refund', 'fee', 'adjustment', 'manual');
create type public.entry_status as enum ('draft', 'posted');
create type public.event_status as enum ('processed', 'failed');

-- ── helpers ──────────────────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Create a profile row for every new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ── Tables ───────────────────────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  platform public.platform not null,
  domain text,
  currency text not null default 'USD',
  status public.store_status not null default 'connected',
  config jsonb not null default '{}'::jsonb, -- webhook secrets, API keys, cost basis
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, domain)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  external_id text,
  sku text not null,
  name text not null,
  unit_cost numeric(12, 2) not null default 0,
  unit_price numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, sku)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  external_id text not null,
  order_number text not null,
  customer_name text,
  currency text not null default 'USD',
  subtotal numeric(12, 2) not null default 0,
  shipping_amount numeric(12, 2) not null default 0,
  discount_amount numeric(12, 2) not null default 0,
  tax_amount numeric(12, 2) not null default 0,
  total_amount numeric(12, 2) not null default 0,
  payment_gateway text not null default 'unknown',
  payment_fee numeric(12, 2) not null default 0,
  shipping_cost numeric(12, 2) not null default 0,
  refund_amount numeric(12, 2) not null default 0,
  status public.order_status not null default 'pending',
  ordered_at timestamptz not null default now(),
  raw jsonb,
  entry_numbers integer[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (store_id, external_id)
);
create index orders_store_ordered_idx on public.orders (store_id, ordered_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  sku text not null,
  name text not null,
  quantity integer not null default 1,
  unit_price numeric(12, 2) not null default 0,
  unit_cost numeric(12, 2) not null default 0, -- true item cost (COGS basis)
  line_subtotal numeric(12, 2) not null default 0,
  line_cost numeric(12, 2) not null default 0,
  created_at timestamptz not null default now()
);

create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  code text not null,
  name text not null,
  type public.account_type not null,
  normal_balance public.normal_balance not null,
  is_system boolean not null default false,
  description text,
  created_at timestamptz not null default now(),
  unique (store_id, code)
);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  entry_number integer not null,
  entry_date date not null,
  description text not null,
  reference text,
  source public.entry_source not null default 'manual',
  status public.entry_status not null default 'posted',
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  posted_at timestamptz not null default now(),
  unique (store_id, entry_number)
);
create index journal_entries_store_date_idx on public.journal_entries (store_id, entry_date);

create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.journal_entries (id) on delete cascade,
  account_code text not null,
  account_name text not null,
  account_type public.account_type not null,
  description text,
  debit numeric(14, 2) not null default 0,
  credit numeric(14, 2) not null default 0,
  check (debit >= 0 and credit >= 0),
  check (not (debit = 0 and credit = 0))
);
create index journal_lines_entry_idx on public.journal_lines (entry_id);

create table public.integration_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  provider text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status public.event_status not null default 'processed',
  error text,
  processed_at timestamptz not null default now()
);
create index integration_events_store_idx on public.integration_events (store_id, processed_at desc);

-- ── triggers ─────────────────────────────────────────────────────────────────

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger set_stores_updated_at before update on public.stores
  for each row execute function public.set_updated_at();
create trigger set_products_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger set_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ── Functions ────────────────────────────────────────────────────────────────

-- Seed the standard chart of accounts for a store.
create or replace function public.seed_chart_of_accounts(p_store_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.ledger_accounts (store_id, code, name, type, normal_balance, is_system, description)
  values
    (p_store_id, '1000', 'Cash',                       'asset',    'debit',  true, 'Operating cash account'),
    (p_store_id, '1100', 'Accounts Receivable',        'asset',    'debit',  true, 'Money owed by customers'),
    (p_store_id, '1200', 'Inventory',                  'asset',    'debit',  true, 'Merchandise at item cost'),
    (p_store_id, '2000', 'Accounts Payable',           'liability','credit', true, 'Money owed to suppliers'),
    (p_store_id, '2100', 'Sales Tax Payable',          'liability','credit', true, 'Sales tax collected'),
    (p_store_id, '3000', 'Owner''s Equity',            'equity',   'credit', true, 'Owner capital'),
    (p_store_id, '4000', 'Sales Revenue',              'revenue',  'credit', true, 'Product sales before discounts'),
    (p_store_id, '4100', 'Shipping Revenue',           'revenue',  'credit', true, 'Shipping charged to customers'),
    (p_store_id, '4200', 'Other Revenue',              'revenue',  'credit', false, 'Miscellaneous income'),
    (p_store_id, '4400', 'Discounts Given',            'revenue',  'debit',  true, 'Contra-revenue: coupons'),
    (p_store_id, '4500', 'Refunds Given',              'revenue',  'debit',  true, 'Contra-revenue: refunds'),
    (p_store_id, '5000', 'Cost of Goods Sold',         'expense',  'debit',  true, 'True item cost of sales'),
    (p_store_id, '5100', 'Shipping Expense',           'expense',  'debit',  true, 'Cost the store pays to ship'),
    (p_store_id, '5200', 'Payment Processing Fees',    'expense',  'debit',  true, 'Gateway fees'),
    (p_store_id, '5300', 'Marketing & Advertising',    'expense',  'debit',  false, 'Paid ads and marketing'),
    (p_store_id, '5400', 'Software & Subscriptions',   'expense',  'debit',  false, 'SaaS subscriptions'),
    (p_store_id, '5900', 'Miscellaneous Expenses',     'expense',  'debit',  false, 'Other operating expenses')
  on conflict (store_id, code) do nothing;
end;
$$;

-- True net profit for an order, computed inside the database.
-- net sales − COGS − gateway fees − shipping cost (refund-adjusted)
create or replace function public.true_net_profit(p_order_id uuid)
returns numeric
language sql
stable
as $$
  select round(
    (
      (o.subtotal + o.shipping_amount - o.discount_amount - o.refund_amount)
      - (
          coalesce((select sum(oi.line_cost) from public.order_items oi where oi.order_id = o.id), 0)
          * (1 - case when o.total_amount > 0 then least(1, o.refund_amount / o.total_amount) else 0 end)
        )
      - o.payment_fee
      - o.shipping_cost
    )::numeric, 2)
  from public.orders o
  where o.id = p_order_id;
$$;

-- ── Row Level Security ───────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.ledger_accounts enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
alter table public.integration_events enable row level security;

-- profiles: users manage their own profile.
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

-- stores: users manage only their own stores.
create policy "stores_select_own" on public.stores
  for select using (auth.uid() = user_id);
create policy "stores_insert_own" on public.stores
  for insert with check (auth.uid() = user_id);
create policy "stores_update_own" on public.stores
  for update using (auth.uid() = user_id);
create policy "stores_delete_own" on public.stores
  for delete using (auth.uid() = user_id);

-- products: ownership via the parent store.
create policy "products_select_store" on public.products
  for select using (
    exists (select 1 from public.stores s where s.id = products.store_id and s.user_id = auth.uid())
  );
create policy "products_insert_store" on public.products
  for insert with check (
    exists (select 1 from public.stores s where s.id = products.store_id and s.user_id = auth.uid())
  );
create policy "products_update_store" on public.products
  for update using (
    exists (select 1 from public.stores s where s.id = products.store_id and s.user_id = auth.uid())
  );
create policy "products_delete_store" on public.products
  for delete using (
    exists (select 1 from public.stores s where s.id = products.store_id and s.user_id = auth.uid())
  );

-- orders + order_items: ownership via the parent store.
create policy "orders_select_store" on public.orders
  for select using (
    exists (select 1 from public.stores s where s.id = orders.store_id and s.user_id = auth.uid())
  );
create policy "orders_insert_store" on public.orders
  for insert with check (
    exists (select 1 from public.stores s where s.id = orders.store_id and s.user_id = auth.uid())
  );
create policy "orders_update_store" on public.orders
  for update using (
    exists (select 1 from public.stores s where s.id = orders.store_id and s.user_id = auth.uid())
  );

create policy "order_items_select_store" on public.order_items
  for select using (
    exists (
      select 1 from public.orders o
      join public.stores s on s.id = o.store_id
      where o.id = order_items.order_id and s.user_id = auth.uid()
    )
  );
create policy "order_items_insert_store" on public.order_items
  for insert with check (
    exists (
      select 1 from public.orders o
      join public.stores s on s.id = o.store_id
      where o.id = order_items.order_id and s.user_id = auth.uid()
    )
  );

-- ledger accounts + journal entries + journal lines: ownership via store.
create policy "ledger_select_store" on public.ledger_accounts
  for select using (
    exists (select 1 from public.stores s where s.id = ledger_accounts.store_id and s.user_id = auth.uid())
  );
create policy "ledger_insert_store" on public.ledger_accounts
  for insert with check (
    exists (select 1 from public.stores s where s.id = ledger_accounts.store_id and s.user_id = auth.uid())
  );
create policy "ledger_update_store" on public.ledger_accounts
  for update using (
    exists (select 1 from public.stores s where s.id = ledger_accounts.store_id and s.user_id = auth.uid())
  );

create policy "journal_entries_select_store" on public.journal_entries
  for select using (
    exists (select 1 from public.stores s where s.id = journal_entries.store_id and s.user_id = auth.uid())
  );
create policy "journal_entries_insert_store" on public.journal_entries
  for insert with check (
    exists (select 1 from public.stores s where s.id = journal_entries.store_id and s.user_id = auth.uid())
  );

create policy "journal_lines_select_store" on public.journal_lines
  for select using (
    exists (
      select 1 from public.journal_entries je
      join public.stores s on s.id = je.store_id
      where je.id = journal_lines.entry_id and s.user_id = auth.uid()
    )
  );
create policy "journal_lines_insert_store" on public.journal_lines
  for insert with check (
    exists (
      select 1 from public.journal_entries je
      join public.stores s on s.id = je.store_id
      where je.id = journal_lines.entry_id and s.user_id = auth.uid()
    )
  );

-- integration events: read-only for the owner (written via service role).
create policy "events_select_store" on public.integration_events
  for select using (
    exists (select 1 from public.stores s where s.id = integration_events.store_id and s.user_id = auth.uid())
  );

-- ── notes ────────────────────────────────────────────────────────────────────

comment on table public.orders is
  'Normalized orders from store webhooks. Raw payload preserved in `raw`, computed profit available via public.true_net_profit(id).';
comment on table public.journal_entries is
  'Double-entry journal entries. Every entry must have Σ debits = Σ credits (enforced by the application engine).';
