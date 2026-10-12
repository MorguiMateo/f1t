-- Run against a locally migrated database with psql -v ON_ERROR_STOP=1 -f.
-- Catalog assertions only: no auth fixtures, no user data is changed.
begin;

do $$
declare
  column_type text;
  is_nullable text;
  definition text;
begin
  select data_type || '(' || numeric_precision || ',' || numeric_scale || ')', c.is_nullable
    into column_type, is_nullable
    from information_schema.columns c
   where table_schema = 'public'
     and table_name = 'routine_exercises'
     and column_name = 'target_weight_kg';

  if column_type is distinct from 'numeric(6,2)' then
    raise exception 'target_weight_kg must be numeric(6,2), got %', column_type;
  end if;

  if is_nullable <> 'YES' then
    raise exception 'target_weight_kg must be nullable (null = no weight chosen)';
  end if;

  select pg_get_constraintdef(oid) into definition
    from pg_constraint
   where conrelid = 'public.routine_exercises'::regclass
     and conname = 'routine_exercises_target_weight_check';
  if definition is null or definition not like '%>= (0)%' then
    raise exception 'Missing non-negative target weight check: %', definition;
  end if;

  -- 0 is a valid weight; the owner-only policy on the table covers the column.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'routine_exercises'
       and policyname = 'routine_exercises_own'
  ) then
    raise exception 'routine_exercises owner policy is missing';
  end if;
end;
$$;

rollback;
