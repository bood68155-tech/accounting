-- ── Daily digest notifications (WhatsApp / Telegram) ────────────────────────
-- Per-store configuration and the delivery log that makes the daily digest
-- idempotent. Two tables, added to every tenant schema:
--
--   digest_settings    — one row per store: which channels, at what hour, in
--                        which timezone, and which sections to include.
--   digest_deliveries  — one row per store × date × channel × destination, with
--                        a UNIQUE constraint on that key. The cron runner
--                        checks it before sending, so a retried or overlapping
--                        run can never double-message an owner.
--
-- The UNIQUE constraint is the actual guarantee; the runner's pre-check is only
-- an optimization, so two concurrent cron invocations still cannot both send.

-- Existing tenant schemas.
do $$
declare
  v_schema text;
begin
  for v_schema in
    select table_schema from information_schema.tables
    where table_schema like 'tenant\______%' escape '\'
    group by table_schema
  loop
    execute format($ddl$
      create table if not exists %I.digest_settings (
        store_id uuid primary key references %I.stores (id) on delete cascade,
        enabled boolean not null default true,
        channels jsonb not null default '[]'::jsonb,
        send_hour integer not null default 8,
        timezone text not null default 'UTC',
        currency text not null default 'USD',
        sections jsonb not null default '{}'::jsonb,
        skip_when_empty boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      ); $ddl$, v_schema, v_schema);

    execute format($ddl$
      create table if not exists %I.digest_deliveries (
        id uuid primary key default gen_random_uuid(),
        store_id uuid not null references %I.stores (id) on delete cascade,
        digest_date date not null,
        channel text not null,
        destination text not null,
        status text not null,
        attempts integer not null default 0,
        provider_message_id text,
        error text,
        created_at timestamptz not null default now(),
        unique (store_id, digest_date, channel, destination)
      ); $ddl$, v_schema, v_schema);

    execute format(
      'create index if not exists digest_deliveries_store_date_idx on %I.digest_deliveries (store_id, digest_date desc)',
      v_schema);
  end loop;
end;
$$;

-- New tenants. Following the precedent set by the immutable-ledger migration,
-- we do not edit create_tenant_schema() inline: the guarded wrapper is the
-- provisioning entry point, so it gains the two tables after creating the
-- schema. Existing callers of create_tenant_schema() are unaffected.
create or replace function public.create_tenant_schema_guarded(p_tenant_id uuid)
returns text
language plpgsql
as $fn$
declare
  v_schema_name text;
begin
  v_schema_name := public.create_tenant_schema(p_tenant_id);

  -- (immutability triggers — unchanged from the ledger migration)
  execute format('drop trigger if exists journal_lines_immutable_trg on %I.journal_lines', v_schema_name);
  execute format('create trigger journal_lines_immutable_trg
    before update or delete on %I.journal_lines
    for each row execute function public.journal_lines_immutable()', v_schema_name);
  execute format('drop trigger if exists journal_lines_truncate_trg on %I.journal_lines', v_schema_name);
  execute format('create trigger journal_lines_truncate_trg
    before truncate on %I.journal_lines
    for each statement execute function public.journal_lines_truncate_guard()', v_schema_name);

  execute format('drop trigger if exists journal_entries_immutable_trg on %I.journal_entries', v_schema_name);
  execute format('create trigger journal_entries_immutable_trg
    before update or delete on %I.journal_entries
    for each row execute function public.journal_entries_immutable()', v_schema_name);
  execute format('drop trigger if exists journal_entries_truncate_trg on %I.journal_entries', v_schema_name);
  execute format('create trigger journal_entries_truncate_trg
    before truncate on %I.journal_entries
    for each statement execute function public.journal_entries_truncate_guard()', v_schema_name);

  -- (daily digest notifications)
  execute format($ddl$
    create table if not exists %I.digest_settings (
      store_id uuid primary key references %I.stores (id) on delete cascade,
      enabled boolean not null default true,
      channels jsonb not null default '[]'::jsonb,
      send_hour integer not null default 8,
      timezone text not null default 'UTC',
      currency text not null default 'USD',
      sections jsonb not null default '{}'::jsonb,
      skip_when_empty boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    ); $ddl$, v_schema_name, v_schema_name);

  execute format($ddl$
    create table if not exists %I.digest_deliveries (
      id uuid primary key default gen_random_uuid(),
      store_id uuid not null references %I.stores (id) on delete cascade,
      digest_date date not null,
      channel text not null,
      destination text not null,
      status text not null,
      attempts integer not null default 0,
      provider_message_id text,
      error text,
      created_at timestamptz not null default now(),
      unique (store_id, digest_date, channel, destination)
    ); $ddl$, v_schema_name, v_schema_name);

  execute format(
    'create index if not exists digest_deliveries_store_date_idx on %I.digest_deliveries (store_id, digest_date desc)',
    v_schema_name);

  return v_schema_name;
end;
$fn$;
