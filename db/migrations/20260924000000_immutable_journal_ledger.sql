-- ── Immutable journal ledger (ERPNext-style) ─────────────────────────────────
-- ERPNext v13+ makes the General Ledger append-only: posted entries can be
-- cancelled but never edited in place, and corrections are reversing entries.
-- We adopt the same invariant at the database level for every tenant schema:
--
--   • journal_lines    → INSERT only. UPDATE/DELETE raise (row-level triggers).
--   • journal_entries  → posted rows are immutable (row-level UPDATE/DELETE
--                        blocked). Un-posted drafts may still be edited.
--   • TRUNCATE         → always blocked (statement-level triggers).
--
-- Maintenance flows (demo re-seeds, tenant purges) suspend the guard for
-- their session with:  set app.ledger_guard = 'off';
-- (transaction-scoped variant: `set local` inside begin/commit — see
-- scripts/ledger-guard.mjs). Application connections never suspend it.
--
-- The trigger functions live in public so every current and future tenant
-- schema shares one definition.

create or replace function public.ledger_guard_active()
returns boolean
language sql
stable
as $fn$
  select coalesce(current_setting('app.ledger_guard', true), 'on') <> 'off';
$fn$;

-- Row-level guard for journal_lines: any UPDATE or DELETE is rejected.
create or replace function public.journal_lines_immutable()
returns trigger
language plpgsql
as $fn$
begin
  if not public.ledger_guard_active() then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'journal_lines are immutable (append-only ledger): posted amounts can never be edited — post a reversing/correcting entry instead. (line %, account %)', old.id, old.account_code;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'journal_lines are immutable (append-only ledger): removing posted amounts would desync the General Ledger — post a reversing entry instead. (line %, account %)', old.id, old.account_code;
  end if;
  return coalesce(new, old);
end;
$fn$;

-- Statement-level guard: TRUNCATE is never allowed on journal_lines.
create or replace function public.journal_lines_truncate_guard()
returns trigger
language plpgsql
as $fn$
begin
  if public.ledger_guard_active() then
    raise exception 'journal_lines cannot be truncated (append-only ledger).';
  end if;
  return null;
end;
$fn$;

-- Row-level guard for journal_entries: posted rows are frozen; DELETE always
-- rejected. Drafts (status <> 'posted') may still be edited before posting.
create or replace function public.journal_entries_immutable()
returns trigger
language plpgsql
as $fn$
begin
  if not public.ledger_guard_active() then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'posted' then
      raise exception 'journal_entries row % is posted and immutable (append-only ledger) — post a reversing entry to correct it.', old.id;
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'journal_entries rows cannot be deleted (append-only ledger) — post a reversing entry instead. (entry %)', old.id;
  end if;
  return coalesce(new, old);
end;
$fn$;

-- Statement-level guard: TRUNCATE is never allowed on journal_entries.
create or replace function public.journal_entries_truncate_guard()
returns trigger
language plpgsql
as $fn$
begin
  if public.ledger_guard_active() then
    raise exception 'journal_entries cannot be truncated (append-only ledger).';
  end if;
  return null;
end;
$fn$;

-- Attach the guards to every existing tenant schema (idempotent).
do $$
declare
  v_schema text;
begin
  for v_schema in
    select table_schema from information_schema.tables
    where table_schema like 'tenant\______%' escape '\'
    group by table_schema
  loop
    execute format('drop trigger if exists journal_lines_immutable_trg on %I.journal_lines', v_schema);
    execute format('create trigger journal_lines_immutable_trg
      before update or delete on %I.journal_lines
      for each row execute function public.journal_lines_immutable()', v_schema);
    execute format('drop trigger if exists journal_lines_truncate_trg on %I.journal_lines', v_schema);
    execute format('create trigger journal_lines_truncate_trg
      before truncate on %I.journal_lines
      for each statement execute function public.journal_lines_truncate_guard()', v_schema);

    execute format('drop trigger if exists journal_entries_immutable_trg on %I.journal_entries', v_schema);
    execute format('create trigger journal_entries_immutable_trg
      before update or delete on %I.journal_entries
      for each row execute function public.journal_entries_immutable()', v_schema);
    execute format('drop trigger if exists journal_entries_truncate_trg on %I.journal_entries', v_schema);
    execute format('create trigger journal_entries_truncate_trg
      before truncate on %I.journal_entries
      for each statement execute function public.journal_entries_truncate_guard()', v_schema);
  end loop;
end;
$$;

-- New tenants get the same guards at provisioning time. Rather than editing
-- create_tenant_schema() inline, a thin wrapper re-runs the original body and
-- appends the trigger attachment. provision_user_tenant() is re-pointed at the
-- wrapper below, so fresh schemas are born with the guards.
create or replace function public.create_tenant_schema_guarded(p_tenant_id uuid)
returns text
language plpgsql
as $fn$
declare
  v_schema_name text;
begin
  v_schema_name := public.create_tenant_schema(p_tenant_id);

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

  return v_schema_name;
end;
$fn$;

-- The signup path provisions via provision_user_tenant(); point its schema
-- creation call at the guarded wrapper.
create or replace function public.provision_user_tenant(
  p_user_id uuid,
  p_email text,
  p_full_name text
)
returns text
language plpgsql
as $fn$
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

  v_schema_name := public.create_tenant_schema_guarded(v_tenant_id);
  update public.tenants set schema_name = v_schema_name where id = v_tenant_id;

  insert into public.tenant_users (tenant_id, user_id, role)
  values (v_tenant_id, p_user_id, 'owner');

  return v_schema_name;
end;
$fn$;
