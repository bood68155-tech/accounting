-- ── Reversal support for journal entries (ERPNext-style cancellation) ────────
-- The immutability guard (20260924000000) makes posted entries frozen: a
-- correction is a NEW entry that swaps every line of the original and links
-- back via reversal_of. These columns are the audit link.
--
-- Applied to every existing tenant schema; also folded into
-- create_tenant_schema() so fresh schemas are born with the columns.

do $$
declare
  v_schema text;
begin
  for v_schema in
    select table_schema from information_schema.tables
    where table_schema like 'tenant\______%' escape '\'
    group by table_schema
  loop
    -- Add columns when missing (idempotent).
    if not exists (
      select 1 from information_schema.columns
      where table_schema = v_schema and table_name = 'journal_entries' and column_name = 'reversal_of'
    ) then
      execute format('alter table %I.journal_entries add column reversal_of uuid', v_schema);
    end if;
    if not exists (
      select 1 from information_schema.columns
      where table_schema = v_schema and table_name = 'journal_entries' and column_name = 'reversal_reason'
    ) then
      execute format('alter table %I.journal_entries add column reversal_reason text', v_schema);
    end if;

    -- Audit lookup: find the reversal of an entry; find what an entry reverses.
    execute format('create index if not exists journal_entries_reversal_idx on %I.journal_entries (reversal_of)', v_schema);
  end loop;
end;
$$;

-- New tenants: re-create create_tenant_schema() from the base migration with
-- the two columns added to the journal_entries DDL. We cannot cleanly append
-- columns via the wrapper trick (they live inside format() DDL), so we define
-- the guarded wrapper to ALTER after creation instead — idempotent both ways.
create or replace function public.create_tenant_schema_guarded(p_tenant_id uuid)
returns text
language plpgsql
as $fn$
declare
  v_schema_name text;
begin
  v_schema_name := public.create_tenant_schema(p_tenant_id);

  -- Reversal columns (idempotent).
  execute format('alter table %I.journal_entries add column if not exists reversal_of uuid', v_schema_name);
  execute format('alter table %I.journal_entries add column if not exists reversal_reason text', v_schema_name);
  execute format('create index if not exists journal_entries_reversal_idx on %I.journal_entries (reversal_of)', v_schema_name);

  -- Ledger immutability triggers (from 20260924000000).
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
