-- ── Telegram multi-tenant user binding ───────────────────────────────────────
-- Lets a store owner connect their own Telegram account to one of their stores,
-- so the daily digest can be pushed to that person's chat.
--
-- Flow: the settings UI mints a single-use, expiring token → the owner opens
--   t.me/<bot>?start=<token> → Telegram delivers a /start update to our
--   webhook → we resolve the token and write the chat_id into that store's
--   digest_settings row.
--
-- Two schema changes:
--
--   public.telegram_link_tokens  — the shared lookup table. The webhook arrives
--     with NO tenant context (Telegram knows nothing about our sessions), so the
--     token→tenant mapping has to live in the shared public schema alongside
--     store_registry, which resolves tenant context for inbound webhooks for the
--     same reason. Only the SHA-256 hash is stored: a leaked table row cannot be
--     replayed as a valid deep link.
--
--   <tenant>.digest_settings.*   — the resulting binding (chat id, chat title,
--     username, when it was linked, and the bot that owns it).

create table if not exists public.telegram_link_tokens (
  token_hash text primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  schema_name text not null,
  store_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  -- What happened when the owner pressed /start with this token.
  bound_chat_id text,
  bound_chat_title text
);

-- One live token per store: re-minting replaces the previous one, so an owner
-- who never finishes the flow can simply ask for a new link.
create unique index if not exists telegram_link_tokens_store_key
  on public.telegram_link_tokens (schema_name, store_id);

create index if not exists telegram_link_tokens_expires_idx
  on public.telegram_link_tokens (expires_at);

-- Webhook lookups are by hash and only care about unexpired rows.
create index if not exists telegram_link_tokens_lookup_idx
  on public.telegram_link_tokens (token_hash) where used_at is null;

-- ── Tenant-side binding columns ─────────────────────────────────────────────
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
    execute format(
      'alter table %I.digest_settings add column if not exists telegram_chat_id text', v_schema);
    execute format(
      'alter table %I.digest_settings add column if not exists telegram_chat_title text', v_schema);
    execute format(
      'alter table %I.digest_settings add column if not exists telegram_username text', v_schema);
    execute format(
      'alter table %I.digest_settings add column if not exists telegram_linked_at timestamptz', v_schema);
    execute format(
      'alter table %I.digest_settings add column if not exists telegram_bot_username text', v_schema);
  end loop;
end;
$$;

-- New tenants. create_tenant_schema_guarded is the provisioning entry point, so
-- it gains the columns after creating the schema — same approach as the digest
-- tables and the immutability triggers. Re-declared in full because
-- CREATE OR REPLACE replaces the whole body.
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
      telegram_chat_id text,
      telegram_chat_title text,
      telegram_username text,
      telegram_linked_at timestamptz,
      telegram_bot_username text,
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
