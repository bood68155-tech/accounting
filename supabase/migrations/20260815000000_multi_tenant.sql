-- ─────────────────────────────────────────────────────────────────────────────
-- Store Accountant — multi-tenant schema-per-tenant isolation
--
-- Architecture change: tenant data no longer lives in `public`. Instead:
--   • public holds only shared metadata: tenants, tenant_users, store_registry
--     and profiles (plus the shared enums/types from the init migration).
--   • Every tenant gets its own Postgres schema (`tenant_<uuid-hex>`) created
--     by create_tenant_schema() containing stores, orders, ledger, products…
--   • RLS inside each tenant schema keys on membership in public.tenant_users,
--     so users can only ever reach their own tenant's schema.
--   • The webhook/admin layers resolve the tenant schema via public.store_registry
--     / public.tenants using the service role.
--
-- Run order: this migration assumes 20260808000000_init.sql has been applied.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Shared metadata tables ───────────────────────────────────────────────────

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  slug text not null unique,
  -- Postgres schema that holds this tenant's data (e.g. tenant_<uuid-hex>).
  schema_name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tenant_users (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

-- Maps every store (wherever it lives) to its tenant schema. Written by a
-- per-schema trigger; read by webhook routes and the admin console so they can
-- find the right schema for a store_id. Not exposed to tenant users.
create table public.store_registry (
  store_id uuid primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  schema_name text not null,
  created_at timestamptz not null default now()
);

-- ── Tenant schema provisioning ───────────────────────────────────────────────
-- Security definer (owner = postgres) so it can run DDL. The schema name is
-- derived from the tenant id and validated, so callers cannot inject
-- identifiers. Executable only by the service role (revoked below).

create or replace function public.create_tenant_schema(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schema_name text := 'tenant_' || replace(p_tenant_id::text, '-', '');
  v_membership text;
begin
  -- Validate the identifier shape (tenant_ + 32 hex chars) before using %I.
  if v_schema_name !~ '^tenant_[0-9a-f]{32}$' then
    raise exception 'Invalid tenant id %', p_tenant_id;
  end if;

  execute format('create schema %I', v_schema_name);

  -- ── tables ─────────────────────────────────────────────────────────────
  execute format('create table %I.stores (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
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
    created_by uuid references auth.users (id),
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
    security definer
    set search_path = public
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
    security definer
    set search_path = public
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
  execute format('revoke all on function %I.seed_chart_of_accounts(uuid) from public, anon, authenticated', v_schema_name);
  execute format('grant execute on function %I.seed_chart_of_accounts(uuid) to service_role', v_schema_name);

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
  execute format('revoke all on function %I.true_net_profit(uuid) from public, anon, authenticated', v_schema_name);
  execute format('grant execute on function %I.true_net_profit(uuid) to service_role', v_schema_name);

  -- ── privileges ──────────────────────────────────────────────────────────
  -- Only authenticated users (signed-in browser clients) reach tenant schemas.
  execute format('grant usage on schema %I to authenticated', v_schema_name);
  execute format('grant select, insert, update, delete on all tables in schema %I to authenticated', v_schema_name);

  -- ── Row Level Security (membership in public.tenant_users) ─────────────
  v_membership := format(
    'exists (select 1 from public.tenant_users tu where tu.user_id = auth.uid() and tu.tenant_id = %L)',
    p_tenant_id
  );

  execute format('alter table %I.stores enable row level security', v_schema_name);
  execute format('alter table %I.products enable row level security', v_schema_name);
  execute format('alter table %I.orders enable row level security', v_schema_name);
  execute format('alter table %I.order_items enable row level security', v_schema_name);
  execute format('alter table %I.ledger_accounts enable row level security', v_schema_name);
  execute format('alter table %I.journal_entries enable row level security', v_schema_name);
  execute format('alter table %I.journal_lines enable row level security', v_schema_name);
  execute format('alter table %I.integration_events enable row level security', v_schema_name);

  execute format('create policy tenant_select on %I.stores for select using (%s)', v_schema_name, v_membership);
  execute format('create policy tenant_insert on %I.stores for insert with check (%s)', v_schema_name, v_membership);
  execute format('create policy tenant_update on %I.stores for update using (%s)', v_schema_name, v_membership);
  execute format('create policy tenant_delete on %I.stores for delete using (%s)', v_schema_name, v_membership);

  execute format('create policy tenant_select on %I.products for select using (%s)', v_schema_name, v_membership);
  execute format('create policy tenant_insert on %I.products for insert with check (%s)', v_schema_name, v_membership);
  execute format('create policy tenant_update on %I.products for update using (%s)', v_schema_name, v_membership);
  execute format('create policy tenant_delete on %I.products for delete using (%s)', v_schema_name, v_membership);

  execute format('create policy tenant_select on %I.orders for select using (%s)', v_schema_name, v_membership);
  execute format('create policy tenant_insert on %I.orders for insert with check (%s)', v_schema_name, v_membership);
  execute format('create policy tenant_update on %I.orders for update using (%s)', v_schema_name, v_membership);

  execute format('create policy tenant_select on %I.order_items for select using (%s)', v_schema_name, v_membership);
  execute format('create policy tenant_insert on %I.order_items for insert with check (%s)', v_schema_name, v_membership);

  execute format('create policy tenant_select on %I.ledger_accounts for select using (%s)', v_schema_name, v_membership);
  execute format('create policy tenant_insert on %I.ledger_accounts for insert with check (%s)', v_schema_name, v_membership);
  execute format('create policy tenant_update on %I.ledger_accounts for update using (%s)', v_schema_name, v_membership);

  execute format('create policy tenant_select on %I.journal_entries for select using (%s)', v_schema_name, v_membership);
  execute format('create policy tenant_insert on %I.journal_entries for insert with check (%s)', v_schema_name, v_membership);

  execute format('create policy tenant_select on %I.journal_lines for select using (%s)', v_schema_name, v_membership);
  execute format('create policy tenant_insert on %I.journal_lines for insert with check (%s)', v_schema_name, v_membership);

  -- integration events: read-only for the tenant (written via service role).
  execute format('create policy tenant_select on %I.integration_events for select using (%s)', v_schema_name, v_membership);

  return v_schema_name;
end;
$$;

revoke all on function public.create_tenant_schema(uuid) from public, anon, authenticated;
grant execute on function public.create_tenant_schema(uuid) to service_role;

-- ── Auto-provision a tenant for every new user ───────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_schema_name text;
  v_name text := coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1));
  v_slug text;
begin
  insert into public.profiles (id, full_name)
  values (new.id, v_name)
  on conflict (id) do nothing;

  v_slug := lower(regexp_replace(split_part(new.email, '@', 1), '[^a-z0-9]+', '-', 'g'))
            || '-' || substr(replace(new.id::text, '-', ''), 1, 8);
  v_slug := trim(both '-' from v_slug);

  if not exists (select 1 from public.tenants where owner_id = new.id) then
    insert into public.tenants (owner_id, name, slug, schema_name)
    values (new.id, v_name || '''s workspace', v_slug, '')
    returning id into v_tenant_id;

    v_schema_name := public.create_tenant_schema(v_tenant_id);
    update public.tenants set schema_name = v_schema_name where id = v_tenant_id;

    insert into public.tenant_users (tenant_id, user_id, role)
    values (v_tenant_id, new.id, 'owner');
  end if;

  return new;
end;
$$;

-- ── Drop legacy single-schema tenant data (now isolated per schema) ──────────
-- The shared enums, profiles and set_updated_at() helper stay in public.

drop function if exists public.seed_chart_of_accounts(uuid);
drop function if exists public.true_net_profit(uuid);
drop table if exists public.integration_events;
drop table if exists public.journal_lines;
drop table if exists public.journal_entries;
drop table if exists public.ledger_accounts;
drop table if exists public.order_items;
drop table if exists public.orders;
drop table if exists public.products;
drop table if exists public.stores;

-- ── Backfill: provision a tenant + schema for users who signed up before ─────
-- this migration (so existing accounts keep working after the refactor).

do $$
declare
  r record;
  v_tenant uuid;
  v_schema text;
  v_name text;
  v_slug text;
begin
  for r in
    select u.id, u.email, u.raw_user_meta_data
    from auth.users u
    where not exists (select 1 from public.tenants t where t.owner_id = u.id)
  loop
    v_name := coalesce(r.raw_user_meta_data ->> 'full_name', split_part(r.email, '@', 1));
    v_slug := lower(regexp_replace(split_part(r.email, '@', 1), '[^a-z0-9]+', '-', 'g'))
              || '-' || substr(replace(r.id::text, '-', ''), 1, 8);
    v_slug := trim(both '-' from v_slug);

    insert into public.tenants (owner_id, name, slug, schema_name)
    values (r.id, v_name || '''s workspace', v_slug, '')
    returning id into v_tenant;

    v_schema := public.create_tenant_schema(v_tenant);
    update public.tenants set schema_name = v_schema where id = v_tenant;

    insert into public.tenant_users (tenant_id, user_id, role)
    values (v_tenant, r.id, 'owner');
  end loop;
end $$;

-- ── RLS on shared metadata ───────────────────────────────────────────────────

alter table public.tenants enable row level security;
alter table public.tenant_users enable row level security;
alter table public.store_registry enable row level security;

-- A user sees their own tenant(s) — as owner or member.
create policy "tenants_select_member" on public.tenants
  for select using (
    owner_id = auth.uid()
    or exists (select 1 from public.tenant_users tu where tu.tenant_id = id and tu.user_id = auth.uid())
  );
create policy "tenants_update_owner" on public.tenants
  for update using (owner_id = auth.uid());

create policy "tenant_users_select_own" on public.tenant_users
  for select using (user_id = auth.uid());

-- store_registry is service-role only: no policies → no tenant access.
