-- ─────────────────────────────────────────────────────────────────────────────
-- Product catalog column rename (products management feature)
--
--   name        -> title
--   unit_cost   -> cost_price
--   unit_price  -> selling_price
--
-- Applies to every existing tenant schema. `create_tenant_schema()` is
-- replaced so future tenants get the new names directly. Order-line columns
-- (order_items.unit_price / unit_cost) are intentionally unchanged — they are
-- immutable financial snapshots, while the product catalog is the live source
-- that webhook ingestion now consults for COGS.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Rename columns in every existing tenant schema.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name
    FROM pg_namespace n
    WHERE n.nspname ~ '^tenant_[0-9a-f]{32}$'
      AND EXISTS (
        SELECT 1 FROM pg_tables t
        WHERE t.schemaname = n.nspname AND t.tablename = 'products'
      )
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = r.schema_name AND table_name = 'products' AND column_name = 'name'
    ) THEN
      EXECUTE format('alter table %I.products rename column name to title', r.schema_name);
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = r.schema_name AND table_name = 'products' AND column_name = 'unit_cost'
    ) THEN
      EXECUTE format('alter table %I.products rename column unit_cost to cost_price', r.schema_name);
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = r.schema_name AND table_name = 'products' AND column_name = 'unit_price'
    ) THEN
      EXECUTE format('alter table %I.products rename column unit_price to selling_price', r.schema_name);
    END IF;
  END LOOP;
END
$$;

-- 2) Update the tenant provisioning template for future tenants.
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
    title text not null,
    selling_price numeric(12, 2) not null default 0,
    cost_price numeric(12, 2) not null default 0,
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
