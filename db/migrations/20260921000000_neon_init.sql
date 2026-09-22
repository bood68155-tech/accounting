-- ─────────────────────────────────────────────────────────────────────────────
-- X — Neon (plain Postgres) initial schema
-- Automated AI Accounting & Profitability Engine for E-commerce Stores
--
-- Ported from the Supabase schema. Differences:
--   • `auth.users` is replaced by a first-class public.users table (bcrypt
--     password hashes — auth is handled by NextAuth in the app layer).
--   • No RLS, grants, or PostgREST config: the app connects with a single
--     owner connection string and enforces tenant scoping in the data layer
--     (every tenant query is schema-qualified via lib/db `tenantTable`).
--   • User → tenant provisioning is an explicit function called by the
--     signup route instead of an auth trigger.
--
-- Run order: single file. Applies to an empty Neon database.
--   DATABASE_URL=postgres://... npm run db:migrate
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

-- ── Helpers ──────────────────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── Auth users (replaces Supabase auth.users) ────────────────────────────────

create table public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  disabled boolean not null default false,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_users_updated_at before update on public.users
  for each row execute function public.set_updated_at();

-- ── Shared metadata ──────────────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references public.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  slug text not null unique,
  -- Postgres schema that holds this tenant's data (e.g. tenant_<uuid-hex>).
  schema_name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_tenants_updated_at before update on public.tenants
  for each row execute function public.set_updated_at();

create table public.tenant_users (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

-- Maps every store (wherever it lives) to its tenant schema. Written by a
-- per-schema trigger; read by webhook routes and the admin console so they can
-- find the right schema for a store_id.
create table public.store_registry (
  store_id uuid primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  schema_name text not null,
  created_at timestamptz not null default now()
);

-- ── Tenant schema provisioning ───────────────────────────────────────────────
-- Creates the `tenant_<uuid-hex>` schema and everything inside it. The schema
-- name is derived from the tenant id and shape-validated before use.

create or replace function public.create_tenant_schema(p_tenant_id uuid)
returns text
language plpgsql
as $$
declare
  v_schema_name text := 'tenant_' || replace(p_tenant_id::text, '-', '');
begin
  if v_schema_name !~ '^tenant_[0-9a-f]{32}$' then
    raise exception 'Invalid tenant id %', p_tenant_id;
  end if;

  execute format('create schema %I', v_schema_name);

  -- ── tables ─────────────────────────────────────────────────────────────
  execute format('create table %I.stores (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users (id) on delete cascade,
    name text not null,
    platform public.platform not null,
    domain text,
    currency text not null default ''USD'',
    status public.store_status not null default ''connected'',
    config jsonb not null default ''{}''::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, domain)
  )', v_schema_name);

  execute format('create table %I.products (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references %I.stores (id) on delete cascade,
    external_id text,
    sku text not null,
    name text not null,
    unit_cost numeric(12, 2) not null default 0,
    unit_price numeric(12, 2) not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (store_id, sku)
  )', v_schema_name, v_schema_name);

  execute format('create table %I.orders (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references %I.stores (id) on delete cascade,
    external_id text not null,
    order_number text not null,
    customer_name text,
    currency text not null default ''USD'',
    subtotal numeric(12, 2) not null default 0,
    shipping_amount numeric(12, 2) not null default 0,
    discount_amount numeric(12, 2) not null default 0,
    tax_amount numeric(12, 2) not null default 0,
    total_amount numeric(12, 2) not null default 0,
    payment_gateway text not null default ''unknown'',
    payment_fee numeric(12, 2) not null default 0,
    shipping_cost numeric(12, 2) not null default 0,
    refund_amount numeric(12, 2) not null default 0,
    status public.order_status not null default ''pending'',
    ordered_at timestamptz not null default now(),
    raw jsonb,
    entry_numbers integer[] not null default ''{}'',
    created_at timestamptz not null default now(),
    unique (store_id, external_id)
  )', v_schema_name, v_schema_name);
  execute format('create index orders_store_ordered_idx on %I.orders (store_id, ordered_at desc)', v_schema_name);

  execute format('create table %I.order_items (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references %I.orders (id) on delete cascade,
    product_id uuid references %I.products (id) on delete set null,
    sku text not null,
    name text not null,
    quantity integer not null default 1,
    unit_price numeric(12, 2) not null default 0,
    unit_cost numeric(12, 2) not null default 0,
    line_subtotal numeric(12, 2) not null default 0,
    line_cost numeric(12, 2) not null default 0,
    created_at timestamptz not null default now()
  )', v_schema_name, v_schema_name, v_schema_name);

  execute format('create table %I.ledger_accounts (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references %I.stores (id) on delete cascade,
    code text not null,
    name text not null,
    type public.account_type not null,
    normal_balance public.normal_balance not null,
    is_system boolean not null default false,
    description text,
    created_at timestamptz not null default now(),
    unique (store_id, code)
  )', v_schema_name, v_schema_name);

  execute format('create table %I.journal_entries (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references %I.stores (id) on delete cascade,
    entry_number integer not null,
    entry_date date not null,
    description text not null,
    reference text,
    source public.entry_source not null default ''manual'',
    status public.entry_status not null default ''posted'',
    created_by uuid references public.users (id),
    created_at timestamptz not null default now(),
    posted_at timestamptz not null default now(),
    unique (store_id, entry_number)
  )', v_schema_name, v_schema_name);
  execute format('create index journal_entries_store_date_idx on %I.journal_entries (store_id, entry_date)', v_schema_name);

  execute format('create table %I.journal_lines (
    id uuid primary key default gen_random_uuid(),
    entry_id uuid not null references %I.journal_entries (id) on delete cascade,
    account_code text not null,
    account_name text not null,
    account_type public.account_type not null,
    description text,
    debit numeric(14, 2) not null default 0,
    credit numeric(14, 2) not null default 0,
    check (debit >= 0 and credit >= 0),
    check (not (debit = 0 and credit = 0))
  )', v_schema_name, v_schema_name);
  execute format('create index journal_lines_entry_idx on %I.journal_lines (entry_id)', v_schema_name);

  execute format('create table %I.integration_events (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references %I.stores (id) on delete cascade,
    provider text not null,
    event_type text not null,
    payload jsonb not null default ''{}''::jsonb,
    status public.event_status not null default ''processed'',
    error text,
    processed_at timestamptz not null default now()
  )', v_schema_name, v_schema_name);
  execute format('create index integration_events_store_idx on %I.integration_events (store_id, processed_at desc)', v_schema_name);

  -- ── triggers / helper functions (per schema) ────────────────────────────
  execute format('create trigger set_stores_updated_at before update on %I.stores
    for each row execute function public.set_updated_at()', v_schema_name);
  execute format('create trigger set_products_updated_at before update on %I.products
    for each row execute function public.set_updated_at()', v_schema_name);

  -- Keep public.store_registry in sync when a store is created.
  execute format('create or replace function %I.register_store()
    returns trigger
    language plpgsql
    as $fn$
    begin
      insert into public.store_registry (store_id, tenant_id, schema_name)
      values (new.id, %L, %L)
      on conflict (store_id) do update
        set tenant_id = excluded.tenant_id, schema_name = excluded.schema_name;
      return new;
    end;
    $fn$', v_schema_name, p_tenant_id, v_schema_name);
  execute format('create trigger on_store_created after insert on %I.stores
    for each row execute function %I.register_store()', v_schema_name, v_schema_name);

  -- Seed the standard chart of accounts for a store (called by the app).
  execute format('create or replace function %I.seed_chart_of_accounts(p_store_id uuid)
    returns void
    language plpgsql
    as $fn$
    begin
      insert into %I.ledger_accounts (store_id, code, name, type, normal_balance, is_system, description)
      values
        (p_store_id, ''1000'', ''Cash'',                     ''asset'',     ''debit'',  true, ''Operating cash account''),
        (p_store_id, ''1100'', ''Accounts Receivable'',      ''asset'',     ''debit'',  true, ''Money owed by customers''),
        (p_store_id, ''1200'', ''Inventory'',                ''asset'',     ''debit'',  true, ''Merchandise at item cost''),
        (p_store_id, ''2000'', ''Accounts Payable'',         ''liability'', ''credit'', true, ''Money owed to suppliers''),
        (p_store_id, ''2100'', ''Sales Tax Payable'',        ''liability'', ''credit'', true, ''Sales tax collected''),
        (p_store_id, ''3000'', ''Owner''''s Equity'',        ''equity'',    ''credit'', true, ''Owner capital''),
        (p_store_id, ''4000'', ''Sales Revenue'',            ''revenue'',   ''credit'', true, ''Product sales before discounts''),
        (p_store_id, ''4100'', ''Shipping Revenue'',         ''revenue'',   ''credit'', true, ''Shipping charged to customers''),
        (p_store_id, ''4200'', ''Other Revenue'',            ''revenue'',   ''credit'', false, ''Miscellaneous income''),
        (p_store_id, ''4400'', ''Discounts Given'',          ''revenue'',   ''debit'',  true, ''Contra-revenue: coupons''),
        (p_store_id, ''4500'', ''Refunds Given'',            ''revenue'',   ''debit'',  true, ''Contra-revenue: refunds''),
        (p_store_id, ''5000'', ''Cost of Goods Sold'',       ''expense'',   ''debit'',  true, ''True item cost of sales''),
        (p_store_id, ''5100'', ''Shipping Expense'',         ''expense'',   ''debit'',  true, ''Cost the store pays to ship''),
        (p_store_id, ''5200'', ''Payment Processing Fees'',  ''expense'',   ''debit'',  true, ''Gateway fees''),
        (p_store_id, ''5300'', ''Marketing & Advertising'',  ''expense'',   ''debit'',  false, ''Paid ads and marketing''),
        (p_store_id, ''5400'', ''Software & Subscriptions'', ''expense'',   ''debit'',  false, ''SaaS subscriptions''),
        (p_store_id, ''5900'', ''Miscellaneous Expenses'',   ''expense'',   ''debit'',  false, ''Other operating expenses'')
      on conflict (store_id, code) do nothing;
    end;
    $fn$', v_schema_name, v_schema_name);

  -- True net profit for an order, computed inside the database.
  execute format('create or replace function %I.true_net_profit(p_order_id uuid)
    returns numeric
    language sql
    stable
    as $fn$
      select round(
        (
          (o.subtotal + o.shipping_amount - o.discount_amount - o.refund_amount)
          - (
              coalesce((select sum(oi.line_cost) from %I.order_items oi where oi.order_id = o.id), 0)
              * (1 - case when o.total_amount > 0 then least(1, o.refund_amount / o.total_amount) else 0 end)
            )
          - o.payment_fee
          - o.shipping_cost
        )::numeric, 2)
      from %I.orders o
      where o.id = p_order_id;
    $fn$', v_schema_name, v_schema_name, v_schema_name);

  return v_schema_name;
end;
$$;

-- ── User → tenant provisioning (called by the signup route) ──────────────────
-- Idempotent: returns the existing schema when the user already has a tenant.

create or replace function public.provision_user_tenant(
  p_user_id uuid,
  p_email text,
  p_full_name text
)
returns text
language plpgsql
as $$
declare
  v_existing uuid;
  v_tenant_id uuid;
  v_schema_name text;
  v_name text := nullif(p_full_name, '');
  v_slug text;
begin
  if v_name is null then
    v_name := split_part(p_email, '@', 1);
  end if;

  select t.id into v_existing from public.tenants t
    where t.owner_id = p_user_id limit 1;

  if v_existing is not null then
    select schema_name into v_schema_name from public.tenants where id = v_existing;
    return v_schema_name;
  end if;

  v_slug := lower(regexp_replace(split_part(p_email, '@', 1), '[^a-z0-9]+', '-', 'g'))
            || '-' || substr(replace(p_user_id::text, '-', ''), 1, 8);
  v_slug := trim(both '-' from v_slug);

  insert into public.tenants (owner_id, name, slug, schema_name)
  values (p_user_id, v_name || '''s workspace', v_slug, '')
  returning id into v_tenant_id;

  v_schema_name := public.create_tenant_schema(v_tenant_id);
  update public.tenants set schema_name = v_schema_name where id = v_tenant_id;

  insert into public.tenant_users (tenant_id, user_id, role)
  values (v_tenant_id, p_user_id, 'owner');

  return v_schema_name;
end;
$$;
